'use strict';

const path = require('node:path');

// Everything this app writes must stay off C:. Electron would otherwise put
// userData under %APPDATA% (C:), which also drags along Chromium's GPUCache,
// Local Storage and blob storage.
const DATA_ROOT = process.env.TOMELIGHT_DATA_ROOT || 'D:\\Claude\\Tomelight';

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
