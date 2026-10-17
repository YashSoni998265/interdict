// Apply the saved colour theme before the first paint, so the page never flashes the wrong one.
// Light is the default; the header toggle (ThemeToggle.tsx) saves the visitor's choice.
(function () {
  var theme = 'light';
  try {
    if (window.localStorage.getItem('interdict-theme') === 'dark') theme = 'dark';
  } catch {
    // Storage blocked (private mode, disabled site data): keep the default.
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#09090b' : '#f5f5f7');
})();
