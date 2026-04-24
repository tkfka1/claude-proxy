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
import { createRedisMessageConcurrencyManager } from '../src/redis-message-concurrency.js';
import { createRecentLogStore } from '../src/recent-log-store.js';

class FakeRedisSemaphoreClient {
  constructor() {
    this.entries = new Map();
  }

  prune(now) {
    for (const [token, expiresAt] of this.entries.entries()) {
      if (expiresAt <= now) {
        this.entries.delete(token);
      }
    }
  }

  async sendCommand(args) {
    const script = args[1];
    const argv = args.slice(4);

    if (script.includes('return {1, count + 1}')) {
      const now = Number(argv[0]);
      const maxConcurrent = Number(argv[1]);
      const expiresAt = Number(argv[2]);
      const token = argv[3];
      this.prune(now);
      const count = this.entries.size;
      if (count < maxConcurrent) {
        this.entries.set(token, expiresAt);
        return [1, count + 1];
      }
      return [0, count];
    }

    if (script.includes('ZSCORE')) {
      const now = Number(argv[0]);
      const expiresAt = Number(argv[1]);
      const token = argv[2];
      this.prune(now);
      if (this.entries.has(token)) {
        this.entries.set(token, expiresAt);
      }
      return this.entries.size;
    }

    if (script.includes("redis.call('ZREM'")) {
      const token = argv[0];
      const now = Number(argv[1]);
      this.entries.delete(token);
      this.prune(now);
      return this.entries.size;
    }

    if (script.includes("return redis.call('ZCARD'")) {
      const now = Number(argv[0]);
      this.prune(now);
      return this.entries.size;
    }

    throw new Error(`Unsupported fake redis script: ${script}`);
  }
}

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

test('proxy api key helpers validate, mask, and update runtime state', async () => {
  assert.throws(() => validateProxyApiKeyInput('short'), /at least 8 characters/);
  assert.equal(maskProxyApiKey('runtime-secret-key'), 'runt…ey');

  const manager = createProxyApiKeyManager();
  assert.deepEqual(manager.getStatus(), {
    configured: false,
    maskedApiKey: null,
    updatedAt: null,
  });

  const updated = await manager.setApiKey('runtime-secret-key');
  assert.equal(updated.apiKey, 'runtime-secret-key');
  assert.equal(updated.configured, true);
  assert.equal(updated.maskedApiKey, 'runt…ey');

  await manager.resetApiKey('');
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

test('proxy api key manager bootstraps from env once and then keeps persisted state', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-manager-'));
  const store = createProxyStateFileStore({
    filePath: path.join(tempDir, 'runtime-state.json'),
  });

  const firstManager = createProxyApiKeyManager({
    initialApiKey: 'bootstrap-env-key',
    storage: store,
  });
  assert.equal(firstManager.getApiKey(), 'bootstrap-env-key');
  assert.equal(store.loadState(), null);

  await firstManager.setApiKey('persisted-secret-key');
  const loadedState = store.loadState();

  const secondManager = createProxyApiKeyManager({
    initialApiKey: 'bootstrap-env-key',
    loadedState,
    storage: store,
  });

  assert.equal(secondManager.getApiKey(), 'persisted-secret-key');
  assert.equal(secondManager.getStatus().configured, true);

  const rotatedManager = createProxyApiKeyManager({
    initialApiKey: 'emergency-env-rotation',
    loadedState,
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

test('proxy state file store rejects a corrupt persisted state file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proxy-corrupt-'));
  const filePath = path.join(tempDir, 'runtime-state.json');
  fs.writeFileSync(filePath, '{"proxyApiKey": ', 'utf8');

  const store = createProxyStateFileStore({ filePath });
  assert.throws(() => store.loadState(), /Unexpected end of JSON input/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('recent log store persists and reloads entries', async () => {
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
  await store.flush();

  const reloaded = createRecentLogStore({
    limit: 5,
    storage,
    initialEntries: storage.loadEntries(),
  });
  const entries = reloaded.list();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'messages request aborted');
  assert.equal(entries[1].event, 'messages request');
  assert.equal(reloaded.getStatus().enabled, true);
  assert.equal(reloaded.getStatus().healthy, true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('recent log store redacts sensitive fields before persistence', async () => {
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
  await store.flush();

  const [entry] = storage.loadEntries();
  assert.equal(entry.details.client, '203.0.113.x');
  assert.equal(entry.details.email, 'u***@example.com');
  assert.deepEqual(store.getPublicStatus(), {
    enabled: true,
    healthy: true,
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('redis message concurrency manager enforces a global semaphore with local queueing', async () => {
  const client = new FakeRedisSemaphoreClient();
  const manager = createRedisMessageConcurrencyManager({
    client,
    keyPrefix: 'claude-proxy-test',
    maxConcurrent: 1,
    maxQueued: 1,
    pollIntervalMs: 10,
    leaseMs: 100,
  });

  const first = await manager.acquire({ requestId: 'req_1' });
  const secondPromise = manager.acquire({ requestId: 'req_2' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const thirdPromise = manager.acquire({ requestId: 'req_3' });

  await assert.rejects(thirdPromise, /Too many concurrent/);
  first.release();
  const second = await secondPromise;
  const liveStatus = await manager.getLiveStatus();
  assert.equal(liveStatus.backend, 'redis-global');
  assert.equal(liveStatus.globalActive, 1);
  second.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const finalStatus = await manager.getLiveStatus();
  assert.equal(finalStatus.globalActive, 0);
});
