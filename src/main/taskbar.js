'use strict';

/**
 * Windows taskbar integration: thumbnail-toolbar buttons (prev/play-pause/
 * next, shown on the taskbar button's hover preview) and a jump list of
 * recently-played books (shown on right-click / Start tile).
 *
 * Both are native Shell features with no renderer involvement of their own —
 * thumbbar clicks are relayed to the renderer via `media:control` since only
 * the renderer's <audio> element and chapter logic know how to act on them.
 */

const path = require('node:path');
const { app, nativeImage } = require('electron');

const ICON_DIR = path.join(__dirname, '..', '..', 'build', 'media-icons');
const icons = {
  prev: nativeImage.createFromPath(path.join(ICON_DIR, 'prev.ico')),
  play: nativeImage.createFromPath(path.join(ICON_DIR, 'play.ico')),
  pause: nativeImage.createFromPath(path.join(ICON_DIR, 'pause.ico')),
  next: nativeImage.createFromPath(path.join(ICON_DIR, 'next.ico')),
};

/**
 * (Re)sets the thumbbar's three buttons. Windows has no "just update the
 * icon" call — the whole button set is replaced every time play/pause state
 * flips so the correct icon shows.
 */
function setThumbar(win, isPlaying, onControl) {
  if (!win || win.isDestroyed()) return;
  const ok = win.setThumbarButtons([
    { tooltip: 'Previous chapter', icon: icons.prev, click: () => onControl('prev') },
    {
      tooltip: isPlaying ? 'Pause' : 'Play',
      icon: isPlaying ? icons.pause : icons.play,
      click: () => onControl('playpause'),
    },
    { tooltip: 'Next chapter', icon: icons.next, click: () => onControl('next') },
  ]);
  if (!ok) console.error('[taskbar] setThumbarButtons was rejected by the OS');
}

const MAX_RECENT = 8;

// Caller re-runs this on every progress save (every few seconds during
// playback), but the top-N *order* only actually changes when playback
// switches books — skip the Shell call when the list would be identical.
let lastJumpListKey = null;

/**
 * "Continue Listening" jump list category, most-recently-played first.
 * Separate from Windows' own automatic per-app "Recent" category (which
 * tracks opened *files*, meaningless here since books aren't opened as
 * files). Clicking an item relaunches the app with `--open-book=<id>`,
 * handled by `bookIdFromArgv` + the `second-instance` handler in main.js.
 */
function updateJumpList(books, progress) {
  const recent = Object.entries(progress)
    .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
    .slice(0, MAX_RECENT)
    .map(([bookId]) => books.find((b) => b.id === bookId))
    .filter(Boolean);

  const key = recent.map((b) => `${b.id}:${b.title}:${b.author}`).join('|');
  if (key === lastJumpListKey) return;
  lastJumpListKey = key;

  if (!recent.length) {
    app.setJumpList(null);
    return;
  }

  const result = app.setJumpList([
    {
      type: 'custom',
      name: 'Continue Listening',
      items: recent.map((book) => ({
        type: 'task',
        title: book.title,
        description: book.author || '',
        program: process.execPath,
        args: `--open-book=${book.id}`,
        iconPath: process.execPath,
        iconIndex: 0,
      })),
    },
  ]);
  // 'ok' or falsy on success depending on Electron version; anything else is
  // a real problem worth knowing about (the "recently opened items" Windows
  // privacy setting being off also lands here, as 'error' — expected on a
  // machine with that disabled, not a bug).
  if (result && result !== 'ok') console.error(`[taskbar] setJumpList: ${result}`);
}

/** Pulls `--open-book=<id>` out of an argv array (dev or packaged, either way). */
function bookIdFromArgv(argv) {
  for (const arg of argv) {
    const m = /^--open-book=(.+)$/.exec(arg);
    if (m) return m[1];
  }
  return null;
}

module.exports = { setThumbar, updateJumpList, bookIdFromArgv };
