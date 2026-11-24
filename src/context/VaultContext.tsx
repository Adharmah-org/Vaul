import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { generateUuid, normalizeRoohKey } from '../services/crypto';
import { FirestoreStorageProvider } from '../storage/FirestoreStorageProvider';
import { IndexedDBStorageProvider } from '../storage/IndexedDBStorageProvider';
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

export type VaultStorageMode = 'cloud' | 'local';

interface CloudProfileStatus {
  exists: boolean;
  username?: string;
}

interface VaultContextValue {
  storage: StorageProvider;
  storageMode: VaultStorageMode;
  setStorageMode: (mode: VaultStorageMode) => void;
  firebaseUser: FirebaseUser | null;
  cloudProfileStatus: CloudProfileStatus | null;
  isConnectingCloud: boolean;
  signInCloudWithGoogle: () => Promise<void>;
  signOutCloudGoogle: () => Promise<void>;

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
  register: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string, roohKey: string) => Promise<void>;
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

const STORAGE_MODE_KEY = 'rooh_storage_mode';

const DEFAULT_PREFERENCES: VaultPreferences = {
  accentMode: 'matrix',
  matrixRain: true,
  scanlines: true,
  reducedMotion: false,
  sessionDurationMinutes: 120,
  defaultViewMode: 'grid',
};

const VaultContext = createContext<VaultContextValue | null>(null);

