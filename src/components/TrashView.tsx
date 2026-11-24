import React, { useState } from 'react';
import { File, FileText, Folder, Link2, RotateCcw, Trash2 } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatBytes, formatDateTime } from '../services/fileUtils';
import { TrashItemType } from '../types/vault';

function getTrashIcon(type: TrashItemType) {
  switch (type) {
    case 'folder':
      return Folder;
    case 'note':
      return FileText;
    case 'bookmark':
      return Link2;
    default:
      return File;
  }
}

export const TrashView: React.FC = () => {
  const { user, storage, trash, refreshVaultData, addToast } = useVault();
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const handleRestore = async (trashId: string, title: string) => {
    if (!user) return;
    await storage.restoreTrashItem(user.id, trashId);
    await refreshVaultData();
    addToast({ type: 'success', title: `Restored "${title}"` });
  };

  const handleDeleteForever = async (trashId: string, title: string) => {
    if (!user) return;
    await storage.permanentlyDeleteTrashItem(user.id, trashId);
    await refreshVaultData();
    addToast({ type: 'info', title: `Permanently deleted "${title}"` });
  };

  const handleEmptyTrash = async () => {
    if (!user) return;
    await storage.emptyTrash(user.id);
    await refreshVaultData();
    setConfirmEmpty(false);
    addToast({ type: 'info', title: 'Trash emptied permanently' });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">Trash</h1>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-0.5">
            Restore soft-deleted vault items or purge them permanently from IndexedDB.
          </p>
        </div>

        {trash.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmEmpty ? (
              <>
                <button
                  type="button"
                  onClick={handleEmptyTrash}
                  className="px-3.5 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  Confirm Purge All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmEmpty(false)}
                  className="px-3 py-2 text-xs border border-white/15 text-[#A3B5B0] rounded-lg"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmEmpty(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium border border-red-500/35 text-red-300 rounded-lg hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Empty Trash
              </button>
            )}
          </div>
        )}
      </div>

      {trash.length === 0 ? (
        <div className="bg-[#090D0D]/80 border border-dashed border-white/15 rounded-xl p-10 text-center max-w-xl mx-auto my-8">
          <div className="w-12 h-12 mx-auto rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[#8A9D98] mb-4">
            <Trash2 className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-[#E6F1EE]">Trash is empty</h2>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-1.5">
            Deleted files, folders, notes, and bookmarks appear here before permanent removal.
          </p>
        </div>
      ) : (
        <div className="bg-[#090D0D] border border-white/10 rounded-xl divide-y divide-white/5">
          {trash.map((item) => {
            const Icon = getTrashIcon(item.itemType);
            return (
              <div
                key={item.id}
                className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#030505] border border-white/10 flex items-center justify-center text-[#8A9D98] shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#E6F1EE] truncate">{item.title}</div>
                    <div className="text-[11px] text-[#8A9D98] tabular-nums">
                      {item.itemType} · {formatBytes(item.size)} · Deleted {formatDateTime(item.deletedAt)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRestore(item.id, item.title)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#39FF88]/30 bg-[#39FF88]/10 text-[#39FF88] hover:bg-[#39FF88]/20"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteForever(item.id, item.title)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Permanently
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
