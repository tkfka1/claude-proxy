#!/usr/bin/env node

import fs from 'node:fs';

const args = process.argv.slice(2);
const outputFormat = readArgValue('--output-format') || 'text';
const model = readArgValue('--model') || 'sonnet';
const stdin = await readStdin();
const resultText = process.env.MOCK_CLAUDE_RESULT || 'mock completion';
const delayMs = Number.parseInt(process.env.MOCK_CLAUDE_DELAY_MS || '0', 10) || 0;
const streamDelayMs = Number.parseInt(process.env.MOCK_CLAUDE_STREAM_DELAY_MS || '0', 10) || 0;
const usage = {
  input_tokens: 12,
  output_tokens: 7,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};
const authStateFile = process.env.MOCK_CLAUDE_AUTH_STATE_FILE || '';

function readAuthState() {
  if (!authStateFile || !fs.existsSync(authStateFile)) {
    return {
      loggedIn: process.env.MOCK_CLAUDE_AUTH_LOGGED_IN === 'true',
      authMethod: process.env.MOCK_CLAUDE_AUTH_METHOD || 'claude.ai',
      email: process.env.MOCK_CLAUDE_AUTH_EMAIL || null,
    };
  }

  return JSON.parse(fs.readFileSync(authStateFile, 'utf8'));
}

function writeAuthState(state) {
  if (!authStateFile) return;
  fs.writeFileSync(authStateFile, JSON.stringify(state), 'utf8');
}

if (args[0] === 'auth' && args[1] === 'status') {
  const state = readAuthState();
  emit({
    loggedIn: Boolean(state.loggedIn),
    authMethod: state.loggedIn ? state.authMethod || 'claude.ai' : null,
    apiProvider: 'firstParty',
    email: state.loggedIn ? state.email || null : null,
    orgId: state.loggedIn ? 'mock-org-id' : null,
    orgName: state.loggedIn ? 'Mock Org' : null,
    subscriptionType: state.loggedIn ? (state.authMethod === 'console' ? 'console' : 'max') : null,
  });
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'login') {
  if (process.env.MOCK_CLAUDE_AUTH_LOGIN_FAIL === 'true') {
    process.stderr.write('Mock Claude login failed\n');
    process.exit(1);
  }

  const provider = args.includes('--console') ? 'console' : 'claude.ai';
  const email = readArgValue('--email') || 'web-login@example.com';
  writeAuthState({
    loggedIn: true,
    authMethod: provider,
    email,
  });
  process.stderr.write('Open browser to continue Claude login\n');
  process.stderr.write(`https://claude.ai/mock-login?provider=${encodeURIComponent(provider)}&email=${encodeURIComponent(email)}\n`);
  process.stderr.write(`provider=${provider} email=${email}\n`);
  emit({
    loggedIn: true,
    authMethod: provider,
    apiProvider: 'firstParty',
    email,
    orgId: 'mock-org-id',
    orgName: 'Mock Org',
    subscriptionType: provider === 'console' ? 'console' : 'max',
  });
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'logout') {
  writeAuthState({
    loggedIn: false,
    authMethod: null,
    email: null,
  });
  process.stderr.write('Mock Claude logout complete\n');
  emit({
    loggedIn: false,
    authMethod: null,
    apiProvider: null,
    email: null,
    orgId: null,
    orgName: null,
    subscriptionType: null,
  });
  process.exit(0);
}

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

if (delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
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
  if (streamDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
  }
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
