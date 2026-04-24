import { ProxyError } from './anthropic.js';

const DEFAULT_LEASE_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

const ACQUIRE_OR_QUEUE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local queueTokens = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, queuedToken in ipairs(queueTokens) do
  local heartbeat = tonumber(redis.call('HGET', KEYS[3], queuedToken) or '0')
  if heartbeat <= tonumber(ARGV[1]) then
    redis.call('ZREM', KEYS[2], queuedToken)
    redis.call('HDEL', KEYS[3], queuedToken)
  end
end

local token = ARGV[6]
local alreadyQueued = redis.call('ZSCORE', KEYS[2], token)
local queueLen = redis.call('ZCARD', KEYS[2])

if not alreadyQueued then
  if queueLen >= tonumber(ARGV[3]) then
    return {2, queueLen, redis.call('ZCARD', KEYS[1]), 0}
  end

  local seq = redis.call('INCR', KEYS[4])
  redis.call('ZADD', KEYS[2], seq, token)
  queueLen = queueLen + 1
end

redis.call('HSET', KEYS[3], token, ARGV[5])

local activeCount = redis.call('ZCARD', KEYS[1])
local head = redis.call('ZRANGE', KEYS[2], 0, 0)[1]
if head == token and activeCount < tonumber(ARGV[2]) then
  redis.call('ZREM', KEYS[2], token)
  redis.call('HDEL', KEYS[3], token)
  redis.call('ZADD', KEYS[1], ARGV[4], token)
  return {1, queueLen - 1, activeCount + 1, 0}
end

local rank = redis.call('ZRANK', KEYS[2], token)
return {0, queueLen, activeCount, (rank or -1) + 1}
`;

const ACTIVE_HEARTBEAT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[1], ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
end
return redis.call('ZCARD', KEYS[1])
`;

const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
return redis.call('ZCARD', KEYS[1])
`;

const CANCEL_QUEUE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return redis.call('ZCARD', KEYS[1])
`;

const STATUS_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local queueTokens = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, queuedToken in ipairs(queueTokens) do
  local heartbeat = tonumber(redis.call('HGET', KEYS[3], queuedToken) or '0')
  if heartbeat <= tonumber(ARGV[1]) then
    redis.call('ZREM', KEYS[2], queuedToken)
    redis.call('HDEL', KEYS[3], queuedToken)
  end
