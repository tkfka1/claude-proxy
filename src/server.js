import crypto from 'node:crypto';
import http from 'node:http';

import { loadConfig, resolveCliModel } from './config.js';
import {
  ProxyError,
  buildClaudePrompt,
  createMessageId,
  createRequestId,
  json,
  makeAnthropicMessageResponse,
  normalizeSystemPrompt,
  readJsonBody,
  sendAnthropicError,
  sendProxyError,
  sseHeaders,
  validateMessagesRequest,
  writeSseEvent,
  truncateByStopSequences,
} from './anthropic.js';
import { createClaudeAuthManager } from './claude-auth.js';
import { createMessageConcurrencyManager } from './message-concurrency.js';
import { createProxyApiKeyManager } from './proxy-api-key.js';
import { createProxyStateFileStore, createRecentLogFileStore } from './proxy-state-file.js';
import { createRedisMessageConcurrencyManager } from './redis-message-concurrency.js';
import { createRedisStateStore } from './redis-state-store.js';
import { createRecentLogStore } from './recent-log-store.js';
import { runClaudeJson, runClaudeStream } from './claude-cli.js';
import { createScryptPasswordHash, validateNewWebPassword, verifyWebPassword } from './web-auth.js';
import { faviconIco, faviconSvg, renderHomePage, renderLoginPage, serviceMetadata } from './web.js';

const config = loadConfig();
const WEB_SESSION_COOKIE_NAME = 'claude_proxy_web_session';
const CALL_TEST_DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const CALL_TEST_DEFAULT_PROMPT = 'Reply only OK.';
const webSessions = new Map();
const webLoginAttempts = new Map();
let memoryWebPasswordState = null;
const startedAt = Date.now();
let isShuttingDown = false;
let shutdownPromise = null;
const activeMessageControllers = new Set();
const metrics = {
  requests: {
    total: 0,
    aborted: 0,
    byRoute: {},
    status: {},
  },
  messages: {
    total: 0,
    jsonCompleted: 0,
    streamCompleted: 0,
    failed: 0,
    aborted: 0,
    authFailed: 0,
  },
  claudeCli: {
    jsonStarted: 0,
    jsonCompleted: 0,
    streamStarted: 0,
    streamCompleted: 0,
    failed: 0,
    timeout: 0,
  },
  proxyApiKey: {
    rotations: 0,
    previousKeyMatches: 0,
  },
  shutdowns: {
    started: 0,
    completed: 0,
    forced: 0,
  },
};
const stateBackend = config.redisUrl
  ? await createRedisStateStore({
      url: config.redisUrl,
      keyPrefix: config.redisKeyPrefix,
    })
  : null;
const webAuthStateStore = stateBackend
  ? stateBackend.createWebAuthStore()
  : {
      async getSession(token) {
        for (const [storedToken, session] of webSessions.entries()) {
          if (session.expiresAt <= Date.now()) {
            webSessions.delete(storedToken);
          }
        }

        const session = webSessions.get(token);
        if (!session) return null;
        if (session.expiresAt <= Date.now()) {
          webSessions.delete(token);
          return null;
        }

        return { ...session };
      },
      async createSession({ token, expiresAt, passwordUpdatedAt }) {
        webSessions.set(token, { expiresAt, passwordUpdatedAt });
      },
      async deleteSession(token) {
        webSessions.delete(token);
      },
      async getLoginAttempt(key) {
        const now = Date.now();
        for (const [storedKey, entry] of webLoginAttempts.entries()) {
          if (entry.blockedUntil > now) continue;
          const windowMs = config.webLoginWindowMinutes * 60 * 1000;
          if (now - entry.windowStartedAt < windowMs) continue;
          webLoginAttempts.delete(storedKey);
        }

        return webLoginAttempts.get(key) || null;
      },
      async setLoginAttempt(key, entry) {
        webLoginAttempts.set(key, entry);
      },
      async clearLoginAttempt(key) {
        webLoginAttempts.delete(key);
      },
      async getPasswordState() {
        return memoryWebPasswordState ? { ...memoryWebPasswordState } : null;
      },
      async setPasswordState(state) {
        memoryWebPasswordState = state ? { ...state } : null;
      },
      async clearPasswordState() {
        memoryWebPasswordState = null;
      },
    };
let activeWebPasswordState = await webAuthStateStore.getPasswordState();
const proxyStateFileStore = stateBackend ? stateBackend.createProxyApiKeyStore() : createProxyStateFileStore({ filePath: config.proxyStateFile });
const recentLogFileStore = stateBackend ? stateBackend.createRecentLogStore() : createRecentLogFileStore({ filePath: config.recentLogFile });
const initialRecentLogEntries = await recentLogFileStore.loadEntries();
let initialProxyApiKeyState = await proxyStateFileStore.loadState();
if (!initialProxyApiKeyState && config.proxyApiKey) {
  initialProxyApiKeyState = {
    proxyApiKey: config.proxyApiKey,
    updatedAt: new Date().toISOString(),
  };
  await proxyStateFileStore.saveState(initialProxyApiKeyState);
}
const recentLogStore = createRecentLogStore({
  limit: config.recentLogLimit,
  storage: recentLogFileStore,
  initialEntries: initialRecentLogEntries,
});
const claudeAuthStore = stateBackend && config.claudeAuthRedisSync
  ? stateBackend.createClaudeAuthStore()
  : null;
const claudeAuthManager = createClaudeAuthManager({
  claudeBin: config.claudeBin,
  authDir: config.claudeAuthDir,
  authStore: claudeAuthStore,
});
const proxyApiKeyManager = createProxyApiKeyManager({
  initialApiKey: config.proxyApiKey,
  loadedState: initialProxyApiKeyState,
  storage: proxyStateFileStore,
  gracePeriodSeconds: config.proxyApiKeyGracePeriodSeconds,
  historyLimit: config.proxyApiKeyHistoryLimit,
});
const messageConcurrencyManager = stateBackend
  ? createRedisMessageConcurrencyManager({
      client: stateBackend.client,
      keyPrefix: config.redisKeyPrefix,
      maxConcurrent: config.maxConcurrentMessageRequests,
      maxQueued: config.maxQueuedMessageRequests,
      maxWaitMs: config.maxMessageQueueWaitMs,
      onEvent(type, payload) {
        const levels = {
          queued: 'info',
          acquired: 'info',
          released: 'info',
          rejected: 'warn',
          aborted: 'warn',
          redis_error: 'error',
        };
        recentLogStore.add(levels[type] || 'info', `message concurrency ${type}`, payload);
      },
    })
  : createMessageConcurrencyManager({
      maxConcurrent: config.maxConcurrentMessageRequests,
      maxQueued: config.maxQueuedMessageRequests,
      maxWaitMs: config.maxMessageQueueWaitMs,
      onEvent(type, payload) {
        const levels = {
          queued: 'info',
          acquired: 'info',
          released: 'info',
          rejected: 'warn',
          aborted: 'warn',
        };
        recentLogStore.add(levels[type] || 'info', `message concurrency ${type}`, payload);
      },
    });
