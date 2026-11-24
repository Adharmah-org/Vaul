import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  extractZipArchive,
  inferMimeFromFilename,
  MAX_TOTAL_EXTRACTED_BYTES,
  sanitizeZipEntryPath,
} from './zipExtractor';

test('zip extractor enforces 1 GB maximum extracted payload cap', () => {
  assert.equal(MAX_TOTAL_EXTRACTED_BYTES, 1024 * 1024 * 1024);
});

test('sanitizeZipEntryPath prevents zip-slip traversal and filters macOS artifacts', () => {
  assert.equal(sanitizeZipEntryPath('__MACOSX/._photo.jpg'), null);
  assert.equal(sanitizeZipEntryPath('photos/.DS_Store'), null);
  assert.equal(sanitizeZipEntryPath('folder/'), null);

  const traversed = sanitizeZipEntryPath('../../etc/passwd/../../vacation/beach.png');
  assert.ok(traversed);
  assert.equal(traversed.safeFileName, 'beach.png');
  assert.equal(traversed.safePath, 'etc/passwd/vacation/beach.png');
});

test('inferMimeFromFilename detects images, videos, and fallback types', () => {
  assert.equal(inferMimeFromFilename('sunset.JPG'), 'image/jpeg');
  assert.equal(inferMimeFromFilename('clip.mp4'), 'video/mp4');
  assert.equal(inferMimeFromFilename('reel.webm'), 'video/webm');
  assert.equal(inferMimeFromFilename('notes.md'), 'text/markdown');
  assert.equal(inferMimeFromFilename('raw.bin'), 'application/octet-stream');
});

test('extractZipArchive extracts images, videos, and documents while skipping macOS junk', async () => {
  const zip = new JSZip();
  zip.file('media/photo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  zip.file('media/trailer.mp4', new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
  zip.file('docs/readme.txt', 'Archive readme');
  zip.file('__MACOSX/._photo.png', 'appledouble');
  zip.file('.DS_Store', 'finder');

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const result = await extractZipArchive(bytes, 'bundle.zip');

  assert.equal(result.zipName, 'bundle.zip');
  assert.equal(result.skippedSystemCount, 2);
  assert.equal(result.items.length, 3);

  const img = result.items.find((i) => i.fileName === 'photo.png');
  const vid = result.items.find((i) => i.fileName === 'trailer.mp4');
  const doc = result.items.find((i) => i.fileName === 'readme.txt');

  assert.equal(img?.category, 'image');
  assert.equal(img?.mimeType, 'image/png');
  assert.equal(vid?.category, 'video');
  assert.equal(vid?.mimeType, 'video/mp4');
  assert.equal(doc?.category, 'document');
  assert.equal(await doc?.file.text(), 'Archive readme');
});
