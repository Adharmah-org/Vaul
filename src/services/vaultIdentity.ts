export const PRIMARY_CANONICAL_VAULT_ID = 'd6a19222-fefb-4c0e-b3b4-f7a725488caa';
export const LEGACY_CANONICAL_VAULT_ID = '9f1d6ef7-8e46-4d16-9314-c176f33c0749';

export interface CanonicalVaultSeed {
  vaultId: string;
  legacyVaultIds: string[];
  username: string;
  usernameLower: string;
  driveAccountEmail?: string;
  aliases?: string[];
  roohKeyHash: string;
}

/**
 * Canonical cross-browser vault identity records using one-way salted PBKDF2-SHA256 digests.
 * No plaintext keys or OAuth tokens are stored in source code.
 */
export const CANONICAL_VAULT_SEEDS: CanonicalVaultSeed[] = [
  {
    vaultId: PRIMARY_CANONICAL_VAULT_ID,
    legacyVaultIds: [LEGACY_CANONICAL_VAULT_ID, 'u_tejaspphirake', 'u_tejasphirake'],
    username: 'tejaspphirake',
    usernameLower: 'tejaspphirake',
    driveAccountEmail: 'shunyavansh@gmail.com',
    aliases: ['tejasphirake', 'shunyavansh@gmail.com'],
    roohKeyHash:
      'pbkdf2$120000$df79d8f7057ae10c6c309747ce788044$1b65324189cf5b5cc6eaf36a0d3fc5bcc4ed2d95f101a864434a2f7a92601f68',
  },
];

export function getVaultDocId(username: string): string {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return `u_${clean}`;
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

export function findCanonicalSeedByInput(identifier: string): CanonicalVaultSeed | null {
  const clean = identifier.trim().toLowerCase();
  if (!clean) return null;
  for (const seed of CANONICAL_VAULT_SEEDS) {
    if (
      seed.usernameLower === clean ||
      seed.vaultId.toLowerCase() === clean ||
      seed.legacyVaultIds.some((id) => id.toLowerCase() === clean) ||
      (seed.aliases?.some((alias) => alias.toLowerCase() === clean) ?? false)
    ) {
      return seed;
    }
  }
  return null;
}
