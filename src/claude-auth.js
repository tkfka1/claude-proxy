import { spawn } from 'node:child_process';
import { once } from 'node:events';

const MAX_OPERATION_LOG_CHARS = 12_000;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/g;

function trimLog(text) {
  if (text.length <= MAX_OPERATION_LOG_CHARS) {
    return text;
  }

  return text.slice(text.length - MAX_OPERATION_LOG_CHARS);
}

function normalizeAuthStatus(payload = {}) {
  return {
    loggedIn: Boolean(payload.loggedIn),
    authMethod: payload.authMethod || null,
    apiProvider: payload.apiProvider || null,
    email: payload.email || null,
    orgId: payload.orgId || null,
    orgName: payload.orgName || null,
    subscriptionType: payload.subscriptionType || null,
  };
}

function createAuthCommandError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

export async function runClaudeAuthStatus({ claudeBin }) {
  const child = spawn(claudeBin, ['auth', 'status', '--json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  let spawnError = null;

  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
  child.on('error', (error) => {
    spawnError = error;
  });

  const [code] = await once(child, 'close');
  const stdoutText = Buffer.concat(stdoutChunks).toString('utf8').trim();
  const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();

  if (spawnError) {
    throw createAuthCommandError(spawnError.message, {
      code,
      stderrText,
    });
  }

  if (!stdoutText) {
    if (code === 0) {
      return normalizeAuthStatus({});
    }

    throw createAuthCommandError(stderrText || `claude auth status exited with code ${code}`, {
      code,
      stderrText,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(stdoutText);
  } catch (error) {
    throw createAuthCommandError(`Failed to parse claude auth status JSON: ${error.message}`, {
      code,
      stdoutText,
      stderrText,
    });
  }

  return normalizeAuthStatus(parsed);
}

function appendOperationLog(operation, chunk) {
  operation.output = trimLog(`${operation.output}${chunk}`);
  operation.links = extractUrls(operation.output);
}

function extractUrls(text) {
  const matches = String(text || '').match(URL_PATTERN) || [];
  return [...new Set(matches)];
}

function finalizeOperation(operation, patch) {
  operation.status = patch.status;
  operation.endedAt = new Date().toISOString();
  operation.exitCode = patch.exitCode;
  operation.error = patch.error || null;
  operation.authStatus = patch.authStatus || null;
  operation.links = extractUrls(operation.output);
}

export function createClaudeAuthManager({ claudeBin }) {
  let currentOperation = {
    id: null,
    kind: null,
    status: 'idle',
    startedAt: null,
    endedAt: null,
    output: '',
    exitCode: null,
    error: null,
    authStatus: null,
    links: [],
    options: null,
  };

  function getOperation() {
    return { ...currentOperation };
  }

  async function getStatus() {
    return runClaudeAuthStatus({ claudeBin });
  }

  function startOperation(kind, args, options = {}) {
    if (currentOperation.status === 'running') {
      throw createAuthCommandError('Another Claude auth operation is already running.', {
        statusCode: 409,
        operation: getOperation(),
      });
    }

    const operation = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      output: '',
      exitCode: null,
      error: null,
      authStatus: null,
      links: [],
      options,
    };

    currentOperation = operation;

    const child = spawn(claudeBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    child.stdout.on('data', (chunk) => {
      appendOperationLog(operation, chunk.toString('utf8'));
    });

    child.stderr.on('data', (chunk) => {
      appendOperationLog(operation, chunk.toString('utf8'));
    });

    child.on('error', (error) => {
      finalizeOperation(operation, {
        status: 'failed',
        exitCode: null,
        error: error.message,
      });
    });

    child.on('close', async (code) => {
      if (operation.status !== 'running') {
        return;
      }

      if (code !== 0) {
        finalizeOperation(operation, {
          status: 'failed',
          exitCode: code,
          error: operation.output.trim() || `claude auth ${kind} exited with code ${code}`,
        });
        return;
      }

      try {
        const authStatus = await getStatus();
        finalizeOperation(operation, {
          status: 'succeeded',
          exitCode: code,
          authStatus,
        });
      } catch (error) {
        finalizeOperation(operation, {
          status: 'failed',
          exitCode: code,
          error: error.message,
        });
      }
    });

    return getOperation();
  }

  function startLogin({ provider = 'claudeai', email = '', sso = false } = {}) {
    const args = ['auth', 'login', provider === 'console' ? '--console' : '--claudeai'];

    if (email) {
      args.push('--email', email);
    }

    if (sso) {
      args.push('--sso');
    }

    return startOperation('login', args, { provider, email, sso });
  }

  function startLogout() {
    return startOperation('logout', ['auth', 'logout']);
  }

  return {
    getStatus,
    getOperation,
    startLogin,
    startLogout,
  };
}
