import React from 'react';
import { CheckCircle2, FileUp, Leaf, X, XCircle } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatBytes } from '../services/fileUtils';

export const UploadProgressTray: React.FC = () => {
  const { uploadTasks, cancelUpload, dismissUploadTask } = useVault();

  if (uploadTasks.length === 0) return null;

  return (
    <div
      aria-label="Upload queue"
      className="fixed bottom-20 md:bottom-5 left-4 md:left-[272px] z-40 w-[calc(100vw-2rem)] max-w-sm bg-[#0A0E0E]/95 backdrop-blur-md border border-[#39FF88]/25 rounded-xl shadow-2xl overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#E6F1EE]">
          <FileUp className="w-3.5 h-3.5 text-[#39FF88]" />
          <span>Uploads ({uploadTasks.length})</span>
        </div>
        <button
          type="button"
          onClick={() => uploadTasks.forEach((t) => t.status !== 'uploading' && dismissUploadTask(t.id))}
          className="text-[11px] text-[#8A9D98] hover:text-[#E6F1EE]"
        >
          Clear Finished
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
        {uploadTasks.map((task) => (
          <div key={task.id} className="px-4 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {task.isEncrypted && <Leaf className="w-3.5 h-3.5 text-[#39FF88] shrink-0" />}
                <span className="text-xs text-[#E6F1EE] truncate">{task.fileName}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-[#8A9D98] tabular-nums">
                  {formatBytes(task.size)}
                </span>
                {task.status === 'uploading' || task.status === 'queued' ? (
                  <button
                    type="button"
                    onClick={() => cancelUpload(task.id)}
                    aria-label={`Cancel upload ${task.fileName}`}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => dismissUploadTask(task.id)}
                    aria-label={`Dismiss ${task.fileName}`}
                    className="text-[#6E827D] hover:text-[#E6F1EE]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {task.status === 'uploading' || task.status === 'queued' ? (
              <div className="w-full h-1.5 bg-[#030505] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#39FF88] transition-all duration-150"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            ) : task.status === 'completed' ? (
              <div className="flex items-center gap-1.5 text-[11px] text-[#39FF88]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {task.isEncrypted ? 'Encrypted (AES-256-GCM) · Stored' : 'Stored in IndexedDB'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                <XCircle className="w-3.5 h-3.5" />
                <span>{task.error || task.status}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
