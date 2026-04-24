import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_STATE_BASENAME = 'runtime-state.json';
const DEFAULT_RECENT_LOG_BASENAME = 'recent-log.json';

function resolveStateFile(explicitPath, basename) {
  const raw = String(explicitPath || '').trim();
  if (raw) {
    return path.resolve(raw);
  }

  const xdgStateHome = String(process.env.XDG_STATE_HOME || '').trim();
  if (xdgStateHome) {
    return path.join(xdgStateHome, 'claude-anthropic-proxy', basename);
  }

  const home = String(process.env.HOME || '').trim() || os.homedir();
  if (home) {
    return path.join(home, '.local', 'state', 'claude-anthropic-proxy', basename);
  }

  return path.resolve(`.${basename}`);
}

export function resolveProxyStateFile(explicitPath = process.env.PROXY_STATE_FILE || '') {
  return resolveStateFile(explicitPath, DEFAULT_STATE_BASENAME);
}

export function resolveRecentLogFile(explicitPath = process.env.RECENT_LOG_FILE || '') {
  return resolveStateFile(explicitPath, DEFAULT_RECENT_LOG_BASENAME);
}

function normalizePersistedState(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Persisted proxy state must be a JSON object');
  }

  const proxyApiKey = String(payload.proxyApiKey || '').trim();
  const updatedAt = payload.updatedAt == null ? null : String(payload.updatedAt).trim();

  if (!proxyApiKey) {
    return null;
  }

  return {
    proxyApiKey,
    updatedAt: updatedAt || null,
  };
}

function normalizeRecentLogEntries(payload) {
  if (!Array.isArray(payload)) {
    throw new Error('Persisted recent logs must be a JSON array');
  }

  return payload
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      id: Number.isFinite(entry.id) ? entry.id : 0,
      at: String(entry.at || ''),
      level: String(entry.level || 'info'),
      event: String(entry.event || ''),
      details: entry.details && typeof entry.details === 'object' ? entry.details : {},
    }));
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
    saveState({ proxyApiKey, updatedAt }) {
      ensureParentDirectory();

      const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify({ proxyApiKey, updatedAt }, null, 2)}\n`;
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

export function createRecentLogFileStore({ filePath }) {
  const resolvedPath = resolveRecentLogFile(filePath);

  function ensureParentDirectory() {
    fs.mkdirSync(path.dirname(resolvedPath), {
      recursive: true,
      mode: 0o700,
    });
  }

  return {
    filePath: resolvedPath,
    loadEntries() {
      if (!fs.existsSync(resolvedPath)) {
        return [];
      }

      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeRecentLogEntries(parsed);
    },
    saveEntries(entries) {
      ensureParentDirectory();

      const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify(entries, null, 2)}\n`;
      fs.writeFileSync(tempPath, payload, {
        mode: 0o600,
      });
      fs.renameSync(tempPath, resolvedPath);
      fs.chmodSync(resolvedPath, 0o600);
    },
    clearEntries() {
      fs.rmSync(resolvedPath, {
        force: true,
      });
    },
  };
}
