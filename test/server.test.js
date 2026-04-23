import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.CLAUDE_BIN = path.join(__dirname, 'fixtures', 'mock-claude.js');
process.env.ENABLE_REQUEST_LOGGING = 'false';
process.env.ALLOW_MISSING_API_KEY_HEADER = 'true';

const { server } = await import('../src/server.js');

async function startServer() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return `http://${address.address}:${address.port}`;
}

test.after(async () => {
  if (server.listening) {
    server.close();
    await once(server, 'close');
  }
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
