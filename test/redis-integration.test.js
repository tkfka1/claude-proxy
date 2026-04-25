import test from 'node:test';
import assert from 'node:assert/strict';

import { createRedisMessageConcurrencyManager } from '../src/redis-message-concurrency.js';
import { createRedisStateStore } from '../src/redis-state-store.js';
import { createScryptPasswordHash } from '../src/web-auth.js';

const redisUrl = process.env.REDIS_INTEGRATION_URL || '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupKeys(client, prefix) {
  const keys = await client.sendCommand(['KEYS', `${prefix}:*`]);
  if (keys.length > 0) {
    await client.del(keys);
  }
}

test('real Redis backend stores proxy state, recent logs, web auth, and readiness', { skip: !redisUrl }, async () => {
  const keyPrefix = `claude-proxy-it:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const store = await createRedisStateStore({ url: redisUrl, keyPrefix });

  try {
    const health = await store.checkHealth();
    assert.equal(health.healthy, true);
    assert.equal(health.ping, 'PONG');

    const proxyState = store.createProxyApiKeyStore();
    await proxyState.saveState({
      proxyApiKey: 'integration-secret-key',
      updatedAt: '2026-04-25T00:00:00.000Z',
    });
    assert.deepEqual(await proxyState.loadState(), {
      proxyApiKey: 'integration-secret-key',
      updatedAt: '2026-04-25T00:00:00.000Z',
      previousApiKeys: [],
      history: [],
    });

    const recentLogs = store.createRecentLogStore();
    await recentLogs.saveEntries([
      {
        id: 1,
        at: '2026-04-25T00:00:00.000Z',
        level: 'info',
        event: 'integration test',
        details: { ok: true },
      },
    ]);
    assert.deepEqual(await recentLogs.loadEntries(), [
      {
        id: 1,
        at: '2026-04-25T00:00:00.000Z',
        level: 'info',
        event: 'integration test',
        details: { ok: true },
      },
    ]);

    const webAuth = store.createWebAuthStore();
    await webAuth.createSession({
      token: 'session-token',
      expiresAt: Date.now() + 60_000,
      passwordUpdatedAt: '2026-04-25T00:00:00.000Z',
      csrfToken: 'csrf-token',
      ttlMs: 60_000,
    });
    const session = await webAuth.getSession('session-token');
    assert.equal(Number.isFinite(session.expiresAt), true);
    assert.equal(session.passwordUpdatedAt, '2026-04-25T00:00:00.000Z');
    assert.equal(session.csrfToken, 'csrf-token');

    await webAuth.setLoginAttempt('client', {
      count: 2,
      windowStartedAt: 100,
      blockedUntil: 200,
    }, 60_000);
    assert.deepEqual(await webAuth.getLoginAttempt('client'), {
      count: 2,
      windowStartedAt: 100,
      blockedUntil: 200,
    });

    const passwordHash = createScryptPasswordHash('redis-docs-secret-123', '00112233445566778899aabbccddeeff');
    await webAuth.setPasswordState({
      passwordHash,
      updatedAt: '2026-04-25T00:00:00.000Z',
    });
    assert.deepEqual(await webAuth.getPasswordState(), {
      passwordHash,
      updatedAt: '2026-04-25T00:00:00.000Z',
    });
    await webAuth.clearPasswordState();
    assert.equal(await webAuth.getPasswordState(), null);
  } finally {
    await cleanupKeys(store.client, keyPrefix);
    await store.close();
  }
});

test('real Redis message concurrency manager gates requests globally', { skip: !redisUrl }, async () => {
  const keyPrefix = `claude-proxy-it:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const store = await createRedisStateStore({ url: redisUrl, keyPrefix });

  try {
    const manager = createRedisMessageConcurrencyManager({
      client: store.client,
      keyPrefix,
      maxConcurrent: 1,
      maxQueued: 2,
      maxWaitMs: 1_000,
      leaseMs: 1_000,
      pollIntervalMs: 10,
    });

    const first = await manager.acquire({ requestId: 'first' });
    let secondAcquired = false;
    const secondPromise = manager.acquire({ requestId: 'second' }).then((slot) => {
      secondAcquired = true;
      return slot;
    });

    await sleep(50);
    assert.equal(secondAcquired, false);

    first.release();
    const second = await secondPromise;
    assert.equal(secondAcquired, true);
    assert.ok(second.waitedMs >= 0);
    second.release();

    await sleep(25);
    const status = await manager.getLiveStatus();
    assert.equal(status.globalActive, 0);
  } finally {
    await cleanupKeys(store.client, keyPrefix);
    await store.close();
  }
});