const localStorageSingleton = new IndexedDBStorageProvider();
const cloudStorageSingleton = new FirestoreStorageProvider();

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [storageMode, setStorageModeState] = useState<VaultStorageMode>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') return 'local';
    const saved = localStorage.getItem(STORAGE_MODE_KEY);
    return saved === 'local' ? 'local' : 'cloud';
  });

  const storage: StorageProvider = useMemo(
    () => (storageMode === 'cloud' ? cloudStorageSingleton : localStorageSingleton),
    [storageMode]
  );

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudProfileStatus, setCloudProfileStatus] = useState<CloudProfileStatus | null>(null);
  const [isConnectingCloud, setIsConnectingCloud] = useState(false);

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

  const clearWorkspaceState = useCallback(() => {
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
  }, []);

  const loadUserWorkspace = useCallback(
    async (activeStorage: StorageProvider, userId: string) => {
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
        ] = await Promise.all([
          activeStorage.listFolders(userId),
          activeStorage.listFiles(userId),
          activeStorage.listNotes(userId),
          activeStorage.listBookmarks(userId),
          activeStorage.listTags(userId),
          activeStorage.listTrash(userId),
          activeStorage.getPreferences(userId),
        ]);
        setFolders(loadedFolders);
        setFiles(loadedFiles);
        setNotes(loadedNotes);
        setBookmarks(loadedBookmarks);
        setTags(loadedTags);
        setTrash(loadedTrash);
        setPreferences(loadedPrefs);
      } finally {
        setIsLoadingData(false);
      }
    },
    []
  );

  const refreshVaultData = useCallback(async () => {
    if (!user) return;
    await loadUserWorkspace(storage, user.id);
  }, [storage, user, loadUserWorkspace]);

  const resolveFileBlob = useCallback(
    async (file: FileRecord): Promise<Blob> => {
      if (storage.resolveFileBlob && file.size > 0 && file.content.size === 0) {
        return storage.resolveFileBlob(file.userId, file);
      }
      return file.content;
    },
    [storage]
  );

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Session hydration when authReady or storageMode changes
  useEffect(() => {
    if (!authReady) return;
    let active = true;

    (async () => {
      setIsInitializing(true);
      try {
        const params = new URLSearchParams(window.location.search);

        if (storageMode === 'local') {
          setCloudProfileStatus(null);
          const anyUser = await localStorageSingleton.hasAnyUser();
          if (active) setHasExistingAccount(anyUser);

          const activeSession = await localStorageSingleton.getActiveSession();
          if (activeSession && active) {
            setUser(activeSession.user);
            setSession(activeSession.session);
            await loadUserWorkspace(localStorageSingleton, activeSession.user.id);
            return;
          }

          if (params.get('autostart') === '1') {
            const demo = await localStorageSingleton.seedDemoVault();
            if (active) {
              setUser(demo.user);
              setSession(demo.session);
              setHasExistingAccount(true);
              await loadUserWorkspace(localStorageSingleton, demo.user.id);
            }
            return;
          }

          if (active) clearWorkspaceState();
          return;
        }

        // Cloud Mode
        if (!firebaseUser) {
          if (active) {
            setCloudProfileStatus(null);
            setHasExistingAccount(false);
            clearWorkspaceState();
          }
          return;
        }

        const status = await cloudStorageSingleton.getCloudVaultStatus(firebaseUser.uid);
        if (!active) return;
        setCloudProfileStatus(status);
        setHasExistingAccount(status.exists);

        const activeCloudSession = await cloudStorageSingleton.getActiveSession();
        if (activeCloudSession && active) {
          setUser(activeCloudSession.user);
          setSession(activeCloudSession.session);
          await loadUserWorkspace(cloudStorageSingleton, activeCloudSession.user.id);
        } else if (active) {
          clearWorkspaceState();
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
  }, [authReady, storageMode, firebaseUser, loadUserWorkspace, clearWorkspaceState]);

  // Session expiration monitor
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(async () => {
      if (Date.now() > session.expiresAt) {
        await storage.logout(session.id);
        clearWorkspaceState();
        addToast({
          type: 'warning',
          title: 'Session expired',
          description: 'Your vault session timed out. Authenticate to continue.',
        });
      }
    }, 15_000);

    return () => clearInterval(interval);
  }, [session, storage, clearWorkspaceState, addToast]);

  const setStorageMode = useCallback(
    (mode: VaultStorageMode) => {
      if (mode === storageMode) return;
      localStorage.setItem(STORAGE_MODE_KEY, mode);
      clearWorkspaceState();
      setStorageModeState(mode);
    },
    [storageMode, clearWorkspaceState]
  );

  const signInCloudWithGoogle = useCallback(async () => {
    setIsConnectingCloud(true);
    try {
      await signInWithPopup(auth, googleProvider);
      addToast({
        type: 'success',
        title: 'Google identity connected',
        description: 'Enter your Cloud Vault details or initialize a new vault.',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        throw new Error('Google sign-in popup was closed before completing.');
      }
      if (code === 'auth/popup-blocked') {
        throw new Error('Browser blocked the Google sign-in popup. Allow popups for this site and try again.');
      }
      throw err instanceof Error ? err : new Error('Failed to connect Google account.');
    } finally {
      setIsConnectingCloud(false);
    }
  }, [addToast]);

  const signOutCloudGoogle = useCallback(async () => {
    if (session) {
      await storage.logout(session.id);
    }
    await signOut(auth);
    setCloudProfileStatus(null);
    clearWorkspaceState();
    addToast({
      type: 'info',
      title: 'Cloud identity disconnected',
      description: 'Signed out of Google session on this browser.',
    });
  }, [session, storage, clearWorkspaceState, addToast]);

  const register = useCallback(
    async (username: string, password: string) => {
      const result = await storage.registerUser(username, password);
      setHasExistingAccount(true);
      if (storageMode === 'cloud') {
        setCloudProfileStatus({ exists: true, username: result.user.username });
      }
      setPendingRoohKey(result.roohKey);
      setSessionRoohKey(result.roohKey);
      setUser(result.user);
      setSession(result.session);
      await loadUserWorkspace(storage, result.user.id);
    },
    [storage, storageMode, loadUserWorkspace]
  );

  const clearPendingRoohKey = useCallback(() => {
    setPendingRoohKey(null);
  }, []);

  const login = useCallback(
    async (username: string, password: string, roohKey: string) => {
      const result = await storage.authenticateUser(username, password, roohKey);
      setPendingRoohKey(null);
      setSessionRoohKey(normalizeRoohKey(roohKey));
      setUser(result.user);
      setSession(result.session);
      await loadUserWorkspace(storage, result.user.id);
    },
    [storage, loadUserWorkspace]
  );

  const logout = useCallback(async () => {
    if (session) {
      await storage.logout(session.id);
    }
    clearWorkspaceState();
    addToast({
      type: 'info',
      title: 'Vault locked',
      description:
        storageMode === 'cloud'
          ? 'Cloud Vault session locked on this browser.'
          : 'Local session terminated.',
    });
  }, [session, storage, storageMode, clearWorkspaceState, addToast]);

  const updatePreferences = useCallback(
    async (next: Partial<VaultPreferences>) => {
      const merged = { ...preferences, ...next };
      setPreferences(merged);
      if (user) {
        await storage.savePreferences(user.id, merged);
      }
    },
    [preferences, user, storage]
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
          await storage.uploadFile(user.id, file, folderId, {
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
            ? 'AES-256-GCM ciphertext stored. Rooh Key required after download.'
            : storageMode === 'cloud'
            ? 'Synced to Cloud Firestore Vault across browsers.'
            : 'Saved as IndexedDB Blob in your local vault.',
        });
      }
    },
    [user, storage, storageMode, refreshVaultData, addToast]
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
      const valid = await storage.verifyRoohKey(user.id, normalized);
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
    [user, storage, executeUploadBatch, addToast]
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
        storage,
        storageMode,
        setStorageMode,
        firebaseUser,
        cloudProfileStatus,
        isConnectingCloud,
        signInCloudWithGoogle,
        signOutCloudGoogle,
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
