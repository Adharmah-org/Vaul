import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Download,
  Key,
  Keyboard,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatDateTime } from '../services/fileUtils';
import { VaultModal } from './Modals';

export const SettingsView: React.FC = () => {
  const navigate = useNavigate();
  const {
    user,
    session,
    storage,
    preferences,
    updatePreferences,
    refreshVaultData,
    logout,
    addToast,
  } = useVault();

  const importInputRef = useRef<HTMLInputElement | null>(null);

  // Rotate Rooh Key
  const [currentRoohKey, setCurrentRoohKey] = useState('');
  const [rotatedKeyResult, setRotatedKeyResult] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  // Archive export/import
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  // Delete account modal
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteRoohKey, setDeleteRoohKey] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  if (!user || !session) return null;

  const handleRotateRoohKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyBusy(true);
    setRotatedKeyResult(null);
    try {
      const newKey = await storage.rotateRoohKey(user.id, currentRoohKey);
      setCurrentRoohKey('');
      setRotatedKeyResult(newKey);
      addToast({ type: 'success', title: 'Rooh Key rotated successfully' });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Key rotation failed',
        description: err instanceof Error ? err.message : 'Unable to rotate Rooh Key.',
      });
    } finally {
      setKeyBusy(false);
    }
  };

  const handleExportArchive = async () => {
    setExportBusy(true);
    try {
      const archive = await storage.exportArchive(user.id);
      const json = JSON.stringify(archive, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rooh-clouds-archive-${user.username}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      addToast({
        type: 'success',
        title: 'Vault archive exported',
        description: `Exported ${archive.files.length} files, ${archive.folders.length} folders, ${archive.notes.length} notes, and ${archive.bookmarks.length} bookmarks.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Unable to export archive.',
      });
    } finally {
      setExportBusy(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const stats = await storage.importArchive(user.id, parsed);
      await refreshVaultData();
      addToast({
        type: 'success',
        title: 'Archive imported',
        description: `Restored ${stats.importedFiles} files, ${stats.importedFolders} folders, ${stats.importedNotes} notes, and ${stats.importedBookmarks} bookmarks.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Invalid archive JSON file.',
      });
    } finally {
      setImportBusy(false);
    }
  };

  const handleClearCache = async () => {
    await storage.clearCache();
    addToast({
      type: 'info',
      title: 'Transient cache cleared',
      description: 'Expired session records purged. Vault files and notes remain intact.',
    });
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteBusy(true);
    try {
      await storage.deleteAccount(user.id, deleteRoohKey);
      window.location.reload();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Deletion failed',
        description: err instanceof Error ? err.message : 'Invalid Rooh Key.',
      });
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">Settings</h1>
        <p className="text-xs text-[#8A9D98] font-sans-ui mt-0.5">
          Manage your local account, archive backups, interface preferences, and security boundaries.
        </p>
      </div>

      {/* Security Notice */}
      <div className="bg-[#090D0D] border border-[#00E5FF]/30 rounded-xl p-5 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-[#00E5FF] shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs font-sans-ui text-[#A3B5B0] leading-relaxed">
          <h2 className="text-sm font-semibold text-[#E6F1EE] font-mono">
            Local Storage &amp; Authentication Notice
          </h2>
          <p>
            rooh.clouds stores your files, notes, bookmarks, and PBKDF2 credential hashes locally in this browser&apos;s IndexedDB. Client-side authentication protects casual local access on this browser profile, not against someone with direct device or DevTools access. Export backups regularly if you want portable copies.
          </p>
        </div>
      </div>

      {/* Account Info & Session */}
      <section className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <User className="w-4 h-4 text-[#39FF88]" />
            <h2 className="text-sm font-semibold text-[#E6F1EE]">Account Information</h2>
          </div>
          <button
            type="button"
            onClick={async () => {
              navigate('/all', { replace: true });
              await logout();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/15 text-[#E6F1EE] hover:border-[#39FF88]/50"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="bg-[#030505] border border-white/5 rounded-lg p-3">
            <div className="text-[#8A9D98] text-[11px]">Username</div>
            <div className="text-[#E6F1EE] font-semibold mt-1">{user.username}</div>
          </div>
          <div className="bg-[#030505] border border-white/5 rounded-lg p-3">
            <div className="text-[#8A9D98] text-[11px]">Vault UUID</div>
            <div className="text-[#00E5FF] font-mono mt-1 truncate">{user.id}</div>
          </div>
          <div className="bg-[#030505] border border-white/5 rounded-lg p-3">
            <div className="text-[#8A9D98] text-[11px]">Created</div>
            <div className="text-[#E6F1EE] mt-1 tabular-nums">{formatDateTime(user.createdAt)}</div>
          </div>
          <div className="bg-[#030505] border border-white/5 rounded-lg p-3">
            <div className="text-[#8A9D98] text-[11px]">Session Expires</div>
            <div className="text-[#E6F1EE] mt-1 tabular-nums">{formatDateTime(session.expiresAt)}</div>
          </div>
        </div>
      </section>

      {/* Export / Import Archive & Cache */}
      <section className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Download className="w-4 h-4 text-[#39FF88]" />
          <h2 className="text-sm font-semibold text-[#E6F1EE]">Archive Backup &amp; Restore</h2>
        </div>
        <p className="text-xs text-[#8A9D98] font-sans-ui leading-relaxed">
          Export a complete JSON archive including binary file Blobs, folder hierarchy, Markdown notes, bookmarks, and tags. Imported archives are schema-validated before writing to IndexedDB.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={exportBusy}
            onClick={handleExportArchive}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exportBusy ? 'Exporting...' : 'Export Archive'}
          </button>

          <button
            type="button"
            disabled={importBusy}
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-[#00E5FF]/35 bg-[#00E5FF]/10 text-[#00E5FF] rounded-lg hover:bg-[#00E5FF]/20 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {importBusy ? 'Validating & Importing...' : 'Import Archive'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />

          <button
            type="button"
            onClick={handleClearCache}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-white/15 text-[#A3B5B0] rounded-lg hover:text-[#E6F1EE]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Clear Cache
          </button>
        </div>
      </section>

      {/* Theme & Animation Preferences */}
      <section className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-4 h-4 text-[#00E5FF]" />
          <h2 className="text-sm font-semibold text-[#E6F1EE]">Theme &amp; Animation Preferences</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <label className="flex items-center justify-between bg-[#030505] border border-white/10 rounded-lg p-3.5 cursor-pointer">
            <span>Matrix Rain Background (Desktop)</span>
            <input
              type="checkbox"
              checked={preferences.matrixRain}
              onChange={(e) => updatePreferences({ matrixRain: e.target.checked })}
              className="w-4 h-4 accent-[#39FF88]"
            />
          </label>

          <label className="flex items-center justify-between bg-[#030505] border border-white/10 rounded-lg p-3.5 cursor-pointer">
            <span>Terminal Scanlines Overlay</span>
            <input
              type="checkbox"
              checked={preferences.scanlines}
              onChange={(e) => updatePreferences({ scanlines: e.target.checked })}
              className="w-4 h-4 accent-[#39FF88]"
            />
          </label>

          <label className="flex items-center justify-between bg-[#030505] border border-white/10 rounded-lg p-3.5 cursor-pointer">
            <span>Reduced Motion</span>
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={(e) => updatePreferences({ reducedMotion: e.target.checked })}
              className="w-4 h-4 accent-[#39FF88]"
            />
          </label>

          <div className="flex items-center justify-between bg-[#030505] border border-white/10 rounded-lg p-3.5">
            <span>Accent Mode</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => updatePreferences({ accentMode: 'matrix' })}
                className={`px-2.5 py-1 rounded text-[11px] ${
                  preferences.accentMode === 'matrix'
                    ? 'bg-[#39FF88]/20 text-[#39FF88] border border-[#39FF88]/40'
                    : 'text-[#8A9D98]'
                }`}
              >
                Neon Green
              </button>
              <button
                type="button"
                onClick={() => updatePreferences({ accentMode: 'cyan' })}
                className={`px-2.5 py-1 rounded text-[11px] ${
                  preferences.accentMode === 'cyan'
                    ? 'bg-[#00E5FF]/20 text-[#00E5FF] border border-[#00E5FF]/40'
                    : 'text-[#8A9D98]'
                }`}
              >
                Cyber Cyan
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Rotate Rooh Key */}
      <section className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Key className="w-4 h-4 text-[#39FF88]" />
          <h2 className="text-sm font-semibold text-[#E6F1EE]">Rotate Rooh Key</h2>
        </div>
        <p className="text-xs text-[#8A9D98] font-sans-ui">
          Enter your current Rooh Key to generate a brand new secure recovery key.
        </p>

        <form onSubmit={handleRotateRoohKey} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              required
              value={currentRoohKey}
              onChange={(e) => setCurrentRoohKey(e.target.value.toUpperCase())}
              placeholder="ROOH-XXXX-XXXX-XXXX"
              aria-label="Current Rooh Key"
              className="flex-1 bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#00E5FF] tracking-wider"
            />
            <button
              type="submit"
              disabled={keyBusy}
              className="px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] shrink-0"
            >
              {keyBusy ? 'Rotating...' : 'Rotate Key'}
            </button>
          </div>
        </form>

        {rotatedKeyResult && (
          <div className="p-3.5 bg-[#39FF88]/10 border border-[#39FF88]/30 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-[#39FF88]">New Rooh Key Generated Successfully:</p>
            <div className="p-2.5 bg-[#030505] border border-white/15 rounded font-mono text-sm text-[#00E5FF] tracking-wider select-all">
              {rotatedKeyResult}
            </div>
            <p className="text-[11px] text-[#A3B5B0]">Save this key immediately. It will not be shown again.</p>
          </div>
        )}
      </section>

      {/* Keyboard Shortcuts */}
      <section className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <Keyboard className="w-4 h-4 text-[#00E5FF]" />
          <h2 className="text-sm font-semibold text-[#E6F1EE]">Keyboard Shortcuts</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {[
            ['Ctrl / Cmd + K', 'Focus command search bar'],
            ['Ctrl / Cmd + U', 'Upload files'],
            ['Ctrl / Cmd + N', 'Create new note'],
            ['Ctrl / Cmd + Shift + N', 'Create new folder'],
            ['Escape', 'Close active modal or search suggestions'],
          ].map(([key, desc]) => (
            <div
              key={key}
              className="flex items-center justify-between bg-[#030505] border border-white/5 rounded-lg px-3 py-2"
            >
              <span className="text-[#8A9D98] font-sans-ui">{desc}</span>
              <kbd className="px-2 py-0.5 text-[11px] bg-[#0F1515] border border-white/15 rounded text-[#39FF88]">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </section>

      {/* Danger Zone */}
      <section className="bg-[#090D0D] border border-red-500/30 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span>Delete Vault Account</span>
          </div>
          <p className="text-xs text-[#8A9D98] font-sans-ui">
            Permanently erases your user record, files, folders, notes, bookmarks, and trash from storage.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/40 rounded-lg hover:bg-red-500/25 shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Account
        </button>
      </section>

      <VaultModal
        open={deleteOpen}
        title="Confirm Account Deletion"
        onClose={() => setDeleteOpen(false)}
      >
        <form onSubmit={handleDeleteAccount} className="space-y-4">
          <p className="text-xs text-[#A3B5B0] font-sans-ui leading-relaxed">
            This action permanently wipes all vault records for{' '}
            <strong className="text-[#E6F1EE]">{user.username}</strong>. Enter your Rooh Key to confirm.
          </p>
          <input
            type="text"
            required
            value={deleteRoohKey}
            onChange={(e) => setDeleteRoohKey(e.target.value.toUpperCase())}
            placeholder="ROOH-XXXX-XXXX-XXXX"
            aria-label="Rooh Key confirmation"
            className="w-full bg-[#030505] border border-red-500/35 focus:border-red-400 focus:outline-none rounded-lg px-3 py-2 text-xs text-[#00E5FF] tracking-wider"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="px-4 py-2 text-xs text-[#8A9D98] border border-white/10 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleteBusy}
              className="px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
            >
              {deleteBusy ? 'Deleting...' : 'Permanently Delete'}
            </button>
          </div>
        </form>
      </VaultModal>
    </div>
  );
};
