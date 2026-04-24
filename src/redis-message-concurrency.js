import { ProxyError } from './anthropic.js';

const DEFAULT_LEASE_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

const TRY_ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[3]), ARGV[4])
  return {1, count + 1}
end
return {0, count}
`;

const HEARTBEAT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[1], ARGV[3]) then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[2]), ARGV[3])
end
return redis.call('ZCARD', KEYS[1])
`;

const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
return redis.call('ZCARD', KEYS[1])
`;

const STATUS_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZCARD', KEYS[1])
`;

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

async function runEval(client, script, keys, args) {
  const reply = await client.sendCommand([
    'EVAL',
    script,
    String(keys.length),
    ...keys,
    ...args.map((value) => String(value)),
  ]);

  return Array.isArray(reply) ? reply.map((value) => Number(value)) : Number(reply);
}

export function createRedisMessageConcurrencyManager({
  client,
  keyPrefix,
  maxConcurrent = 4,
  maxQueued = 16,
  onEvent = null,
  leaseMs = DEFAULT_LEASE_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  let localActive = 0;
  let localQueued = 0;
  let globalActive = 0;
  let currentMaxConcurrent = maxConcurrent;
  let currentMaxQueued = maxQueued;
  const semaphoreKey = buildKey(keyPrefix, 'message-concurrency');
  const waiters = new Set();

  function snapshot() {
    return {
      backend: 'redis-global',
      enabled: currentMaxConcurrent > 0,
      maxConcurrent: currentMaxConcurrent,
      maxQueued: currentMaxQueued,
      active: localActive,
      queued: localQueued,
      globalActive,
    };
  }

  function emit(type, payload = {}) {
    onEvent?.(type, {
      ...snapshot(),
      ...payload,
    });
  }

  async function refreshGlobalActive() {
    globalActive = Number(await runEval(client, STATUS_SCRIPT, [semaphoreKey], [Date.now()]));
    return globalActive;
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
      void runEval(client, RELEASE_SCRIPT, [semaphoreKey], [token, Date.now()])
        .then((count) => {
          globalActive = Number(count);
          emit('released', { requestId, token });
        })
        .catch((error) => {
          emit('redis_error', {
            requestId,
            token,
            error: error.message,
          });
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
        emit('rejected', {
          requestId,
          reason: 'queue_full',
        });
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
        let heartbeatTimer = null;
        let pollTimer = null;
        let waiting = false;
        let settled = false;

        async function cancelWaiting(reason) {
          if (settled) {
            return;
          }
          settled = true;
          if (waiting) {
            localQueued = Math.max(0, localQueued - 1);
          }
          cleanup();
          emit('aborted', {
            requestId,
            token,
            reason,
          });
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
            globalActive = Number(
              await runEval(client, HEARTBEAT_SCRIPT, [semaphoreKey], [
                Date.now(),
                Date.now() + leaseMs,
                token,
              ]),
            );
          } catch (error) {
            emit('redis_error', {
              requestId,
              token,
              error: error.message,
            });
          }
        }

        async function attempt() {
          if (settled) {
            return;
          }

          try {
            const [acquired, activeCount] = await runEval(client, TRY_ACQUIRE_SCRIPT, [semaphoreKey], [
              Date.now(),
              currentMaxConcurrent,
              Date.now() + leaseMs,
              token,
            ]);
            globalActive = Number(activeCount);

            if (Number(acquired) === 1) {
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
                queuePosition: localQueued,
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
            emit('redis_error', {
              requestId,
              token,
              error: error.message,
            });
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
    configure({ maxConcurrent, maxQueued }) {
      currentMaxConcurrent = maxConcurrent;
      currentMaxQueued = maxQueued;
    },
    getStatus() {
      return snapshot();
    },
    async getLiveStatus() {
      await refreshGlobalActive();
      return snapshot();
    },
    clearQueue() {
      for (const cancelWaiting of [...waiters]) {
        void cancelWaiting('queue_cleared');
      }
    },
  };
}
