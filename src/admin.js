import { readFileSync } from 'node:fs';

import { createRedisStateStore, buildRedisKey } from './redis-state-store.js';
import { createScryptPasswordHash, validateNewWebPassword } from './web-auth.js';
import { generateProxyApiKey, maskProxyApiKey, validateProxyApiKeyInput } from './proxy-api-key.js';

const DEFAULT_REDIS_KEY_PREFIX = 'claude-anthropic-proxy';

function stripFinalNewline(value) {
  return String(value ?? '').replace(/\r?\n$/, '');
}

async function readAll(stream) {
  let output = '';
  stream.setEncoding?.('utf8');
  for await (const chunk of stream) {
    output += chunk;
  }
  return output;
}

function createBaseOptions() {
  return {
    command: null,
    password: null,
    passwordFile: null,
    apiKey: null,
    apiKeyFile: null,
    readStdin: false,
    redisUrl: null,
    redisKeyPrefix: null,
    clearSessions: true,
    help: false,
  };
}

function parseOptions(argv) {
  const options = createBaseOptions();
  const args = [...argv];
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    options.help = true;
    return options;
  }

  if (args[0] === 'web-password' && args[1] === 'reset') {
    options.command = 'web-password-reset';
    args.splice(0, 2);
  } else if (args[0] === 'reset-web-password') {
    options.command = 'web-password-reset';
    args.splice(0, 1);
  } else if (['proxy-key', 'proxy-api-key', 'x-api-key'].includes(args[0]) && args[1] === 'reset') {
    options.command = 'proxy-key-reset';
    args.splice(0, 2);
  } else if (['proxy-key', 'proxy-api-key', 'x-api-key'].includes(args[0]) && args[1] === 'generate') {
    options.command = 'proxy-key-generate';
    args.splice(0, 2);
  } else if (args[0] === 'reset-proxy-key' || args[0] === 'reset-proxy-api-key') {
    options.command = 'proxy-key-reset';
    args.splice(0, 1);
  } else {
    throw new Error(`Unknown admin command: ${args[0] || '(empty)'}`);
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[index + 1];
      if (value == null || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--password') {
      options.password = next();
    } else if (arg === '--password-file') {
      options.passwordFile = next();
    } else if (arg === '--key' || arg === '--api-key') {
      options.apiKey = next();
    } else if (arg === '--key-file' || arg === '--api-key-file') {
      options.apiKeyFile = next();
    } else if (arg === '--stdin') {
      options.readStdin = true;
    } else if (arg === '--redis-url') {
      options.redisUrl = next();
    } else if (arg === '--redis-key-prefix') {
      options.redisKeyPrefix = next();
    } else if (arg === '--keep-sessions') {
      options.clearSessions = false;
    } else {
      throw new Error(`Unknown admin option: ${arg}`);
    }
  }

  if (options.command === 'web-password-reset') {
    const passwordSources = [options.password != null, options.passwordFile != null, options.readStdin]
      .filter(Boolean)
      .length;
    if (passwordSources !== 1) {
      throw new Error('Provide exactly one password source: --password, --password-file, or --stdin');
    }
    if (options.apiKey != null || options.apiKeyFile != null) {
      throw new Error('Use --password, --password-file, or --stdin with web-password reset');
    }
  }

  if (options.command === 'proxy-key-reset') {
    const apiKeySources = [options.apiKey != null, options.apiKeyFile != null, options.readStdin]
      .filter(Boolean)
      .length;
    if (apiKeySources !== 1) {
      throw new Error('Provide exactly one x-api-key source: --key, --key-file, or --stdin');
    }
    if (options.password != null || options.passwordFile != null || !options.clearSessions) {
      throw new Error('Use --key, --key-file, or --stdin with proxy-key reset');
    }
  }

  if (options.command === 'proxy-key-generate') {
    const hasUnsupportedGenerateOption = options.password != null
      || options.passwordFile != null
      || options.apiKey != null
      || options.apiKeyFile != null
      || options.readStdin
      || !options.clearSessions;

    if (hasUnsupportedGenerateOption) {
      throw new Error('proxy-key generate only accepts Redis connection options');
    }
  }

  return options;
}

