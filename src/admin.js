import { readFileSync } from 'node:fs';

import { createRedisStateStore, buildRedisKey } from './redis-state-store.js';
import { createScryptPasswordHash, validateNewWebPassword } from './web-auth.js';

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

function parseOptions(argv) {
  const options = {
    command: null,
    password: null,
    passwordFile: null,
    readStdin: false,
    redisUrl: null,
    redisKeyPrefix: null,
    clearSessions: true,
    help: false,
  };

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

  const passwordSources = [options.password != null, options.passwordFile != null, options.readStdin]
    .filter(Boolean)
    .length;
  if (passwordSources !== 1) {
    throw new Error('Provide exactly one password source: --password, --password-file, or --stdin');
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

export function adminUsage() {
  return `Usage:
  claude-proxy-admin web-password reset --password-file <path> [--redis-url <url>] [--redis-key-prefix <prefix>]
  claude-proxy-admin web-password reset --stdin [--redis-url <url>] [--redis-key-prefix <prefix>]
  claude-proxy-admin reset-web-password --password <value> [--keep-sessions]

Options:
  --password <value>          New console password. Prefer --password-file or --stdin in production.
  --password-file <path>      Read the new password from a file, stripping one trailing newline.
  --stdin                     Read the new password from stdin, stripping one trailing newline.
  --redis-url <url>           Redis URL. Defaults to REDIS_URL.
  --redis-key-prefix <value>  Redis key prefix. Defaults to REDIS_KEY_PREFIX or ${DEFAULT_REDIS_KEY_PREFIX}.
  --keep-sessions             Do not clear existing web sessions or login-attempt counters.
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

    const result = await resetWebPassword({
      password: await resolvePassword(options, stdin),
      redisUrl: options.redisUrl || env.REDIS_URL || '',
      redisKeyPrefix: options.redisKeyPrefix || env.REDIS_KEY_PREFIX || DEFAULT_REDIS_KEY_PREFIX,
      clearSessions: options.clearSessions,
      clientFactory,
    });

    stdout.write([
      'Web console password reset complete.',
      `updatedAt=${result.updatedAt}`,
      `redisKeyPrefix=${result.redisKeyPrefix}`,
      `clearedSessions=${result.clearedSessions}`,
      `clearedLoginAttempts=${result.clearedLoginAttempts}`,
      '',
    ].join('\n'));
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n\n${adminUsage()}`);
    return 1;
  }
}
