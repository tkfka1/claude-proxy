import crypto from 'node:crypto';

const GENERATED_KEY_BYTES = 24;

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
    throw new Error('x-api-key must not be empty');
  }

  if (value.length < 8) {
    throw new Error('x-api-key must be at least 8 characters long');
  }

  return value;
}

export function generateProxyApiKey() {
  return crypto.randomBytes(GENERATED_KEY_BYTES).toString('base64url');
}

export function createProxyApiKeyManager({ initialApiKey = '' } = {}) {
  let currentApiKey = String(initialApiKey || '').trim();
  let updatedAt = currentApiKey ? new Date().toISOString() : null;

  function getStatus() {
    return {
      configured: Boolean(currentApiKey),
      maskedApiKey: maskProxyApiKey(currentApiKey),
      updatedAt,
    };
  }

  function setApiKey(apiKey) {
    currentApiKey = validateProxyApiKeyInput(apiKey);
    updatedAt = new Date().toISOString();

    return {
      apiKey: currentApiKey,
      ...getStatus(),
    };
  }

  function generateNewApiKey() {
    return setApiKey(generateProxyApiKey());
  }

  return {
    getApiKey() {
      return currentApiKey;
    },
    getStatus,
    resetApiKey(apiKey = '') {
      currentApiKey = String(apiKey || '').trim();
      updatedAt = currentApiKey ? new Date().toISOString() : null;
      return {
        apiKey: currentApiKey || null,
        ...getStatus(),
      };
    },
    setApiKey,
    generateNewApiKey,
  };
}
