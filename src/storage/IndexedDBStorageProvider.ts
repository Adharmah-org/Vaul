import {
  generateRoohKey,
  generateSessionToken,
  generateUuid,
  hashSecret,
  isValidRoohKeyFormat,
  normalizeRoohKey,
  validatePasswordStrength,
  validateUsername,
  verifySecret,
} from '../services/crypto';
import { encryptBytesWithRoohKey } from '../services/roohCrypto';
import {
  detectFileCategory,
  getFileExtension,
  isValidHttpUrl,
  normalizeTagInput,
  resolveDuplicateName,
  sanitizeFileName,
  validateArchivePayload,
} from '../services/fileUtils';
import {
  BookmarkRecord,
  FileCategory,
  FileRecord,
  FolderRecord,
  NoteRecord,
  SerializedFileExport,
  SessionRecord,
  StorageAnalytics,
  StorageBreakdownItem,
  TagRecord,
  TrashRecord,
  UserRecord,
  VaultArchive,
  VaultPreferences,
} from '../types/vault';
import { db } from './db';
import { LoginResult, RegisterResult, StorageProvider, UploadProgressCallbacks } from './StorageProvider';

const ACTIVE_SESSION_ID_KEY = 'rooh_active_session_id';
const PREFS_PREFIX = 'rooh_prefs_';

