import React, { useMemo, useState } from 'react';
import {
  ExternalLink,
  Globe,
  Link2,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatTimestamp, normalizeTagInput } from '../services/fileUtils';
import { resolveBookmarkMetadata } from '../services/urlMetadata';
import { VaultModal } from './Modals';

interface BookmarksViewProps {
  globalSearchQuery: string;
}

export const BookmarksView: React.FC<BookmarksViewProps> = ({ globalSearchQuery }) => {
  const { user, storage, bookmarks, refreshVaultData, addToast } = useVault();

  const [modalOpen, setModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [descInput, setDescInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [brokenFavicons, setBrokenFavicons] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    return [...bookmarks]
      .filter((b) => {
        if (favoritesOnly && !b.isFavorite) return false;
        if (!q) return true;
        return (
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [bookmarks, globalSearchQuery, favoritesOnly]);

  const handleSaveBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError(null);
    setIsSaving(true);

    try {
      const meta = await resolveBookmarkMetadata(urlInput);
      const parsedTags = tagsInput
        .split(',')
        .map(normalizeTagInput)
        .filter(Boolean);

      await storage.createBookmark(user.id, {
        url: meta.url,
        title: titleInput.trim() || meta.title,
        description: descInput.trim() || meta.description,
        faviconUrl: meta.faviconUrl,
        tags: parsedTags,
      });

      await refreshVaultData();
      setUrlInput('');
      setTitleInput('');
      setDescInput('');
      setTagsInput('');
      setModalOpen(false);
      addToast({
        type: 'success',
        title: 'Bookmark saved',
        description: meta.fetchedLive
          ? 'Live page metadata extracted.'
          : 'Saved with domain metadata (CORS fallback).',
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save URL.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">Links</h1>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-0.5">
            Validated URL bookmarks with automatic domain fallback when CORS blocks live metadata.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFavoritesOnly((f) => !f)}
            aria-pressed={favoritesOnly}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border ${
              favoritesOnly
                ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                : 'border-white/15 bg-[#090D0D] text-[#8A9D98] hover:text-[#E6F1EE]'
            }`}
          >
            <Star className="w-3.5 h-3.5" fill={favoritesOnly ? 'currentColor' : 'none'} />
            Favorites
          </button>

          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Bookmark
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-[#090D0D]/80 border border-dashed border-white/15 rounded-xl p-10 text-center max-w-xl mx-auto my-8">
          <div className="w-12 h-12 mx-auto rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/25 flex items-center justify-center text-[#00E5FF] mb-4">
            <Link2 className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-[#E6F1EE]">No saved links yet</h2>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-1.5">
            Archive important URLs, documentation, and references with tags and notes.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="mt-5 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99]"
          >
            Save First Link
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {filtered.map((bm) => {
            const showFallbackIcon = !bm.faviconUrl || brokenFavicons.has(bm.id);
            return (
              <div
                key={bm.id}
                className="bg-[#090D0D] border border-white/10 hover:border-[#00E5FF]/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[#030505] border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {showFallbackIcon ? (
                          <Globe className="w-4 h-4 text-[#00E5FF]" />
                        ) : (
                          <img
                            src={bm.faviconUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenFavicons((prev) => new Set(prev).add(bm.id))
                            }
                            className="w-5 h-5 object-contain"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <a
                          href={bm.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#E6F1EE] hover:text-[#39FF88] truncate block"
                        >
                          {bm.title}
                        </a>
                        <div className="text-[11px] text-[#00E5FF] truncate">{bm.url}</div>
                      </div>
                    </div>

                    <a
                      href={bm.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${bm.title} in new tab`}
                      className="p-1.5 rounded text-[#6E827D] hover:text-[#39FF88] shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  {bm.description && (
                    <p className="text-xs text-[#8A9D98] font-sans-ui line-clamp-2 leading-relaxed">
                      {bm.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-white/5 text-[11px]">
                  <div className="text-[#6E827D] truncate">
                    {formatTimestamp(bm.createdAt)}
                    {bm.tags.length > 0 && (
                      <span className="text-[#00E5FF]"> · {bm.tags.map((t) => `#${t}`).join(' ')}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!user) return;
                        await storage.updateBookmark(user.id, bm.id, { isFavorite: !bm.isFavorite });
                        await refreshVaultData();
                      }}
                      aria-label={`Favorite bookmark ${bm.title}`}
                      className={`p-1 rounded ${bm.isFavorite ? 'text-amber-400' : 'text-[#6E827D] hover:text-[#E6F1EE]'}`}
                    >
                      <Star className="w-3.5 h-3.5" fill={bm.isFavorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!user) return;
                        await storage.deleteBookmarkToTrash(user.id, bm.id);
                        await refreshVaultData();
                        addToast({ type: 'info', title: 'Moved bookmark to Trash' });
                      }}
                      aria-label={`Delete bookmark ${bm.title}`}
                      className="p-1 rounded text-[#6E827D] hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <VaultModal open={modalOpen} title="Save URL Bookmark" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSaveBookmark} className="space-y-4">
          {formError && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/35 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}

          <div>
            <label htmlFor="bm-url" className="block text-xs text-[#A3B5B0] mb-1.5">
              Website URL
            </label>
            <input
              id="bm-url"
              type="text"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/resource"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#E6F1EE]"
            />
          </div>

          <div>
            <label htmlFor="bm-title" className="block text-xs text-[#A3B5B0] mb-1.5">
              Title (optional — auto-resolved if blank)
            </label>
            <input
              id="bm-title"
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Custom bookmark title"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#E6F1EE]"
            />
          </div>

          <div>
            <label htmlFor="bm-desc" className="block text-xs text-[#A3B5B0] mb-1.5">
              Custom Description
            </label>
            <textarea
              id="bm-desc"
              rows={2}
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
              placeholder="Why are you saving this link?"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#E6F1EE]"
            />
          </div>

          <div>
            <label htmlFor="bm-tags" className="block text-xs text-[#A3B5B0] mb-1.5">
              Tags (comma-separated)
            </label>
            <input
              id="bm-tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="security, docs, research"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg px-3 py-2 text-xs text-[#E6F1EE]"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-xs text-[#8A9D98] hover:text-[#E6F1EE] border border-white/10 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50"
            >
              {isSaving ? 'Resolving...' : 'Save Bookmark'}
            </button>
          </div>
        </form>
      </VaultModal>
    </div>
  );
};
