# rooh.clouds — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Single-Owner Zero-Trust Isolation**: Every `/vaults/{vaultUid}` document and all subcollections (`folders`, `files`, `fileChunks`, `notes`, `bookmarks`, `tags`, `trash`) strictly require `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == vaultUid`.
2. **Master Gate Consistency**: Subcollection creates, updates, and single-document gets verify the parent `/vaults/{vaultUid}` document exists and its `ownerUid == request.auth.uid`.
3. **Orphan Prevention**: Every `fileChunks` document must reference an existing parent `/vaults/{vaultUid}/files/{fileId}` document via `exists(...)`.
4. **Immutable Ownership & Timestamps**: `ownerUid`, `id`, and `createdAt` can never change after creation; `createdAt` and `updatedAt`/`deletedAt` must equal `request.time` (server timestamp).
5. **Bounded Payload Sizes**: All strings and arrays have explicit `.size()` caps; `fileChunks.dataBase64` is strictly bounded to `<= 520000` characters to stay safely below Firestore's 1 MiB document limit.
6. **URL Allowlist**: Bookmarks strictly enforce `^https?://.+` (blocking `javascript:`, `data:`, `file:` XSS payloads).

## 2. The "Dirty Dozen" Attack Payloads (All Must Result in `PERMISSION_DENIED`)
1. **Unauthenticated Vault Read**: `GET /vaults/userA` with `auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: `CREATE /vaults/userA` with `auth.uid == 'userA'` and `auth.token.email_verified == false` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Vault Hijack**: `GET /vaults/userA/notes/n1` with `auth.uid == 'userB'` -> `PERMISSION_DENIED`.
4. **Identity Spoofing on Create**: `CREATE /vaults/userA/folders/f1` with `ownerUid: 'userB'` -> `PERMISSION_DENIED`.
5. **Shadow / Ghost Field Injection**: `CREATE /vaults/userA/notes/n1` including extra field `isAdmin: true` -> `PERMISSION_DENIED`.
6. **ID Poisoning (Path Traversal / Oversized ID)**: `CREATE /vaults/userA/folders/..%2Fadmin` or 200-char ID -> `PERMISSION_DENIED`.
7. **Timestamp Forgery**: `CREATE /vaults/userA/notes/n1` with client-supplied `createdAt: 1700000000000` instead of `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: `UPDATE /vaults/userA/files/f1` attempting to alter `ownerUid` or `createdAt` -> `PERMISSION_DENIED`.
9. **Oversized Base64 Chunk (Denial of Wallet)**: `CREATE /vaults/userA/fileChunks/c1` with `dataBase64.size() == 900000` -> `PERMISSION_DENIED`.
10. **Orphaned File Chunk**: `CREATE /vaults/userA/fileChunks/c1` referencing non-existent `fileId: 'missing-id'` -> `PERMISSION_DENIED`.
11. **XSS Bookmark URL**: `CREATE /vaults/userA/bookmarks/b1` with `url: 'javascript:alert(1)'` -> `PERMISSION_DENIED`.
12. **Blanket List Query Scraping**: `LIST /vaults/userA/notes` by `auth.uid == 'userB'` or without owner boundary -> `PERMISSION_DENIED`.
