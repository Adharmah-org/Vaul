import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countWordsAndChars,
  detectFileCategory,
  formatBytes,
  isValidHttpUrl,
  resolveDuplicateName,
  sortItems,
  validateArchivePayload,
} from './fileUtils';

test('detectFileCategory maps MIME types and extensions accurately', () => {
  assert.equal(detectFileCategory('image/png', 'photo.png'), 'image');
  assert.equal(detectFileCategory('', 'clip.MOV'), 'video');
  assert.equal(detectFileCategory('audio/ogg', 'voice.ogg'), 'audio');
  assert.equal(detectFileCategory('application/pdf', 'spec.pdf'), 'document');
  assert.equal(detectFileCategory('application/zip', 'backup.zip'), 'archive');
  assert.equal(detectFileCategory('text/plain', 'index.ts'), 'code');
  assert.equal(detectFileCategory('application/octet-stream', 'firmware.bin'), 'other');
});

test('resolveDuplicateName appends incremental counter preserving extension', () => {
  const existing = ['notes.md', 'notes (1).md', 'README'];
  assert.equal(resolveDuplicateName('fresh.txt', existing), 'fresh.txt');
  assert.equal(resolveDuplicateName('notes.md', existing), 'notes (2).md');
  assert.equal(resolveDuplicateName('README', existing), 'README (1)');
});

test('formatBytes formats byte sizes cleanly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(10 * 1024 * 1024), '10.0 MB');
});

test('isValidHttpUrl blocks unsafe schemes and validates domains', () => {
  assert.equal(isValidHttpUrl('javascript:alert(1)').valid, false);
  assert.equal(isValidHttpUrl('data:text/html,hi').valid, false);
  assert.equal(isValidHttpUrl('not a url').valid, false);
  const ok = isValidHttpUrl('rooh.clouds/docs');
  assert.equal(ok.valid, true);
  assert.equal(ok.normalized, 'https://rooh.clouds/docs');
});

test('countWordsAndChars counts markdown words and characters', () => {
  assert.deepEqual(countWordsAndChars(''), { words: 0, chars: 0 });
  assert.deepEqual(countWordsAndChars('Hello   rooh\nclouds!'), { words: 3, chars: 20 });
});

test('sortItems sorts by name, size, and updatedAt', () => {
  const items = [
    { name: 'zebra.txt', size: 100, createdAt: 1, updatedAt: 20 },
    { name: 'alpha.txt', size: 300, createdAt: 2, updatedAt: 10 },
  ];
  assert.equal(sortItems(items, 'name', 'asc')[0].name, 'alpha.txt');
  assert.equal(sortItems(items, 'size', 'desc')[0].name, 'alpha.txt');
  assert.equal(sortItems(items, 'updatedAt', 'desc')[0].name, 'zebra.txt');
});

test('validateArchivePayload rejects invalid payloads and accepts valid v1 archives', () => {
  assert.equal(validateArchivePayload(null).valid, false);
  assert.equal(validateArchivePayload({ app: 'other', schemaVersion: 1 }).valid, false);
  assert.equal(
    validateArchivePayload({
      app: 'rooh.clouds',
      schemaVersion: 1,
      exportedAt: Date.now(),
      username: 'neo',
      folders: [],
      files: [],
      notes: [],
      bookmarks: [{ id: '1', url: 'javascript:evil()' }],
      tags: [],
      trash: [],
    }).valid,
    false
  );
  assert.equal(
    validateArchivePayload({
      app: 'rooh.clouds',
      schemaVersion: 1,
      exportedAt: Date.now(),
      username: 'neo',
      folders: [],
      files: [],
      notes: [],
      bookmarks: [{ id: '1', url: 'https://example.com' }],
      tags: [],
      trash: [],
    }).valid,
    true
  );
});
