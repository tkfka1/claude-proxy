import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_STATE_BASENAME = 'runtime-state.json';

export function resolveProxyStateFile(explicitPath = process.env.PROXY_STATE_FILE || '') {
  const raw = String(explicitPath || '').trim();
  if (raw) {
    return path.resolve(raw);
  }

  const xdgStateHome = String(process.env.XDG_STATE_HOME || '').trim();
  if (xdgStateHome) {
    return path.join(xdgStateHome, 'claude-anthropic-proxy', DEFAULT_STATE_BASENAME);
  }

  const home = String(process.env.HOME || '').trim() || os.homedir();
  if (home) {
    return path.join(home, '.local', 'state', 'claude-anthropic-proxy', DEFAULT_STATE_BASENAME);
  }

  return path.resolve(`.${DEFAULT_STATE_BASENAME}`);
}

function normalizePersistedState(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Persisted proxy state must be a JSON object');
  }

  const proxyApiKey = String(payload.proxyApiKey || '').trim();
  const updatedAt = payload.updatedAt == null ? null : String(payload.updatedAt).trim();
  const bootstrapFingerprint = payload.bootstrapFingerprint == null ? null : String(payload.bootstrapFingerprint).trim();

  if (!proxyApiKey) {
    return null;
  }

  return {
    proxyApiKey,
    updatedAt: updatedAt || null,
    bootstrapFingerprint: bootstrapFingerprint || null,
  };
}

export function createProxyStateFileStore({ filePath }) {
  const resolvedPath = resolveProxyStateFile(filePath);

  function ensureParentDirectory() {
    fs.mkdirSync(path.dirname(resolvedPath), {
      recursive: true,
      mode: 0o700,
    });
  }

  return {
    filePath: resolvedPath,
    loadState() {
      if (!fs.existsSync(resolvedPath)) {
        return null;
      }

      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizePersistedState(parsed);
    },
    saveState({ proxyApiKey, updatedAt, bootstrapFingerprint = null }) {
      ensureParentDirectory();

      const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify({ proxyApiKey, updatedAt, bootstrapFingerprint }, null, 2)}\n`;
      fs.writeFileSync(tempPath, payload, {
        mode: 0o600,
      });
      fs.renameSync(tempPath, resolvedPath);
      fs.chmodSync(resolvedPath, 0o600);
    },
    clearState() {
      fs.rmSync(resolvedPath, {
        force: true,
      });
    },
  };
}