config.proxyApiKey = proxyApiKeyManager.getApiKey();
config.stateBackend = stateBackend ? 'redis' : 'file';

function getWebPasswordSettings() {
  if (activeWebPasswordState?.passwordHash) {
    return {
      webPassword: '',
      webPasswordHash: activeWebPasswordState.passwordHash,
    };
  }

  return {
    webPassword: config.webPassword,
    webPasswordHash: config.webPasswordHash,
  };
}

function getWebPasswordVersion() {
  return activeWebPasswordState?.updatedAt || 'config';
}

function webSessionMatchesCurrentPassword(session) {
  if (!activeWebPasswordState?.passwordHash) {
    return true;
  }

  return session?.passwordUpdatedAt === getWebPasswordVersion();
}

function buildWebPasswordStatus() {
  return {
    configured: isWebLoginEnabled(),
    source: activeWebPasswordState?.passwordHash
      ? 'runtime'
      : config.webPasswordHash
        ? 'env-hash'
        : 'env-plain',
    updatedAt: activeWebPasswordState?.updatedAt || null,
  };
}

function log(event, details = {}, level = 'info') {
  recentLogStore.add(level, event, details);
  if (!config.enableRequestLogging) return;
  console.log(new Date().toISOString(), event, details);
}

if (claudeAuthStore) {
  try {
    const seedResult = await claudeAuthManager.seedStoreFromLocalIfEmpty();
    if (seedResult.seeded) {
      log('claude auth shared state seeded', {
        updatedAt: seedResult.updatedAt,
        fileCount: seedResult.fileCount,
      });
    }
  } catch (error) {
    log('claude auth shared state seed failed', { error: error.message }, 'error');
  }
}

function incrementCounter(path, key, by = 1) {
  path[key] = (path[key] || 0) + by;
}

function routeKey(req) {
  return `${req.method} ${req.url}`;
}

function requestPathname(req) {
  try {
    return new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return req.url || '/';
  }
}

function shouldAddAccessLog(req) {
  const pathname = requestPathname(req);

  // These endpoints are usually hit by probes or by the log panel itself.
  // Keeping them out prevents the UI from becoming a self-refresh log storm.
  return !['/health', '/ready', '/metrics', '/logs/recent', '/favicon.svg', '/favicon.ico'].includes(pathname);
}

