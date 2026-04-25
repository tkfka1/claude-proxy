import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { once } from 'node:events';

import { ProxyError, extractAssistantText, truncateByStopSequences } from './anthropic.js';

function defaultUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function normalizeUsage(usage) {
  return {
    ...defaultUsage(),
    ...(usage || {}),
  };
}

function buildArgs({ model, systemPrompt, stream, extraArgs = [] }) {
  const args = [
    '--tools',
    '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '-p',
    '--model',
    model,
  ];

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  if (stream) {
    args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages');
  } else {
    args.push('--output-format', 'json');
  }

  args.push(...extraArgs);
  return args;
}

function createCliError(message, raw = undefined) {
  if (typeof message === 'string' && /not logged in/i.test(message)) {
    return new ProxyError(401, 'authentication_error', 'claude-cli is not logged in. Run `claude auth login` first.', raw);
  }

  return new ProxyError(500, 'api_error', message || 'claude-cli invocation failed', raw);
}

function createCliTimeoutError(kind, timeoutMs) {
  const error = new ProxyError(504, 'api_error', `claude-cli ${kind} timed out after ${timeoutMs}ms`);
  error.code = 'CLAUDE_CLI_TIMEOUT';
  return error;
}

function terminateChild(child) {
  if (child.exitCode == null && child.signalCode == null) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) {
        child.kill('SIGKILL');
      }
    }, 1_000).unref?.();
  }
}

export async function runClaudeJson({ claudeBin, model, systemPrompt, prompt, extraArgs, signal, timeoutMs = 0 }) {
  const args = buildArgs({ model, systemPrompt, stream: false, extraArgs });
  const child = spawn(claudeBin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  let timedOut = false;
  let aborted = false;
  let timeoutId = null;

  const abortHandler = () => {
    aborted = true;
    terminateChild(child);
  };

  if (signal) {
    if (signal.aborted) abortHandler();
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, timeoutMs);
  }

  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

  child.stdin.end(prompt);

  const [code] = await once(child, 'close');
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (signal) {
    signal.removeEventListener('abort', abortHandler);
  }

  if (timedOut) {
    throw createCliTimeoutError('request', timeoutMs);
  }

  if (aborted) {
    throw createCliError('claude-cli invocation was aborted');
  }

  const stdoutText = Buffer.concat(stdoutChunks).toString('utf8').trim();
  const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();

  if (!stdoutText) {
    throw createCliError(stderrText || `claude-cli exited with code ${code}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdoutText);
  } catch (error) {
    throw createCliError(`Failed to parse claude-cli JSON output: ${error.message}. stdout=${stdoutText.slice(0, 500)} stderr=${stderrText.slice(0, 500)}`);
  }

  if (parsed?.is_error) {
    throw createCliError(parsed.result || stderrText || 'claude-cli returned an error result', parsed);
  }

  return {
    text: String(parsed.result ?? ''),
    usage: normalizeUsage(parsed.usage),
    raw: parsed,
  };
}

export function runClaudeStream({
  claudeBin,
  model,
  systemPrompt,
  prompt,
  extraArgs,
  stopSequences,
  signal,
  timeoutMs = 0,
  idleTimeoutMs = 0,
  onText,
  onDone,
  onError,
}) {
  const args = buildArgs({ model, systemPrompt, stream: true, extraArgs });
  const child = spawn(claudeBin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  const rl = readline.createInterface({ input: child.stdout });
  const stderrChunks = [];

  let latestFullText = '';
  let latestEffectiveText = '';
  let latestUsage = defaultUsage();
  let finalResult = null;
  let settled = false;
  let aborted = false;
  let timeoutId = null;
  let idleTimeoutId = null;

  const abortHandler = () => {
    aborted = true;
    terminateChild(child);
  };

  function cleanup() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (idleTimeoutId) {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = null;
    }
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
    rl.close();
  }

  function failWithTimeout(kind, ms) {
    if (settled) return;
    settled = true;
    cleanup();
    terminateChild(child);
    onError(createCliTimeoutError(kind, ms));
  }

  function refreshIdleTimer() {
    if (idleTimeoutMs <= 0) return;
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => failWithTimeout('stream idle', idleTimeoutMs), idleTimeoutMs);
  }

  if (signal) {
    if (signal.aborted) abortHandler();
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => failWithTimeout('stream request', timeoutMs), timeoutMs);
  }
  refreshIdleTimer();

  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

  rl.on('line', (line) => {
    if (!line.trim()) return;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    refreshIdleTimer();

    if (event.type === 'assistant' && !event.parent_tool_use_id && !event.isSynthetic && !event.isReplay) {
      const fullText = extractAssistantText(event.message?.content);
      latestFullText = fullText;
      latestUsage = normalizeUsage(event.message?.usage || latestUsage);

      const truncated = truncateByStopSequences(fullText, stopSequences);
      if (truncated.text.startsWith(latestEffectiveText)) {
        const delta = truncated.text.slice(latestEffectiveText.length);
        if (delta) onText(delta);
      } else if (truncated.text !== latestEffectiveText) {
        const delta = truncated.text;
        if (delta) onText(delta);
      }

      latestEffectiveText = truncated.text;
      return;
    }

    if (event.type === 'result') {
      finalResult = event;
      latestUsage = normalizeUsage(event.usage || latestUsage);
    }
  });

  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    onError(createCliError(error.message));
  });

  child.on('close', (code) => {
    if (settled) return;
    settled = true;
    cleanup();

    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();

    if (aborted && !finalResult) {
      onError(createCliError('claude-cli invocation was aborted'));
      return;
    }

    if (finalResult?.is_error) {
      onError(createCliError(finalResult.result || stderrText || 'claude-cli returned an error result', finalResult));
      return;
    }

    const finalTextSource = finalResult?.result != null ? String(finalResult.result) : latestFullText;
    const truncated = truncateByStopSequences(finalTextSource, stopSequences);

    if (truncated.text.startsWith(latestEffectiveText)) {
      const trailing = truncated.text.slice(latestEffectiveText.length);
      if (trailing) onText(trailing);
    } else if (truncated.text !== latestEffectiveText) {
      onText(truncated.text);
    }

    onDone({
      code,
      text: truncated.text,
      stopReason: truncated.stopReason,
      stopSequence: truncated.stopSequence,
      usage: normalizeUsage(finalResult?.usage || latestUsage),
    });
  });

  child.stdin.end(prompt);

  return {
    kill() {
      terminateChild(child);
    },
  };
}
