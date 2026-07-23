'use strict';

/**
 * Reorganize the library on disk into <library folder>/<Author>/<Title>/…
 * The single riskiest feature in this app: unlike everything else, a bug
 * here doesn't corrupt app data, it scatters real audiobook files. Built
 * accordingly —
 *
 *   1. computePlan() is pure and read-only: given the current library, it
 *      returns exactly what WOULD move, touching no files. This is what the
 *      preview UI shows before anything happens.
 *   2. executePlan() only moves what computePlan() decided, one book at a
 *      time, journaling every individual move as it happens (not batched at
 *      the end) so an interruption leaves an accurate record of what's
 *      actually done.
 *   3. undoLastReorganization() replays that journal backwards.
 *
 * A book's sourceDir is only renamed wholesale when this book exclusively
 * owns it. Confirmed in a real library that a folder can hold several
 * unrelated single-file books side by side (four different Alien audio
 * dramas in one "Radio and Podcast Production" folder) — renaming a shared
 * folder would silently relocate books that were never part of the plan, so
 * a shared folder always moves only this book's own files instead.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { REORG_JOURNAL_FILE } = require('./paths');

const ILLEGAL_WIN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

function sanitizeName(name) {
  const cleaned = (name || '')
    .replace(ILLEGAL_WIN_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows disallows a trailing dot/space
  return cleaned || 'Unknown';
}

/** Which of the user's configured library folders (if any) contains this book. */
function findRoot(sourceDir, folders) {
  const lower = path.resolve(sourceDir).toLowerCase();
  return folders.find((f) => {
    const fl = path.resolve(f).toLowerCase();
    return lower === fl || lower.startsWith(fl.endsWith(path.sep) ? fl : fl + path.sep);
  }) || null;
}

/**
 * @param {Array} books raw library books
 * @param {string[]} folders the user's configured library root folders
 * @returns {{ moves: Array, skipped: Array, alreadyCorrectCount: number }}
 */
function computePlan(books, folders) {
  const plan = { moves: [], skipped: [], alreadyCorrectCount: 0 };

  const dirCounts = new Map();
  for (const b of books) dirCounts.set(b.sourceDir, (dirCounts.get(b.sourceDir) || 0) + 1);

  const claimedTargets = new Set();

  for (const book of books) {
    const root = findRoot(book.sourceDir, folders);
    if (!root) {
      plan.skipped.push({ id: book.id, title: book.title, author: book.author, reason: 'Not under a recognized library folder.' });
      continue;
    }

    const author = sanitizeName(book.author);
    const title = sanitizeName(book.title);
    let targetDir = path.join(root, author, title);
    let suffix = 2;
    while (
      claimedTargets.has(targetDir.toLowerCase())
      || (fs.existsSync(targetDir) && path.resolve(targetDir) !== path.resolve(book.sourceDir))
    ) {
      targetDir = path.join(root, author, `${title} (${suffix})`);
      suffix += 1;
    }
    claimedTargets.add(targetDir.toLowerCase());

    const exclusivelyOwnsSourceDir = dirCounts.get(book.sourceDir) === 1;
    if (exclusivelyOwnsSourceDir && path.resolve(book.sourceDir) === path.resolve(targetDir)) {
      plan.alreadyCorrectCount += 1;
      continue;
    }

    plan.moves.push({
      bookId: book.id,
      title: book.title,
      author: book.author,
      mode: exclusivelyOwnsSourceDir ? 'folder' : 'files',
      fromDir: book.sourceDir,
      fromFiles: book.tracks.map((t) => t.filePath),
      toDir: targetDir,
    });
  }

  return plan;
}

