'use strict';
// Runs before the body paints (blocking, in <head>): apply a saved theme override
// so there's no flash of the wrong palette. When nothing is saved, the CSS
// prefers-color-scheme default takes over. Kept tiny and separate because the
// page CSP forbids inline scripts.
(() => {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch { /* localStorage unavailable — fall back to the CSS default */ }
})();
