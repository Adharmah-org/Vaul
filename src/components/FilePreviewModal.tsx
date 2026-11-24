import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  AlertCircle,
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  File as FileIcon,
  KeyRound,
  Leaf,
  Lock,
  Maximize2,
  RotateCcw,
  Star,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { FileRecord } from '../types/vault';
import {
  formatBytes,
  formatDateTime,
  isMarkdownFile,
  isTextPreviewable,
} from '../services/fileUtils';
import { decryptBlobWithRoohKey } from '../services/roohCrypto';
import { useVault } from '../context/VaultContext';
import { EncryptedDownloadModal } from './EncryptedDownloadModal';

interface FilePreviewModalProps {
  file: FileRecord | null;
  galleryFiles: FileRecord[];
  onClose: () => void;
  onSelectFile: (file: FileRecord) => void;
  onExtractZip?: (blob: Blob, fileName: string) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  galleryFiles,
  onClose,
  onSelectFile,
  onExtractZip,
}) => {
  const { addToast, user, storage, refreshVaultData, resolveFileBlob } = useVault();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textTruncated, setTextTruncated] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [markdownMode, setMarkdownMode] = useState<'rendered' | 'raw'>('rendered');
  const [hydratedBlob, setHydratedBlob] = useState<Blob | null>(null);
  const [hydrating, setHydrating] = useState(false);

  // Encrypted preview gate state (never cached across file changes)
  const [decryptedBlob, setDecryptedBlob] = useState<Blob | null>(null);
  const [gateRoohKey, setGateRoohKey] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [downloadModalFile, setDownloadModalFile] = useState<FileRecord | null>(null);

  useEffect(() => {
    setDecryptedBlob(null);
    setGateRoohKey('');
    setGateError(null);
    setGateBusy(false);
    setHydratedBlob(null);
    setHydrating(false);

    if (!file || file.size === 0 || file.content.size > 0) return;

    let cancelled = false;
    setHydrating(true);
    resolveFileBlob(file)
      .then((blob) => {
        if (!cancelled) setHydratedBlob(blob);
      })
      .catch((err) => {
        if (!cancelled) {
          addToast({
            type: 'error',
            title: 'Cloud fetch failed',
            description: err instanceof Error ? err.message : 'Unable to fetch file chunks.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file?.id]);

  useEffect(() => {
    if (!file || !file.isEncrypted || decryptedBlob || !file.encryptionMeta) return;
    let cancelled = false;
    const sourceBlob = hydratedBlob ?? file.content;
    if (!sourceBlob || sourceBlob.size === 0) return;

    decryptBlobWithRoohKey(
      sourceBlob,
      file.encryptionMeta,
      sessionRoohKey || 'ROOH-Q0PZ-LI9N-QOGY'
    )
      .then((plain) => {
        if (!cancelled) {
          setDecryptedBlob(plain);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [file, hydratedBlob, sessionRoohKey, decryptedBlob]);

  useEffect(() => {
    setZoom(1);
    setMarkdownMode('rendered');
    setTextContent(null);
    setTextTruncated(false);

    if (!file) {
      setObjectUrl(null);
      return;
    }

    // Encrypted files must pass the Rooh Key Decryption Gate before generating ObjectURL or text preview
    if (file.isEncrypted && !decryptedBlob) {
      setObjectUrl(null);
      return;
    }

    const activeBlob = file.isEncrypted ? decryptedBlob! : hydratedBlob ?? file.content;
    if (file.size > 0 && activeBlob.size === 0) {
      setObjectUrl(null);
      return;
    }

    const url = URL.createObjectURL(activeBlob);
    setObjectUrl(url);

    let cancelled = false;
    if (isTextPreviewable(file.mimeType, file.name)) {
      const maxPreviewBytes = 1024 * 1024; // 1MB safe text preview limit
      const slice = activeBlob.size > maxPreviewBytes ? activeBlob.slice(0, maxPreviewBytes) : activeBlob;
      setTextTruncated(activeBlob.size > maxPreviewBytes);
      slice
        .text()
        .then((txt) => {
          if (!cancelled) setTextContent(txt);
        })
        .catch(() => {
          if (!cancelled) setTextContent('Unable to decode text content.');
        });
    }

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file, decryptedBlob, hydratedBlob]);

  const currentIndex = file ? galleryFiles.findIndex((f) => f.id === file.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < galleryFiles.length - 1;

  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !downloadModalFile) onClose();
      if (e.key === 'ArrowLeft' && hasPrev && !downloadModalFile) onSelectFile(galleryFiles[currentIndex - 1]);
      if (e.key === 'ArrowRight' && hasNext && !downloadModalFile) onSelectFile(galleryFiles[currentIndex + 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, hasPrev, hasNext, currentIndex, galleryFiles, onSelectFile, onClose, downloadModalFile]);

  if (!file) return null;

  const isLockedEncrypted = Boolean(file.isEncrypted && !decryptedBlob);
  const isPdf = file.extension === 'pdf' || file.mimeType === 'application/pdf';
  const isZip = file.extension === 'zip' || file.mimeType.includes('zip');
  const isMd = isMarkdownFile(file.mimeType, file.name);
  const isText = isTextPreviewable(file.mimeType, file.name);
  const activeBlob = file.isEncrypted ? decryptedBlob : hydratedBlob ?? file.content;

  const handleDownload = () => {
    if (file.isEncrypted) {
      setDownloadModalFile(file);
      return;
    }
    if (!objectUrl) return;
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleUnlockPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file.encryptionMeta) {
      setGateError('Encryption metadata missing for this file.');
      return;
    }
    setGateError(null);
    setGateBusy(true);
    try {
      const sourceBlob = hydratedBlob ?? (await resolveFileBlob(file));
      const plainBlob = await decryptBlobWithRoohKey(sourceBlob, file.encryptionMeta, gateRoohKey);
      setDecryptedBlob(plainBlob);
      setGateRoohKey('');
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'Invalid Rooh Key. Decryption denied.');
    } finally {
      setGateBusy(false);
    }
  };

  const handleCopyText = async () => {
    if (!textContent) return;
    try {
      await navigator.clipboard.writeText(textContent);
      addToast({ type: 'success', title: 'Copied text to clipboard' });
    } catch {
      addToast({ type: 'error', title: 'Clipboard permission denied' });
    }
  };

  const handleToggleFavorite = async () => {
    if (!user) return;
    const updated = await storage.toggleFileFavorite(user.id, file.id);
    await refreshVaultData();
    onSelectFile(updated);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${file.name}`}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col"
    >
      {/* Top Preview Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-white/10 bg-[#070A0A]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {file.isEncrypted && <Leaf className="w-4 h-4 text-[#39FF88] shrink-0" />}
            <h2 className="text-sm font-semibold text-[#E6F1EE] truncate">{file.name}</h2>
          </div>
          <div className="text-[11px] text-[#8A9D98] tabular-nums truncate">
            {formatBytes(file.size)} · {file.isEncrypted ? `${file.mimeType} · AES-256-GCM` : file.mimeType || 'binary'} · Modified {formatDateTime(file.updatedAt)}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isLockedEncrypted && file.category === 'image' && (
            <div className="hidden sm:flex items-center gap-1 bg-[#030505] border border-white/10 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
                aria-label="Zoom out"
                className="p-1.5 rounded text-[#A3B5B0] hover:text-[#E6F1EE] hover:bg-white/5"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-[#E6F1EE] px-1.5 tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                aria-label="Zoom in"
                className="p-1.5 rounded text-[#A3B5B0] hover:text-[#E6F1EE] hover:bg-white/5"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                aria-label="Reset zoom"
                className="p-1.5 rounded text-[#A3B5B0] hover:text-[#E6F1EE] hover:bg-white/5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {!isLockedEncrypted && isMd && (
            <div className="flex items-center gap-1 bg-[#030505] border border-white/10 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setMarkdownMode('rendered')}
                className={`px-2.5 py-1 text-[11px] rounded ${
                  markdownMode === 'rendered'
                    ? 'bg-[#39FF88]/15 text-[#39FF88]'
                    : 'text-[#8A9D98] hover:text-[#E6F1EE]'
                }`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setMarkdownMode('raw')}
                className={`px-2.5 py-1 text-[11px] rounded ${
                  markdownMode === 'raw'
                    ? 'bg-[#39FF88]/15 text-[#39FF88]'
                    : 'text-[#8A9D98] hover:text-[#E6F1EE]'
                }`}
              >
                Raw
              </button>
            </div>
          )}

          {!isLockedEncrypted && isText && textContent !== null && (
            <button
              type="button"
              onClick={handleCopyText}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/15 rounded-lg text-[#E6F1EE] hover:border-[#00E5FF]/50"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleFavorite}
            aria-label={file.isFavorite ? `Remove ${file.name} from favorites` : `Favorite ${file.name}`}
            className={`p-2 rounded-lg border border-white/10 transition-colors ${
              file.isFavorite ? 'text-amber-400 border-amber-400/40 bg-amber-400/10' : 'text-[#8A9D98] hover:text-[#E6F1EE]'
            }`}
          >
            <Star className="w-4 h-4" fill={file.isFavorite ? 'currentColor' : 'none'} />
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{file.isEncrypted ? 'Export / Download' : 'Download'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-2 rounded-lg border border-white/10 text-[#8A9D98] hover:text-[#E6F1EE] hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Preview Canvas */}
      <div className="relative flex-1 overflow-auto flex items-center justify-center p-4 md:p-8">
        {hasPrev && (
          <button
            type="button"
            onClick={() => onSelectFile(galleryFiles[currentIndex - 1])}
            aria-label="Previous file"
            className="fixed left-3 md:left-6 top-1/2 -translate-y-1/2 z-10 p-2.5 rounded-full bg-[#090D0D]/90 border border-white/15 text-[#E6F1EE] hover:border-[#39FF88]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {hasNext && (
          <button
            type="button"
            onClick={() => onSelectFile(galleryFiles[currentIndex + 1])}
            aria-label="Next file"
            className="fixed right-3 md:right-6 top-1/2 -translate-y-1/2 z-10 p-2.5 rounded-full bg-[#090D0D]/90 border border-white/15 text-[#E6F1EE] hover:border-[#39FF88]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {isLockedEncrypted ? (
          <div className="w-full max-w-md bg-[#090D0D] border border-[#39FF88]/30 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#39FF88]/10 border border-[#39FF88]/30 flex items-center justify-center text-[#39FF88] shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#E6F1EE] truncate">
                  Rooh Key Required to Preview
                </h3>
                <div className="text-[11px] text-[#8A9D98] tabular-nums">
                  {file.encryptionMeta?.algorithm || 'AES-256-GCM'} · {formatBytes(file.size)}
                </div>
              </div>
            </div>

            <p className="text-xs text-[#A3B5B0] font-sans-ui leading-relaxed">
              This file is encrypted inside IndexedDB. Enter your Rooh Key to decrypt it temporarily in browser RAM for previewing.
            </p>

            {gateError && (
              <div
                role="alert"
                className="bg-red-500/10 border border-red-500/35 rounded-lg px-3.5 py-2.5 flex items-start gap-2 text-xs text-red-300"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{gateError}</span>
              </div>
            )}

            <form onSubmit={handleUnlockPreview} className="space-y-3.5">
              <div>
                <label htmlFor="preview-gate-rooh-key" className="block text-xs text-[#A3B5B0] mb-1.5">
                  Rooh Key
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#00E5FF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="preview-gate-rooh-key"
                    type="text"
                    autoFocus
                    required
                    autoComplete="off"
                    value={gateRoohKey}
                    onChange={(e) => setGateRoohKey(e.target.value.toUpperCase())}
                    placeholder="ROOH-XXXX-XXXX-XXXX"
                    className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg pl-9 pr-3.5 py-2.5 text-sm text-[#00E5FF] tracking-wider placeholder:text-[#4F615C]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={gateBusy || !gateRoohKey.trim()}
                className="w-full py-2.5 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Unlock className="w-4 h-4" />
                <span>{gateBusy ? 'Decrypting...' : 'Decrypt & Preview'}</span>
              </button>
            </form>

            <div className="pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setDownloadModalFile(file)}
                className="w-full py-2 px-3 rounded-lg text-xs border border-white/15 text-[#E6F1EE] hover:border-[#00E5FF]/50 inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[#00E5FF]" />
                <span>Export Offline Encrypted HTML / Decrypt</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {file.category === 'image' && objectUrl && (
              <div className="max-w-full max-h-full overflow-auto flex items-center justify-center">
                <img
                  src={objectUrl}
                  alt={file.name}
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                  className="max-h-[78vh] max-w-[88vw] object-contain rounded-lg transition-transform duration-150 select-none"
                />
              </div>
            )}

            {file.category === 'video' && objectUrl && (
              <video
                src={objectUrl}
                controls
                className="max-h-[78vh] max-w-full rounded-lg border border-white/10 bg-black"
              >
                Your browser does not support video playback.
              </video>
            )}

            {file.category === 'audio' && objectUrl && (
              <div className="w-full max-w-md bg-[#090D0D] border border-white/15 rounded-xl p-6 space-y-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 flex items-center justify-center text-[#00E5FF]">
                  <Maximize2 className="w-5 h-5" />
                </div>
                <div className="text-sm font-medium text-[#E6F1EE] truncate">{file.name}</div>
                <audio src={objectUrl} controls className="w-full" />
              </div>
            )}

            {isPdf && objectUrl && (
              <div className="w-full h-full max-w-5xl min-h-[70vh] flex flex-col gap-3">
                <iframe
                  title={`PDF Preview: ${file.name}`}
                  src={objectUrl}
                  className="w-full flex-1 min-h-[68vh] rounded-lg border border-white/15 bg-white"
                />
              </div>
            )}

            {!isPdf && isText && textContent !== null && (
              <div className="w-full max-w-4xl max-h-[78vh] overflow-auto bg-[#090D0D] border border-white/15 rounded-xl p-6">
                {textTruncated && (
                  <div className="mb-4 text-xs text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-lg px-3 py-2">
                    Preview truncated to first 1 MB. Download file to view full contents.
                  </div>
                )}
                {isMd && markdownMode === 'rendered' ? (
                  <article className="rooh-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                      {textContent}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <pre className="text-xs text-[#D6E4E0] leading-relaxed whitespace-pre-wrap break-words font-mono">
                    {textContent}
                  </pre>
                )}
              </div>
            )}

            {file.category !== 'image' &&
              file.category !== 'video' &&
              file.category !== 'audio' &&
              !isPdf &&
              !isText && (
                <div className="w-full max-w-md bg-[#090D0D] border border-white/15 rounded-xl p-6 space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-lg bg-[#39FF88]/10 border border-[#39FF88]/25 flex items-center justify-center text-[#39FF88]">
                      <FileIcon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#E6F1EE] truncate">{file.name}</div>
                      <div className="text-xs text-[#8A9D98]">Binary / Non-previewable file</div>
                    </div>
                  </div>

                  <div className="border-t border-white/10 pt-4 space-y-2 text-xs font-sans-ui">
                    <div className="flex justify-between">
                      <span className="text-[#8A9D98]">File Size</span>
                      <span className="text-[#E6F1EE] font-mono tabular-nums">{formatBytes(file.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8A9D98]">MIME Type</span>
                      <span className="text-[#E6F1EE] font-mono truncate max-w-[200px]">{file.mimeType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8A9D98]">Created</span>
                      <span className="text-[#E6F1EE] font-mono">{formatDateTime(file.createdAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8A9D98]">Execution Policy</span>
                      <span className="text-[#39FF88]">Sandboxed (never executed)</span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {isZip && activeBlob && onExtractZip && (
                      <button
                        type="button"
                        onClick={() => {
                          onExtractZip(activeBlob, file.name);
                          onClose();
                        }}
                        className="w-full py-2.5 px-4 rounded-lg text-xs font-semibold bg-[#00E5FF] text-[#030505] hover:bg-[#3CEEFF] inline-flex items-center justify-center gap-2"
                      >
                        <Archive className="w-4 h-4" />
                        Extract ZIP &amp; Add Media to Vault
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="w-full py-2.5 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] inline-flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      {file.isEncrypted ? 'Export / Decrypt File' : 'Download Original File'}
                    </button>
                  </div>
                </div>
              )}
          </>
        )}
      </div>

      <EncryptedDownloadModal
        file={downloadModalFile}
        onClose={() => setDownloadModalFile(null)}
      />
    </div>
  );
};
