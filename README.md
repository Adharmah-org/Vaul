# rooh.clouds

> *"Your memories. Your universe. Your private cloud."*

**rooh.clouds** is a local-first personal digital vault featuring a **Hacker Dock** workspace, Web Crypto local authentication with one-time Rooh Keys, IndexedDB binary Blob storage via Dexie.js, a live-preview Markdown notes editor, URL bookmarking, built-in file previews, storage analytics, and full archive export/import.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Motion (`motion/react`), Lucide React
- **Routing:** React Router (`react-router-dom`)
- **Storage:** IndexedDB via Dexie.js (`dexie`)
- **Markdown:** `react-markdown`, `remark-gfm`, `rehype-sanitize` (sanitized rendering)
- **Security Primitives:** Browser Web Crypto API (`PBKDF2-SHA256`, `crypto.getRandomValues`, `crypto.randomUUID`)

---

## Installation & Setup

### Prerequisites
- Node.js 20+
- npm 10+

### Install Dependencies
```bash
npm install
```

### Environment Variables
Copy `.env.example` to `.env` if deploying with server-side integrations later. Never commit real secrets.

Example environment variable names:
```bash
# Optional AI / Platform Keys (server-side only)
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
APP_URL="http://localhost:3000"

# Future Cloudflare R2 Integration (server-side only)
R2_ACCOUNT_ID="YOUR_CLOUDFLARE_ACCOUNT_ID"
R2_ACCESS_KEY_ID="YOUR_R2_ACCESS_KEY_ID"
R2_SECRET_ACCESS_KEY="YOUR_R2_SECRET_ACCESS_KEY"
R2_BUCKET_NAME="rooh-clouds-vault"

# Future Supabase Integration
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

---

## Development & Build Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts Vite development server on port `3000` |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`) |
| `npm run build` | Builds optimized production bundle into `dist/` |
| `npm run preview` | Previews the production build locally |
| `npx tsx --test src/services/*.test.ts` | Runs unit tests for crypto & file utilities |

---

## IndexedDB Architecture (Dexie.js)

Data persistence is abstracted behind `StorageProvider` (`src/storage/StorageProvider.ts`) and implemented locally by `IndexedDBStorageProvider` (`src/storage/IndexedDBStorageProvider.ts`) using `RoohCloudsDB` (`src/storage/db.ts`).

### Tables
- `users`: Local user records (`id`, `username`, `passwordHash`, `roohKeyHash`, timestamps)
- `sessions`: Active session tokens with expiration timestamps
- `folders`: Hierarchical folder tree (`parentId`, `tags`, `isFavorite`)
- `files`: Uploaded binary files stored directly as native IndexedDB `Blob` objects (`content: Blob`), never in `localStorage`
- `notes`: Markdown notes with title, body, tags, favorites, and folder association
- `bookmarks`: Validated `http:` / `https:` URLs with titles, descriptions, favicons, and tags
- `tags`: Normalized tag index per user
- `trash`: Soft-deleted files, nested folders, notes, and bookmarks awaiting restoration or permanent deletion

### Schema Migrations
`RoohCloudsDB` uses Dexie version blocks (`this.version(1).stores(...)`) so future upgrades can append `version(2).stores(...).upgrade(...)` cleanly without breaking existing user vaults.

---

## Data Export & Import

From **Settings → Archive Backup & Restore**:
1. **Export Archive** serializes your folder tree, notes, bookmarks, tags, and binary file `Blob`s (base64-encoded) into a versioned `rooh-clouds-archive-*.json` file (`schemaVersion: 1`).
2. **Import Archive** validates the JSON schema (`validateArchivePayload`), checks all bookmark URLs against `http:` / `https:` allowlists, remaps folder IDs safely to prevent collisions, reconstructs binary `Blob`s, and inserts them into IndexedDB.

---

## Current Authentication & Security Limitations

1. **Single-Device Local Storage:** IndexedDB resides inside a single browser profile on your device. Clearing browser site data removes your local vault unless you exported an archive.
2. **Client-Side Auth Boundary:** Passwords and Rooh Keys (`ROOH-XXXX-XXXX-XXXX`) are hashed with Web Crypto `PBKDF2-SHA256` (120,000 iterations + 16-byte random salt). The Rooh Key is displayed once on registration and never stored in plaintext. However, because authentication runs purely in the browser, anyone with physical access to the unlocked device or browser DevTools can inspect IndexedDB records.
3. **Not Remotely Encrypted or Synced:** Currently, `rooh.clouds` does not encrypt file Blobs with a remote KMS or sync across devices.

---

## Connecting Cloudflare R2 Later

1. Implement a small backend worker/API (e.g. Cloudflare Workers or Express) that authenticates the user and issues **presigned R2 `PUT` and `GET` URLs** using `@aws-sdk/client-s3` (S3-compatible endpoint: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`).
2. Complete `FutureCloudflareR2StorageProvider` (`src/storage/FutureCloudProviders.ts`):
   - `uploadFile`: Request a presigned `PUT` URL from `/api/r2/presign-upload`, upload the `File` via `XMLHttpRequest` or `fetch` with `AbortSignal` and progress tracking, and store metadata in your API database.
   - `getFileBlob` / preview: Fetch a short-lived signed `GET` URL from `/api/r2/presign-download`.
3. Never expose `R2_SECRET_ACCESS_KEY` in client (`VITE_*`) code.

---

## Connecting Supabase Later

1. Create a Supabase project and configure tables matching `folders`, `files`, `notes`, `bookmarks`, `tags`, and `trash` with **Row Level Security (RLS)** enabled (`auth.uid() = user_id`).
2. Create a private Supabase Storage bucket (e.g., `vault-files`) with RLS storage policies restricting access to `auth.uid()`.
3. Complete `FutureSupabaseStorageProvider` (`src/storage/FutureCloudProviders.ts`) using `@supabase/supabase-js`:
   - `registerUser` / `authenticateUser`: Delegate to `supabase.auth.signUp` / `supabase.auth.signInWithPassword` (optionally pairing with a server-verified Rooh Key factor).
   - `uploadFile`: Upload binary files to `supabase.storage.from('vault-files').upload(...)` and persist metadata rows in Postgres.
4. Swap the provider instance in `src/context/VaultContext.tsx`.

---

## Recommended Future Server-Side Authentication Architecture

For multi-device, zero-trust cloud deployment:
1. **Server-Enforced Sessions:** Issue `HttpOnly; Secure; SameSite=Lax` (or `Bearer`) tokens signed server-side after verifying Argon2id/scrypt password hashes on the backend.
2. **Envelope Encryption (Optional End-to-End Zero Knowledge):** Derive a Master Key from the user's password + Rooh Key via Argon2id on the client, encrypt a random Data Encryption Key (DEK), and encrypt file Blobs using AES-256-GCM before uploading to Cloudflare R2 or Supabase Storage.
3. **Recovery Factor:** Hash the Rooh Key server-side as a second recovery/unlock factor, and support WebAuthn/passkeys for phishing-resistant login.
