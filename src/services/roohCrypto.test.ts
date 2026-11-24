import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOfflineCapsuleHtml,
  createRoohCapsule,
  decryptBytesWithRoohKey,
  decryptRoohCapsule,
  encryptBytesWithRoohKey,
  parseRoohCapsule,
} from './roohCrypto';

test('encryptBytesWithRoohKey and decryptBytesWithRoohKey roundtrip cleanly', async () => {
  const roohKey = 'ROOH-AB12-CD34-EF56';
  const secret = new TextEncoder().encode('Leaf of memory inside rooh.clouds');
  const { ciphertext, meta } = await encryptBytesWithRoohKey(secret, 'text/plain', roohKey);

  assert.equal(meta.algorithm, 'AES-256-GCM');
  assert.equal(meta.originalSize, secret.byteLength);
  // Ciphertext should not contain plaintext bytes verbatim
  assert.equal(new TextDecoder().decode(ciphertext).includes('Leaf of memory'), false);

  const decrypted = await decryptBytesWithRoohKey(ciphertext, meta, roohKey);
  assert.deepEqual(decrypted, secret);
});

test('decryptBytesWithRoohKey rejects wrong Rooh Key', async () => {
  const secret = new TextEncoder().encode('Top secret blueprint');
  const { ciphertext, meta } = await encryptBytesWithRoohKey(
    secret,
    'text/plain',
    'ROOH-1111-2222-3333'
  );

  await assert.rejects(
    () => decryptBytesWithRoohKey(ciphertext, meta, 'ROOH-9999-8888-7777'),
    /Decryption failed/
  );
});

test('capsule serialize, parse, and decrypt roundtrip works', async () => {
  const roohKey = 'ROOH-7A9B-3C4D-5E6F';
  const payload = new TextEncoder().encode('# Classified\nRooh capsule test.');
  const { ciphertext, meta } = await encryptBytesWithRoohKey(payload, 'text/markdown', roohKey);
  const capsule = createRoohCapsule('classified.md', ciphertext, meta);

  const parsed = parseRoohCapsule(JSON.stringify(capsule));
  assert.equal(parsed.fileName, 'classified.md');
  assert.equal(parsed.format, 'rooh.clouds/encrypted-capsule-v1');

  const decrypted = await decryptRoohCapsule(parsed, roohKey);
  assert.equal(decrypted.fileName, 'classified.md');
  assert.equal(await decrypted.blob.text(), '# Classified\nRooh capsule test.');
});

test('buildOfflineCapsuleHtml generates CSP-hardened self-contained HTML', async () => {
  const roohKey = 'ROOH-AAAA-BBBB-CCCC';
  const payload = new TextEncoder().encode('hello');
  const { ciphertext, meta } = await encryptBytesWithRoohKey(payload, 'text/plain', roohKey);
  const capsule = createRoohCapsule('<script>evil</script>.txt', ciphertext, meta);
  const html = buildOfflineCapsuleHtml(capsule);

  assert.equal(html.includes('Content-Security-Policy'), true);
  assert.equal(html.includes('<script>evil</script>'), false);
  assert.equal(html.includes('crypto.subtle.decrypt'), true);
});
