import crypto from 'node:crypto';

const GENERATED_KEY_BYTES = 24;

function createProxyApiKeyError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function maskProxyApiKey(apiKey) {
  const value = String(apiKey || '');
  if (!value) {
    return null;
  }

  if (value.length <= 6) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

export function validateProxyApiKeyInput(apiKey) {
  const value = String(apiKey || '').trim();

  if (!value) {
    throw createProxyApiKeyError('x-api-key must not be empty', 400);
  }

  if (value.length < 8) {
    throw createProxyApiKeyError('x-api-key must be at least 8 characters long', 400);
  }

  return value;
}

export function generateProxyApiKey() {
  return crypto.randomBytes(GENERATED_KEY_BYTES).toString('base64url');
}

function earlierIso(first, second) {
  if (!first) return second || null;
  if (!second) return first || null;
  return Date.parse(first) <= Date.parse(second) ? first : second;
}

function normalizePreviousApiKeys(entries = [], gracePeriodSeconds = 300) {
  if (gracePeriodSeconds <= 0) {
    return [];
  }

  const now = Date.now();
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const retiredAt = entry.retiredAt || null;
      const configuredExpiresAt = Number.isFinite(Date.parse(retiredAt))
        ? new Date(Date.parse(retiredAt) + gracePeriodSeconds * 1000).toISOString()
        : null;

      return {
        apiKey: String(entry.apiKey || '').trim(),
        retiredAt,
        expiresAt: earlierIso(entry.expiresAt || null, configuredExpiresAt),
      };
    })
    .filter((entry) => entry.apiKey)
    .filter((entry) => entry.expiresAt && Date.parse(entry.expiresAt) > now);
}

function normalizeHistory(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      maskedApiKey: entry.maskedApiKey || null,
      activatedAt: entry.activatedAt || null,
      retiredAt: entry.retiredAt || null,
      expiresAt: entry.expiresAt || null,
    }));
}

function createHistoryEntry({ apiKey, activatedAt, retiredAt = null, expiresAt = null }) {
  return {
    maskedApiKey: maskProxyApiKey(apiKey),
    activatedAt,
    retiredAt,
    expiresAt,
  };
}

export function createProxyApiKeyManager({
  initialApiKey = '',
  loadedState = null,
  storage = null,
  gracePeriodSeconds = 300,
  historyLimit = 5,
} = {}) {
  const bootstrapApiKey = String(initialApiKey || '').trim();
  let currentApiKey = bootstrapApiKey;
  let updatedAt = currentApiKey ? new Date().toISOString() : null;
  let previousApiKeys = [];
  let history = [];

  if (loadedState?.proxyApiKey) {
    currentApiKey = loadedState.proxyApiKey;
    updatedAt = loadedState.updatedAt || updatedAt || new Date().toISOString();
    previousApiKeys = normalizePreviousApiKeys(loadedState.previousApiKeys, gracePeriodSeconds);
    history = normalizeHistory(loadedState.history);
  }

  if (currentApiKey && history.length === 0) {
    history = [createHistoryEntry({ apiKey: currentApiKey, activatedAt: updatedAt })];
  }

  function prunePreviousApiKeys() {
    previousApiKeys = normalizePreviousApiKeys(previousApiKeys, gracePeriodSeconds);
  }

  function trimHistory() {
    if (historyLimit <= 0) {
      history = [];
      return;
    }

    history = history.slice(0, historyLimit);
  }

  async function persistState(nextApiKey, nextUpdatedAt) {
    if (!storage) {
      return;
    }

    if (!nextApiKey) {
      await storage.clearState();
      return;
    }

    await storage.saveState({
      proxyApiKey: nextApiKey,
      updatedAt: nextUpdatedAt,
      previousApiKeys,
      history,
    });
  }

  function getStatus() {
    prunePreviousApiKeys();
    return {
      configured: Boolean(currentApiKey),
      maskedApiKey: maskProxyApiKey(currentApiKey),
      updatedAt,
      gracePeriodSeconds,
      previousKeyCount: previousApiKeys.length,
      previousKeys: previousApiKeys.map((entry) => ({
        maskedApiKey: maskProxyApiKey(entry.apiKey),
        retiredAt: entry.retiredAt,
        expiresAt: entry.expiresAt,
      })),
      history,
    };
  }

  function rotateTo(nextApiKey, nextUpdatedAt) {
    prunePreviousApiKeys();
    if (currentApiKey === nextApiKey) {
      updatedAt = nextUpdatedAt;
      if (history.length === 0) {
        history.unshift(createHistoryEntry({ apiKey: nextApiKey, activatedAt: nextUpdatedAt }));
      }
      trimHistory();
      return;
    }

    previousApiKeys = previousApiKeys.filter((entry) => entry.apiKey !== nextApiKey);
    if (currentApiKey && currentApiKey !== nextApiKey && gracePeriodSeconds > 0) {
      const expiresAt = new Date(Date.now() + gracePeriodSeconds * 1000).toISOString();
      previousApiKeys.unshift({
        apiKey: currentApiKey,
        retiredAt: nextUpdatedAt,
        expiresAt,
      });
      if (history.length > 0) {
        history[0] = {
          ...history[0],
          retiredAt: nextUpdatedAt,
          expiresAt,
        };
      }
    }

    currentApiKey = nextApiKey;
    updatedAt = nextUpdatedAt;
    history.unshift(createHistoryEntry({ apiKey: nextApiKey, activatedAt: nextUpdatedAt }));
    trimHistory();
  }

  async function setApiKey(apiKey) {
    const nextApiKey = validateProxyApiKeyInput(apiKey);
    const nextUpdatedAt = new Date().toISOString();
    rotateTo(nextApiKey, nextUpdatedAt);
    await persistState(nextApiKey, nextUpdatedAt);

    return {
      apiKey: currentApiKey,
      ...getStatus(),
    };
  }

  async function generateNewApiKey() {
    return setApiKey(generateProxyApiKey());
  }

  return {
    getApiKey() {
      return currentApiKey;
    },
    verifyApiKey(apiKey) {
      const value = String(apiKey || '').trim();
      prunePreviousApiKeys();

      if (currentApiKey && value === currentApiKey) {
        return {
          valid: true,
          matched: 'current',
          expiresAt: null,
        };
      }

      const previous = previousApiKeys.find((entry) => entry.apiKey === value);
      if (previous) {
        return {
          valid: true,
          matched: 'previous',
          expiresAt: previous.expiresAt,
        };
      }

      return {
        valid: false,
        matched: null,
        expiresAt: null,
      };
    },
    getStatus,
    async resetApiKey(apiKey = '') {
      const nextApiKey = String(apiKey || '').trim();
      const nextUpdatedAt = nextApiKey ? new Date().toISOString() : null;
      if (nextApiKey) {
        rotateTo(nextApiKey, nextUpdatedAt);
      } else {
        currentApiKey = '';
        updatedAt = null;
        previousApiKeys = [];
        history = [];
      }
      await persistState(nextApiKey, nextUpdatedAt);
      return {
        apiKey: currentApiKey || null,
        ...getStatus(),
      };
    },
    setApiKey,
    generateNewApiKey,
  };
}
