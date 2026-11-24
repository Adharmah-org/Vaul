import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findCanonicalSeedByInput,
  getVaultDocId,
  isUuidLike,
  LEGACY_CANONICAL_VAULT_ID,
  PRIMARY_CANONICAL_VAULT_ID,
} from './vaultIdentity';
import { generateRoohKey, hashSecret, normalizeRoohKey, verifySecret } from './crypto';

test('getVaultDocId standardizes usernames into safe, case-insensitive document keys', () => {
  assert.equal(getVaultDocId('shunyavansh'), 'u_shunyavansh');
  assert.equal(getVaultDocId('  ShunyaVansh  '), 'u_shunyavansh');
  assert.equal(getVaultDocId('operator.01_alpha'), 'u_operator.01_alpha');
  assert.equal(getVaultDocId('Ghost Operator'), 'u_ghost_operator');
});

test('Canonical vault identity resolves username, primary UID, and legacy UIDs consistently', () => {
  const byUsername = findCanonicalSeedByInput('Tejasphirake');
  const byLowerUsername = findCanonicalSeedByInput('  tejasphirake ');
  const byPrimaryUid = findCanonicalSeedByInput(PRIMARY_CANONICAL_VAULT_ID);
  const byLegacyUid = findCanonicalSeedByInput(LEGACY_CANONICAL_VAULT_ID);
  const byLegacyDoc = findCanonicalSeedByInput('u_tejasphirake');

  assert.equal(byUsername?.vaultId, 'd6a19222-fefb-4c0e-b3b4-f7a725488caa');
  assert.equal(byLowerUsername?.vaultId, PRIMARY_CANONICAL_VAULT_ID);
  assert.equal(byPrimaryUid?.vaultId, PRIMARY_CANONICAL_VAULT_ID);
  assert.equal(byLegacyUid?.vaultId, PRIMARY_CANONICAL_VAULT_ID);
  assert.equal(byLegacyDoc?.vaultId, PRIMARY_CANONICAL_VAULT_ID);
  assert.ok(byPrimaryUid?.roohKeyHash.startsWith('pbkdf2$120000$'));

  assert.equal(isUuidLike(PRIMARY_CANONICAL_VAULT_ID), true);
  assert.equal(isUuidLike(LEGACY_CANONICAL_VAULT_ID), true);
  assert.equal(isUuidLike('tejasphirake'), false);
});

test('Rooh Key authentication verifies correctly for cross-browser authorization', async () => {
  const roohKey = generateRoohKey();
  const hash = await hashSecret(roohKey);

  // Authenticating from another browser with user input:
  const inputKeyFromNewBrowser = normalizeRoohKey(roohKey.toLowerCase());
  assert.equal(await verifySecret(inputKeyFromNewBrowser, hash), true);

  // Rejects invalid key:
  assert.equal(await verifySecret('ROOH-0000-0000-0000', hash), false);
});
