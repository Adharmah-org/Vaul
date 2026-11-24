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
import { LoginResult, RegisterResult, StorageProvider, UploadProgressCallbacks } from './StorageProvider';

function notConfigured(provider: string, operation: string): never {
  throw new Error(
    `${provider} is an architectural adapter stub (${operation}). Configure server-side credentials and endpoints before activating.`
  );
}

/**
 * Future Cloudflare R2 Adapter
 * Architecture contract:
 * - File binary Blobs upload directly to Cloudflare R2 via server-signed presigned PUT URLs.
 * - Metadata, folder tree, notes, and bookmarks sync with a backing API (e.g., Cloudflare Workers + D1/Supabase).
 */
export class FutureCloudflareR2StorageProvider implements StorageProvider {
  readonly providerName = 'Cloudflare R2 (Future Adapter)';
  readonly isRemoteBacked = true;

  constructor(private readonly endpointUrl: string) {}

  async hasAnyUser(): Promise<boolean> { return false; }
  async registerUser(): Promise<RegisterResult> { return notConfigured(this.providerName, 'registerUser'); }
  async authenticateUser(): Promise<LoginResult> { return notConfigured(this.providerName, 'authenticateUser'); }
  async verifyRoohKey(): Promise<boolean> { return notConfigured(this.providerName, 'verifyRoohKey'); }
  async getActiveSession(): Promise<{ session: SessionRecord; user: UserRecord } | null> { return null; }
  async logout(): Promise<void> { return notConfigured(this.providerName, 'logout'); }
  async changePassword(): Promise<void> { return notConfigured(this.providerName, 'changePassword'); }
  async deleteAccount(): Promise<void> { return notConfigured(this.providerName, 'deleteAccount'); }
  async seedDemoVault(): Promise<LoginResult> { return notConfigured(this.providerName, 'seedDemoVault'); }
  async listFolders(): Promise<FolderRecord[]> { return notConfigured(this.providerName, 'listFolders'); }
  async createFolder(): Promise<FolderRecord> { return notConfigured(this.providerName, 'createFolder'); }
  async renameFolder(): Promise<FolderRecord> { return notConfigured(this.providerName, 'renameFolder'); }
  async moveFolder(): Promise<void> { return notConfigured(this.providerName, 'moveFolder'); }
  async toggleFolderFavorite(): Promise<FolderRecord> { return notConfigured(this.providerName, 'toggleFolderFavorite'); }
  async deleteFolderToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteFolderToTrash'); }
  async listFiles(): Promise<FileRecord[]> { return notConfigured(this.providerName, 'listFiles'); }
  async uploadFile(_u: string, _f: File, _fid: string | null, _cb?: UploadProgressCallbacks): Promise<FileRecord> {
    return notConfigured(`${this.providerName} (${this.endpointUrl})`, 'uploadFile');
  }
  async renameFile(): Promise<FileRecord> { return notConfigured(this.providerName, 'renameFile'); }
  async moveFile(): Promise<void> { return notConfigured(this.providerName, 'moveFile'); }
  async toggleFileFavorite(): Promise<FileRecord> { return notConfigured(this.providerName, 'toggleFileFavorite'); }
  async updateFileTags(): Promise<FileRecord> { return notConfigured(this.providerName, 'updateFileTags'); }
  async deleteFileToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteFileToTrash'); }
  async listNotes(): Promise<NoteRecord[]> { return notConfigured(this.providerName, 'listNotes'); }
  async createNote(): Promise<NoteRecord> { return notConfigured(this.providerName, 'createNote'); }
  async updateNote(): Promise<NoteRecord> { return notConfigured(this.providerName, 'updateNote'); }
  async deleteNoteToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteNoteToTrash'); }
  async listBookmarks(): Promise<BookmarkRecord[]> { return notConfigured(this.providerName, 'listBookmarks'); }
  async createBookmark(): Promise<BookmarkRecord> { return notConfigured(this.providerName, 'createBookmark'); }
  async updateBookmark(): Promise<BookmarkRecord> { return notConfigured(this.providerName, 'updateBookmark'); }
  async deleteBookmarkToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteBookmarkToTrash'); }
  async listTags(): Promise<TagRecord[]> { return notConfigured(this.providerName, 'listTags'); }
  async listTrash(): Promise<TrashRecord[]> { return notConfigured(this.providerName, 'listTrash'); }
  async restoreTrashItem(): Promise<void> { return notConfigured(this.providerName, 'restoreTrashItem'); }
  async permanentlyDeleteTrashItem(): Promise<void> { return notConfigured(this.providerName, 'permanentlyDeleteTrashItem'); }
  async emptyTrash(): Promise<void> { return notConfigured(this.providerName, 'emptyTrash'); }
  async getStorageAnalytics(): Promise<StorageAnalytics> { return notConfigured(this.providerName, 'getStorageAnalytics'); }
  async exportArchive(): Promise<VaultArchive> { return notConfigured(this.providerName, 'exportArchive'); }
  async importArchive(): Promise<{ importedFiles: number; importedFolders: number; importedNotes: number; importedBookmarks: number }> {
    return notConfigured(this.providerName, 'importArchive');
  }
  async clearCache(): Promise<void> { return notConfigured(this.providerName, 'clearCache'); }
  async getPreferences(): Promise<VaultPreferences> { return notConfigured(this.providerName, 'getPreferences'); }
  async savePreferences(): Promise<void> { return notConfigured(this.providerName, 'savePreferences'); }
}

