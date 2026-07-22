'use strict';

const path = require('node:path');
const { app } = require('electron');

// The standard per-user app-data location (%APPDATA%\Tomelight on Windows) —
// every real install starts here empty; a user adds their own library folder
// on first launch. `TOMELIGHT_DATA_ROOT` overrides this for local dev (this
// developer's own machine points it at a D: drive), but that must never be
// the *default* baked into the shipped app: it's this machine's convention,
// not a real user's, and a plain install can't assume a D: drive even exists.
const DATA_ROOT = process.env.TOMELIGHT_DATA_ROOT || path.join(app.getPath('appData'), 'Tomelight');

module.exports = {
  DATA_ROOT,
  USER_DATA: path.join(DATA_ROOT, 'userData'),
  COVER_CACHE: path.join(DATA_ROOT, 'covers'),
  // Covers fetched from the online metadata lookup, kept separate from
  // extracted-from-file covers so the two provenances aren't muddled on disk.
  ONLINE_COVER_CACHE: path.join(DATA_ROOT, 'covers-online'),
  LIBRARY_FILE: path.join(DATA_ROOT, 'library.json'),
  PROGRESS_FILE: path.join(DATA_ROOT, 'progress.json'),
  BOOKMARKS_FILE: path.join(DATA_ROOT, 'bookmarks.json'),
  NORMALIZATION_FILE: path.join(DATA_ROOT, 'normalization.json'),
  METADATA_FILE: path.join(DATA_ROOT, 'metadata-overrides.json'),
  // Default location backups are offered/looked for. A sibling of DATA_ROOT
  // (not inside it) on purpose: deleting or corrupting the live data folder
  // must not take the backups down with it.
  BACKUP_DIR: path.join(path.dirname(DATA_ROOT), 'Tomelight-Backups'),
};
