import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_OPERATION_LOG_CHARS = 12_000;
const MAX_AUTH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_AUTH_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const AUTH_SNAPSHOT_VERSION = 1;
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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeSnapshotFilePath(filePath) {
  const raw = String(filePath || '').replaceAll('\\', '/');
  if (raw.startsWith('/')) {
    throw new Error(`Invalid Claude auth snapshot file path: ${filePath}`);
  }

  const parts = raw
    .split('/')
    .filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..' || part.startsWith('..'))) {
    throw new Error(`Invalid Claude auth snapshot file path: ${filePath}`);
  }

  const normalized = parts.join('/');

  if (!normalized) {
    throw new Error(`Invalid Claude auth snapshot file path: ${filePath}`);
  }

  return normalized;
}

function resolveInsideAuthDir(authDir, relativePath) {
  const root = path.resolve(authDir);
  const target = path.resolve(root, ...normalizeSnapshotFilePath(relativePath).split('/'));

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Claude auth snapshot path escapes auth directory: ${relativePath}`);
  }

  return target;
}

function normalizeFileMode(mode) {
  const numericMode = Number(mode);
  if (!Number.isInteger(numericMode)) return 0o600;
  return numericMode & 0o777;
}

async function collectAuthFiles(authDir, currentDir = authDir, files = []) {
  let entries = [];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return files;
    }

    throw error;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('..')) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await collectAuthFiles(authDir, absolutePath, files);
      continue;
    }

    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    if (stat.size > MAX_AUTH_FILE_BYTES) {
      throw new Error(`Claude auth file exceeds ${MAX_AUTH_FILE_BYTES} bytes: ${path.relative(authDir, absolutePath)}`);
    }

    const content = await fs.readFile(absolutePath);
    const relativePath = normalizeSnapshotFilePath(path.relative(authDir, absolutePath));
    files.push({
      path: relativePath,
      contentBase64: content.toString('base64'),
      mode: normalizeFileMode(stat.mode),
    });
  }

  return files;
}

function snapshotDecodedSize(files) {
  return files.reduce((total, file) => total + Buffer.byteLength(file.contentBase64 || '', 'base64'), 0);
}

export function normalizeClaudeAuthSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Persisted Claude auth state must be a JSON object');
  }

  const files = Array.isArray(payload.files)
    ? payload.files.map((file) => {
      if (!file || typeof file !== 'object' || Array.isArray(file)) {
        throw new Error('Persisted Claude auth files must be objects');
      }

      const contentBase64 = String(file.contentBase64 || '');
      const normalized = {
        path: normalizeSnapshotFilePath(file.path),
        contentBase64,
        mode: normalizeFileMode(file.mode),
      };
      Buffer.from(contentBase64, 'base64');
      return normalized;
    })
    : [];

  const totalBytes = snapshotDecodedSize(files);
  if (totalBytes > MAX_AUTH_SNAPSHOT_BYTES) {
    throw new Error(`Persisted Claude auth state exceeds ${MAX_AUTH_SNAPSHOT_BYTES} bytes`);
  }

  return {
    version: AUTH_SNAPSHOT_VERSION,
    updatedAt: payload.updatedAt == null ? null : String(payload.updatedAt),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function readClaudeAuthSnapshot({ authDir, updatedAt = new Date().toISOString() }) {
  const files = (await collectAuthFiles(path.resolve(authDir)))
    .sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = snapshotDecodedSize(files);

  if (totalBytes > MAX_AUTH_SNAPSHOT_BYTES) {
    throw new Error(`Claude auth snapshot exceeds ${MAX_AUTH_SNAPSHOT_BYTES} bytes`);
  }

  return {
    version: AUTH_SNAPSHOT_VERSION,
    updatedAt,
    files,
  };
}

async function clearAuthDir(authDir) {
  await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(authDir, { withFileTypes: true });

  await Promise.all(entries.map((entry) => fs.rm(path.join(authDir, entry.name), {
    recursive: true,
    force: true,
  })));
}

export async function writeClaudeAuthSnapshot({ authDir, snapshot }) {
  const normalized = normalizeClaudeAuthSnapshot(snapshot);
  const root = path.resolve(authDir);

  await clearAuthDir(root);

  for (const file of normalized.files) {
    const target = resolveInsideAuthDir(root, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, Buffer.from(file.contentBase64, 'base64'), {
      mode: file.mode,
    });
    await fs.chmod(target, file.mode);
  }

  return normalized;
}

function summarizeSharedSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    updatedAt: snapshot.updatedAt || null,
    fileCount: Array.isArray(snapshot.files) ? snapshot.files.length : 0,
  };
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
  operation.sharedAuth = patch.sharedAuth || null;
  operation.links = extractUrls(operation.output);
}

export function createClaudeAuthManager({ claudeBin, authDir, authStore = null }) {
  const resolvedAuthDir = authDir ? path.resolve(authDir) : null;
  let lastAppliedSharedAuthUpdatedAt = null;
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
    sharedAuth: null,
    links: [],
    options: null,
  };

  function getOperation() {
    return { ...currentOperation };
  }

  async function getLocalStatus() {
    return runClaudeAuthStatus({ claudeBin });
  }

  function getSharedAuthStatus() {
    return {
      enabled: Boolean(authStore && resolvedAuthDir),
      lastAppliedAt: lastAppliedSharedAuthUpdatedAt,
    };
  }

  async function syncFromStore({ force = false } = {}) {
    if (!authStore || !resolvedAuthDir) {
      return {
        enabled: false,
        applied: false,
      };
    }

    if (currentOperation.status === 'running') {
      return {
        enabled: true,
        applied: false,
        skipped: 'operation-running',
      };
    }

    const snapshot = await authStore.loadState();
    if (!snapshot) {
      return {
        enabled: true,
        applied: false,
        reason: 'empty',
      };
    }

    const normalized = normalizeClaudeAuthSnapshot(snapshot);
    if (!force && normalized.updatedAt && normalized.updatedAt === lastAppliedSharedAuthUpdatedAt) {
      return {
        enabled: true,
        applied: false,
        ...summarizeSharedSnapshot(normalized),
      };
    }

    await writeClaudeAuthSnapshot({ authDir: resolvedAuthDir, snapshot: normalized });
    lastAppliedSharedAuthUpdatedAt = normalized.updatedAt || new Date().toISOString();

    return {
      enabled: true,
      applied: true,
      ...summarizeSharedSnapshot(normalized),
    };
  }

  async function saveToStore() {
    if (!authStore || !resolvedAuthDir) {
      return {
        enabled: false,
      };
    }

    const snapshot = await readClaudeAuthSnapshot({ authDir: resolvedAuthDir });
    await authStore.saveState(snapshot);
    lastAppliedSharedAuthUpdatedAt = snapshot.updatedAt;

    return {
      enabled: true,
      saved: true,
      ...summarizeSharedSnapshot(snapshot),
    };
  }

  async function seedStoreFromLocalIfEmpty() {
    if (!authStore || !resolvedAuthDir) {
      return {
        enabled: false,
        seeded: false,
      };
    }

    let existing = null;
    let existingInvalid = false;

    try {
      existing = await authStore.loadState();
    } catch {
      existingInvalid = true;
    }

    if (existing) {
      try {
        const normalized = normalizeClaudeAuthSnapshot(existing);
        return {
          enabled: true,
          seeded: false,
          ...summarizeSharedSnapshot(normalized),
        };
      } catch {
        existingInvalid = true;
      }
    }

    if (existingInvalid && !(await pathExists(resolvedAuthDir))) {
      return {
        enabled: true,
        seeded: false,
        reason: 'auth-dir-missing',
        replacedInvalid: true,
      };
    }

    if (!(await pathExists(resolvedAuthDir))) {
      return {
        enabled: true,
        seeded: false,
        reason: 'auth-dir-missing',
      };
    }

    const snapshot = await readClaudeAuthSnapshot({ authDir: resolvedAuthDir });
    await authStore.saveState(snapshot);
    lastAppliedSharedAuthUpdatedAt = snapshot.updatedAt;

    return {
      enabled: true,
      seeded: true,
      replacedInvalid: existingInvalid,
      ...summarizeSharedSnapshot(snapshot),
    };
  }

  async function getStatus() {
    await syncFromStore();
    return getLocalStatus();
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
      sharedAuth: null,
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
        const authStatus = await getLocalStatus();
        const sharedAuth = await saveToStore();
        finalizeOperation(operation, {
          status: 'succeeded',
          exitCode: code,
          authStatus,
          sharedAuth,
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
    getSharedAuthStatus,
    syncFromStore,
    seedStoreFromLocalIfEmpty,
    startLogin,
    startLogout,
  };
}
