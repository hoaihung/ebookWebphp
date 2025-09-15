// Layout loader to insert common header and footer across pages.
// This module fetches HTML snippets from the `partials` directory and
// inserts them into placeholders with IDs `header-placeholder` and
// `footer-placeholder`. It should be imported before other modules
// that reference header/footer elements.

export async function loadLayout() {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');
  try {
    if (headerPlaceholder) {
      // Fetch header using a path relative to the site root. Using a
      // relative path starting with `partials/` ensures that the
      // header is resolved correctly regardless of the current page
      // location (e.g. index.html, login.html). The previous
      // implementation used './partials/header.html' which caused the
      // browser to resolve the path relative to the current HTML file
      // (e.g. login.html/partials/header.html) and therefore failed
      // on pages outside the root. See GitHub issue 123 for details.
      const headerRes = await fetch('partials/header.html');
      if (headerRes.ok) {
        const html = await headerRes.text();
        headerPlaceholder.innerHTML = html;
      }
    }
    if (footerPlaceholder) {
      // Similarly, fetch the footer from the root-level partials
      const footerRes = await fetch('partials/footer.html');
      if (footerRes.ok) {
        const html = await footerRes.text();
        footerPlaceholder.innerHTML = html;
      }
    }
  } catch (err) {
    console.error('Failed to load layout:', err);
  }
}

// Immediately load on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  loadLayout();
});