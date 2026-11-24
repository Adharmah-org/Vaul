import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 0 Security Rules & Dirty Dozen Verification Suite
 * Validates firestore.rules against Eight Pillars structural invariants and blueprint constraints.
 */
const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
const blueprint = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8')
);

test('firestore.rules enforces rules_version 2 and default-deny safety net', () => {
  assert.match(rulesText, /rules_version\s*=\s*'2';/);
  assert.match(rulesText, /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/);
});

test('every collection in firebase-blueprint.json has an explicit match block in firestore.rules', () => {
  const paths = Object.keys(blueprint.firestore);
  assert.equal(paths.length, 8);
  for (const collectionPath of paths) {
    const leaf = collectionPath.split('/').slice(-2).join('/');
    const segment = leaf.split('/')[0];
    assert.ok(
      rulesText.includes(`match /${segment}/`) || rulesText.includes('match /vaults/{vaultUid}'),
      `Missing match block for ${collectionPath}`
    );
  }
});

test('no blanket allow read or allow write without owner and verified email checks', () => {
  assert.equal(/allow\s+(read|write)\s*:\s*if\s+true\s*;/.test(rulesText), false);
  assert.equal(/allow\s+list\s*:\s*if\s+isSignedIn\(\)\s*;/.test(rulesText), false);
  assert.match(rulesText, /request\.auth\.token\.email_verified\s*==\s*true/);
});

test('all Dirty Dozen invariants are guarded in firestore.rules', () => {
  // 1-3: Unauth / unverified / cross-tenant
  assert.match(rulesText, /function\s+isVaultOwner\(vaultUid\)/);
  assert.match(rulesText, /request\.auth\.uid\s*==\s*vaultUid/);
  // 4-5: Identity spoofing & shadow fields (hasAll + hasOnly)
  assert.match(rulesText, /data\.keys\(\)\.hasAll\(/);
  assert.match(rulesText, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesText, /affectedKeys\(\)\.hasOnly\(/);
  // 6: ID poisoning regex & size
  assert.match(rulesText, /function\s+isValidId\(id\)/);
  assert.match(rulesText, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
  // 7-8: Timestamp integrity & immutability
  assert.match(rulesText, /incoming\(\)\.createdAt\s*==\s*request\.time/);
  assert.match(rulesText, /incoming\(\)\.updatedAt\s*==\s*request\.time/);
  assert.match(rulesText, /incoming\(\)\.ownerUid\s*==\s*existing\(\)\.ownerUid/);
  // 9-10: Chunk size cap & parent file existence (orphan prevention)
  assert.match(rulesText, /data\.dataBase64\.size\(\)\s*<=\s*520000/);
  assert.match(rulesText, /exists\(\/databases\/\$\(database\)\/documents\/vaults\/\$\(vaultUid\)\/files\/\$\(incoming\(\)\.fileId\)\)/);
  // 11: Bookmark URL allowlist
  assert.match(rulesText, /data\.url\.matches\('\^https\?:\/\/\.\+'\)/);
  // 12: List query enforcement without get()
  assert.match(rulesText, /allow\s+list:\s*if\s+isVaultOwner\(vaultUid\)\s*&&\s*existing\(\)\.ownerUid\s*==\s*request\.auth\.uid;/);
});
