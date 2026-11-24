import { db } from './db';
import { FirestoreStorageProvider, MAX_CLOUD_FILE_BYTES } from './FirestoreStorageProvider';
import { IndexedDBStorageProvider } from './IndexedDBStorageProvider';
import {
  LoginResult,
  RegisterResult,
  StorageProvider,
  UploadProgressCallbacks,
} from './StorageProvider';
import {
  BookmarkRecord,
  FileRecord,
  FolderRecord,
  NoteRecord,
  SessionRecord,
  StorageAnalytics,
  TagRecord,
  TrashRecord,
  UserRecord,
  VaultArchive,
  VaultPreferences,
} from '../types/vault';
import {
  generateSessionToken,
  generateUuid,
  isValidRoohKeyFormat,
  normalizeRoohKey,
  verifySecret,
} from '../services/crypto';
import {
  blobToBase64,
  detectFileCategory,
  getFileExtension,
  sanitizeFileName,
} from '../services/fileUtils';
import {
  downloadBlobFromDrive,
  getDriveAccessToken,
  listVaultDriveFiles,
  uploadBlobToDrive,
} from '../services/googleDriveStorage';
import {
  CANONICAL_VAULT_SEEDS,
  findCanonicalSeedByInput,
} from '../services/vaultIdentity';

const ACTIVE_SESSION_ID_KEY = 'rooh_active_session_id';
const PREFS_PREFIX = 'rooh_prefs_';

export interface CloudSyncSummary {
  syncedFiles: number;
  syncedDriveFiles: number;
  largeFilesPendingDrive: number;
  syncedFolders: number;
  syncedNotes: number;
  syncedBookmarks: number;
}

export class HybridVaultStorageProvider implements StorageProvider {
  readonly providerName = 'Hybrid Local + Cloud Vault';
  readonly isRemoteBacked = true;

  public readonly local: IndexedDBStorageProvider;
  public readonly cloud: FirestoreStorageProvider;

  constructor() {
    this.local = new IndexedDBStorageProvider();
    this.cloud = new FirestoreStorageProvider();
  }

  /**
   * Migrates any local IndexedDB vault records from an old/random/legacy ID
   * into the canonical UID (e.g. d6a19222-fefb-4c0e-b3b4-f7a725488caa) so
   * locally saved files stay intact and sync uniformly across all browsers.
   */
  async migrateLocalUserId(
    fromId: string,
    toId: string,
    canonicalUsername?: string,
    canonicalHash?: string
  ): Promise<void> {
    if (!fromId || !toId) return;

    await db.transaction(
      'rw',
      [db.users, db.sessions, db.folders, db.files, db.notes, db.bookmarks, db.tags, db.trash],
      async () => {
        const fromUser = await db.users.get(fromId);
        const toUser = await db.users.get(toId);

        if (fromId === toId) {
          if (toUser && (canonicalUsername || canonicalHash)) {
            await db.users.update(toId, {
              username: canonicalUsername || toUser.username,
              roohKeyHash: canonicalHash || toUser.roohKeyHash,
              updatedAt: Date.now(),
            });
          }
          return;
        }

        if (fromUser && !toUser) {
          await db.users.put({
            ...fromUser,
            id: toId,
            username: canonicalUsername || fromUser.username,
            roohKeyHash: canonicalHash || fromUser.roohKeyHash,
            updatedAt: Date.now(),
          });
          await db.users.delete(fromId);
        } else if (fromUser && toUser) {
          await db.users.update(toId, {
            username: canonicalUsername || toUser.username,
            roohKeyHash: canonicalHash || toUser.roohKeyHash,
            updatedAt: Date.now(),
          });
          await db.users.delete(fromId);
        }

        const updateCollection = async <T extends { id: string; userId: string }>(
          table: { where: (idx: string) => { equals: (val: string) => { toArray: () => Promise<T[]> } }; bulkPut: (items: T[]) => Promise<unknown> }
        ) => {
          const rows = await table.where('userId').equals(fromId).toArray();
          if (rows.length > 0) {
            await table.bulkPut(rows.map((r) => ({ ...r, userId: toId })));
          }
        };

        await Promise.all([
          updateCollection(db.folders),
          updateCollection(db.files),
          updateCollection(db.notes),
          updateCollection(db.bookmarks),
          updateCollection(db.tags),
          updateCollection(db.trash),
          updateCollection(db.sessions),
        ]);
      }
    );

    if (fromId !== toId) {
      const legacyPrefs = localStorage.getItem(`${PREFS_PREFIX}${fromId}`);
      if (legacyPrefs && !localStorage.getItem(`${PREFS_PREFIX}${toId}`)) {
        localStorage.setItem(`${PREFS_PREFIX}${toId}`, legacyPrefs);
      }
    }
  }

