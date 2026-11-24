import test from 'node:test';
import assert from 'node:assert/strict';
import { getVaultDocId } from '../storage/FirestoreStorageProvider';
import { generateRoohKey, hashSecret, normalizeRoohKey, verifySecret } from './crypto';

test('getVaultDocId standardizes usernames into safe, case-insensitive document keys', () => {
  assert.equal(getVaultDocId('shunyavansh'), 'u_shunyavansh');
  assert.equal(getVaultDocId('  ShunyaVansh  '), 'u_shunyavansh');
  assert.equal(getVaultDocId('operator.01_alpha'), 'u_operator.01_alpha');
  assert.equal(getVaultDocId('Ghost Operator'), 'u_ghost_operator');
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
