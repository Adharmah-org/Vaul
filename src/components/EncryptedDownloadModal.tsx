import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Download,
  FileCode2,
  KeyRound,
  Leaf,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { FileRecord } from '../types/vault';
import { formatBytes } from '../services/fileUtils';
import {
  buildOfflineCapsuleHtml,
  buildRoohCapsuleFromBlob,
  decryptBlobWithRoohKey,
} from '../services/roohCrypto';
import { useVault } from '../context/VaultContext';
import { VaultModal } from './Modals';

interface EncryptedDownloadModalProps {
  file: FileRecord | null;
  onClose: () => void;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const EncryptedDownloadModal: React.FC<EncryptedDownloadModalProps> = ({
  file,
  onClose,
}) => {
  const { addToast, resolveFileBlob } = useVault();
  const [roohKey, setRoohKey] = useState('');
  const [busyAction, setBusyAction] = useState<'capsule' | 'html' | 'decrypt' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (file) {
      setRoohKey('');
      setErrorMsg(null);
      setBusyAction(null);
    }
  }, [file]);

  if (!file || !file.isEncrypted || !file.encryptionMeta) return null;

  const meta = file.encryptionMeta;

  const handleDownloadCapsule = async () => {
    setErrorMsg(null);
    setBusyAction('capsule');
    try {
      const sourceBlob = await resolveFileBlob(file);
      const capsule = await buildRoohCapsuleFromBlob(file.name, sourceBlob, meta);
      const blob = new Blob([JSON.stringify(capsule, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      triggerBlobDownload(blob, `${file.name}.rooh`);
      addToast({
        type: 'success',
        title: `Downloaded ${file.name}.rooh`,
        description: 'Requires your Rooh Key in Rooh Unlocker to open.',
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to build .rooh capsule.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadOfflineHtml = async () => {
    setErrorMsg(null);
    setBusyAction('html');
    try {
      const sourceBlob = await resolveFileBlob(file);
      const capsule = await buildRoohCapsuleFromBlob(file.name, sourceBlob, meta);
      const html = buildOfflineCapsuleHtml(capsule);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      triggerBlobDownload(blob, `${file.name}.rooh.html`);
      addToast({
        type: 'success',
        title: `Downloaded ${file.name}.rooh.html`,
        description: 'Open in any browser offline and enter your Rooh Key to extract.',
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to build offline HTML capsule.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDecryptAndDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusyAction('decrypt');
    try {
      const sourceBlob = await resolveFileBlob(file);
      const plainBlob = await decryptBlobWithRoohKey(sourceBlob, meta, roohKey);
      triggerBlobDownload(plainBlob, file.name);
      addToast({
        type: 'success',
        title: `Decrypted & downloaded ${file.name}`,
        description: 'Plaintext extracted in memory and saved locally.',
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid Rooh Key. Decryption denied.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <VaultModal
      open={Boolean(file)}
      title="Encrypted File Export"
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* File & Cipher Summary */}
        <div className="bg-[#030505] border border-[#39FF88]/25 rounded-lg p-3.5 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#E6F1EE] truncate">
            <Leaf className="w-4 h-4 text-[#39FF88] shrink-0" />
            <span className="truncate">{file.name}</span>
          </div>
          <div className="text-[11px] text-[#8A9D98] tabular-nums truncate">
            {formatBytes(meta.originalSize)} · {meta.algorithm} · {meta.kdf} ({meta.iterations.toLocaleString()} rounds)
          </div>
        </div>

        {/* Option 1 & 2: Sealed Downloads that require Rooh Key after download */}
        <div className="space-y-2.5">
          <div className="text-[11px] text-[#A3B5B0] font-sans-ui">
            Export sealed ciphertext (Rooh Key required after downloading):
          </div>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handleDownloadCapsule}
            className="w-full text-left bg-[#030505] border border-white/15 hover:border-[#39FF88]/50 rounded-lg p-3 transition-colors flex items-start gap-3 disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-[#39FF88]/10 border border-[#39FF88]/25 flex items-center justify-center text-[#39FF88] shrink-0 mt-0.5">
              <Lock className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#E6F1EE]">
                {busyAction === 'capsule' ? 'Packaging .rooh Capsule...' : 'Download .rooh Encrypted Capsule'}
              </div>
              <div className="text-[11px] text-[#8A9D98] font-sans-ui mt-0.5">
                Compact AES-256-GCM capsule unlocked via Rooh Unlocker.
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={handleDownloadOfflineHtml}
            className="w-full text-left bg-[#030505] border border-white/15 hover:border-[#00E5FF]/50 rounded-lg p-3 transition-colors flex items-start gap-3 disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-[#00E5FF]/10 border border-[#00E5FF]/25 flex items-center justify-center text-[#00E5FF] shrink-0 mt-0.5">
              <FileCode2 className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#E6F1EE]">
                {busyAction === 'html' ? 'Building Offline Terminal...' : 'Download Offline .rooh.html Terminal'}
              </div>
              <div className="text-[11px] text-[#8A9D98] font-sans-ui mt-0.5">
                Zero-dependency self-extracting HTML shell. Prompts for your Rooh Key offline in any browser.
              </div>
            </div>
          </button>
        </div>

        {/* Option 3: Decrypt Now with Rooh Key */}
        <form onSubmit={handleDecryptAndDownload} className="pt-3 border-t border-white/10 space-y-3">
          <div className="flex items-center gap-1.5 text-[11px] text-[#A3B5B0] font-sans-ui">
            <ShieldCheck className="w-3.5 h-3.5 text-[#39FF88]" />
            <span>Or decrypt now with your Rooh Key to save plaintext:</span>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/35 rounded-lg px-3 py-2 flex items-start gap-2 text-xs text-red-300"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="relative">
            <KeyRound className="w-4 h-4 text-[#00E5FF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              required
              autoComplete="off"
              aria-label="Rooh Key for decryption download"
              value={roohKey}
              onChange={(e) => setRoohKey(e.target.value.toUpperCase())}
              placeholder="ROOH-XXXX-XXXX-XXXX"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#00E5FF] focus:outline-none rounded-lg pl-9 pr-3.5 py-2.5 text-xs text-[#00E5FF] tracking-wider placeholder:text-[#4F615C]"
            />
          </div>

          <button
            type="submit"
            disabled={busyAction !== null || !roohKey.trim()}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99] disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{busyAction === 'decrypt' ? 'Decrypting...' : 'Decrypt & Download Original'}</span>
          </button>
        </form>
      </div>
    </VaultModal>
  );
};