function accessLogLevel(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

function recordRequest(req, res) {
  let finished = false;
  const startedAt = Date.now();
  metrics.requests.total += 1;
  incrementCounter(metrics.requests.byRoute, routeKey(req));
  res.on('finish', () => {
    finished = true;
    incrementCounter(metrics.requests.status, String(res.statusCode));

    if (shouldAddAccessLog(req)) {
      const requestId = res.getHeader('request-id');
      log('http request completed', {
        method: req.method,
        path: requestPathname(req),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        requestId: typeof requestId === 'string' ? requestId : undefined,
      }, accessLogLevel(res.statusCode));
    }
  });
  res.on('close', () => {
    if (finished) return;
    metrics.requests.aborted += 1;
    incrementCounter(metrics.requests.status, 'aborted');

    if (shouldAddAccessLog(req)) {
      log('http request aborted', {
        method: req.method,
        path: requestPathname(req),
        durationMs: Date.now() - startedAt,
      }, 'warn');
    }
  });
}

function isWebLoginEnabled() {
  const settings = getWebPasswordSettings();
  return Boolean(settings.webPassword || settings.webPasswordHash);
}

function buildProxyApiKeySettings() {
  const status = proxyApiKeyManager.getStatus();

  return {
    ...status,
    headerRequired: status.configured || !config.allowMissingApiKeyHeader,
  };
}

function buildServiceMetadata() {
  return {
    ...serviceMetadata,
    web_login_enabled: isWebLoginEnabled(),
    proxy_api_key_configured: buildProxyApiKeySettings().configured,
    logs_path: '/logs/recent',
    web_password_paths: {
      status: '/web-password',
      update: '/web-password',
    },
    state_backend: config.stateBackend,
    log_store: recentLogStore.getPublicStatus(),
    message_execution: messageConcurrencyManager.getStatus(),
    claude_auth_paths: {
      status: '/claude-auth/status',
      operation: '/claude-auth/operation',
      login: '/claude-auth/login',
      logout: '/claude-auth/logout',
    },
    claude_auth_sync: claudeAuthManager.getSharedAuthStatus(),
    proxy_api_key_paths: {
      status: '/proxy-api-key',
      update: '/proxy-api-key',
    },
    call_test_path: '/call-test',
  };
}

function getStateBackendStatus() {
  if (stateBackend) {
    return stateBackend.getStatus();
  }

  return {
    enabled: false,
    healthy: Boolean(config.allowLocalStateBackend),
    open: false,
    ready: Boolean(config.allowLocalStateBackend),
    lastError: config.allowLocalStateBackend ? null : 'Redis backend is not configured',
  };
}

async function checkStateBackendHealth() {
  if (stateBackend) {
    return stateBackend.checkHealth();
  }

  return {
    enabled: false,
    healthy: Boolean(config.allowLocalStateBackend),
    open: false,
    ready: Boolean(config.allowLocalStateBackend),
    ping: null,
    lastError: config.allowLocalStateBackend ? null : 'Redis backend is not configured',
    checkedAt: new Date().toISOString(),
  };
}

function buildHealthStatus() {
  const state = getStateBackendStatus();

  return {
    ok: true,
    ready: state.healthy,
    service: serviceMetadata.service,
    stateBackend: config.stateBackend,
    redis: config.stateBackend === 'redis' ? state : null,
    logStore: recentLogStore.getStatus(),
  };
}

async function buildReadinessStatus() {
  const state = await checkStateBackendHealth();
  const logStore = recentLogStore.getStatus();
  const messageExecution = await messageConcurrencyManager.getLiveStatus().catch((error) => ({
    ...messageConcurrencyManager.getStatus(),
    healthy: false,
    error: error.message,
  }));
  const messageExecutionHealthy = messageExecution.healthy !== false;
  const ok = Boolean(state.healthy && logStore.healthy && messageExecutionHealthy);

  return {
    ok,
    service: serviceMetadata.service,
    stateBackend: config.stateBackend,
    redis: config.stateBackend === 'redis' ? state : null,
    logStore,
    messageExecution,
    claudeAuthSync: claudeAuthManager.getSharedAuthStatus(),
  };
}

async function buildMetricsSnapshot() {
  const messageExecution = await messageConcurrencyManager.getLiveStatus().catch(() => messageConcurrencyManager.getStatus());

  return {
    ok: true,
    service: serviceMetadata.service,
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    shuttingDown: isShuttingDown,
    requests: metrics.requests,
    messages: metrics.messages,
    claudeCli: metrics.claudeCli,
    proxyApiKey: {
      ...metrics.proxyApiKey,
      status: buildProxyApiKeySettings(),
    },
    shutdowns: metrics.shutdowns,
    stateBackend: config.stateBackend,
    redis: config.stateBackend === 'redis' ? stateBackend.getStatus() : null,
    logStore: recentLogStore.getStatus(),
    messageExecution,
    claudeAuthSync: claudeAuthManager.getSharedAuthStatus(),
  };
}

function parseAcceptHeader(headerValue) {
  return String(headerValue || '')
    .split(',')
    .map((entry, index) => {
      const [rawType, ...rawParams] = entry.split(';').map((part) => part.trim());
      if (!rawType) return null;

      const qParam = rawParams.find((param) => param.startsWith('q='));
      const qValue = qParam ? Number.parseFloat(qParam.slice(2)) : 1;

      return {
        type: rawType.toLowerCase(),
        q: Number.isFinite(qValue) ? qValue : 1,
        index,
      };
    })
    .filter((entry) => entry && entry.q > 0);
}

function matchAccept(entry, mimeType) {
  const [candidateType, candidateSubtype] = mimeType.toLowerCase().split('/');
  const [entryType, entrySubtype] = entry.type.split('/');

  if (entryType === '*' && entrySubtype === '*') return 0;
  if (entryType === candidateType && entrySubtype === '*') return 1;
  if (entryType === candidateType && entrySubtype === candidateSubtype) return 2;
  return -1;
}

function preferredContentType(req, supportedTypes) {
  const accepted = parseAcceptHeader(req.headers.accept);
  if (!accepted.length) return supportedTypes[0];

  let best = null;

  for (const supportedType of supportedTypes) {
    for (const entry of accepted) {
      const specificity = matchAccept(entry, supportedType);
      if (specificity === -1) continue;

      const candidate = {
        supportedType,
        q: entry.q,
        specificity,
        index: entry.index,
      };

      if (
        !best ||
        candidate.q > best.q ||
        (candidate.q === best.q && candidate.specificity > best.specificity) ||
        (candidate.q === best.q && candidate.specificity === best.specificity && candidate.index < best.index)
      ) {
        best = candidate;
      }
    }
  }

  return best?.supportedType || supportedTypes[0];
}

function prefersHtml(req) {
  return preferredContentType(req, ['application/json', 'text/html']) === 'text/html';
}

function requestIsSecure(req) {
  if (req.socket?.encrypted) return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim().toLowerCase();
  return forwardedProto === 'https';
}

function html(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': payload.length,
    ...extraHeaders,
  });
  res.end(payload);
}

function svg(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'public, max-age=86400',
    ...extraHeaders,
  });
  res.end(payload);
}

function binary(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': 'public, max-age=86400',
    ...extraHeaders,
  });
  res.end(body);
}

function jsonError(res, status, message, extra = {}) {
  json(res, status, {
    ok: false,
    error: message,
    ...extra,
  });
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(303, {
    location,
    ...extraHeaders,
  });
  res.end();
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) return cookies;

      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getWebLoginKey(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwardedFor || req.socket?.remoteAddress || 'unknown';
}

function getWebLoginStorageKey(req) {
  return crypto.createHash('sha256').update(getWebLoginKey(req)).digest('hex');
}

