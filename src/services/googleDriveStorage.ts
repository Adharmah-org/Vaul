import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import { auth } from '../firebase';

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const driveProvider = new GoogleAuthProvider();
for (const scope of DRIVE_SCOPES) {
  driveProvider.addScope(scope);
}

let isSigningIn = false;
// Access token is strictly cached in memory only (never localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let cachedDriveUser: { email: string | null; displayName: string | null } | null = null;

export interface DriveConnectionStatus {
  connected: boolean;
  email: string | null;
  displayName: string | null;
}

export function initDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthCleared?: () => void
): () => void {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      cachedDriveUser = {
        email: user.email,
        displayName: user.displayName,
      };
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!user || !isSigningIn) {
      if (!user) {
        cachedAccessToken = null;
        cachedDriveUser = null;
      }
      onAuthCleared?.();
    }
  });
}

export async function connectGoogleDrive(): Promise<DriveConnectionStatus> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Drive authorization did not return an access token.');
    }
    cachedAccessToken = credential.accessToken;
    cachedDriveUser = {
      email: result.user.email,
      displayName: result.user.displayName,
    };
    return {
      connected: true,
      email: cachedDriveUser.email,
      displayName: cachedDriveUser.displayName,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function disconnectGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  cachedDriveUser = null;
  await auth.signOut();
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export function getDriveConnectionStatus(): DriveConnectionStatus {
  return {
    connected: Boolean(cachedAccessToken),
    email: cachedDriveUser?.email ?? null,
    displayName: cachedDriveUser?.displayName ?? null,
  };
}

function requireDriveToken(): string {
  if (!cachedAccessToken) {
    throw new Error('Google Drive is not connected. Connect Google Drive in Settings first.');
  }
  return cachedAccessToken;
}

async function driveJsonFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = requireDriveToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please reconnect Google Drive in Settings.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Google Drive API error (${res.status}): ${text}`);
  }
  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

async function findDriveFolder(name: string, parentId?: string): Promise<string | null> {
  const escapedName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : ` and 'root' in parents`;
  const q = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id, name)',
    pageSize: '5',
  });
  const data = await driveJsonFetch<{ files?: Array<{ id: string; name: string }> }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  );
  return data.files?.[0]?.id ?? null;
}

async function createDriveFolder(name: string, parentId?: string): Promise<string> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    body.parents = [parentId];
  }
  const created = await driveJsonFetch<{ id: string }>(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  return created.id;
}

export async function ensureVaultDriveFolder(vaultUid: string): Promise<string> {
  let rootFolderId = await findDriveFolder('rooh.clouds');
  if (!rootFolderId) {
    rootFolderId = await createDriveFolder('rooh.clouds');
  }

  let vaultFolderId = await findDriveFolder(vaultUid, rootFolderId);
  if (!vaultFolderId) {
    vaultFolderId = await createDriveFolder(vaultUid, rootFolderId);
  }
  return vaultFolderId;
}

async function findExistingVaultFileInDrive(
  vaultFolderId: string,
  roohFileId: string
): Promise<string | null> {
  const escapedId = roohFileId.replace(/'/g, "\\'");
  const q = `'${vaultFolderId}' in parents and trashed = false and appProperties has { key='roohFileId' and value='${escapedId}' }`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id)',
    pageSize: '1',
  });
  const data = await driveJsonFetch<{ files?: Array<{ id: string }> }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  );
  return data.files?.[0]?.id ?? null;
}

export async function uploadBlobToDrive(
  vaultUid: string,
  roohFileId: string,
  fileName: string,
  mimeType: string,
  blob: Blob
): Promise<{ driveFileId: string }> {
  const token = requireDriveToken();
  const vaultFolderId = await ensureVaultDriveFolder(vaultUid);
  const existingDriveId = await findExistingVaultFileInDrive(vaultFolderId, roohFileId);

  const metadata = {
    name: fileName,
    mimeType: mimeType || 'application/octet-stream',
    ...(existingDriveId ? {} : { parents: [vaultFolderId] }),
    appProperties: {
      roohVaultUid: vaultUid,
      roohFileId,
    },
  };

  // Use resumable upload protocol so files of any size (including large videos/ZIPs) upload reliably
  const initUrl = existingDriveId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingDriveId)}?uploadType=resumable&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id';

  const initRes = await fetch(initUrl, {
    method: existingDriveId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType || 'application/octet-stream',
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify(metadata),
  });

  if (initRes.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please reconnect Google Drive.');
  }
  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => initRes.statusText);
    throw new Error(`Failed to initiate Google Drive upload: ${errText}`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Google Drive resumable upload did not return an upload Location.');
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType || 'application/octet-stream',
    },
    body: blob,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => uploadRes.statusText);
    throw new Error(`Google Drive upload failed: ${errText}`);
  }

  const uploaded = (await uploadRes.json()) as { id: string };
  return { driveFileId: uploaded.id };
}

export async function downloadBlobFromDrive(
  driveFileId: string,
  mimeType = 'application/octet-stream'
): Promise<Blob> {
  const token = requireDriveToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please reconnect Google Drive in Settings.');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to download file from Google Drive: ${errText}`);
  }
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type: mimeType || 'application/octet-stream' });
}

export async function listVaultDriveFiles(vaultUid: string): Promise<
  Array<{
    driveFileId: string;
    name: string;
    mimeType: string;
    size: number;
    roohFileId?: string;
  }>
> {
  const vaultFolderId = await ensureVaultDriveFolder(vaultUid);
  const params = new URLSearchParams({
    q: `'${vaultFolderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, appProperties)',
    pageSize: '1000',
  });
  const data = await driveJsonFetch<{
    files?: Array<{
      id: string;
      name: string;
      mimeType?: string;
      size?: string;
      appProperties?: Record<string, string>;
    }>;
  }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);

  return (data.files || []).map((f) => ({
    driveFileId: f.id,
    name: f.name,
    mimeType: f.mimeType || 'application/octet-stream',
    size: Number(f.size || 0),
    roohFileId: f.appProperties?.roohFileId,
  }));
}

export async function deleteDriveFile(driveFileId: string): Promise<void> {
  await driveJsonFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`, {
    method: 'DELETE',
  });
}