async function resolvePassword(options, stdin) {
  if (options.password != null) {
    return options.password;
  }

  if (options.passwordFile) {
    return stripFinalNewline(readFileSync(options.passwordFile, 'utf8'));
  }

  return stripFinalNewline(await readAll(stdin));
}

async function resolveApiKey(options, stdin) {
  if (options.apiKey != null) {
    return options.apiKey;
  }

  if (options.apiKeyFile) {
    return stripFinalNewline(readFileSync(options.apiKeyFile, 'utf8'));
  }

  return stripFinalNewline(await readAll(stdin));
}

async function listKeysByPattern(client, pattern) {
  if (typeof client.keys === 'function') {
    return client.keys(pattern);
  }

  if (typeof client.scanIterator === 'function') {
    const keys = [];
    for await (const key of client.scanIterator({ MATCH: pattern })) {
      keys.push(key);
    }
    return keys;
  }

  return [];
}

async function deleteKeys(client, keys) {
  let deleted = 0;
  for (const key of keys) {
    deleted += Number(await client.del(key)) || 0;
  }
  return deleted;
}

async function closeRedisStore(store) {
  if (typeof store.client.quit === 'function') {
    await store.client.quit();
    return;
  }

  if (typeof store.client.disconnect === 'function') {
    await store.client.disconnect();
  }
}

export async function resetWebPassword({
  password,
  redisUrl = process.env.REDIS_URL || '',
  redisKeyPrefix = process.env.REDIS_KEY_PREFIX || DEFAULT_REDIS_KEY_PREFIX,
  clearSessions = true,
  clientFactory,
} = {}) {
  const nextPassword = validateNewWebPassword(password);

  if (!redisUrl) {
    throw new Error('REDIS_URL is required to reset the runtime web password');
  }

  const store = await createRedisStateStore({
    url: redisUrl,
    keyPrefix: redisKeyPrefix,
    clientFactory,
  });

  try {
    const updatedAt = new Date().toISOString();
    await store.createWebAuthStore().setPasswordState({
      passwordHash: createScryptPasswordHash(nextPassword),
      updatedAt,
    });

    let clearedSessions = 0;
    let clearedLoginAttempts = 0;
    if (clearSessions) {
      clearedSessions = await deleteKeys(
        store.client,
        await listKeysByPattern(store.client, `${buildRedisKey(redisKeyPrefix, 'web-session')}:*`),
      );
      clearedLoginAttempts = await deleteKeys(
        store.client,
        await listKeysByPattern(store.client, `${buildRedisKey(redisKeyPrefix, 'web-login-attempt')}:*`),
      );
    }

    return {
      updatedAt,
      redisKeyPrefix,
      clearedSessions,
      clearedLoginAttempts,
    };
  } finally {
    await closeRedisStore(store);
  }
}

export async function resetProxyApiKey({
  apiKey,
  redisUrl = process.env.REDIS_URL || '',
  redisKeyPrefix = process.env.REDIS_KEY_PREFIX || DEFAULT_REDIS_KEY_PREFIX,
  clientFactory,
} = {}) {
  const nextApiKey = validateProxyApiKeyInput(apiKey);

  if (!redisUrl) {
    throw new Error('REDIS_URL is required to reset the runtime x-api-key');
  }

  const store = await createRedisStateStore({
    url: redisUrl,
    keyPrefix: redisKeyPrefix,
    clientFactory,
  });

  try {
    const updatedAt = new Date().toISOString();
    const maskedApiKey = maskProxyApiKey(nextApiKey);
    await store.createProxyApiKeyStore().saveState({
      proxyApiKey: nextApiKey,
      updatedAt,
      previousApiKeys: [],
      history: [
        {
          maskedApiKey,
          activatedAt: updatedAt,
          retiredAt: null,
          expiresAt: null,
        },
      ],
    });

    return {
      updatedAt,
      redisKeyPrefix,
      maskedApiKey,
    };
  } finally {
    await closeRedisStore(store);
  }
}

