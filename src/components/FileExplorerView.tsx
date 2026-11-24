import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CheckSquare,
  ChevronRight,
  Code2,
  Download,
  Edit3,
  File as FileIcon,
  FileText,
  Film,
  Folder,
  FolderInput,
  FolderPlus,
  Grid,
  Home,
  Image as ImageIcon,
  Leaf,
  List,
  Lock,
  Music,
  Square,
  Star,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import {
  formatBytes,
  formatTimestamp,
  sortItems,
} from '../services/fileUtils';
import {
  DockSection,
  FileCategory,
  FileRecord,
  FolderRecord,
  SortDirection,
  SortField,
  ViewMode,
} from '../types/vault';
import { EncryptedDownloadModal } from './EncryptedDownloadModal';
import { FilePreviewModal } from './FilePreviewModal';
import { MoveFolderModal, TagEditorModal, TextPromptModal } from './Modals';
import { ZipExtractorModal } from './ZipExtractorModal';

interface FileExplorerViewProps {
  section: DockSection;
  searchQuery: string;
  currentFolderId: string | null;
  onNavigateFolder: (folderId: string | null) => void;
  onTriggerUpload: () => void;
  onTriggerNewFolder: () => void;
}

function getCategoryIcon(category: FileCategory) {
  switch (category) {
    case 'image':
      return ImageIcon;
    case 'video':
      return Film;
    case 'audio':
      return Music;
    case 'document':
      return FileText;
    case 'archive':
      return Archive;
    case 'code':
      return Code2;
    default:
      return FileIcon;
  }
}

