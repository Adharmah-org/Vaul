import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { generateUuid, normalizeRoohKey } from '../services/crypto';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  DriveConnectionStatus,
  getDriveConnectionStatus,
  initDriveAuth,
} from '../services/googleDriveStorage';
import { findCanonicalSeedByInput } from '../services/vaultIdentity';
import { CloudSyncSummary, HybridVaultStorageProvider } from '../storage/HybridVaultStorageProvider';
import { StorageProvider } from '../storage/StorageProvider';
import {
  BookmarkRecord,
  FileRecord,
  FolderRecord,
  NoteRecord,
  SessionRecord,
  TagRecord,
  ToastMessage,
  TrashRecord,
  UploadTask,
  UserRecord,
  VaultPreferences,
} from '../types/vault';

interface VaultContextValue {
  storage: StorageProvider;
  user: UserRecord | null;
  session: SessionRecord | null;
  preferences: VaultPreferences;
  isInitializing: boolean;
  isLoadingData: boolean;
  hasExistingAccount: boolean;
  pendingRoohKey: string | null;
  clearPendingRoohKey: () => void;

  encryptedUploadMode: boolean;
  isEncryptionArmed: boolean;
  armEncryptedModalOpen: boolean;
  pendingEncryptedUploadCount: number;
  setEncryptedUploadMode: (enabled: boolean) => void;
  setArmEncryptedModalOpen: (open: boolean) => void;
  clearPendingEncryptedUpload: () => void;
  armEncryptedMode: (roohKey: string) => Promise<void>;

  folders: FolderRecord[];
  files: FileRecord[];
  notes: NoteRecord[];
  bookmarks: BookmarkRecord[];
  tags: TagRecord[];
  trash: TrashRecord[];

  uploadTasks: UploadTask[];
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;

  refreshVaultData: () => Promise<void>;
  resolveFileBlob: (file: FileRecord) => Promise<Blob>;
  isSyncingCloud: boolean;
  syncVaultNow: (options?: { includeGoogleDrive?: boolean }) => Promise<CloudSyncSummary | null>;
  driveStatus: DriveConnectionStatus;
  connectDrive: () => Promise<DriveConnectionStatus>;
  disconnectDrive: () => Promise<void>;
  otherLocalFilesCount: number;
  consolidateLocalFiles: () => Promise<number>;
  register: (username: string) => Promise<void>;
  login: (username: string, roohKey: string) => Promise<void>;
  logout: () => Promise<void>;
  updatePreferences: (next: Partial<VaultPreferences>) => Promise<void>;

  uploadFiles: (
    files: FileList | File[],
    folderId: string | null,
    options?: { encrypted?: boolean }
  ) => Promise<void>;
  cancelUpload: (taskId: string) => void;
  dismissUploadTask: (taskId: string) => void;
}

const DEFAULT_PREFERENCES: VaultPreferences = {
  accentMode: 'matrix',
  matrixRain: true,
  scanlines: true,
  reducedMotion: false,
  sessionDurationMinutes: 120,
  defaultViewMode: 'grid',
};

const VaultContext = createContext<VaultContextValue | null>(null);

