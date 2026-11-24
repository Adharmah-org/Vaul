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

export interface RegisterResult {
  user: UserRecord;
  roohKey: string;
  session: SessionRecord;
}

export interface LoginResult {
  user: UserRecord;
  session: SessionRecord;
}

export interface UploadProgressCallbacks {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  roohKey?: string;
}

export interface StorageProvider {
  readonly providerName: string;
  readonly isRemoteBacked: boolean;

  // Auth & Session
  hasAnyUser(): Promise<boolean>;
  registerUser(username: string, password: string): Promise<RegisterResult>;
  authenticateUser(username: string, password: string, roohKey: string): Promise<LoginResult>;
  verifyRoohKey(userId: string, roohKey: string): Promise<boolean>;
  getActiveSession(): Promise<{ session: SessionRecord; user: UserRecord } | null>;
  logout(sessionId: string): Promise<void>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
  deleteAccount(userId: string, password: string): Promise<void>;
  seedDemoVault(): Promise<LoginResult>;

  // Folders
  listFolders(userId: string): Promise<FolderRecord[]>;
  createFolder(userId: string, name: string, parentId: string | null): Promise<FolderRecord>;
  renameFolder(userId: string, folderId: string, newName: string): Promise<FolderRecord>;
  moveFolder(userId: string, folderId: string, targetParentId: string | null): Promise<void>;
  toggleFolderFavorite(userId: string, folderId: string): Promise<FolderRecord>;
  deleteFolderToTrash(userId: string, folderId: string): Promise<void>;

  // Files
  listFiles(userId: string): Promise<FileRecord[]>;
  uploadFile(
    userId: string,
    file: File,
    folderId: string | null,
    callbacks?: UploadProgressCallbacks
  ): Promise<FileRecord>;
  renameFile(userId: string, fileId: string, newName: string): Promise<FileRecord>;
  moveFile(userId: string, fileId: string, targetFolderId: string | null): Promise<void>;
  toggleFileFavorite(userId: string, fileId: string): Promise<FileRecord>;
  updateFileTags(userId: string, fileId: string, tags: string[]): Promise<FileRecord>;
  deleteFileToTrash(userId: string, fileId: string): Promise<void>;
  resolveFileBlob?(userId: string, file: FileRecord): Promise<Blob>;

  // Notes
  listNotes(userId: string): Promise<NoteRecord[]>;
  createNote(userId: string, title?: string, content?: string, folderId?: string | null): Promise<NoteRecord>;
  updateNote(
    userId: string,
    noteId: string,
    updates: Partial<Pick<NoteRecord, 'title' | 'content' | 'tags' | 'isFavorite' | 'folderId'>>
  ): Promise<NoteRecord>;
  deleteNoteToTrash(userId: string, noteId: string): Promise<void>;

  // Bookmarks
  listBookmarks(userId: string): Promise<BookmarkRecord[]>;
  createBookmark(
    userId: string,
    input: { url: string; title: string; description: string; faviconUrl: string; tags: string[]; isFavorite?: boolean }
  ): Promise<BookmarkRecord>;
  updateBookmark(
    userId: string,
    bookmarkId: string,
    updates: Partial<Pick<BookmarkRecord, 'url' | 'title' | 'description' | 'tags' | 'isFavorite'>>
  ): Promise<BookmarkRecord>;
  deleteBookmarkToTrash(userId: string, bookmarkId: string): Promise<void>;

  // Tags
  listTags(userId: string): Promise<TagRecord[]>;

  // Trash
  listTrash(userId: string): Promise<TrashRecord[]>;
  restoreTrashItem(userId: string, trashId: string): Promise<void>;
  permanentlyDeleteTrashItem(userId: string, trashId: string): Promise<void>;
  emptyTrash(userId: string): Promise<void>;

  // Analytics, Archive & Preferences
  getStorageAnalytics(userId: string): Promise<StorageAnalytics>;
  exportArchive(userId: string): Promise<VaultArchive>;
  importArchive(userId: string, rawArchive: unknown): Promise<{ importedFiles: number; importedFolders: number; importedNotes: number; importedBookmarks: number }>;
  clearCache(): Promise<void>;
  getPreferences(userId: string): Promise<VaultPreferences>;
  savePreferences(userId: string, prefs: VaultPreferences): Promise<void>;
}