async function moveOne(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // Shouldn't happen (reorganizing within the same library root, same
    // drive) but handled defensively rather than assumed away.
    await fsp.cp(from, to, { recursive: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

/**
 * Executes one book's move and returns the journal entries it produced.
 * 'folder' mode renames the whole (exclusively-owned) source folder in one
 * step, bringing along cover art / nfo files automatically. 'files' mode
 * moves only this book's own track files into a freshly created folder,
 * leaving everything else in the shared source folder untouched.
 */
async function executeMove(move) {
  const entries = [];
  if (move.mode === 'folder') {
    await fsp.mkdir(path.dirname(move.toDir), { recursive: true });
    await moveOne(move.fromDir, move.toDir);
    entries.push({ type: 'folder', from: move.fromDir, to: move.toDir });
  } else {
    await fsp.mkdir(move.toDir, { recursive: true });
    for (const filePath of move.fromFiles) {
      const dest = path.join(move.toDir, path.basename(filePath));
      // eslint-disable-next-line no-await-in-loop
      await moveOne(filePath, dest);
      entries.push({ type: 'file', from: filePath, to: dest });
    }
  }
  return entries;
}

/** New filePath for each of a book's tracks after a successful move, keyed by original path. */
function remapTrackPaths(move, journalEntries) {
  const map = new Map(journalEntries.filter((e) => e.type === 'file').map((e) => [e.from, e.to]));
  if (move.mode === 'folder') {
    return move.fromFiles.map((f) => path.join(move.toDir, path.relative(move.fromDir, f)));
  }
  return move.fromFiles.map((f) => map.get(f) || f);
}

function readJournal() {
  try {
    return JSON.parse(fs.readFileSync(REORG_JOURNAL_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function appendJournal(entries) {
  const existing = readJournal() || [];
  existing.push(...entries);
  fs.mkdirSync(path.dirname(REORG_JOURNAL_FILE), { recursive: true });
  fs.writeFileSync(REORG_JOURNAL_FILE, JSON.stringify(existing), 'utf8');
}

function startJournal() {
  fs.mkdirSync(path.dirname(REORG_JOURNAL_FILE), { recursive: true });
  fs.writeFileSync(REORG_JOURNAL_FILE, '[]', 'utf8');
}

function hasJournal() {
  const j = readJournal();
  return Array.isArray(j) && j.length > 0;
}

function clearJournal() {
  try {
    fs.rmSync(REORG_JOURNAL_FILE, { force: true });
  } catch {
    // Best effort.
  }
}

let cancelled = false;
let running = false;

function isRunning() {
  return running;
}

function cancel() {
  cancelled = true;
}

/**
 * Executes every move in a plan, one book at a time, journaling as it goes.
 * onProgress gets { done, total, bookTitle }. Returns { moved, failed,
 * cancelledEarly, pathUpdates } where pathUpdates is a bookId -> { sourceDir,
 * tracks } map the caller uses to patch the in-memory library immediately,
 * without needing a full rescan.
 */
async function executePlan(plan, onProgress) {
  if (running) throw new Error('A reorganization is already running.');
  running = true;
  cancelled = false;
  startJournal();

  const moved = [];
  const failed = [];
  const pathUpdates = {};
  let done = 0;

  try {
    for (const move of plan.moves) {
      if (cancelled) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        const entries = await executeMove(move);
        appendJournal(entries);
        const newPaths = remapTrackPaths(move, entries);
        pathUpdates[move.bookId] = { sourceDir: move.toDir, trackPaths: newPaths };
        moved.push(move.bookId);
      } catch (err) {
        failed.push({ bookId: move.bookId, title: move.title, error: err.message });
      }
      done += 1;
      onProgress?.({ done, total: plan.moves.length, bookTitle: move.title });
    }
  } finally {
    running = false;
  }

  return { moved, failed, cancelledEarly: cancelled, pathUpdates };
}

/** Reverses every move in the last journal, most recent first. */
async function undoLastReorganization(onProgress) {
  const journal = readJournal();
  if (!journal || !journal.length) return { ok: true, errors: [], restored: [] };

  const errors = [];
  const restored = [];
  const reversed = [...journal].reverse();
  let done = 0;
  for (const entry of reversed) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await moveOne(entry.to, entry.from);
      restored.push(entry);
    } catch (err) {
      errors.push({ entry, error: err.message });
    }
    done += 1;
    onProgress?.({ done, total: reversed.length });
  }
  clearJournal();
  return { ok: errors.length === 0, errors, restored };
}

module.exports = {
  sanitizeName,
  computePlan,
  executePlan,
  undoLastReorganization,
  hasJournal,
  isRunning,
  cancel,
};
