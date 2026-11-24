import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FilePlus,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Image as ImageIcon,
  Leaf,
  Link2,
  LogOut,
  Menu,
  Search,
  Settings,
  Star,
  Terminal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatBytes } from '../services/fileUtils';
import { DockSection } from '../types/vault';
import { AnalyticsView } from './AnalyticsView';
import { ArmEncryptedModal } from './ArmEncryptedModal';
import { BookmarksView } from './BookmarksView';
import { FileExplorerView } from './FileExplorerView';
import { TextPromptModal } from './Modals';
import { NotesView } from './NotesView';
import { PrivateBrowserView } from './PrivateBrowserView';
import { SettingsView } from './SettingsView';
import { TrashView } from './TrashView';
import { UploadProgressTray } from './UploadProgressTray';

interface DockItem {
  id: DockSection;
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DOCK_ITEMS: DockItem[] = [
  { id: 'all', label: 'All Files', path: '/all', icon: FolderOpen },
  { id: 'images', label: 'Images', path: '/images', icon: ImageIcon },
  { id: 'videos', label: 'Videos', path: '/videos', icon: Film },
  { id: 'documents', label: 'Documents', path: '/documents', icon: FileText },
  { id: 'links', label: 'Links', path: '/links', icon: Link2 },
  { id: 'browser', label: 'Private Browser', path: '/browser', icon: Globe },
  { id: 'notes', label: 'Notes', path: '/notes', icon: FilePlus },
  { id: 'favorites', label: 'Favorites', path: '/favorites', icon: Star },
  { id: 'trash', label: 'Trash', path: '/trash', icon: Trash2 },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Settings },
];

