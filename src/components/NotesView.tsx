import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  Check,
  Columns,
  Edit3,
  Eye,
  FilePlus,
  Search,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { countWordsAndChars, formatDateTime, normalizeTagInput } from '../services/fileUtils';
import { NoteRecord } from '../types/vault';

interface NotesViewProps {
  globalSearchQuery: string;
}

export const NotesView: React.FC<NotesViewProps> = ({ globalSearchQuery }) => {
  const { user, storage, notes, refreshVaultData, addToast } = useVault();

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [viewLayout, setViewLayout] = useState<'split' | 'edit' | 'preview'>('split');

  // Editor draft state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');

  const dirtyRef = useRef(false);
  const draftRef = useRef<{ id: string | null; title: string; content: string; tags: string[] }>({
    id: null,
    title: '',
    content: '',
    tags: [],
  });

  const sortedNotes = useMemo(() => {
    const query = (globalSearchQuery || localSearch).trim().toLowerCase();
    return [...notes]
      .filter((n) => {
        if (favoritesOnly && !n.isFavorite) return false;
        if (!query) return true;
        return (
          n.title.toLowerCase().includes(query) ||
          n.content.toLowerCase().includes(query) ||
          n.tags.some((t) => t.toLowerCase().includes(query))
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, globalSearchQuery, localSearch, favoritesOnly]);

  const activeNote: NoteRecord | null = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  // Select first note on initial load if none selected
  useEffect(() => {
    if (!selectedNoteId && sortedNotes.length > 0) {
      const first = sortedNotes[0];
      setSelectedNoteId(first.id);
      setTitle(first.title);
      setContent(first.content);
      setTags(first.tags);
      setSaveState('saved');
      dirtyRef.current = false;
    }
  }, [selectedNoteId, sortedNotes]);

  const flushSave = async (targetId: string, t: string, c: string, tg: string[]) => {
    if (!user || !targetId) return;
    setSaveState('saving');
    try {
      await storage.updateNote(user.id, targetId, {
        title: t.trim() || 'Untitled Note',
        content: c,
        tags: tg,
      });
      dirtyRef.current = false;
      setSaveState('saved');
      await refreshVaultData();
    } catch {
      setSaveState('dirty');
    }
  };

  const selectNote = async (note: NoteRecord) => {
    if (dirtyRef.current && draftRef.current.id && draftRef.current.id !== note.id) {
      await flushSave(
        draftRef.current.id,
        draftRef.current.title,
        draftRef.current.content,
        draftRef.current.tags
      );
    }
    setSelectedNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags);
    setSaveState('saved');
    dirtyRef.current = false;
  };

  // Sync draft ref for debounced autosave
  useEffect(() => {
    draftRef.current = { id: selectedNoteId, title, content, tags };
  }, [selectedNoteId, title, content, tags]);

  // Debounced autosave (550ms)
  useEffect(() => {
    if (!dirtyRef.current || !selectedNoteId) return;
    const timer = setTimeout(() => {
      flushSave(selectedNoteId, title, content, tags);
    }, 550);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, tags, selectedNoteId]);

  // Flush dirty note on unmount to prevent data loss
  useEffect(() => {
    return () => {
      if (dirtyRef.current && draftRef.current.id && user) {
        storage.updateNote(user.id, draftRef.current.id, {
          title: draftRef.current.title.trim() || 'Untitled Note',
          content: draftRef.current.content,
          tags: draftRef.current.tags,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateNote = async () => {
    if (!user) return;
    if (dirtyRef.current && selectedNoteId) {
      await flushSave(selectedNoteId, title, content, tags);
    }
    const created = await storage.createNote(user.id, 'Untitled Note', '# New Note\n\nStart writing...', null);
    await refreshVaultData();
    setSelectedNoteId(created.id);
    setTitle(created.title);
    setContent(created.content);
    setTags(created.tags);
    setSaveState('saved');
    dirtyRef.current = false;
    addToast({ type: 'success', title: 'Created new Markdown note' });
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!user) return;
    dirtyRef.current = false;
    await storage.deleteNoteToTrash(user.id, noteId);
    await refreshVaultData();
    if (selectedNoteId === noteId) {
      setSelectedNoteId(null);
      setTitle('');
      setContent('');
      setTags([]);
    }
    addToast({ type: 'info', title: 'Moved note to Trash' });
  };

  const handleAddTag = () => {
    const clean = normalizeTagInput(tagInput);
    if (clean && !tags.includes(clean)) {
      dirtyRef.current = true;
      setSaveState('dirty');
      setTags([...tags, clean]);
    }
    setTagInput('');
  };

  const counts = useMemo(() => countWordsAndChars(content), [content]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">Notes</h1>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-0.5">
            Autosaving Markdown workspace with live sanitized preview.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCreateNote}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] transition-colors whitespace-nowrap"
        >
          <FilePlus className="w-4 h-4" />
          New Note
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[68vh]">
        {/* Notes List Sidebar */}
        <div className="lg:col-span-4 xl:col-span-3 bg-[#090D0D] border border-white/10 rounded-xl p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#6E827D] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Filter notes..."
                aria-label="Filter notes"
                className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#E6F1EE]"
              />
            </div>
            <button
              type="button"
              onClick={() => setFavoritesOnly((f) => !f)}
              aria-label="Filter favorite notes"
              aria-pressed={favoritesOnly}
              className={`p-2 rounded-lg border ${
                favoritesOnly
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                  : 'border-white/15 bg-[#030505] text-[#8A9D98]'
              }`}
            >
              <Star className="w-3.5 h-3.5" fill={favoritesOnly ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-[56vh]">
            {sortedNotes.length === 0 ? (
              <div className="text-center py-8 px-3 text-xs text-[#6E827D] font-sans-ui">
                No notes yet. Create one to start writing.
              </div>
            ) : (
              sortedNotes.map((note) => {
                const isSelected = note.id === selectedNoteId;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => selectNote(note)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-[#39FF88]/10 border-[#39FF88]/40'
                        : 'bg-[#030505]/70 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#E6F1EE] truncate">
                        {note.title || 'Untitled Note'}
                      </span>
                      {note.isFavorite && (
                        <Star className="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" />
                      )}
                    </div>
                    <p className="text-[11px] text-[#8A9D98] truncate mt-1 font-sans-ui">
                      {note.content.replace(/[#*_`>]/g, '').trim() || 'Empty note'}
                    </p>
                    <div className="text-[10px] text-[#6E827D] mt-1.5 tabular-nums">
                      {formatDateTime(note.updatedAt)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Editor + Preview Workspace */}
        <div className="lg:col-span-8 xl:col-span-9 bg-[#090D0D] border border-white/10 rounded-xl flex flex-col overflow-hidden">
          {!activeNote ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
              <p className="text-sm font-medium text-[#E6F1EE]">Select or create a note</p>
              <p className="text-xs text-[#8A9D98] font-sans-ui mt-1">
                Markdown notes autosave locally into IndexedDB.
              </p>
              <button
                type="button"
                onClick={handleCreateNote}
                className="mt-4 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99]"
              >
                Create First Note
              </button>
            </div>
          ) : (
            <>
              {/* Note Toolbar */}
              <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                <input
                  type="text"
                  value={title}
                  aria-label="Note title"
                  onChange={(e) => {
                    dirtyRef.current = true;
                    setSaveState('dirty');
                    setTitle(e.target.value);
                  }}
                  placeholder="Note title..."
                  className="flex-1 min-w-[180px] bg-transparent text-sm font-bold text-[#E6F1EE] focus:outline-none"
                />

                <div className="flex items-center flex-wrap gap-2">
                  <span
                    data-testid="note-save-status"
                    className="inline-flex items-center gap-1 text-[11px] text-[#8A9D98]"
                  >
                    <Check className={`w-3.5 h-3.5 ${saveState === 'saved' ? 'text-[#39FF88]' : 'text-amber-400'}`} />
                    {saveState === 'saving' ? 'Saving...' : saveState === 'dirty' ? 'Unsaved' : 'Saved'}
                  </span>

                  <div className="flex items-center bg-[#030505] border border-white/10 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewLayout('edit')}
                      aria-label="Editor only"
                      className={`px-2 py-1 text-[11px] rounded inline-flex items-center gap-1 ${
                        viewLayout === 'edit' ? 'bg-[#39FF88]/15 text-[#39FF88]' : 'text-[#8A9D98]'
                      }`}
                    >
                      <Edit3 className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewLayout('split')}
                      aria-label="Split edit and preview"
                      className={`hidden md:inline-flex px-2 py-1 text-[11px] rounded items-center gap-1 ${
                        viewLayout === 'split' ? 'bg-[#39FF88]/15 text-[#39FF88]' : 'text-[#8A9D98]'
                      }`}
                    >
                      <Columns className="w-3 h-3" />
                      Split
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewLayout('preview')}
                      aria-label="Preview only"
                      className={`px-2 py-1 text-[11px] rounded inline-flex items-center gap-1 ${
                        viewLayout === 'preview' ? 'bg-[#39FF88]/15 text-[#39FF88]' : 'text-[#8A9D98]'
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      Preview
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      if (!user) return;
                      await storage.updateNote(user.id, activeNote.id, {
                        isFavorite: !activeNote.isFavorite,
                      });
                      await refreshVaultData();
                    }}
                    aria-label={activeNote.isFavorite ? 'Unfavorite note' : 'Favorite note'}
                    className={`p-1.5 rounded-lg border border-white/10 ${
                      activeNote.isFavorite ? 'text-amber-400 border-amber-400/40' : 'text-[#8A9D98]'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" fill={activeNote.isFavorite ? 'currentColor' : 'none'} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteNote(activeNote.id)}
                    aria-label="Move note to trash"
                    className="p-1.5 rounded-lg border border-white/10 text-[#8A9D98] hover:text-red-400 hover:border-red-500/40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Tags Bar */}
              <div className="px-4 py-2 border-b border-white/5 bg-[#050808] flex flex-wrap items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-[#6E827D]" />
                {tags.map((tg) => (
                  <button
                    key={tg}
                    type="button"
                    onClick={() => {
                      dirtyRef.current = true;
                      setSaveState('dirty');
                      setTags(tags.filter((x) => x !== tg));
                    }}
                    className="text-[11px] text-[#00E5FF] hover:text-red-300 transition-colors"
                    title="Click to remove tag"
                  >
                    #{tg} ×
                  </button>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="+ add tag (Enter)"
                  className="bg-transparent text-[11px] text-[#E6F1EE] placeholder:text-[#4F615C] focus:outline-none min-w-[120px]"
                />
              </div>

              {/* Editor & Preview Split */}
              <div
                className={`flex-1 grid min-h-[380px] ${
                  viewLayout === 'split' ? 'grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10' : 'grid-cols-1'
                }`}
              >
                {viewLayout !== 'preview' && (
                  <textarea
                    value={content}
                    aria-label="Markdown editor"
                    onChange={(e) => {
                      dirtyRef.current = true;
                      setSaveState('dirty');
                      setContent(e.target.value);
                    }}
                    placeholder="Write Markdown here..."
                    className="w-full h-full min-h-[360px] bg-[#030505] p-4 text-xs leading-relaxed text-[#E6F1EE] placeholder:text-[#4F615C] resize-none focus:outline-none font-mono"
                  />
                )}

                {viewLayout !== 'edit' && (
                  <div className="p-5 overflow-y-auto bg-[#070A0A] max-h-[55vh]">
                    <article className="rooh-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                        {content || '*Nothing to preview yet.*'}
                      </ReactMarkdown>
                    </article>
                  </div>
                )}
              </div>

              {/* Footer Stats */}
              <div className="px-4 py-2 border-t border-white/10 bg-[#050808] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8A9D98] tabular-nums">
                <div>
                  {counts.words} {counts.words === 1 ? 'word' : 'words'} · {counts.chars} chars
                </div>
                <div>Modified {formatDateTime(activeNote.updatedAt)}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
