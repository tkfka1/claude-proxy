import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-test-'));
process.env.CLAUDE_BIN = path.join(__dirname, 'fixtures', 'mock-claude.js');
process.env.ENABLE_REQUEST_LOGGING = 'false';
process.env.ALLOW_MISSING_API_KEY_HEADER = 'true';
process.env.WEB_PASSWORD = 'docs-secret';
process.env.WEB_PASSWORD_HASH = '';
process.env.WEB_SESSION_TTL_HOURS = '12';
process.env.WEB_LOGIN_MAX_ATTEMPTS = '2';
process.env.WEB_LOGIN_WINDOW_MINUTES = '1';
process.env.PROXY_STATE_FILE = path.join(tempDir, 'proxy-runtime-state.json');
process.env.MOCK_CLAUDE_AUTH_STATE_FILE = path.join(tempDir, 'mock-claude-auth-state.json');
process.env.MOCK_CLAUDE_AUTH_LOGGED_IN = 'false';

const { config, proxyApiKeyManager, server } = await import('../src/server.js');

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

async function loginDocs(baseUrl) {
  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ password: 'docs-secret' }),
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
  if (server.listening) {
    server.close();
    await once(server, 'close');
  }

  fs.rmSync(process.env.MOCK_CLAUDE_AUTH_STATE_FILE, { force: true });
  fs.rmSync(process.env.PROXY_STATE_FILE, { force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  resetMockClaudeAuthState();
  delete process.env.MOCK_CLAUDE_AUTH_LOGIN_FAIL;
  config.proxyApiKey = '';
  proxyApiKeyManager.resetApiKey('');
  config.allowMissingApiKeyHeader = true;
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
  assert.match(body, /문서 페이지 로그인/);
  assert.match(body, /WEB_PASSWORD/);
  assert.match(body, /WEB_PASSWORD_HASH/);
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
  assert.match(body, /엔드포인트/);
  assert.match(body, /POST/);
  assert.match(body, /\/v1\/messages/);
  assert.match(body, /일반 메시지 요청/);
  assert.match(body, /Claude CLI 로그인/);
  assert.match(body, /\/claude-auth\/status/);
  assert.match(body, /SSO 강제 사용/);
  assert.match(body, /x-api-key 저장/);
  assert.match(body, /리셋/);
  assert.match(body, /\/proxy-api-key/);
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
  assert.match(body, /문서 페이지 로그인/);
});

test('GET /api-info returns service metadata JSON', async () => {
  const baseUrl = server.listening ? `http://127.0.0.1:${server.address().port}` : await startServer();

  const response = await fetch(`${baseUrl}/api-info`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.endpoints, ['/health', '/v1/messages', '/v1/models']);
  assert.equal(body.web_login_enabled, true);
  assert.equal(body.docs_path, '/docs');
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

test('POST /proxy-api-key reset rotates the runtime key and /v1/messages starts requiring it', async () => {
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

  const oldKeyResponse = await fetch(`${baseUrl}/v1/messages`, {
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

  assert.equal(oldKeyResponse.status, 401);
  const oldKeyBody = await oldKeyResponse.json();
  assert.equal(oldKeyBody.error.message, 'Invalid API key');

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