async function getWebSession(req) {
  const token = parseCookies(req)[WEB_SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = await webAuthStateStore.getSession(token);
  if (!session) return null;
  if (!webSessionMatchesCurrentPassword(session)) {
    await webAuthStateStore.deleteSession(token);
    return null;
  }

  return {
    token,
    ...session,
  };
}

async function createWebSession() {
  const maxAgeSeconds = config.webSessionTtlHours * 60 * 60;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + maxAgeSeconds * 1000;

  await webAuthStateStore.createSession({
    token,
    expiresAt,
    passwordUpdatedAt: getWebPasswordVersion(),
    ttlMs: maxAgeSeconds * 1000,
  });

  return {
    token,
    maxAgeSeconds,
  };
}

async function getActiveWebLoginAttempt(req, now = Date.now()) {
  if (config.webLoginMaxAttempts <= 0) {
    return null;
  }

  const key = getWebLoginStorageKey(req);
  const entry = await webAuthStateStore.getLoginAttempt(key);

  if (!entry) return null;
  if (entry.blockedUntil > now) return { key, ...entry };

  const windowMs = config.webLoginWindowMinutes * 60 * 1000;
  if (now - entry.windowStartedAt >= windowMs) {
    await webAuthStateStore.clearLoginAttempt(key);
    return null;
  }

  return { key, ...entry };
}

async function clearWebLoginAttempts(req) {
  if (config.webLoginMaxAttempts <= 0) {
    return;
  }

  await webAuthStateStore.clearLoginAttempt(getWebLoginStorageKey(req));
}

async function registerFailedWebLogin(req, now = Date.now()) {
  if (config.webLoginMaxAttempts <= 0) {
    return null;
  }

  const key = getWebLoginStorageKey(req);
  const windowMs = config.webLoginWindowMinutes * 60 * 1000;
  const current = await webAuthStateStore.getLoginAttempt(key);
  const expired = current && current.blockedUntil <= now && now - current.windowStartedAt >= windowMs;
  const entry = !current || expired ? { count: 0, windowStartedAt: now, blockedUntil: 0 } : current;

  entry.count += 1;

  if (entry.count >= config.webLoginMaxAttempts) {
    entry.blockedUntil = now + windowMs;
  }

  const expiresAt = entry.blockedUntil > now ? entry.blockedUntil : entry.windowStartedAt + windowMs;
  const ttlMs = Math.max(1_000, expiresAt - now);
  await webAuthStateStore.setLoginAttempt(key, entry, ttlMs);
  return { key, ...entry };
}

function describeWebLoginBlockSeconds(entry, now = Date.now()) {
  if (!entry?.blockedUntil || entry.blockedUntil <= now) {
    return 0;
  }

  return Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
}

function serializeCookie(name, value, { maxAgeSeconds, expires, secure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];

  if (typeof maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }

  if (expires instanceof Date) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

async function readFormBody(req, limitBytes = 16 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error(`Request exceeds the maximum allowed size of ${limitBytes} bytes`);
    }
    chunks.push(chunk);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function hasDocsAccess(req) {
  if (!isWebLoginEnabled()) {
    return true;
  }

  return Boolean(await getWebSession(req));
}

async function ensureDocsAccess(req, res, { requireWebLogin = false } = {}) {
  if (requireWebLogin && !isWebLoginEnabled()) {
    jsonError(res, 403, 'Set WEB_PASSWORD or WEB_PASSWORD_HASH to enable web Claude auth actions.');
    return false;
  }

  try {
    if (await hasDocsAccess(req)) {
      return true;
    }
  } catch (error) {
    log('docs auth state failed', { error: error.message }, 'error');
    jsonError(res, 503, 'Docs auth state is temporarily unavailable.');
    return false;
  }

  jsonError(res, 401, 'Web docs login is required.');
  return false;
}

function renderDocsStateUnavailable(res, message) {
  html(
    res,
    503,
    renderLoginPage({
      errorMessage: message,
      loginPath: '/login',
    }),
    {
      'cache-control': 'no-store',
      vary: 'Cookie',
    },
  );
}

async function handleWebLogin(req, res) {
  if (!isWebLoginEnabled()) {
    redirect(res, '/docs', {
      'cache-control': 'no-store',
    });
    return;
  }

  const blockedAttempt = await getActiveWebLoginAttempt(req);
  if (blockedAttempt?.blockedUntil > Date.now()) {
    const waitSeconds = describeWebLoginBlockSeconds(blockedAttempt);
    log('docs login blocked', { client: getWebLoginKey(req), waitSeconds }, 'warn');
    html(
      res,
      429,
      renderLoginPage({
        errorMessage: `로그인 시도가 너무 많습니다. ${waitSeconds}초 후 다시 시도하세요.`,
        loginPath: '/login',
      }),
      {
        'cache-control': 'no-store',
        vary: 'Cookie',
      },
    );
    return;
  }

  try {
    const form = await readFormBody(req);
    const password = String(form.get('password') ?? '');

    if (!verifyWebPassword(password, getWebPasswordSettings())) {
      const failedAttempt = await registerFailedWebLogin(req);
      const waitSeconds = describeWebLoginBlockSeconds(failedAttempt);
      log('docs login failed', { client: getWebLoginKey(req), waitSeconds }, 'warn');

      html(
        res,
        waitSeconds ? 429 : 401,
        renderLoginPage({
          errorMessage: waitSeconds
            ? `로그인 시도가 너무 많습니다. ${waitSeconds}초 후 다시 시도하세요.`
            : '비밀번호가 올바르지 않습니다.',
          loginPath: '/login',
        }),
        {
          'cache-control': 'no-store',
          vary: 'Cookie',
        },
      );
      return;
    }

    await clearWebLoginAttempts(req);
    const session = await createWebSession();
    log('docs login succeeded', { client: getWebLoginKey(req) });
    redirect(res, '/docs', {
      'cache-control': 'no-store',
      'set-cookie': serializeCookie(WEB_SESSION_COOKIE_NAME, session.token, {
        maxAgeSeconds: session.maxAgeSeconds,
        secure: requestIsSecure(req),
      }),
    });
  } catch (error) {
    log('docs login error', { client: getWebLoginKey(req), error: error.message }, 'error');
    html(
      res,
      400,
      renderLoginPage({
        errorMessage: error.message || '로그인 요청을 처리하지 못했습니다.',
        loginPath: '/login',
      }),
      {
        'cache-control': 'no-store',
        vary: 'Cookie',
      },
    );
  }
}

async function handleWebLogout(req, res) {
  try {
    const session = await getWebSession(req);
    if (session) {
      await webAuthStateStore.deleteSession(session.token);
    }
    log('docs logout', { hadSession: Boolean(session) });

    redirect(res, '/docs', {
      'cache-control': 'no-store',
      'set-cookie': serializeCookie(WEB_SESSION_COOKIE_NAME, '', {
        maxAgeSeconds: 0,
        expires: new Date(0),
        secure: requestIsSecure(req),
      }),
    });
  } catch (error) {
    log('docs logout failed', { error: error.message }, 'error');
    renderDocsStateUnavailable(res, '로그아웃 중 세션 저장소를 읽지 못했습니다. 잠시 후 다시 시도하세요.');
  }
}

async function handleWebPasswordStatus(req, res) {
  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  json(res, 200, {
    ok: true,
    status: buildWebPasswordStatus(),
  }, {
    'cache-control': 'no-store',
  });
}

async function handleWebPasswordUpdate(req, res) {
  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  try {
    const session = await getWebSession(req);
    const body = await readJsonBody(req, 16 * 1024);
    const currentPassword = String(body?.currentPassword || '');
    const newPassword = validateNewWebPassword(body?.newPassword);
    const currentSettings = getWebPasswordSettings();

    if (!verifyWebPassword(currentPassword, currentSettings)) {
      log('docs password change rejected', { client: getWebLoginKey(req), reason: 'current-password' }, 'warn');
      jsonError(res, 401, 'Current password is incorrect.');
      return;
    }

    if (verifyWebPassword(newPassword, currentSettings)) {
      jsonError(res, 400, 'New password must be different.');
      return;
    }

    const updatedAt = new Date().toISOString();
    const nextState = {
      passwordHash: createScryptPasswordHash(newPassword),
      updatedAt,
    };
    await webAuthStateStore.setPasswordState(nextState);
    activeWebPasswordState = nextState;

    if (session) {
      await webAuthStateStore.deleteSession(session.token);
    }

    json(res, 200, {
      ok: true,
      status: buildWebPasswordStatus(),
      reauthRequired: true,
    }, {
      'cache-control': 'no-store',
      'set-cookie': serializeCookie(WEB_SESSION_COOKIE_NAME, '', {
        maxAgeSeconds: 0,
        expires: new Date(0),
        secure: requestIsSecure(req),
      }),
    });
    log('docs password changed', { client: getWebLoginKey(req), updatedAt }, 'warn');
  } catch (error) {
    log('docs password change failed', { client: getWebLoginKey(req), error: error.message }, 'error');
    jsonError(res, error.statusCode || 400, error.message || 'Failed to update web password.');
  }
}

async function handleClaudeAuthStatus(req, res) {
  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  try {
    const status = await claudeAuthManager.getStatus();
    json(res, 200, {
      ok: true,
      status,
    });
  } catch (error) {
    log('claude auth status failed', { error: error.message }, 'error');
    jsonError(res, 500, error.message || 'Failed to read Claude auth status.');
  }
}

function handleClaudeAuthOperation(req, res) {
  if (!isWebLoginEnabled()) {
    jsonError(res, 403, 'Set WEB_PASSWORD or WEB_PASSWORD_HASH to enable web Claude auth actions.');
    return;
  }

  void getWebSession(req).then((session) => {
    if (!session) {
      jsonError(res, 401, 'Web docs login is required.');
      return;
    }

    json(res, 200, {
      ok: true,
      operation: claudeAuthManager.getOperation(),
    });
  });
}

async function handleClaudeAuthLogin(req, res) {
  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  try {
    const body = await readJsonBody(req, 16 * 1024);
    const provider = body?.provider === 'console' ? 'console' : 'claudeai';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const sso = Boolean(body?.sso);

    const operation = claudeAuthManager.startLogin({
      provider,
      email,
      sso,
    });

    json(res, 202, {
      ok: true,
      operation,
    });
    log('claude auth login started', { provider, email: email || null, sso });
  } catch (error) {
    log('claude auth login failed', { error: error.message }, 'error');
    jsonError(res, error.statusCode || 400, error.message || 'Failed to start Claude login.', {
      operation: error.operation || claudeAuthManager.getOperation(),
    });
  }
}

function handleClaudeAuthLogout(req, res) {
  void (async () => {
    if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
      return;
    }

    try {
      const operation = claudeAuthManager.startLogout();
      json(res, 202, {
        ok: true,
        operation,
      });
      log('claude auth logout started');
    } catch (error) {
      log('claude auth logout failed', { error: error.message }, 'error');
      jsonError(res, error.statusCode || 400, error.message || 'Failed to start Claude logout.', {
        operation: error.operation || claudeAuthManager.getOperation(),
      });
    }
  })();
}

function handleProxyApiKeyStatus(req, res) {
  void (async () => {
    if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
      return;
    }

    json(res, 200, {
      ok: true,
      settings: buildProxyApiKeySettings(),
      apiKey: proxyApiKeyManager.getApiKey() || null,
    }, {
      'cache-control': 'no-store',
    });
  })();
}

