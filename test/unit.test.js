import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClaudePrompt,
  normalizeSystemPrompt,
  truncateByStopSequences,
} from '../src/anthropic.js';
import {
  validateWebPasswordSettings,
  createScryptPasswordHash,
  parseScryptPasswordHash,
  verifyWebPassword,
} from '../src/web-auth.js';
import {
  createProxyApiKeyManager,
  maskProxyApiKey,
  validateProxyApiKeyInput,
} from '../src/proxy-api-key.js';

test('buildClaudePrompt formats conversation history', () => {
  const prompt = buildClaudePrompt([
    { role: 'user', content: '안녕' },
    { role: 'assistant', content: [{ type: 'text', text: '안녕하세요!' }] },
    { role: 'user', content: [{ type: 'text', text: '요약해줘' }] },
  ]);

  assert.match(prompt, /<message role="user">\n안녕\n<\/message>/);
  assert.match(prompt, /<message role="assistant">\n안녕하세요!\n<\/message>/);
  assert.match(prompt, /Assistant:\s*$/);
});

test('normalizeSystemPrompt accepts string and text blocks', () => {
  assert.equal(normalizeSystemPrompt('system'), 'system');
  assert.equal(
    normalizeSystemPrompt([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]),
    'a\n\nb',
  );
});

test('truncateByStopSequences truncates at first stop sequence', () => {
  assert.deepEqual(truncateByStopSequences('hello<stop>world', ['<stop>']), {
    text: 'hello',
    stopReason: 'stop_sequence',
    stopSequence: '<stop>',
  });

  assert.deepEqual(truncateByStopSequences('hello world', ['<stop>']), {
    text: 'hello world',
    stopReason: 'end_turn',
    stopSequence: null,
  });
});

test('createScryptPasswordHash and verifyWebPassword support hashed web passwords', () => {
  const hash = createScryptPasswordHash('docs-secret', '00112233445566778899aabbccddeeff');

  assert.deepEqual(parseScryptPasswordHash(hash), {
    saltHex: '00112233445566778899aabbccddeeff',
    digestHex: hash.split('$')[2],
  });
  assert.equal(verifyWebPassword('docs-secret', { webPasswordHash: hash }), true);
  assert.equal(verifyWebPassword('wrong-password', { webPasswordHash: hash }), false);
});

test('verifyWebPassword supports plaintext fallback', () => {
  assert.equal(verifyWebPassword('docs-secret', { webPassword: 'docs-secret' }), true);
  assert.equal(verifyWebPassword('wrong-password', { webPassword: 'docs-secret' }), false);
});

test('validateWebPasswordSettings requires a docs password or hash', () => {
  assert.throws(
    () => validateWebPasswordSettings({ webPassword: '', webPasswordHash: '' }),
    /Set WEB_PASSWORD or WEB_PASSWORD_HASH/,
  );
  assert.throws(
    () => validateWebPasswordSettings({ webPassword: 'replace-with-strong-docs-password', webPasswordHash: '' }),
    /must be replaced with a real secret/,
  );
});

test('proxy api key helpers validate, mask, and update runtime state', () => {
  assert.throws(() => validateProxyApiKeyInput('short'), /at least 8 characters/);
  assert.equal(maskProxyApiKey('runtime-secret-key'), 'runt…ey');

  const manager = createProxyApiKeyManager();
  assert.deepEqual(manager.getStatus(), {
    configured: false,
    maskedApiKey: null,
    updatedAt: null,
  });

  const updated = manager.setApiKey('runtime-secret-key');
  assert.equal(updated.apiKey, 'runtime-secret-key');
  assert.equal(updated.configured, true);
  assert.equal(updated.maskedApiKey, 'runt…ey');

  manager.resetApiKey('');
  assert.equal(manager.getStatus().configured, false);
});
