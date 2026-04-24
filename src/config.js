import 'dotenv/config';

import { validateWebPasswordSettings } from './web-auth.js';

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
}

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

function parseIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

export function loadConfig() {
  const modelMap = parseJsonEnv('CLAUDE_MODEL_MAP_JSON', {});
  const extraArgs = parseJsonEnv('CLAUDE_EXTRA_ARGS_JSON', []);
  const webSessionTtlHours = parseIntegerEnv('WEB_SESSION_TTL_HOURS', 12);
  const webLoginMaxAttempts = parseIntegerEnv('WEB_LOGIN_MAX_ATTEMPTS', 5);
  const webLoginWindowMinutes = parseIntegerEnv('WEB_LOGIN_WINDOW_MINUTES', 15);

  if (!Array.isArray(extraArgs)) {
    throw new Error('CLAUDE_EXTRA_ARGS_JSON must be a JSON array');
  }

  if (webSessionTtlHours <= 0) {
    throw new Error('WEB_SESSION_TTL_HOURS must be greater than 0');
  }

  if (webLoginMaxAttempts < 0) {
    throw new Error('WEB_LOGIN_MAX_ATTEMPTS must be 0 or greater');
  }

  if (webLoginMaxAttempts > 0 && webLoginWindowMinutes <= 0) {
    throw new Error('WEB_LOGIN_WINDOW_MINUTES must be greater than 0 when WEB_LOGIN_MAX_ATTEMPTS is enabled');
  }

  validateWebPasswordSettings({
    webPassword: process.env.WEB_PASSWORD || '',
    webPasswordHash: process.env.WEB_PASSWORD_HASH || '',
  });

  return {
    host: process.env.HOST || '0.0.0.0',
    port: parseIntegerEnv('PORT', 8080),
    requestBodyLimitBytes: parseIntegerEnv('REQUEST_BODY_LIMIT_BYTES', 32 * 1024 * 1024),
    claudeBin: process.env.CLAUDE_BIN || 'claude',
    claudeDefaultModel: process.env.CLAUDE_DEFAULT_MODEL || 'sonnet',
    claudeModelMap: modelMap,
    claudeExtraArgs: extraArgs.map(String),
    proxyApiKey: process.env.PROXY_API_KEY || '',
    requireAnthropicVersion: parseBooleanEnv('REQUIRE_ANTHROPIC_VERSION', false),
    defaultAnthropicVersion: process.env.DEFAULT_ANTHROPIC_VERSION || '2023-06-01',
    allowMissingApiKeyHeader: parseBooleanEnv('ALLOW_MISSING_API_KEY_HEADER', true),
    enableRequestLogging: parseBooleanEnv('ENABLE_REQUEST_LOGGING', true),
    webPassword: process.env.WEB_PASSWORD || '',
    webPasswordHash: process.env.WEB_PASSWORD_HASH || '',
    webSessionTtlHours,
    webLoginMaxAttempts,
    webLoginWindowMinutes,
  };
}

export function resolveCliModel(requestedModel, config) {
  if (!requestedModel || typeof requestedModel !== 'string') {
    return config.claudeDefaultModel;
  }

  if (config.claudeModelMap[requestedModel]) {
    return config.claudeModelMap[requestedModel];
  }

  const normalized = requestedModel.toLowerCase();

  if (config.claudeModelMap[normalized]) {
    return config.claudeModelMap[normalized];
  }

  if (normalized === 'sonnet' || normalized === 'opus' || normalized === 'haiku') {
    return normalized;
  }

  if (normalized.includes('opus')) return 'opus';
  if (normalized.includes('haiku')) return 'haiku';
  if (normalized.includes('sonnet')) return 'sonnet';

  return requestedModel;
}
