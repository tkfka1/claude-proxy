import http from 'node:http';

import { loadConfig, resolveCliModel } from './config.js';
import {
  ProxyError,
  buildClaudePrompt,
  createMessageId,
  createRequestId,
  json,
  makeAnthropicMessageResponse,
  normalizeSystemPrompt,
  readJsonBody,
  sendAnthropicError,
  sendProxyError,
  sseHeaders,
  validateMessagesRequest,
  writeSseEvent,
  truncateByStopSequences,
} from './anthropic.js';
import { runClaudeJson, runClaudeStream } from './claude-cli.js';

const config = loadConfig();

function log(...args) {
  if (!config.enableRequestLogging) return;
  console.log(new Date().toISOString(), ...args);
}

function applyProxyAuth(req, requestId) {
  const apiKey = req.headers['x-api-key'];
  const anthropicVersion = req.headers['anthropic-version'];

  if (config.requireAnthropicVersion && !anthropicVersion) {
    throw new ProxyError(400, 'invalid_request_error', 'anthropic-version header is required');
  }

  if (!config.allowMissingApiKeyHeader && !apiKey) {
    throw new ProxyError(401, 'authentication_error', 'x-api-key header is required');
  }

  if (config.proxyApiKey && apiKey !== config.proxyApiKey) {
    throw new ProxyError(401, 'authentication_error', 'Invalid API key');
  }

  return {
    requestId,
    anthropicVersion: anthropicVersion || config.defaultAnthropicVersion,
  };
}

function sendModels(res) {
  json(res, 200, {
    data: [
      {
        id: 'sonnet',
        type: 'model',
        display_name: 'Claude CLI Sonnet Alias',
      },
      {
        id: 'opus',
        type: 'model',
        display_name: 'Claude CLI Opus Alias',
      },
      {
        id: 'haiku',
        type: 'model',
        display_name: 'Claude CLI Haiku Alias',
      },
    ],
    has_more: false,
    first_id: 'sonnet',
    last_id: 'haiku',
  });
}

async function handleMessages(req, res) {
  const requestId = createRequestId();

  try {
    applyProxyAuth(req, requestId);
    const body = await readJsonBody(req, config.requestBodyLimitBytes);
    validateMessagesRequest(body);

    const prompt = buildClaudePrompt(body.messages);
    const systemPrompt = normalizeSystemPrompt(body.system);
    const mappedModel = resolveCliModel(body.model, config);
    const stopSequences = body.stop_sequences || [];
    const responseMessageId = createMessageId();
    const abortController = new AbortController();

    req.on('aborted', () => {
      abortController.abort();
    });
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    log('messages request', { requestId, model: body.model, mappedModel, stream: Boolean(body.stream) });

    if (body.stream) {
      res.writeHead(200, sseHeaders(requestId));

      const startedAt = Date.now();
      let streamedText = '';

      writeSseEvent(res, 'message_start', {
        type: 'message_start',
        message: {
          id: responseMessageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: body.model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      });

      writeSseEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: '',
        },
      });

      runClaudeStream({
        claudeBin: config.claudeBin,
        model: mappedModel,
        systemPrompt,
        prompt,
        extraArgs: config.claudeExtraArgs,
        stopSequences,
        signal: abortController.signal,
        onText(delta) {
          streamedText += delta;
          writeSseEvent(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'text_delta',
              text: delta,
            },
          });
        },
        onDone(result) {
          writeSseEvent(res, 'content_block_stop', {
            type: 'content_block_stop',
            index: 0,
          });

          writeSseEvent(res, 'message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: result.stopReason,
              stop_sequence: result.stopSequence,
            },
            usage: {
              output_tokens: result.usage.output_tokens,
              input_tokens: result.usage.input_tokens,
              cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
              cache_read_input_tokens: result.usage.cache_read_input_tokens,
            },
          });

          writeSseEvent(res, 'message_stop', {
            type: 'message_stop',
          });

          res.end();
          log('messages stream completed', {
            requestId,
            elapsed_ms: Date.now() - startedAt,
            chars: streamedText.length,
          });
        },
        onError(error) {
          if (res.writableEnded) return;
          writeSseEvent(res, 'error', {
            type: 'error',
            error: {
              type: error.type || 'api_error',
              message: error.message,
            },
          });
          res.end();
          log('messages stream failed', { requestId, error: error.message });
        },
      });

      return;
    }

    const cliResult = await runClaudeJson({
      claudeBin: config.claudeBin,
      model: mappedModel,
      systemPrompt,
      prompt,
      extraArgs: config.claudeExtraArgs,
      signal: abortController.signal,
    });

    const truncated = truncateByStopSequences(cliResult.text, stopSequences);
    const responseBody = makeAnthropicMessageResponse({
      id: responseMessageId,
      model: body.model,
      text: truncated.text,
      usage: cliResult.usage,
      stopReason: truncated.stopReason,
      stopSequence: truncated.stopSequence,
    });

    json(res, 200, responseBody, {
      'request-id': requestId,
    });

    log('messages request completed', {
      requestId,
      chars: truncated.text.length,
      input_tokens: cliResult.usage.input_tokens,
      output_tokens: cliResult.usage.output_tokens,
    });
  } catch (error) {
    sendProxyError(res, error, requestId);
    log('messages request failed', { requestId, error: error.message });
  }
}

function requestHandler(req, res) {
  if (req.method === 'GET' && req.url === '/') {
    json(res, 200, {
      ok: true,
      service: 'claude-anthropic-proxy',
      endpoints: ['/health', '/v1/messages', '/v1/models'],
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, {
      ok: true,
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/v1/models') {
    sendModels(res);
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/messages') {
    void handleMessages(req, res);
    return;
  }

  const requestId = createRequestId();
  sendAnthropicError(res, 404, 'not_found_error', `Route not found: ${req.method} ${req.url}`, requestId);
}

const server = http.createServer(requestHandler);

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(config.port, config.host, () => {
    console.log(`claude-anthropic-proxy listening on http://${config.host}:${config.port}`);
  });
}

export { server, requestHandler };
