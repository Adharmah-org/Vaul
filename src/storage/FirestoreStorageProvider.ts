import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  generateRoohKey,
  generateSessionToken,
  generateUuid,
  hashSecret,
  normalizeRoohKey,
  validatePasswordStrength,
  validateUsername,
  verifySecret,
} from '../services/crypto';
import {
  arrayBufferToBase64,
  base64ToBlob,
  base64ToUint8Array,
  blobToBase64,
  detectFileCategory,
  getFileExtension,
  isValidHttpUrl,
  normalizeTagInput,
  resolveDuplicateName,
  sanitizeFileName,
  uint8ArrayToBase64,
  validateArchivePayload,
} from '../services/fileUtils';
import { encryptBytesWithRoohKey } from '../services/roohCrypto';
import {
  BookmarkRecord,
  FileEncryptionMeta,
  FileRecord,
  FolderRecord,
  NoteRecord,
  SessionRecord,
  StorageAnalytics,
  StorageBreakdownItem,
  TagRecord,
  TrashRecord,
  UserRecord,
  VaultArchive,
  VaultPreferences,
} from '../types/vault';
import {
  LoginResult,
  RegisterResult,
  StorageProvider,
  UploadProgressCallbacks,
} from './StorageProvider';

const CLOUD_SESSION_KEY_PREFIX = 'rooh_cloud_session_';
const CHUNK_BINARY_BYTES = 360 * 1024; // ~492 KB base64 (< 520,000 char rule cap)
export const MAX_CLOUD_FILE_BYTES = 8 * 1024 * 1024; // 8 MB max per file (~23 chunks <= 30 cap)

const DEFAULT_PREFERENCES: VaultPreferences = {
  accentMode: 'matrix',
  matrixRain: true,
  scanlines: true,
  reducedMotion: false,
  sessionDurationMinutes: 120,
  defaultViewMode: 'grid',
};

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: unknown }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return Date.now();
}

function boundTags(tags: string[]): string[] {
  const clean = Array.from(
    new Set(tags.map(normalizeTagInput).filter((t) => t.length >= 1 && t.length <= 40))
  );
  return clean.slice(0, 20);
}