async function handleProxyApiKeyUpdate(req, res) {
  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  try {
    const body = await readJsonBody(req, 16 * 1024);
    const next = await (body?.reset || body?.generate
      ? proxyApiKeyManager.generateNewApiKey()
      : proxyApiKeyManager.setApiKey(body?.apiKey));

    config.proxyApiKey = next.apiKey;
    metrics.proxyApiKey.rotations += 1;

    json(res, 200, {
      ok: true,
      settings: buildProxyApiKeySettings(),
      apiKey: next.apiKey,
    }, {
      'cache-control': 'no-store',
    });
    log('proxy api key updated', {
      configured: true,
      updatedAt: next.updatedAt,
      reset: Boolean(body?.reset || body?.generate),
    });
  } catch (error) {
    log('proxy api key update failed', { error: error.message }, 'error');
    jsonError(res, error.statusCode || 500, error.message || 'Failed to update x-api-key.');
  }
}

async function handleRecentLogs(req, res) {
  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  const messageExecution = await messageConcurrencyManager.getLiveStatus();
  json(res, 200, {
    ok: true,
    entries: recentLogStore.list(),
    logStore: recentLogStore.getStatus(),
    stateBackend: config.stateBackend,
    messageExecution,
  }, {
    'cache-control': 'no-store',
  });
}

async function handleRecentLogsClear(req, res) {
  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  const removedCount = recentLogStore.getStatus().entryCount;
  recentLogStore.clear();
  log('recent logs cleared', { removedCount }, 'warn');
  await recentLogStore.flush();
  const messageExecution = await messageConcurrencyManager.getLiveStatus();

  json(res, 200, {
    ok: true,
    removedCount,
    entries: recentLogStore.list(),
    logStore: recentLogStore.getStatus(),
    stateBackend: config.stateBackend,
    messageExecution,
  }, {
    'cache-control': 'no-store',
  });
}

function getLoopbackBaseUrl() {
  const address = server.listening ? server.address() : null;
  const port = address && typeof address === 'object' && address.port
    ? address.port
    : config.port;

  return `http://127.0.0.1:${port}`;
}

function normalizeCallTestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProxyError(400, 'invalid_request_error', 'Request body must be a JSON object');
  }

  const model = typeof body.model === 'string' && body.model.trim()
    ? body.model.trim()
    : CALL_TEST_DEFAULT_MODEL;
  const prompt = typeof body.prompt === 'string' && body.prompt.trim()
    ? body.prompt.trim()
    : CALL_TEST_DEFAULT_PROMPT;
  const rawMaxTokens = body.max_tokens ?? body.maxTokens ?? 32;
  const maxTokens = typeof rawMaxTokens === 'string' && rawMaxTokens.trim()
    ? Number(rawMaxTokens)
    : rawMaxTokens;

  if (!model) {
    throw new ProxyError(400, 'invalid_request_error', 'model is required');
  }

  if (!prompt) {
    throw new ProxyError(400, 'invalid_request_error', 'prompt is required');
  }

  if (prompt.length > 2_000) {
    throw new ProxyError(400, 'invalid_request_error', 'prompt must be 2000 characters or fewer');
  }

  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) {
    throw new ProxyError(400, 'invalid_request_error', 'max_tokens must be an integer between 1 and 1024');
  }

  return {
    model,
    prompt,
    maxTokens,
  };
}

