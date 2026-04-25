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
    previousApiKeys: Array.isArray(payload.previousApiKeys)
      ? payload.previousApiKeys
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => ({
          apiKey: String(entry.apiKey || '').trim(),
          retiredAt: entry.retiredAt == null ? null : String(entry.retiredAt).trim(),
          expiresAt: entry.expiresAt == null ? null : String(entry.expiresAt).trim(),
        }))
        .filter((entry) => entry.apiKey)
      : [],
    history: Array.isArray(payload.history)
      ? payload.history
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => ({
          maskedApiKey: entry.maskedApiKey == null ? null : String(entry.maskedApiKey),
          activatedAt: entry.activatedAt == null ? null : String(entry.activatedAt),
          retiredAt: entry.retiredAt == null ? null : String(entry.retiredAt),
          expiresAt: entry.expiresAt == null ? null : String(entry.expiresAt),
        }))
      : [],
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

function parseWebSession(raw) {
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Persisted Redis web session must be a JSON object');
  }

  const expiresAt = Number(payload.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new Error('Persisted Redis web session must include numeric expiresAt');
  }

  return {
    expiresAt,
  };
}

function parseWebLoginAttempt(raw) {
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Persisted Redis web login attempt must be a JSON object');
  }

  return {
    count: Number(payload.count || 0),
    windowStartedAt: Number(payload.windowStartedAt || 0),
    blockedUntil: Number(payload.blockedUntil || 0),
  };
}

export async function createRedisStateStore({ url, keyPrefix, clientFactory = createClient }) {
  const client = clientFactory({ url });
  let lastError = null;
  let lastCheckedAt = null;

  client.on('error', (error) => {
    lastError = error.message;
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
        open: client.isOpen,
        ready: client.isReady,
        lastError,
      };
    },
    async checkHealth() {
      lastCheckedAt = new Date().toISOString();
      const status = {
        enabled: true,
        healthy: false,
        open: client.isOpen,
        ready: client.isReady,
        ping: null,
        lastError,
        checkedAt: lastCheckedAt,
      };

      if (!client.isOpen || !client.isReady) {
        status.lastError = lastError || 'Redis client is not ready';
        return status;
      }

      try {
        const ping = await client.ping();
        lastError = null;
        return {
          ...status,
          healthy: ping === 'PONG',
          ping,
          lastError: null,
        };
      } catch (error) {
        lastError = error.message;
        return {
          ...status,
          lastError,
        };
      }
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
        async saveState(state) {
          await client.set(redisKey, JSON.stringify(state));
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
    createWebAuthStore() {
      const sessionPrefix = buildKey(keyPrefix, 'web-session');
      const loginAttemptPrefix = buildKey(keyPrefix, 'web-login-attempt');

      return {
        async getSession(token) {
          const raw = await client.get(`${sessionPrefix}:${token}`);
          if (!raw) {
            return null;
          }

          return parseWebSession(raw);
        },
        async createSession({ token, expiresAt, ttlMs }) {
          await client.set(`${sessionPrefix}:${token}`, JSON.stringify({ expiresAt }), {
            PX: ttlMs,
          });
        },
        async deleteSession(token) {
          await client.del(`${sessionPrefix}:${token}`);
        },
        async getLoginAttempt(key) {
          const raw = await client.get(`${loginAttemptPrefix}:${key}`);
          if (!raw) {
            return null;
          }

          return parseWebLoginAttempt(raw);
        },
        async setLoginAttempt(key, entry, ttlMs) {
          await client.set(`${loginAttemptPrefix}:${key}`, JSON.stringify(entry), {
            PX: ttlMs,
          });
        },
        async clearLoginAttempt(key) {
          await client.del(`${loginAttemptPrefix}:${key}`);
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
