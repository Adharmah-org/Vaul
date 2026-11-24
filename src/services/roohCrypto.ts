import { FileEncryptionMeta, RoohCapsuleV1 } from '../types/vault';
import { isValidRoohKeyFormat, normalizeRoohKey } from './crypto';

const CAPSULE_FORMAT = 'rooh.clouds/encrypted-capsule-v1';
const KDF_ITERATIONS = 150_000;

function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API is unavailable.');
}

export function uint8ToBase64(bytes: Uint8Array): string {
  // Chunked conversion avoids stack overflow on large binary buffers
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKeyFromRoohKey(
  roohKeyInput: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS
): Promise<CryptoKey> {
  const normalized = normalizeRoohKey(roohKeyInput);
  if (!isValidRoohKeyFormat(normalized)) {
    throw new Error('Invalid Rooh Key format (expected ROOH-XXXX-XXXX-XXXX).');
  }

  const c = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await c.subtle.importKey(
    'raw',
    encoder.encode(normalized),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return c.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBytesWithRoohKey(
  plainBytes: Uint8Array,
  originalMimeType: string,
  roohKey: string
): Promise<{ ciphertext: Uint8Array; meta: FileEncryptionMeta }> {
  const c = getCrypto();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  c.getRandomValues(salt);
  c.getRandomValues(iv);

  const aesKey = await deriveAesKeyFromRoohKey(roohKey, salt, KDF_ITERATIONS);
  const encryptedBuffer = await c.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    plainBytes as BufferSource
  );

  const ciphertext = new Uint8Array(encryptedBuffer);
  const meta: FileEncryptionMeta = {
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    saltBase64: uint8ToBase64(salt),
    ivBase64: uint8ToBase64(iv),
    originalMimeType: originalMimeType || 'application/octet-stream',
    originalSize: plainBytes.byteLength,
    encryptedAt: Date.now(),
  };

  return { ciphertext, meta };
}

export async function decryptBytesWithRoohKey(
  ciphertext: Uint8Array,
  meta: Pick<FileEncryptionMeta, 'saltBase64' | 'ivBase64' | 'iterations'>,
  roohKey: string
): Promise<Uint8Array> {
  const c = getCrypto();
  const salt = base64ToUint8(meta.saltBase64);
  const iv = base64ToUint8(meta.ivBase64);
  const aesKey = await deriveAesKeyFromRoohKey(roohKey, salt, meta.iterations || KDF_ITERATIONS);

  try {
    const plainBuffer = await c.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      ciphertext as BufferSource
    );
    return new Uint8Array(plainBuffer);
  } catch {
    throw new Error('Decryption failed: Invalid Rooh Key or tampered ciphertext.');
  }
}

export async function decryptBlobWithRoohKey(
  encryptedBlob: Blob,
  meta: FileEncryptionMeta,
  roohKey: string
): Promise<Blob> {
  const buffer = await encryptedBlob.arrayBuffer();
  const plainBytes = await decryptBytesWithRoohKey(new Uint8Array(buffer), meta, roohKey);
  return new Blob([plainBytes as BlobPart], {
    type: meta.originalMimeType || 'application/octet-stream',
  });
}

export function createRoohCapsule(
  fileName: string,
  ciphertext: Uint8Array,
  meta: FileEncryptionMeta
): RoohCapsuleV1 {
  return {
    format: CAPSULE_FORMAT,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: meta.iterations,
    saltBase64: meta.saltBase64,
    ivBase64: meta.ivBase64,
    fileName,
    mimeType: meta.originalMimeType || 'application/octet-stream',
    originalSize: meta.originalSize,
    encryptedAt: meta.encryptedAt,
    ciphertextBase64: uint8ToBase64(ciphertext),
  };
}

export async function buildRoohCapsuleFromBlob(
  fileName: string,
  encryptedBlob: Blob,
  meta: FileEncryptionMeta
): Promise<RoohCapsuleV1> {
  const buffer = await encryptedBlob.arrayBuffer();
  return createRoohCapsule(fileName, new Uint8Array(buffer), meta);
}

export function parseRoohCapsule(rawText: string): RoohCapsuleV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('File is not a valid .rooh encrypted capsule.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Malformed .rooh capsule payload.');
  }

  const obj = parsed as Record<string, unknown>;
  if (
    obj.format !== CAPSULE_FORMAT ||
    obj.algorithm !== 'AES-256-GCM' ||
    typeof obj.saltBase64 !== 'string' ||
    typeof obj.ivBase64 !== 'string' ||
    typeof obj.ciphertextBase64 !== 'string' ||
    typeof obj.fileName !== 'string'
  ) {
    throw new Error('Unsupported or incomplete .rooh capsule format.');
  }

  return parsed as RoohCapsuleV1;
}