function clampString(value: string, maxLen: number): string {
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

const ACTIVE_VAULT_USER_ID_KEY = 'rooh_active_vault_id';

export function getVaultDocId(username: string): string {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return `u_${clean}`;
}

function requireVerifiedUid(expectedUserId?: string): string {
  if (expectedUserId && expectedUserId.trim()) {
    return expectedUserId.trim();
  }
  const active = sessionStorage.getItem(ACTIVE_VAULT_USER_ID_KEY);
  if (active) return active;
  throw new Error('Authentication required: No active vault session.');
}

export class FirestoreStorageProvider implements StorageProvider {
  readonly providerName = 'Cloud Firestore Vault';
  readonly isRemoteBacked = true;

  private blobCache = new Map<string, Blob>();

  private vaultRef(uid: string) {
    return doc(db, 'vaults', uid);
  }

  private subCol(uid: string, name: string) {
    return collection(db, 'vaults', uid, name);
  }

  private subDoc(uid: string, name: string, id: string) {
    return doc(db, 'vaults', uid, name, id);
  }

  async getCloudVaultStatus(uid: string): Promise<{ exists: boolean; username?: string }> {
    const path = `vaults/${uid}`;
    try {
      const snap = await getDoc(this.vaultRef(uid));
      if (!snap.exists()) return { exists: false };
      const data = snap.data();
      return {
        exists: true,
        username: typeof data.username === 'string' ? data.username : undefined,
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async hasAnyUser(): Promise<boolean> {
    const active = sessionStorage.getItem(ACTIVE_VAULT_USER_ID_KEY);
    if (!active) return false;
    const status = await this.getCloudVaultStatus(active);
    return status.exists;
  }

  async registerUser(username: string): Promise<RegisterResult> {
    const cleanUsername = username.trim();
    const uCheck = validateUsername(cleanUsername);
    if (!uCheck.valid) {
      throw new Error(uCheck.error || 'Invalid username.');
    }

    const uid = getVaultDocId(cleanUsername);
    const path = `vaults/${uid}`;
    try {
      const existingSnap = await getDoc(this.vaultRef(uid));
      if (existingSnap.exists()) {
        throw new Error('A vault already exists for this username. Switch to Sign In to unlock.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) throw error;
      handleFirestoreError(error, OperationType.GET, path);
    }

    const roohKey = generateRoohKey();
    const roohKeyHash = await hashSecret(roohKey);

    try {
      await setDoc(this.vaultRef(uid), {
        ownerUid: uid,
        username: cleanUsername,
        usernameLower: cleanUsername.toLowerCase(),
        roohKeyHash,
        preferences: DEFAULT_PREFERENCES,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }

    const now = Date.now();
    const user: UserRecord = {
      id: uid,
      username: cleanUsername,
      roohKeyHash,
      createdAt: now,
      updatedAt: now,
    };

    const session: SessionRecord = {
      id: generateUuid(),
      userId: uid,
      username: cleanUsername,
      token: generateSessionToken(),
      createdAt: now,
      expiresAt: now + DEFAULT_PREFERENCES.sessionDurationMinutes * 60 * 1000,
    };
    sessionStorage.setItem(ACTIVE_VAULT_USER_ID_KEY, uid);
    sessionStorage.setItem(`${CLOUD_SESSION_KEY_PREFIX}${uid}`, JSON.stringify(session));

    return { user, roohKey, session };
  }

  async syncUserToCloud(user: UserRecord): Promise<void> {
    const uid = getVaultDocId(user.username);
    const path = `vaults/${uid}`;
    try {
      const snap = await getDoc(this.vaultRef(uid));
      if (!snap.exists()) {
        await setDoc(this.vaultRef(uid), {
          ownerUid: uid,
          username: user.username,
          usernameLower: user.username.toLowerCase(),
          roohKeyHash: user.roohKeyHash,
          preferences: DEFAULT_PREFERENCES,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  async authenticateUser(username: string, roohKey: string): Promise<LoginResult> {
    const cleanUsername = username.trim();
    const cleanUsernameLower = cleanUsername.toLowerCase();
    const uid = getVaultDocId(cleanUsername);
    const normalizedKey = normalizeRoohKey(roohKey);
    const path = `vaults/${uid}`;

    let data: Record<string, unknown> | undefined;
    try {
      const snap = await getDoc(this.vaultRef(uid));
      if (!snap.exists()) {
        throw new Error('ACCESS DENIED: No vault found matching this username. Create a vault or check spelling.');
      }
      data = snap.data();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('ACCESS DENIED:')) throw error;
      handleFirestoreError(error, OperationType.GET, path);
    }

    if (!data || String(data.usernameLower || '') !== cleanUsernameLower) {
      throw new Error('ACCESS DENIED: Invalid username or Rooh Key.');
    }

    const keyOk = await verifySecret(normalizedKey, String(data.roohKeyHash || ''));

    if (!keyOk) {
      throw new Error('ACCESS DENIED: Invalid Rooh Key.');
    }

    const prefs = (data.preferences as VaultPreferences | undefined) || DEFAULT_PREFERENCES;
    const durationMs = (prefs.sessionDurationMinutes || 120) * 60 * 1000;
    const now = Date.now();

    const user: UserRecord = {
      id: uid,
      username: String(data.username),
      roohKeyHash: String(data.roohKeyHash),
      createdAt: toMillis(data.createdAt),
      updatedAt: toMillis(data.updatedAt),
    };

    const session: SessionRecord = {
      id: generateUuid(),
      userId: uid,
      username: user.username,
      token: generateSessionToken(),
      createdAt: now,
      expiresAt: now + durationMs,
    };
    sessionStorage.setItem(ACTIVE_VAULT_USER_ID_KEY, uid);
    sessionStorage.setItem(`${CLOUD_SESSION_KEY_PREFIX}${uid}`, JSON.stringify(session));

    return { user, session };
  }

  async verifyRoohKey(userId: string, roohKey: string): Promise<boolean> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}`;
    try {
      const snap = await getDoc(this.vaultRef(uid));
      if (!snap.exists()) return false;
      const hash = String(snap.data().roohKeyHash || '');
      return verifySecret(normalizeRoohKey(roohKey), hash);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async getActiveSession(): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    const activeId = sessionStorage.getItem(ACTIVE_VAULT_USER_ID_KEY);
    if (!activeId) return null;

    const raw = sessionStorage.getItem(`${CLOUD_SESSION_KEY_PREFIX}${activeId}`);
    if (!raw) return null;

    let session: SessionRecord;
    try {
      session = JSON.parse(raw) as SessionRecord;
    } catch {
      sessionStorage.removeItem(ACTIVE_VAULT_USER_ID_KEY);
      sessionStorage.removeItem(`${CLOUD_SESSION_KEY_PREFIX}${activeId}`);
      return null;
    }

    if (!session || Date.now() > session.expiresAt || session.userId !== activeId) {
      sessionStorage.removeItem(ACTIVE_VAULT_USER_ID_KEY);
      sessionStorage.removeItem(`${CLOUD_SESSION_KEY_PREFIX}${activeId}`);
      return null;
    }

    const path = `vaults/${activeId}`;
    try {
      const snap = await getDoc(this.vaultRef(activeId));
      if (!snap.exists()) {
        sessionStorage.removeItem(ACTIVE_VAULT_USER_ID_KEY);
        sessionStorage.removeItem(`${CLOUD_SESSION_KEY_PREFIX}${activeId}`);
        return null;
      }
      const data = snap.data();
      const user: UserRecord = {
        id: activeId,
        username: String(data.username),
        roohKeyHash: String(data.roohKeyHash),
        createdAt: toMillis(data.createdAt),
        updatedAt: toMillis(data.updatedAt),
      };
      return { session, user };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async logout(_sessionId: string): Promise<void> {
    const activeId = sessionStorage.getItem(ACTIVE_VAULT_USER_ID_KEY);
    if (activeId) {
      sessionStorage.removeItem(`${CLOUD_SESSION_KEY_PREFIX}${activeId}`);
    }
    sessionStorage.removeItem(ACTIVE_VAULT_USER_ID_KEY);
    this.blobCache.clear();
  }

  async rotateRoohKey(userId: string, currentRoohKeyInput: string): Promise<string> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}`;
    let currentHash = '';
    try {
      const snap = await getDoc(this.vaultRef(uid));
      if (!snap.exists()) throw new Error('Account not found.');
      currentHash = String(snap.data().roohKeyHash || '');
    } catch (error) {
      if (error instanceof Error && error.message === 'Account not found.') throw error;
      handleFirestoreError(error, OperationType.GET, path);
    }

    const ok = await verifySecret(normalizeRoohKey(currentRoohKeyInput), currentHash);
    if (!ok) {
      throw new Error('Current Rooh Key is incorrect.');
    }

    const newKey = generateRoohKey();
    const newHash = await hashSecret(newKey);
    try {
      await updateDoc(this.vaultRef(uid), {
        roohKeyHash: newHash,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    return newKey;
  }

  async deleteAccount(userId: string, roohKeyInput: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}`;
    let currentHash = '';
    try {
      const snap = await getDoc(this.vaultRef(uid));
      if (!snap.exists()) throw new Error('Account not found.');
      currentHash = String(snap.data().roohKeyHash || '');
    } catch (error) {
      if (error instanceof Error && error.message === 'Account not found.') throw error;
      handleFirestoreError(error, OperationType.GET, path);
    }

    const ok = await verifySecret(normalizeRoohKey(roohKeyInput), currentHash);
    if (!ok) {
      throw new Error('Rooh Key verification failed. Cloud Vault was not deleted.');
    }

    const subcollections = ['fileChunks', 'files', 'folders', 'notes', 'bookmarks', 'tags', 'trash'];
    for (const sub of subcollections) {
      const subPath = `vaults/${uid}/${sub}`;
      try {
        const q = query(this.subCol(uid, sub), where('ownerUid', '==', uid));
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await deleteDoc(d.ref);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, subPath);
      }
    }

    try {
      await deleteDoc(this.vaultRef(uid));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }

    sessionStorage.removeItem(`${CLOUD_SESSION_KEY_PREFIX}${uid}`);
    this.blobCache.clear();
  }

  async seedDemoVault(): Promise<LoginResult> {
    throw new Error('Demo autostart is only supported in Local Device Vault mode.');
  }

  // Folders
  async listFolders(userId: string): Promise<FolderRecord[]> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}/folders`;
    try {
      const q = query(this.subCol(uid, 'folders'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id),
          userId: uid,
          name: String(data.name),
          parentId: typeof data.parentId === 'string' ? data.parentId : null,
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
          isFavorite: Boolean(data.isFavorite),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  async createFolder(userId: string, rawName: string, parentId: string | null): Promise<FolderRecord> {
    const uid = requireVerifiedUid(userId);
    const cleanName = clampString(sanitizeFileName(rawName), 180) || 'untitled_folder';
    const allFolders = await this.listFolders(uid);
    const siblings = allFolders.filter((f) => f.parentId === parentId);
    const uniqueName = clampString(
      resolveDuplicateName(
        cleanName,
        siblings.map((s) => s.name)
      ),
      180
    );

    const id = generateUuid();
    const path = `vaults/${uid}/folders/${id}`;
    try {
      await setDoc(this.subDoc(uid, 'folders', id), {
        id,
        ownerUid: uid,
        name: uniqueName,
        parentId: parentId || null,
        tags: [],
        isFavorite: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }

    const now = Date.now();
    return {
      id,
      userId: uid,
      name: uniqueName,
      parentId: parentId || null,
      tags: [],
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  async renameFolder(userId: string, folderId: string, newName: string): Promise<FolderRecord> {
    const uid = requireVerifiedUid(userId);
    const allFolders = await this.listFolders(uid);
    const folder = allFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error('Folder not found.');

    const cleanName = clampString(sanitizeFileName(newName), 180) || 'untitled_folder';
    const siblings = allFolders.filter((f) => f.parentId === folder.parentId && f.id !== folderId);
    const uniqueName = clampString(
      resolveDuplicateName(
        cleanName,
        siblings.map((s) => s.name)
      ),
      180
    );

    const path = `vaults/${uid}/folders/${folderId}`;
    try {
      await updateDoc(this.subDoc(uid, 'folders', folderId), {
        name: uniqueName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    return { ...folder, name: uniqueName, updatedAt: Date.now() };
  }

  async moveFolder(userId: string, folderId: string, targetParentId: string | null): Promise<void> {
    const uid = requireVerifiedUid(userId);
    if (folderId === targetParentId) {
      throw new Error('Cannot move a folder into itself.');
    }
    const allFolders = await this.listFolders(uid);
    const folder = allFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error('Folder not found.');

    let cursor = targetParentId;
    while (cursor) {
      if (cursor === folderId) {
        throw new Error('Cannot move a folder into one of its descendants.');
      }
      const parent = allFolders.find((f) => f.id === cursor);
      cursor = parent ? parent.parentId : null;
    }

    const path = `vaults/${uid}/folders/${folderId}`;
    try {
      await updateDoc(this.subDoc(uid, 'folders', folderId), {
        parentId: targetParentId || null,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async toggleFolderFavorite(userId: string, folderId: string): Promise<FolderRecord> {
    const uid = requireVerifiedUid(userId);
    const allFolders = await this.listFolders(uid);
    const folder = allFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error('Folder not found.');

    const next = !folder.isFavorite;
    const path = `vaults/${uid}/folders/${folderId}`;
    try {
      await updateDoc(this.subDoc(uid, 'folders', folderId), {
        isFavorite: next,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return { ...folder, isFavorite: next, updatedAt: Date.now() };
  }

  async deleteFolderToTrash(userId: string, folderId: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const [allFolders, allFiles, allNotes] = await Promise.all([
      this.listFolders(uid),
      this.listFiles(uid),
      this.listNotes(uid),
    ]);

    const rootFolder = allFolders.find((f) => f.id === folderId);
    if (!rootFolder) throw new Error('Folder not found.');

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
    const descendantFiles = allFiles
      .filter((f) => f.folderId !== null && folderIdsToRemove.has(f.folderId))
      .map(({ content: _omit, ...meta }) => meta);
    const descendantNotes = allNotes.filter(
      (n) => n.folderId !== null && folderIdsToRemove.has(n.folderId)
    );

    const totalSize =
      descendantFiles.reduce((s, f) => s + f.size, 0) +
      descendantNotes.reduce((s, n) => s + new Blob([n.content]).size, 0);

    const trashId = generateUuid();
    const trashPath = `vaults/${uid}/trash/${trashId}`;
    try {
      await setDoc(this.subDoc(uid, 'trash', trashId), {
        id: trashId,
        ownerUid: uid,
        itemType: 'folder',
        itemId: rootFolder.id,
        title: clampString(rootFolder.name, 255),
        size: totalSize,
        originalParentId: rootFolder.parentId,
        payload: {
          record: rootFolder,
          descendantFolders,
          files: descendantFiles,
          notes: descendantNotes,
        },
        deletedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, trashPath);
    }

    for (const f of descendantFolders) {
      try {
        await deleteDoc(this.subDoc(uid, 'folders', f.id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `vaults/${uid}/folders/${f.id}`);
      }
    }
    for (const f of descendantFiles) {
      try {
        await deleteDoc(this.subDoc(uid, 'files', f.id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `vaults/${uid}/files/${f.id}`);
      }
    }
    for (const n of descendantNotes) {
      try {
        await deleteDoc(this.subDoc(uid, 'notes', n.id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `vaults/${uid}/notes/${n.id}`);
      }
    }
  }

  // Files
  async listFiles(userId: string): Promise<FileRecord[]> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}/files`;
    try {
      const q = query(this.subCol(uid, 'files'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        const id = String(data.id);
        const mimeType = String(data.mimeType || 'application/octet-stream');
        const cached = this.blobCache.get(id);
        return {
          id,
          userId: uid,
          name: String(data.name),
          folderId: typeof data.folderId === 'string' ? data.folderId : null,
          mimeType,
          category: data.category as FileRecord['category'],
          extension: String(data.extension || ''),
          size: Number(data.size || 0),
          chunkCount: Number(data.chunkCount || 0),
          cloudSynced: Boolean(data.cloudSynced),
          content: cached || new Blob([], { type: mimeType }),
          isEncrypted: Boolean(data.isEncrypted),
          encryptionMeta: (data.encryptionMeta as FileEncryptionMeta | null) || undefined,
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
          isFavorite: Boolean(data.isFavorite),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  async resolveFileBlob(userId: string, file: FileRecord): Promise<Blob> {
    const uid = requireVerifiedUid(userId);
    const cached = this.blobCache.get(file.id);
    if (cached && (cached.size > 0 || file.size === 0)) {
      return cached;
    }

    if (file.content && file.content.size > 0) {
      this.blobCache.set(file.id, file.content);
      return file.content;
    }

    if (file.size === 0) {
      const empty = new Blob([], { type: file.mimeType });
      this.blobCache.set(file.id, empty);
      return empty;
    }

    const path = `vaults/${uid}/fileChunks`;
    try {
      const q = query(
        this.subCol(uid, 'fileChunks'),
        where('ownerUid', '==', uid),
        where('fileId', '==', file.id)
      );
      const snap = await getDocs(q);
      const ordered = snap.docs
        .map((d) => d.data())
        .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));

      const parts = ordered.map((c) => base64ToUint8Array(String(c.dataBase64 || '')) as BlobPart);
      const blob = new Blob(parts, { type: file.mimeType || 'application/octet-stream' });
      this.blobCache.set(file.id, blob);
      return blob;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  async uploadFile(
    userId: string,
    file: File,
    folderId: string | null,
    callbacks?: UploadProgressCallbacks
  ): Promise<FileRecord> {
    const uid = requireVerifiedUid(userId);
    if (callbacks?.signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    if (file.size > MAX_CLOUD_FILE_BYTES) {
      throw new Error(
        `Cloud Vault sync supports files up to 8 MB per item ("${file.name}" is ${(
          file.size /
          (1024 * 1024)
        ).toFixed(1)} MB).`
      );
    }

    const cleanName = clampString(sanitizeFileName(file.name), 255) || 'file';
    const existingFiles = await this.listFiles(uid);
    const siblings = existingFiles.filter((f) => f.folderId === folderId);
    const uniqueName = clampString(
      resolveDuplicateName(
        cleanName,
        siblings.map((s) => s.name)
      ),
      255
    );

    const originalMimeType = clampString(file.type || 'application/octet-stream', 160);
    const extension = clampString(getFileExtension(uniqueName), 32);
    const category = detectFileCategory(originalMimeType, uniqueName);

    callbacks?.onProgress?.(10);

    const rawBytes = new Uint8Array(await file.arrayBuffer());
    if (callbacks?.signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    let payloadBytes: Uint8Array = rawBytes;
    let isEncrypted = false;
    let encryptionMeta: FileEncryptionMeta | null = null;
    let storedMimeType = originalMimeType;

    if (callbacks?.roohKey) {
      callbacks?.onProgress?.(22);
      const encrypted = await encryptBytesWithRoohKey(
        rawBytes,
        originalMimeType,
        callbacks.roohKey
      );
      if (encrypted.ciphertext.byteLength > MAX_CLOUD_FILE_BYTES) {
        throw new Error(`Encrypted payload for "${uniqueName}" exceeds 8 MB cloud limit.`);
      }
      payloadBytes = encrypted.ciphertext;
      isEncrypted = true;
      encryptionMeta = encrypted.meta;
      storedMimeType = 'application/octet-stream';
    }

    const chunks: string[] = [];
    for (let offset = 0; offset < payloadBytes.byteLength; offset += CHUNK_BINARY_BYTES) {
      const slice = payloadBytes.subarray(offset, offset + CHUNK_BINARY_BYTES);
      chunks.push(uint8ArrayToBase64(slice));
    }

    const fileId = generateUuid();
    const filePath = `vaults/${uid}/files/${fileId}`;

    try {
      await setDoc(this.subDoc(uid, 'files', fileId), {
        id: fileId,
        ownerUid: uid,
        name: uniqueName,
        folderId: folderId || null,
        mimeType: storedMimeType,
        category,
        extension,
        size: payloadBytes.byteLength,
        chunkCount: chunks.length,
        cloudSynced: true,
        isEncrypted,
        encryptionMeta,
        tags: [],
        isFavorite: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, filePath);
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (callbacks?.signal?.aborted) {
          throw new DOMException('Upload aborted', 'AbortError');
        }
        const chunkId = `${fileId}_${i}`;
        await setDoc(this.subDoc(uid, 'fileChunks', chunkId), {
          id: chunkId,
          ownerUid: uid,
          fileId,
          chunkIndex: i,
          dataBase64: chunks[i],
          createdAt: serverTimestamp(),
        });
        const pct = Math.min(95, 25 + Math.round(((i + 1) / Math.max(1, chunks.length)) * 70));
        callbacks?.onProgress?.(pct);
      }
    } catch (error) {
      // Clean up parent metadata and any uploaded chunks on abort or failure
      await this.deleteFileAndChunks(uid, fileId).catch(() => {});
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      handleFirestoreError(error, OperationType.CREATE, `vaults/${uid}/fileChunks`);
    }

    const contentBlob = new Blob([payloadBytes as BlobPart], { type: storedMimeType });
    this.blobCache.set(fileId, contentBlob);
    callbacks?.onProgress?.(100);

    const now = Date.now();
    return {
      id: fileId,
      userId: uid,
      name: uniqueName,
      folderId: folderId || null,
      mimeType: storedMimeType,
      category,
      extension,
      size: payloadBytes.byteLength,
      chunkCount: chunks.length,
      cloudSynced: true,
      content: contentBlob,
      isEncrypted,
      encryptionMeta: encryptionMeta || undefined,
      tags: [],
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async deleteFileAndChunks(uid: string, fileId: string): Promise<void> {
    try {
      const q = query(
        this.subCol(uid, 'fileChunks'),
        where('ownerUid', '==', uid),
        where('fileId', '==', fileId)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `vaults/${uid}/fileChunks`);
    }
    try {
      await deleteDoc(this.subDoc(uid, 'files', fileId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `vaults/${uid}/files/${fileId}`);
    }
    this.blobCache.delete(fileId);
  }

  async renameFile(userId: string, fileId: string, newName: string): Promise<FileRecord> {
    const uid = requireVerifiedUid(userId);
    const allFiles = await this.listFiles(uid);
    const file = allFiles.find((f) => f.id === fileId);
    if (!file) throw new Error('File not found.');

    const cleanName = clampString(sanitizeFileName(newName), 255) || 'file';
    const siblings = allFiles.filter((f) => f.folderId === file.folderId && f.id !== fileId);
    const uniqueName = clampString(
      resolveDuplicateName(
        cleanName,
        siblings.map((s) => s.name)
      ),
      255
    );

    const path = `vaults/${uid}/files/${fileId}`;
    try {
      await updateDoc(this.subDoc(uid, 'files', fileId), {
        name: uniqueName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    return { ...file, name: uniqueName, updatedAt: Date.now() };
  }

  async moveFile(userId: string, fileId: string, targetFolderId: string | null): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}/files/${fileId}`;
    try {
      await updateDoc(this.subDoc(uid, 'files', fileId), {
        folderId: targetFolderId || null,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  async toggleFileFavorite(userId: string, fileId: string): Promise<FileRecord> {
    const uid = requireVerifiedUid(userId);
    const allFiles = await this.listFiles(uid);
    const file = allFiles.find((f) => f.id === fileId);
    if (!file) throw new Error('File not found.');

    const next = !file.isFavorite;
    const path = `vaults/${uid}/files/${fileId}`;
    try {
      await updateDoc(this.subDoc(uid, 'files', fileId), {
        isFavorite: next,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return { ...file, isFavorite: next, updatedAt: Date.now() };
  }

  async updateFileTags(userId: string, fileId: string, tags: string[]): Promise<FileRecord> {
    const uid = requireVerifiedUid(userId);
    const allFiles = await this.listFiles(uid);
    const file = allFiles.find((f) => f.id === fileId);
    if (!file) throw new Error('File not found.');

    const cleanTags = boundTags(tags);
    const path = `vaults/${uid}/files/${fileId}`;
    try {
      await updateDoc(this.subDoc(uid, 'files', fileId), {
        tags: cleanTags,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    await this.syncTagsForUser(uid, cleanTags);
    return { ...file, tags: cleanTags, updatedAt: Date.now() };
  }

  async deleteFileToTrash(userId: string, fileId: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const allFiles = await this.listFiles(uid);
    const file = allFiles.find((f) => f.id === fileId);
    if (!file) throw new Error('File not found.');

    const { content: _omit, ...meta } = file;
    const trashId = generateUuid();
    try {
      await setDoc(this.subDoc(uid, 'trash', trashId), {
        id: trashId,
        ownerUid: uid,
        itemType: 'file',
        itemId: file.id,
        title: clampString(file.name, 255),
        size: file.size,
        originalParentId: file.folderId,
        payload: { record: meta },
        deletedAt: serverTimestamp(),
      });
      await deleteDoc(this.subDoc(uid, 'files', fileId));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `vaults/${uid}/trash/${trashId}`);
    }
  }

  // Notes
  async listNotes(userId: string): Promise<NoteRecord[]> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}/notes`;
    try {
      const q = query(this.subCol(uid, 'notes'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id),
          userId: uid,
          title: String(data.title),
          content: String(data.content || ''),
          folderId: typeof data.folderId === 'string' ? data.folderId : null,
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
          isFavorite: Boolean(data.isFavorite),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  async createNote(
    userId: string,
    title = 'Untitled Note',
    content = '',
    folderId: string | null = null
  ): Promise<NoteRecord> {
    const uid = requireVerifiedUid(userId);
    const id = generateUuid();
    const safeTitle = clampString(title.trim() || 'Untitled Note', 200);
    const safeContent = clampString(content, 250000);
    const path = `vaults/${uid}/notes/${id}`;
    try {
      await setDoc(this.subDoc(uid, 'notes', id), {
        id,
        ownerUid: uid,
        title: safeTitle,
        content: safeContent,
        folderId: folderId || null,
        tags: [],
        isFavorite: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }

    const now = Date.now();
    return {
      id,
      userId: uid,
      title: safeTitle,
      content: safeContent,
      folderId: folderId || null,
      tags: [],
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateNote(
    userId: string,
    noteId: string,
    updates: Partial<Pick<NoteRecord, 'title' | 'content' | 'tags' | 'isFavorite' | 'folderId'>>
  ): Promise<NoteRecord> {
    const uid = requireVerifiedUid(userId);
    const allNotes = await this.listNotes(uid);
    const existing = allNotes.find((n) => n.id === noteId);
    if (!existing) throw new Error('Note not found.');

    const cleanTags = updates.tags ? boundTags(updates.tags) : existing.tags;
    const nextTitle =
      updates.title !== undefined ? clampString(updates.title.trim() || 'Untitled Note', 200) : existing.title;
    const nextContent =
      updates.content !== undefined ? clampString(updates.content, 250000) : existing.content;
    const nextFolderId = updates.folderId !== undefined ? updates.folderId : existing.folderId;
    const nextFav = updates.isFavorite !== undefined ? updates.isFavorite : existing.isFavorite;

    const path = `vaults/${uid}/notes/${noteId}`;
    try {
      await updateDoc(this.subDoc(uid, 'notes', noteId), {
        title: nextTitle,
        content: nextContent,
        folderId: nextFolderId || null,
        tags: cleanTags,
        isFavorite: nextFav,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    if (updates.tags) {
      await this.syncTagsForUser(uid, cleanTags);
    }

    return {
      ...existing,
      title: nextTitle,
      content: nextContent,
      folderId: nextFolderId || null,
      tags: cleanTags,
      isFavorite: nextFav,
      updatedAt: Date.now(),
    };
  }

  async deleteNoteToTrash(userId: string, noteId: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const allNotes = await this.listNotes(uid);
    const note = allNotes.find((n) => n.id === noteId);
    if (!note) throw new Error('Note not found.');

    const trashId = generateUuid();
    try {
      await setDoc(this.subDoc(uid, 'trash', trashId), {
        id: trashId,
        ownerUid: uid,
        itemType: 'note',
        itemId: note.id,
        title: clampString(note.title, 255),
        size: new Blob([note.content]).size,
        originalParentId: note.folderId,
        payload: { record: note },
        deletedAt: serverTimestamp(),
      });
      await deleteDoc(this.subDoc(uid, 'notes', noteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `vaults/${uid}/trash/${trashId}`);
    }
  }

  // Bookmarks
  async listBookmarks(userId: string): Promise<BookmarkRecord[]> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}/bookmarks`;
    try {
      const q = query(this.subCol(uid, 'bookmarks'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id),
          userId: uid,
          url: String(data.url),
          title: String(data.title),
          description: String(data.description || ''),
          faviconUrl: String(data.faviconUrl || ''),
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
          isFavorite: Boolean(data.isFavorite),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  async createBookmark(
    userId: string,
    input: { url: string; title: string; description: string; faviconUrl: string; tags: string[]; isFavorite?: boolean }
  ): Promise<BookmarkRecord> {
    const uid = requireVerifiedUid(userId);
    const check = isValidHttpUrl(input.url);
    if (!check.valid || !check.normalized) {
      throw new Error(check.error || 'Invalid URL.');
    }

    const id = generateUuid();
    const cleanTags = boundTags(input.tags || []);
    const cleanUrl = clampString(check.normalized, 2048);
    const cleanTitle = clampString(input.title.trim() || check.normalized, 200);
    const cleanDesc = clampString(input.description.trim(), 1000);
    const cleanFavicon = clampString(input.faviconUrl || '', 2048);
    const isFav = Boolean(input.isFavorite);

    const path = `vaults/${uid}/bookmarks/${id}`;
    try {
      await setDoc(this.subDoc(uid, 'bookmarks', id), {
        id,
        ownerUid: uid,
        url: cleanUrl,
        title: cleanTitle,
        description: cleanDesc,
        faviconUrl: cleanFavicon,
        tags: cleanTags,
        isFavorite: isFav,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }

    await this.syncTagsForUser(uid, cleanTags);
    const now = Date.now();
    return {
      id,
      userId: uid,
      url: cleanUrl,
      title: cleanTitle,
      description: cleanDesc,
      faviconUrl: cleanFavicon,
      tags: cleanTags,
      isFavorite: isFav,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateBookmark(
    userId: string,
    bookmarkId: string,
    updates: Partial<Pick<BookmarkRecord, 'url' | 'title' | 'description' | 'tags' | 'isFavorite'>>
  ): Promise<BookmarkRecord> {
    const uid = requireVerifiedUid(userId);
    const allBookmarks = await this.listBookmarks(uid);
    const existing = allBookmarks.find((b) => b.id === bookmarkId);
    if (!existing) throw new Error('Bookmark not found.');

    let nextUrl = existing.url;
    if (updates.url) {
      const check = isValidHttpUrl(updates.url);
      if (!check.valid || !check.normalized) {
        throw new Error(check.error || 'Invalid URL.');
      }
      nextUrl = clampString(check.normalized, 2048);
    }

    const cleanTags = updates.tags ? boundTags(updates.tags) : existing.tags;
    const nextTitle =
      updates.title !== undefined ? clampString(updates.title.trim() || nextUrl, 200) : existing.title;
    const nextDesc =
      updates.description !== undefined ? clampString(updates.description.trim(), 1000) : existing.description;
    const nextFav = updates.isFavorite !== undefined ? updates.isFavorite : existing.isFavorite;

    const path = `vaults/${uid}/bookmarks/${bookmarkId}`;
    try {
      await updateDoc(this.subDoc(uid, 'bookmarks', bookmarkId), {
        url: nextUrl,
        title: nextTitle,
        description: nextDesc,
        tags: cleanTags,
        isFavorite: nextFav,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    if (updates.tags) {
      await this.syncTagsForUser(uid, cleanTags);
    }

    return {
      ...existing,
      url: nextUrl,
      title: nextTitle,
      description: nextDesc,
      tags: cleanTags,
      isFavorite: nextFav,
      updatedAt: Date.now(),
    };
  }

  async deleteBookmarkToTrash(userId: string, bookmarkId: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const allBookmarks = await this.listBookmarks(uid);
    const bookmark = allBookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) throw new Error('Bookmark not found.');

    const trashId = generateUuid();
    try {
      await setDoc(this.subDoc(uid, 'trash', trashId), {
        id: trashId,
        ownerUid: uid,
        itemType: 'bookmark',
        itemId: bookmark.id,
        title: clampString(bookmark.title, 255),
        size: new Blob([bookmark.url + bookmark.description]).size,
        originalParentId: null,
        payload: { record: bookmark },
        deletedAt: serverTimestamp(),
      });
      await deleteDoc(this.subDoc(uid, 'bookmarks', bookmarkId));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `vaults/${uid}/trash/${trashId}`);
    }
  }

  // Tags
  async listTags(userId: string): Promise<TagRecord[]> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}/tags`;
    try {
      const q = query(this.subCol(uid, 'tags'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id),
          userId: uid,
          name: String(data.name),
          createdAt: toMillis(data.createdAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  private async syncTagsForUser(uid: string, tagNames: string[]): Promise<void> {
    const existing = await this.listTags(uid);
    const existingSet = new Set(existing.map((t) => t.name));
    for (const raw of tagNames) {
      const name = clampString(normalizeTagInput(raw), 40);
      if (!name || existingSet.has(name)) continue;
      existingSet.add(name);
      const id = generateUuid();
      try {
        await setDoc(this.subDoc(uid, 'tags', id), {
          id,
          ownerUid: uid,
          name,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `vaults/${uid}/tags/${id}`);
      }
    }
  }

  // Trash
  async listTrash(userId: string): Promise<TrashRecord[]> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}/trash`;
    try {
      const q = query(this.subCol(uid, 'trash'), where('ownerUid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id),
          userId: uid,
          itemType: data.itemType as TrashRecord['itemType'],
          itemId: String(data.itemId),
          title: String(data.title),
          size: Number(data.size || 0),
          originalParentId: typeof data.originalParentId === 'string' ? data.originalParentId : null,
          payload: (data.payload as Record<string, unknown>) || {},
          deletedAt: toMillis(data.deletedAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  async restoreTrashItem(userId: string, trashId: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const allTrash = await this.listTrash(uid);
    const entry = allTrash.find((t) => t.id === trashId);
    if (!entry) throw new Error('Trash item not found.');

    const restoreFileMeta = async (raw: Record<string, unknown>) => {
      const fid = String(raw.id);
      await setDoc(this.subDoc(uid, 'files', fid), {
        id: fid,
        ownerUid: uid,
        name: clampString(String(raw.name || 'file'), 255),
        folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
        mimeType: clampString(String(raw.mimeType || 'application/octet-stream'), 160),
        category: String(raw.category || 'other'),
        extension: clampString(String(raw.extension || ''), 32),
        size: Number(raw.size || 0),
        chunkCount: Number(raw.chunkCount || 0),
        cloudSynced: Boolean(raw.cloudSynced ?? true),
        isEncrypted: Boolean(raw.isEncrypted),
        encryptionMeta: (raw.encryptionMeta as FileEncryptionMeta | null) || null,
        tags: boundTags(Array.isArray(raw.tags) ? raw.tags.map(String) : []),
        isFavorite: Boolean(raw.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    };

    const restoreFolderMeta = async (raw: Record<string, unknown>) => {
      const did = String(raw.id);
      await setDoc(this.subDoc(uid, 'folders', did), {
        id: did,
        ownerUid: uid,
        name: clampString(String(raw.name || 'folder'), 180),
        parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
        tags: boundTags(Array.isArray(raw.tags) ? raw.tags.map(String) : []),
        isFavorite: Boolean(raw.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    };

    const restoreNoteMeta = async (raw: Record<string, unknown>) => {
      const nid = String(raw.id);
      await setDoc(this.subDoc(uid, 'notes', nid), {
        id: nid,
        ownerUid: uid,
        title: clampString(String(raw.title || 'Untitled Note'), 200),
        content: clampString(String(raw.content || ''), 250000),
        folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
        tags: boundTags(Array.isArray(raw.tags) ? raw.tags.map(String) : []),
        isFavorite: Boolean(raw.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    };

    try {
      if (entry.itemType === 'file') {
        const rec = entry.payload.record as Record<string, unknown>;
        await restoreFileMeta(rec);
      } else if (entry.itemType === 'note') {
        const rec = entry.payload.record as Record<string, unknown>;
        await restoreNoteMeta(rec);
      } else if (entry.itemType === 'bookmark') {
        const rec = entry.payload.record as Record<string, unknown>;
        const bid = String(rec.id);
        await setDoc(this.subDoc(uid, 'bookmarks', bid), {
          id: bid,
          ownerUid: uid,
          url: clampString(String(rec.url), 2048),
          title: clampString(String(rec.title || rec.url), 200),
          description: clampString(String(rec.description || ''), 1000),
          faviconUrl: clampString(String(rec.faviconUrl || ''), 2048),
          tags: boundTags(Array.isArray(rec.tags) ? rec.tags.map(String) : []),
          isFavorite: Boolean(rec.isFavorite),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (entry.itemType === 'folder') {
        const foldersToRestore =
          (entry.payload.descendantFolders as Record<string, unknown>[] | undefined) || [];
        const filesToRestore = (entry.payload.files as Record<string, unknown>[] | undefined) || [];
        const notesToRestore = (entry.payload.notes as Record<string, unknown>[] | undefined) || [];

        for (const f of foldersToRestore) {
          await restoreFolderMeta(f);
        }
        for (const f of filesToRestore) {
          await restoreFileMeta(f);
        }
        for (const n of notesToRestore) {
          await restoreNoteMeta(n);
        }
      }

      await deleteDoc(this.subDoc(uid, 'trash', trashId));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `vaults/${uid}/trash/${trashId}`);
    }
  }

  async permanentlyDeleteTrashItem(userId: string, trashId: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const allTrash = await this.listTrash(uid);
    const entry = allTrash.find((t) => t.id === trashId);
    if (entry) {
      if (entry.itemType === 'file') {
        await this.deleteChunksForFile(uid, entry.itemId);
      } else if (entry.itemType === 'folder') {
        const files = (entry.payload.files as { id?: string }[] | undefined) || [];
        for (const f of files) {
          if (f.id) await this.deleteChunksForFile(uid, f.id);
        }
      }
    }

    try {
      await deleteDoc(this.subDoc(uid, 'trash', trashId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `vaults/${uid}/trash/${trashId}`);
    }
  }

  private async deleteChunksForFile(uid: string, fileId: string): Promise<void> {
    try {
      const q = query(
        this.subCol(uid, 'fileChunks'),
        where('ownerUid', '==', uid),
        where('fileId', '==', fileId)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
      this.blobCache.delete(fileId);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `vaults/${uid}/fileChunks`);
    }
  }

  async emptyTrash(userId: string): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const allTrash = await this.listTrash(uid);
    for (const entry of allTrash) {
      await this.permanentlyDeleteTrashItem(uid, entry.id);
    }
  }

  // Analytics, Archive & Preferences
  async getStorageAnalytics(userId: string): Promise<StorageAnalytics> {
    const uid = requireVerifiedUid(userId);
    const [files, folders, notes, bookmarks, trash] = await Promise.all([
      this.listFiles(uid),
      this.listFolders(uid),
      this.listNotes(uid),
      this.listBookmarks(uid),
      this.listTrash(uid),
    ]);

    const categoryTotals: Record<FileRecord['category'], { count: number; bytes: number }> = {
      image: { count: 0, bytes: 0 },
      video: { count: 0, bytes: 0 },
      audio: { count: 0, bytes: 0 },
      document: { count: 0, bytes: 0 },
      archive: { count: 0, bytes: 0 },
      code: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 },
    };

    let filesBytes = 0;
    for (const f of files) {
      filesBytes += f.size;
      categoryTotals[f.category].count += 1;
      categoryTotals[f.category].bytes += f.size;
    }

    const notesBytes = notes.reduce((sum, n) => sum + new Blob([n.title + n.content]).size, 0);
    const bookmarksBytes = bookmarks.reduce(
      (sum, b) => sum + new Blob([b.url + b.title + b.description]).size,
      0
    );
    const trashBytes = trash.reduce((sum, t) => sum + t.size, 0);

    const breakdown: StorageBreakdownItem[] = [
      { category: 'image', label: 'Images', ...categoryTotals.image },
      { category: 'video', label: 'Videos', ...categoryTotals.video },
      { category: 'audio', label: 'Audio', ...categoryTotals.audio },
      { category: 'document', label: 'Documents', ...categoryTotals.document },
      { category: 'archive', label: 'Archives', ...categoryTotals.archive },
      { category: 'code', label: 'Code', ...categoryTotals.code },
      { category: 'other', label: 'Other', ...categoryTotals.other },
      { category: 'notes', label: 'Markdown Notes', count: notes.length, bytes: notesBytes },
      { category: 'bookmarks', label: 'URL Links', count: bookmarks.length, bytes: bookmarksBytes },
      { category: 'trash', label: 'Trash Buffer', count: trash.length, bytes: trashBytes },
    ];

    const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 6);
    const recentFiles = [...files].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);

    return {
      vaultMeasuredBytes: filesBytes + notesBytes + bookmarksBytes + trashBytes,
      filesBytes,
      notesBytes,
      bookmarksBytes,
      trashBytes,
      browserQuotaBytes: null,
      browserUsageBytes: null,
      browserEstimateSupported: false,
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
    const uid = requireVerifiedUid(userId);
    const status = await this.getCloudVaultStatus(uid);
    const [folders, files, notes, bookmarks, tags, trash] = await Promise.all([
      this.listFolders(uid),
      this.listFiles(uid),
      this.listNotes(uid),
      this.listBookmarks(uid),
      this.listTags(uid),
      this.listTrash(uid),
    ]);

    const serializedFiles = [];
    for (const f of files) {
      const blob = await this.resolveFileBlob(uid, f);
      const base64Content = await blobToBase64(blob);
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
      username: status.username || 'cloud_operator',
      folders: folders.map(({ userId: _u, ...rest }) => rest),
      files: serializedFiles,
      notes: notes.map(({ userId: _u, ...rest }) => rest),
      bookmarks: bookmarks.map(({ userId: _u, ...rest }) => rest),
      tags: tags.map(({ userId: _u, ...rest }) => rest),
      trash: trash.map(({ userId: _u, ...rest }) => rest),
    };
  }

  async importArchive(
    userId: string,
    rawArchive: unknown
  ): Promise<{ importedFiles: number; importedFolders: number; importedNotes: number; importedBookmarks: number }> {
    const uid = requireVerifiedUid(userId);
    const validated = validateArchivePayload(rawArchive);
    if (!validated.valid || !validated.archive) {
      throw new Error(validated.error || 'Archive validation failed.');
    }

    const archive = validated.archive;
    const folderIdMap = new Map<string, string>();
    for (const f of archive.folders) {
      folderIdMap.set(f.id, generateUuid());
    }

    let importedFolders = 0;
    let importedFiles = 0;
    let importedNotes = 0;
    let importedBookmarks = 0;

    for (const f of archive.folders) {
      const id = folderIdMap.get(f.id)!;
      const mappedParent = f.parentId ? folderIdMap.get(f.parentId) ?? null : null;
      await setDoc(this.subDoc(uid, 'folders', id), {
        id,
        ownerUid: uid,
        name: clampString(sanitizeFileName(f.name), 180) || 'folder',
        parentId: mappedParent,
        tags: boundTags(f.tags || []),
        isFavorite: Boolean(f.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      importedFolders += 1;
    }

    for (const f of archive.files) {
      const blob = base64ToBlob(f.base64Content, f.mimeType);
      if (blob.size > MAX_CLOUD_FILE_BYTES) continue;
      const mappedFolder = f.folderId ? folderIdMap.get(f.folderId) ?? null : null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BINARY_BYTES) {
        chunks.push(arrayBufferToBase64(bytes.subarray(offset, offset + CHUNK_BINARY_BYTES).slice().buffer));
      }
      const id = generateUuid();
      await setDoc(this.subDoc(uid, 'files', id), {
        id,
        ownerUid: uid,
        name: clampString(sanitizeFileName(f.name), 255) || 'file',
        folderId: mappedFolder,
        mimeType: clampString(f.mimeType || 'application/octet-stream', 160),
        category: f.category,
        extension: clampString(f.extension || '', 32),
        size: bytes.byteLength,
        chunkCount: chunks.length,
        cloudSynced: true,
        isEncrypted: Boolean(f.isEncrypted),
        encryptionMeta: f.encryptionMeta || null,
        tags: boundTags(f.tags || []),
        isFavorite: Boolean(f.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `${id}_${i}`;
        await setDoc(this.subDoc(uid, 'fileChunks', chunkId), {
          id: chunkId,
          ownerUid: uid,
          fileId: id,
          chunkIndex: i,
          dataBase64: chunks[i],
          createdAt: serverTimestamp(),
        });
      }
      this.blobCache.set(id, blob);
      importedFiles += 1;
    }

    for (const n of archive.notes) {
      const id = generateUuid();
      const mappedFolder = n.folderId ? folderIdMap.get(n.folderId) ?? null : null;
      await setDoc(this.subDoc(uid, 'notes', id), {
        id,
        ownerUid: uid,
        title: clampString(n.title || 'Untitled Note', 200),
        content: clampString(n.content || '', 250000),
        folderId: mappedFolder,
        tags: boundTags(n.tags || []),
        isFavorite: Boolean(n.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      importedNotes += 1;
    }

    for (const b of archive.bookmarks) {
      const check = isValidHttpUrl(b.url);
      if (!check.valid || !check.normalized) continue;
      const id = generateUuid();
      await setDoc(this.subDoc(uid, 'bookmarks', id), {
        id,
        ownerUid: uid,
        url: clampString(check.normalized, 2048),
        title: clampString(b.title || check.normalized, 200),
        description: clampString(b.description || '', 1000),
        faviconUrl: clampString(b.faviconUrl || '', 2048),
        tags: boundTags(b.tags || []),
        isFavorite: Boolean(b.isFavorite),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      importedBookmarks += 1;
    }

    return { importedFiles, importedFolders, importedNotes, importedBookmarks };
  }

  async clearCache(): Promise<void> {
    this.blobCache.clear();
  }

  async getPreferences(userId: string): Promise<VaultPreferences> {
    const uid = requireVerifiedUid(userId);
    const path = `vaults/${uid}`;
    try {
      const snap = await getDoc(this.vaultRef(uid));
      if (!snap.exists()) return DEFAULT_PREFERENCES;
      const raw = snap.data().preferences as Partial<VaultPreferences> | undefined;
      return { ...DEFAULT_PREFERENCES, ...(raw || {}) };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async savePreferences(userId: string, prefs: VaultPreferences): Promise<void> {
    const uid = requireVerifiedUid(userId);
    const sanitized: VaultPreferences = {
      accentMode: prefs.accentMode === 'cyan' ? 'cyan' : 'matrix',
      matrixRain: Boolean(prefs.matrixRain),
      scanlines: Boolean(prefs.scanlines),
      reducedMotion: Boolean(prefs.reducedMotion),
      sessionDurationMinutes: Math.min(1440, Math.max(5, Number(prefs.sessionDurationMinutes) || 120)),
      defaultViewMode: prefs.defaultViewMode === 'list' ? 'list' : 'grid',
    };
    const path = `vaults/${uid}`;
    try {
      await updateDoc(this.vaultRef(uid), {
        preferences: sanitized,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}