export const FileExplorerView: React.FC<FileExplorerViewProps> = ({
  section,
  searchQuery,
  currentFolderId,
  onNavigateFolder,
  onTriggerUpload,
  onTriggerNewFolder,
}) => {
  const {
    user,
    storage,
    files,
    folders,
    tags,
    preferences,
    isLoadingData,
    refreshVaultData,
    uploadFiles,
    encryptedUploadMode,
    setEncryptedUploadMode,
    addToast,
  } = useVault();

  const [viewMode, setViewMode] = useState<ViewMode>(preferences.defaultViewMode);
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [categoryFilter, setCategoryFilter] = useState<FileCategory | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Modal states
  const [renameTarget, setRenameTarget] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ type: 'file' | 'folder' | 'bulk'; id?: string; currentParentId: string | null } | null>(null);
  const [tagTarget, setTagTarget] = useState<FileRecord | null>(null);
  const [encryptedDownloadTarget, setEncryptedDownloadTarget] = useState<FileRecord | null>(null);
  const [zipModalOpen, setZipModalOpen] = useState(false);
  const [zipSource, setZipSource] = useState<{ blob: Blob; name: string } | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  // Thumbnail object URLs for plaintext image files
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const thumbUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const nextUrls: Record<string, string> = {};
    for (const f of files) {
      if (!f.isEncrypted && f.category === 'image' && f.size < 15 * 1024 * 1024) {
        nextUrls[f.id] = URL.createObjectURL(f.content);
      }
    }
    Object.values(thumbUrlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    thumbUrlsRef.current = nextUrls;
    setThumbUrls(nextUrls);

    return () => {
      Object.values(nextUrls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  // Clear selections on section/folder change
  useEffect(() => {
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
  }, [section, currentFolderId]);

  // Build folder breadcrumbs
  const breadcrumbs = useMemo(() => {
    const chain: FolderRecord[] = [];
    let cursor = currentFolderId;
    const byId = new Map(folders.map((f) => [f.id, f]));
    let guard = 0;
    while (cursor && guard < 32) {
      const f = byId.get(cursor);
      if (!f) break;
      chain.unshift(f);
      cursor = f.parentId;
      guard++;
    }
    return chain;
  }, [folders, currentFolderId]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isGlobalSearch = normalizedQuery.length > 0;

  const filteredFolders = useMemo(() => {
    if (section === 'images' || section === 'videos' || section === 'documents') {
      if (!isGlobalSearch) return [];
    }
    const list = folders.filter((f) => {
      if (section === 'favorites' && !f.isFavorite) return false;
      if (favoritesOnly && !f.isFavorite) return false;
      if (!isGlobalSearch && section === 'all' && f.parentId !== currentFolderId) return false;
      if (normalizedQuery) {
        const match =
          f.name.toLowerCase().includes(normalizedQuery) ||
          f.tags.some((t) => t.includes(normalizedQuery));
        if (!match) return false;
      }
      if (tagFilter !== 'all' && !f.tags.includes(tagFilter)) return false;
      return true;
    });
    return sortItems(list, sortField === 'size' || sortField === 'type' ? 'name' : sortField, sortDir);
  }, [folders, section, currentFolderId, isGlobalSearch, normalizedQuery, favoritesOnly, tagFilter, sortField, sortDir]);

  const filteredFiles = useMemo(() => {
    const now = Date.now();
    const list = files.filter((f) => {
      if (section === 'images' && f.category !== 'image') return false;
      if (section === 'videos' && f.category !== 'video') return false;
      if (section === 'documents' && f.category !== 'document' && f.category !== 'code') return false;
      if (section === 'favorites' && !f.isFavorite) return false;
      if (favoritesOnly && !f.isFavorite) return false;

      if (!isGlobalSearch && section === 'all' && f.folderId !== currentFolderId) return false;

      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (tagFilter !== 'all' && !f.tags.includes(tagFilter)) return false;

      if (dateFilter !== 'all') {
        const windowMs =
          dateFilter === '24h'
            ? 86_400_000
            : dateFilter === '7d'
            ? 7 * 86_400_000
            : 30 * 86_400_000;
        if (now - f.updatedAt > windowMs) return false;
      }

      if (normalizedQuery) {
        const match =
          f.name.toLowerCase().includes(normalizedQuery) ||
          f.tags.some((t) => t.toLowerCase().includes(normalizedQuery)) ||
          f.category.toLowerCase().includes(normalizedQuery);
        if (!match) return false;
      }

      return true;
    });

    return sortItems(list, sortField, sortDir);
  }, [
    files,
    section,
    currentFolderId,
    isGlobalSearch,
    normalizedQuery,
    favoritesOnly,
    categoryFilter,
    tagFilter,
    dateFilter,
    sortField,
    sortDir,
  ]);

  const sectionHeading =
    section === 'images'
      ? 'Images'
      : section === 'videos'
      ? 'Videos'
      : section === 'documents'
      ? 'Documents'
      : section === 'favorites'
      ? 'Favorites'
      : 'All Files';

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await uploadFiles(e.dataTransfer.files, currentFolderId);
    }
  };

  const toggleFileSelect = (id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolderSelect = (id: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalSelected = selectedFileIds.size + selectedFolderIds.size;

  const handleBulkDelete = async () => {
    if (!user) return;
    for (const id of selectedFileIds) {
      await storage.deleteFileToTrash(user.id, id);
    }
    for (const id of selectedFolderIds) {
      await storage.deleteFolderToTrash(user.id, id);
    }
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
    await refreshVaultData();
    addToast({ type: 'info', title: 'Moved selected items to Trash' });
  };

  const handleBulkFavorite = async () => {
    if (!user) return;
    for (const id of selectedFileIds) {
      await storage.toggleFileFavorite(user.id, id);
    }
    for (const id of selectedFolderIds) {
      await storage.toggleFolderFavorite(user.id, id);
    }
    await refreshVaultData();
    addToast({ type: 'success', title: 'Updated favorite status' });
  };

  const handleDownloadFile = (file: FileRecord) => {
    if (file.isEncrypted) {
      setEncryptedDownloadTarget(file);
      return;
    }
    const url = URL.createObjectURL(file.content);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenStoredZip = (file: FileRecord) => {
    if (file.isEncrypted) {
      setPreviewFile(file);
      addToast({
        type: 'info',
        title: 'Decrypt ZIP with Rooh Key first',
        description: 'Unlock this encrypted archive in preview to extract its contents.',
      });
      return;
    }
    setZipSource({ blob: file.content, name: file.name });
    setZipModalOpen(true);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDraggingOver(false);
        }
      }}
      onDrop={handleDrop}
      className="relative min-h-[calc(100vh-8rem)] space-y-5"
    >
      {/* Hidden ZIP Archive Picker */}
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        aria-label="Choose ZIP archive to extract"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setZipSource({ blob: file, name: file.name });
            setZipModalOpen(true);
          }
          e.target.value = '';
        }}
        className="hidden"
      />
      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-40 bg-[#030505]/85 backdrop-blur-sm border-2 border-dashed border-[#39FF88] m-3 rounded-2xl flex flex-col items-center justify-center pointer-events-none">
          {encryptedUploadMode ? (
            <Leaf className="w-10 h-10 text-[#39FF88] mb-3" />
          ) : (
            <Upload className="w-10 h-10 text-[#39FF88] mb-3" />
          )}
          <p className="text-sm font-semibold text-[#E6F1EE]">
            {encryptedUploadMode ? 'Drop files to encrypt & store in vault' : 'Drop files to store in vault'}
          </p>
          <p className="text-xs text-[#8A9D98] mt-1 font-sans-ui">
            {encryptedUploadMode
              ? 'Client-side AES-256-GCM encryption · Rooh Key required after download'
              : 'Persisted as binary Blobs in IndexedDB'}
          </p>
        </div>
      )}

      {/* Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">{sectionHeading}</h1>
          {section === 'all' && !isGlobalSearch && (
            <nav aria-label="Folder breadcrumbs" className="flex items-center flex-wrap gap-1 mt-1 text-xs text-[#8A9D98]">
              <button
                type="button"
                onClick={() => onNavigateFolder(null)}
                className={`inline-flex items-center gap-1 hover:text-[#39FF88] transition-colors ${
                  currentFolderId === null ? 'text-[#39FF88] font-medium' : ''
                }`}
              >
                <Home className="w-3.5 h-3.5" />
                <span>Root</span>
              </button>
              {breadcrumbs.map((crumb) => (
                <React.Fragment key={crumb.id}>
                  <ChevronRight className="w-3.5 h-3.5 text-[#4F615C]" />
                  <button
                    type="button"
                    onClick={() => onNavigateFolder(crumb.id)}
                    className={`hover:text-[#39FF88] transition-colors truncate max-w-[160px] ${
                      crumb.id === currentFolderId ? 'text-[#39FF88] font-medium' : ''
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}
          {isGlobalSearch && (
            <p className="text-xs text-[#00E5FF] mt-1">
              Filtering vault for &ldquo;{searchQuery}&rdquo; · {filteredFolders.length + filteredFiles.length} matches
            </p>
          )}
        </div>

        {/* View / Sort / Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by file type"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as FileCategory | 'all')}
            className="bg-[#090D0D] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-[#E6F1EE] focus:border-[#39FF88] focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="document">Documents</option>
            <option value="code">Code</option>
            <option value="archive">Archives</option>
            <option value="other">Other</option>
          </select>

          <select
            aria-label="Filter by date modified"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as 'all' | '24h' | '7d' | '30d')}
            className="bg-[#090D0D] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-[#E6F1EE] focus:border-[#39FF88] focus:outline-none"
          >
            <option value="all">Any Time</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>

          {tags.length > 0 && (
            <select
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="bg-[#090D0D] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-[#E6F1EE] focus:border-[#39FF88] focus:outline-none"
            >
              <option value="all">All Tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.name}>
                  #{t.name}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Sort items"
            value={`${sortField}:${sortDir}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split(':') as [SortField, SortDirection];
              setSortField(field);
              setSortDir(dir);
            }}
            className="bg-[#090D0D] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-[#E6F1EE] focus:border-[#39FF88] focus:outline-none"
          >
            <option value="updatedAt:desc">Modified (Newest)</option>
            <option value="updatedAt:asc">Modified (Oldest)</option>
            <option value="createdAt:desc">Created (Newest)</option>
            <option value="name:asc">Name (A-Z)</option>
            <option value="name:desc">Name (Z-A)</option>
            <option value="size:desc">Size (Largest)</option>
            <option value="type:asc">Type</option>
          </select>

          <button
            type="button"
            onClick={() => setFavoritesOnly((f) => !f)}
            aria-pressed={favoritesOnly}
            aria-label="Filter favorites only"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
              favoritesOnly
                ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                : 'border-white/15 bg-[#090D0D] text-[#8A9D98] hover:text-[#E6F1EE]'
            }`}
          >
            <Star className="w-3.5 h-3.5" fill={favoritesOnly ? 'currentColor' : 'none'} />
            <span className="hidden md:inline">Favorites</span>
          </button>

          <button
            type="button"
            onClick={() => zipInputRef.current?.click()}
            aria-label="Extract ZIP archive"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-white/15 bg-[#090D0D] text-[#00E5FF] hover:border-[#00E5FF]/50 transition-colors whitespace-nowrap"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Extract ZIP</span>
          </button>

          <div className="flex items-center bg-[#090D0D] border border-white/15 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              className={`p-1.5 rounded ${
                viewMode === 'grid' ? 'bg-[#39FF88]/15 text-[#39FF88]' : 'text-[#8A9D98] hover:text-[#E6F1EE]'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              className={`p-1.5 rounded ${
                viewMode === 'list' ? 'bg-[#39FF88]/15 text-[#39FF88]' : 'text-[#8A9D98] hover:text-[#E6F1EE]'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Active Encrypted Upload Mode Banner */}
      {encryptedUploadMode && (
        <div className="bg-[#090D0D] border border-[#39FF88]/35 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <Leaf className="w-4 h-4 text-[#39FF88] shrink-0 mt-0.5 sm:mt-0" />
            <div className="text-xs text-[#E6F1EE] leading-relaxed">
              Encrypted Mode Active <span className="text-[#8A9D98]">· Direct uploads sealed with AES-256-GCM · Rooh Key required after download</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onTriggerUpload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Encrypted</span>
            </button>
            <button
              type="button"
              onClick={() => setEncryptedUploadMode(false)}
              className="px-2.5 py-1.5 text-xs text-[#8A9D98] hover:text-[#E6F1EE] border border-white/10 rounded-lg whitespace-nowrap"
            >
              Disable
            </button>
          </div>
        </div>
      )}

      {/* Bulk Action Bar */}
      {totalSelected > 0 && (
        <div className="bg-[#090D0D] border border-[#39FF88]/35 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#39FF88] font-medium tabular-nums">
            {totalSelected} {totalSelected === 1 ? 'item' : 'items'} selected
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleBulkFavorite}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/15 text-[#E6F1EE] hover:border-amber-400/50"
            >
              <Star className="w-3.5 h-3.5" />
              Toggle Favorite
            </button>
            <button
              type="button"
              onClick={() => setMoveTarget({ type: 'bulk', currentParentId: currentFolderId })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/15 text-[#E6F1EE] hover:border-[#00E5FF]/50"
            >
              <FolderInput className="w-3.5 h-3.5" />
              Move
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-red-500/35 text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Move to Trash
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedFileIds(new Set());
                setSelectedFolderIds(new Set());
              }}
              className="px-2.5 py-1.5 text-xs text-[#8A9D98] hover:text-[#E6F1EE]"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Loading Skeletons */}
      {isLoadingData ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-36 rounded-xl bg-[#090D0D] border border-white/10 animate-pulse p-4 flex flex-col justify-between"
            >
              <div className="w-9 h-9 rounded-lg bg-white/5" />
              <div className="space-y-2">
                <div className="h-3.5 w-3/4 bg-white/10 rounded" />
                <div className="h-2.5 w-1/2 bg-white/5 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredFolders.length === 0 && filteredFiles.length === 0 ? (
        /* Custom Empty State */
        <div className="bg-[#090D0D]/80 border border-dashed border-white/15 rounded-xl p-10 text-center max-w-xl mx-auto my-8">
          <div className="w-12 h-12 mx-auto rounded-xl bg-[#39FF88]/10 border border-[#39FF88]/25 flex items-center justify-center text-[#39FF88] mb-4">
            <Upload className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-[#E6F1EE]">
            {isGlobalSearch ? 'No matching vault entries' : `No items in ${sectionHeading}`}
          </h2>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-1.5 leading-relaxed">
            {isGlobalSearch
              ? 'Try clearing filters or searching another filename, tag, or folder.'
              : 'Drag and drop files anywhere here, upload from your device, or create a folder to organize your archive.'}
          </p>
          {!isGlobalSearch && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onTriggerUpload}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99]"
              >
                {encryptedUploadMode ? <Leaf className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                {encryptedUploadMode ? 'Upload Encrypted' : 'Upload Files'}
              </button>
              <button
                type="button"
                onClick={() => zipInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-[#00E5FF]/40 text-[#00E5FF] rounded-lg hover:bg-[#00E5FF]/10"
              >
                <Archive className="w-3.5 h-3.5" />
                Extract ZIP
              </button>
              {section === 'all' && (
                <button
                  type="button"
                  onClick={onTriggerNewFolder}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-white/15 text-[#E6F1EE] rounded-lg hover:border-[#00E5FF]/50"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  New Folder
                </button>
              )}
            </div>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="space-y-6">
          {/* Folders Grid */}
          {filteredFolders.length > 0 && (
            <section aria-label="Folders">
              <h2 className="text-xs font-medium text-[#8A9D98] mb-3">
                Folders ({filteredFolders.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {filteredFolders.map((folder) => {
                  const selected = selectedFolderIds.has(folder.id);
                  return (
                    <div
                      key={folder.id}
                      className={`group bg-[#090D0D] border rounded-xl p-4 transition-colors ${
                        selected
                          ? 'border-[#39FF88]/60 bg-[#39FF88]/5'
                          : 'border-white/10 hover:border-[#39FF88]/35'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => onNavigateFolder(folder.id)}
                          className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                        >
                          <div className="w-9 h-9 rounded-lg bg-[#00E5FF]/10 border border-[#00E5FF]/25 flex items-center justify-center text-[#00E5FF] shrink-0">
                            <Folder className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#E6F1EE] truncate">
                              {folder.name}
                            </div>
                            <div className="text-[11px] text-[#6E827D]">
                              {formatTimestamp(folder.updatedAt)}
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleFolderSelect(folder.id)}
                          aria-label={`Select folder ${folder.name}`}
                          className="p-1 text-[#6E827D] hover:text-[#39FF88]"
                        >
                          {selected ? (
                            <CheckSquare className="w-4 h-4 text-[#39FF88]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!user) return;
                              await storage.toggleFolderFavorite(user.id, folder.id);
                              await refreshVaultData();
                            }}
                            aria-label={`Favorite folder ${folder.name}`}
                            className={`p-1.5 rounded hover:bg-white/5 ${
                              folder.isFavorite ? 'text-amber-400' : 'text-[#6E827D] hover:text-[#E6F1EE]'
                            }`}
                          >
                            <Star className="w-3.5 h-3.5" fill={folder.isFavorite ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenameTarget({ type: 'folder', id: folder.id, name: folder.name })}
                            aria-label={`Rename folder ${folder.name}`}
                            className="p-1.5 rounded text-[#6E827D] hover:text-[#E6F1EE] hover:bg-white/5"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMoveTarget({ type: 'folder', id: folder.id, currentParentId: folder.parentId })
                            }
                            aria-label={`Move folder ${folder.name}`}
                            className="p-1.5 rounded text-[#6E827D] hover:text-[#E6F1EE] hover:bg-white/5"
                          >
                            <FolderInput className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            if (!user) return;
                            await storage.deleteFolderToTrash(user.id, folder.id);
                            await refreshVaultData();
                            addToast({ type: 'info', title: `Moved "${folder.name}" to Trash` });
                          }}
                          aria-label={`Delete folder ${folder.name}`}
                          className="p-1.5 rounded text-[#6E827D] hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Files Grid */}
          {filteredFiles.length > 0 && (
            <section aria-label="Files">
              <h2 className="text-xs font-medium text-[#8A9D98] mb-3">
                Files ({filteredFiles.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {filteredFiles.map((file) => {
                  const Icon = getCategoryIcon(file.category);
                  const selected = selectedFileIds.has(file.id);
                  const thumb = thumbUrls[file.id];

                  return (
                    <div
                      key={file.id}
                      className={`group bg-[#090D0D] border rounded-xl overflow-hidden flex flex-col transition-colors ${
                        selected
                          ? 'border-[#39FF88]/60 bg-[#39FF88]/5'
                          : 'border-white/10 hover:border-[#39FF88]/35'
                      }`}
                    >
                      <div className="relative h-28 bg-[#030505] border-b border-white/5 flex items-center justify-center overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setPreviewFile(file)}
                          aria-label={`Preview ${file.name}`}
                          className="w-full h-full flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#39FF88]"
                        >
                          {file.isEncrypted ? (
                            <div className="flex flex-col items-center justify-center gap-1.5 text-[#39FF88]">
                              <div className="flex items-center gap-1.5">
                                <Leaf className="w-5 h-5" />
                                <Lock className="w-5 h-5 text-[#00E5FF]" />
                              </div>
                              <span className="text-[10px] tracking-wider text-[#8A9D98]">
                                AES-256-GCM
                              </span>
                            </div>
                          ) : thumb ? (
                            <img
                              src={thumb}
                              alt={file.name}
                              className="w-full h-full object-contain p-1.5"
                            />
                          ) : (
                            <Icon className="w-8 h-8 text-[#39FF88]/75" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleFileSelect(file.id)}
                          aria-label={`Select file ${file.name}`}
                          className="absolute top-2.5 right-2.5 p-1 rounded bg-black/60 text-[#A3B5B0] hover:text-[#39FF88]"
                        >
                          {selected ? (
                            <CheckSquare className="w-4 h-4 text-[#39FF88]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
                        <div>
                          <button
                            type="button"
                            onClick={() => setPreviewFile(file)}
                            className="text-left w-full text-xs font-semibold text-[#E6F1EE] hover:text-[#39FF88] truncate block"
                          >
                            {file.name}
                          </button>
                          <div className="text-[11px] text-[#8A9D98] mt-1 tabular-nums truncate">
                            {formatBytes(file.size)} · {file.isEncrypted ? 'AES-256-GCM' : file.category} · {formatTimestamp(file.updatedAt)}
                          </div>
                          {file.tags.length > 0 && (
                            <div className="text-[11px] text-[#00E5FF] mt-1 truncate">
                              {file.tags.map((t) => `#${t}`).join(' · ')}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-white/5">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!user) return;
                                await storage.toggleFileFavorite(user.id, file.id);
                                await refreshVaultData();
                              }}
                              aria-label={`Favorite ${file.name}`}
                              className={`p-1.5 rounded hover:bg-white/5 ${
                                file.isFavorite ? 'text-amber-400' : 'text-[#6E827D] hover:text-[#E6F1EE]'
                              }`}
                            >
                              <Star className="w-3.5 h-3.5" fill={file.isFavorite ? 'currentColor' : 'none'} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenameTarget({ type: 'file', id: file.id, name: file.name })}
                              aria-label={`Rename ${file.name}`}
                              className="p-1.5 rounded text-[#6E827D] hover:text-[#E6F1EE] hover:bg-white/5"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setTagTarget(file)}
                              aria-label={`Edit tags for ${file.name}`}
                              className="p-1.5 rounded text-[#6E827D] hover:text-[#00E5FF] hover:bg-white/5"
                            >
                              <Tag className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setMoveTarget({ type: 'file', id: file.id, currentParentId: file.folderId })
                              }
                              aria-label={`Move ${file.name}`}
                              className="p-1.5 rounded text-[#6E827D] hover:text-[#E6F1EE] hover:bg-white/5"
                            >
                              <FolderInput className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadFile(file)}
                              aria-label={`Download ${file.name}`}
                              className="p-1.5 rounded text-[#6E827D] hover:text-[#39FF88] hover:bg-white/5"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            {(file.extension === 'zip' || file.mimeType.includes('zip')) && (
                              <button
                                type="button"
                                onClick={() => handleOpenStoredZip(file)}
                                title="Extract ZIP & add media to desired folder"
                                aria-label={`Extract ${file.name}`}
                                className="p-1.5 rounded text-[#00E5FF] hover:bg-[#00E5FF]/10"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={async () => {
                              if (!user) return;
                              await storage.deleteFileToTrash(user.id, file.id);
                              await refreshVaultData();
                              addToast({ type: 'info', title: `Moved "${file.name}" to Trash` });
                            }}
                            aria-label={`Delete ${file.name}`}
                            className="p-1.5 rounded text-[#6E827D] hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* List View Table */
        <div className="bg-[#090D0D] border border-white/10 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-[#8A9D98]">
                <th className="py-3 px-4 font-medium w-8">Sel</th>
                <th className="py-3 px-4 font-medium">Name</th>
                <th className="py-3 px-4 font-medium">Type</th>
                <th className="py-3 px-4 font-medium text-right">Size</th>
                <th className="py-3 px-4 font-medium">Modified</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs">
              {filteredFolders.map((folder) => {
                const selected = selectedFolderIds.has(folder.id);
                return (
                  <tr key={folder.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => toggleFolderSelect(folder.id)}
                        aria-label={`Select folder ${folder.name}`}
                        className="text-[#6E827D] hover:text-[#39FF88]"
                      >
                        {selected ? <CheckSquare className="w-4 h-4 text-[#39FF88]" /> : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => onNavigateFolder(folder.id)}
                        className="inline-flex items-center gap-2 text-[#E6F1EE] hover:text-[#39FF88] font-medium"
                      >
                        <Folder className="w-4 h-4 text-[#00E5FF]" />
                        <span>{folder.name}</span>
                      </button>
                    </td>
                    <td className="py-2.5 px-4 text-[#8A9D98]">folder</td>
                    <td className="py-2.5 px-4 text-right text-[#6E827D] tabular-nums">—</td>
                    <td className="py-2.5 px-4 text-[#8A9D98] tabular-nums">{formatTimestamp(folder.updatedAt)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setRenameTarget({ type: 'folder', id: folder.id, name: folder.name })}
                          aria-label={`Rename folder ${folder.name}`}
                          className="p-1.5 text-[#6E827D] hover:text-[#E6F1EE]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!user) return;
                            await storage.deleteFolderToTrash(user.id, folder.id);
                            await refreshVaultData();
                          }}
                          aria-label={`Delete folder ${folder.name}`}
                          className="p-1.5 text-[#6E827D] hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredFiles.map((file) => {
                const Icon = getCategoryIcon(file.category);
                const selected = selectedFileIds.has(file.id);
                return (
                  <tr key={file.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => toggleFileSelect(file.id)}
                        aria-label={`Select file ${file.name}`}
                        className="text-[#6E827D] hover:text-[#39FF88]"
                      >
                        {selected ? <CheckSquare className="w-4 h-4 text-[#39FF88]" /> : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => setPreviewFile(file)}
                        className="inline-flex items-center gap-2 text-[#E6F1EE] hover:text-[#39FF88] font-medium max-w-xs truncate"
                      >
                        {file.isEncrypted ? (
                          <Leaf className="w-4 h-4 text-[#39FF88] shrink-0" />
                        ) : (
                          <Icon className="w-4 h-4 text-[#39FF88] shrink-0" />
                        )}
                        <span className="truncate">{file.name}</span>
                      </button>
                    </td>
                    <td className="py-2.5 px-4 text-[#8A9D98]">
                      {file.isEncrypted ? `encrypted (${file.category})` : file.category}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#E6F1EE] tabular-nums">{formatBytes(file.size)}</td>
                    <td className="py-2.5 px-4 text-[#8A9D98] tabular-nums">{formatTimestamp(file.updatedAt)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!user) return;
                            await storage.toggleFileFavorite(user.id, file.id);
                            await refreshVaultData();
                          }}
                          aria-label={`Favorite ${file.name}`}
                          className={`p-1.5 ${file.isFavorite ? 'text-amber-400' : 'text-[#6E827D] hover:text-[#E6F1EE]'}`}
                        >
                          <Star className="w-3.5 h-3.5" fill={file.isFavorite ? 'currentColor' : 'none'} />
                        </button>
                        {(file.extension === 'zip' || file.mimeType.includes('zip')) && (
                          <button
                            type="button"
                            onClick={() => handleOpenStoredZip(file)}
                            aria-label={`Extract ${file.name}`}
                            className="p-1.5 text-[#00E5FF] hover:text-[#3CEEFF]"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDownloadFile(file)}
                          aria-label={`Download ${file.name}`}
                          className="p-1.5 text-[#6E827D] hover:text-[#39FF88]"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenameTarget({ type: 'file', id: file.id, name: file.name })}
                          aria-label={`Rename ${file.name}`}
                          className="p-1.5 text-[#6E827D] hover:text-[#E6F1EE]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!user) return;
                            await storage.deleteFileToTrash(user.id, file.id);
                            await refreshVaultData();
                          }}
                          aria-label={`Delete ${file.name}`}
                          className="p-1.5 text-[#6E827D] hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview Modal */}
      <FilePreviewModal
        file={previewFile}
        galleryFiles={filteredFiles}
        onClose={() => setPreviewFile(null)}
        onSelectFile={(f) => setPreviewFile(f)}
        onExtractZip={(blob, name) => {
          setZipSource({ blob, name });
          setZipModalOpen(true);
        }}
      />

      {/* Rename Modal */}
      <TextPromptModal
        open={Boolean(renameTarget)}
        title={`Rename ${renameTarget?.type === 'folder' ? 'Folder' : 'File'}`}
        label="New Name"
        initialValue={renameTarget?.name || ''}
        submitLabel="Rename"
        onClose={() => setRenameTarget(null)}
        onSubmit={async (newName) => {
          if (!user || !renameTarget) return;
          if (renameTarget.type === 'folder') {
            await storage.renameFolder(user.id, renameTarget.id, newName);
          } else {
            await storage.renameFile(user.id, renameTarget.id, newName);
          }
          await refreshVaultData();
          addToast({ type: 'success', title: `Renamed to "${newName}"` });
        }}
      />

      {/* Move Modal */}
      <MoveFolderModal
        open={Boolean(moveTarget)}
        title={moveTarget?.type === 'bulk' ? `Move ${totalSelected} Selected Items` : 'Move Item'}
        folders={folders}
        excludeFolderIds={
          moveTarget?.type === 'folder' && moveTarget.id
            ? new Set([moveTarget.id])
            : moveTarget?.type === 'bulk'
            ? selectedFolderIds
            : undefined
        }
        currentFolderId={moveTarget?.currentParentId ?? null}
        onClose={() => setMoveTarget(null)}
        onMove={async (targetParentId) => {
          if (!user || !moveTarget) return;
          if (moveTarget.type === 'file' && moveTarget.id) {
            await storage.moveFile(user.id, moveTarget.id, targetParentId);
          } else if (moveTarget.type === 'folder' && moveTarget.id) {
            await storage.moveFolder(user.id, moveTarget.id, targetParentId);
          } else if (moveTarget.type === 'bulk') {
            for (const fid of selectedFileIds) {
              await storage.moveFile(user.id, fid, targetParentId);
            }
            for (const did of selectedFolderIds) {
              if (did !== targetParentId) {
                await storage.moveFolder(user.id, did, targetParentId);
              }
            }
            setSelectedFileIds(new Set());
            setSelectedFolderIds(new Set());
          }
          await refreshVaultData();
          addToast({ type: 'success', title: 'Moved successfully' });
        }}
      />

      {/* Tag Editor Modal */}
      <TagEditorModal
        open={Boolean(tagTarget)}
        itemName={tagTarget?.name || ''}
        initialTags={tagTarget?.tags || []}
        onClose={() => setTagTarget(null)}
        onSave={async (nextTags) => {
          if (!user || !tagTarget) return;
          await storage.updateFileTags(user.id, tagTarget.id, nextTags);
          await refreshVaultData();
          addToast({ type: 'success', title: 'Tags updated' });
        }}
      />

      {/* Encrypted Export / Download Modal */}
      <EncryptedDownloadModal
        file={encryptedDownloadTarget}
        onClose={() => setEncryptedDownloadTarget(null)}
      />

      {/* ZIP Archive Extractor Modal */}
      <ZipExtractorModal
        open={zipModalOpen}
        zipSource={zipSource}
        initialFolderId={section === 'all' ? currentFolderId : null}
        onPickZipFile={() => zipInputRef.current?.click()}
        onClose={() => {
          setZipModalOpen(false);
          setZipSource(null);
        }}
        onCompleted={(destFolderId) => {
          onNavigateFolder(destFolderId);
        }}
      />
    </div>
  );
};