/**
 * Future Supabase Adapter
 * Architecture contract:
 * - Auth via Supabase Auth (JWT + RLS policies per user_id).
 * - Structured metadata (folders, notes, bookmarks, tags, trash) in Supabase Postgres.
 * - Binary files in Supabase Storage private buckets with signed URLs.
 */
export class FutureSupabaseStorageProvider implements StorageProvider {
  readonly providerName = 'Supabase (Future Adapter)';
  readonly isRemoteBacked = true;

  constructor(private readonly projectUrl: string) {}

  async hasAnyUser(): Promise<boolean> { return false; }
  async registerUser(): Promise<RegisterResult> { return notConfigured(this.providerName, 'registerUser'); }
  async authenticateUser(): Promise<LoginResult> { return notConfigured(this.providerName, 'authenticateUser'); }
  async verifyRoohKey(): Promise<boolean> { return notConfigured(this.providerName, 'verifyRoohKey'); }
  async getActiveSession(): Promise<{ session: SessionRecord; user: UserRecord } | null> { return null; }
  async logout(): Promise<void> { return notConfigured(this.providerName, 'logout'); }
  async changePassword(): Promise<void> { return notConfigured(this.providerName, 'changePassword'); }
  async deleteAccount(): Promise<void> { return notConfigured(this.providerName, 'deleteAccount'); }
  async seedDemoVault(): Promise<LoginResult> { return notConfigured(this.providerName, 'seedDemoVault'); }
  async listFolders(): Promise<FolderRecord[]> { return notConfigured(this.providerName, 'listFolders'); }
  async createFolder(): Promise<FolderRecord> { return notConfigured(this.providerName, 'createFolder'); }
  async renameFolder(): Promise<FolderRecord> { return notConfigured(this.providerName, 'renameFolder'); }
  async moveFolder(): Promise<void> { return notConfigured(this.providerName, 'moveFolder'); }
  async toggleFolderFavorite(): Promise<FolderRecord> { return notConfigured(this.providerName, 'toggleFolderFavorite'); }
  async deleteFolderToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteFolderToTrash'); }
  async listFiles(): Promise<FileRecord[]> { return notConfigured(this.providerName, 'listFiles'); }
  async uploadFile(_u: string, _f: File, _fid: string | null, _cb?: UploadProgressCallbacks): Promise<FileRecord> {
    return notConfigured(`${this.providerName} (${this.projectUrl})`, 'uploadFile');
  }
  async renameFile(): Promise<FileRecord> { return notConfigured(this.providerName, 'renameFile'); }
  async moveFile(): Promise<void> { return notConfigured(this.providerName, 'moveFile'); }
  async toggleFileFavorite(): Promise<FileRecord> { return notConfigured(this.providerName, 'toggleFileFavorite'); }
  async updateFileTags(): Promise<FileRecord> { return notConfigured(this.providerName, 'updateFileTags'); }
  async deleteFileToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteFileToTrash'); }
  async listNotes(): Promise<NoteRecord[]> { return notConfigured(this.providerName, 'listNotes'); }
  async createNote(): Promise<NoteRecord> { return notConfigured(this.providerName, 'createNote'); }
  async updateNote(): Promise<NoteRecord> { return notConfigured(this.providerName, 'updateNote'); }
  async deleteNoteToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteNoteToTrash'); }
  async listBookmarks(): Promise<BookmarkRecord[]> { return notConfigured(this.providerName, 'listBookmarks'); }
  async createBookmark(): Promise<BookmarkRecord> { return notConfigured(this.providerName, 'createBookmark'); }
  async updateBookmark(): Promise<BookmarkRecord> { return notConfigured(this.providerName, 'updateBookmark'); }
  async deleteBookmarkToTrash(): Promise<void> { return notConfigured(this.providerName, 'deleteBookmarkToTrash'); }
  async listTags(): Promise<TagRecord[]> { return notConfigured(this.providerName, 'listTags'); }
  async listTrash(): Promise<TrashRecord[]> { return notConfigured(this.providerName, 'listTrash'); }
  async restoreTrashItem(): Promise<void> { return notConfigured(this.providerName, 'restoreTrashItem'); }
  async permanentlyDeleteTrashItem(): Promise<void> { return notConfigured(this.providerName, 'permanentlyDeleteTrashItem'); }
  async emptyTrash(): Promise<void> { return notConfigured(this.providerName, 'emptyTrash'); }
  async getStorageAnalytics(): Promise<StorageAnalytics> { return notConfigured(this.providerName, 'getStorageAnalytics'); }
  async exportArchive(): Promise<VaultArchive> { return notConfigured(this.providerName, 'exportArchive'); }
  async importArchive(): Promise<{ importedFiles: number; importedFolders: number; importedNotes: number; importedBookmarks: number }> {
    return notConfigured(this.providerName, 'importArchive');
  }
  async clearCache(): Promise<void> { return notConfigured(this.providerName, 'clearCache'); }
  async getPreferences(): Promise<VaultPreferences> { return notConfigured(this.providerName, 'getPreferences'); }
  async savePreferences(): Promise<void> { return notConfigured(this.providerName, 'savePreferences'); }
}