  /**
   * Checks whether any local user record belongs to a canonical seed with a legacy UID
   * and unifies it into the primary canonical UID.
   */
  private async reconcileCanonicalLocalUsers(): Promise<void> {
    const allUsers = await db.users.toArray();
    for (const seed of CANONICAL_VAULT_SEEDS) {
      for (const u of allUsers) {
        const matchesSeed =
          u.username.toLowerCase() === seed.usernameLower ||
          (seed.aliases?.some((a) => a.toLowerCase() === u.username.toLowerCase()) ?? false) ||
          seed.legacyVaultIds.some((lid) => lid.toLowerCase() === u.id.toLowerCase());
        if (matchesSeed && u.id !== seed.vaultId) {
          await this.migrateLocalUserId(u.id, seed.vaultId, seed.username, seed.roohKeyHash);
        }
      }
    }
  }

  async hasAnyUser(): Promise<boolean> {
    const hasLocal = await this.local.hasAnyUser();
    if (hasLocal) return true;
    return this.cloud.hasAnyUser();
  }

  async registerUser(username: string): Promise<RegisterResult> {
    const seed = findCanonicalSeedByInput(username);
    if (seed) {
      throw new Error(
        `Vault "${seed.username}" already exists globally (UID ${seed.vaultId}). Switch to Sign In and enter your Rooh Key.`
      );
    }

    // Check if username already exists in Cloud before creating locally
    const existingCloudUid = await this.cloud.resolveVaultUidByUsername(username).catch(() => null);
    if (existingCloudUid) {
      throw new Error('A vault already exists for this username. Switch to Sign In to unlock.');
    }

    // 1. Create locally in IndexedDB
    const localResult = await this.local.registerUser(username);

    // 2. Sync to Cloud Firestore immediately so it is accessible from any other browser
    try {
      await this.cloud.syncUserToCloud(localResult.user);
    } catch (err) {
      console.warn('Cloud sync registration notice:', err);
    }

    return localResult;
  }

  async authenticateUser(usernameOrVaultId: string, roohKey: string): Promise<LoginResult> {
    const cleanInput = usernameOrVaultId.trim();
    const cleanLower = cleanInput.toLowerCase();
    const normalizedKey = normalizeRoohKey(roohKey);

    if (!cleanInput || !normalizedKey) {
      throw new Error('Username (or Vault ID) and Rooh Key are required.');
    }
    if (!isValidRoohKeyFormat(normalizedKey)) {
      throw new Error('ACCESS DENIED: Invalid Rooh Key format (expected ROOH-XXXX-XXXX-XXXX).');
    }

    await this.reconcileCanonicalLocalUsers();
    const seed = findCanonicalSeedByInput(cleanInput);

    // 1. Check local IndexedDB by ID, username, or canonical seed
    let localUser = await db.users
      .filter((u) => {
        if (u.id.toLowerCase() === cleanLower) return true;
        if (u.username.toLowerCase() === cleanLower) return true;
        if (seed) {
          return (
            u.id.toLowerCase() === seed.vaultId.toLowerCase() ||
            u.username.toLowerCase() === seed.usernameLower ||
            (seed.aliases?.some((a) => a.toLowerCase() === u.username.toLowerCase()) ?? false) ||
            seed.legacyVaultIds.some((lid) => lid.toLowerCase() === u.id.toLowerCase())
          );
        }
        return false;
      })
      .first();

    if (localUser) {
      let localKeyValid = await verifySecret(normalizedKey, localUser.roohKeyHash);
      if (!localKeyValid && seed) {
        const seedKeyValid = await verifySecret(normalizedKey, seed.roohKeyHash);
        if (seedKeyValid) {
          localKeyValid = true;
          await db.users
            .update(localUser.id, { roohKeyHash: seed.roohKeyHash, updatedAt: Date.now() })
            .catch(() => {});
          localUser = { ...localUser, roohKeyHash: seed.roohKeyHash };
        }
      }
      if (localKeyValid) {
        if (seed && localUser.id !== seed.vaultId) {
          await this.migrateLocalUserId(localUser.id, seed.vaultId, seed.username, seed.roohKeyHash);
          localUser = (await db.users.get(seed.vaultId)) || {
            ...localUser,
            id: seed.vaultId,
            username: seed.username,
          };
        }

        const prefs = await this.local.getPreferences(localUser.id);
        const now = Date.now();
        const session: SessionRecord = {
          id: generateUuid(),
          userId: localUser.id,
          username: localUser.username,
          token: generateSessionToken(),
          createdAt: now,
          expiresAt: now + prefs.sessionDurationMinutes * 60 * 1000,
        };
        await db.sessions.add(session);
        sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, session.id);

        // Sync user, pull remote updates from other browsers, and push local files to cloud
        await this.cloud.syncUserToCloud(localUser, prefs).catch(() => {});
        await this.mergeCloudToLocal(localUser.id, localUser).catch(() => {});
        this.syncLocalToCloud(localUser.id).catch(() => {});

        return { user: localUser, session };
      }
      // If local key failed (e.g., key rotated on another browser), fall through to verify against Cloud!
    }

