#!/usr/bin/env node

const args = process.argv.slice(2);
const outputFormat = readArgValue('--output-format') || 'text';
const model = readArgValue('--model') || 'sonnet';
const stdin = await readStdin();
const resultText = process.env.MOCK_CLAUDE_RESULT || 'mock completion';
const usage = {
  input_tokens: 12,
  output_tokens: 7,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

if (process.env.MOCK_CLAUDE_ERROR === 'auth') {
  if (outputFormat === 'stream-json') {
    emit({ type: 'system', subtype: 'init', model, cwd: process.cwd() });
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        type: 'message',
        model: '<synthetic>',
        stop_reason: 'stop_sequence',
        stop_sequence: '',
        usage,
        content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
      },
      error: 'authentication_failed',
    });
    emit({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
      usage,
    });
    process.exit(1);
  }

  emit({
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: 'Not logged in · Please run /login',
    usage,
  });
  process.exit(1);
}

if (outputFormat === 'stream-json') {
  emit({ type: 'system', subtype: 'init', model, cwd: process.cwd() });
  emit({ type: 'system', subtype: 'status', status: 'requesting' });
  const partialText = resultText.slice(0, Math.max(1, Math.floor(resultText.length / 2)));
  emit({
    type: 'assistant',
    message: {
      role: 'assistant',
      type: 'message',
      model,
      stop_reason: null,
      stop_sequence: null,
      usage,
      content: [{ type: 'text', text: partialText }],
    },
  });
  emit({
    type: 'assistant',
    message: {
      role: 'assistant',
      type: 'message',
      model,
      stop_reason: null,
      stop_sequence: null,
      usage,
      content: [{ type: 'text', text: resultText }],
    },
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: resultText,
    usage,
    input_echo: stdin,
  });
  process.exit(0);
}

emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: resultText,
  usage,
  input_echo: stdin,
});
process.exit(0);

function readArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.resume();
  });
}
