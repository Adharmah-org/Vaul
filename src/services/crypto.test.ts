import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoohKey,
  generateUuid,
  hashSecret,
  isValidRoohKeyFormat,
  normalizeRoohKey,
  validatePasswordStrength,
  validateUsername,
  verifySecret,
} from './crypto';

test('generateRoohKey produces valid ROOH-XXXX-XXXX-XXXX format', () => {
  for (let i = 0; i < 10; i++) {
    const key = generateRoohKey();
    assert.equal(isValidRoohKeyFormat(key), true);
    assert.match(key, /^ROOH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  }
});

test('normalizeRoohKey trims and uppercases keys', () => {
  assert.equal(normalizeRoohKey('  rooh-ab12-cd34-ef56 '), 'ROOH-AB12-CD34-EF56');
  assert.equal(isValidRoohKeyFormat('rooh-ab12-cd34-ef56'), true);
  assert.equal(isValidRoohKeyFormat('INVALID-KEY'), false);
});

test('hashSecret and verifySecret validate matching and reject non-matching secrets', async () => {
  const password = 'VaultPassword!2026';
  const hash = await hashSecret(password);
  assert.equal(hash.startsWith('pbkdf2$'), true);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifySecret(password, hash), true);
  assert.equal(await verifySecret('WrongPassword!2026', hash), false);
});

test('validatePasswordStrength enforces strong local vault passwords', () => {
  assert.equal(validatePasswordStrength('weak').valid, false);
  assert.equal(validatePasswordStrength('lowercase123').valid, false);
  assert.equal(validatePasswordStrength('UPPERCASE123').valid, false);
  assert.equal(validatePasswordStrength('NoNumbersOrSymbols').valid, false);
  assert.equal(validatePasswordStrength('StrongPass1!').valid, true);
});

test('validateUsername checks length and permitted characters', () => {
  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('bad user!').valid, false);
  assert.equal(validateUsername('ghost_node.01').valid, true);
});

test('generateUuid produces unique UUID v4 strings', () => {
  const a = generateUuid();
  const b = generateUuid();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});
