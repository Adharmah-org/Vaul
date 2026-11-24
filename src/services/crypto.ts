const ROOH_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PBKDF2_ITERATIONS = 120_000;

function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API is unavailable in this environment.');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateUuid(): string {
  const c = getCrypto();
  if (typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Generates a cryptographically random Rooh Key in format: ROOH-XXXX-XXXX-XXXX
 * Uses rejection sampling over crypto.getRandomValues to avoid modulo bias.
 */
export function generateRoohKey(): string {
  const c = getCrypto();
  const alphabetLen = ROOH_KEY_ALPHABET.length; // 36
  const maxValid = 256 - (256 % alphabetLen); // 252
  const chars: string[] = [];
  const buf = new Uint8Array(32);

  while (chars.length < 12) {
    c.getRandomValues(buf);
    for (let i = 0; i < buf.length && chars.length < 12; i++) {
      if (buf[i] < maxValid) {
        chars.push(ROOH_KEY_ALPHABET[buf[i] % alphabetLen]);
      }
    }
  }

  return `ROOH-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function normalizeRoohKey(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoohKeyFormat(key: string): boolean {
  return /^ROOH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeRoohKey(key));
}

export async function hashSecret(secret: string): Promise<string> {
  const c = getCrypto();
  const salt = new Uint8Array(16);
  c.getRandomValues(salt);

  const encoder = new TextEncoder();
  const keyMaterial = await c.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await c.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hashHex}`;
}

export async function verifySecret(secret: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false;
  }
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!Number.isFinite(iterations) || iterations < 1000 || !saltHex || !expectedHex) {
    return false;
  }

  const c = getCrypto();
  const salt = hexToBytes(saltHex);
  const encoder = new TextEncoder();
  const keyMaterial = await c.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await c.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const actualHex = bytesToHex(new Uint8Array(derivedBits));
  return constantTimeEqual(actualHex, expectedHex);
}

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];
  if (password.length < 8) {
    errors.push('At least 8 characters required');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('At least one uppercase letter (A-Z)');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('At least one lowercase letter (a-z)');
  }
  if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('At least one number or symbol');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 32) {
    return { valid: false, error: 'Username must be between 3 and 32 characters.' };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return { valid: false, error: 'Username may only contain letters, numbers, dots, underscores, or hyphens.' };
  }
  return { valid: true };
}