export function adminUsage() {
  return `Usage:
  claude-proxy-admin web-password reset --password-file <path> [--redis-url <url>] [--redis-key-prefix <prefix>]
  claude-proxy-admin web-password reset --stdin [--redis-url <url>] [--redis-key-prefix <prefix>]
  claude-proxy-admin reset-web-password --password <value> [--keep-sessions]
  claude-proxy-admin proxy-key reset --key-file <path> [--redis-url <url>] [--redis-key-prefix <prefix>]
  claude-proxy-admin proxy-key reset --stdin [--redis-url <url>] [--redis-key-prefix <prefix>]
  claude-proxy-admin proxy-key generate [--redis-url <url>] [--redis-key-prefix <prefix>]

Options:
  --password <value>          New console password. Prefer --password-file or --stdin in production.
  --password-file <path>      Read the new password from a file, stripping one trailing newline.
  --key <value>               New proxy x-api-key. Prefer --key-file or --stdin in production.
  --key-file <path>           Read the new x-api-key from a file, stripping one trailing newline.
  --stdin                     Read the password or x-api-key from stdin, stripping one trailing newline.
  --redis-url <url>           Redis URL. Defaults to REDIS_URL.
  --redis-key-prefix <value>  Redis key prefix. Defaults to REDIS_KEY_PREFIX or ${DEFAULT_REDIS_KEY_PREFIX}.
  --keep-sessions             Do not clear existing web sessions or login-attempt counters for web-password reset.
`;
}

export async function runAdminCli(
  argv = process.argv.slice(2),
  {
    env = process.env,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    clientFactory,
  } = {},
) {
  try {
    const options = parseOptions(argv);
    if (options.help) {
      stdout.write(adminUsage());
      return 0;
    }

    const redisUrl = options.redisUrl || env.REDIS_URL || '';
    const redisKeyPrefix = options.redisKeyPrefix || env.REDIS_KEY_PREFIX || DEFAULT_REDIS_KEY_PREFIX;

    if (options.command === 'web-password-reset') {
      const result = await resetWebPassword({
        password: await resolvePassword(options, stdin),
        redisUrl,
        redisKeyPrefix,
        clearSessions: options.clearSessions,
        clientFactory,
      });

      stdout.write([
        'Web console password reset complete.',
        `updatedAt=${result.updatedAt}`,
        `redisKeyPrefix=${result.redisKeyPrefix}`,
        `clearedSessions=${result.clearedSessions}`,
        `clearedLoginAttempts=${result.clearedLoginAttempts}`,
        'runtimeReload=on-next-request',
        '',
      ].join('\n'));
      return 0;
    }

    const generatedApiKey = options.command === 'proxy-key-generate' ? generateProxyApiKey() : null;
    const nextApiKey = generatedApiKey || await resolveApiKey(options, stdin);
    const result = await resetProxyApiKey({
      apiKey: nextApiKey,
      redisUrl,
      redisKeyPrefix,
      clientFactory,
    });

    stdout.write([
      generatedApiKey ? 'Proxy x-api-key generated and reset complete.' : 'Proxy x-api-key reset complete.',
      `updatedAt=${result.updatedAt}`,
      `redisKeyPrefix=${result.redisKeyPrefix}`,
      `maskedApiKey=${result.maskedApiKey}`,
      'runtimeReload=within-1s',
      generatedApiKey ? `apiKey=${generatedApiKey}` : null,
      '',
    ].filter((line) => line != null).join('\n'));
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n\n${adminUsage()}`);
    return 1;
  }
}
