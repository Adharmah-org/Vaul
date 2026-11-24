import React, { useEffect, useState } from 'react';
import { Folder, Tag, X } from 'lucide-react';
import { FolderRecord } from '../types/vault';
import { normalizeTagInput } from '../services/fileUtils';

interface BaseModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const VaultModal: React.FC<BaseModalProps> = ({ open, title, onClose, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[#0A0E0E] border border-white/15 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-sm font-semibold text-[#E6F1EE]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="p-1 rounded text-[#6E827D] hover:text-[#E6F1EE] hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 max-h-[82vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

interface TextPromptModalProps {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void> | void;
}

export const TextPromptModal: React.FC<TextPromptModalProps> = ({
  open,
  title,
  label,
  initialValue = '',
  placeholder,
  submitLabel,
  onClose,
  onSubmit,
}) => {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <VaultModal open={open} title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="prompt-modal-input" className="block text-xs text-[#A3B5B0] mb-1.5">
            {label}
          </label>
          <input
            id="prompt-modal-input"
            autoFocus
            type="text"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3.5 py-2.5 text-sm text-[#E6F1EE]"
          />
        </div>
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#8A9D98] hover:text-[#E6F1EE] rounded-lg border border-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50"
          >
            {busy ? 'Saving...' : submitLabel}
          </button>
        </div>
      </form>
    </VaultModal>
  );
};

interface MoveFolderModalProps {
  open: boolean;
  title: string;
  folders: FolderRecord[];
  excludeFolderIds?: Set<string>;
  currentFolderId: string | null;
  onClose: () => void;
  onMove: (targetFolderId: string | null) => Promise<void>;
}

export const MoveFolderModal: React.FC<MoveFolderModalProps> = ({
  open,
  title,
  folders,
  excludeFolderIds,
  currentFolderId,
  onClose,
  onMove,
}) => {
  const [selected, setSelected] = useState<string | null>(currentFolderId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setSelected(currentFolderId);
  }, [open, currentFolderId]);

  const selectable = folders.filter((f) => !excludeFolderIds?.has(f.id));

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onMove(selected);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <VaultModal open={open} title={title} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-[#8A9D98] font-sans-ui">
          Select destination directory:
        </p>
        <div className="max-h-60 overflow-y-auto border border-white/10 rounded-lg divide-y divide-white/5 bg-[#030505]">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors ${
              selected === null ? 'bg-[#39FF88]/15 text-[#39FF88]' : 'text-[#E6F1EE] hover:bg-white/5'
            }`}
          >
            <Folder className="w-4 h-4 shrink-0" />
            <span>Vault Root (/)</span>
          </button>
          {selectable.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelected(folder.id)}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors ${
                selected === folder.id
                  ? 'bg-[#39FF88]/15 text-[#39FF88]'
                  : 'text-[#E6F1EE] hover:bg-white/5'
              }`}
            >
              <Folder className="w-4 h-4 shrink-0" />
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#8A9D98] hover:text-[#E6F1EE] rounded-lg border border-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleConfirm}
            className="px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50"
          >
            {busy ? 'Moving...' : 'Move Here'}
          </button>
        </div>
      </div>
    </VaultModal>
  );
};

interface TagEditorModalProps {
  open: boolean;
  itemName: string;
  initialTags: string[];
  onClose: () => void;
  onSave: (tags: string[]) => Promise<void>;
}

export const TagEditorModal: React.FC<TagEditorModalProps> = ({
  open,
  itemName,
  initialTags,
  onClose,
  onSave,
}) => {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTags(initialTags);
      setInput('');
    }
  }, [open, initialTags]);

  const addTag = () => {
    const clean = normalizeTagInput(input);
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
    }
    setInput('');
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave(tags);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <VaultModal open={open} title={`Tags for "${itemName}"`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add tag (e.g. secret, archive)"
            className="flex-1 bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#E6F1EE]"
          />
          <button
            type="button"
            onClick={addTag}
            className="px-3.5 py-2 text-xs font-medium bg-[#00E5FF]/15 text-[#00E5FF] border border-[#00E5FF]/30 rounded-lg hover:bg-[#00E5FF]/25"
          >
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-2 min-h-[2rem]">
          {tags.length === 0 ? (
            <span className="text-xs text-[#6E827D] font-sans-ui">No tags assigned.</span>
          ) : (
            tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#030505] border border-white/15 text-[#39FF88] rounded-md hover:border-red-400/50 hover:text-red-300 transition-colors"
                title="Click to remove tag"
              >
                <Tag className="w-3 h-3" />
                <span>{tag}</span>
                <X className="w-3 h-3" />
              </button>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#8A9D98] hover:text-[#E6F1EE] rounded-lg border border-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSave}
            className="px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save Tags'}
          </button>
        </div>
      </div>
    </VaultModal>
  );
};
