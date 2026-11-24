import React, { useEffect, useState } from 'react';
import { AlertCircle, KeyRound, Leaf, Lock } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { VaultModal } from './Modals';

export const ArmEncryptedModal: React.FC = () => {
  const {
    armEncryptedModalOpen,
    setArmEncryptedModalOpen,
    armEncryptedMode,
    pendingEncryptedUploadCount,
    clearPendingEncryptedUpload,
  } = useVault();

  const [roohKeyInput, setRoohKeyInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (armEncryptedModalOpen) {
      setRoohKeyInput('');
      setErrorMsg(null);
    }
  }, [armEncryptedModalOpen]);

  const handleClose = () => {
    clearPendingEncryptedUpload();
    setArmEncryptedModalOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      await armEncryptedMode(roohKeyInput);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to arm Encrypted Mode.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <VaultModal
      open={armEncryptedModalOpen}
      title="Arm Encrypted Upload Mode"
      onClose={handleClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-[#030505] border border-[#39FF88]/25 rounded-lg p-3.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#39FF88]/10 border border-[#39FF88]/30 flex items-center justify-center text-[#39FF88] shrink-0">
            <Leaf className="w-4 h-4" />
          </div>
          <div className="text-xs text-[#A3B5B0] font-sans-ui leading-relaxed">
            <div className="font-semibold text-[#E6F1EE] mb-0.5">
              Zero-Storage Session Key Verification
            </div>
            Your Rooh Key stays strictly in RAM for this tab session and is never written to browser storage. Enter it to derive AES-256-GCM encryption keys.
            {pendingEncryptedUploadCount > 0 && (
              <div className="mt-1.5 text-[#39FF88] font-mono">
                {pendingEncryptedUploadCount}{' '}
                {pendingEncryptedUploadCount === 1 ? 'file queued' : 'files queued'} for encrypted upload.
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="bg-red-500/10 border border-red-500/35 rounded-lg px-3.5 py-2.5 flex items-start gap-2 text-xs text-red-300"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div>
          <label
            htmlFor="arm-encrypted-rooh-key"
            className="block text-xs font-medium text-[#A3B5B0] mb-1.5"
          >
            Rooh Key
          </label>
          <div className="relative">
            <KeyRound className="w-4 h-4 text-[#00E5FF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="arm-encrypted-rooh-key"
              type="text"
              autoFocus
              required
              autoComplete="off"
              value={roohKeyInput}
              onChange={(e) => setRoohKeyInput(e.target.value.toUpperCase())}
              placeholder="ROOH-XXXX-XXXX-XXXX"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg pl-9 pr-3.5 py-2.5 text-sm text-[#00E5FF] tracking-wider placeholder:text-[#4F615C]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-xs font-medium text-[#8A9D98] hover:text-[#E6F1EE] rounded-lg border border-white/10 whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !roohKeyInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50 whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{busy ? 'Verifying...' : 'Arm Encrypted Mode'}</span>
          </button>
        </div>
      </form>
    </VaultModal>
  );
};