function parseCallTestResponseBody(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text.slice(0, 2_000),
      truncated: text.length > 2_000,
    };
  }
}

function previewPrompt(prompt) {
  return prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
}

async function handleCallTest(req, res) {
  const requestId = createRequestId();

  if (!(await ensureDocsAccess(req, res, { requireWebLogin: true }))) {
    return;
  }

  try {
    const body = await readJsonBody(req, 16 * 1024);
    const { model, prompt, maxTokens } = normalizeCallTestBody(body);
    const apiKey = proxyApiKeyManager.getApiKey();

    if (!apiKey && !config.allowMissingApiKeyHeader) {
      log('call test rejected', { requestId, reason: 'missing-proxy-api-key' }, 'warn');
      jsonError(
        res,
        503,
        'x-api-key is not configured yet. Save a proxy key before running the call test.',
      );
      return;
    }

    const headers = {
      'content-type': 'application/json',
      'anthropic-version': config.defaultAnthropicVersion,
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const started = Date.now();
    const proxyResponse = await fetch(`${getLoopbackBaseUrl()}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });
    const responseText = await proxyResponse.text();
    const elapsedMs = Date.now() - started;
    const proxyRequestId = proxyResponse.headers.get('request-id') || null;
    const ok = proxyResponse.ok;

    json(res, 200, {
      ok,
      proxyStatus: proxyResponse.status,
      elapsedMs,
      requestId,
      proxyRequestId,
      request: {
        model,
        max_tokens: maxTokens,
        promptPreview: previewPrompt(prompt),
      },
      response: parseCallTestResponseBody(responseText),
    }, {
      'cache-control': 'no-store',
      'request-id': requestId,
    });

    log('call test completed', {
      requestId,
      proxyRequestId,
      ok,
      proxyStatus: proxyResponse.status,
      elapsedMs,
      model,
      max_tokens: maxTokens,
      promptChars: prompt.length,
    }, ok ? 'info' : 'warn');
  } catch (error) {
    const status = error instanceof ProxyError ? error.status : 500;
    log('call test failed', { requestId, error: error.message }, status < 500 ? 'warn' : 'error');
    jsonError(res, status, error.message || 'Call test failed.');
  }
}

async function syncClaudeAuthForProxyRequest(requestId) {
  try {
    const result = await claudeAuthManager.syncFromStore();
    if (result.applied) {
      log('claude auth synced from shared state', {
        requestId,
        updatedAt: result.updatedAt,
        fileCount: result.fileCount,
      });
    }
  } catch (error) {
    log('claude auth shared state sync failed', { requestId, error: error.message }, 'error');
    throw new ProxyError(503, 'api_error', 'Claude auth state sync failed. Retry shortly.');
  }
}

function applyProxyAuth(req, requestId, { requireAnthropicVersion = config.requireAnthropicVersion } = {}) {
  const apiKey = req.headers['x-api-key'];
  const anthropicVersion = req.headers['anthropic-version'];
  const configuredProxyApiKey = proxyApiKeyManager.getApiKey();

  if (requireAnthropicVersion && !anthropicVersion) {
    throw new ProxyError(400, 'invalid_request_error', 'anthropic-version header is required');
  }

  if (!configuredProxyApiKey && !config.allowMissingApiKeyHeader) {
    throw new ProxyError(
      503,
      'api_error',
      'x-api-key is not configured yet. Sign in to /docs and set it before using the proxy API.',
    );
  }

  if (!config.allowMissingApiKeyHeader && !apiKey) {
    metrics.messages.authFailed += 1;
    throw new ProxyError(401, 'authentication_error', 'x-api-key header is required');
  }

  if (configuredProxyApiKey && !apiKey) {
    metrics.messages.authFailed += 1;
    throw new ProxyError(401, 'authentication_error', 'x-api-key header is required');
  }

  const apiKeyVerification = configuredProxyApiKey
    ? proxyApiKeyManager.verifyApiKey(apiKey)
    : { valid: true, matched: null, expiresAt: null };

  if (configuredProxyApiKey && !apiKeyVerification.valid) {
    metrics.messages.authFailed += 1;
    throw new ProxyError(401, 'authentication_error', 'Invalid API key');
  }

  if (apiKeyVerification.matched === 'previous') {
    metrics.proxyApiKey.previousKeyMatches += 1;
    log('proxy api key matched previous key during grace period', {
      requestId,
      expiresAt: apiKeyVerification.expiresAt,
    }, 'warn');
  }

  return {
    requestId,
    anthropicVersion: anthropicVersion || config.defaultAnthropicVersion,
    apiKeyMatched: apiKeyVerification.matched,
  };
}

function sendModels(res, requestId) {
  json(res, 200, {
    data: [
      {
        id: 'sonnet',
        type: 'model',
        display_name: 'Claude CLI Sonnet Alias',
      },
      {
        id: 'opus',
        type: 'model',
        display_name: 'Claude CLI Opus Alias',
      },
      {
        id: 'haiku',
        type: 'model',
        display_name: 'Claude CLI Haiku Alias',
      },
    ],
    has_more: false,
    first_id: 'sonnet',
    last_id: 'haiku',
  }, {
    'request-id': requestId,
  });
}

function handleModels(req, res) {
  const requestId = createRequestId();

  try {
    applyProxyAuth(req, requestId, { requireAnthropicVersion: false });
    sendModels(res, requestId);
  } catch (error) {
    sendProxyError(res, error, requestId);
    log('models request failed', { requestId, error: error.message }, 'warn');
  }
}

async function handleMessages(req, res) {
  const requestId = createRequestId();
  const abortController = new AbortController();
  let releaseExecutionSlot = null;
  let cliStarted = false;
  let streamCleanupDeferred = false;
  const abortOnResponseClose = () => {
    if (!res.writableEnded) {
      abortController.abort(new Error('Client disconnected before response completed'));
    }
  };
  res.on('close', abortOnResponseClose);
  activeMessageControllers.add(abortController);
  metrics.messages.total += 1;

  function finishMessageController() {
    res.off('close', abortOnResponseClose);
    activeMessageControllers.delete(abortController);
  }

  try {
    applyProxyAuth(req, requestId);
    const body = await readJsonBody(req, config.requestBodyLimitBytes);
    validateMessagesRequest(body);
    await syncClaudeAuthForProxyRequest(requestId);

    const prompt = buildClaudePrompt(body.messages);
    const systemPrompt = normalizeSystemPrompt(body.system);
    const mappedModel = resolveCliModel(body.model, config);
    const stopSequences = body.stop_sequences || [];
    const responseMessageId = createMessageId();

    log('messages request', { requestId, model: body.model, mappedModel, stream: Boolean(body.stream) });
    const slot = await messageConcurrencyManager.acquire({
      requestId,
      signal: abortController.signal,
    });
    releaseExecutionSlot = slot.release;
    log('messages execution started', {
      requestId,
      model: body.model,
      stream: Boolean(body.stream),
      waited_ms: slot.waitedMs,
      ...messageConcurrencyManager.getStatus(),
    });

    if (body.stream) {
      res.writeHead(200, sseHeaders(requestId));

      const startedAt = Date.now();
      let streamedText = '';

      writeSseEvent(res, 'message_start', {
        type: 'message_start',
        message: {
          id: responseMessageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: body.model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      });

      writeSseEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: '',
        },
      });

      runClaudeStream({
        claudeBin: config.claudeBin,
        model: mappedModel,
        systemPrompt,
        prompt,
        extraArgs: config.claudeExtraArgs,
        stopSequences,
        signal: abortController.signal,
        timeoutMs: config.claudeRequestTimeoutMs,
        idleTimeoutMs: config.claudeStreamIdleTimeoutMs,
        onText(delta) {
          streamedText += delta;
          writeSseEvent(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'text_delta',
              text: delta,
            },
          });
        },
        onDone(result) {
          finishMessageController();
          if (res.destroyed) {
            releaseExecutionSlot?.();
            releaseExecutionSlot = null;
            metrics.messages.aborted += 1;
            log('messages request aborted', {
              requestId,
              phase: 'stream',
              reason: 'client_disconnected',
            }, 'warn');
            return;
          }

          writeSseEvent(res, 'content_block_stop', {
            type: 'content_block_stop',
            index: 0,
          });

          writeSseEvent(res, 'message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: result.stopReason,
              stop_sequence: result.stopSequence,
            },
            usage: {
              output_tokens: result.usage.output_tokens,
              input_tokens: result.usage.input_tokens,
              cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
              cache_read_input_tokens: result.usage.cache_read_input_tokens,
            },
          });

          writeSseEvent(res, 'message_stop', {
            type: 'message_stop',
          });

          res.end();
          releaseExecutionSlot?.();
          releaseExecutionSlot = null;
          metrics.claudeCli.streamCompleted += 1;
          metrics.messages.streamCompleted += 1;
          log('messages stream completed', {
            requestId,
            elapsed_ms: Date.now() - startedAt,
            chars: streamedText.length,
          });
        },
        onError(error) {
          finishMessageController();
          releaseExecutionSlot?.();
          releaseExecutionSlot = null;
          if (error?.code === 'CLAUDE_CLI_TIMEOUT') {
            metrics.claudeCli.timeout += 1;
          } else {
            metrics.claudeCli.failed += 1;
          }
          metrics.messages.failed += 1;
          if (res.destroyed) {
            metrics.messages.aborted += 1;
            log('messages request aborted', {
              requestId,
              phase: 'stream',
              reason: 'client_disconnected',
              error: error.message,
            }, 'warn');
            return;
          }
          if (res.writableEnded) return;
          writeSseEvent(res, 'error', {
            type: 'error',
            error: {
              type: error.type || 'api_error',
              message: error.message,
            },
          });
          res.end();
          log('messages stream failed', { requestId, error: error.message });
        },
      });
      streamCleanupDeferred = true;
      cliStarted = true;
      metrics.claudeCli.streamStarted += 1;

      return;
    }

    cliStarted = true;
    metrics.claudeCli.jsonStarted += 1;
    const cliResult = await runClaudeJson({
      claudeBin: config.claudeBin,
      model: mappedModel,
      systemPrompt,
      prompt,
      extraArgs: config.claudeExtraArgs,
      signal: abortController.signal,
      timeoutMs: config.claudeRequestTimeoutMs,
    });
    metrics.claudeCli.jsonCompleted += 1;

    const truncated = truncateByStopSequences(cliResult.text, stopSequences);
    const responseBody = makeAnthropicMessageResponse({
      id: responseMessageId,
      model: body.model,
      text: truncated.text,
      usage: cliResult.usage,
      stopReason: truncated.stopReason,
      stopSequence: truncated.stopSequence,
    });

    json(res, 200, responseBody, {
      'request-id': requestId,
    });
    releaseExecutionSlot?.();
    releaseExecutionSlot = null;
    metrics.messages.jsonCompleted += 1;

    log('messages request completed', {
      requestId,
      chars: truncated.text.length,
      input_tokens: cliResult.usage.input_tokens,
      output_tokens: cliResult.usage.output_tokens,
    });
  } catch (error) {
    releaseExecutionSlot?.();
    releaseExecutionSlot = null;
    if (cliStarted) {
      if (error?.code === 'CLAUDE_CLI_TIMEOUT') {
        metrics.claudeCli.timeout += 1;
      } else if (error?.name || error?.message) {
        metrics.claudeCli.failed += 1;
      }
    }
    metrics.messages.failed += 1;
    if (!(error instanceof ProxyError) && res.destroyed) {
      metrics.messages.aborted += 1;
      log('messages request aborted', { requestId, error: error.message }, 'warn');
      return;
    }
    sendProxyError(res, error, requestId);
    log(
      'messages request failed',
      { requestId, error: error.message },
      error instanceof ProxyError && error.status < 500 ? 'warn' : 'error',
    );
  } finally {
    if (!streamCleanupDeferred) {
      finishMessageController();
    }
  }
}

function requestHandler(req, res) {
  recordRequest(req, res);

  if (req.method === 'GET' && req.url === '/favicon.svg') {
    svg(res, 200, faviconSvg);
    return;
  }

  if (req.method === 'GET' && req.url === '/favicon.ico') {
    binary(res, 200, faviconIco, 'image/x-icon');
    return;
  }

  if (isShuttingDown && req.url !== '/health') {
    json(res, 503, {
      ok: false,
      error: 'Server is shutting down',
    }, {
      'cache-control': 'no-store',
      connection: 'close',
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    const metadata = buildServiceMetadata();

    if (prefersHtml(req)) {
      redirect(res, '/docs', {
        vary: 'Accept',
        'cache-control': 'no-store',
      });
      return;
    }

    json(res, 200, metadata, {
      vary: 'Accept',
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/docs') {
    void (async () => {
      try {
        const session = await getWebSession(req);
        if (isWebLoginEnabled() && !session) {
          html(res, 200, renderLoginPage({ loginPath: '/login' }), {
            vary: 'Cookie',
            'cache-control': 'no-store',
          });
          return;
        }

        html(res, 200, renderHomePage(config), {
          vary: 'Cookie',
          'cache-control': 'no-store',
        });
      } catch (error) {
        log('docs page session check failed', { error: error.message }, 'error');
        renderDocsStateUnavailable(res, '로그인 세션 저장소를 읽지 못했습니다. 잠시 후 다시 시도하세요.');
      }
    })();
    return;
  }

  if (req.method === 'GET' && req.url === '/login') {
    void (async () => {
      try {
        const session = await getWebSession(req);
        if (!isWebLoginEnabled() || session) {
          redirect(res, '/docs', {
            'cache-control': 'no-store',
          });
          return;
        }

        html(res, 200, renderLoginPage({ loginPath: '/login' }), {
          vary: 'Cookie',
          'cache-control': 'no-store',
        });
      } catch (error) {
        log('login page session check failed', { error: error.message }, 'error');
        renderDocsStateUnavailable(res, '로그인 세션 저장소를 읽지 못했습니다. 잠시 후 다시 시도하세요.');
      }
    })();
    return;
  }

  if (req.method === 'POST' && req.url === '/login') {
    void handleWebLogin(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/logout') {
    void handleWebLogout(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/web-password') {
    void handleWebPasswordStatus(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/web-password') {
    void handleWebPasswordUpdate(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/api-info') {
    json(res, 200, buildServiceMetadata());
    return;
  }

  if (req.method === 'GET' && req.url === '/claude-auth/status') {
    void handleClaudeAuthStatus(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/claude-auth/operation') {
    handleClaudeAuthOperation(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/claude-auth/login') {
    void handleClaudeAuthLogin(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/claude-auth/logout') {
    handleClaudeAuthLogout(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/proxy-api-key') {
    handleProxyApiKeyStatus(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/proxy-api-key') {
    void handleProxyApiKeyUpdate(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/logs/recent') {
    void handleRecentLogs(req, res);
    return;
  }

  if (req.method === 'DELETE' && req.url === '/logs/recent') {
    void handleRecentLogsClear(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/call-test') {
    void handleCallTest(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/metrics') {
    void (async () => {
      try {
        json(res, 200, await buildMetricsSnapshot(), {
          'cache-control': 'no-store',
        });
      } catch (error) {
        json(res, 500, {
          ok: false,
          error: error.message,
        }, {
          'cache-control': 'no-store',
        });
      }
    })();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, buildHealthStatus(), {
      'cache-control': 'no-store',
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/ready') {
    void (async () => {
      try {
        const status = await buildReadinessStatus();
        json(res, status.ok ? 200 : 503, status, {
          'cache-control': 'no-store',
        });
      } catch (error) {
        json(res, 503, {
          ok: false,
          service: serviceMetadata.service,
          stateBackend: config.stateBackend,
          error: error.message,
        }, {
          'cache-control': 'no-store',
        });
      }
    })();
    return;
  }

  if (req.method === 'GET' && req.url === '/v1/models') {
    handleModels(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/messages') {
    void handleMessages(req, res);
    return;
  }

  const requestId = createRequestId();
  sendAnthropicError(res, 404, 'not_found_error', `Route not found: ${req.method} ${req.url}`, requestId);
}

const server = http.createServer(requestHandler);
server.on('listening', () => {
  isShuttingDown = false;
});

function startServer() {
  isShuttingDown = false;
  log('server started', {
    host: config.host,
    port: config.port,
    stateBackend: config.stateBackend,
    messageExecution: messageConcurrencyManager.getStatus(),
  });
  server.listen(config.port, config.host, () => {
    console.log(`claude-anthropic-proxy listening on http://${config.host}:${config.port}`);
  });
}

function closeServer() {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections?.();
  });
}

