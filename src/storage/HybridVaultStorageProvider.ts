import { db } from './db';
import { FirestoreStorageProvider, MAX_CLOUD_FILE_BYTES } from './FirestoreStorageProvider';
import { IndexedDBStorageProvider } from './IndexedDBStorageProvider';
import {
  LoginResult,
  RegisterResult,
  StorageProvider,
  UploadProgressCallbacks,
} from './StorageProvider';
import {
  BookmarkRecord,
  FileRecord,
  FolderRecord,
  NoteRecord,
  SessionRecord,
  StorageAnalytics,
  TagRecord,
  TrashRecord,
  UserRecord,
  VaultArchive,
  VaultPreferences,
} from '../types/vault';
import {
  generateSessionToken,
  generateUuid,
  normalizeRoohKey,
} from '../services/crypto';

const ACTIVE_SESSION_ID_KEY = 'rooh_active_session_id';
const PREFS_PREFIX = 'rooh_prefs_';

export class HybridVaultStorageProvider implements StorageProvider {
  readonly providerName = 'Hybrid Local + Cloud Vault';
  readonly isRemoteBacked = true;

  public readonly local: IndexedDBStorageProvider;
  public readonly cloud: FirestoreStorageProvider;

  constructor() {
    this.local = new IndexedDBStorageProvider();
    this.cloud = new FirestoreStorageProvider();
  }

  async hasAnyUser(): Promise<boolean> {
    const hasLocal = await this.local.hasAnyUser();
    if (hasLocal) return true;
    return this.cloud.hasAnyUser();
  }

  async registerUser(username: string): Promise<RegisterResult> {
    // 1. Create locally in IndexedDB
    const localResult = await this.local.registerUser(username);

    // 2. Sync to Cloud Firestore so it is accessible from other browsers immediately
    try {
      await this.cloud.syncUserToCloud(localResult.user);
    } catch (err) {
      console.warn('Cloud sync registration notice:', err);
    }

    return localResult;
  }

  async authenticateUser(username: string, roohKey: string): Promise<LoginResult> {
    const cleanUsername = username.trim();

    // 1. Check local IndexedDB first
    const localUser = await db.users
      .filter((u) => u.username.toLowerCase() === cleanUsername.toLowerCase())
      .first();

    if (localUser) {
      const localResult = await this.local.authenticateUser(username, roohKey);
      // Ensure cloud has the latest user profile and data
      this.cloud.syncUserToCloud(localUser).catch(() => {});
      this.syncLocalToCloud(localUser.id).catch(() => {});
      return localResult;
    }

    // 2. If not found in local IndexedDB (e.g. logging in from ANOTHER browser or device), query Cloud Firestore!
    const cloudResult = await this.cloud.authenticateUser(username, roohKey);

    // 3. User authenticated via Cloud! Cache user and items into this browser's IndexedDB
    await this.pullCloudToLocal(cloudResult.user.id, cloudResult.user);

    return cloudResult;
  }

