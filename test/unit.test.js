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
  validateNewWebPassword,
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
import { createRedisStateStore } from '../src/redis-state-store.js';
import {
  createClaudeAuthManager,
  normalizeClaudeAuthSnapshot,
  readClaudeAuthSnapshot,
  writeClaudeAuthSnapshot,
} from '../src/claude-auth.js';
import { loadConfig } from '../src/config.js';

class FakeRedisSemaphoreClient {
  constructor() {
    this.activeEntries = new Map();
    this.queue = [];
    this.queueHeartbeats = new Map();
    this.sequence = 0;
  }

  prune(now) {
    for (const [token, expiresAt] of this.activeEntries.entries()) {
      if (expiresAt <= now) {
        this.activeEntries.delete(token);
      }
    }
    this.queue = this.queue.filter((entry) => {
      const heartbeat = this.queueHeartbeats.get(entry.token) || 0;
      if (heartbeat <= now) {
        this.queueHeartbeats.delete(entry.token);
        return false;
      }
      return true;
    });
  }

  async sendCommand(args) {
    const script = args[1];
    const numKeys = Number(args[2]);
    const argv = args.slice(3 + numKeys);

    if (script.includes('local seq = redis.call(\'INCR\'')) {
      const now = Number(argv[0]);
      const maxConcurrent = Number(argv[1]);
      const maxQueued = Number(argv[2]);
      const activeExpiresAt = Number(argv[3]);
      const queueExpiresAt = Number(argv[4]);
      const token = argv[5];
      this.prune(now);
      const queued = this.queue.find((entry) => entry.token === token);
      if (!queued) {
        if (this.queue.length >= maxQueued) {
          return [2, this.queue.length, this.activeEntries.size, 0];
        }
        this.sequence += 1;
        this.queue.push({ token, seq: this.sequence });
        this.queue.sort((left, right) => left.seq - right.seq);
      }
      this.queueHeartbeats.set(token, queueExpiresAt);
      const head = this.queue[0]?.token;
      const activeCount = this.activeEntries.size;
      if (head === token && activeCount < maxConcurrent) {
        this.queue = this.queue.filter((entry) => entry.token !== token);
        this.queueHeartbeats.delete(token);
        this.activeEntries.set(token, activeExpiresAt);
        return [1, this.queue.length, this.activeEntries.size, 0];
      }
      const rank = this.queue.findIndex((entry) => entry.token === token);
      return [0, this.queue.length, this.activeEntries.size, rank + 1];
    }

    if (script.includes('ZSCORE')) {
      const now = Number(argv[0]);
      const expiresAt = Number(argv[1]);
      const token = argv[2];
      this.prune(now);
      if (this.activeEntries.has(token)) {
        this.activeEntries.set(token, expiresAt);
      }
      return [this.activeEntries.size];
    }

    if (script.includes("redis.call('ZREM'")) {
      const token = argv[0];
      const now = Number(argv[1]);
      this.activeEntries.delete(token);
      this.prune(now);
      return [this.activeEntries.size];
    }

    if (script.includes("HDEL")) {
      const token = argv[0];
      this.queue = this.queue.filter((entry) => entry.token !== token);
      this.queueHeartbeats.delete(token);
      return [this.queue.length];
    }

    if (script.includes("return {redis.call('ZCARD'")) {
      const now = Number(argv[0]);
      this.prune(now);
      return [this.activeEntries.size, this.queue.length];
    }

    throw new Error(`Unsupported fake redis script: ${script}`);
  }
}

class FakeRedisStateClient {
  constructor() {
    this.values = new Map();
    this.isReady = true;
    this.isOpen = true;
  }

  on() {
    return this;
  }

  async connect() {
    return this;
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value) {
    this.values.set(key, value);
  }

  async del(key) {
    this.values.delete(key);
  }

