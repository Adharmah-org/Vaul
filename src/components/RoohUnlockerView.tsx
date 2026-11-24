import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileUp,
  KeyRound,
  Leaf,
  Lock,
  Unlock,
} from 'lucide-react';
import { RoohCapsuleV1 } from '../types/vault';
import { formatBytes, formatDateTime, isMarkdownFile, isTextPreviewable } from '../services/fileUtils';
import { decryptRoohCapsule, parseRoohCapsule } from '../services/roohCrypto';

interface RoohUnlockerViewProps {
  compact?: boolean;
}

export const RoohUnlockerView: React.FC<RoohUnlockerViewProps> = ({ compact = false }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [capsule, setCapsule] = useState<RoohCapsuleV1 | null>(null);
  const [capsuleFilename, setCapsuleFilename] = useState<string>('');
  const [roohKey, setRoohKey] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [unlockedFile, setUnlockedFile] = useState<{
    blob: Blob;
    fileName: string;
    mimeType: string;
    objectUrl: string;
    textContent: string | null;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (unlockedFile?.objectUrl) {
        URL.revokeObjectURL(unlockedFile.objectUrl);
      }
    };
  }, [unlockedFile]);

  const resetUnlocked = () => {
    setUnlockedFile((prev) => {
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
  };

  const loadCapsuleFile = async (file: File) => {
    setErrorMsg(null);
    resetUnlocked();
    try {
      const text = await file.text();
      const parsed = parseRoohCapsule(text);
      setCapsule(parsed);
      setCapsuleFilename(file.name);
    } catch (err) {
      setCapsule(null);
      setCapsuleFilename('');
      setErrorMsg(err instanceof Error ? err.message : 'Unable to parse .rooh capsule.');
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!capsule) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const result = await decryptRoohCapsule(capsule, roohKey);
      const objectUrl = URL.createObjectURL(result.blob);
      let textContent: string | null = null;
      if (isTextPreviewable(result.mimeType, result.fileName) && result.blob.size <= 1024 * 1024) {
        textContent = await result.blob.text();
      }
      setUnlockedFile({
        blob: result.blob,
        fileName: result.fileName,
        mimeType: result.mimeType,
        objectUrl,
        textContent,
      });
    } catch (err) {
      resetUnlocked();
      setErrorMsg(err instanceof Error ? err.message : 'ACCESS DENIED — Invalid Rooh Key.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadOriginal = () => {
    if (!unlockedFile) return;
    const a = document.createElement('a');
    a.href = unlockedFile.objectUrl;
    a.download = unlockedFile.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isImage = unlockedFile?.mimeType.startsWith('image/');
  const isVideo = unlockedFile?.mimeType.startsWith('video/');
  const isAudio = unlockedFile?.mimeType.startsWith('audio/');
  const isPdf = unlockedFile?.mimeType === 'application/pdf' || unlockedFile?.fileName.toLowerCase().endsWith('.pdf');
  const isMd = unlockedFile ? isMarkdownFile(unlockedFile.mimeType, unlockedFile.fileName) : false;

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6 max-w-3xl mx-auto'}>
      {!compact && (
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">Rooh Unlocker</h1>
            <Leaf className="w-4 h-4 text-[#39FF88]" />
          </div>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-1">
            Decrypt downloaded <code className="text-[#00E5FF]">.rooh</code> capsules offline using your Rooh Key.
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".rooh,application/json"
        aria-label="Select .rooh capsule file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadCapsuleFile(file);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Capsule Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) void loadCapsuleFile(dropped);
        }}
        className={`bg-[#090D0D] border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          isDragging
            ? 'border-[#39FF88] bg-[#39FF88]/5'
            : capsule
            ? 'border-[#39FF88]/40'
            : 'border-white/15 hover:border-[#00E5FF]/50'
        }`}
      >
        <div className="w-10 h-10 mx-auto rounded-lg bg-[#39FF88]/10 border border-[#39FF88]/25 flex items-center justify-center text-[#39FF88] mb-3">
          {capsule ? <Lock className="w-5 h-5" /> : <FileUp className="w-5 h-5" />}
        </div>

        {capsule ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#E6F1EE] break-all">
              {capsule.fileName}
            </div>
            <div className="text-[11px] text-[#8A9D98] tabular-nums">
              {formatBytes(capsule.originalSize)} · {capsule.algorithm} · Capsule: {capsuleFilename}
            </div>
            <div className="text-[11px] text-[#6E827D] tabular-nums">
              Encrypted {formatDateTime(capsule.encryptedAt)}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#E6F1EE]">
              Drop a downloaded .rooh capsule here
            </div>
            <div className="text-[11px] text-[#8A9D98] font-sans-ui">
              All decryption runs locally via Web Crypto PBKDF2-SHA256 + AES-256-GCM
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-white/15 bg-[#030505] text-[#E6F1EE] hover:border-[#39FF88]/50 whitespace-nowrap"
        >
          <FileUp className="w-3.5 h-3.5 text-[#39FF88]" />
          <span>{capsule ? 'Load Another .rooh File' : 'Select .rooh File'}</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/35 rounded-lg px-4 py-3 flex items-start gap-2.5 text-xs text-red-300"
        >
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Rooh Key Gate */}
      {capsule && !unlockedFile && (
        <form
          onSubmit={handleUnlock}
          className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-4"
        >
          <div>
            <label
              htmlFor="unlocker-rooh-key"
              className="block text-xs font-medium text-[#A3B5B0] mb-1.5"
            >
              Enter Rooh Key to Unlock Capsule
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-[#00E5FF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="unlocker-rooh-key"
                type="text"
                required
                autoComplete="off"
                value={roohKey}
                onChange={(e) => setRoohKey(e.target.value.toUpperCase())}
                placeholder="ROOH-XXXX-XXXX-XXXX"
                className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg pl-9 pr-3.5 py-2.5 text-sm text-[#00E5FF] tracking-wider placeholder:text-[#4F615C]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || !roohKey.trim()}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] disabled:opacity-50 whitespace-nowrap"
          >
            <Unlock className="w-4 h-4" />
            <span>{busy ? 'Decrypting Ciphertext...' : 'Unlock & Decrypt Capsule'}</span>
          </button>
        </form>
      )}

      {/* Unlocked Result + Inline Preview */}
      {unlockedFile && (
        <div className="bg-[#090D0D] border border-[#39FF88]/35 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-[#39FF88] shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#E6F1EE] truncate">
                  {unlockedFile.fileName}
                </div>
                <div className="text-[11px] text-[#8A9D98] tabular-nums">
                  {formatBytes(unlockedFile.blob.size)} · {unlockedFile.mimeType} · Decrypted in memory
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadOriginal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save Original File</span>
            </button>
          </div>

          {isImage && (
            <div className="bg-[#030505] border border-white/10 rounded-lg p-3 flex justify-center">
              <img
                src={unlockedFile.objectUrl}
                alt={unlockedFile.fileName}
                className="max-h-72 object-contain rounded"
              />
            </div>
          )}

          {isVideo && (
            <video
              src={unlockedFile.objectUrl}
              controls
              className="w-full max-h-72 rounded-lg border border-white/10 bg-black"
            />
          )}

          {isAudio && <audio src={unlockedFile.objectUrl} controls className="w-full" />}

          {isPdf && (
            <iframe
              title={`Decrypted PDF: ${unlockedFile.fileName}`}
              src={unlockedFile.objectUrl}
              className="w-full h-72 rounded-lg border border-white/10 bg-white"
            />
          )}

          {!isPdf && unlockedFile.textContent !== null && (
            <div className="bg-[#030505] border border-white/10 rounded-lg p-4 max-h-72 overflow-auto">
              {isMd ? (
                <article className="rooh-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {unlockedFile.textContent}
                  </ReactMarkdown>
                </article>
              ) : (
                <pre className="text-xs text-[#D6E4E0] leading-relaxed whitespace-pre-wrap break-words font-mono">
                  {unlockedFile.textContent}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