export const HackerDockShell: React.FC = () => {
  const {
    user,
    storage,
    files,
    folders,
    notes,
    bookmarks,
    tags,
    trash,
    preferences,
    encryptedUploadMode,
    setEncryptedUploadMode,
    uploadFiles,
    refreshVaultData,
    logout,
    addToast,
    otherLocalFilesCount,
    consolidateLocalFiles,
    isSyncingCloud,
  } = useVault();

  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeSection: DockSection = useMemo(() => {
    const seg = location.pathname.replace(/^\/+/, '').split('/')[0] as DockSection;
    const valid: DockSection[] = [
      'all',
      'images',
      'videos',
      'documents',
      'links',
      'browser',
      'notes',
      'favorites',
      'trash',
      'analytics',
      'settings',
    ];
    return valid.includes(seg) ? seg : 'all';
  }, [location.pathname]);

  const accentText = preferences.accentMode === 'cyan' ? 'text-[#00E5FF]' : 'text-[#39FF88]';
  const accentBg = preferences.accentMode === 'cyan' ? 'bg-[#00E5FF]/15 border-[#00E5FF]/40 text-[#00E5FF]' : 'bg-[#39FF88]/15 border-[#39FF88]/40 text-[#39FF88]';

  // Total vault bytes for sidebar meter
  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + f.size, 0),
    [files]
  );

  // Search suggestions across files, notes, bookmarks, folders, tags
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: { id: string; label: string; kind: string; targetPath: string; folderId?: string | null }[] = [];

    for (const f of files) {
      if (f.name.toLowerCase().includes(q) || f.tags.some((t) => t.includes(q))) {
        results.push({ id: `f-${f.id}`, label: f.name, kind: 'file', targetPath: '/all' });
      }
      if (results.length >= 6) break;
    }
    for (const d of folders) {
      if (d.name.toLowerCase().includes(q)) {
        results.push({ id: `d-${d.id}`, label: d.name, kind: 'folder', targetPath: '/all', folderId: d.id });
      }
      if (results.length >= 8) break;
    }
    for (const n of notes) {
      if (n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) {
        results.push({ id: `n-${n.id}`, label: n.title, kind: 'note', targetPath: '/notes' });
      }
      if (results.length >= 10) break;
    }
    for (const b of bookmarks) {
      if (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) {
        results.push({ id: `b-${b.id}`, label: b.title, kind: 'link', targetPath: '/links' });
      }
      if (results.length >= 12) break;
    }
    for (const t of tags) {
      if (t.name.includes(q)) {
        results.push({ id: `t-${t.id}`, label: `#${t.name}`, kind: 'tag', targetPath: '/all' });
      }
    }
    return results.slice(0, 8);
  }, [searchQuery, files, folders, notes, bookmarks, tags]);

  const handleQuickNewNote = async () => {
    if (!user) return;
    await storage.createNote(user.id, 'Untitled Note', '# New Note\n\n', null);
    await refreshVaultData();
    navigate('/notes');
    addToast({ type: 'success', title: 'Created new note' });
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (mod && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        fileInputRef.current?.click();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewFolderOpen(true);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleQuickNewNote();
      } else if (e.key === 'Escape') {
        setSearchFocused(false);
        setMobileDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const renderSidebarNav = (isMobile = false) => (
    <div className="flex flex-col h-full justify-between">
      <div className="space-y-1.5">
        {DOCK_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          const badgeCount =
            item.id === 'trash' && trash.length > 0
              ? trash.length
              : item.id === 'notes' && notes.length > 0
              ? notes.length
              : null;

          return (
            <button
              key={item.id}
              type="button"
              title={sidebarCollapsed && !isMobile ? item.label : undefined}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                navigate(item.path);
                if (item.id === 'all') setCurrentFolderId(null);
                setMobileDrawerOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap ${
                isActive
                  ? accentBg
                  : 'border-transparent text-[#8A9D98] hover:text-[#E6F1EE] hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                {(!sidebarCollapsed || isMobile) && <span className="truncate">{item.label}</span>}
              </div>
              {(!sidebarCollapsed || isMobile) && badgeCount !== null && (
                <span className="text-[11px] text-[#6E827D] tabular-nums">{badgeCount}</span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          title={sidebarCollapsed && !isMobile ? 'Analytics' : undefined}
          aria-label="Storage Analytics"
          aria-current={activeSection === 'analytics' ? 'page' : undefined}
          onClick={() => {
            navigate('/analytics');
            setMobileDrawerOpen(false);
          }}
          className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap ${
            activeSection === 'analytics'
              ? accentBg
              : 'border-transparent text-[#8A9D98] hover:text-[#E6F1EE] hover:bg-white/[0.04]'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <BarChart3 className="w-4 h-4 shrink-0" />
            {(!sidebarCollapsed || isMobile) && <span className="truncate">Analytics</span>}
          </div>
        </button>
      </div>

      {/* Bottom Storage Summary & Operator */}
      <div className="pt-4 border-t border-white/10 space-y-3">
        {(!sidebarCollapsed || isMobile) && (
          <button
            type="button"
            onClick={() => {
              navigate('/analytics');
              setMobileDrawerOpen(false);
            }}
            className="w-full text-left bg-[#030505] border border-white/10 hover:border-[#39FF88]/30 rounded-lg p-3 transition-colors"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#8A9D98]">Local Vault Used</span>
              <span className={`${accentText} tabular-nums font-semibold`}>
                {formatBytes(totalBytes)}
              </span>
            </div>
            <div className="text-[10px] text-[#6E827D] mt-1 tabular-nums">
              {files.length} files · {folders.length} folders
            </div>
          </button>
        )}

        <div className="flex items-center justify-between gap-2 px-1">
          {(!sidebarCollapsed || isMobile) && (
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#E6F1EE] truncate">{user?.username}</div>
              <div className="text-[10px] text-[#6E827D]">Local IndexedDB</div>
            </div>
          )}
          <button
            type="button"
            onClick={async () => {
              navigate('/all', { replace: true });
              await logout();
            }}
            title="Lock & Logout"
            aria-label="Logout"
            className="p-2 rounded-lg text-[#8A9D98] hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative z-10 min-h-screen flex flex-col md:flex-row bg-transparent">
      {/* Hidden Multi-File Upload Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            await uploadFiles(e.target.files, activeSection === 'all' ? currentFolderId : null);
          }
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Desktop Left Dock Sidebar */}
      <aside
        aria-label="Hacker Dock Navigation"
        className={`hidden md:flex flex-col shrink-0 bg-[#070A0A]/95 backdrop-blur-md border-r border-white/10 transition-all duration-200 ${
          sidebarCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="h-16 px-4 border-b border-white/10 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/all')}
            className="flex items-center gap-2.5 min-w-0 text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-[#39FF88]/10 border border-[#39FF88]/30 flex items-center justify-center text-[#39FF88] shrink-0">
              <Terminal className="w-4 h-4" />
            </div>
            {!sidebarCollapsed && (
              <span className="text-sm font-bold text-[#E6F1EE] tracking-tight truncate">
                rooh.clouds
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-[#6E827D] hover:text-[#E6F1EE] hover:bg-white/5"
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex-1 p-3 overflow-y-auto">{renderSidebarNav(false)}</div>
      </aside>

      {/* Mobile Slide-out Drawer */}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setMobileDrawerOpen(false)}
            />
            <motion.aside
              initial={preferences.reducedMotion ? { x: 0 } : { x: -260 }}
              animate={{ x: 0 }}
              exit={preferences.reducedMotion ? { opacity: 0 } : { x: -260 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 w-64 max-w-[80vw] bg-[#070A0A] border-r border-white/15 p-4 flex flex-col h-full"
            >
              <div className="flex items-center justify-between pb-4 mb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#39FF88]" />
                  <span className="text-sm font-bold text-[#E6F1EE]">rooh.clouds</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-1.5 text-[#8A9D98]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">{renderSidebarNav(true)}</div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Command Bar */}
        <header className="sticky top-0 z-30 h-16 bg-[#070A0A]/90 backdrop-blur-md border-b border-white/10 px-4 md:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-1 max-w-2xl relative">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden p-2 rounded-lg border border-white/10 text-[#E6F1EE]"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6E827D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="search anything..."
                aria-label="Global vault search"
                className="w-full bg-[#030505] border border-white/15 focus:border-[#39FF88] focus:outline-none rounded-lg pl-9 pr-14 py-2 text-xs text-[#E6F1EE] placeholder:text-[#576B65]"
              />
              {!searchQuery && (
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] text-[#6E827D] bg-[#090D0D] border border-white/10 rounded absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  Ctrl+K
                </kbd>
              )}
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6E827D] hover:text-[#E6F1EE]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Search Suggestions Dropdown */}
              {searchFocused && searchSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#090D0D] border border-white/15 rounded-xl shadow-2xl overflow-hidden z-40">
                  <div className="px-3 py-1.5 text-[10px] text-[#6E827D] border-b border-white/5">
                    Suggestions
                  </div>
                  <div className="divide-y divide-white/5">
                    {searchSuggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          navigate(item.targetPath);
                          if (item.folderId !== undefined) {
                            setCurrentFolderId(item.folderId);
                            setSearchQuery('');
                          } else {
                            setSearchQuery(item.label.replace(/^#/, ''));
                          }
                          setSearchFocused(false);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center justify-between gap-2 text-xs hover:bg-white/5"
                      >
                        <span className="text-[#E6F1EE] truncate">{item.label}</span>
                        <span className="text-[10px] text-[#00E5FF] shrink-0">{item.kind}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleQuickNewNote}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-white/15 bg-[#030505] text-[#E6F1EE] rounded-lg hover:border-[#00E5FF]/50 whitespace-nowrap"
            >
              <FilePlus className="w-3.5 h-3.5 text-[#00E5FF]" />
              <span>New Note</span>
            </button>

            <button
              type="button"
              onClick={() => setNewFolderOpen(true)}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-white/15 bg-[#030505] text-[#E6F1EE] rounded-lg hover:border-[#39FF88]/50 whitespace-nowrap"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#39FF88]" />
              <span>New Folder</span>
            </button>

            <button
              type="button"
              onClick={() => setEncryptedUploadMode(!encryptedUploadMode)}
              aria-pressed={encryptedUploadMode}
              aria-label="Toggle encrypted upload mode"
              title={
                encryptedUploadMode
                  ? 'Encrypted Mode On: Direct uploads use AES-256-GCM'
                  : 'Enable Encrypted Mode for direct uploads'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                encryptedUploadMode
                  ? 'border-[#39FF88]/60 bg-[#39FF88]/15 text-[#39FF88]'
                  : 'border-white/15 bg-[#030505] text-[#8A9D98] hover:text-[#E6F1EE] hover:border-[#39FF88]/40'
              }`}
            >
              <Leaf className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">
                {encryptedUploadMode ? 'Encrypted On' : 'Encrypted'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] transition-colors whitespace-nowrap shrink-0 rooh-glitch-hover"
            >
              {encryptedUploadMode ? <Leaf className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
              <span>{encryptedUploadMode ? 'Upload Encrypted' : 'Upload Files'}</span>
            </button>
          </div>
        </header>

        {/* Main Workspace Body */}
        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-8 max-w-[1440px] w-full mx-auto">
          {otherLocalFilesCount > 0 && (
            <div className="mb-4 bg-[#090D0D] border border-[#39FF88]/40 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs font-sans-ui text-[#C7D8D3]">
                Found <strong className="text-[#39FF88]">{otherLocalFilesCount}</strong> local{' '}
                {otherLocalFilesCount === 1 ? 'file' : 'files'} saved under another profile on this browser. Link them into{' '}
                <code className="text-[#00E5FF] font-mono">{user?.id}</code> to restore immediate access and sync to cloud.
              </div>
              <button
                type="button"
                disabled={isSyncingCloud}
                onClick={async () => {
                  try {
                    const moved = await consolidateLocalFiles();
                    addToast({
                      type: 'success',
                      title: 'Local files restored',
                      description: `Linked ${moved} local files into ${user?.id} and synced to cloud.`,
                    });
                  } catch (err) {
                    addToast({
                      type: 'error',
                      title: 'Failed to link local files',
                      description: err instanceof Error ? err.message : 'Unable to link local files.',
                    });
                  }
                }}
                className="px-3.5 py-1.5 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] disabled:opacity-50 shrink-0"
              >
                {isSyncingCloud ? 'Linking...' : 'Link & Sync Local Files'}
              </button>
            </div>
          )}
          {activeSection === 'links' ? (
            <BookmarksView globalSearchQuery={searchQuery} />
          ) : activeSection === 'browser' ? (
            <PrivateBrowserView />
          ) : activeSection === 'notes' ? (
            <NotesView globalSearchQuery={searchQuery} />
          ) : activeSection === 'trash' ? (
            <TrashView />
          ) : activeSection === 'analytics' ? (
            <AnalyticsView />
          ) : activeSection === 'settings' ? (
            <SettingsView />
          ) : (
            <FileExplorerView
              section={activeSection}
              searchQuery={searchQuery}
              currentFolderId={currentFolderId}
              onNavigateFolder={(id) => {
                setCurrentFolderId(id);
                if (activeSection !== 'all') navigate('/all');
              }}
              onTriggerUpload={() => fileInputRef.current?.click()}
              onTriggerNewFolder={() => setNewFolderOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (compact <= 10% viewport height) */}
      <nav
        aria-label="Mobile quick dock"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 bg-[#070A0A]/95 backdrop-blur-md border-t border-white/10 flex items-center justify-around px-2"
      >
        {[
          { id: 'all', label: 'Files', path: '/all', icon: Folder },
          { id: 'notes', label: 'Notes', path: '/notes', icon: FilePlus },
          { id: 'links', label: 'Links', path: '/links', icon: Link2 },
          { id: 'favorites', label: 'Starred', path: '/favorites', icon: Star },
          { id: 'settings', label: 'Settings', path: '/settings', icon: Settings },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1 px-2 text-[10px] ${
                active ? accentText : 'text-[#8A9D98]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* New Folder Modal */}
      <TextPromptModal
        open={newFolderOpen}
        title="Create New Folder"
        label="Folder Name"
        placeholder="e.g. Classified Backups"
        submitLabel="Create Folder"
        onClose={() => setNewFolderOpen(false)}
        onSubmit={async (name) => {
          if (!user) return;
          await storage.createFolder(user.id, name, activeSection === 'all' ? currentFolderId : null);
          await refreshVaultData();
          addToast({ type: 'success', title: `Folder "${name}" created` });
        }}
      />

      <ArmEncryptedModal />
      <UploadProgressTray />
    </div>
  );
};
