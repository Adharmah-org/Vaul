import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Cloud,
  Copy,
  Download,
  HardDrive,
  Key,
  Keyboard,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Trash2,
  Unlink,
  Upload,
  User,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatDateTime } from '../services/fileUtils';
import { deleteDriveFile, listVaultDriveFiles } from '../services/googleDriveStorage';
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
    isSyncingCloud,
    syncVaultNow,
    driveStatus,
    connectDrive,
    disconnectDrive,
    otherLocalFilesCount,
    consolidateLocalFiles,
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

  // Cloud & Google Drive sync
  const [uidCopied, setUidCopied] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [confirmClearDriveOpen, setConfirmClearDriveOpen] = useState(false);
  const [clearDriveBusy, setClearDriveBusy] = useState(false);

  if (!user || !session) return null;

  const handleCopyUid = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      setUidCopied(true);
      addToast({ type: 'success', title: 'Vault UUID copied', description: user.id });
      setTimeout(() => setUidCopied(false), 2200);
    } catch {
      addToast({ type: 'info', title: 'Vault UUID', description: user.id });
    }
  };

  const handleSyncToCloud = async (includeGoogleDrive = false) => {
    try {
      const summary = await syncVaultNow({ includeGoogleDrive });
      if (!summary) return;
      const drivePart =
        summary.syncedDriveFiles > 0 ? ` · ${summary.syncedDriveFiles} backed up to Google Drive` : '';
      const pendingPart =
        summary.largeFilesPendingDrive > 0
          ? ` (${summary.largeFilesPendingDrive} large >10 MB local files need Google Drive connected)`
          : '';
      addToast({
        type: summary.largeFilesPendingDrive > 0 ? 'info' : 'success',
        title: includeGoogleDrive ? 'Cloud & Google Drive sync complete' : 'Cloud sync complete',
        description: `Synced ${summary.syncedFiles} files, ${summary.syncedFolders} folders, ${summary.syncedNotes} notes, and ${summary.syncedBookmarks} bookmarks${drivePart}${pendingPart}.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Sync failed',
        description: err instanceof Error ? err.message : 'Unable to sync to cloud.',
      });
    }
  };

  const handleConnectDrive = async () => {
    setDriveBusy(true);
    setDriveError(null);
    try {
      const status = await connectDrive();
      addToast({
        type: 'success',
        title: 'Google Drive connected',
        description: status.email
          ? `Connected ${status.email} for folder rooh.clouds/${user.id}.`
          : `Google Drive storage connected for folder rooh.clouds/${user.id}.`,
      });
      await handleSyncToCloud(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authorization cancelled or failed.';
      setDriveError(message);
      addToast({
        type: 'error',
        title: 'Google Drive connection failed',
        description: message,
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDisconnectDrive = async () => {
    setDriveBusy(true);
    try {
      await disconnectDrive();
      addToast({
        type: 'info',
        title: 'Google Drive disconnected',
        description: 'Files remain safe in your local vault and Cloud Firestore.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleDeleteDriveBackups = async () => {
    setClearDriveBusy(true);
    try {
      const driveFiles = await listVaultDriveFiles(user.id);
      for (const df of driveFiles) {
        await deleteDriveFile(df.driveFileId);
      }
      setConfirmClearDriveOpen(false);
      addToast({
        type: 'info',
        title: 'Google Drive backups removed',
        description: `Removed ${driveFiles.length} remote backup files from your Google Drive folder.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to clear Google Drive backups',
        description: err instanceof Error ? err.message : 'Unable to remove Google Drive backups.',
      });
    } finally {
      setClearDriveBusy(false);
    }
  };

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
          Manage your vault identity, cross-browser cloud sync, Google Drive storage, backups, and security boundaries.
        </p>
      </div>

      {/* Security Notice */}
      <div className="bg-[#090D0D] border border-[#00E5FF]/30 rounded-xl p-5 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-[#00E5FF] shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs font-sans-ui text-[#A3B5B0] leading-relaxed">
          <h2 className="text-sm font-semibold text-[#E6F1EE] font-mono">
            Hybrid Vault &amp; Authentication Notice
          </h2>
          <p>
            rooh.clouds stores your files locally in IndexedDB for instant offline access and syncs vault records across browsers via Cloud Firestore (up to 10 MB per file) and your optional Google Drive storage for larger local files. Client-side AES-256-GCM encryption keeps sensitive capsules protected by your Rooh Key.
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
          <div className="bg-[#030505] border border-white/5 rounded-lg p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[#8A9D98] text-[11px]">Vault UUID (Cross-Browser ID)</div>
              <div className="text-[#00E5FF] font-mono mt-1 truncate select-all">{user.id}</div>
            </div>
            <button
              type="button"
              onClick={handleCopyUid}
              aria-label="Copy Vault UUID"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20 shrink-0"
            >
              {uidCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{uidCopied ? 'Copied' : 'Copy UID'}</span>
            </button>
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

      {/* Multi-Browser Cloud Sync & Google Drive Storage */}
      <section className="bg-[#090D0D] border border-[#00E5FF]/25 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-4 h-4 text-[#00E5FF]" />
            <h2 className="text-sm font-semibold text-[#E6F1EE]">Multi-Browser Cloud &amp; Drive Sync</h2>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#39FF88]/15 text-[#39FF88] border border-[#39FF88]/30">
            Active
          </span>
        </div>
        <p className="text-xs text-[#8A9D98] font-sans-ui leading-relaxed">
          Sign in on any browser with your Username or Vault UUID (<code className="text-[#00E5FF]">{user.id}</code>) and Rooh Key to access your synced files, folders, notes, and bookmarks. Files up to 10 MB sync automatically to Cloud Firestore; connect Google Drive below for large local files (&gt;10 MB) and full backup.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isSyncingCloud}
            onClick={() => handleSyncToCloud(false)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-[#00E5FF]/15 text-[#00E5FF] border border-[#00E5FF]/35 rounded-lg hover:bg-[#00E5FF]/25 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`} />
            {isSyncingCloud ? 'Syncing Vault...' : 'Sync Local Vault to Cloud Now'}
          </button>
        </div>

        {otherLocalFilesCount > 0 && (
          <div className="bg-[#030505] border border-[#39FF88]/30 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs font-sans-ui text-[#A3B5B0]">
              Found <strong className="text-[#39FF88]">{otherLocalFilesCount}</strong> locally saved{' '}
              {otherLocalFilesCount === 1 ? 'file' : 'files'} from another local browser profile. Link them into{' '}
              <code className="text-[#00E5FF]">{user.id}</code> so they sync across all browsers.
            </div>
            <button
              type="button"
              disabled={isSyncingCloud}
              onClick={async () => {
                try {
                  const moved = await consolidateLocalFiles();
                  addToast({
                    type: 'success',
                    title: 'Local files linked to Vault UID',
                    description: `Linked ${moved} local files into ${user.id} and synced to cloud.`,
                  });
                } catch (err) {
                  addToast({
                    type: 'error',
                    title: 'Failed to link local files',
                    description: err instanceof Error ? err.message : 'Unable to link local files.',
                  });
                }
              }}
              className="px-3 py-1.5 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50 shrink-0"
            >
              Link &amp; Sync Local Files
            </button>
          </div>
        )}

        {/* Google Drive Storage Card */}
        <div className="bg-[#030505] border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[#39FF88]" />
              <span className="text-xs font-semibold text-[#E6F1EE]">
                Google Drive Storage (Large Files &amp; Cross-Browser Backup)
              </span>
            </div>
            {driveStatus.connected ? (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#39FF88]/15 text-[#39FF88] border border-[#39FF88]/30">
                Connected{driveStatus.email ? `: ${driveStatus.email}` : ''}
              </span>
            ) : (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-[#8A9D98] border border-white/10">
                Not connected
              </span>
            )}
          </div>

          <p className="text-[11px] text-[#8A9D98] font-sans-ui leading-relaxed">
            Connect your Google account inside Settings to back up locally saved files of any size into a dedicated <code className="text-[#E6F1EE]">rooh.clouds/{user.id}</code> folder on Google Drive. Access tokens remain strictly in memory for this session.
          </p>

          {driveError && (
            <div
              role="alert"
              className="bg-red-500/10 border border-red-500/35 rounded-lg p-3 text-[11px] text-red-300 font-sans-ui leading-relaxed break-words"
            >
              {driveError}
            </div>
          )}

          {!driveStatus.connected ? (
            <button
              type="button"
              disabled={driveBusy}
              onClick={handleConnectDrive}
              className="inline-flex items-center gap-2.5 px-4 py-2 rounded-lg bg-white text-[#1f1f1f] hover:bg-gray-100 text-xs font-medium shadow-sm disabled:opacity-60 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-8.97z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                />
              </svg>
              <span>{driveBusy ? 'Connecting Google Drive...' : 'Sign in with Google'}</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={isSyncingCloud || driveBusy}
                onClick={() => handleSyncToCloud(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {isSyncingCloud ? 'Backing up to Drive...' : 'Backup All Vault Files to Google Drive'}
              </button>
              <button
                type="button"
                disabled={driveBusy}
                onClick={handleDisconnectDrive}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-white/15 text-[#E6F1EE] rounded-lg hover:border-white/30"
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </button>
              <button
                type="button"
                disabled={driveBusy || clearDriveBusy}
                onClick={() => setConfirmClearDriveOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-red-500/35 text-red-300 rounded-lg hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Drive Backups
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Export / Import Archive & Cache */}
      <section className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Download className="w-4 h-4 text-[#39FF88]" />
          <h2 className="text-sm font-semibold text-[#E6F1EE]">Archive Backup &amp; Restore</h2>
        </div>
        <p className="text-xs text-[#8A9D98] font-sans-ui leading-relaxed">
          Export a complete JSON archive including your Vault UUID, binary file Blobs, folder hierarchy, Markdown notes, bookmarks, and tags. Imported archives are schema-validated before writing to IndexedDB.
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
            Permanently erases your user record, files, folders, notes, bookmarks, and trash from local and cloud storage.
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

      {/* Confirm Delete Drive Backups Modal */}
      <VaultModal
        open={confirmClearDriveOpen}
        title="Confirm Google Drive Backup Deletion"
        onClose={() => setConfirmClearDriveOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-xs text-[#A3B5B0] font-sans-ui leading-relaxed">
            Are you sure you want to delete all backed-up files for vault{' '}
            <code className="text-[#00E5FF]">{user.id}</code> from your Google Drive <code className="text-[#E6F1EE]">rooh.clouds</code> folder? Local IndexedDB files will not be deleted.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmClearDriveOpen(false)}
              className="px-4 py-2 text-xs text-[#8A9D98] border border-white/10 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={clearDriveBusy}
              onClick={handleDeleteDriveBackups}
              className="px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
            >
              {clearDriveBusy ? 'Removing...' : 'Delete Drive Backups'}
            </button>
          </div>
        </div>
      </VaultModal>

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
