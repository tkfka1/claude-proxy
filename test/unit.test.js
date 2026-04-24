import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildClaudePrompt,
  normalizeSystemPrompt,
  truncateByStopSequences,
} from '../src/anthropic.js';
import {
  validateWebPasswordSettings,
  createScryptPasswordHash,
  parseScryptPasswordHash,
  verifyWebPassword,
} from '../src/web-auth.js';
import {
  createProxyApiKeyManager,
  maskProxyApiKey,
  validateProxyApiKeyInput,
} from '../src/proxy-api-key.js';
import {
  createProxyStateFileStore,
  createRecentLogFileStore,
  resolveProxyStateFile,
  resolveRecentLogFile,
} from '../src/proxy-state-file.js';
import { createRecentLogStore } from '../src/recent-log-store.js';

test('buildClaudePrompt formats conversation history', () => {
  const prompt = buildClaudePrompt([
    { role: 'user', content: '안녕' },
    { role: 'assistant', content: [{ type: 'text', text: '안녕하세요!' }] },
    { role: 'user', content: [{ type: 'text', text: '요약해줘' }] },
  ]);

  assert.match(prompt, /<message role="user">\n안녕\n<\/message>/);
  assert.match(prompt, /<message role="assistant">\n안녕하세요!\n<\/message>/);
  assert.match(prompt, /Assistant:\s*$/);
});

test('normalizeSystemPrompt accepts string and text blocks', () => {
  assert.equal(normalizeSystemPrompt('system'), 'system');
  assert.equal(
    normalizeSystemPrompt([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]),
    'a\n\nb',
  );
});

test('truncateByStopSequences truncates at first stop sequence', () => {
  assert.deepEqual(truncateByStopSequences('hello<stop>world', ['<stop>']), {
    text: 'hello',
    stopReason: 'stop_sequence',
    stopSequence: '<stop>',
  });

  assert.deepEqual(truncateByStopSequences('hello world', ['<stop>']), {
    text: 'hello world',
    stopReason: 'end_turn',
    stopSequence: null,
  });
});

test('createScryptPasswordHash and verifyWebPassword support hashed web passwords', () => {
  const hash = createScryptPasswordHash('docs-secret', '00112233445566778899aabbccddeeff');

  assert.deepEqual(parseScryptPasswordHash(hash), {
    saltHex: '00112233445566778899aabbccddeeff',
    digestHex: hash.split('$')[2],
  });
  assert.equal(verifyWebPassword('docs-secret', { webPasswordHash: hash }), true);
  assert.equal(verifyWebPassword('wrong-password', { webPasswordHash: hash }), false);
});

test('verifyWebPassword supports plaintext fallback', () => {
  assert.equal(verifyWebPassword('docs-secret', { webPassword: 'docs-secret' }), true);
  assert.equal(verifyWebPassword('wrong-password', { webPassword: 'docs-secret' }), false);
});

test('validateWebPasswordSettings requires a docs password or hash', () => {
  assert.throws(
    () => validateWebPasswordSettings({ webPassword: '', webPasswordHash: '' }),
    /Set WEB_PASSWORD or WEB_PASSWORD_HASH/,
  );
  assert.throws(
    () => validateWebPasswordSettings({ webPassword: 'replace-with-strong-docs-password', webPasswordHash: '' }),
    /must be replaced with a real secret/,
  );
});

test('proxy api key helpers validate, mask, and update runtime state', () => {
  assert.throws(() => validateProxyApiKeyInput('short'), /at least 8 characters/);
  assert.equal(maskProxyApiKey('runtime-secret-key'), 'runt…ey');

  const manager = createProxyApiKeyManager();
  assert.deepEqual(manager.getStatus(), {
    configured: false,
    maskedApiKey: null,
    updatedAt: null,
  });

  const updated = manager.setApiKey('runtime-secret-key');
  assert.equal(updated.apiKey, 'runtime-secret-key');
  assert.equal(updated.configured, true);
  assert.equal(updated.maskedApiKey, 'runt…ey');

  manager.resetApiKey('');
  assert.equal(manager.getStatus().configured, false);
});

