import JSZip from 'jszip';
import { FileCategory } from '../types/vault';
import { detectFileCategory, getFileExtension, sanitizeFileName } from './fileUtils';

export const MAX_EXTRACTED_FILES = 1000;
export const MAX_TOTAL_EXTRACTED_BYTES = 1024 * 1024 * 1024; // 1 GB safety cap

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  zip: 'application/zip',
};

export interface ExtractedZipItem {
  id: string;
  entryPath: string;
  fileName: string;
  mimeType: string;
  category: FileCategory;
  size: number;
  file: File;
}

export interface ZipExtractionResult {
  zipName: string;
  items: ExtractedZipItem[];
  skippedSystemCount: number;
}

export function inferMimeFromFilename(fileName: string): string {
  const ext = getFileExtension(fileName);
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function sanitizeZipEntryPath(rawPath: string): { safePath: string; safeFileName: string } | null {
  const normalized = rawPath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.endsWith('/')) return null;

  const segments = normalized
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');

  if (segments.length === 0) return null;

  // Ignore macOS / Windows archive metadata artifacts
  if (
    segments[0] === '__MACOSX' ||
    segments[segments.length - 1] === '.DS_Store' ||
    segments[segments.length - 1] === 'Thumbs.db' ||
    segments[segments.length - 1].startsWith('._')
  ) {
    return null;
  }

  const rawLeaf = segments[segments.length - 1];
  const safeFileName = sanitizeFileName(rawLeaf);
  const safePath = [...segments.slice(0, -1).map(sanitizeFileName), safeFileName].join('/');
  return { safePath, safeFileName };
}

export async function extractZipArchive(
  zipSource: Blob | File | ArrayBuffer | Uint8Array,
  zipName = 'archive.zip'
): Promise<ZipExtractionResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipSource);
  } catch {
    throw new Error(`Unable to open "${zipName}" as a valid ZIP archive.`);
  }

  const items: ExtractedZipItem[] = [];
  let skippedSystemCount = 0;
  let totalBytes = 0;

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;

    const sanitized = sanitizeZipEntryPath(entry.name);
    if (!sanitized) {
      skippedSystemCount += 1;
      continue;
    }

    if (items.length >= MAX_EXTRACTED_FILES) {
      throw new Error(
        `Archive exceeds maximum extractable file limit (${MAX_EXTRACTED_FILES} files).`
      );
    }

    const bytes = await entry.async('uint8array');
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_EXTRACTED_BYTES) {
      throw new Error('Archive exceeds 1 GB maximum extracted payload safety limit.');
    }

    const mimeType = inferMimeFromFilename(sanitized.safeFileName);
    const category = detectFileCategory(mimeType, sanitized.safeFileName);
    const file = new File([bytes as BlobPart], sanitized.safeFileName, {
      type: mimeType,
      lastModified: entry.date ? entry.date.getTime() : Date.now(),
    });

    items.push({
      id: `${items.length}:${sanitized.safePath}`,
      entryPath: sanitized.safePath,
      fileName: sanitized.safeFileName,
      mimeType,
      category,
      size: bytes.byteLength,
      file,
    });
  }

  return {
    zipName,
    items,
    skippedSystemCount,
  };
}
