import {
  FileCategory,
  SortDirection,
  SortField,
  VaultArchive,
} from '../types/vault';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2']);
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'scss', 'py', 'rs', 'go', 'java',
  'c', 'cpp', 'h', 'sh', 'yaml', 'yml', 'toml', 'sql', 'xml',
]);
const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'txt', 'md', 'markdown', 'rtf', 'csv', 'xls', 'xlsx', 'ppt', 'pptx',
]);

export function getFileExtension(fileName: string): string {
  const clean = fileName.trim();
  const idx = clean.lastIndexOf('.');
  if (idx <= 0 || idx === clean.length - 1) return '';
  return clean.slice(idx + 1).toLowerCase();
}

export function detectFileCategory(mimeType: string, fileName: string): FileCategory {
  const mime = (mimeType || '').toLowerCase();
  const ext = getFileExtension(fileName);

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (ARCHIVE_EXTENSIONS.has(ext) || mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
    return 'archive';
  }
  if (CODE_EXTENSIONS.has(ext) || mime.includes('json') || mime.includes('javascript') || mime.includes('xml')) {
    return 'code';
  }
  if (
    DOCUMENT_EXTENSIONS.has(ext) ||
    mime === 'application/pdf' ||
    mime.startsWith('text/plain') ||
    mime.startsWith('text/markdown') ||
    mime.includes('wordprocessingml') ||
    mime.includes('msword')
  ) {
    return 'document';
  }
  if (mime.startsWith('text/')) return 'document';
  return 'other';
}

export function isTextPreviewable(mimeType: string, fileName: string): boolean {
  const ext = getFileExtension(fileName);
  const mime = (mimeType || '').toLowerCase();
  if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'csv' || ext === 'log') return true;
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return true;
  return false;
}

export function isMarkdownFile(mimeType: string, fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return ext === 'md' || ext === 'markdown' || mimeType.toLowerCase() === 'text/markdown';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 10 || exp === 0 ? value.toFixed(exp === 0 ? 0 : 1) : value.toFixed(2)} ${units[exp]}`;
}

export function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'Unknown';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'Unknown';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sanitizeFileName(raw: string): string {
  const stripped = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return stripped.length > 0 ? stripped.slice(0, 180) : 'untitled';
}

export function resolveDuplicateName(desiredName: string, existingNames: string[]): string {
  const existingSet = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!existingSet.has(desiredName.toLowerCase())) {
    return desiredName;
  }

  const dotIndex = desiredName.lastIndexOf('.');
  const hasExt = dotIndex > 0 && dotIndex < desiredName.length - 1;
  const stem = hasExt ? desiredName.slice(0, dotIndex) : desiredName;
  const ext = hasExt ? desiredName.slice(dotIndex) : '';

  let counter = 1;
  while (counter < 10_000) {
    const candidate = `${stem} (${counter})${ext}`;
    if (!existingSet.has(candidate.toLowerCase())) {
      return candidate;
    }
    counter += 1;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export function isValidHttpUrl(rawUrl: string): { valid: boolean; normalized?: string; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'URL is required.' };
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only http:// and https:// URLs are permitted.' };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      if (parsed.hostname !== 'localhost') {
        return { valid: false, error: 'Please enter a valid domain URL.' };
      }
    }
    return { valid: true, normalized: parsed.toString() };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

export function countWordsAndChars(markdown: string): { words: number; chars: number } {
  const chars = markdown.length;
  const trimmed = markdown.trim();
  if (!trimmed) return { words: 0, chars: 0 };
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return { words, chars };
}

export function normalizeTagInput(tag: string): string {
  return tag.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 32);
}

export function sortItems<T extends { name?: string; title?: string; createdAt: number; updatedAt: number; size?: number; category?: string }>(
  items: T[],
  field: SortField,
  direction: SortDirection
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const nameA = (a.name ?? a.title ?? '').toLowerCase();
    const nameB = (b.name ?? b.title ?? '').toLowerCase();

    switch (field) {
      case 'name':
        return nameA.localeCompare(nameB) * factor;
      case 'createdAt':
        return (a.createdAt - b.createdAt) * factor;
      case 'updatedAt':
        return (a.updatedAt - b.updatedAt) * factor;
      case 'size':
        return ((a.size ?? 0) - (b.size ?? 0)) * factor;
      case 'type':
        return ((a.category ?? '').localeCompare(b.category ?? '') || nameA.localeCompare(nameB)) * factor;
      default:
        return 0;
    }
  });
}

export function validateArchivePayload(payload: unknown): { valid: boolean; archive?: VaultArchive; error?: string } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Archive must be a valid JSON object.' };
  }
  const obj = payload as Record<string, unknown>;
  if (obj.app !== 'rooh.clouds' || obj.schemaVersion !== 1) {
    return { valid: false, error: 'Unsupported archive signature or schema version.' };
  }
  if (
    !Array.isArray(obj.folders) ||
    !Array.isArray(obj.files) ||
    !Array.isArray(obj.notes) ||
    !Array.isArray(obj.bookmarks)
  ) {
    return { valid: false, error: 'Archive is missing required collection arrays.' };
  }

  for (const folder of obj.folders) {
    if (!folder || typeof folder !== 'object' || typeof (folder as Record<string, unknown>).id !== 'string' || typeof (folder as Record<string, unknown>).name !== 'string') {
      return { valid: false, error: 'Archive contains a malformed folder entry.' };
    }
  }

  for (const file of obj.files) {
    const f = file as Record<string, unknown>;
    if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.base64Content !== 'string') {
      return { valid: false, error: 'Archive contains a malformed file entry.' };
    }
  }

  for (const note of obj.notes) {
    const n = note as Record<string, unknown>;
    if (!n || typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.content !== 'string') {
      return { valid: false, error: 'Archive contains a malformed note entry.' };
    }
  }

  for (const bm of obj.bookmarks) {
    const b = bm as Record<string, unknown>;
    if (!b || typeof b.id !== 'string' || typeof b.url !== 'string') {
      return { valid: false, error: 'Archive contains a malformed bookmark entry.' };
    }
    const urlCheck = isValidHttpUrl(b.url);
    if (!urlCheck.valid) {
      return { valid: false, error: `Archive contains an unsafe or invalid bookmark URL: ${b.url}` };
    }
  }

  return { valid: true, archive: payload as VaultArchive };
}
