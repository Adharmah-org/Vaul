export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'code'
  | 'other';

export type DockSection =
  | 'all'
  | 'images'
  | 'videos'
  | 'documents'
  | 'links'
  | 'browser'
  | 'notes'
  | 'favorites'
  | 'trash'
  | 'analytics'
  | 'settings';

export type SortField = 'name' | 'createdAt' | 'updatedAt' | 'size' | 'type';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'grid' | 'list';

export interface UserRecord {
  id: string;
  username: string;
  roohKeyHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  username: string;
  token: string;
  createdAt: number;
  expiresAt: number;
}

export interface FolderRecord {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  tags: string[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FileEncryptionMeta {
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  ivBase64: string;
  originalMimeType: string;
  originalSize: number;
  encryptedAt: number;
}

export interface RoohCapsuleV1 {
  format: 'rooh.clouds/encrypted-capsule-v1';
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  ivBase64: string;
  fileName: string;
  mimeType: string;
  originalSize: number;
  encryptedAt: number;
  ciphertextBase64: string;
}

export interface FileRecord {
  id: string;
  userId: string;
  name: string;
  folderId: string | null;
  mimeType: string;
  category: FileCategory;
  extension: string;
  size: number;
  content: Blob;
  isEncrypted?: boolean;
  encryptionMeta?: FileEncryptionMeta;
  cloudSynced?: boolean;
  chunkCount?: number;
  driveFileId?: string;
  tags: string[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteRecord {
  id: string;
  userId: string;
  title: string;
  content: string;
  folderId: string | null;
  tags: string[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkRecord {
  id: string;
  userId: string;
  url: string;
  title: string;
  description: string;
  faviconUrl: string;
  tags: string[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TagRecord {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
}

export type TrashItemType = 'file' | 'folder' | 'note' | 'bookmark';

export interface TrashRecord {
  id: string;
  userId: string;
  itemType: TrashItemType;
  itemId: string;
  title: string;
  size: number;
  originalParentId: string | null;
  payload: Record<string, unknown>;
  deletedAt: number;
}

export interface VaultPreferences {
  accentMode: 'matrix' | 'cyan';
  matrixRain: boolean;
  scanlines: boolean;
  reducedMotion: boolean;
  sessionDurationMinutes: number;
  defaultViewMode: ViewMode;
}

export interface StorageBreakdownItem {
  category: FileCategory | 'notes' | 'bookmarks' | 'trash';
  label: string;
  count: number;
  bytes: number;
}

export interface StorageAnalytics {
  vaultMeasuredBytes: number;
  filesBytes: number;
  notesBytes: number;
  bookmarksBytes: number;
  trashBytes: number;
  browserQuotaBytes: number | null;
  browserUsageBytes: number | null;
  browserEstimateSupported: boolean;
  totalFiles: number;
  totalFolders: number;
  totalNotes: number;
  totalBookmarks: number;
  totalTrashItems: number;
  breakdown: StorageBreakdownItem[];
  largestFiles: FileRecord[];
  recentFiles: FileRecord[];
}

export interface SerializedFileExport {
  id: string;
  name: string;
  folderId: string | null;
  mimeType: string;
  category: FileCategory;
  extension: string;
  size: number;
  base64Content: string;
  driveFileId?: string;
  isEncrypted?: boolean;
  encryptionMeta?: FileEncryptionMeta;
  tags: string[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface VaultArchive {
  schemaVersion: 1;
  app: 'rooh.clouds';
  exportedAt: number;
  vaultId?: string;
  username: string;
  folders: Omit<FolderRecord, 'userId'>[];
  files: SerializedFileExport[];
  notes: Omit<NoteRecord, 'userId'>[];
  bookmarks: Omit<BookmarkRecord, 'userId'>[];
  tags: Omit<TagRecord, 'userId'>[];
  trash: Omit<TrashRecord, 'userId'>[];
}

export interface UploadTask {
  id: string;
  fileName: string;
  size: number;
  progress: number;
  isEncrypted?: boolean;
  status: 'queued' | 'uploading' | 'completed' | 'cancelled' | 'error';
  error?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
}
