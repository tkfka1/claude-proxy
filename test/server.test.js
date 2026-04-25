import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-test-'));
process.env.CLAUDE_BIN = path.join(__dirname, 'fixtures', 'mock-claude.js');
process.env.CLAUDE_AUTH_DIR = path.join(tempDir, '.claude');
process.env.CLAUDE_AUTH_REDIS_SYNC = 'false';
process.env.ENABLE_REQUEST_LOGGING = 'false';
process.env.ALLOW_MISSING_API_KEY_HEADER = 'true';
process.env.WEB_PASSWORD = 'docs-secret';
process.env.WEB_PASSWORD_HASH = '';
process.env.WEB_SESSION_TTL_HOURS = '12';
process.env.WEB_LOGIN_MAX_ATTEMPTS = '2';
process.env.WEB_LOGIN_WINDOW_MINUTES = '1';
process.env.PROXY_STATE_FILE = path.join(tempDir, 'proxy-runtime-state.json');
process.env.RECENT_LOG_FILE = path.join(tempDir, 'recent-log.json');
process.env.MOCK_CLAUDE_AUTH_STATE_FILE = path.join(tempDir, 'mock-claude-auth-state.json');
process.env.MOCK_CLAUDE_AUTH_LOGGED_IN = 'false';
process.env.REDIS_URL = '';
process.env.ALLOW_LOCAL_STATE_BACKEND = 'true';
process.env.REDIS_KEY_PREFIX = 'claude-anthropic-proxy';

const {
  config,
  messageConcurrencyManager,
  proxyApiKeyManager,
  recentLogStore,
  resetWebPasswordForTests,
  server,
  shutdown,
} = await import('../src/server.js');

function resetMockClaudeAuthState(state = {}) {
  fs.writeFileSync(
    process.env.MOCK_CLAUDE_AUTH_STATE_FILE,
    JSON.stringify({
      loggedIn: false,
      authMethod: 'claude.ai',
      email: null,
      ...state,
    }),
    'utf8',
  );
}

async function startServer() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return `http://${address.address}:${address.port}`;
}

async function loginDocs(baseUrl, password = 'docs-secret') {
  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password }),
  });

  assert.equal(loginResponse.status, 303);
  return (loginResponse.headers.get('set-cookie') || '').split(';', 1)[0];
}

async function waitForClaudeAuthOperation(baseUrl, cookie, expectedStatus) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/claude-auth/operation`, {
      headers: {
        cookie,
      },
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    if (body.operation.status === expectedStatus) {
      return body.operation;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for Claude auth operation status=${expectedStatus}`);
}

