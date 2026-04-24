import { ProxyError } from './anthropic.js';

function abortQueueEntry(entry) {
  entry.cancelled = true;
  if (entry.signal && entry.abortHandler) {
    entry.signal.removeEventListener('abort', entry.abortHandler);
  }
}

export function createMessageConcurrencyManager({ maxConcurrent = 4, maxQueued = 16, onEvent = null } = {}) {
  let active = 0;
  let queue = [];
  let currentMaxConcurrent = maxConcurrent;
  let currentMaxQueued = maxQueued;

  function emit(type, payload = {}) {
    onEvent?.(type, {
      active,
      queued: queue.length,
      maxConcurrent: currentMaxConcurrent,
      maxQueued: currentMaxQueued,
      ...payload,
    });
  }

  function getStatus() {
    return {
      enabled: currentMaxConcurrent > 0,
      maxConcurrent: currentMaxConcurrent,
      maxQueued: currentMaxQueued,
      active,
      queued: queue.length,
    };
  }

  function dispatchNext() {
    if (currentMaxConcurrent <= 0) {
      return;
    }

    while (active < currentMaxConcurrent && queue.length > 0) {
      const entry = queue.shift();
      if (!entry || entry.cancelled) {
        continue;
      }

      abortQueueEntry(entry);
      active += 1;
      const waitedMs = Date.now() - entry.enqueuedAt;
      emit('acquired', {
        requestId: entry.requestId,
        waitedMs,
      });
      entry.resolve({
        waitedMs,
        release: createRelease(entry.requestId),
      });
    }
  }

  function createRelease(requestId) {
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      active = Math.max(0, active - 1);
      emit('released', { requestId });
      dispatchNext();
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

      if (active < currentMaxConcurrent && queue.length === 0) {
        active += 1;
        emit('acquired', {
          requestId,
          waitedMs: 0,
        });
        return Promise.resolve({
          waitedMs: 0,
          release: createRelease(requestId),
        });
      }

      if (queue.length >= currentMaxQueued) {
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
        const entry = {
          requestId,
          enqueuedAt: Date.now(),
          resolve,
          reject,
          signal,
          abortHandler: null,
          cancelled: false,
        };

        if (signal) {
          if (signal.aborted) {
            emit('aborted', {
              requestId,
              reason: 'signal_aborted_before_queue',
            });
            reject(new Error('Request aborted before execution slot acquisition'));
            return;
          }

          entry.abortHandler = () => {
            const index = queue.indexOf(entry);
            if (index !== -1) {
              queue.splice(index, 1);
            }
            abortQueueEntry(entry);
            emit('aborted', {
              requestId,
              reason: 'signal_aborted_while_queued',
            });
            reject(new Error('Request aborted while waiting for an execution slot'));
          };
          signal.addEventListener('abort', entry.abortHandler, { once: true });
        }

        queue.push(entry);
        emit('queued', {
          requestId,
          queuePosition: queue.length,
        });
      });
    },
    configure({ maxConcurrent, maxQueued }) {
      currentMaxConcurrent = maxConcurrent;
      currentMaxQueued = maxQueued;
      dispatchNext();
    },
    getStatus,
    clearQueue() {
      for (const entry of queue) {
        abortQueueEntry(entry);
      }
      queue = [];
      active = 0;
    },
  };
}
