function truncateText(value, maxLength = 600) {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}…`;
}

function sanitizeDetails(value, depth = 0) {
  if (value == null) return value;
  if (depth >= 4) return '[depth-limit]';

  if (typeof value === 'string') {
    return truncateText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateText(value.message),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDetails(item, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key, sanitizeDetails(item, depth + 1)]),
    );
  }

  return truncateText(value);
}

export function createRecentLogStore({ limit = 200, storage = null } = {}) {
  let nextId = 1;
  const entries = [];
  const persistence = {
    enabled: Boolean(storage),
    healthy: Boolean(storage),
    lastError: null,
    lastSavedAt: null,
  };

  if (storage) {
    try {
      const persistedEntries = storage.loadEntries();
      entries.push(...persistedEntries);
      nextId = persistedEntries.reduce((maxId, entry) => Math.max(maxId, entry.id || 0), 0) + 1;
    } catch (error) {
      persistence.healthy = false;
      persistence.lastError = error.message;
    }
  }

  function trimToLimit() {
    if (entries.length <= limit) {
      return;
    }

    entries.splice(limit);
  }

  function persistEntries() {
    if (!storage) {
      return;
    }

    try {
      storage.saveEntries(entries);
      persistence.healthy = true;
      persistence.lastError = null;
      persistence.lastSavedAt = new Date().toISOString();
    } catch (error) {
      persistence.healthy = false;
      persistence.lastError = error.message;
    }
  }

  return {
    add(level, event, details = {}) {
      entries.unshift({
        id: nextId++,
        at: new Date().toISOString(),
        level,
        event,
        details: sanitizeDetails(details),
      });
      trimToLimit();
      persistEntries();
    },
    list(maxEntries = limit) {
      return entries.slice(0, Math.max(0, maxEntries));
    },
    getStatus() {
      return {
        enabled: persistence.enabled,
        healthy: persistence.healthy,
        lastError: persistence.lastError,
        lastSavedAt: persistence.lastSavedAt,
        entryCount: entries.length,
      };
    },
    clear() {
      entries.length = 0;
      nextId = 1;
      if (storage) {
        try {
          storage.clearEntries();
          persistence.healthy = true;
          persistence.lastError = null;
          persistence.lastSavedAt = new Date().toISOString();
        } catch (error) {
          persistence.healthy = false;
          persistence.lastError = error.message;
        }
      }
    },
  };
}