async function shutdown(reason = 'manual', { exit = false } = {}) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  isShuttingDown = true;
  metrics.shutdowns.started += 1;
  log('server shutdown started', {
    reason,
    activeMessages: activeMessageControllers.size,
  }, 'warn');

  const forceTimer = setTimeout(() => {
    metrics.shutdowns.forced += 1;
    log('server shutdown force timeout', {
      reason,
      activeMessages: activeMessageControllers.size,
    }, 'error');
    for (const controller of [...activeMessageControllers]) {
      controller.abort(new Error(`Server shutdown force timeout: ${reason}`));
    }
    server.closeAllConnections?.();
    if (exit) {
      process.exit(1);
    }
  }, config.shutdownGraceMs);
  forceTimer.unref?.();

  shutdownPromise = (async () => {
    for (const controller of [...activeMessageControllers]) {
      controller.abort(new Error(`Server shutdown: ${reason}`));
    }
    messageConcurrencyManager.clearQueue();
    await closeServer();
    metrics.shutdowns.completed += 1;
    log('server shutdown completed', { reason }, 'warn');
    await recentLogStore.flush();
    await stateBackend?.close();
    clearTimeout(forceTimer);
    if (exit) {
      process.exit(0);
    }
  })().catch(async (error) => {
    clearTimeout(forceTimer);
    log('server shutdown failed', { reason, error: error.message }, 'error');
    await recentLogStore.flush();
    if (exit) {
      process.exit(1);
    }
    throw error;
  }).finally(() => {
    shutdownPromise = null;
  });

  return shutdownPromise;
}

async function resetWebPasswordForTests() {
  activeWebPasswordState = null;
  webSessions.clear();
  webLoginAttempts.clear();
  await webAuthStateStore.clearPasswordState?.();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM', { exit: true });
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT', { exit: true });
  });
}

export {
  config,
  messageConcurrencyManager,
  proxyApiKeyManager,
  recentLogFileStore,
  proxyStateFileStore,
  recentLogStore,
  server,
  requestHandler,
  startServer,
  shutdown,
  resetWebPasswordForTests,
};
