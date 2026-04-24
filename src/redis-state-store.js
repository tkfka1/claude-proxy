import { createClient } from 'redis';

function sanitizeKeySegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '-')
    .replace(/-+/g, '-');
}

function buildKey(prefix, name) {
  const safePrefix = sanitizeKeySegment(prefix || 'claude-anthropic-proxy');
  return `${safePrefix}:${name}`;
}

function parseProxyState(raw) {
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Persisted Redis proxy state must be a JSON object');
  }

  const proxyApiKey = String(payload.proxyApiKey || '').trim();
  const updatedAt = payload.updatedAt == null ? null : String(payload.updatedAt).trim();

  if (!proxyApiKey) {
    return null;
  }

  return {
    proxyApiKey,
    updatedAt: updatedAt || null,
  };
}

function parseRecentLogEntries(raw) {
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload)) {
    throw new Error('Persisted Redis recent logs must be a JSON array');
  }

  return payload
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      id: Number.isFinite(entry.id) ? entry.id : 0,
      at: String(entry.at || ''),
      level: String(entry.level || 'info'),
      event: String(entry.event || ''),
      details: entry.details && typeof entry.details === 'object' ? entry.details : {},
    }));
}

export async function createRedisStateStore({ url, keyPrefix }) {
  const client = createClient({ url });

  client.on('error', (error) => {
    console.error(new Date().toISOString(), 'redis client error', {
      message: error.message,
    });
  });

  await client.connect();

  return {
    kind: 'redis',
    url,
    keyPrefix,
    client,
    getStatus() {
      return {
        enabled: true,
        healthy: client.isReady,
      };
    },
    createProxyApiKeyStore() {
      const redisKey = buildKey(keyPrefix, 'proxy-api-key');

      return {
        async loadState() {
          const raw = await client.get(redisKey);
          if (!raw) {
            return null;
          }

          return parseProxyState(raw);
        },
        async saveState({ proxyApiKey, updatedAt }) {
          await client.set(redisKey, JSON.stringify({ proxyApiKey, updatedAt }));
        },
        async clearState() {
          await client.del(redisKey);
        },
      };
    },
    createRecentLogStore() {
      const redisKey = buildKey(keyPrefix, 'recent-log');

      return {
        async loadEntries() {
          const raw = await client.get(redisKey);
          if (!raw) {
            return [];
          }

          return parseRecentLogEntries(raw);
        },
        async saveEntries(entries) {
          await client.set(redisKey, JSON.stringify(entries));
        },
        async clearEntries() {
          await client.del(redisKey);
        },
      };
    },
    async close() {
      if (!client.isOpen) {
        return;
      }

      await client.quit();
    },
  };
}