test.after(async () => {
  await recentLogStore.flush();
  if (server.listening) {
    server.close();
    await once(server, 'close');
  }

  fs.rmSync(process.env.MOCK_CLAUDE_AUTH_STATE_FILE, { force: true });
  fs.rmSync(process.env.PROXY_STATE_FILE, { force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  resetMockClaudeAuthState();
  delete process.env.MOCK_CLAUDE_AUTH_LOGIN_FAIL;
  delete process.env.MOCK_CLAUDE_ERROR;
  delete process.env.MOCK_CLAUDE_RESULT;
  delete process.env.MOCK_CLAUDE_DELAY_MS;
  delete process.env.MOCK_CLAUDE_STREAM_DELAY_MS;
  delete process.env.MOCK_CLAUDE_STREAM_KEEPALIVE_DELAY_MS;
  delete process.env.MOCK_CLAUDE_STREAM_KEEPALIVE_COUNT;
  config.proxyApiKey = '';
  config.claudeRequestTimeoutMs = 300_000;
  config.claudeStreamIdleTimeoutMs = 60_000;
  await proxyApiKeyManager.resetApiKey('');
  await resetWebPasswordForTests();
  config.allowMissingApiKeyHeader = true;
  messageConcurrencyManager.clearQueue();
  messageConcurrencyManager.configure({
    maxConcurrent: config.maxConcurrentMessageRequests,
    maxQueued: config.maxQueuedMessageRequests,
    maxWaitMs: config.maxMessageQueueWaitMs,
  });
  recentLogStore.clear();
  await recentLogStore.flush();
});

test('GET / redirects browser clients to /docs', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/`, {
    redirect: 'manual',
    headers: {
      accept: 'text/html',
    },
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/docs');
  assert.equal(response.headers.get('vary'), 'Accept');
});

test('GET / keeps JSON metadata for non-browser clients', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
  const body = await response.json();
  assert.equal(body.service, 'claude-anthropic-proxy');
  assert.equal(body.web_login_enabled, true);
  assert.equal(body.docs_path, '/docs');
  assert.equal(body.log_store.enabled, true);
  assert.equal(body.log_store.healthy, true);
  assert.equal('lastError' in body.log_store, false);
});

test('GET / honors Accept quality for JSON clients', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/`, {
    headers: {
      accept: 'application/json, text/html;q=0.1',
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test('GET /docs shows the login page when web password is enabled', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/docs`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/html\b/);
  assert.equal(response.headers.get('vary'), 'Cookie');
  const body = await response.text();
  assert.match(body, /Claude Proxy/);
  assert.match(body, /Login/);
  assert.match(body, /class="proxy-visual"/);
  assert.match(body, /class="hero-meta-grid"/);
  assert.match(body, /class="node-card node-api"/);
  assert.doesNotMatch(body, /Claude를/);
  assert.doesNotMatch(body, /Private AI gateway/);
  assert.doesNotMatch(body, /WEB_PASSWORD/);
  assert.doesNotMatch(body, /WEB_PASSWORD_HASH/);
  assert.doesNotMatch(body, /들어가면 보이는 것/);
  assert.match(body, /<link rel="icon" href="\/favicon\.svg\?v=[a-f0-9]{12}" type="image\/svg\+xml" \/>/);
  assert.match(body, /<link rel="shortcut icon" href="\/favicon\.ico\?v=[a-f0-9]{12}" \/>/);
});

test('GET /favicon serves the Claude Proxy icon without polluting recent logs', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  const svgResponse = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(svgResponse.status, 200);
  assert.match(svgResponse.headers.get('content-type') || '', /^image\/svg\+xml\b/);
  assert.match(svgResponse.headers.get('cache-control') || '', /max-age=86400/);
  const svgBody = await svgResponse.text();
  assert.match(svgBody, /Claude|CP|<svg/);

  const icoResponse = await fetch(`${baseUrl}/favicon.ico`);
  assert.equal(icoResponse.status, 200);
  assert.match(icoResponse.headers.get('content-type') || '', /^image\/x-icon\b/);
  const icoMagic = Buffer.from(await icoResponse.arrayBuffer()).subarray(0, 4);
  assert.deepEqual([...icoMagic], [0, 0, 1, 0]);

  const versionedIcoResponse = await fetch(`${baseUrl}/favicon.ico?v=test-cache-bust`);
  assert.equal(versionedIcoResponse.status, 200);
  assert.match(versionedIcoResponse.headers.get('content-type') || '', /^image\/x-icon\b/);

  const logsResponse = await fetch(`${baseUrl}/logs/recent`, {
    headers: {
      cookie,
    },
  });
  const logsBody = await logsResponse.json();
  assert.equal(logsBody.entries.some((entry) => entry.details?.path === '/favicon.svg'), false);
  assert.equal(logsBody.entries.some((entry) => entry.details?.path === '/favicon.ico'), false);
});

test('POST /login creates a session and grants access to the docs page', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password: 'docs-secret' }),
  });

  assert.equal(loginResponse.status, 303);
  assert.equal(loginResponse.headers.get('location'), '/docs');
  const setCookie = loginResponse.headers.get('set-cookie') || '';
  assert.match(setCookie, /claude_proxy_web_session=/);
  const sessionCookie = setCookie.split(';', 1)[0];

  const response = await fetch(`${baseUrl}/docs`, {
    headers: {
      cookie: sessionCookie,
    },
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Claude Proxy/);
  assert.doesNotMatch(body, /Control room/);
  assert.match(body, /Routes/);
  assert.match(body, /POST/);
  assert.match(body, /\/v1\/messages/);
  assert.match(body, /Message/);
  assert.match(body, /Claude session/);
  assert.match(body, /SSO 강제 사용/);
  assert.match(body, /키 저장/);
  assert.match(body, /새 키 발급/);
  assert.match(body, /Call test/);
  assert.match(body, /id="call-test-form"/);
  assert.match(body, /호출 테스트/);
  assert.match(body, /로그 검색/);
  assert.match(body, /JSON 저장/);
  assert.match(body, /로그 비우기/);
});

test('POST /login rejects an invalid password', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password: 'wrong-password' }),
  });

  assert.equal(response.status, 401);
  const body = await response.text();
  assert.match(body, /비밀번호가 올바르지 않습니다/);
});

test('POST /login rate limits repeated failed passwords', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const first = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': '203.0.113.10',
    },
    body: new URLSearchParams({ password: 'wrong-password' }),
  });

  assert.equal(first.status, 401);

  const second = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': '203.0.113.10',
    },
    body: new URLSearchParams({ password: 'wrong-password' }),
  });

  assert.equal(second.status, 429);
  const body = await second.text();
  assert.match(body, /로그인 시도가 너무 많습니다/);
});

test('POST /logout clears the docs session', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password: 'docs-secret' }),
  });

  const sessionCookie = (loginResponse.headers.get('set-cookie') || '').split(';', 1)[0];

  const logoutResponse = await fetch(`${baseUrl}/logout`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: sessionCookie,
    },
  });

  assert.equal(logoutResponse.status, 303);
  assert.equal(logoutResponse.headers.get('location'), '/docs');
  assert.match(logoutResponse.headers.get('set-cookie') || '', /Max-Age=0/);

  const response = await fetch(`${baseUrl}/docs`, {
    headers: {
      cookie: sessionCookie,
    },
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Login/);
});

test('GET /api-info returns service metadata JSON', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/api-info`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.endpoints, ['/health', '/ready', '/metrics', '/v1/messages', '/v1/models']);
  assert.equal(body.web_login_enabled, true);
  assert.equal(body.docs_path, '/docs');
  assert.equal(body.call_test_path, '/call-test');
});

test('POST /call-test requires docs authentication', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/call-test`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Web docs login is required.');
});

test('POST /call-test runs a real proxied message call', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'call test ok';
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);
  await proxyApiKeyManager.resetApiKey('runtime-secret-key');
  config.allowMissingApiKeyHeader = false;

  const response = await fetch(`${baseUrl}/call-test`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 32,
      prompt: 'Reply call test ok.',
    }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('request-id') || '', /^req_/);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.proxyStatus, 200);
  assert.equal(body.request.model, 'claude-sonnet-4-20250514');
  assert.equal(body.request.max_tokens, 32);
  assert.equal(body.request.promptPreview, 'Reply call test ok.');
  assert.match(body.requestId, /^req_/);
  assert.match(body.proxyRequestId, /^req_/);
  assert.equal(body.response.content[0].text, 'call test ok');
  assert.equal(typeof body.elapsedMs, 'number');

  const logsResponse = await fetch(`${baseUrl}/logs/recent`, {
    headers: {
      cookie,
    },
  });
  const logsBody = await logsResponse.json();
  const callTestLog = logsBody.entries.find((entry) => entry.event === 'call test completed');
  assert.equal(callTestLog?.level, 'info');
  assert.equal(callTestLog?.details?.proxyStatus, 200);
});

test('POST /call-test reports missing proxy key when headers are disallowed', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);
  config.allowMissingApiKeyHeader = false;

  const response = await fetch(`${baseUrl}/call-test`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /x-api-key is not configured yet/);
});

test('GET /health returns process status and backend summary', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'claude-anthropic-proxy');
  assert.equal(body.stateBackend, 'file');
  assert.equal(body.redis, null);
  assert.equal(body.logStore.enabled, true);
});

test('GET /ready returns readiness status including message execution', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/ready`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'claude-anthropic-proxy');
  assert.equal(body.stateBackend, 'file');
  assert.equal(body.redis, null);
  assert.equal(body.messageExecution.backend, 'local');
});

test('GET /metrics returns request, message, backend, and key rotation counters', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/metrics`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'claude-anthropic-proxy');
  assert.equal(body.stateBackend, 'file');
  assert.equal(body.redis, null);
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.equal(typeof body.requests.total, 'number');
  assert.equal(typeof body.messages.total, 'number');
  assert.equal(typeof body.claudeCli.jsonStarted, 'number');
  assert.equal(typeof body.proxyApiKey.rotations, 'number');
  assert.equal(body.proxyApiKey.status.configured, false);
  assert.equal(body.messageExecution.backend, 'local');
});

test('GET /claude-auth/status returns Claude auth status for docs-authenticated users', async () => {
  resetMockClaudeAuthState({
    loggedIn: true,
    authMethod: 'claude.ai',
    email: 'status@example.com',
  });

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  const response = await fetch(`${baseUrl}/claude-auth/status`, {
    headers: {
      cookie,
    },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status.loggedIn, true);
  assert.equal(body.status.email, 'status@example.com');
});

test('GET /claude-auth/status requires docs authentication', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/claude-auth/status`);

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('GET /proxy-api-key requires docs authentication', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/proxy-api-key`);

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('GET /web-password requires docs authentication', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/web-password`);

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('GET /logs/recent requires docs authentication', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/logs/recent`);

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('POST /web-password changes docs password and invalidates the current session', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  const statusResponse = await fetch(`${baseUrl}/web-password`, {
    headers: {
      cookie,
    },
  });
  assert.equal(statusResponse.status, 200);
  const statusBody = await statusResponse.json();
  assert.equal(statusBody.ok, true);
  assert.equal(statusBody.status.configured, true);
  assert.equal(statusBody.status.source, 'env-plain');

  const wrongCurrentResponse = await fetch(`${baseUrl}/web-password`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      currentPassword: 'wrong-password',
      newPassword: 'docs-secret-updated-123',
    }),
  });
  assert.equal(wrongCurrentResponse.status, 401);

  const shortPasswordResponse = await fetch(`${baseUrl}/web-password`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      currentPassword: 'docs-secret',
      newPassword: 'too-short',
    }),
  });
  assert.equal(shortPasswordResponse.status, 400);

  const updateResponse = await fetch(`${baseUrl}/web-password`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      currentPassword: 'docs-secret',
      newPassword: 'docs-secret-updated-123',
    }),
  });

  assert.equal(updateResponse.status, 200);
  const updateBody = await updateResponse.json();
  assert.equal(updateBody.ok, true);
  assert.equal(updateBody.reauthRequired, true);
  assert.equal(updateBody.status.source, 'runtime');
  assert.equal(typeof updateBody.status.updatedAt, 'string');
  assert.match(updateResponse.headers.get('set-cookie') || '', /Max-Age=0/);

  const oldSessionResponse = await fetch(`${baseUrl}/web-password`, {
    headers: {
      cookie,
    },
  });
  assert.equal(oldSessionResponse.status, 401);

  const oldPasswordResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password: 'docs-secret' }),
  });
  assert.equal(oldPasswordResponse.status, 401);

  const newCookie = await loginDocs(baseUrl, 'docs-secret-updated-123');
  const newStatusResponse = await fetch(`${baseUrl}/web-password`, {
    headers: {
      cookie: newCookie,
    },
  });
  assert.equal(newStatusResponse.status, 200);
  const newStatusBody = await newStatusResponse.json();
  assert.equal(newStatusBody.status.source, 'runtime');
});

test('POST /proxy-api-key updates the runtime x-api-key after docs login', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  const updateResponse = await fetch(`${baseUrl}/proxy-api-key`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: 'runtime-secret-key',
    }),
  });

  assert.equal(updateResponse.status, 200);
  const updateBody = await updateResponse.json();
  assert.equal(updateBody.ok, true);
  assert.equal(updateBody.apiKey, 'runtime-secret-key');
  assert.equal(updateBody.settings.configured, true);
  assert.equal(updateBody.settings.headerRequired, true);

  const statusResponse = await fetch(`${baseUrl}/proxy-api-key`, {
    headers: {
      cookie,
    },
  });

  assert.equal(statusResponse.status, 200);
  const statusBody = await statusResponse.json();
  assert.equal(statusBody.settings.configured, true);
  assert.equal(statusBody.settings.headerRequired, true);
  assert.equal(statusBody.settings.maskedApiKey, 'runt…ey');
  assert.equal(statusBody.apiKey, 'runtime-secret-key');

  const persistedState = JSON.parse(fs.readFileSync(config.proxyStateFile, 'utf8'));
  assert.equal(persistedState.proxyApiKey, 'runtime-secret-key');
});

test('POST /proxy-api-key reset rotates the runtime key with previous-key grace', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'proxy reply';
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  const firstResponse = await fetch(`${baseUrl}/proxy-api-key`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: 'runtime-secret-key',
    }),
  });

  assert.equal(firstResponse.status, 200);
  const firstBody = await firstResponse.json();
  assert.equal(firstBody.apiKey, 'runtime-secret-key');

  const resetResponse = await fetch(`${baseUrl}/proxy-api-key`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reset: true,
    }),
  });

  assert.equal(resetResponse.status, 200);
  const resetBody = await resetResponse.json();
  assert.equal(resetBody.ok, true);
  assert.equal(resetBody.settings.configured, true);
  assert.equal(resetBody.settings.headerRequired, true);
  assert.equal(resetBody.settings.previousKeyCount, 1);
  assert.equal(resetBody.settings.previousKeys[0].maskedApiKey, 'runt…ey');
  assert.equal(resetBody.settings.history.length, 2);
  assert.match(resetBody.apiKey, /^[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(resetBody.apiKey, 'runtime-secret-key');

  const missingHeaderResponse = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(missingHeaderResponse.status, 401);
  const missingHeaderBody = await missingHeaderResponse.json();
  assert.equal(missingHeaderBody.error.message, 'x-api-key header is required');

  const previousGraceResponse = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'runtime-secret-key',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(previousGraceResponse.status, 200);
  const previousGraceBody = await previousGraceResponse.json();
  assert.equal(previousGraceBody.content[0].text, 'proxy reply');

  const okResponse = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': resetBody.apiKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(okResponse.status, 200);

  const invalidKeyResponse = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'definitely-invalid-key',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(invalidKeyResponse.status, 401);
  const invalidKeyBody = await invalidKeyResponse.json();
  assert.equal(invalidKeyBody.error.message, 'Invalid API key');

  const logsResponse = await fetch(`${baseUrl}/logs/recent`, {
    headers: {
      cookie,
    },
  });
  const logsBody = await logsResponse.json();
  const invalidKeyLog = logsBody.entries.find(
    (entry) => entry.event === 'messages request failed' && entry.details?.error === 'Invalid API key',
  );
  assert.equal(invalidKeyLog?.level, 'warn');

  const metricsResponse = await fetch(`${baseUrl}/metrics`);
  const metricsBody = await metricsResponse.json();
  assert.ok(metricsBody.proxyApiKey.previousKeyMatches >= 1);
});

test('GET /v1/models enforces the configured x-api-key without requiring anthropic-version', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  await proxyApiKeyManager.resetApiKey('runtime-secret-key');

  const missingHeaderResponse = await fetch(`${baseUrl}/v1/models`);
  assert.equal(missingHeaderResponse.status, 401);
  const missingHeaderBody = await missingHeaderResponse.json();
  assert.equal(missingHeaderBody.error.message, 'x-api-key header is required');

  const invalidKeyResponse = await fetch(`${baseUrl}/v1/models`, {
    headers: {
      'x-api-key': 'definitely-invalid-key',
    },
  });
  assert.equal(invalidKeyResponse.status, 401);
  const invalidKeyBody = await invalidKeyResponse.json();
  assert.equal(invalidKeyBody.error.message, 'Invalid API key');

  const okResponse = await fetch(`${baseUrl}/v1/models`, {
    headers: {
      'x-api-key': 'runtime-secret-key',
    },
  });
  assert.equal(okResponse.status, 200);
  assert.match(okResponse.headers.get('request-id') || '', /^req_/);
  const okBody = await okResponse.json();
  assert.deepEqual(okBody.data.map((model) => model.id), ['sonnet', 'opus', 'haiku']);
});

test('GET /v1/models stays locked until x-api-key is configured when missing headers are disallowed', async () => {
  config.allowMissingApiKeyHeader = false;

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: {
      'x-api-key': 'anything-at-all',
    },
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.type, 'api_error');
  assert.match(body.error.message, /x-api-key is not configured yet/);
});

test('GET /logs/recent returns recent entries and concurrency status for docs-authenticated users', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'proxy reply';
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  const response = await fetch(`${baseUrl}/logs/recent`, {
    headers: {
      cookie,
    },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.messageExecution.maxConcurrent, config.maxConcurrentMessageRequests);
  assert.equal(body.messageExecution.maxQueued, config.maxQueuedMessageRequests);
  assert.equal(body.logStore.enabled, true);
  assert.equal(body.logStore.healthy, true);
  assert.ok(Array.isArray(body.entries));
  assert.ok(body.entries.some((entry) => entry.event === 'messages request completed'));
  assert.ok(
    body.entries.some(
      (entry) => entry.event === 'http request completed'
        && entry.details?.method === 'POST'
        && entry.details?.path === '/v1/messages'
        && entry.details?.statusCode === 200
        && Number.isInteger(entry.details?.durationMs),
    ),
  );
});

test('DELETE /logs/recent clears recent logs after docs authentication', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const unauthenticatedResponse = await fetch(`${baseUrl}/logs/recent`, {
    method: 'DELETE',
  });

  assert.equal(unauthenticatedResponse.status, 401);

  await fetch(`${baseUrl}/api-info`);
  const cookie = await loginDocs(baseUrl);

  const beforeResponse = await fetch(`${baseUrl}/logs/recent`, {
    headers: {
      cookie,
    },
  });
  const beforeBody = await beforeResponse.json();
  assert.ok(beforeBody.entries.some((entry) => entry.event === 'http request completed'));

  const clearResponse = await fetch(`${baseUrl}/logs/recent`, {
    method: 'DELETE',
    headers: {
      cookie,
    },
  });

  assert.equal(clearResponse.status, 200);
  const clearBody = await clearResponse.json();
  assert.equal(clearBody.ok, true);
  assert.ok(clearBody.removedCount >= 1);
  assert.equal(clearBody.entries.length, 1);
  assert.equal(clearBody.entries[0].event, 'recent logs cleared');
  assert.equal(clearBody.entries[0].details.removedCount, clearBody.removedCount);
});

test('POST /v1/messages enforces configurable concurrency and queue limits', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'delayed reply';
  process.env.MOCK_CLAUDE_DELAY_MS = '150';
  messageConcurrencyManager.configure({
    maxConcurrent: 1,
    maxQueued: 1,
    maxWaitMs: 1_000,
  });

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  async function sendRequest() {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }

  const results = await Promise.all([sendRequest(), sendRequest(), sendRequest()]);
  const statuses = results.map((result) => result.status).sort((left, right) => left - right);
  assert.deepEqual(statuses, [200, 200, 429]);
  const rejected = results.find((result) => result.status === 429);
  assert.equal(rejected.body.error.type, 'rate_limit_error');

  const cookie = await loginDocs(baseUrl);
  const logResponse = await fetch(`${baseUrl}/logs/recent`, {
    headers: {
      cookie,
    },
  });
  const logBody = await logResponse.json();
  assert.ok(logBody.entries.some((entry) => entry.event === 'message concurrency queued'));
  assert.ok(logBody.entries.some((entry) => entry.event === 'message concurrency rejected'));
});

test('POST /v1/messages queue timeout returns 429 when a slot does not open in time', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'delayed reply';
  process.env.MOCK_CLAUDE_DELAY_MS = '200';
  messageConcurrencyManager.configure({
    maxConcurrent: 1,
    maxQueued: 1,
    maxWaitMs: 50,
  });

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const first = fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello 1' }],
    }),
  });

  const second = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello 2' }],
    }),
  });

  const firstResponse = await first;
  assert.equal(firstResponse.status, 200);
  assert.equal(second.status, 429);
  const body = await second.json();
  assert.equal(body.error.type, 'rate_limit_error');
  assert.match(body.error.message, /Timed out waiting 50ms/);
});

test('stream disconnect is logged as aborted and frees the execution slot', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'stream reply';
  process.env.MOCK_CLAUDE_STREAM_DELAY_MS = '150';
  messageConcurrencyManager.configure({
    maxConcurrent: 1,
    maxQueued: 1,
    maxWaitMs: 1_000,
  });

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const address = server.address();

  await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: address.address,
        port: address.port,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
      },
      (response) => {
        response.once('data', () => {
          response.destroy();
          resolve();
        });
        response.once('error', reject);
      },
    );

    request.once('error', reject);
    request.end(
      JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    );
  });

  await new Promise((resolve) => setTimeout(resolve, 250));

  const cookie = await loginDocs(baseUrl);
  const logResponse = await fetch(`${baseUrl}/logs/recent`, {
    headers: {
      cookie,
    },
  });
  const logBody = await logResponse.json();
  assert.ok(
    logBody.entries.some(
      (entry) => entry.event === 'messages request aborted' && entry.details?.phase === 'stream',
    ),
  );
  assert.equal(logBody.messageExecution.active, 0);

  const metricsResponse = await fetch(`${baseUrl}/metrics`);
  const metricsBody = await metricsResponse.json();
  assert.ok(metricsBody.requests.aborted >= 1);
  assert.ok(metricsBody.requests.status.aborted >= 1);
});

test('POST /v1/messages stays locked until x-api-key is configured when missing headers are disallowed', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'proxy reply';
  config.allowMissingApiKeyHeader = false;

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'anything-at-all',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.type, 'api_error');
  assert.match(body.error.message, /x-api-key is not configured yet/);
});

test('POST /claude-auth/login starts Claude login and updates auth state', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  const response = await fetch(`${baseUrl}/claude-auth/login`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'console',
      email: 'web-auth@example.com',
      sso: true,
    }),
  });

  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.operation.kind, 'login');
  assert.equal(body.operation.status, 'running');

  const operation = await waitForClaudeAuthOperation(baseUrl, cookie, 'succeeded');
  assert.match(operation.output, /Open browser to continue Claude login/);
  assert.match(operation.output, /https:\/\/claude\.ai\/mock-login/);
  assert.equal(operation.authStatus.loggedIn, true);
  assert.equal(operation.authStatus.authMethod, 'console');
  assert.equal(operation.authStatus.email, 'web-auth@example.com');
  assert.equal(operation.options.sso, true);
  assert.ok(Array.isArray(operation.links));
  assert.equal(operation.links.length, 1);
  assert.match(operation.links[0], /https:\/\/claude\.ai\/mock-login\?provider=console/);
});

test('POST /claude-auth/logout starts Claude logout and clears auth state', async () => {
  resetMockClaudeAuthState({
    loggedIn: true,
    authMethod: 'claude.ai',
    email: 'logout@example.com',
  });

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();
  const cookie = await loginDocs(baseUrl);

  const response = await fetch(`${baseUrl}/claude-auth/logout`, {
    method: 'POST',
    headers: {
      cookie,
    },
  });

  assert.equal(response.status, 202);
  await waitForClaudeAuthOperation(baseUrl, cookie, 'succeeded');

  const statusResponse = await fetch(`${baseUrl}/claude-auth/status`, {
    headers: {
      cookie,
    },
  });

  assert.equal(statusResponse.status, 200);
  const statusBody = await statusResponse.json();
  assert.equal(statusBody.status.loggedIn, false);
});

test('POST /v1/messages returns Anthropic-style JSON', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'proxy reply';
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'test-key',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.type, 'message');
  assert.equal(body.role, 'assistant');
  assert.equal(body.model, 'claude-sonnet-4-20250514');
  assert.equal(body.content[0].text, 'proxy reply');
  assert.equal(body.usage.input_tokens, 12);
  assert.equal(body.usage.output_tokens, 7);
});

test('POST /v1/messages returns 504 when the Claude CLI request times out', async () => {
  process.env.MOCK_CLAUDE_DELAY_MS = '200';
  config.claudeRequestTimeoutMs = 25;

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 504);
  const body = await response.json();
  assert.equal(body.error.type, 'api_error');
  assert.match(body.error.message, /timed out after 25ms/);

  const metricsResponse = await fetch(`${baseUrl}/metrics`);
  const metricsBody = await metricsResponse.json();
  assert.ok(metricsBody.claudeCli.timeout >= 1);
});

test('POST /v1/messages stream=true returns SSE event sequence', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'stream reply';
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: message_start/);
  assert.match(text, /event: content_block_start/);
  assert.match(text, /event: content_block_delta/);
  assert.match(text, /"text":"stream"/);
  assert.match(text, /"text":" reply"/);
  assert.match(text, /event: message_stop/);
});

test('POST /v1/messages stream=true emits an SSE error on stream idle timeout', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'stream reply';
  process.env.MOCK_CLAUDE_STREAM_DELAY_MS = '200';
  config.claudeRequestTimeoutMs = 1_000;
  config.claudeStreamIdleTimeoutMs = 25;

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.match(text, /stream idle timed out after 25ms/);
});

test('POST /v1/messages stream=true does not idle-timeout while non-assistant keepalives arrive', async () => {
  process.env.MOCK_CLAUDE_RESULT = 'stream reply';
  process.env.MOCK_CLAUDE_STREAM_KEEPALIVE_DELAY_MS = '20';
  process.env.MOCK_CLAUDE_STREAM_KEEPALIVE_COUNT = '3';
  config.claudeRequestTimeoutMs = 1_000;
  config.claudeStreamIdleTimeoutMs = 35;

  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: message_stop/);
  assert.doesNotMatch(text, /event: error/);
});



test('backend auth failure is surfaced as authentication_error', async () => {
  process.env.MOCK_CLAUDE_ERROR = 'auth';
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  delete process.env.MOCK_CLAUDE_ERROR;

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.type, 'authentication_error');
});

test('backend auth failure in stream mode emits only an SSE authentication error', async () => {
  process.env.MOCK_CLAUDE_ERROR = 'auth';
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  delete process.env.MOCK_CLAUDE_ERROR;

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.match(text, /authentication_error/);
  assert.doesNotMatch(text, /event: content_block_delta/);
  assert.doesNotMatch(text, /event: message_stop/);
});

test('POST /v1/messages rejects tools payloads', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      tools: [{ name: 'echo', input_schema: { type: 'object' } }],
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.type, 'error');
  assert.equal(body.error.type, 'invalid_request_error');
});

test('shutdown can be called again after the server is restarted in the same process', async () => {
  if (!server.listening) {
    await startServer();
  }

  await shutdown('test-first');
  assert.equal(server.listening, false);

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  assert.equal(server.listening, true);

  await shutdown('test-second');
  assert.equal(server.listening, false);
});
