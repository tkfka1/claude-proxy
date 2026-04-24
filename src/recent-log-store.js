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

export function createRecentLogStore({ limit = 200 } = {}) {
  let nextId = 1;
  const entries = [];

  function trimToLimit() {
    if (entries.length <= limit) {
      return;
    }

    entries.splice(limit);
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
    },
    list(maxEntries = limit) {
      return entries.slice(0, Math.max(0, maxEntries));
    },
    clear() {
      entries.length = 0;
    },
  };
}
