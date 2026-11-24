import Dexie, { Table } from 'dexie';
import {
  BookmarkRecord,
  FileRecord,
  FolderRecord,
  NoteRecord,
  SessionRecord,
  TagRecord,
  TrashRecord,
  UserRecord,
} from '../types/vault';

export class RoohCloudsDB extends Dexie {
  users!: Table<UserRecord, string>;
  files!: Table<FileRecord, string>;
  folders!: Table<FolderRecord, string>;
  notes!: Table<NoteRecord, string>;
  bookmarks!: Table<BookmarkRecord, string>;
  tags!: Table<TagRecord, string>;
  sessions!: Table<SessionRecord, string>;
  trash!: Table<TrashRecord, string>;

  constructor() {
    super('rooh_clouds_vault_db');

    // Version 1: Initial schema with indexed foreign keys and search fields.
    // Future migrations can append `this.version(2).stores({...}).upgrade(...)`.
    this.version(1).stores({
      users: 'id, &username, createdAt',
      files: 'id, userId, folderId, category, name, isFavorite, createdAt, updatedAt, *tags',
      folders: 'id, userId, parentId, name, isFavorite, createdAt, updatedAt, *tags',
      notes: 'id, userId, folderId, title, isFavorite, createdAt, updatedAt, *tags',
      bookmarks: 'id, userId, url, title, isFavorite, createdAt, updatedAt, *tags',
      tags: 'id, userId, [userId+name], name',
      sessions: 'id, userId, token, expiresAt',
      trash: 'id, userId, itemType, itemId, deletedAt',
    });
  }
}

export const db = new RoohCloudsDB();
