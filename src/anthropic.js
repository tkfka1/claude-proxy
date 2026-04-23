import crypto from 'node:crypto';

export class ProxyError extends Error {
  constructor(status, type, message, details = undefined) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
    this.type = type;
    this.details = details;
  }
}

export function createRequestId(prefix = 'req') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function createMessageId() {
  return createRequestId('msg');
}

export function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

export function anthropicErrorBody(type, message, requestId) {
  return {
    type: 'error',
    error: {
      type,
      message,
    },
    request_id: requestId,
  };
}

export function sendAnthropicError(res, status, type, message, requestId) {
  json(res, status, anthropicErrorBody(type, message, requestId), {
    'request-id': requestId,
  });
}

export function sendProxyError(res, error, requestId) {
  if (error instanceof ProxyError) {
    sendAnthropicError(res, error.status, error.type, error.message, requestId);
    return;
  }

  sendAnthropicError(res, 500, 'api_error', error?.message || 'Internal server error', requestId);
}

export async function readJsonBody(req, limitBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new ProxyError(413, 'request_too_large', `Request exceeds the maximum allowed size of ${limitBytes} bytes`);
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw.trim()) {
    throw new ProxyError(400, 'invalid_request_error', 'Request body must be valid JSON');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ProxyError(400, 'invalid_request_error', `Request body must be valid JSON: ${error.message}`);
  }
}

function stringifyToolInput(input) {
  try {
    return JSON.stringify(input ?? {}, null, 2);
  } catch {
    return String(input ?? '');
  }
}

export function normalizeSystemPrompt(system) {
  if (system == null) return '';

  if (typeof system === 'string') {
    return system.trim();
  }

  if (Array.isArray(system)) {
    return system
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (block.type === 'text') return String(block.text ?? '');
        throw new ProxyError(400, 'invalid_request_error', `Unsupported system content block type: ${block.type}`);
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  throw new ProxyError(400, 'invalid_request_error', 'system must be a string or an array of content blocks');
}

export function flattenContentBlock(block, role) {
  if (typeof block === 'string') return block;

  if (!block || typeof block !== 'object') {
    throw new ProxyError(400, 'invalid_request_error', `Invalid ${role} content block`);
  }

  switch (block.type) {
    case 'text':
      return String(block.text ?? '');
    case 'tool_use':
      return `[tool_use name="${block.name ?? 'unknown'}" id="${block.id ?? ''}"]\n${stringifyToolInput(block.input)}`;
    case 'tool_result': {
      const result = Array.isArray(block.content)
        ? block.content.map((child) => flattenContentBlock(child, role)).join('\n')
        : String(block.content ?? '');
      return `[tool_result tool_use_id="${block.tool_use_id ?? ''}"]\n${result}`;
    }
    default:
      throw new ProxyError(
        400,
        'invalid_request_error',
        `Unsupported ${role} content block type: ${block.type}. This proxy currently supports text, tool_use, and tool_result content only.`,
      );
  }
}

export function flattenMessageContent(content, role) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    throw new ProxyError(400, 'invalid_request_error', `messages[].content for role=${role} must be a string or an array`);
  }

  return content.map((block) => flattenContentBlock(block, role)).join('\n\n');
}

export function buildClaudePrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ProxyError(400, 'invalid_request_error', 'messages must be a non-empty array');
  }

  const parts = [
    'Continue the conversation below and answer as the assistant.',
    'Return only the assistant response for the final turn.',
    '',
    '<conversation>',
  ];

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      throw new ProxyError(400, 'invalid_request_error', 'Each message must be an object');
    }

    if (!['user', 'assistant'].includes(message.role)) {
      throw new ProxyError(400, 'invalid_request_error', `Unsupported message role: ${message.role}`);
    }

    const content = flattenMessageContent(message.content, message.role).trim();

    parts.push(`<message role="${message.role}">`);
    parts.push(content);
    parts.push('</message>');
    parts.push('');
  }

  parts.push('</conversation>');
  parts.push('');
  parts.push('Assistant:');

  return parts.join('\n');
}

export function validateMessagesRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProxyError(400, 'invalid_request_error', 'Request body must be a JSON object');
  }

  if (!body.model || typeof body.model !== 'string') {
    throw new ProxyError(400, 'invalid_request_error', 'model is required and must be a string');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ProxyError(400, 'invalid_request_error', 'messages is required and must be a non-empty array');
  }

  if (body.tools) {
    throw new ProxyError(
      400,
      'invalid_request_error',
      'This proxy does not support Anthropic tool definitions yet. Remove the tools field and send text-only messages.',
    );
  }

  if (body.tool_choice) {
    throw new ProxyError(400, 'invalid_request_error', 'This proxy does not support tool_choice');
  }

  if (body.max_tokens != null && (!Number.isInteger(body.max_tokens) || body.max_tokens <= 0)) {
    throw new ProxyError(400, 'invalid_request_error', 'max_tokens must be a positive integer');
  }

  if (body.temperature != null && (typeof body.temperature !== 'number' || Number.isNaN(body.temperature))) {
    throw new ProxyError(400, 'invalid_request_error', 'temperature must be a number');
  }

  if (body.stop_sequences != null && !Array.isArray(body.stop_sequences)) {
    throw new ProxyError(400, 'invalid_request_error', 'stop_sequences must be an array of strings');
  }

  if (body.stop_sequences?.some((value) => typeof value !== 'string')) {
    throw new ProxyError(400, 'invalid_request_error', 'stop_sequences must only contain strings');
  }
}

export function extractAssistantText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block) => block && typeof block === 'object' && block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('');
}

export function truncateByStopSequences(text, stopSequences = []) {
  if (!stopSequences?.length) {
    return {
      text,
      stopReason: 'end_turn',
      stopSequence: null,
    };
  }

  let bestIndex = -1;
  let matched = null;

  for (const stopSequence of stopSequences) {
    const index = text.indexOf(stopSequence);
    if (index === -1) continue;
    if (bestIndex === -1 || index < bestIndex) {
      bestIndex = index;
      matched = stopSequence;
    }
  }

  if (bestIndex === -1) {
    return {
      text,
      stopReason: 'end_turn',
      stopSequence: null,
    };
  }

  return {
    text: text.slice(0, bestIndex),
    stopReason: 'stop_sequence',
    stopSequence: matched,
  };
}

export function makeAnthropicMessageResponse({
  id = createMessageId(),
  model,
  text,
  usage,
  stopReason,
  stopSequence,
}) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text,
      },
    ],
    model,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage: {
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
    },
  };
}

export function sseHeaders(requestId) {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'request-id': requestId,
  };
}

export function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
