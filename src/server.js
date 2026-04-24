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
import { createRecentLogStore } from './recent-log-store.js';
import { runClaudeJson, runClaudeStream } from './claude-cli.js';
import { verifyWebPassword } from './web-auth.js';
import { renderHomePage, renderLoginPage, serviceMetadata } from './web.js';

const config = loadConfig();
const WEB_SESSION_COOKIE_NAME = 'claude_proxy_web_session';
const webSessions = new Map();
const webLoginAttempts = new Map();
const claudeAuthManager = createClaudeAuthManager({ claudeBin: config.claudeBin });
const proxyStateFileStore = createProxyStateFileStore({ filePath: config.proxyStateFile });
const recentLogFileStore = createRecentLogFileStore({ filePath: config.recentLogFile });
const recentLogStore = createRecentLogStore({
  limit: config.recentLogLimit,
  storage: recentLogFileStore,
});
const proxyApiKeyManager = createProxyApiKeyManager({
  initialApiKey: config.proxyApiKey,
  storage: proxyStateFileStore,
});
const messageConcurrencyManager = createMessageConcurrencyManager({
  maxConcurrent: config.maxConcurrentMessageRequests,
  maxQueued: config.maxQueuedMessageRequests,
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

function log(event, details = {}, level = 'info') {
  recentLogStore.add(level, event, details);
  if (!config.enableRequestLogging) return;
  console.log(new Date().toISOString(), event, details);
}

function isWebLoginEnabled() {
  return Boolean(config.webPassword || config.webPasswordHash);
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
    log_store: recentLogStore.getStatus(),
    message_execution: messageConcurrencyManager.getStatus(),
    claude_auth_paths: {
      status: '/claude-auth/status',
      operation: '/claude-auth/operation',
      login: '/claude-auth/login',
      logout: '/claude-auth/logout',
    },
    proxy_api_key_paths: {
      status: '/proxy-api-key',
      update: '/proxy-api-key',
    },
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

function cleanupExpiredWebSessions(now = Date.now()) {
  for (const [token, session] of webSessions.entries()) {
    if (session.expiresAt <= now) {
      webSessions.delete(token);
    }
  }
}

function getWebSession(req) {
  cleanupExpiredWebSessions();

  const token = parseCookies(req)[WEB_SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = webSessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    webSessions.delete(token);
    return null;
  }

  return {
    token,
    ...session,
  };
}

function createWebSession() {
  cleanupExpiredWebSessions();

  const maxAgeSeconds = config.webSessionTtlHours * 60 * 60;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + maxAgeSeconds * 1000;

  webSessions.set(token, { expiresAt });

  return {
    token,
    maxAgeSeconds,
  };
}

function cleanupExpiredWebLoginAttempts(now = Date.now()) {
  const windowMs = config.webLoginWindowMinutes * 60 * 1000;

  for (const [key, entry] of webLoginAttempts.entries()) {
    if (entry.blockedUntil > now) continue;
    if (now - entry.windowStartedAt < windowMs) continue;
    webLoginAttempts.delete(key);
  }
}

function getActiveWebLoginAttempt(req, now = Date.now()) {
  if (config.webLoginMaxAttempts <= 0) {
    return null;
  }

  cleanupExpiredWebLoginAttempts(now);

  const key = getWebLoginKey(req);
  const entry = webLoginAttempts.get(key);

  if (!entry) return null;
  if (entry.blockedUntil > now) return { key, ...entry };

  const windowMs = config.webLoginWindowMinutes * 60 * 1000;
  if (now - entry.windowStartedAt >= windowMs) {
    webLoginAttempts.delete(key);
    return null;
  }

  return { key, ...entry };
}

function clearWebLoginAttempts(req) {
  if (config.webLoginMaxAttempts <= 0) {
    return;
  }

  webLoginAttempts.delete(getWebLoginKey(req));
}

function registerFailedWebLogin(req, now = Date.now()) {
  if (config.webLoginMaxAttempts <= 0) {
    return null;
  }

  cleanupExpiredWebLoginAttempts(now);

  const key = getWebLoginKey(req);
  const windowMs = config.webLoginWindowMinutes * 60 * 1000;
  const current = webLoginAttempts.get(key);
  const expired = current && current.blockedUntil <= now && now - current.windowStartedAt >= windowMs;
  const entry = !current || expired ? { count: 0, windowStartedAt: now, blockedUntil: 0 } : current;

  entry.count += 1;

  if (entry.count >= config.webLoginMaxAttempts) {
    entry.blockedUntil = now + windowMs;
  }

  webLoginAttempts.set(key, entry);
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

function hasDocsAccess(req) {
  if (!isWebLoginEnabled()) {
    return true;
  }

  return Boolean(getWebSession(req));
}

function ensureDocsAccess(req, res, { requireWebLogin = false } = {}) {
  if (requireWebLogin && !isWebLoginEnabled()) {
    jsonError(res, 403, 'Set WEB_PASSWORD or WEB_PASSWORD_HASH to enable web Claude auth actions.');
    return false;
  }

  if (hasDocsAccess(req)) {
    return true;
  }

  jsonError(res, 401, 'Web docs login is required.');
  return false;
}

async function handleWebLogin(req, res) {
  if (!isWebLoginEnabled()) {
    redirect(res, '/docs', {
      'cache-control': 'no-store',
    });
    return;
  }

  const blockedAttempt = getActiveWebLoginAttempt(req);
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

    if (!verifyWebPassword(password, config)) {
      const failedAttempt = registerFailedWebLogin(req);
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

    clearWebLoginAttempts(req);
    const session = createWebSession();
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

function handleWebLogout(req, res) {
  const session = getWebSession(req);
  if (session) {
    webSessions.delete(session.token);
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
}

async function handleClaudeAuthStatus(req, res) {
  if (!ensureDocsAccess(req, res, { requireWebLogin: true })) {
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
  if (!ensureDocsAccess(req, res, { requireWebLogin: true })) {
    return;
  }

  json(res, 200, {
    ok: true,
    operation: claudeAuthManager.getOperation(),
  });
}

async function handleClaudeAuthLogin(req, res) {
  if (!ensureDocsAccess(req, res, { requireWebLogin: true })) {
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
  if (!ensureDocsAccess(req, res, { requireWebLogin: true })) {
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
}

function handleProxyApiKeyStatus(req, res) {
  if (!ensureDocsAccess(req, res, { requireWebLogin: true })) {
    return;
  }

  json(res, 200, {
    ok: true,
    settings: buildProxyApiKeySettings(),
    apiKey: proxyApiKeyManager.getApiKey() || null,
  }, {
    'cache-control': 'no-store',
  });
}

async function handleProxyApiKeyUpdate(req, res) {
  if (!ensureDocsAccess(req, res, { requireWebLogin: true })) {
    return;
  }

  try {
    const body = await readJsonBody(req, 16 * 1024);
    const next = body?.reset || body?.generate
      ? proxyApiKeyManager.generateNewApiKey()
      : proxyApiKeyManager.setApiKey(body?.apiKey);

    config.proxyApiKey = next.apiKey;

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

function handleRecentLogs(req, res) {
  if (!ensureDocsAccess(req, res, { requireWebLogin: true })) {
    return;
  }

  json(res, 200, {
    ok: true,
    entries: recentLogStore.list(),
    logStore: recentLogStore.getStatus(),
    messageExecution: messageConcurrencyManager.getStatus(),
  }, {
    'cache-control': 'no-store',
  });
}

function applyProxyAuth(req, requestId) {
  const apiKey = req.headers['x-api-key'];
  const anthropicVersion = req.headers['anthropic-version'];
  const configuredProxyApiKey = proxyApiKeyManager.getApiKey();

  if (config.requireAnthropicVersion && !anthropicVersion) {
    throw new ProxyError(400, 'invalid_request_error', 'anthropic-version header is required');
  }

  if (!configuredProxyApiKey && !config.allowMissingApiKeyHeader) {
    throw new ProxyError(
      503,
      'api_error',
      'x-api-key is not configured yet. Sign in to /docs and set it before using /v1/messages.',
    );
  }

  if (!config.allowMissingApiKeyHeader && !apiKey) {
    throw new ProxyError(401, 'authentication_error', 'x-api-key header is required');
  }

  if (configuredProxyApiKey && !apiKey) {
    throw new ProxyError(401, 'authentication_error', 'x-api-key header is required');
  }

  if (configuredProxyApiKey && apiKey !== configuredProxyApiKey) {
    throw new ProxyError(401, 'authentication_error', 'Invalid API key');
  }

  return {
    requestId,
    anthropicVersion: anthropicVersion || config.defaultAnthropicVersion,
  };
}

function sendModels(res) {
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
  });
}

async function handleMessages(req, res) {
  const requestId = createRequestId();
  const abortController = new AbortController();
  let releaseExecutionSlot = null;

  req.on('aborted', () => {
    abortController.abort();
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    applyProxyAuth(req, requestId);
    const body = await readJsonBody(req, config.requestBodyLimitBytes);
    validateMessagesRequest(body);

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
          if (abortController.signal.aborted || req.destroyed || res.destroyed) {
            releaseExecutionSlot?.();
            releaseExecutionSlot = null;
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
          log('messages stream completed', {
            requestId,
            elapsed_ms: Date.now() - startedAt,
            chars: streamedText.length,
          });
        },
        onError(error) {
          releaseExecutionSlot?.();
          releaseExecutionSlot = null;
          if (abortController.signal.aborted || req.destroyed || res.destroyed) {
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

      return;
    }

    const cliResult = await runClaudeJson({
      claudeBin: config.claudeBin,
      model: mappedModel,
      systemPrompt,
      prompt,
      extraArgs: config.claudeExtraArgs,
      signal: abortController.signal,
    });

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

    log('messages request completed', {
      requestId,
      chars: truncated.text.length,
      input_tokens: cliResult.usage.input_tokens,
      output_tokens: cliResult.usage.output_tokens,
    });
  } catch (error) {
    releaseExecutionSlot?.();
    releaseExecutionSlot = null;
    if (!(error instanceof ProxyError) && (abortController.signal.aborted || req.destroyed || res.destroyed)) {
      log('messages request aborted', { requestId, error: error.message }, 'warn');
      return;
    }
    sendProxyError(res, error, requestId);
    log('messages request failed', { requestId, error: error.message }, 'error');
  }
}

function requestHandler(req, res) {
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
    if (isWebLoginEnabled() && !getWebSession(req)) {
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
    return;
  }

  if (req.method === 'GET' && req.url === '/login') {
    if (!isWebLoginEnabled() || getWebSession(req)) {
      redirect(res, '/docs', {
        'cache-control': 'no-store',
      });
      return;
    }

    html(res, 200, renderLoginPage({ loginPath: '/login' }), {
      vary: 'Cookie',
      'cache-control': 'no-store',
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/login') {
    void handleWebLogin(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/logout') {
    handleWebLogout(req, res);
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
    handleRecentLogs(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, {
      ok: true,
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/v1/models') {
    sendModels(res);
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

function startServer() {
  log('server started', {
    host: config.host,
    port: config.port,
    messageExecution: messageConcurrencyManager.getStatus(),
  });
  server.listen(config.port, config.host, () => {
    console.log(`claude-anthropic-proxy listening on http://${config.host}:${config.port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
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
};