export async function decryptRoohCapsule(
  capsule: RoohCapsuleV1,
  roohKey: string
): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const ciphertext = base64ToUint8(capsule.ciphertextBase64);
  const plainBytes = await decryptBytesWithRoohKey(
    ciphertext,
    {
      saltBase64: capsule.saltBase64,
      ivBase64: capsule.ivBase64,
      iterations: capsule.iterations,
    },
    roohKey
  );

  const mimeType = capsule.mimeType || 'application/octet-stream';
  return {
    blob: new Blob([plainBytes as BlobPart], { type: mimeType }),
    fileName: capsule.fileName,
    mimeType,
  };
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds a zero-dependency, offline self-contained .rooh.html decryptor terminal.
 * When opened locally in any browser after download, the user MUST supply the Rooh Key
 * to decrypt and extract the original file via Web Crypto AES-256-GCM.
 */
export function buildOfflineCapsuleHtml(capsule: RoohCapsuleV1): string {
  const safeJson = JSON.stringify(capsule).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const safeName = escapeHtmlText(capsule.fileName);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; media-src blob:; connect-src 'none';" />
  <title>rooh.clouds Capsule — ${safeName}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 20px; background: #030505; color: #e6f1ee;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .card {
      width: 100%; max-width: 480px; background: #090d0d;
      border: 1px solid rgba(57, 255, 136, 0.28); border-radius: 12px; padding: 28px;
    }
    .brand { color: #39ff88; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; margin-bottom: 8px; }
    h1 { font-size: 18px; margin: 0 0 6px; color: #ffffff; word-break: break-word; }
    .meta { font-size: 12px; color: #8a9d98; margin-bottom: 20px; }
    label { display: block; font-size: 12px; color: #a3b5b0; margin-bottom: 8px; }
    input {
      width: 100%; background: #030505; border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px; padding: 11px 12px; color: #00e5ff; font-family: inherit;
      font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase;
    }
    input:focus { outline: none; border-color: #39ff88; }
    button {
      width: 100%; margin-top: 14px; padding: 11px 16px; border: none; border-radius: 8px;
      background: #39ff88; color: #030505; font-family: inherit; font-size: 13px; font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: #52ff99; }
    .status { margin-top: 14px; font-size: 12px; min-height: 18px; }
    .err { color: #f87171; }
    .ok { color: #39ff88; }
    .foot { margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 11px; color: #6e827d; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">ROOH.CLOUDS // OFFLINE ENCRYPTED CAPSULE</div>
    <h1>${safeName}</h1>
    <div class="meta">AES-256-GCM · PBKDF2-SHA256 (${capsule.iterations} rounds) · ${capsule.originalSize} bytes</div>
    <form id="unlock-form">
      <label for="rk">Enter Rooh Key to Decrypt</label>
      <input id="rk" type="text" placeholder="ROOH-XXXX-XXXX-XXXX" required autocomplete="off" />
      <button type="submit">Decrypt &amp; Save Original File</button>
    </form>
    <div id="status" class="status" role="status"></div>
    <div class="foot">This standalone file decrypts entirely offline in your browser using the Web Crypto API. No network requests are made.</div>
  </div>
  <script>
    const CAPSULE = ${safeJson};
    function b64ToBytes(b64) {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    document.getElementById('unlock-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('status');
      const rawKey = document.getElementById('rk').value.trim().toUpperCase();
      status.className = 'status';
      status.textContent = 'Deriving AES-256-GCM key...';
      try {
        const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(rawKey), { name: 'PBKDF2' }, false, ['deriveKey']);
        const aesKey = await crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: b64ToBytes(CAPSULE.saltBase64), iterations: CAPSULE.iterations || 150000, hash: 'SHA-256' },
          km,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64ToBytes(CAPSULE.ivBase64) },
          aesKey,
          b64ToBytes(CAPSULE.ciphertextBase64)
        );
        const blob = new Blob([plain], { type: CAPSULE.mimeType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = CAPSULE.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        status.className = 'status ok';
        status.textContent = 'ACCESS GRANTED — Decrypted "' + CAPSULE.fileName + '" saved.';
      } catch (_err) {
        status.className = 'status err';
        status.textContent = 'ACCESS DENIED — Invalid Rooh Key or corrupted capsule.';
      }
    });
  </script>
</body>
</html>`;
}
