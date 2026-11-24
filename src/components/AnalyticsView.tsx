import React, { useEffect, useState } from 'react';
import { Database, FileText, Folder, HardDrive, Link2 } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { formatBytes, formatTimestamp } from '../services/fileUtils';
import { StorageAnalytics } from '../types/vault';

export const AnalyticsView: React.FC = () => {
  const { user, storage, files, folders, notes, bookmarks, trash } = useVault();
  const [analytics, setAnalytics] = useState<StorageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    storage
      .getStorageAnalytics(user.id)
      .then((res) => {
        if (active) setAnalytics(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, storage, files, folders, notes, bookmarks, trash]);

  if (loading || !analytics) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-48 bg-white/10 rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-[#090D0D] border border-white/10 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const quotaRatio =
    analytics.browserQuotaBytes && analytics.browserUsageBytes !== null
      ? Math.min(100, Math.max(0.5, (analytics.browserUsageBytes / analytics.browserQuotaBytes) * 100))
      : 0;

  const vaultToQuotaRatio =
    analytics.browserQuotaBytes && analytics.vaultMeasuredBytes > 0
      ? Math.min(100, Math.max(0.5, (analytics.vaultMeasuredBytes / analytics.browserQuotaBytes) * 100))
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#E6F1EE] tracking-tight">Storage Analytics</h1>
        <p className="text-xs text-[#8A9D98] font-sans-ui mt-0.5">
          Browser IndexedDB capacity metrics and vault-managed data breakdown.
        </p>
      </div>

      {/* Dynamic Storage Meter */}
      <div className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-[#39FF88]" />
            <h2 className="text-sm font-semibold text-[#E6F1EE]">Local Device Storage Capacity</h2>
          </div>
          <div className="text-xs text-[#39FF88] tabular-nums font-semibold">
            Vault Data: {formatBytes(analytics.vaultMeasuredBytes)}
          </div>
        </div>

        {analytics.browserEstimateSupported && analytics.browserQuotaBytes ? (
          <>
            <div className="w-full h-3 bg-[#030505] border border-white/10 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${vaultToQuotaRatio}%` }}
                className="h-full bg-[#39FF88]"
                title={`Vault managed data: ${formatBytes(analytics.vaultMeasuredBytes)}`}
              />
              <div
                style={{ width: `${Math.max(0, quotaRatio - vaultToQuotaRatio)}%` }}
                className="h-full bg-[#00E5FF]/50"
                title="Other origin IndexedDB/Cache overhead"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
              <div className="bg-[#030505] border border-white/5 rounded-lg p-3">
                <div className="text-[#8A9D98] text-[11px]">Vault-Measured Blobs & Text</div>
                <div className="text-sm font-bold text-[#39FF88] mt-1 tabular-nums">
                  {formatBytes(analytics.vaultMeasuredBytes)}
                </div>
              </div>
              <div className="bg-[#030505] border border-white/5 rounded-lg p-3">
                <div className="text-[#8A9D98] text-[11px]">Browser Origin Usage (StorageManager)</div>
                <div className="text-sm font-bold text-[#00E5FF] mt-1 tabular-nums">
                  {analytics.browserUsageBytes !== null ? formatBytes(analytics.browserUsageBytes) : 'Unavailable'}
                </div>
              </div>
              <div className="bg-[#030505] border border-white/5 rounded-lg p-3">
                <div className="text-[#8A9D98] text-[11px]">Estimated Browser Origin Quota</div>
                <div className="text-sm font-bold text-[#E6F1EE] mt-1 tabular-nums">
                  {formatBytes(analytics.browserQuotaBytes)}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-[#8A9D98] font-sans-ui">
            Your browser does not expose <code className="text-[#00E5FF]">navigator.storage.estimate()</code>. Displaying exact application-measured byte totals ({formatBytes(analytics.vaultMeasuredBytes)}) only. Storage is bounded by device disk space and browser eviction policies.
          </div>
        )}
      </div>

      {/* KPI Summary Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-[#090D0D] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#8A9D98]">
            <span>Files</span>
            <Database className="w-4 h-4 text-[#39FF88]" />
          </div>
          <div className="text-2xl font-bold text-[#E6F1EE] mt-2 tabular-nums">{analytics.totalFiles}</div>
          <div className="text-[11px] text-[#6E827D] mt-1 tabular-nums">
            {formatBytes(analytics.filesBytes)}
          </div>
        </div>

        <div className="bg-[#090D0D] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#8A9D98]">
            <span>Folders</span>
            <Folder className="w-4 h-4 text-[#00E5FF]" />
          </div>
          <div className="text-2xl font-bold text-[#E6F1EE] mt-2 tabular-nums">{analytics.totalFolders}</div>
          <div className="text-[11px] text-[#6E827D] mt-1">Nested hierarchy</div>
        </div>

        <div className="bg-[#090D0D] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#8A9D98]">
            <span>Notes</span>
            <FileText className="w-4 h-4 text-[#39FF88]" />
          </div>
          <div className="text-2xl font-bold text-[#E6F1EE] mt-2 tabular-nums">{analytics.totalNotes}</div>
          <div className="text-[11px] text-[#6E827D] mt-1 tabular-nums">
            {formatBytes(analytics.notesBytes)}
          </div>
        </div>

        <div className="bg-[#090D0D] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-[#8A9D98]">
            <span>Bookmarks</span>
            <Link2 className="w-4 h-4 text-[#00E5FF]" />
          </div>
          <div className="text-2xl font-bold text-[#E6F1EE] mt-2 tabular-nums">{analytics.totalBookmarks}</div>
          <div className="text-[11px] text-[#6E827D] mt-1 tabular-nums">
            {formatBytes(analytics.bookmarksBytes)}
          </div>
        </div>
      </div>

      {/* Breakdown & Largest/Recent Files */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#E6F1EE]">Breakdown by Type</h2>
          <div className="space-y-2.5">
            {analytics.breakdown.map((item) => {
              const pct =
                analytics.vaultMeasuredBytes > 0
                  ? Math.round((item.bytes / analytics.vaultMeasuredBytes) * 100)
                  : 0;
              return (
                <div key={item.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#E6F1EE]">
                      {item.label} <span className="text-[#6E827D] tabular-nums">({item.count})</span>
                    </span>
                    <span className="text-[#8A9D98] tabular-nums">
                      {formatBytes(item.bytes)} · {pct}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[#030505] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#39FF88]/80"
                      style={{ width: `${Math.max(item.bytes > 0 ? 2 : 0, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#E6F1EE]">Largest Files</h2>
            {analytics.largestFiles.length === 0 ? (
              <p className="text-xs text-[#6E827D] font-sans-ui">No uploaded files yet.</p>
            ) : (
              <div className="divide-y divide-white/5 text-xs">
                {analytics.largestFiles.map((f) => (
                  <div key={f.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="text-[#E6F1EE] truncate">{f.name}</span>
                    <span className="text-[#39FF88] tabular-nums shrink-0">{formatBytes(f.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#090D0D] border border-white/10 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#E6F1EE]">Recently Uploaded</h2>
            {analytics.recentFiles.length === 0 ? (
              <p className="text-xs text-[#6E827D] font-sans-ui">No recent uploads.</p>
            ) : (
              <div className="divide-y divide-white/5 text-xs">
                {analytics.recentFiles.map((f) => (
                  <div key={f.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="text-[#E6F1EE] truncate">{f.name}</span>
                    <span className="text-[#8A9D98] tabular-nums shrink-0">{formatTimestamp(f.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
