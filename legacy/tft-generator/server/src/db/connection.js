import Database from 'better-sqlite3';
import { createSchema } from './schema.js';

let _db = null;

export function getDb(path = process.env.DB_PATH || 'tft.db') {
  if (_db) return _db;

  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  createSchema(_db);

  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
