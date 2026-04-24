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

export function createProxyApiKeyManager({ initialApiKey = '', loadedState = null, storage = null } = {}) {
  const bootstrapApiKey = String(initialApiKey || '').trim();
  let currentApiKey = bootstrapApiKey;
  let updatedAt = currentApiKey ? new Date().toISOString() : null;

  if (loadedState?.proxyApiKey) {
    currentApiKey = loadedState.proxyApiKey;
    updatedAt = loadedState.updatedAt || updatedAt || new Date().toISOString();
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
    });
  }

  function getStatus() {
    return {
      configured: Boolean(currentApiKey),
      maskedApiKey: maskProxyApiKey(currentApiKey),
      updatedAt,
    };
  }

  async function setApiKey(apiKey) {
    const nextApiKey = validateProxyApiKeyInput(apiKey);
    const nextUpdatedAt = new Date().toISOString();
    await persistState(nextApiKey, nextUpdatedAt);
    currentApiKey = nextApiKey;
    updatedAt = nextUpdatedAt;

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
    getStatus,
    async resetApiKey(apiKey = '') {
      const nextApiKey = String(apiKey || '').trim();
      const nextUpdatedAt = nextApiKey ? new Date().toISOString() : null;
      await persistState(nextApiKey, nextUpdatedAt);
      currentApiKey = nextApiKey;
      updatedAt = nextUpdatedAt;
      return {
        apiKey: currentApiKey || null,
        ...getStatus(),
      };
    },
    setApiKey,
    generateNewApiKey,
  };
}