const DEFAULT_PREFS: VaultPreferences = {
  accentMode: 'matrix',
  matrixRain: true,
  scanlines: true,
  reducedMotion: false,
  sessionDurationMinutes: 120,
  defaultViewMode: 'grid',
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to encode file blob for export.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

export class IndexedDBStorageProvider implements StorageProvider {
  readonly providerName = 'IndexedDB (Dexie.js Local Vault)';
  readonly isRemoteBacked = false;

  private async ensureTags(userId: string, tagNames: string[]): Promise<string[]> {
    const normalized = Array.from(
      new Set(tagNames.map(normalizeTagInput).filter((t) => t.length > 0))
    );
    if (normalized.length === 0) return [];

    const existing = await db.tags.where('userId').equals(userId).toArray();
    const existingSet = new Set(existing.map((t) => t.name));
    const toInsert: TagRecord[] = [];
    const now = Date.now();

    for (const name of normalized) {
      if (!existingSet.has(name)) {
        toInsert.push({
          id: generateUuid(),
          userId,
          name,
          createdAt: now,
        });
      }
    }

    if (toInsert.length > 0) {
      await db.tags.bulkAdd(toInsert);
    }
    return normalized;
  }

  async hasAnyUser(): Promise<boolean> {
    const count = await db.users.count();
    return count > 0;
  }

  async registerUser(usernameInput: string, password: string): Promise<RegisterResult> {
    const username = usernameInput.trim();
    const userCheck = validateUsername(username);
    if (!userCheck.valid) {
      throw new Error(userCheck.error || 'Invalid username.');
    }

    const passCheck = validatePasswordStrength(password);
    if (!passCheck.valid) {
      throw new Error(passCheck.errors.join('. '));
    }

    const existing = await db.users
      .filter((u) => u.username.toLowerCase() === username.toLowerCase())
      .first();
    if (existing) {
      throw new Error('Username already exists in this local vault.');
    }

    const roohKey = generateRoohKey();
    const [passwordHash, roohKeyHash] = await Promise.all([
      hashSecret(password),
      hashSecret(roohKey),
    ]);

    const now = Date.now();
    const user: UserRecord = {
      id: generateUuid(),
      username,
      passwordHash,
      roohKeyHash,
      createdAt: now,
      updatedAt: now,
    };

    const prefs = await this.getPreferences(user.id);
    const session: SessionRecord = {
      id: generateUuid(),
      userId: user.id,
      username: user.username,
      token: generateSessionToken(),
      createdAt: now,
      expiresAt: now + prefs.sessionDurationMinutes * 60 * 1000,
    };

    await db.transaction('rw', db.users, db.sessions, async () => {
      await db.users.add(user);
      await db.sessions.add(session);
    });

    sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, session.id);
    return { user, roohKey, session };
  }

  async authenticateUser(usernameInput: string, password: string, roohKeyInput: string): Promise<LoginResult> {
    const username = usernameInput.trim();
    const roohKey = normalizeRoohKey(roohKeyInput);

    if (!username || !password || !roohKey) {
      throw new Error('Username, password, and Rooh Key are required.');
    }

    if (!isValidRoohKeyFormat(roohKey)) {
      throw new Error('ACCESS DENIED: Invalid Rooh Key format (expected ROOH-XXXX-XXXX-XXXX).');
    }

    const user = await db.users
      .filter((u) => u.username.toLowerCase() === username.toLowerCase())
      .first();

    if (!user) {
      throw new Error('ACCESS DENIED: Credentials do not match any local vault.');
    }

    const [passwordOk, keyOk] = await Promise.all([
      verifySecret(password, user.passwordHash),
      verifySecret(roohKey, user.roohKeyHash),
    ]);

    if (!passwordOk || !keyOk) {
      throw new Error('ACCESS DENIED: Invalid password or Rooh Key.');
    }

    const prefs = await this.getPreferences(user.id);
    const now = Date.now();
    const session: SessionRecord = {
      id: generateUuid(),
      userId: user.id,
      username: user.username,
      token: generateSessionToken(),
      createdAt: now,
      expiresAt: now + prefs.sessionDurationMinutes * 60 * 1000,
    };

    await db.sessions.add(session);
    sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, session.id);
    return { user, session };
  }

  async verifyRoohKey(userId: string, roohKeyInput: string): Promise<boolean> {
    const user = await db.users.get(userId);
    if (!user) return false;
    const normalized = normalizeRoohKey(roohKeyInput);
    if (!isValidRoohKeyFormat(normalized)) return false;
    return verifySecret(normalized, user.roohKeyHash);
  }

  async getActiveSession(): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    const sessionId = sessionStorage.getItem(ACTIVE_SESSION_ID_KEY);
    let session: SessionRecord | undefined;

    if (sessionId) {
      session = await db.sessions.get(sessionId);
    } else {
      // Check if there's an unexpired session in IndexedDB (for browser refresh persistence)
      const all = await db.sessions.toArray();
      const now = Date.now();
      session = all
        .filter((s) => s.expiresAt > now)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (session) {
        sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, session.id);
      }
    }

    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      await db.sessions.delete(session.id);
      sessionStorage.removeItem(ACTIVE_SESSION_ID_KEY);
      return null;
    }

    const user = await db.users.get(session.userId);
    if (!user) {
      await db.sessions.delete(session.id);
      sessionStorage.removeItem(ACTIVE_SESSION_ID_KEY);
      return null;
    }

    return { session, user };
  }

  async logout(sessionId: string): Promise<void> {
    if (sessionId) {
      await db.sessions.delete(sessionId);
    }
    sessionStorage.removeItem(ACTIVE_SESSION_ID_KEY);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await db.users.get(userId);
    if (!user) throw new Error('Account not found.');

    const currentOk = await verifySecret(currentPassword, user.passwordHash);
    if (!currentOk) {
      throw new Error('Current password is incorrect.');
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      throw new Error(strength.errors.join('. '));
    }

    const newHash = await hashSecret(newPassword);
    await db.users.update(userId, {
      passwordHash: newHash,
      updatedAt: Date.now(),
    });
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await db.users.get(userId);
    if (!user) throw new Error('Account not found.');

    const ok = await verifySecret(password, user.passwordHash);
    if (!ok) {
      throw new Error('Password verification failed. Account was not deleted.');
    }

    await db.transaction(
      'rw',
      [db.users, db.sessions, db.files, db.folders, db.notes, db.bookmarks, db.tags, db.trash],
      async () => {
        await db.files.where('userId').equals(userId).delete();
        await db.folders.where('userId').equals(userId).delete();
        await db.notes.where('userId').equals(userId).delete();
        await db.bookmarks.where('userId').equals(userId).delete();
        await db.tags.where('userId').equals(userId).delete();
        await db.trash.where('userId').equals(userId).delete();
        await db.sessions.where('userId').equals(userId).delete();
        await db.users.delete(userId);
      }
    );

    localStorage.removeItem(`${PREFS_PREFIX}${userId}`);
    sessionStorage.removeItem(ACTIVE_SESSION_ID_KEY);
  }

  async seedDemoVault(): Promise<LoginResult> {
    const existing = await db.users.where('username').equals('ghost_operator').first();
    if (existing) {
      const now = Date.now();
      const session: SessionRecord = {
        id: generateUuid(),
        userId: existing.id,
        username: existing.username,
        token: generateSessionToken(),
        createdAt: now,
        expiresAt: now + 120 * 60 * 1000,
      };
      await db.sessions.add(session);
      sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, session.id);
      return { user: existing, session };
    }

    const reg = await this.registerUser('ghost_operator', 'RoohVault2026!');
    const userId = reg.user.id;
    const folder = await this.createFolder(userId, 'Field Archives', null);

    const sampleMd = new File(
      [
        `# Welcome to rooh.clouds\n\nYour private local-first digital vault.\n\n- Files are stored as IndexedDB Blobs\n- Notes autosave with live Markdown preview\n- Export your entire vault archive anytime in Settings\n`,
      ],
      'vault-manifesto.md',
      { type: 'text/markdown' }
    );
    await this.uploadFile(userId, sampleMd, null);

    const sampleTxt = new File(
      [`ROOH.CLOUDS LOCAL ARCHIVE\nStorage Engine: IndexedDB via Dexie.js\nAll data remains on this browser device.\n`],
      'architecture-notes.txt',
      { type: 'text/plain' }
    );
    await this.uploadFile(userId, sampleTxt, folder.id);

    await this.createNote(
      userId,
      'Encrypted Memory Log',
      `## Field Observation\n\nEverything inside **rooh.clouds** persists locally in IndexedDB.\n\n### Quick Shortcuts\n- \`Ctrl/Cmd + K\`: Search vault\n- \`Ctrl/Cmd + U\`: Upload files\n- \`Ctrl/Cmd + N\`: Create note\n`,
      null
    );

    await this.createBookmark(userId, {
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API',
      title: 'MDN IndexedDB API Reference',
      description: 'Client-side storage of significant amounts of structured data and files/blobs.',
      faviconUrl: 'https://www.google.com/s2/favicons?domain=developer.mozilla.org&sz=64',
      tags: ['reference', 'storage'],
      isFavorite: true,
    });

    return { user: reg.user, session: reg.session };
  }

  async listFolders(userId: string): Promise<FolderRecord[]> {
    return db.folders.where('userId').equals(userId).toArray();
  }

  async createFolder(userId: string, rawName: string, parentId: string | null): Promise<FolderRecord> {
    const cleanName = sanitizeFileName(rawName);
    const siblings = await db.folders
      .where('userId')
      .equals(userId)
      .filter((f) => f.parentId === parentId)
      .toArray();

    const uniqueName = resolveDuplicateName(
      cleanName,
      siblings.map((s) => s.name)
    );

    const now = Date.now();
    const folder: FolderRecord = {
      id: generateUuid(),
      userId,
      name: uniqueName,
      parentId,
      tags: [],
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.folders.add(folder);
    return folder;
  }

  async renameFolder(userId: string, folderId: string, newName: string): Promise<FolderRecord> {
    const folder = await db.folders.get(folderId);
    if (!folder || folder.userId !== userId) throw new Error('Folder not found.');

    const cleanName = sanitizeFileName(newName);
    const siblings = await db.folders
      .where('userId')
      .equals(userId)
      .filter((f) => f.parentId === folder.parentId && f.id !== folderId)
      .toArray();

    const uniqueName = resolveDuplicateName(
      cleanName,
      siblings.map((s) => s.name)
    );

    const updatedAt = Date.now();
    await db.folders.update(folderId, { name: uniqueName, updatedAt });
    return { ...folder, name: uniqueName, updatedAt };
  }

  async moveFolder(userId: string, folderId: string, targetParentId: string | null): Promise<void> {
    if (folderId === targetParentId) {
      throw new Error('Cannot move a folder into itself.');
    }
    const allFolders = await this.listFolders(userId);
    const folder = allFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error('Folder not found.');

    // Prevent circular hierarchy
    let cursor = targetParentId;
    while (cursor) {
      if (cursor === folderId) {
        throw new Error('Cannot move a folder into one of its descendants.');
      }
      const parent = allFolders.find((f) => f.id === cursor);
      cursor = parent ? parent.parentId : null;
    }

    await db.folders.update(folderId, { parentId: targetParentId, updatedAt: Date.now() });
  }

  async toggleFolderFavorite(userId: string, folderId: string): Promise<FolderRecord> {
    const folder = await db.folders.get(folderId);
    if (!folder || folder.userId !== userId) throw new Error('Folder not found.');
    const next = !folder.isFavorite;
    const updatedAt = Date.now();
    await db.folders.update(folderId, { isFavorite: next, updatedAt });
    return { ...folder, isFavorite: next, updatedAt };
  }

  async deleteFolderToTrash(userId: string, folderId: string): Promise<void> {
    const allFolders = await this.listFolders(userId);
    const rootFolder = allFolders.find((f) => f.id === folderId);
    if (!rootFolder) throw new Error('Folder not found.');

    // Collect folder and all descendant folder IDs
    const folderIdsToRemove = new Set<string>([folderId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of allFolders) {
        if (f.parentId && folderIdsToRemove.has(f.parentId) && !folderIdsToRemove.has(f.id)) {
          folderIdsToRemove.add(f.id);
          added = true;
        }
      }
    }

    const descendantFolders = allFolders.filter((f) => folderIdsToRemove.has(f.id));
    const descendantFiles = await db.files
      .where('userId')
      .equals(userId)
      .filter((file) => file.folderId !== null && folderIdsToRemove.has(file.folderId))
      .toArray();

    const totalSize = descendantFiles.reduce((acc, f) => acc + f.size, 0);

    const trashEntry: TrashRecord = {
      id: generateUuid(),
      userId,
      itemType: 'folder',
      itemId: rootFolder.id,
      title: rootFolder.name,
      size: totalSize,
      originalParentId: rootFolder.parentId,
      payload: {
        folder: rootFolder,
        descendantFolders: descendantFolders.filter((f) => f.id !== rootFolder.id),
        descendantFiles,
      },
      deletedAt: Date.now(),
    };

    await db.transaction('rw', db.folders, db.files, db.trash, async () => {
      await db.trash.add(trashEntry);
      await db.folders.bulkDelete(Array.from(folderIdsToRemove));
      if (descendantFiles.length > 0) {
        await db.files.bulkDelete(descendantFiles.map((f) => f.id));
      }
    });
  }

  async listFiles(userId: string): Promise<FileRecord[]> {
    return db.files.where('userId').equals(userId).toArray();
  }

  async uploadFile(
    userId: string,
    file: File,
    folderId: string | null,
    callbacks?: UploadProgressCallbacks
  ): Promise<FileRecord> {
    if (callbacks?.signal?.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }

    callbacks?.onProgress?.(10);

    // Read file in chunks to allow cancellation and accurate progress feedback
    const chunkSize = 1024 * 512; // 512KB
    const chunks: BlobPart[] = [];
    let offset = 0;
    const total = Math.max(file.size, 1);

    while (offset < file.size) {
      if (callbacks?.signal?.aborted) {
        throw new DOMException('Upload cancelled', 'AbortError');
      }
      const slice = file.slice(offset, offset + chunkSize);
      const buffer = await slice.arrayBuffer();
      chunks.push(buffer);
      offset += chunkSize;
      const pct = Math.min(85, Math.round((offset / total) * 80) + 10);
      callbacks?.onProgress?.(pct);
    }

    if (callbacks?.signal?.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }

    let blob: Blob;
    let isEncrypted = false;
    let encryptionMeta: FileRecord['encryptionMeta'];

    if (callbacks?.roohKey) {
      const keyValid = await this.verifyRoohKey(userId, callbacks.roohKey);
      if (!keyValid) {
        throw new Error('Invalid Rooh Key. Encrypted upload aborted.');
      }
      const rawBuffer = await new Blob(chunks).arrayBuffer();
      const { ciphertext, meta } = await encryptBytesWithRoohKey(
        new Uint8Array(rawBuffer),
        file.type || 'application/octet-stream',
        callbacks.roohKey
      );
      blob = new Blob([ciphertext as BlobPart], { type: 'application/x-rooh-encrypted' });
      isEncrypted = true;
      encryptionMeta = meta;
      callbacks?.onProgress?.(94);
    } else {
      blob = new Blob(chunks, { type: file.type || 'application/octet-stream' });
    }

    const cleanName = sanitizeFileName(file.name);

    const siblings = await db.files
      .where('userId')
      .equals(userId)
      .filter((f) => f.folderId === folderId)
      .toArray();

    const uniqueName = resolveDuplicateName(
      cleanName,
      siblings.map((s) => s.name)
    );

    const now = Date.now();
    const record: FileRecord = {
      id: generateUuid(),
      userId,
      name: uniqueName,
      folderId,
      mimeType: file.type || 'application/octet-stream',
      category: detectFileCategory(file.type, uniqueName),
      extension: getFileExtension(uniqueName),
      size: blob.size,
      content: blob,
      isEncrypted,
      encryptionMeta,
      tags: [],
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.files.add(record);
    callbacks?.onProgress?.(100);
    return record;
  }

  async renameFile(userId: string, fileId: string, newName: string): Promise<FileRecord> {
    const file = await db.files.get(fileId);
    if (!file || file.userId !== userId) throw new Error('File not found.');

    const cleanName = sanitizeFileName(newName);
    const siblings = await db.files
      .where('userId')
      .equals(userId)
      .filter((f) => f.folderId === file.folderId && f.id !== fileId)
      .toArray();

    const uniqueName = resolveDuplicateName(
      cleanName,
      siblings.map((s) => s.name)
    );

    const updatedAt = Date.now();
    const extension = getFileExtension(uniqueName);
    const category = detectFileCategory(file.mimeType, uniqueName);
    await db.files.update(fileId, { name: uniqueName, extension, category, updatedAt });
    return { ...file, name: uniqueName, extension, category, updatedAt };
  }

  async moveFile(userId: string, fileId: string, targetFolderId: string | null): Promise<void> {
    const file = await db.files.get(fileId);
    if (!file || file.userId !== userId) throw new Error('File not found.');

    const siblings = await db.files
      .where('userId')
      .equals(userId)
      .filter((f) => f.folderId === targetFolderId && f.id !== fileId)
      .toArray();

    const uniqueName = resolveDuplicateName(
      file.name,
      siblings.map((s) => s.name)
    );

    await db.files.update(fileId, {
      folderId: targetFolderId,
      name: uniqueName,
      updatedAt: Date.now(),
    });
  }

  async toggleFileFavorite(userId: string, fileId: string): Promise<FileRecord> {
    const file = await db.files.get(fileId);
    if (!file || file.userId !== userId) throw new Error('File not found.');
    const isFavorite = !file.isFavorite;
    const updatedAt = Date.now();
    await db.files.update(fileId, { isFavorite, updatedAt });
    return { ...file, isFavorite, updatedAt };
  }

  async updateFileTags(userId: string, fileId: string, tags: string[]): Promise<FileRecord> {
    const file = await db.files.get(fileId);
    if (!file || file.userId !== userId) throw new Error('File not found.');
    const normalized = await this.ensureTags(userId, tags);
    const updatedAt = Date.now();
    await db.files.update(fileId, { tags: normalized, updatedAt });
    return { ...file, tags: normalized, updatedAt };
  }

  async deleteFileToTrash(userId: string, fileId: string): Promise<void> {
    const file = await db.files.get(fileId);
    if (!file || file.userId !== userId) throw new Error('File not found.');

    const trashEntry: TrashRecord = {
      id: generateUuid(),
      userId,
      itemType: 'file',
      itemId: file.id,
      title: file.name,
      size: file.size,
      originalParentId: file.folderId,
      payload: { file },
      deletedAt: Date.now(),
    };

    await db.transaction('rw', db.files, db.trash, async () => {
      await db.trash.add(trashEntry);
      await db.files.delete(fileId);
    });
  }

  async listNotes(userId: string): Promise<NoteRecord[]> {
    return db.notes.where('userId').equals(userId).toArray();
  }

  async createNote(
    userId: string,
    title = 'Untitled Note',
    content = '',
    folderId: string | null = null
  ): Promise<NoteRecord> {
    const now = Date.now();
    const note: NoteRecord = {
      id: generateUuid(),
      userId,
      title: title.trim() || 'Untitled Note',
      content,
      folderId,
      tags: [],
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.notes.add(note);
    return note;
  }

  async updateNote(
    userId: string,
    noteId: string,
    updates: Partial<Pick<NoteRecord, 'title' | 'content' | 'tags' | 'isFavorite' | 'folderId'>>
  ): Promise<NoteRecord> {
    const existing = await db.notes.get(noteId);
    if (!existing || existing.userId !== userId) throw new Error('Note not found.');

    const normalizedTags = updates.tags ? await this.ensureTags(userId, updates.tags) : existing.tags;
    const updated: NoteRecord = {
      ...existing,
      ...updates,
      tags: normalizedTags,
      updatedAt: Date.now(),
    };

    await db.notes.put(updated);
    return updated;
  }

  async deleteNoteToTrash(userId: string, noteId: string): Promise<void> {
    const note = await db.notes.get(noteId);
    if (!note || note.userId !== userId) throw new Error('Note not found.');

    const trashEntry: TrashRecord = {
      id: generateUuid(),
      userId,
      itemType: 'note',
      itemId: note.id,
      title: note.title || 'Untitled Note',
      size: new Blob([note.content]).size,
      originalParentId: note.folderId,
      payload: { note },
      deletedAt: Date.now(),
    };

    await db.transaction('rw', db.notes, db.trash, async () => {
      await db.trash.add(trashEntry);
      await db.notes.delete(noteId);
    });
  }

  async listBookmarks(userId: string): Promise<BookmarkRecord[]> {
    return db.bookmarks.where('userId').equals(userId).toArray();
  }

  async createBookmark(
    userId: string,
    input: { url: string; title: string; description: string; faviconUrl: string; tags: string[]; isFavorite?: boolean }
  ): Promise<BookmarkRecord> {
    const check = isValidHttpUrl(input.url);
    if (!check.valid || !check.normalized) {
      throw new Error(check.error || 'Invalid URL.');
    }

    const tags = await this.ensureTags(userId, input.tags);
    const now = Date.now();
    const record: BookmarkRecord = {
      id: generateUuid(),
      userId,
      url: check.normalized,
      title: input.title.trim() || new URL(check.normalized).hostname,
      description: input.description.trim(),
      faviconUrl: input.faviconUrl,
      tags,
      isFavorite: Boolean(input.isFavorite),
      createdAt: now,
      updatedAt: now,
    };

    await db.bookmarks.add(record);
    return record;
  }

  async updateBookmark(
    userId: string,
    bookmarkId: string,
    updates: Partial<Pick<BookmarkRecord, 'url' | 'title' | 'description' | 'tags' | 'isFavorite'>>
  ): Promise<BookmarkRecord> {
    const existing = await db.bookmarks.get(bookmarkId);
    if (!existing || existing.userId !== userId) throw new Error('Bookmark not found.');

    let normalizedUrl = existing.url;
    if (updates.url !== undefined) {
      const check = isValidHttpUrl(updates.url);
      if (!check.valid || !check.normalized) throw new Error(check.error || 'Invalid URL.');
      normalizedUrl = check.normalized;
    }

    const tags = updates.tags ? await this.ensureTags(userId, updates.tags) : existing.tags;
    const updated: BookmarkRecord = {
      ...existing,
      ...updates,
      url: normalizedUrl,
      tags,
      updatedAt: Date.now(),
    };

    await db.bookmarks.put(updated);
    return updated;
  }

  async deleteBookmarkToTrash(userId: string, bookmarkId: string): Promise<void> {
    const bm = await db.bookmarks.get(bookmarkId);
    if (!bm || bm.userId !== userId) throw new Error('Bookmark not found.');

    const trashEntry: TrashRecord = {
      id: generateUuid(),
      userId,
      itemType: 'bookmark',
      itemId: bm.id,
      title: bm.title || bm.url,
      size: new Blob([JSON.stringify(bm)]).size,
      originalParentId: null,
      payload: { bookmark: bm },
      deletedAt: Date.now(),
    };

    await db.transaction('rw', db.bookmarks, db.trash, async () => {
      await db.trash.add(trashEntry);
      await db.bookmarks.delete(bookmarkId);
    });
  }

  async listTags(userId: string): Promise<TagRecord[]> {
    return db.tags.where('userId').equals(userId).toArray();
  }

  async listTrash(userId: string): Promise<TrashRecord[]> {
    return db.trash.where('userId').equals(userId).reverse().sortBy('deletedAt');
  }

  async restoreTrashItem(userId: string, trashId: string): Promise<void> {
    const item = await db.trash.get(trashId);
    if (!item || item.userId !== userId) throw new Error('Trash item not found.');

    await db.transaction('rw', db.files, db.folders, db.notes, db.bookmarks, db.trash, async () => {
      if (item.itemType === 'file') {
        const file = item.payload.file as FileRecord | undefined;
        if (file) {
          // Verify parent folder still exists; fallback to root if deleted
          const parentExists = file.folderId ? Boolean(await db.folders.get(file.folderId)) : true;
          await db.files.put({
            ...file,
            folderId: parentExists ? file.folderId : null,
            updatedAt: Date.now(),
          });
        }
      } else if (item.itemType === 'folder') {
        const folder = item.payload.folder as FolderRecord | undefined;
        const descendantFolders = (item.payload.descendantFolders as FolderRecord[] | undefined) || [];
        const descendantFiles = (item.payload.descendantFiles as FileRecord[] | undefined) || [];
        if (folder) {
          const parentExists = folder.parentId ? Boolean(await db.folders.get(folder.parentId)) : true;
          await db.folders.put({
            ...folder,
            parentId: parentExists ? folder.parentId : null,
            updatedAt: Date.now(),
          });
        }
        if (descendantFolders.length > 0) {
          await db.folders.bulkPut(descendantFolders);
        }
        if (descendantFiles.length > 0) {
          await db.files.bulkPut(descendantFiles);
        }
      } else if (item.itemType === 'note') {
        const note = item.payload.note as NoteRecord | undefined;
        if (note) {
          await db.notes.put({ ...note, updatedAt: Date.now() });
        }
      } else if (item.itemType === 'bookmark') {
        const bookmark = item.payload.bookmark as BookmarkRecord | undefined;
        if (bookmark) {
          await db.bookmarks.put({ ...bookmark, updatedAt: Date.now() });
        }
      }

      await db.trash.delete(trashId);
    });
  }

  async permanentlyDeleteTrashItem(userId: string, trashId: string): Promise<void> {
    const item = await db.trash.get(trashId);
    if (!item || item.userId !== userId) return;
    await db.trash.delete(trashId);
  }

  async emptyTrash(userId: string): Promise<void> {
    await db.trash.where('userId').equals(userId).delete();
  }

  async getStorageAnalytics(userId: string): Promise<StorageAnalytics> {
    const [files, folders, notes, bookmarks, trash] = await Promise.all([
      this.listFiles(userId),
      this.listFolders(userId),
      this.listNotes(userId),
      this.listBookmarks(userId),
      this.listTrash(userId),
    ]);

    const filesBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const notesBytes = notes.reduce((sum, n) => sum + new Blob([n.title + n.content]).size, 0);
    const bookmarksBytes = bookmarks.reduce((sum, b) => sum + new Blob([JSON.stringify(b)]).size, 0);
    const trashBytes = trash.reduce((sum, t) => sum + (t.size || 0), 0);
    const vaultMeasuredBytes = filesBytes + notesBytes + bookmarksBytes + trashBytes;

    let browserQuotaBytes: number | null = null;
    let browserUsageBytes: number | null = null;
    let browserEstimateSupported = false;

    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const estimate = await navigator.storage.estimate();
        if (typeof estimate.quota === 'number') browserQuotaBytes = estimate.quota;
        if (typeof estimate.usage === 'number') browserUsageBytes = estimate.usage;
        browserEstimateSupported = true;
      } catch {
        browserEstimateSupported = false;
      }
    }

    const categories: { key: FileCategory; label: string }[] = [
      { key: 'image', label: 'Images' },
      { key: 'video', label: 'Videos' },
      { key: 'audio', label: 'Audio' },
      { key: 'document', label: 'Documents' },
      { key: 'code', label: 'Code & Config' },
      { key: 'archive', label: 'Archives' },
      { key: 'other', label: 'Other Binary' },
    ];

    const breakdown: StorageBreakdownItem[] = categories.map(({ key, label }) => {
      const matched = files.filter((f) => f.category === key);
      return {
        category: key,
        label,
        count: matched.length,
        bytes: matched.reduce((acc, f) => acc + f.size, 0),
      };
    });

    breakdown.push({
      category: 'notes',
      label: 'Markdown Notes',
      count: notes.length,
      bytes: notesBytes,
    });
    breakdown.push({
      category: 'bookmarks',
      label: 'URL Bookmarks',
      count: bookmarks.length,
      bytes: bookmarksBytes,
    });
    breakdown.push({
      category: 'trash',
      label: 'Trash Bin',
      count: trash.length,
      bytes: trashBytes,
    });

    const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 6);
    const recentFiles = [...files].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);

    return {
      vaultMeasuredBytes,
      filesBytes,
      notesBytes,
      bookmarksBytes,
      trashBytes,
      browserQuotaBytes,
      browserUsageBytes,
      browserEstimateSupported,
      totalFiles: files.length,
      totalFolders: folders.length,
      totalNotes: notes.length,
      totalBookmarks: bookmarks.length,
      totalTrashItems: trash.length,
      breakdown,
      largestFiles,
      recentFiles,
    };
  }

  async exportArchive(userId: string): Promise<VaultArchive> {
    const user = await db.users.get(userId);
    if (!user) throw new Error('User not found.');

    const [folders, files, notes, bookmarks, tags, trash] = await Promise.all([
      this.listFolders(userId),
      this.listFiles(userId),
      this.listNotes(userId),
      this.listBookmarks(userId),
      this.listTags(userId),
      this.listTrash(userId),
    ]);

    const serializedFiles: SerializedFileExport[] = [];
    for (const f of files) {
      const base64Content = await blobToBase64(f.content);
      serializedFiles.push({
        id: f.id,
        name: f.name,
        folderId: f.folderId,
        mimeType: f.mimeType,
        category: f.category,
        extension: f.extension,
        size: f.size,
        base64Content,
        isEncrypted: f.isEncrypted,
        encryptionMeta: f.encryptionMeta,
        tags: f.tags,
        isFavorite: f.isFavorite,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      });
    }

    return {
      schemaVersion: 1,
      app: 'rooh.clouds',
      exportedAt: Date.now(),
      username: user.username,
      folders: folders.map(({ userId: _u, ...rest }) => rest),
      files: serializedFiles,
      notes: notes.map(({ userId: _u, ...rest }) => rest),
      bookmarks: bookmarks.map(({ userId: _u, ...rest }) => rest),
      tags: tags.map(({ userId: _u, ...rest }) => rest),
      trash: [], // Trash blobs can be large/unserialized; export active vault items cleanly
    };
  }

  async importArchive(
    userId: string,
    rawArchive: unknown
  ): Promise<{ importedFiles: number; importedFolders: number; importedNotes: number; importedBookmarks: number }> {
    const validation = validateArchivePayload(rawArchive);
    if (!validation.valid || !validation.archive) {
      throw new Error(validation.error || 'Invalid archive payload.');
    }

    const archive = validation.archive;
    const folderIdMap = new Map<string, string>();
    const newFolders: FolderRecord[] = [];

    for (const f of archive.folders) {
      const newId = generateUuid();
      folderIdMap.set(f.id, newId);
    }
    for (const f of archive.folders) {
      newFolders.push({
        id: folderIdMap.get(f.id)!,
        userId,
        name: sanitizeFileName(f.name),
        parentId: f.parentId ? folderIdMap.get(f.parentId) ?? null : null,
        tags: Array.isArray(f.tags) ? f.tags.map(normalizeTagInput).filter(Boolean) : [],
        isFavorite: Boolean(f.isFavorite),
        createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
        updatedAt: typeof f.updatedAt === 'number' ? f.updatedAt : Date.now(),
      });
    }

    const existingFiles = await this.listFiles(userId);
    const existingNames = existingFiles.map((ef) => ef.name);
    const newFiles: FileRecord[] = [];

    for (const sf of archive.files) {
      let blob: Blob;
      try {
        blob = base64ToBlob(sf.base64Content, sf.mimeType);
      } catch {
        throw new Error(`Failed to decode binary data for file "${sf.name}".`);
      }

      const targetFolderId = sf.folderId ? folderIdMap.get(sf.folderId) ?? null : null;
      const safeName = resolveDuplicateName(sanitizeFileName(sf.name), existingNames);
      existingNames.push(safeName);

      newFiles.push({
        id: generateUuid(),
        userId,
        name: safeName,
        folderId: targetFolderId,
        mimeType: sf.mimeType || 'application/octet-stream',
        category: detectFileCategory(sf.mimeType, safeName),
        extension: getFileExtension(safeName),
        size: blob.size,
        content: blob,
        isEncrypted: Boolean(sf.isEncrypted),
        encryptionMeta: sf.encryptionMeta,
        tags: Array.isArray(sf.tags) ? sf.tags.map(normalizeTagInput).filter(Boolean) : [],
        isFavorite: Boolean(sf.isFavorite),
        createdAt: typeof sf.createdAt === 'number' ? sf.createdAt : Date.now(),
        updatedAt: typeof sf.updatedAt === 'number' ? sf.updatedAt : Date.now(),
      });
    }

    const newNotes: NoteRecord[] = archive.notes.map((n) => ({
      id: generateUuid(),
      userId,
      title: String(n.title || 'Imported Note').slice(0, 180),
      content: String(n.content || ''),
      folderId: n.folderId ? folderIdMap.get(n.folderId) ?? null : null,
      tags: Array.isArray(n.tags) ? n.tags.map(normalizeTagInput).filter(Boolean) : [],
      isFavorite: Boolean(n.isFavorite),
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
      updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : Date.now(),
    }));

    const newBookmarks: BookmarkRecord[] = [];
    for (const b of archive.bookmarks) {
      const urlCheck = isValidHttpUrl(b.url);
      if (!urlCheck.valid || !urlCheck.normalized) continue;
      newBookmarks.push({
        id: generateUuid(),
        userId,
        url: urlCheck.normalized,
        title: String(b.title || new URL(urlCheck.normalized).hostname).slice(0, 140),
        description: String(b.description || '').slice(0, 280),
        faviconUrl:
          b.faviconUrl ||
          `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(urlCheck.normalized).hostname)}&sz=64`,
        tags: Array.isArray(b.tags) ? b.tags.map(normalizeTagInput).filter(Boolean) : [],
        isFavorite: Boolean(b.isFavorite),
        createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
        updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : Date.now(),
      });
    }

    await db.transaction('rw', db.folders, db.files, db.notes, db.bookmarks, async () => {
      if (newFolders.length) await db.folders.bulkAdd(newFolders);
      if (newFiles.length) await db.files.bulkAdd(newFiles);
      if (newNotes.length) await db.notes.bulkAdd(newNotes);
      if (newBookmarks.length) await db.bookmarks.bulkAdd(newBookmarks);
    });

    // Sync tags index
    const allTagNames = [
      ...newFiles.flatMap((f) => f.tags),
      ...newNotes.flatMap((n) => n.tags),
      ...newBookmarks.flatMap((b) => b.tags),
    ];
    await this.ensureTags(userId, allTagNames);

    return {
      importedFiles: newFiles.length,
      importedFolders: newFolders.length,
      importedNotes: newNotes.length,
      importedBookmarks: newBookmarks.length,
    };
  }

  async clearCache(): Promise<void> {
    // Clears transient session cache & expired sessions without deleting user vault records
    const now = Date.now();
    const expired = await db.sessions.filter((s) => s.expiresAt <= now).toArray();
    if (expired.length > 0) {
      await db.sessions.bulkDelete(expired.map((s) => s.id));
    }
  }

  async getPreferences(userId: string): Promise<VaultPreferences> {
    try {
      const raw = localStorage.getItem(`${PREFS_PREFIX}${userId}`);
      if (!raw) return { ...DEFAULT_PREFS };
      const parsed = JSON.parse(raw) as Partial<VaultPreferences>;
      return { ...DEFAULT_PREFS, ...parsed };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  async savePreferences(userId: string, prefs: VaultPreferences): Promise<void> {
    localStorage.setItem(`${PREFS_PREFIX}${userId}`, JSON.stringify(prefs));
  }
}