const storageSingleton = new HybridVaultStorageProvider();

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [preferences, setPreferences] = useState<VaultPreferences>(DEFAULT_PREFERENCES);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [hasExistingAccount, setHasExistingAccount] = useState(false);
  const [pendingRoohKey, setPendingRoohKey] = useState<string | null>(null);

  const [sessionRoohKey, setSessionRoohKey] = useState<string | null>(null);
  const [encryptedUploadMode, setEncryptedUploadModeState] = useState(false);
  const [armEncryptedModalOpen, setArmEncryptedModalOpen] = useState(false);
  const [pendingEncryptedUploadCount, setPendingEncryptedUploadCount] = useState(0);
  const pendingEncryptedUploadRef = useRef<{ files: File[]; folderId: string | null } | null>(null);

  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [trash, setTrash] = useState<TrashRecord[]>([]);

  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>(() =>
    getDriveConnectionStatus()
  );
  const [otherLocalFilesCount, setOtherLocalFilesCount] = useState(0);

  useEffect(() => {
    const unsubscribe = initDriveAuth(
      (authUser) => {
        setDriveStatus({
          connected: true,
          email: authUser.email,
          displayName: authUser.displayName,
        });
      },
      () => {
        setDriveStatus(getDriveConnectionStatus());
      }
    );
    return unsubscribe;
  }, []);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = generateUuid();
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadUserWorkspace = useCallback(async (userId: string) => {
    setIsLoadingData(true);
    try {
      const [
        loadedFolders,
        loadedFiles,
        loadedNotes,
        loadedBookmarks,
        loadedTags,
        loadedTrash,
        loadedPrefs,
        otherLocalCount,
      ] = await Promise.all([
        storageSingleton.listFolders(userId),
        storageSingleton.listFiles(userId),
        storageSingleton.listNotes(userId),
        storageSingleton.listBookmarks(userId),
        storageSingleton.listTags(userId),
        storageSingleton.listTrash(userId),
        storageSingleton.getPreferences(userId),
        storageSingleton.countOtherLocalVaultFiles(userId).catch(() => 0),
      ]);
      setFolders(loadedFolders);
      setFiles(loadedFiles);
      setNotes(loadedNotes);
      setBookmarks(loadedBookmarks);
      setTags(loadedTags);
      setTrash(loadedTrash);
      setPreferences(loadedPrefs);
      setOtherLocalFilesCount(otherLocalCount);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  const refreshVaultData = useCallback(async () => {
    if (!user) return;
    await loadUserWorkspace(user.id);
  }, [user, loadUserWorkspace]);

  const resolveFileBlob = useCallback(
    async (file: FileRecord): Promise<Blob> => {
      if (!user) return file.content;
      return storageSingleton.resolveFileBlob(user.id, file);
    },
    [user]
  );

  const syncVaultNow = useCallback(
    async (options?: { includeGoogleDrive?: boolean }): Promise<CloudSyncSummary | null> => {
      if (!user) return null;
      setIsSyncingCloud(true);
      try {
        const res = await storageSingleton.syncBidirectional(user.id, options);
        await loadUserWorkspace(user.id);
        return res.pushSummary;
      } finally {
        setIsSyncingCloud(false);
      }
    },
    [user, loadUserWorkspace]
  );

  const connectDrive = useCallback(async (): Promise<DriveConnectionStatus> => {
    const loginHint = user ? findCanonicalSeedByInput(user.id)?.driveAccountEmail : undefined;
    const status = await connectGoogleDrive(loginHint);
    setDriveStatus(status);
    return status;
  }, [user]);

  const disconnectDrive = useCallback(async (): Promise<void> => {
    await disconnectGoogleDrive();
    setDriveStatus({ connected: false, email: null, displayName: null });
  }, []);

  const consolidateLocalFiles = useCallback(async (): Promise<number> => {
    if (!user) return 0;
    setIsSyncingCloud(true);
    try {
      const moved = await storageSingleton.consolidateOtherLocalVaults(user.id);
      await loadUserWorkspace(user.id);
      return moved;
    } finally {
      setIsSyncingCloud(false);
    }
  }, [user, loadUserWorkspace]);

  // Initial session hydration + ?autostart=1 support + background bidirectional sync
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const anyUser = await storageSingleton.hasAnyUser();
        if (active) setHasExistingAccount(anyUser);

        const activeSession = await storageSingleton.getActiveSession();
        if (activeSession && active) {
          setUser(activeSession.user);
          setSession(activeSession.session);
          await loadUserWorkspace(activeSession.user.id);
          // Background cross-browser sync so newly added remote/local files align automatically
          storageSingleton
            .syncBidirectional(activeSession.user.id)
            .then(async (res) => {
              if (active && res.pulledUpdates) {
                await loadUserWorkspace(activeSession.user.id);
              }
            })
            .catch(() => {});
          return;
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1') {
          const demo = await storageSingleton.seedDemoVault();
          if (active) {
            setUser(demo.user);
            setSession(demo.session);
            setHasExistingAccount(true);
            await loadUserWorkspace(demo.user.id);
          }
        }
      } catch (err) {
        console.error('Failed to initialize vault session:', err);
      } finally {
        if (active) setIsInitializing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadUserWorkspace]);

  // Session expiration monitor
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(async () => {
      if (Date.now() > session.expiresAt) {
        await storageSingleton.logout(session.id);
        setUser(null);
        setSession(null);
        setPendingRoohKey(null);
        setSessionRoohKey(null);
        setEncryptedUploadModeState(false);
        setArmEncryptedModalOpen(false);
        pendingEncryptedUploadRef.current = null;
        setPendingEncryptedUploadCount(0);
        setFolders([]);
        setFiles([]);
        setNotes([]);
        setBookmarks([]);
        setTags([]);
        setTrash([]);
        addToast({
          type: 'warning',
          title: 'Session expired',
          description: 'Your local vault session timed out. Authenticate to continue.',
        });
      }
    }, 15_000);

    return () => clearInterval(interval);
  }, [session, addToast]);

  const register = useCallback(
    async (username: string) => {
      const result = await storageSingleton.registerUser(username);
      setHasExistingAccount(true);
      setPendingRoohKey(result.roohKey);
      setSessionRoohKey(result.roohKey);
      setUser(result.user);
      setSession(result.session);
      await loadUserWorkspace(result.user.id);
    },
    [loadUserWorkspace]
  );

  const clearPendingRoohKey = useCallback(() => {
    setPendingRoohKey(null);
  }, []);

  const login = useCallback(
    async (username: string, roohKey: string) => {
      const result = await storageSingleton.authenticateUser(username, roohKey);
      setPendingRoohKey(null);
      setSessionRoohKey(normalizeRoohKey(roohKey));
      setUser(result.user);
      setSession(result.session);
      await loadUserWorkspace(result.user.id);
    },
    [loadUserWorkspace]
  );

  const logout = useCallback(async () => {
    if (session) {
      await storageSingleton.logout(session.id);
    }
    setUser(null);
    setSession(null);
    setPendingRoohKey(null);
    setSessionRoohKey(null);
    setEncryptedUploadModeState(false);
    setArmEncryptedModalOpen(false);
    pendingEncryptedUploadRef.current = null;
    setPendingEncryptedUploadCount(0);
    setFolders([]);
    setFiles([]);
    setNotes([]);
    setBookmarks([]);
    setTags([]);
    setTrash([]);
    addToast({
      type: 'info',
      title: 'Vault locked',
      description: 'Local session terminated.',
    });
  }, [session, addToast]);

  const updatePreferences = useCallback(
    async (next: Partial<VaultPreferences>) => {
      const merged = { ...preferences, ...next };
      setPreferences(merged);
      if (user) {
        await storageSingleton.savePreferences(user.id, merged);
      }
    },
    [preferences, user]
  );

  const executeUploadBatch = useCallback(
    async (incoming: File[], folderId: string | null, activeRoohKey?: string) => {
      if (!user || incoming.length === 0) return;

      const isEncrypted = Boolean(activeRoohKey);
      const tasks: UploadTask[] = incoming.map((f) => ({
        id: generateUuid(),
        fileName: f.name,
        size: f.size,
        progress: 0,
        status: 'queued',
        isEncrypted,
      }));

      setUploadTasks((prev) => [...prev, ...tasks]);

      let successCount = 0;

      for (let i = 0; i < incoming.length; i++) {
        const file = incoming[i];
        const task = tasks[i];
        const controller = new AbortController();
        uploadControllersRef.current.set(task.id, controller);

        setUploadTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: 'uploading', progress: 5 } : t))
        );

        try {
          await storageSingleton.uploadFile(user.id, file, folderId, {
            signal: controller.signal,
            roohKey: activeRoohKey,
            onProgress: (percent) => {
              setUploadTasks((prev) =>
                prev.map((t) => (t.id === task.id ? { ...t, progress: percent } : t))
              );
            },
          });

          successCount += 1;
          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, status: 'completed', progress: 100 } : t
            )
          );
          setTimeout(() => {
            setUploadTasks((prev) => prev.filter((t) => t.id !== task.id));
          }, 4000);
        } catch (err) {
          const isAbort = err instanceof DOMException && err.name === 'AbortError';
          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    status: isAbort ? 'cancelled' : 'error',
                    error: isAbort ? 'Cancelled by user' : err instanceof Error ? err.message : 'Upload failed',
                  }
                : t
            )
          );
        } finally {
          uploadControllersRef.current.delete(task.id);
        }
      }

      await refreshVaultData();
      if (successCount > 0) {
        addToast({
          type: 'success',
          title: isEncrypted
            ? `Encrypted & uploaded ${successCount} ${successCount === 1 ? 'file' : 'files'}`
            : `Uploaded ${successCount} ${successCount === 1 ? 'file' : 'files'}`,
          description: isEncrypted
            ? 'AES-256-GCM ciphertext stored in IndexedDB. Rooh Key required after download.'
            : 'Saved as IndexedDB Blob in your local vault.',
        });
      }
    },
    [user, refreshVaultData, addToast]
  );

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], folderId: string | null, options?: { encrypted?: boolean }) => {
      if (!user) return;
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      const useEncrypted = options?.encrypted ?? encryptedUploadMode;
      if (useEncrypted && !sessionRoohKey) {
        pendingEncryptedUploadRef.current = { files: incoming, folderId };
        setPendingEncryptedUploadCount(incoming.length);
        setArmEncryptedModalOpen(true);
        return;
      }

      await executeUploadBatch(incoming, folderId, useEncrypted ? sessionRoohKey ?? undefined : undefined);
    },
    [user, encryptedUploadMode, sessionRoohKey, executeUploadBatch]
  );

  const setEncryptedUploadMode = useCallback(
    (enabled: boolean) => {
      if (enabled && !sessionRoohKey) {
        setArmEncryptedModalOpen(true);
        return;
      }
      setEncryptedUploadModeState(enabled);
      if (enabled) {
        addToast({
          type: 'info',
          title: 'Encrypted Mode active',
          description: 'Direct uploads will be encrypted with AES-256-GCM before storage.',
        });
      }
    },
    [sessionRoohKey, addToast]
  );

  const clearPendingEncryptedUpload = useCallback(() => {
    pendingEncryptedUploadRef.current = null;
    setPendingEncryptedUploadCount(0);
  }, []);

  const armEncryptedMode = useCallback(
    async (roohKeyInput: string) => {
      if (!user) {
        throw new Error('Authenticate first to arm Encrypted Mode.');
      }
      const normalized = normalizeRoohKey(roohKeyInput);
      const valid = await storageSingleton.verifyRoohKey(user.id, normalized);
      if (!valid) {
        throw new Error('Invalid Rooh Key. Unable to arm Encrypted Mode.');
      }

      setSessionRoohKey(normalized);
      setEncryptedUploadModeState(true);
      setArmEncryptedModalOpen(false);

      const pending = pendingEncryptedUploadRef.current;
      pendingEncryptedUploadRef.current = null;
      setPendingEncryptedUploadCount(0);

      if (pending && pending.files.length > 0) {
        await executeUploadBatch(pending.files, pending.folderId, normalized);
      } else {
        addToast({
          type: 'success',
          title: 'Encrypted Mode armed',
          description: 'Direct uploads will now encrypt client-side using AES-256-GCM.',
        });
      }
    },
    [user, executeUploadBatch, addToast]
  );

  const cancelUpload = useCallback((taskId: string) => {
    const controller = uploadControllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
    } else {
      setUploadTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'cancelled' } : t))
      );
    }
  }, []);

  const dismissUploadTask = useCallback((taskId: string) => {
    setUploadTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  return (
    <VaultContext.Provider
      value={{
        storage: storageSingleton,
        user,
        session,
        preferences,
        isInitializing,
        isLoadingData,
        hasExistingAccount,
        pendingRoohKey,
        clearPendingRoohKey,
        encryptedUploadMode,
        isEncryptionArmed: Boolean(sessionRoohKey),
        armEncryptedModalOpen,
        pendingEncryptedUploadCount,
        setEncryptedUploadMode,
        setArmEncryptedModalOpen,
        clearPendingEncryptedUpload,
        armEncryptedMode,
        folders,
        files,
        notes,
        bookmarks,
        tags,
        trash,
        uploadTasks,
        toasts,
        addToast,
        dismissToast,
        refreshVaultData,
        resolveFileBlob,
        isSyncingCloud,
        syncVaultNow,
        driveStatus,
        connectDrive,
        disconnectDrive,
        otherLocalFilesCount,
        consolidateLocalFiles,
        register,
        login,
        logout,
        updatePreferences,
        uploadFiles,
        cancelUpload,
        dismissUploadTask,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
    if (!ctx) {
    throw new Error('useVault must be used within a VaultProvider.');
  }
  return ctx;
}
