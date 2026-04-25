import crypto from 'node:crypto';

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
};
function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

function isHex(value) {
  return /^[0-9a-f]+$/i.test(value);
}

export function createScryptPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (!salt || !isHex(salt) || salt.length % 2 !== 0) {
    throw new Error('scrypt salt must be an even-length hex string');
  }

  const derivedKey = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return `${SCRYPT_PREFIX}$${salt.toLowerCase()}$${derivedKey.toString('hex')}`;
}

export function parseScryptPasswordHash(hash) {
  const raw = String(hash || '');
  const [prefix, saltHex, digestHex, ...rest] = raw.split('$');

  if (rest.length > 0 || prefix !== SCRYPT_PREFIX || !saltHex || !digestHex) {
    throw new Error('WEB_PASSWORD_HASH must use the format scrypt$<salt-hex>$<digest-hex>');
  }

  if (!isHex(saltHex) || saltHex.length % 2 !== 0) {
    throw new Error('WEB_PASSWORD_HASH salt must be an even-length hex string');
  }

  if (!isHex(digestHex) || digestHex.length !== SCRYPT_KEY_LENGTH * 2) {
    throw new Error(`WEB_PASSWORD_HASH digest must be ${SCRYPT_KEY_LENGTH * 2} hex characters`);
  }

  return {
    saltHex: saltHex.toLowerCase(),
    digestHex: digestHex.toLowerCase(),
  };
}

export function validateWebPasswordSettings({ webPassword, webPasswordHash }) {
  if (webPasswordHash) {
    parseScryptPasswordHash(webPasswordHash);
  }

  if (!webPassword && !webPasswordHash) {
    throw new Error('Set WEB_PASSWORD or WEB_PASSWORD_HASH before starting the server');
  }

}

export function validateNewWebPassword(password) {
  const value = String(password || '');

  if (!value) {
    throw new Error('New password is required.');
  }

  return value;
}

export function verifyWebPassword(password, { webPassword = '', webPasswordHash = '' } = {}) {
  if (webPasswordHash) {
    const { saltHex, digestHex } = parseScryptPasswordHash(webPasswordHash);
    const actual = Buffer.from(digestHex, 'hex');
    const expected = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), actual.length, SCRYPT_OPTIONS);
    return crypto.timingSafeEqual(actual, expected);
  }

  if (!webPassword) {
    return false;
  }

  return crypto.timingSafeEqual(sha256(password), sha256(webPassword));
}