test('proxy state file store saves and loads persisted x-api-key state', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-state-'));
  const store = createProxyStateFileStore({
    filePath: path.join(tempDir, 'runtime-state.json'),
  });

  assert.equal(store.loadState(), null);

  store.saveState({
    proxyApiKey: 'persisted-secret-key',
    updatedAt: '2026-04-24T00:00:00.000Z',
  });

  assert.deepEqual(store.loadState(), {
    proxyApiKey: 'persisted-secret-key',
    updatedAt: '2026-04-24T00:00:00.000Z',
  });

  store.clearState();
  assert.equal(store.loadState(), null);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('proxy api key manager bootstraps from env once and then keeps persisted state', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-manager-'));
  const store = createProxyStateFileStore({
    filePath: path.join(tempDir, 'runtime-state.json'),
  });

  const firstManager = createProxyApiKeyManager({
    initialApiKey: 'bootstrap-env-key',
    storage: store,
  });
  assert.equal(firstManager.getApiKey(), 'bootstrap-env-key');
  assert.equal(store.loadState().proxyApiKey, 'bootstrap-env-key');

  firstManager.setApiKey('persisted-secret-key');

  const secondManager = createProxyApiKeyManager({
    initialApiKey: 'bootstrap-env-key',
    storage: store,
  });

  assert.equal(secondManager.getApiKey(), 'persisted-secret-key');
  assert.equal(secondManager.getStatus().configured, true);

  const rotatedManager = createProxyApiKeyManager({
    initialApiKey: 'emergency-env-rotation',
    storage: store,
  });

  assert.equal(rotatedManager.getApiKey(), 'persisted-secret-key');
  assert.equal(store.loadState().proxyApiKey, 'persisted-secret-key');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('resolveProxyStateFile uses explicit env path when provided', () => {
  const resolved = resolveProxyStateFile('./tmp/runtime-state.json');
  assert.match(resolved, /tmp[\\/]+runtime-state\.json$/);
});

test('resolveRecentLogFile uses explicit env path when provided', () => {
  const resolved = resolveRecentLogFile('./tmp/recent-log.json');
  assert.match(resolved, /tmp[\\/]+recent-log\.json$/);
});

test('proxy api key manager refuses a corrupt persisted state file even when env bootstrap exists', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-corrupt-'));
  const filePath = path.join(tempDir, 'runtime-state.json');
  fs.writeFileSync(filePath, '{"proxyApiKey": ', 'utf8');

  const store = createProxyStateFileStore({ filePath });
  assert.throws(
    () =>
      createProxyApiKeyManager({
        initialApiKey: 'bootstrap-env-key',
        storage: store,
      }),
    /Failed to load persisted proxy API key state/,
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('recent log store persists and reloads entries', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-logs-'));
  const storage = createRecentLogFileStore({
    filePath: path.join(tempDir, 'recent-log.json'),
  });

  const store = createRecentLogStore({
    limit: 5,
    storage,
  });
  store.add('info', 'messages request', { requestId: 'req_1' });
  store.add('warn', 'messages request aborted', { requestId: 'req_2' });

  const reloaded = createRecentLogStore({
    limit: 5,
    storage,
  });
  const entries = reloaded.list();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'messages request aborted');
  assert.equal(entries[1].event, 'messages request');
  assert.equal(reloaded.getStatus().enabled, true);
  assert.equal(reloaded.getStatus().healthy, true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('recent log store redacts sensitive fields before persistence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-logs-redact-'));
  const storage = createRecentLogFileStore({
    filePath: path.join(tempDir, 'recent-log.json'),
  });

  const store = createRecentLogStore({
    limit: 5,
    storage,
  });
  store.add('warn', 'docs login failed', {
    client: '203.0.113.10',
    email: 'user@example.com',
  });

  const [entry] = storage.loadEntries();
  assert.equal(entry.details.client, '203.0.113.x');
  assert.equal(entry.details.email, 'u***@example.com');
  assert.deepEqual(store.getPublicStatus(), {
    enabled: true,
    healthy: true,
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
});