end
return {redis.call('ZCARD', KEYS[1]), redis.call('ZCARD', KEYS[2])}
`;

function sanitizeKeySegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '-')
    .replace(/-+/g, '-');
}

function buildKey(prefix, suffix) {
  const safePrefix = sanitizeKeySegment(prefix || 'claude-anthropic-proxy');
  return `${safePrefix}:${suffix}`;
}

async function runEval(client, script, keys, args) {
  const reply = await client.sendCommand([
    'EVAL',
    script,
    String(keys.length),
    ...keys,
    ...args.map((value) => String(value)),
  ]);

  return Array.isArray(reply) ? reply.map((value) => Number(value)) : [Number(reply)];
}

export function createRedisMessageConcurrencyManager({
  client,
  keyPrefix,
  maxConcurrent = 4,
  maxQueued = 16,
  maxWaitMs = 30_000,
  onEvent = null,
  leaseMs = DEFAULT_LEASE_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  let currentMaxConcurrent = maxConcurrent;
  let currentMaxQueued = maxQueued;
  let currentMaxWaitMs = maxWaitMs;
  let localActive = 0;
  let localQueued = 0;
  let globalActive = 0;
  let globalQueued = 0;
  const activeKey = buildKey(keyPrefix, 'message-concurrency:active');
  const queueKey = buildKey(keyPrefix, 'message-concurrency:queue');
  const queueHeartbeatKey = buildKey(keyPrefix, 'message-concurrency:queue-heartbeat');
  const queueSequenceKey = buildKey(keyPrefix, 'message-concurrency:queue-sequence');
  const waiters = new Set();

  function snapshot() {
    return {
      backend: 'redis-global',
      enabled: currentMaxConcurrent > 0,
      maxConcurrent: currentMaxConcurrent,
      maxQueued: currentMaxQueued,
      maxWaitMs: currentMaxWaitMs,
      active: localActive,
      queued: localQueued,
      globalActive,
      globalQueued,
    };
  }

  function emit(type, payload = {}) {
    onEvent?.(type, {
      ...snapshot(),
      ...payload,
    });
  }

  async function refreshLiveCounts() {
    const [activeCount, queuedCount] = await runEval(
      client,
      STATUS_SCRIPT,
      [activeKey, queueKey, queueHeartbeatKey],
      [Date.now()],
    );
    globalActive = Number(activeCount);
    globalQueued = Number(queuedCount);
    return snapshot();
  }

  function createRelease({ requestId, token, heartbeatTimer }) {
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      clearInterval(heartbeatTimer);
      localActive = Math.max(0, localActive - 1);
      void runEval(client, RELEASE_SCRIPT, [activeKey], [token, Date.now()])
        .then(([activeCount]) => {
          globalActive = Number(activeCount);
          emit('released', { requestId, token });
        })
        .catch((error) => {
          emit('redis_error', { requestId, token, error: error.message });
        });
    };
  }

  return {
    acquire({ requestId, signal }) {
      if (currentMaxConcurrent <= 0) {
        return Promise.resolve({
          waitedMs: 0,
          release() {},
        });
      }

      if (localQueued >= currentMaxQueued) {
        emit('rejected', { requestId, reason: 'queue_full' });
        return Promise.reject(
          new ProxyError(
            429,
            'rate_limit_error',
            'Too many concurrent /v1/messages requests. Please retry shortly.',
          ),
        );
      }

      return new Promise((resolve, reject) => {
        const token = `${process.pid}:${requestId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
        const enqueuedAt = Date.now();
        let settled = false;
        let waiting = false;
        let pollTimer = null;
        let heartbeatTimer = null;

        async function cancelWaiting(reason) {
          if (settled) return;
          settled = true;
          if (waiting) {
            localQueued = Math.max(0, localQueued - 1);
          }
          cleanup();
          try {
            const [queueCount] = await runEval(client, CANCEL_QUEUE_SCRIPT, [queueKey, queueHeartbeatKey], [token]);
            globalQueued = Number(queueCount);
          } catch (error) {
            emit('redis_error', { requestId, token, error: error.message });
          }
          emit('aborted', { requestId, token, reason });
          reject(new Error('Request aborted while waiting for a distributed execution slot'));
        }

        const abortHandler = () => {
          void cancelWaiting('signal_aborted_while_waiting');
        };

        function cleanup() {
          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
          }
          if (signal) {
            signal.removeEventListener('abort', abortHandler);
          }
          waiters.delete(cancelWaiting);
        }

        async function heartbeat() {
          try {
            const [activeCount] = await runEval(client, ACTIVE_HEARTBEAT_SCRIPT, [activeKey], [
              Date.now(),
              Date.now() + leaseMs,
              token,
            ]);
            globalActive = Number(activeCount);
          } catch (error) {
            emit('redis_error', { requestId, token, error: error.message });
          }
        }

        async function attempt() {
          if (settled) {
            return;
          }

          try {
            if (currentMaxWaitMs > 0 && Date.now() - enqueuedAt >= currentMaxWaitMs) {
              settled = true;
              if (waiting) {
                localQueued = Math.max(0, localQueued - 1);
              }
              cleanup();
              try {
                const [queueCount] = await runEval(client, CANCEL_QUEUE_SCRIPT, [queueKey, queueHeartbeatKey], [token]);
                globalQueued = Number(queueCount);
              } catch (cancelError) {
                emit('redis_error', { requestId, token, error: cancelError.message });
              }
              emit('rejected', {
                requestId,
                token,
                reason: 'queue_timeout',
              });
              reject(
                new ProxyError(
                  429,
                  'rate_limit_error',
                  `Timed out waiting ${currentMaxWaitMs}ms for a /v1/messages execution slot. Please retry shortly.`,
                ),
              );
              return;
            }

            const [statusCode, queueCount, activeCount, queuePosition] = await runEval(
              client,
              ACQUIRE_OR_QUEUE_SCRIPT,
              [activeKey, queueKey, queueHeartbeatKey, queueSequenceKey],
              [
                Date.now(),
                currentMaxConcurrent,
                currentMaxQueued,
                Date.now() + leaseMs,
                Date.now() + leaseMs,
                token,
              ],
            );

            globalActive = Number(activeCount);
            globalQueued = Number(queueCount);

            if (Number(statusCode) === 2) {
              settled = true;
              cleanup();
              emit('rejected', { requestId, token, reason: 'queue_full_global' });
              reject(
                new ProxyError(
                  429,
                  'rate_limit_error',
                  'Too many concurrent /v1/messages requests. Please retry shortly.',
                ),
              );
              return;
            }

            if (Number(statusCode) === 1) {
              settled = true;
              if (waiting) {
                localQueued = Math.max(0, localQueued - 1);
              }
              localActive += 1;
              cleanup();
              heartbeatTimer = setInterval(() => {
                void heartbeat();
              }, Math.max(1_000, Math.floor(leaseMs / 2)));
              emit('acquired', {
                requestId,
                token,
                waitedMs: Date.now() - enqueuedAt,
              });
              resolve({
                waitedMs: Date.now() - enqueuedAt,
                release: createRelease({ requestId, token, heartbeatTimer }),
              });
              return;
            }

            if (!waiting) {
              waiting = true;
              localQueued += 1;
              emit('queued', {
                requestId,
                token,
                queuePosition,
              });
            }

            pollTimer = setTimeout(() => {
              pollTimer = null;
              void attempt();
            }, pollIntervalMs);
          } catch (error) {
            settled = true;
            if (waiting) {
              localQueued = Math.max(0, localQueued - 1);
            }
            cleanup();
            emit('redis_error', { requestId, token, error: error.message });
            reject(new ProxyError(503, 'api_error', `Redis concurrency gate failed: ${error.message}`));
          }
        }

        if (signal) {
          if (signal.aborted) {
            reject(new Error('Request aborted before execution slot acquisition'));
            return;
          }

          signal.addEventListener('abort', abortHandler, { once: true });
        }

        waiters.add(cancelWaiting);
        void attempt();
      });
    },
    configure({ maxConcurrent, maxQueued, maxWaitMs }) {
      currentMaxConcurrent = maxConcurrent;
      currentMaxQueued = maxQueued;
      currentMaxWaitMs = maxWaitMs;
    },
    getStatus() {
      return snapshot();
    },
    async getLiveStatus() {
      return refreshLiveCounts();
    },
    clearQueue() {
      for (const cancelWaiting of [...waiters]) {
        void cancelWaiting('queue_cleared');
      }
    },
  };
}
