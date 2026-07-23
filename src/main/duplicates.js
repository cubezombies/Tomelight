'use strict';

/**
 * Duplicate detection over the already-scanned library — no new file access
 * needed, just grouping data already in library.json. Books are bucketed by
 * normalized title+author, then split into distinct "recordings" within
 * that bucket by (track count, duration) — matching duration/track count is
 * a strong signal of "the same underlying audio", since duration comes from
 * the actual decoded stream, not a tag that could coincidentally match.
 *
 * This distinction matters: a title+author can legitimately have several
 * different recordings (different narrators someone deliberately collected)
 * that are NOT duplicates of each other and must never be offered for
 * removal — only a recording with 2+ copies (the same audio, filed under
 * more than one folder) is an actual duplicate. Confirmed against a real
 * library: "Illegal Alien" by Robert J. Sawyer has three genuinely
 * different narrators (41-42 tracks each, all different durations) sitting
 * right next to cases that really were the same file copied twice.
 */

const { shell } = require('electron');

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Small tolerance for encoding jitter between two copies of "the same" audio.
const DURATION_TOLERANCE_SEC = 5;

/**
 * @param {Array} books raw library books (as stored in library.json)
 * @returns {Array<{ title, author, recordings: Array<{ trackCount, duration, books }> }>}
 *   Only title+author buckets containing at least one recording with 2+
 *   copies are included — a title with three different single-copy
 *   narrations and no actual duplicate is not reported at all.
 */
function findDuplicateGroups(books) {
  const byKey = new Map();
  for (const book of books) {
    const t = normalize(book.title);
    if (!t) continue;
    const key = `${t}::${normalize(book.author)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(book);
  }

  const reports = [];
  for (const entries of byKey.values()) {
    if (entries.length < 2) continue;

    const recordings = [];
    for (const book of entries) {
      const trackCount = book.tracks.length;
      let rec = recordings.find((r) =>
        r.trackCount === trackCount && Math.abs(r.duration - book.duration) <= DURATION_TOLERANCE_SEC);
      if (!rec) {
        rec = { trackCount, duration: book.duration, books: [] };
        recordings.push(rec);
      }
      rec.books.push(book);
    }

    if (!recordings.some((r) => r.books.length >= 2)) continue; // nothing actually duplicated
    reports.push({ title: entries[0].title, author: entries[0].author, recordings });
  }

  // Most-duplicated first, so the biggest wins are at the top of the list.
  reports.sort((a, b) => {
    const maxCopies = (r) => Math.max(...r.recordings.map((rec) => rec.books.length));
    return maxCopies(b) - maxCopies(a);
  });
  return reports;
}

/**
 * Moves this book's own track files to the Recycle Bin — deliberately never
 * the containing folder, which can hold sibling books' files too (confirmed
 * in the same real library: a "Radio and Podcast Production" folder holds
 * four separate single-file books side by side). Recoverable via the
 * Recycle Bin, not a permanent delete.
 */
async function trashBookFiles(book) {
  const results = [];
  for (const track of book.tracks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await shell.trashItem(track.filePath);
      results.push({ filePath: track.filePath, ok: true });
    } catch (err) {
      results.push({ filePath: track.filePath, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { findDuplicateGroups, trashBookFiles };