  async quit() {
    this.isOpen = false;
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

test('validateNewWebPassword rejects weak or placeholder runtime passwords', () => {
  assert.throws(() => validateNewWebPassword('too-short'), /at least 12 characters/);
  assert.throws(
    () => validateNewWebPassword('replace-with-strong-docs-password'),
    /must not be a placeholder/,
  );
  assert.equal(validateNewWebPassword('new-docs-secret-123'), 'new-docs-secret-123');
});

test('loadConfig requires Redis unless local fallback is explicitly enabled', () => {
  const names = [
    'REDIS_URL',
    'ALLOW_LOCAL_STATE_BACKEND',
    'WEB_PASSWORD',
    'WEB_PASSWORD_HASH',
    'CLAUDE_MODEL_MAP_JSON',
    'CLAUDE_EXTRA_ARGS_JSON',
    'CLAUDE_AUTH_REDIS_SYNC',
    'CLAUDE_AUTH_DIR',
  ];
  const snapshot = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  try {
    process.env.REDIS_URL = '';
    process.env.ALLOW_LOCAL_STATE_BACKEND = '';
    process.env.WEB_PASSWORD = 'docs-secret';
    process.env.WEB_PASSWORD_HASH = '';
    process.env.CLAUDE_MODEL_MAP_JSON = '';
    process.env.CLAUDE_EXTRA_ARGS_JSON = '[]';
    process.env.CLAUDE_AUTH_REDIS_SYNC = '';
    process.env.CLAUDE_AUTH_DIR = '';

    assert.throws(() => loadConfig(), /REDIS_URL is required/);

    process.env.ALLOW_LOCAL_STATE_BACKEND = 'true';
    process.env.CLAUDE_AUTH_REDIS_SYNC = 'true';
    assert.throws(() => loadConfig(), /CLAUDE_AUTH_REDIS_SYNC requires REDIS_URL/);

    process.env.ALLOW_LOCAL_STATE_BACKEND = 'true';
    process.env.CLAUDE_AUTH_REDIS_SYNC = '';
    const config = loadConfig();
    assert.equal(config.redisUrl, '');
    assert.equal(config.allowLocalStateBackend, true);
  } finally {
    for (const [name, value] of Object.entries(snapshot)) {
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test('proxy api key helpers validate, mask, and update runtime state', async () => {
  assert.throws(() => validateProxyApiKeyInput('short'), /at least 8 characters/);
  assert.equal(maskProxyApiKey('runtime-secret-key'), 'runt…ey');

  const manager = createProxyApiKeyManager();
  assert.deepEqual(manager.getStatus(), {
    configured: false,
    maskedApiKey: null,
    updatedAt: null,
    gracePeriodSeconds: 300,
    previousKeyCount: 0,
    previousKeys: [],
    history: [],
  });

  const updated = await manager.setApiKey('runtime-secret-key');
  assert.equal(updated.apiKey, 'runtime-secret-key');
  assert.equal(updated.configured, true);
  assert.equal(updated.maskedApiKey, 'runt…ey');
  assert.deepEqual(manager.verifyApiKey('runtime-secret-key'), {
    valid: true,
    matched: 'current',
    expiresAt: null,
  });

  const rotated = await manager.setApiKey('next-runtime-secret');
  assert.equal(rotated.previousKeyCount, 1);
  assert.equal(manager.verifyApiKey('runtime-secret-key').valid, true);
  assert.equal(manager.verifyApiKey('runtime-secret-key').matched, 'previous');
  assert.equal(rotated.history.length, 2);

  await manager.resetApiKey('');
  assert.equal(manager.getStatus().configured, false);
});

test('proxy api key manager can disable previous-key grace and trim history', async () => {
  const manager = createProxyApiKeyManager({
    gracePeriodSeconds: 0,
    historyLimit: 1,
  });

  await manager.setApiKey('runtime-secret-key');
  const rotated = await manager.setApiKey('next-runtime-secret');

  assert.equal(rotated.previousKeyCount, 0);
  assert.equal(rotated.history.length, 1);
  assert.deepEqual(manager.verifyApiKey('runtime-secret-key'), {
    valid: false,
    matched: null,
    expiresAt: null,
  });
});

test('proxy api key manager applies current grace settings to persisted previous keys', () => {
  const retiredAt = new Date(Date.now() - 5_000).toISOString();
  const storedExpiresAt = new Date(Date.now() + 300_000).toISOString();
  const loadedState = {
    proxyApiKey: 'next-runtime-secret',
    updatedAt: new Date().toISOString(),
    previousApiKeys: [
      {
        apiKey: 'runtime-secret-key',
        retiredAt,
        expiresAt: storedExpiresAt,
      },
    ],
    history: [],
  };

  const disabledGraceManager = createProxyApiKeyManager({
    loadedState,
    gracePeriodSeconds: 0,
  });
  assert.deepEqual(disabledGraceManager.verifyApiKey('runtime-secret-key'), {
    valid: false,
    matched: null,
    expiresAt: null,
  });

  const shortenedGraceManager = createProxyApiKeyManager({
    loadedState,
    gracePeriodSeconds: 1,
  });
  assert.deepEqual(shortenedGraceManager.verifyApiKey('runtime-secret-key'), {
    valid: false,
    matched: null,
    expiresAt: null,
  });
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
    previousApiKeys: [],
    history: [],
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

test('claude auth snapshots copy and replace auth files safely', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-auth-snapshot-'));
  const sourceDir = path.join(tempDir, 'source');
  const targetDir = path.join(tempDir, 'target');

  fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, '.credentials.json'), '{"token":"secret"}', { mode: 0o600 });
  fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"theme":"dark"}', { mode: 0o600 });
  fs.writeFileSync(path.join(sourceDir, 'nested', 'extra.json'), '{"ok":true}', { mode: 0o600 });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'stale.json'), '{"stale":true}', { mode: 0o600 });

  const snapshot = await readClaudeAuthSnapshot({
    authDir: sourceDir,
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.deepEqual(snapshot.files.map((file) => file.path), [
    '.credentials.json',
    'nested/extra.json',
    'settings.json',
  ]);
  assert.equal(snapshot.files[0].contentBase64, Buffer.from('{"token":"secret"}').toString('base64'));

  await writeClaudeAuthSnapshot({ authDir: targetDir, snapshot });
  assert.equal(fs.readFileSync(path.join(targetDir, '.credentials.json'), 'utf8'), '{"token":"secret"}');
  assert.equal(fs.readFileSync(path.join(targetDir, 'nested', 'extra.json'), 'utf8'), '{"ok":true}');
  assert.equal(fs.existsSync(path.join(targetDir, 'stale.json')), false);

  await writeClaudeAuthSnapshot({
    authDir: targetDir,
    snapshot: {
      version: 1,
      updatedAt: '2026-04-25T00:01:00.000Z',
      files: [],
    },
  });
  assert.deepEqual(fs.readdirSync(targetDir), []);
  assert.throws(
    () => normalizeClaudeAuthSnapshot({
      version: 1,
      updatedAt: '2026-04-25T00:00:00.000Z',
      files: [{ path: '../escape.json', contentBase64: '' }],
    }),
    /Invalid Claude auth snapshot file path/,
  );
  assert.throws(
    () => normalizeClaudeAuthSnapshot({
      version: 1,
      updatedAt: '2026-04-25T00:00:00.000Z',
      files: [{ path: '/absolute.json', contentBase64: '' }],
    }),
    /Invalid Claude auth snapshot file path/,
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('claude auth manager applies shared snapshots without exposing auth dir status', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-auth-manager-'));
  const authDir = path.join(tempDir, '.claude');
  const sharedSnapshot = {
    version: 1,
    updatedAt: '2026-04-25T02:00:00.000Z',
    files: [
      {
        path: '.credentials.json',
        contentBase64: Buffer.from('{"token":"shared"}').toString('base64'),
        mode: 0o600,
      },
    ],
  };
  const authStore = {
    state: sharedSnapshot,
    async loadState() {
      return this.state;
    },
    async saveState(state) {
      this.state = normalizeClaudeAuthSnapshot(state);
    },
  };

  const manager = createClaudeAuthManager({
    claudeBin: process.execPath,
    authDir,
    authStore,
  });
  const syncResult = await manager.syncFromStore();

  assert.equal(syncResult.applied, true);
  assert.equal(fs.readFileSync(path.join(authDir, '.credentials.json'), 'utf8'), '{"token":"shared"}');
  assert.deepEqual(manager.getSharedAuthStatus(), {
    enabled: true,
    lastAppliedAt: '2026-04-25T02:00:00.000Z',
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
    maxWaitMs: 1_000,
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

test('redis message concurrency manager times out queued requests', async () => {
  const client = new FakeRedisSemaphoreClient();
  const manager = createRedisMessageConcurrencyManager({
    client,
    keyPrefix: 'claude-proxy-timeout',
    maxConcurrent: 1,
    maxQueued: 1,
    maxWaitMs: 30,
    pollIntervalMs: 10,
    leaseMs: 100,
  });

  const first = await manager.acquire({ requestId: 'req_1' });
  await assert.rejects(
    () => manager.acquire({ requestId: 'req_2' }),
    /Timed out waiting 30ms/,
  );
  first.release();
});

test('redis state store saves and loads proxy state plus recent logs', async () => {
  const fakeClient = new FakeRedisStateClient();
  const store = await createRedisStateStore({
    url: 'redis://fake:6379/0',
    keyPrefix: 'claude-proxy-test',
    clientFactory: () => fakeClient,
  });

  const proxyStore = store.createProxyApiKeyStore();
  await proxyStore.saveState({
    proxyApiKey: 'redis-state-key',
    updatedAt: '2026-04-24T00:00:00.000Z',
  });
  assert.deepEqual(await proxyStore.loadState(), {
    proxyApiKey: 'redis-state-key',
    updatedAt: '2026-04-24T00:00:00.000Z',
    previousApiKeys: [],
    history: [],
  });

  const logStore = store.createRecentLogStore();
  await logStore.saveEntries([{ id: 1, at: '2026-04-24T00:00:00.000Z', level: 'info', event: 'demo', details: {} }]);
  assert.equal((await logStore.loadEntries()).length, 1);

  const webAuthStore = store.createWebAuthStore();
  await webAuthStore.createSession({
    token: 'session-token',
    expiresAt: Date.now() + 60_000,
    passwordUpdatedAt: '2026-04-25T00:00:00.000Z',
    ttlMs: 60_000,
  });
  assert.equal((await webAuthStore.getSession('session-token')).passwordUpdatedAt, '2026-04-25T00:00:00.000Z');
  await webAuthStore.setLoginAttempt('client-key', {
    count: 2,
    windowStartedAt: 1,
    blockedUntil: 2,
  }, 60_000);
  assert.equal((await webAuthStore.getLoginAttempt('client-key')).count, 2);
  const passwordHash = createScryptPasswordHash('redis-docs-secret-123', '00112233445566778899aabbccddeeff');
  await webAuthStore.setPasswordState({
    passwordHash,
    updatedAt: '2026-04-25T00:00:00.000Z',
  });
  assert.deepEqual(await webAuthStore.getPasswordState(), {
    passwordHash,
    updatedAt: '2026-04-25T00:00:00.000Z',
  });
  await webAuthStore.clearPasswordState();
  assert.equal(await webAuthStore.getPasswordState(), null);

  const claudeAuthStore = store.createClaudeAuthStore();
  await claudeAuthStore.saveState({
    version: 1,
    updatedAt: '2026-04-25T01:00:00.000Z',
    files: [
      {
        path: '.credentials.json',
        contentBase64: Buffer.from('{"token":"redis"}').toString('base64'),
        mode: 0o600,
      },
    ],
  });
  assert.deepEqual(await claudeAuthStore.loadState(), {
    version: 1,
    updatedAt: '2026-04-25T01:00:00.000Z',
    files: [
      {
        path: '.credentials.json',
        contentBase64: Buffer.from('{"token":"redis"}').toString('base64'),
        mode: 0o600,
      },
    ],
  });
  await claudeAuthStore.clearState();
  assert.equal(await claudeAuthStore.loadState(), null);

  await store.close();
});
