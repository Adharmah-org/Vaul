import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  ExternalLink,
  EyeOff,
  Flame,
  Globe,
  Info,
  Lock,
  Plus,
  RotateCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { generateUuid } from '../services/crypto';
import { isValidHttpUrl } from '../services/fileUtils';

interface EphemeralTab {
  id: string;
  title: string;
  url: string | null;
  reloadKey: number;
}

function getHostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Session Tab';
  }
}

export const PrivateBrowserView: React.FC = () => {
  const { user, storage, bookmarks, refreshVaultData, logout, addToast } = useVault();

  const [tabs, setTabs] = useState<EphemeralTab[]>(() => [
    { id: generateUuid(), title: 'New Private Tab', url: null, reloadKey: 0 },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const [addressInput, setAddressInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPrivacyShield, setShowPrivacyShield] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  const selectTab = (tab: EphemeralTab) => {
    setActiveTabId(tab.id);
    setAddressInput(tab.url ?? '');
    setErrorMsg(null);
  };

  const handleNewTab = () => {
    const next: EphemeralTab = {
      id: generateUuid(),
      title: 'New Private Tab',
      url: null,
      reloadKey: 0,
    };
    setTabs((prev) => [...prev, next]);
    setActiveTabId(next.id);
    setAddressInput('');
    setErrorMsg(null);
  };

  const handleCloseTab = (id: string) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fresh: EphemeralTab = {
          id: generateUuid(),
          title: 'New Private Tab',
          url: null,
          reloadKey: 0,
        };
        setActiveTabId(fresh.id);
        setAddressInput('');
        return [fresh];
      }
      if (id === activeTabId) {
        const nextActive = remaining[remaining.length - 1];
        setActiveTabId(nextActive.id);
        setAddressInput(nextActive.url ?? '');
      }
      return remaining;
    });
  };

  const openUrlInActiveTab = (rawUrl: string) => {
    setErrorMsg(null);
    const check = isValidHttpUrl(rawUrl);
    if (!check.valid || !check.normalized) {
      setErrorMsg(check.error || 'Enter a valid http:// or https:// URL.');
      return;
    }

    const normalized = check.normalized;
    const hostLabel = getHostnameLabel(normalized);
    setAddressInput(normalized);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, url: normalized, title: hostLabel, reloadKey: t.reloadKey + 1 }
          : t
      )
    );
  };

  const handleNavigateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    openUrlInActiveTab(addressInput);
  };

  const handleReloadTab = () => {
    if (!activeTab?.url) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, reloadKey: t.reloadKey + 1 } : t))
    );
  };

  const handlePanicWipe = () => {
    const fresh: EphemeralTab = {
      id: generateUuid(),
      title: 'New Private Tab',
      url: null,
      reloadKey: 0,
    };
    setTabs([fresh]);
    setActiveTabId(fresh.id);
    setAddressInput('');
    setErrorMsg(null);
    setShowPrivacyShield(false);
    addToast({
      type: 'info',
      title: 'Private session wiped',
      description: 'All open tabs and address inputs cleared from memory.',
    });
  };

  const handleSaveCurrentToLinks = async () => {
    if (!user || !activeTab?.url) return;
    try {
      await storage.createBookmark(user.id, {
        url: activeTab.url,
        title: activeTab.title || getHostnameLabel(activeTab.url),
        description: 'Saved from Private Browser session',
        faviconUrl: '',
        tags: ['private'],
      });
      await refreshVaultData();
      addToast({ type: 'success', title: 'Saved link to Vault Links' });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Unable to save link',
        description: err instanceof Error ? err.message : 'Save failed.',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header + Panic Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">Private Browser</h1>
            <EyeOff className="w-4 h-4 text-[#00E5FF]" />
          </div>
          <p className="text-xs text-[#8A9D98] font-sans-ui mt-1">
            RAM-only tabs &amp; zero-history link launcher · Nothing opened here is logged to IndexedDB
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowPrivacyShield((s) => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-white/15 bg-[#090D0D] text-[#E6F1EE] hover:border-[#00E5FF]/50 whitespace-nowrap"
          >
            <EyeOff className="w-3.5 h-3.5 text-[#00E5FF]" />
            <span>{showPrivacyShield ? 'Resume View' : 'Privacy Curtain'}</span>
          </button>

          <button
            type="button"
            onClick={handlePanicWipe}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-amber-400/35 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 whitespace-nowrap"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Wipe Tabs</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              handlePanicWipe();
              await logout();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-red-500/35 bg-red-500/10 text-red-300 hover:bg-red-500/20 whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Wipe &amp; Lock</span>
          </button>
        </div>
      </div>

      {/* Honest Network & VPN Reality Banner */}
      <div className="bg-[#090D0D] border border-amber-400/30 rounded-xl p-3.5 flex items-start gap-3">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-[#A3B5B0] font-sans-ui leading-relaxed">
          <span className="text-[#E6F1EE] font-semibold">No Built-in VPN in Web Apps:</span>{' '}
          Browsers cannot create a network VPN tunnel, mask your IP address, or bypass ISP blocks via JavaScript. Connect a device VPN (such as Proton VPN, Mullvad, WireGuard, or Cloudflare WARP) before opening restricted or adult sites. External sites that block iframe embedding can be launched with <span className="text-[#00E5FF]">no-referrer</span> in a clean tab.
        </div>
      </div>

      {/* Ephemeral Tab Strip + Address Bar */}
      <div className="bg-[#090D0D] border border-white/10 rounded-xl overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2 border-b border-white/10 overflow-x-auto bg-[#050707]">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors shrink-0 max-w-[180px] ${
                  isActive
                    ? 'bg-[#090D0D] border-[#39FF88]/40 text-[#39FF88]'
                    : 'bg-transparent border-transparent text-[#8A9D98] hover:text-[#E6F1EE] hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectTab(tab)}
                  className="inline-flex items-center gap-1.5 min-w-0 truncate"
                >
                  <Globe className="w-3 h-3 shrink-0" />
                  <span className="truncate">{tab.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCloseTab(tab.id)}
                  aria-label={`Close tab ${tab.title}`}
                  className="text-[#6E827D] hover:text-[#E6F1EE] ml-1 shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={handleNewTab}
            aria-label="New private tab"
            className="p-1.5 rounded-lg text-[#8A9D98] hover:text-[#39FF88] hover:bg-white/5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Address Bar */}
        <form
          onSubmit={handleNavigateSubmit}
          className="p-3 border-b border-white/10 flex flex-wrap sm:flex-nowrap items-center gap-2"
        >
          <div className="relative flex-1 min-w-[200px]">
            <Lock className="w-3.5 h-3.5 text-[#39FF88] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Paste or type https:// URL (never saved to browser vault history)..."
              aria-label="Private browser URL bar"
              className="w-full bg-[#030505] border border-white/15 focus:border-[#00E5FF] focus:outline-none rounded-lg pl-9 pr-3 py-2 text-xs text-[#E6F1EE] placeholder:text-[#576B65]"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              className="px-3.5 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99] whitespace-nowrap"
            >
              Open
            </button>

            {activeTab?.url && (
              <>
                <button
                  type="button"
                  onClick={handleReloadTab}
                  aria-label="Reload sandbox frame"
                  className="p-2 rounded-lg border border-white/15 bg-[#030505] text-[#8A9D98] hover:text-[#E6F1EE]"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={handleSaveCurrentToLinks}
                  title="Optionally save this URL to Vault Links"
                  aria-label="Save URL to Vault Links"
                  className="p-2 rounded-lg border border-white/15 bg-[#030505] text-[#8A9D98] hover:text-[#39FF88]"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                </button>

                <a
                  href={activeTab.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[#00E5FF]/40 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20 whitespace-nowrap"
                >
                  <span>Open in Clean Tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            )}
          </div>
        </form>

        {errorMsg && (
          <div
            role="alert"
            className="mx-3 mt-3 bg-red-500/10 border border-red-500/35 rounded-lg px-3.5 py-2.5 flex items-start gap-2 text-xs text-red-300"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Viewport / Start Page / Privacy Curtain */}
        {showPrivacyShield ? (
          <div className="h-[58vh] min-h-[340px] flex flex-col items-center justify-center p-6 text-center bg-[#030505]">
            <div className="w-12 h-12 rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 flex items-center justify-center text-[#00E5FF] mb-3">
              <EyeOff className="w-5 h-5" />
            </div>
            <h2 className="text-sm font-semibold text-[#E6F1EE]">Privacy Curtain Enabled</h2>
            <p className="text-xs text-[#8A9D98] font-sans-ui mt-1 max-w-sm">
              Session content is hidden from view. Click Resume View to restore your open RAM-only tabs, or Wipe Tabs to clear them.
            </p>
            <button
              type="button"
              onClick={() => setShowPrivacyShield(false)}
              className="mt-4 px-4 py-2 text-xs font-semibold bg-[#39FF88] text-[#030505] rounded-lg hover:bg-[#52FF99]"
            >
              Resume View
            </button>
          </div>
        ) : activeTab?.url ? (
          <div className="flex flex-col bg-[#030505]">
            <div className="px-4 py-2 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8A9D98]">
              <div className="flex items-center gap-2 truncate">
                <Info className="w-3.5 h-3.5 text-[#00E5FF] shrink-0" />
                <span className="truncate">
                  Sandboxed frame (<code className="text-[#E6F1EE]">no-referrer</code>). If a site shows blank or refused to connect, use{' '}
                  <strong className="text-[#00E5FF]">Open in Clean Tab</strong>.
                </span>
              </div>
            </div>
            <iframe
              key={`${activeTab.id}-${activeTab.reloadKey}`}
              title={`Private sandboxed frame: ${activeTab.title}`}
              src={activeTab.url}
              sandbox="allow-scripts allow-forms allow-popups"
              referrerPolicy="no-referrer"
              className="w-full h-[60vh] min-h-[380px] bg-[#030505] border-0"
            />
          </div>
        ) : (
          <div className="p-6 md:p-8 min-h-[360px] bg-[#030505] space-y-6">
            <div className="max-w-xl space-y-2">
              <h2 className="text-sm font-semibold text-[#E6F1EE]">
                Ephemeral Link Session
              </h2>
              <p className="text-xs text-[#8A9D98] font-sans-ui leading-relaxed">
                Paste any URL above or launch a link from your saved Vault Bookmarks. Tab URLs live strictly in browser RAM and vanish when you wipe tabs or lock your vault.
              </p>
            </div>

            {bookmarks.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-[#A3B5B0]">
                  Saved Vault Links ({bookmarks.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bookmarks.slice(0, 9).map((bm) => (
                    <div
                      key={bm.id}
                      className="bg-[#090D0D] border border-white/10 hover:border-[#39FF88]/35 rounded-xl p-3.5 flex items-center justify-between gap-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => openUrlInActiveTab(bm.url)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="text-xs font-semibold text-[#E6F1EE] hover:text-[#39FF88] truncate">
                          {bm.title}
                        </div>
                        <div className="text-[11px] text-[#6E827D] truncate mt-0.5">
                          {bm.url}
                        </div>
                      </button>

                      <a
                        href={bm.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                        aria-label={`Open ${bm.title} in clean tab`}
                        className="p-2 rounded-lg text-[#00E5FF] hover:bg-[#00E5FF]/10 shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
