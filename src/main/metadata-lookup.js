'use strict';

/**
 * Online metadata lookup — corrects titles/authors, fetches real descriptions
 * and higher-quality covers than what's embedded (or missing) in the audio
 * files themselves.
 *
 * Source: Open Library only. Google Books' keyless API was tried first and
 * rejected — it returned 429 "Quota exceeded" on the very first request in
 * testing, before this app ever shipped a single query, which makes it
 * unusable without asking every user to obtain and configure their own API
 * key. Audible has no public API; scraping it would be a ToS/legal risk this
 * app isn't taking on. Open Library's search and cover endpoints are free,
 * keyless, and had no such quota issue in testing.
 *
 * Every call here is user-initiated (a book-view button click), never
 * automatic — this module is only ever reached after the opt-in gate in the
 * renderer, and nothing here runs on a timer or on startup.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

// Open Library asks API consumers to identify themselves; see
// https://openlibrary.org/dev/docs/api/search
const USER_AGENT = 'MidnightAthenaeum/1.0 (Electron audiobook player; github.com/cubezombies/MidnightAthenaeum)';
const TIMEOUT_MS = 10_000;

function withTimeout() {
  return AbortSignal.timeout(TIMEOUT_MS);
}

/** A short, human-readable message for a failed lookup — shown as-is in the UI. */
function friendlyError(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Open Library took too long to respond.';
  if (err.message?.includes('ENOTFOUND') || err.message?.includes('EAI_AGAIN')) return 'No internet connection.';
  return `Lookup failed: ${err.message}`;
}

/**
 * Free-text search. Deliberately not the strict title=/author= field search —
 * tested against this library's real (often messy) tags and the strict form
 * returned zero results for correctly-spelled real books when the scanned
 * author was noise (e.g. a ripper tag like "!!RAW!!"); general full-text
 * search handled the same queries correctly.
 *
 * @returns {Promise<{ok: true, results: Array} | {ok: false, error: string}>}
 */
async function searchOpenLibrary(query) {
  const q = (query || '').trim();
  if (!q) return { ok: false, error: 'Enter a search term.' };

  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8`
    + '&fields=key,title,author_name,first_publish_year,cover_i,edition_count';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: withTimeout() });
    if (!res.ok) return { ok: false, error: `Open Library returned ${res.status}.` };
    const data = await res.json();
    const results = (data.docs || []).map((d) => ({
      key: d.key, // e.g. "/works/OL37577930W"
      title: d.title || 'Untitled',
      authors: d.author_name || [],
      year: d.first_publish_year || null,
      coverId: d.cover_i || null,
      coverThumbUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    }));
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

// Open Library's data is aggregated from library MARC records, and the
// `description` field sometimes holds physical-copy metadata instead of a
// real description — e.g. "746 pages ; 23 cm" for a book with no actual
// blurb on file. Filter that out rather than offering it as a description.
const NOT_A_REAL_DESCRIPTION = /^\d+\s*(pages?|p\.?)\b/i;

/** Open Library's `description` field is a plain string on some records, {value} on others. */
function normalizeDescription(desc) {
  let text = '';
  if (typeof desc === 'string') text = desc.trim();
  else if (typeof desc === 'object' && typeof desc?.value === 'string') text = desc.value.trim();
  if (text.length < 40 || NOT_A_REAL_DESCRIPTION.test(text)) return '';
  return text;
}

/**
 * Fetch the full description for one candidate. Only called for the single
 * result the user actually picks, not for every search result.
 */
async function fetchWorkDescription(key) {
  if (!key) return { ok: true, description: '' };
  try {
    const res = await fetch(`https://openlibrary.org${key}.json`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: withTimeout(),
    });
    if (!res.ok) return { ok: false, error: `Open Library returned ${res.status}.` };
    const data = await res.json();
    return { ok: true, description: normalizeDescription(data.description) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

/**
 * Download a cover to disk. Uses the largest size ("-L") since the whole
 * point is a better cover than what's embedded — the "-M" thumbnail is only
 * for the pick-a-candidate list.
 */
async function downloadCover(coverId, destPath) {
  if (!coverId) return { ok: true, downloaded: false };
  try {
    const res = await fetch(`https://covers.openlibrary.org/b/id/${coverId}-L.jpg`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: withTimeout(),
    });
    if (!res.ok || !res.body) return { ok: false, error: `Cover download returned ${res.status}.` };
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return { ok: false, error: 'Cover response was not an image.' };

    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    // Open Library serves a small grey "no cover" placeholder instead of a 404
    // for missing covers; it's tiny and identical every time, so a size floor
    // filters it out rather than caching a blank image as if it were real.
    if (buf.length < 1000) return { ok: true, downloaded: false };
    await fs.writeFile(destPath, buf);
    return { ok: true, downloaded: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

module.exports = { searchOpenLibrary, fetchWorkDescription, downloadCover };
