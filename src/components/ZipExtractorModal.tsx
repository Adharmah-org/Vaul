import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckSquare,
  File as FileIcon,
  FileUp,
  Film,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Leaf,
  Loader2,
  Square,
  X,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatBytes } from '../services/fileUtils';
import { ExtractedZipItem, extractZipArchive } from '../services/zipExtractor';
import { FolderRecord } from '../types/vault';

interface ZipExtractorModalProps {
  open: boolean;
  zipSource: { blob: Blob; name: string } | null;
  initialFolderId: string | null;
  onPickZipFile?: () => void;
  onClose: () => void;
  onCompleted?: (destinationFolderId: string | null) => void;
}

type MediaFilter = 'media' | 'image' | 'video' | 'all';

function buildFolderLabel(folder: FolderRecord, byId: Map<string, FolderRecord>): string {
  const names: string[] = [folder.name];
  let parentId = folder.parentId;
  let guard = 0;
  while (parentId && guard < 16) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
    guard += 1;
  }
  return `/${names.join(' / ')}`;
}

export const ZipExtractorModal: React.FC<ZipExtractorModalProps> = ({
  open,
  zipSource,
  initialFolderId,
  onPickZipFile,
  onClose,
  onCompleted,
}) => {
  const {
    user,
    storage,
    folders,
    encryptedUploadMode,
    isEncryptionArmed,
    setArmEncryptedModalOpen,
    uploadFiles,
    refreshVaultData,
    addToast,
  } = useVault();

  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [items, setItems] = useState<ExtractedZipItem[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<MediaFilter>('media');

  // Destination routing controls
  const [splitMediaRouting, setSplitMediaRouting] = useState(false);
  const [singleFolderId, setSingleFolderId] = useState<string | null>(initialFolderId);
  const [imagesFolderId, setImagesFolderId] = useState<string | null>(initialFolderId);
  const [videosFolderId, setVideosFolderId] = useState<string | null>(initialFolderId);
  const [otherFolderId, setOtherFolderId] = useState<string | null>(initialFolderId);
  const [encryptExtracted, setEncryptExtracted] = useState(encryptedUploadMode);

  // Inline new folder creation inside the modal
  const [creatingForTarget, setCreatingForTarget] = useState<
    'single' | 'images' | 'videos' | 'other' | null
  >(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolderBusy, setCreatingFolderBusy] = useState(false);

  // Image thumbnail previews for extracted image entries
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const thumbUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, importing, onClose]);

  useEffect(() => {
    if (!open) return;
    setSingleFolderId(initialFolderId);
    setImagesFolderId(initialFolderId);
    setVideosFolderId(initialFolderId);
    setOtherFolderId(initialFolderId);
    setEncryptExtracted(encryptedUploadMode);
    setCreatingForTarget(null);
    setNewFolderName('');
  }, [open, initialFolderId, encryptedUploadMode]);

  useEffect(() => {
    if (!open || !zipSource) {
      setItems([]);
      setSelectedIds(new Set());
      setErrorMsg(null);
      setSkippedCount(0);
      return;
    }

    let cancelled = false;
    setExtracting(true);
    setErrorMsg(null);
    setItems([]);

    (async () => {
      try {
        const result = await extractZipArchive(zipSource.blob, zipSource.name);
        if (cancelled) return;
        setItems(result.items);
        setSkippedCount(result.skippedSystemCount);

        const mediaItems = result.items.filter(
          (i) => i.category === 'image' || i.category === 'video'
        );
        if (mediaItems.length > 0) {
          setFilterMode('media');
          setSelectedIds(new Set(mediaItems.map((i) => i.id)));
        } else {
          setFilterMode('all');
          setSelectedIds(new Set(result.items.map((i) => i.id)));
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to extract ZIP archive.');
        }
      } finally {
        if (!cancelled) setExtracting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, zipSource]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const item of items) {
      if (item.category === 'image' && item.size < 12 * 1024 * 1024) {
        next[item.id] = URL.createObjectURL(item.file);
      }
    }
    Object.values(thumbUrlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    thumbUrlsRef.current = next;
    setThumbUrls(next);

    return () => {
      Object.values(next).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [items]);

  const folderOptions = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    return folders
      .map((f) => ({
        id: f.id,
        label: buildFolderLabel(f, byId),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folders]);

  const counts = useMemo(() => {
    let images = 0;
    let videos = 0;
    let other = 0;
    let totalSize = 0;
    for (const item of items) {
      totalSize += item.size;
      if (item.category === 'image') images += 1;
      else if (item.category === 'video') videos += 1;
      else other += 1;
    }
    return { images, videos, other, media: images + videos, total: items.length, totalSize };
  }, [items]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (filterMode === 'media') return item.category === 'image' || item.category === 'video';
      if (filterMode === 'image') return item.category === 'image';
      if (filterMode === 'video') return item.category === 'video';
      return true;
    });
  }, [items, filterMode]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  if (!open) return null;

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of visibleItems) next.add(item.id);
      return next;
    });
  };

  const handleClearVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of visibleItems) next.delete(item.id);
      return next;
    });
  };

  const handleCreateFolderInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newFolderName.trim() || !creatingForTarget) return;
    setCreatingFolderBusy(true);
    try {
      const parentForCreate =
        creatingForTarget === 'single'
          ? singleFolderId
          : creatingForTarget === 'images'
          ? imagesFolderId
          : creatingForTarget === 'videos'
          ? videosFolderId
          : otherFolderId;
      const created = await storage.createFolder(user.id, newFolderName.trim(), parentForCreate);
      await refreshVaultData();
      if (creatingForTarget === 'single') setSingleFolderId(created.id);
      else if (creatingForTarget === 'images') setImagesFolderId(created.id);
      else if (creatingForTarget === 'videos') setVideosFolderId(created.id);
      else setOtherFolderId(created.id);
      setCreatingForTarget(null);
      setNewFolderName('');
      addToast({ type: 'success', title: `Folder "${created.name}" created` });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Folder creation failed',
        description: err instanceof Error ? err.message : 'Unable to create folder.',
      });
    } finally {
      setCreatingFolderBusy(false);
    }
  };

  const handleImportSelected = async () => {
    if (selectedItems.length === 0) return;
    if (encryptExtracted && !isEncryptionArmed) {
      setArmEncryptedModalOpen(true);
      addToast({
        type: 'info',
        title: 'Arm Encrypted Mode first',
        description: 'Verify your Rooh Key so extracted files can be encrypted with AES-256-GCM.',
      });
      return;
    }

    setImporting(true);
    try {
      if (!splitMediaRouting) {
        await uploadFiles(
          selectedItems.map((i) => i.file),
          singleFolderId,
          { encrypted: encryptExtracted }
        );
        onCompleted?.(singleFolderId);
      } else {
        const grouped = new Map<string, File[]>();
        for (const item of selectedItems) {
          const destId =
            item.category === 'image'
              ? imagesFolderId
              : item.category === 'video'
              ? videosFolderId
              : otherFolderId;
          const key = destId ?? '__root__';
          const list = grouped.get(key) ?? [];
          list.push(item.file);
          grouped.set(key, list);
        }

        for (const [key, batch] of grouped.entries()) {
          const folderId = key === '__root__' ? null : key;
          await uploadFiles(batch, folderId, { encrypted: encryptExtracted });
        }
        onCompleted?.(imagesFolderId ?? videosFolderId ?? otherFolderId);
      }

      addToast({
        type: 'success',
        title: `Added ${selectedItems.length} extracted ${selectedItems.length === 1 ? 'file' : 'files'}`,
        description: splitMediaRouting
          ? 'Media routed to your selected destination folders.'
          : 'Saved to your chosen vault destination.',
      });
      onClose();
    } finally {
      setImporting(false);
    }
  };

  const renderFolderSelect = (
    id: string,
    label: string,
    value: string | null,
    onChange: (next: string | null) => void,
    targetKey: 'single' | 'images' | 'videos' | 'other'
  ) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[11px] text-[#A3B5B0] font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Folder className="w-3.5 h-3.5 text-[#00E5FF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            id={id}
            value={value ?? '__root__'}
            onChange={(e) => onChange(e.target.value === '__root__' ? null : e.target.value)}
            className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg pl-8 pr-3 py-2 text-xs text-[#E6F1EE] truncate"
          >
            <option value="__root__">Vault Root (/)</option>
            {folderOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreatingForTarget(creatingForTarget === targetKey ? null : targetKey);
            setNewFolderName('');
          }}
          title="Create new destination folder"
          aria-label={`New folder for ${label}`}
          className="inline-flex items-center gap-1 px-2.5 py-2 text-xs rounded-lg border border-white/15 bg-[#030505] text-[#39FF88] hover:border-[#39FF88]/50 whitespace-nowrap shrink-0"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ZIP Archive Extractor"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
    >
      <div className="w-full max-w-3xl bg-[#0A0E0E] border border-[#39FF88]/25 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#00E5FF]/10 border border-[#00E5FF]/30 flex items-center justify-center text-[#00E5FF] shrink-0">
              <Archive className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#E6F1EE] truncate">
                {zipSource ? `Extract ZIP: ${zipSource.name}` : 'Extract ZIP Archive'}
              </h2>
              {items.length > 0 && (
                <div className="text-[11px] text-[#8A9D98] tabular-nums truncate">
                  {counts.images} images · {counts.videos} videos · {counts.other} other · {formatBytes(counts.totalSize)}
                  {skippedCount > 0 ? ` · ${skippedCount} system entries skipped` : ''}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onPickZipFile && (
              <button
                type="button"
                onClick={onPickZipFile}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-white/15 text-[#E6F1EE] hover:border-[#00E5FF]/50 whitespace-nowrap"
              >
                <FileUp className="w-3.5 h-3.5 text-[#00E5FF]" />
                <span className="hidden sm:inline">Pick .zip</span>
              </button>
            )}
            <button
              type="button"
              disabled={importing}
              onClick={onClose}
              aria-label="Close ZIP extractor"
              className="p-1.5 rounded text-[#6E827D] hover:text-[#E6F1EE] hover:bg-white/5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {extracting ? (
            <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
              <Loader2 className="w-6 h-6 text-[#39FF88] animate-spin" />
              <div className="text-xs text-[#E6F1EE]">Extracting archive contents in sandbox...</div>
            </div>
          ) : errorMsg ? (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/35 rounded-lg p-4 flex items-start gap-2.5 text-xs text-red-300"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-xs text-[#8A9D98] font-sans-ui">
                No extractable files found inside this archive.
              </p>
              {onPickZipFile && (
                <button
                  type="button"
                  onClick={onPickZipFile}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  Select Another .zip File
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Filter & Selection Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5 bg-[#030505] border border-white/10 rounded-lg p-1">
                  {(
                    [
                      { id: 'media', label: `Images & Videos (${counts.media})` },
                      { id: 'image', label: `Images (${counts.images})` },
                      { id: 'video', label: `Videos (${counts.videos})` },
                      { id: 'all', label: `All Files (${counts.total})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilterMode(tab.id)}
                      className={`px-2.5 py-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                        filterMode === tab.id
                          ? 'bg-[#39FF88]/15 text-[#39FF88] font-medium'
                          : 'text-[#8A9D98] hover:text-[#E6F1EE]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={handleSelectVisible}
                    className="text-[#39FF88] hover:underline whitespace-nowrap"
                  >
                    Select Visible
                  </button>
                  <span className="text-[#4F615C]">·</span>
                  <button
                    type="button"
                    onClick={handleClearVisible}
                    className="text-[#8A9D98] hover:text-[#E6F1EE] whitespace-nowrap"
                  >
                    Clear Visible
                  </button>
                </div>
              </div>

              {/* Extracted Files List */}
              {visibleItems.length === 0 ? (
                <div className="bg-[#030505] border border-white/10 rounded-lg p-6 text-center text-xs text-[#8A9D98]">
                  No files match this media filter. Switch to All Files to inspect other archive entries.
                </div>
              ) : (
                <div className="bg-[#030505] border border-white/10 rounded-xl divide-y divide-white/5 max-h-60 overflow-y-auto">
                  {visibleItems.map((item) => {
                    const checked = selectedIds.has(item.id);
                    const thumb = thumbUrls[item.id];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        className={`w-full px-3.5 py-2.5 flex items-center gap-3 text-left transition-colors ${
                          checked ? 'bg-[#39FF88]/[0.05]' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        {checked ? (
                          <CheckSquare className="w-4 h-4 text-[#39FF88] shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-[#6E827D] shrink-0" />
                        )}

                        <div className="w-9 h-9 rounded-lg bg-[#090D0D] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={item.fileName}
                              className="w-full h-full object-contain p-0.5"
                            />
                          ) : item.category === 'video' ? (
                            <Film className="w-4 h-4 text-[#00E5FF]" />
                          ) : item.category === 'image' ? (
                            <ImageIcon className="w-4 h-4 text-[#39FF88]" />
                          ) : (
                            <FileIcon className="w-4 h-4 text-[#8A9D98]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-[#E6F1EE] truncate">
                            {item.fileName}
                          </div>
                          <div className="text-[11px] text-[#6E827D] truncate">
                            {item.entryPath} · {item.category} · {formatBytes(item.size)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Desired Place Destination Routing */}
              <div className="bg-[#090D0D] border border-white/10 rounded-xl p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[#E6F1EE]">
                      Destination Place in Vault
                    </div>
                    <div className="text-[11px] text-[#8A9D98] font-sans-ui">
                      Extracted images &amp; videos also appear automatically in Images and Videos dock views.
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-pressed={splitMediaRouting}
                    onClick={() => setSplitMediaRouting((s) => !s)}
                    className={`px-2.5 py-1.5 text-[11px] rounded-lg border transition-colors whitespace-nowrap ${
                      splitMediaRouting
                        ? 'border-[#00E5FF]/50 bg-[#00E5FF]/10 text-[#00E5FF]'
                        : 'border-white/15 text-[#8A9D98] hover:text-[#E6F1EE]'
                    }`}
                  >
                    {splitMediaRouting ? 'Split by Type: On' : 'Split Images / Videos'}
                  </button>
                </div>

                {!splitMediaRouting ? (
                  renderFolderSelect(
                    'zip-dest-single',
                    'Target Vault Folder',
                    singleFolderId,
                    setSingleFolderId,
                    'single'
                  )
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {renderFolderSelect(
                      'zip-dest-images',
                      'Images Destination',
                      imagesFolderId,
                      setImagesFolderId,
                      'images'
                    )}
                    {renderFolderSelect(
                      'zip-dest-videos',
                      'Videos Destination',
                      videosFolderId,
                      setVideosFolderId,
                      'videos'
                    )}
                    {counts.other > 0 && (
                      <div className="sm:col-span-2">
                        {renderFolderSelect(
                          'zip-dest-other',
                          'Other Files Destination',
                          otherFolderId,
                          setOtherFolderId,
                          'other'
                        )}
                      </div>
                    )}
                  </div>
                )}

                {creatingForTarget && (
                  <form
                    onSubmit={handleCreateFolderInline}
                    className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-2 border-t border-white/10"
                  >
                    <input
                      type="text"
                      autoFocus
                      required
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="New folder name (e.g. Vacation Media)"
                      aria-label="New destination folder name"
                      className="flex-1 min-w-[180px] bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#E6F1EE]"
                    />
                    <button
                      type="submit"
                      disabled={creatingFolderBusy || !newFolderName.trim()}
                      className="px-3.5 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50 whitespace-nowrap"
                    >
                      {creatingFolderBusy ? 'Creating...' : 'Create & Select'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreatingForTarget(null)}
                      className="px-3 py-2 text-xs text-[#8A9D98] hover:text-[#E6F1EE] rounded-lg border border-white/10 whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  </form>
                )}

                {/* Encrypted Mode Option */}
                <label className="flex items-center gap-2.5 pt-2 border-t border-white/10 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={encryptExtracted}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (next && !isEncryptionArmed) {
                        setArmEncryptedModalOpen(true);
                      }
                      setEncryptExtracted(next);
                    }}
                    className="w-4 h-4 rounded border-white/25 bg-[#030505] accent-[#39FF88]"
                  />
                  <Leaf className="w-3.5 h-3.5 text-[#39FF88] shrink-0" />
                  <span className="text-xs text-[#E6F1EE] font-sans-ui">
                    Encrypt extracted files with AES-256-GCM (Rooh Key required after download)
                  </span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-white/10 bg-[#070A0A] flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-[#8A9D98] tabular-nums">
            {selectedItems.length} {selectedItems.length === 1 ? 'file' : 'files'} selected for vault import
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={importing}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#8A9D98] hover:text-[#E6F1EE] rounded-lg border border-white/10 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={extracting || importing || selectedItems.length === 0}
              onClick={handleImportSelected}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-45 whitespace-nowrap"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>
                {importing
                  ? 'Adding to Vault...'
                  : `Add ${selectedItems.length} ${selectedItems.length === 1 ? 'File' : 'Files'} to Vault`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