  /**
   * Pulls all cloud vault folders, notes, bookmarks, tags, and file records into this browser's local IndexedDB.
   */
  async pullCloudToLocal(userId: string, userRecord: UserRecord): Promise<void> {
    try {
      // 1. Add user to local IndexedDB
      const existingUser = await db.users.get(userId);
      if (!existingUser) {
        await db.users.put(userRecord);
      }

      // 2. Create local session
      const now = Date.now();
      const session: SessionRecord = {
        id: generateUuid(),
        userId: userRecord.id,
        username: userRecord.username,
        token: generateSessionToken(),
        createdAt: now,
        expiresAt: now + 120 * 60 * 1000,
      };
      await db.sessions.put(session);
      sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, session.id);

      // 3. Pull cloud items into IndexedDB
      const [cloudFolders, cloudFiles, cloudNotes, cloudBookmarks, cloudTags, cloudPrefs] =
        await Promise.all([
          this.cloud.listFolders(userId).catch(() => []),
          this.cloud.listFiles(userId).catch(() => []),
          this.cloud.listNotes(userId).catch(() => []),
          this.cloud.listBookmarks(userId).catch(() => []),
          this.cloud.listTags(userId).catch(() => []),
          this.cloud.getPreferences(userId).catch(() => null),
        ]);

      if (cloudFolders.length > 0) {
        await db.folders.bulkPut(cloudFolders);
      }
      if (cloudNotes.length > 0) {
        await db.notes.bulkPut(cloudNotes);
      }
      if (cloudBookmarks.length > 0) {
        await db.bookmarks.bulkPut(cloudBookmarks);
      }
      if (cloudTags.length > 0) {
        await db.tags.bulkPut(cloudTags);
      }
      if (cloudFiles.length > 0) {
        await db.files.bulkPut(cloudFiles);
      }
      if (cloudPrefs) {
        localStorage.setItem(`${PREFS_PREFIX}${userId}`, JSON.stringify(cloudPrefs));
      }
    } catch (err) {
      console.warn('Error pulling cloud vault to local cache:', err);
    }
  }

  /**
   * Syncs local IndexedDB data to Cloud Firestore so other browsers can access it.
   */
  async syncLocalToCloud(userId: string): Promise<void> {
    try {
      const user = await db.users.get(userId);
      if (user) {
        await this.cloud.syncUserToCloud(user);
      }

      const [folders, notes, bookmarks, prefs] = await Promise.all([
        db.folders.where('userId').equals(userId).toArray(),
        db.notes.where('userId').equals(userId).toArray(),
        db.bookmarks.where('userId').equals(userId).toArray(),
        this.local.getPreferences(userId),
      ]);

      // Save preferences to cloud
      await this.cloud.savePreferences(userId, prefs).catch(() => {});

      // Sync folders
      for (const f of folders) {
        await this.cloud.createFolder(userId, f.name, f.parentId).catch(() => {});
      }

      // Sync notes
      for (const n of notes) {
        await this.cloud.createNote(userId, n.title, n.content, n.folderId).catch(() => {});
      }

      // Sync bookmarks
      for (const b of bookmarks) {
        await this.cloud
          .createBookmark(userId, {
            url: b.url,
            title: b.title,
            description: b.description,
            faviconUrl: b.faviconUrl,
            tags: b.tags,
            isFavorite: b.isFavorite,
          })
          .catch(() => {});
      }
    } catch (err) {
      console.warn('Background sync to cloud notice:', err);
    }
  }

  async verifyRoohKey(userId: string, roohKey: string): Promise<boolean> {
    const localOk = await this.local.verifyRoohKey(userId, roohKey);
    if (localOk) return true;
    return this.cloud.verifyRoohKey(userId, roohKey);
  }

  async getActiveSession(): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    const localSession = await this.local.getActiveSession();
    if (localSession) return localSession;
    return this.cloud.getActiveSession();
  }

  async logout(sessionId: string): Promise<void> {
    await Promise.all([
      this.local.logout(sessionId).catch(() => {}),
      this.cloud.logout(sessionId).catch(() => {}),
    ]);
  }

  async rotateRoohKey(userId: string, currentRoohKey: string): Promise<string> {
    const newKey = await this.local.rotateRoohKey(userId, currentRoohKey);
    try {
      await this.cloud.rotateRoohKey(userId, currentRoohKey);
    } catch (err) {
      console.warn('Cloud key rotation notice:', err);
    }
    return newKey;
  }

  async deleteAccount(userId: string, roohKey: string): Promise<void> {
    await Promise.all([
      this.local.deleteAccount(userId, roohKey).catch(() => {}),
      this.cloud.deleteAccount(userId, roohKey).catch(() => {}),
    ]);
  }

  async seedDemoVault(): Promise<LoginResult> {
    return this.local.seedDemoVault();
  }

  // Folders
  async listFolders(userId: string): Promise<FolderRecord[]> {
    return this.local.listFolders(userId);
  }

  async createFolder(userId: string, name: string, parentId: string | null): Promise<FolderRecord> {
    const folder = await this.local.createFolder(userId, name, parentId);
    this.cloud.createFolder(userId, name, parentId).catch(() => {});
    return folder;
  }

  async renameFolder(userId: string, folderId: string, newName: string): Promise<FolderRecord> {
    const folder = await this.local.renameFolder(userId, folderId, newName);
    this.cloud.renameFolder(userId, folderId, newName).catch(() => {});
    return folder;
  }

  async moveFolder(userId: string, folderId: string, targetParentId: string | null): Promise<void> {
    await this.local.moveFolder(userId, folderId, targetParentId);
    this.cloud.moveFolder(userId, folderId, targetParentId).catch(() => {});
  }

  async toggleFolderFavorite(userId: string, folderId: string): Promise<FolderRecord> {
    const folder = await this.local.toggleFolderFavorite(userId, folderId);
    this.cloud.toggleFolderFavorite(userId, folderId).catch(() => {});
    return folder;
  }

  async deleteFolderToTrash(userId: string, folderId: string): Promise<void> {
    await this.local.deleteFolderToTrash(userId, folderId);
    this.cloud.deleteFolderToTrash(userId, folderId).catch(() => {});
  }

  // Files
  async listFiles(userId: string): Promise<FileRecord[]> {
    return this.local.listFiles(userId);
  }

  async uploadFile(
    userId: string,
    file: File,
    folderId: string | null,
    callbacks?: UploadProgressCallbacks
  ): Promise<FileRecord> {
    const localFile = await this.local.uploadFile(userId, file, folderId, callbacks);
    if (file.size <= MAX_CLOUD_FILE_BYTES) {
      this.cloud.uploadFile(userId, file, folderId, callbacks).catch((err) => {
        console.warn('Cloud file upload notice:', err);
      });
    }
    return localFile;
  }

  async renameFile(userId: string, fileId: string, newName: string): Promise<FileRecord> {
    const rec = await this.local.renameFile(userId, fileId, newName);
    this.cloud.renameFile(userId, fileId, newName).catch(() => {});
    return rec;
  }

  async moveFile(userId: string, fileId: string, targetFolderId: string | null): Promise<void> {
    await this.local.moveFile(userId, fileId, targetFolderId);
    this.cloud.moveFile(userId, fileId, targetFolderId).catch(() => {});
  }

  async toggleFileFavorite(userId: string, fileId: string): Promise<FileRecord> {
    const rec = await this.local.toggleFileFavorite(userId, fileId);
    this.cloud.toggleFileFavorite(userId, fileId).catch(() => {});
    return rec;
  }

  async updateFileTags(userId: string, fileId: string, tags: string[]): Promise<FileRecord> {
    const rec = await this.local.updateFileTags(userId, fileId, tags);
    this.cloud.updateFileTags(userId, fileId, tags).catch(() => {});
    return rec;
  }

  async deleteFileToTrash(userId: string, fileId: string): Promise<void> {
    await this.local.deleteFileToTrash(userId, fileId);
    this.cloud.deleteFileToTrash(userId, fileId).catch(() => {});
  }

  // Notes
  async listNotes(userId: string): Promise<NoteRecord[]> {
    return this.local.listNotes(userId);
  }

  async createNote(
    userId: string,
    title?: string,
    content?: string,
    folderId?: string | null
  ): Promise<NoteRecord> {
    const note = await this.local.createNote(userId, title, content, folderId);
    this.cloud.createNote(userId, title, content, folderId).catch(() => {});
    return note;
  }

  async updateNote(
    userId: string,
    noteId: string,
    updates: Partial<Pick<NoteRecord, 'title' | 'content' | 'tags' | 'isFavorite' | 'folderId'>>
  ): Promise<NoteRecord> {
    const note = await this.local.updateNote(userId, noteId, updates);
    this.cloud.updateNote(userId, noteId, updates).catch(() => {});
    return note;
  }

  async deleteNoteToTrash(userId: string, noteId: string): Promise<void> {
    await this.local.deleteNoteToTrash(userId, noteId);
    this.cloud.deleteNoteToTrash(userId, noteId).catch(() => {});
  }

  // Bookmarks
  async listBookmarks(userId: string): Promise<BookmarkRecord[]> {
    return this.local.listBookmarks(userId);
  }

  async createBookmark(
    userId: string,
    input: {
      url: string;
      title: string;
      description: string;
      faviconUrl: string;
      tags: string[];
      isFavorite?: boolean;
    }
  ): Promise<BookmarkRecord> {
    const bm = await this.local.createBookmark(userId, input);
    this.cloud.createBookmark(userId, input).catch(() => {});
    return bm;
  }

  async updateBookmark(
    userId: string,
    bookmarkId: string,
    updates: Partial<Pick<BookmarkRecord, 'url' | 'title' | 'description' | 'tags' | 'isFavorite'>>
  ): Promise<BookmarkRecord> {
    const bm = await this.local.updateBookmark(userId, bookmarkId, updates);
    this.cloud.updateBookmark(userId, bookmarkId, updates).catch(() => {});
    return bm;
  }

  async deleteBookmarkToTrash(userId: string, bookmarkId: string): Promise<void> {
    await this.local.deleteBookmarkToTrash(userId, bookmarkId);
    this.cloud.deleteBookmarkToTrash(userId, bookmarkId).catch(() => {});
  }

  // Tags
  async listTags(userId: string): Promise<TagRecord[]> {
    return this.local.listTags(userId);
  }

  // Trash
  async listTrash(userId: string): Promise<TrashRecord[]> {
    return this.local.listTrash(userId);
  }

  async restoreTrashItem(userId: string, trashId: string): Promise<void> {
    await this.local.restoreTrashItem(userId, trashId);
    this.cloud.restoreTrashItem(userId, trashId).catch(() => {});
  }

  async permanentlyDeleteTrashItem(userId: string, trashId: string): Promise<void> {
    await this.local.permanentlyDeleteTrashItem(userId, trashId);
    this.cloud.permanentlyDeleteTrashItem(userId, trashId).catch(() => {});
  }

  async emptyTrash(userId: string): Promise<void> {
    await this.local.emptyTrash(userId);
    this.cloud.emptyTrash(userId).catch(() => {});
  }

  // Analytics & Preferences
  async getStorageAnalytics(userId: string): Promise<StorageAnalytics> {
    return this.local.getStorageAnalytics(userId);
  }

  async getPreferences(userId: string): Promise<VaultPreferences> {
    return this.local.getPreferences(userId);
  }

  async savePreferences(userId: string, prefs: VaultPreferences): Promise<void> {
    await this.local.savePreferences(userId, prefs);
    this.cloud.savePreferences(userId, prefs).catch(() => {});
  }

  // Export / Import
  async exportArchive(userId: string): Promise<VaultArchive> {
    return this.local.exportArchive(userId);
  }

  async importArchive(
    userId: string,
    rawArchive: unknown
  ): Promise<{
    importedFiles: number;
    importedFolders: number;
    importedNotes: number;
    importedBookmarks: number;
  }> {
    const result = await this.local.importArchive(userId, rawArchive);
    this.syncLocalToCloud(userId).catch(() => {});
    return result;
  }

  async clearCache(): Promise<void> {
    await Promise.all([
      this.local.clearCache().catch(() => {}),
      this.cloud.clearCache().catch(() => {}),
    ]);
  }
}