    // 2. Authenticate against Cloud Firestore (supports any browser, incognito, or Vault UUID / canonical seed)
    const cloudResult = await this.cloud.authenticateUser(cleanInput, normalizedKey);

    // If local browser had a legacy user for the same username, migrate its local files into cloudResult.user.id!
    if (localUser && localUser.id !== cloudResult.user.id) {
      await this.migrateLocalUserId(
        localUser.id,
        cloudResult.user.id,
        cloudResult.user.username,
        cloudResult.user.roohKeyHash
      );
    }

    // 3. Cache cloud user, create local session, and merge cloud items without overwriting local blobs
    await this.pullCloudToLocal(cloudResult.user.id, cloudResult.user, cloudResult.session);

    // 4. Push any pre-existing local-only files up to cloud in background
    this.syncLocalToCloud(cloudResult.user.id).catch(() => {});

    return cloudResult;
  }

  /**
   * Merges cloud vault metadata into local IndexedDB WITHOUT wiping already-cached local file Blobs.
   */
  async mergeCloudToLocal(userId: string, userRecord?: UserRecord): Promise<boolean> {
    try {
      if (userRecord) {
        const existingUser = await db.users.get(userId);
        if (!existingUser) {
          await db.users.put(userRecord);
        } else if (
          existingUser.username !== userRecord.username ||
          existingUser.roohKeyHash !== userRecord.roohKeyHash
        ) {
          await db.users.put({ ...existingUser, ...userRecord });
        }
      }

      const [cloudFolders, cloudFiles, cloudNotes, cloudBookmarks, cloudTags, cloudPrefs] =
        await Promise.all([
          this.cloud.listFolders(userId).catch(() => null),
          this.cloud.listFiles(userId).catch(() => null),
          this.cloud.listNotes(userId).catch(() => null),
          this.cloud.listBookmarks(userId).catch(() => null),
          this.cloud.listTags(userId).catch(() => null),
          this.cloud.getPreferences(userId).catch(() => null),
        ]);

      let changed = false;

      if (cloudFolders && cloudFolders.length > 0) {
        await db.folders.bulkPut(cloudFolders);
        changed = true;
      }
      if (cloudNotes && cloudNotes.length > 0) {
        await db.notes.bulkPut(cloudNotes);
        changed = true;
      }
      if (cloudBookmarks && cloudBookmarks.length > 0) {
        await db.bookmarks.bulkPut(cloudBookmarks);
        changed = true;
      }
      if (cloudTags && cloudTags.length > 0) {
        await db.tags.bulkPut(cloudTags);
        changed = true;
      }

      if (cloudFiles && cloudFiles.length > 0) {
        const mergedFiles: FileRecord[] = [];
        for (const cf of cloudFiles) {
          const existing = await db.files.get(cf.id);
          if (existing) {
            const keepContent =
              existing.content && existing.content.size > 0 ? existing.content : cf.content;
            mergedFiles.push({
              ...cf,
              content: keepContent,
              driveFileId: cf.driveFileId || existing.driveFileId,
              cloudSynced: cf.cloudSynced || existing.cloudSynced,
              chunkCount: cf.chunkCount || existing.chunkCount,
            });
          } else {
            mergedFiles.push(cf);
          }
        }
        await db.files.bulkPut(mergedFiles);
        changed = true;
      }

      if (cloudPrefs) {
        const key = `${PREFS_PREFIX}${userId}`;
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, JSON.stringify(cloudPrefs));
        }
      }

      return changed;
    } catch (err) {
      console.warn('Error merging cloud vault into local IndexedDB:', err);
      return false;
    }
  }

  /**
   * Pulls all cloud vault items and ensures a local session exists for this browser.
   */
  async pullCloudToLocal(
    userId: string,
    userRecord: UserRecord,
    existingSession?: SessionRecord
  ): Promise<void> {
    await this.mergeCloudToLocal(userId, userRecord);

    const now = Date.now();
    const session: SessionRecord = existingSession || {
      id: generateUuid(),
      userId: userRecord.id,
      username: userRecord.username,
      token: generateSessionToken(),
      createdAt: now,
      expiresAt: now + 120 * 60 * 1000,
    };
    await db.sessions.put(session);
    sessionStorage.setItem(ACTIVE_SESSION_ID_KEY, session.id);
  }

  /**
   * Resolves the binary Blob for any file (local IndexedDB -> Google Drive -> Firestore chunks)
   * and caches fetched remote Blobs locally in IndexedDB for instant subsequent access.
   */
  async resolveFileBlob(userId: string, file: FileRecord): Promise<Blob> {
    if (file.content && file.content.size > 0) {
      return file.content;
    }

    const localRec = await db.files.get(file.id);
    if (localRec && localRec.content && localRec.content.size > 0) {
      return localRec.content;
    }

    if (file.size === 0) {
      return new Blob([], { type: file.mimeType || 'application/octet-stream' });
    }

    const driveId = file.driveFileId || localRec?.driveFileId;
    if (driveId && getDriveAccessToken()) {
      try {
        const driveBlob = await downloadBlobFromDrive(driveId, file.mimeType);
        if (driveBlob.size > 0) {
          await db.files
            .update(file.id, { content: driveBlob, cloudSynced: true, driveFileId: driveId })
            .catch(() => {});
          return driveBlob;
        }
      } catch (err) {
        console.warn('Google Drive download fallback to Firestore:', err);
      }
    }

    const chunkCount = file.chunkCount ?? localRec?.chunkCount ?? 0;
    if (chunkCount > 0 || file.size <= MAX_CLOUD_FILE_BYTES) {
      const cloudBlob = await this.cloud.resolveFileBlob(userId, file);
      if (cloudBlob.size > 0) {
        await db.files.update(file.id, { content: cloudBlob, cloudSynced: true }).catch(() => {});
        return cloudBlob;
      }
    }

    if (driveId && !getDriveAccessToken()) {
      throw new Error(
        `File "${file.name}" is backed up in Google Drive. Connect Google Drive in Settings to access it on this browser.`
      );
    }

    throw new Error(
      `File "${file.name}" binary payload is not yet synced to Cloud or Google Drive from the original browser.`
    );
  }

  /**
   * Syncs all local IndexedDB user records, folders, notes, bookmarks, tags, AND binary files
   * to Cloud Firestore (<= 10 MB) and/or Google Drive (any size when connected).
   */
  async syncLocalToCloud(
    userId: string,
    options?: { includeGoogleDrive?: boolean }
  ): Promise<CloudSyncSummary> {
    const summary: CloudSyncSummary = {
      syncedFiles: 0,
      syncedDriveFiles: 0,
      largeFilesPendingDrive: 0,
      syncedFolders: 0,
      syncedNotes: 0,
      syncedBookmarks: 0,
    };

    try {
      await this.reconcileCanonicalLocalUsers();
      const seed = findCanonicalSeedByInput(userId);
      const effectiveUserId = seed ? seed.vaultId : userId;

      const user = await db.users.get(effectiveUserId);
      const prefs = await this.local.getPreferences(effectiveUserId);
      if (user) {
        await this.cloud.syncUserToCloud(user, prefs);
      }

      const [folders, files, notes, bookmarks, tags] = await Promise.all([
        db.folders.where('userId').equals(effectiveUserId).toArray(),
        db.files.where('userId').equals(effectiveUserId).toArray(),
        db.notes.where('userId').equals(effectiveUserId).toArray(),
        db.bookmarks.where('userId').equals(effectiveUserId).toArray(),
        db.tags.where('userId').equals(effectiveUserId).toArray(),
      ]);

      await this.cloud.savePreferences(effectiveUserId, prefs).catch(() => {});

      for (const f of folders) {
        await this.cloud.upsertFolder(effectiveUserId, f).catch(() => {});
        summary.syncedFolders += 1;
      }

      for (const n of notes) {
        await this.cloud.upsertNote(effectiveUserId, n).catch(() => {});
        summary.syncedNotes += 1;
      }

      for (const b of bookmarks) {
        await this.cloud.upsertBookmark(effectiveUserId, b).catch(() => {});
        summary.syncedBookmarks += 1;
      }

      for (const t of tags) {
        await this.cloud.upsertTag(effectiveUserId, t).catch(() => {});
      }

      const driveToken = getDriveAccessToken();

      for (const file of files) {
        const blob = file.content;
        let driveFileId = file.driveFileId;

        if (blob && blob.size > 0) {
          const shouldUploadToDrive =
            Boolean(driveToken) &&
            !driveFileId &&
            (Boolean(options?.includeGoogleDrive) || blob.size > MAX_CLOUD_FILE_BYTES);

          if (shouldUploadToDrive) {
            try {
              const res = await uploadBlobToDrive(
                effectiveUserId,
                file.id,
                file.name,
                file.mimeType,
                blob
              );
              driveFileId = res.driveFileId;
              summary.syncedDriveFiles += 1;
              await db.files.update(file.id, { driveFileId, cloudSynced: true }).catch(() => {});
            } catch (err) {
              console.warn(`Google Drive backup skipped for "${file.name}":`, err);
            }
          } else if (blob.size > MAX_CLOUD_FILE_BYTES && !driveFileId) {
            summary.largeFilesPendingDrive += 1;
          }

          let firestoreOk = false;
          try {
            await this.cloud.upsertFileRecord(
              effectiveUserId,
              { ...file, driveFileId },
              blob,
              driveFileId
            );
            firestoreOk = true;
          } catch {
            firestoreOk = false;
          }

          if (!firestoreOk && driveToken && !driveFileId) {
            try {
              const res = await uploadBlobToDrive(
                effectiveUserId,
                file.id,
                file.name,
                file.mimeType,
                blob
              );
              driveFileId = res.driveFileId;
              summary.syncedDriveFiles += 1;
              await this.cloud
                .upsertFileRecord(effectiveUserId, { ...file, driveFileId }, undefined, driveFileId)
                .catch(() => {});
            } catch (err) {
              console.warn(`Google Drive fallback skipped for "${file.name}":`, err);
            }
          }

          if ((firestoreOk && blob.size <= MAX_CLOUD_FILE_BYTES) || driveFileId) {
            await db.files
              .update(file.id, { cloudSynced: true, ...(driveFileId ? { driveFileId } : {}) })
              .catch(() => {});
            summary.syncedFiles += 1;
          }
        } else {
          await this.cloud.upsertFileRecord(effectiveUserId, file, undefined, driveFileId).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Background sync to cloud notice:', err);
    }

    return summary;
  }

  /**
   * Discovers files already stored in Google Drive folder `rooh.clouds/<vaultUid>`
   * and links/imports them into local IndexedDB and Cloud Firestore metadata so they
   * appear across every browser.
   */
  async reconcileDriveFiles(userId: string): Promise<boolean> {
    if (!getDriveAccessToken()) return false;

    const seed = findCanonicalSeedByInput(userId);
    const effectiveUserId = seed ? seed.vaultId : userId;

    try {
      const driveFiles = await listVaultDriveFiles(effectiveUserId);
      if (driveFiles.length === 0) return false;

      const existingFiles = await db.files.where('userId').equals(effectiveUserId).toArray();
      let changed = false;

      for (const df of driveFiles) {
        if (df.mimeType === 'application/vnd.google-apps.folder') continue;

        const match = existingFiles.find(
          (f) =>
            f.driveFileId === df.driveFileId ||
            (df.roohFileId && f.id === df.roohFileId) ||
            (!f.driveFileId && f.name === df.name && f.size === df.size)
        );

        if (match) {
          if (match.driveFileId !== df.driveFileId || !match.cloudSynced) {
            await db.files
              .update(match.id, { driveFileId: df.driveFileId, cloudSynced: true })
              .catch(() => {});
            await this.cloud
              .upsertFileRecord(
                effectiveUserId,
                { ...match, driveFileId: df.driveFileId },
                undefined,
                df.driveFileId
              )
              .catch(() => {});
            match.driveFileId = df.driveFileId;
            match.cloudSynced = true;
            changed = true;
          }
          continue;
        }

        const safeName = sanitizeFileName(df.name || 'drive-file');
        const mimeType = df.mimeType || 'application/octet-stream';
        const now = Date.now();
        const newRecord: FileRecord = {
          id: df.roohFileId || generateUuid(),
          userId: effectiveUserId,
          folderId: null,
          name: safeName,
          mimeType,
          category: detectFileCategory(mimeType, safeName),
          extension: getFileExtension(safeName),
          size: df.size,
          content: new Blob([], { type: mimeType }),
          isEncrypted: false,
          tags: [],
          isFavorite: false,
          driveFileId: df.driveFileId,
          cloudSynced: true,
          createdAt: now,
          updatedAt: now,
        };

        await db.files.put(newRecord);
        await this.cloud
          .upsertFileRecord(effectiveUserId, newRecord, undefined, df.driveFileId)
          .catch(() => {});
        existingFiles.push(newRecord);
        changed = true;
      }

      return changed;
    } catch (err) {
      console.warn('Google Drive reconciliation notice:', err);
      return false;
    }
  }

  /**
   * Counts local files on this browser stored under other local user IDs (e.g. created
   * prior to linking the canonical UID) so they can optionally be consolidated.
   */
  async countOtherLocalVaultFiles(targetUserId: string): Promise<number> {
    const seed = findCanonicalSeedByInput(targetUserId);
    const effectiveUserId = seed ? seed.vaultId : targetUserId;
    const allFiles = await db.files.toArray();
    return allFiles.filter((f) => f.userId !== effectiveUserId).length;
  }

  /**
   * Moves any locally saved IndexedDB vault items from other local browser profiles into
   * the active vault UID (e.g. d6a19222-fefb-4c0e-b3b4-f7a725488caa) and triggers sync.
   */
  async consolidateOtherLocalVaults(targetUserId: string): Promise<number> {
    const seed = findCanonicalSeedByInput(targetUserId);
    const effectiveUserId = seed ? seed.vaultId : targetUserId;
    const allFiles = await db.files.toArray();
    const otherUserIds = Array.from(
      new Set(allFiles.map((f) => f.userId).filter((uid) => uid && uid !== effectiveUserId))
    );
    let movedCount = 0;

    for (const oldUid of otherUserIds) {
      const count = allFiles.filter((f) => f.userId === oldUid).length;
      await this.migrateLocalUserId(oldUid, effectiveUserId, seed?.username, seed?.roohKeyHash);
      movedCount += count;
    }

    if (movedCount > 0) {
      await this.syncBidirectional(effectiveUserId, { includeGoogleDrive: Boolean(getDriveAccessToken()) });
    }
    return movedCount;
  }

  /**
   * Bidirectional sync: pulls remote items into local IndexedDB (preserving local Blobs),
   * reconciles Google Drive files in `rooh.clouds/<uid>`, and pushes all local items up.
   */
  async syncBidirectional(
    userId: string,
    options?: { includeGoogleDrive?: boolean }
  ): Promise<{ pulledUpdates: boolean; pushSummary: CloudSyncSummary }> {
    await this.reconcileCanonicalLocalUsers();
    const seed = findCanonicalSeedByInput(userId);
    const effectiveUserId = seed ? seed.vaultId : userId;

    const localUser = await db.users.get(effectiveUserId);
    if (localUser) {
      await this.cloud.syncUserToCloud(localUser).catch(() => {});
    }

    const pulledCloud = await this.mergeCloudToLocal(effectiveUserId, localUser || undefined);
    const pulledDrive = await this.reconcileDriveFiles(effectiveUserId);
    const pushSummary = await this.syncLocalToCloud(effectiveUserId, options);
    return { pulledUpdates: pulledCloud || pulledDrive, pushSummary };
  }

  async verifyRoohKey(userId: string, roohKey: string): Promise<boolean> {
    const localOk = await this.local.verifyRoohKey(userId, roohKey);
    if (localOk) return true;
    return this.cloud.verifyRoohKey(userId, roohKey);
  }

  async getActiveSession(): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    await this.reconcileCanonicalLocalUsers();
    const localSession = await this.local.getActiveSession();
    if (localSession) {
      const seed = findCanonicalSeedByInput(localSession.user.username);
      if (seed && localSession.user.id !== seed.vaultId) {
        await this.migrateLocalUserId(
          localSession.user.id,
          seed.vaultId,
          seed.username,
          seed.roohKeyHash
        );
        const migratedUser = (await db.users.get(seed.vaultId)) || {
          ...localSession.user,
          id: seed.vaultId,
          username: seed.username,
        };
        return {
          session: { ...localSession.session, userId: seed.vaultId, username: seed.username },
          user: migratedUser,
        };
      }
      return localSession;
    }
    return this.cloud.getActiveSession();
  }

  async logout(sessionId: string): Promise<void> {
    await Promise.all([
      this.local.logout(sessionId).catch(() => {}),
      this.cloud.logout(sessionId).catch(() => {}),
    ]);
  }

  async rotateRoohKey(userId: string, currentRoohKey: string): Promise<string> {
    const newKey = await this.local.rotateRoohKey(userId, currentRoohKey);
    try {
      await this.cloud.rotateRoohKey(userId, currentRoohKey);
    } catch (err) {
      console.warn('Cloud key rotation notice:', err);
    }
    return newKey;
  }

  async deleteAccount(userId: string, roohKey: string): Promise<void> {
    await Promise.all([
      this.local.deleteAccount(userId, roohKey).catch(() => {}),
      this.cloud.deleteAccount(userId, roohKey).catch(() => {}),
    ]);
  }

  async seedDemoVault(): Promise<LoginResult> {
    return this.local.seedDemoVault();
  }

  // Folders
  async listFolders(userId: string): Promise<FolderRecord[]> {
    return this.local.listFolders(userId);
  }

  async createFolder(userId: string, name: string, parentId: string | null): Promise<FolderRecord> {
    const folder = await this.local.createFolder(userId, name, parentId);
    this.cloud.upsertFolder(userId, folder).catch(() => {});
    return folder;
  }

  async renameFolder(userId: string, folderId: string, newName: string): Promise<FolderRecord> {
    const folder = await this.local.renameFolder(userId, folderId, newName);
    this.cloud.renameFolder(userId, folderId, newName).catch(() => {
      this.cloud.upsertFolder(userId, folder).catch(() => {});
    });
    return folder;
  }

  async moveFolder(userId: string, folderId: string, targetParentId: string | null): Promise<void> {
    await this.local.moveFolder(userId, folderId, targetParentId);
    this.cloud.moveFolder(userId, folderId, targetParentId).catch(async () => {
      const f = await db.folders.get(folderId);
      if (f) await this.cloud.upsertFolder(userId, f).catch(() => {});
    });
  }

  async toggleFolderFavorite(userId: string, folderId: string): Promise<FolderRecord> {
    const folder = await this.local.toggleFolderFavorite(userId, folderId);
    this.cloud.toggleFolderFavorite(userId, folderId).catch(() => {
      this.cloud.upsertFolder(userId, folder).catch(() => {});
    });
    return folder;
  }

  async deleteFolderToTrash(userId: string, folderId: string): Promise<void> {
    await this.local.deleteFolderToTrash(userId, folderId);
    this.cloud.deleteFolderToTrash(userId, folderId).catch(() => {});
  }

  // Files
  async listFiles(userId: string): Promise<FileRecord[]> {
    return this.local.listFiles(userId);
  }

  async uploadFile(
    userId: string,
    file: File,
    folderId: string | null,
    callbacks?: UploadProgressCallbacks
  ): Promise<FileRecord> {
    const seed = findCanonicalSeedByInput(userId);
    const effectiveUserId = seed ? seed.vaultId : userId;
    const localFile = await this.local.uploadFile(effectiveUserId, file, folderId, callbacks);

    // Sync exact file ID & binary payload to Firestore (<= 10 MB) and/or Google Drive (if connected)
    const syncInBackground = async () => {
      let driveFileId = localFile.driveFileId;
      const payloadBlob = localFile.content;

      if (getDriveAccessToken() && payloadBlob.size > MAX_CLOUD_FILE_BYTES) {
        try {
          const uploaded = await uploadBlobToDrive(
            effectiveUserId,
            localFile.id,
            localFile.name,
            localFile.mimeType,
            payloadBlob
          );
          driveFileId = uploaded.driveFileId;
          await db.files.update(localFile.id, { driveFileId, cloudSynced: true }).catch(() => {});
        } catch (err) {
          console.warn('Google Drive overflow upload notice:', err);
        }
      }

      let firestoreOk = false;
      try {
        await this.cloud.upsertFileRecord(effectiveUserId, localFile, payloadBlob, driveFileId);
        firestoreOk = true;
      } catch {
        firestoreOk = false;
      }

      if (!firestoreOk && getDriveAccessToken() && !driveFileId && payloadBlob.size > 0) {
        try {
          const uploaded = await uploadBlobToDrive(
            effectiveUserId,
            localFile.id,
            localFile.name,
            localFile.mimeType,
            payloadBlob
          );
          driveFileId = uploaded.driveFileId;
          await this.cloud
            .upsertFileRecord(effectiveUserId, { ...localFile, driveFileId }, undefined, driveFileId)
            .catch(() => {});
        } catch (err) {
          console.warn('Google Drive fallback upload notice:', err);
        }
      }

      if ((firestoreOk && payloadBlob.size <= MAX_CLOUD_FILE_BYTES) || driveFileId) {
        await db.files
          .update(localFile.id, { cloudSynced: true, ...(driveFileId ? { driveFileId } : {}) })
          .catch(() => {});
      }
    };

    syncInBackground().catch((err) => {
      console.warn('Cloud file sync notice:', err);
    });

    return localFile;
  }

  async renameFile(userId: string, fileId: string, newName: string): Promise<FileRecord> {
    const rec = await this.local.renameFile(userId, fileId, newName);
    this.cloud.renameFile(userId, fileId, newName).catch(() => {
      this.cloud.upsertFileRecord(userId, rec, rec.content).catch(() => {});
    });
    return rec;
  }

  async moveFile(userId: string, fileId: string, targetFolderId: string | null): Promise<void> {
    await this.local.moveFile(userId, fileId, targetFolderId);
    this.cloud.moveFile(userId, fileId, targetFolderId).catch(async () => {
      const f = await db.files.get(fileId);
      if (f) await this.cloud.upsertFileRecord(userId, f, f.content).catch(() => {});
    });
  }

  async toggleFileFavorite(userId: string, fileId: string): Promise<FileRecord> {
    const rec = await this.local.toggleFileFavorite(userId, fileId);
    this.cloud.toggleFileFavorite(userId, fileId).catch(() => {
      this.cloud.upsertFileRecord(userId, rec, rec.content).catch(() => {});
    });
    return rec;
  }

  async updateFileTags(userId: string, fileId: string, tags: string[]): Promise<FileRecord> {
    const rec = await this.local.updateFileTags(userId, fileId, tags);
    this.cloud.updateFileTags(userId, fileId, tags).catch(() => {
      this.cloud.upsertFileRecord(userId, rec, rec.content).catch(() => {});
    });
    return rec;
  }

  async deleteFileToTrash(userId: string, fileId: string): Promise<void> {
    await this.local.deleteFileToTrash(userId, fileId);
    this.cloud.deleteFileToTrash(userId, fileId).catch(() => {});
  }

  // Notes
  async listNotes(userId: string): Promise<NoteRecord[]> {
    return this.local.listNotes(userId);
  }

  async createNote(
    userId: string,
    title?: string,
    content?: string,
    folderId?: string | null
  ): Promise<NoteRecord> {
    const note = await this.local.createNote(userId, title, content, folderId);
    this.cloud.upsertNote(userId, note).catch(() => {});
    return note;
  }

  async updateNote(
    userId: string,
    noteId: string,
    updates: Partial<Pick<NoteRecord, 'title' | 'content' | 'tags' | 'isFavorite' | 'folderId'>>
  ): Promise<NoteRecord> {
    const note = await this.local.updateNote(userId, noteId, updates);
    this.cloud.updateNote(userId, noteId, updates).catch(() => {
      this.cloud.upsertNote(userId, note).catch(() => {});
    });
    return note;
  }

  async deleteNoteToTrash(userId: string, noteId: string): Promise<void> {
    await this.local.deleteNoteToTrash(userId, noteId);
    this.cloud.deleteNoteToTrash(userId, noteId).catch(() => {});
  }

  // Bookmarks
  async listBookmarks(userId: string): Promise<BookmarkRecord[]> {
    return this.local.listBookmarks(userId);
  }

  async createBookmark(
    userId: string,
    input: {
      url: string;
      title: string;
      description: string;
      faviconUrl: string;
      tags: string[];
      isFavorite?: boolean;
    }
  ): Promise<BookmarkRecord> {
    const bm = await this.local.createBookmark(userId, input);
    this.cloud.upsertBookmark(userId, bm).catch(() => {});
    return bm;
  }

  async updateBookmark(
    userId: string,
    bookmarkId: string,
    updates: Partial<Pick<BookmarkRecord, 'url' | 'title' | 'description' | 'tags' | 'isFavorite'>>
  ): Promise<BookmarkRecord> {
    const bm = await this.local.updateBookmark(userId, bookmarkId, updates);
    this.cloud.updateBookmark(userId, bookmarkId, updates).catch(() => {
      this.cloud.upsertBookmark(userId, bm).catch(() => {});
    });
    return bm;
  }

  async deleteBookmarkToTrash(userId: string, bookmarkId: string): Promise<void> {
    await this.local.deleteBookmarkToTrash(userId, bookmarkId);
    this.cloud.deleteBookmarkToTrash(userId, bookmarkId).catch(() => {});
  }

  // Tags
  async listTags(userId: string): Promise<TagRecord[]> {
    return this.local.listTags(userId);
  }

  // Trash
  async listTrash(userId: string): Promise<TrashRecord[]> {
    return this.local.listTrash(userId);
  }

  async restoreTrashItem(userId: string, trashId: string): Promise<void> {
    await this.local.restoreTrashItem(userId, trashId);
    this.cloud.restoreTrashItem(userId, trashId).catch(() => {});
  }

  async permanentlyDeleteTrashItem(userId: string, trashId: string): Promise<void> {
    await this.local.permanentlyDeleteTrashItem(userId, trashId);
    this.cloud.permanentlyDeleteTrashItem(userId, trashId).catch(() => {});
  }

  async emptyTrash(userId: string): Promise<void> {
    await this.local.emptyTrash(userId);
    this.cloud.emptyTrash(userId).catch(() => {});
  }

  // Analytics & Preferences
  async getStorageAnalytics(userId: string): Promise<StorageAnalytics> {
    return this.local.getStorageAnalytics(userId);
  }

  async getPreferences(userId: string): Promise<VaultPreferences> {
    return this.local.getPreferences(userId);
  }

  async savePreferences(userId: string, prefs: VaultPreferences): Promise<void> {
    await this.local.savePreferences(userId, prefs);
    this.cloud.savePreferences(userId, prefs).catch(() => {});
  }

  // Export / Import
  async exportArchive(userId: string): Promise<VaultArchive> {
    const user = await db.users.get(userId);
    if (!user) throw new Error('User not found.');

    const [folders, files, notes, bookmarks, tags, trash] = await Promise.all([
      this.listFolders(userId),
      this.listFiles(userId),
      this.listNotes(userId),
      this.listBookmarks(userId),
      this.listTags(userId),
      this.listTrash(userId),
    ]);

    const serializedFiles = [];
    for (const f of files) {
      let blob = f.content;
      if ((!blob || blob.size === 0) && f.size > 0) {
        blob = await this.resolveFileBlob(userId, f).catch(() => f.content);
      }
      const base64Content = await blobToBase64(blob);
      serializedFiles.push({
        id: f.id,
        name: f.name,
        folderId: f.folderId,
        mimeType: f.mimeType,
        category: f.category,
        extension: f.extension,
        size: f.size,
        base64Content,
        driveFileId: f.driveFileId,
        isEncrypted: f.isEncrypted,
        encryptionMeta: f.encryptionMeta,
        tags: f.tags,
        isFavorite: f.isFavorite,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      });
    }

    return {
      schemaVersion: 1,
      app: 'rooh.clouds',
      exportedAt: Date.now(),
      vaultId: user.id,
      username: user.username,
      folders: folders.map(({ userId: _u, ...rest }) => rest),
      files: serializedFiles,
      notes: notes.map(({ userId: _u, ...rest }) => rest),
      bookmarks: bookmarks.map(({ userId: _u, ...rest }) => rest),
      tags: tags.map(({ userId: _u, ...rest }) => rest),
      trash: trash.map(({ userId: _u, ...rest }) => rest),
    };
  }

  async importArchive(
    userId: string,
    rawArchive: unknown
  ): Promise<{
    importedFiles: number;
    importedFolders: number;
    importedNotes: number;
    importedBookmarks: number;
  }> {
    const result = await this.local.importArchive(userId, rawArchive);
    this.syncLocalToCloud(userId).catch(() => {});
    return result;
  }

  async clearCache(): Promise<void> {
    await Promise.all([
      this.local.clearCache().catch(() => {}),
      this.cloud.clearCache().catch(() => {}),
    ]);
  }
}
