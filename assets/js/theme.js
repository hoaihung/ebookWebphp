// file: assets/js/theme.js (copied into ebookWeb/ebookWeb for site-level usage)
// This module handles dark mode toggling across the site.
// It adds or removes the `dark-mode` class on the body element and
// persists the user preference in localStorage. It also swaps the icon
// on the toggle button between a moon and a sun to reflect the current
// mode.

/**
 * Update the icon on the dark mode toggle button based on the current mode.
 * @param {HTMLElement|null} btn - The button element containing an <i> icon
 * @param {boolean} isDark - True if dark mode is enabled
 */
// NOTE: updateToggleIcon is defined later with support for multiple themes.

/**
 * Initialize the dark mode state based on localStorage and set up the event
 * listener on the toggle button. This function should be called on every
 * page that includes a dark-mode toggle button.
 */
/**
 * Initialise the theme mode. Supports cycling through light, dark and sepia
 * themes. The current mode is stored under `themeMode` in localStorage.
 * This function also updates all existing and future toggle buttons via
 * event delegation – no matter when the button is added to the DOM.
 */
export function initDarkMode() {
  const bodyEl = document.body;
  // Determine the current theme from storage; fall back to the legacy
  // `darkMode` flag if present. Supported values: 'light', 'dark', 'sepia'.
  const legacyDark = localStorage.getItem('darkMode');
  let storedMode = localStorage.getItem('themeMode');
  if (!storedMode) {
    // If legacy dark mode exists, derive the mode accordingly.
    if (legacyDark === 'true') {
      storedMode = 'dark';
    } else {
      storedMode = 'light';
    }
    localStorage.setItem('themeMode', storedMode);
  }
  applyTheme(bodyEl, storedMode);
  // Event delegation: listen for clicks on any current or future toggle
  // buttons. When clicked, cycle through available themes.
  document.removeEventListener('click', handleToggleClick);
  document.addEventListener('click', handleToggleClick);
  // On initialisation, update icons for all existing toggles.
  updateAllToggleIcons(storedMode);
}

// List of supported themes in the order they cycle.
const THEME_CYCLE = ['light', 'dark', 'sepia'];

/**
 * Handle click on any element – delegate for .dark-mode-toggle.
 * Cycles the theme and updates storage and icons accordingly.
 * @param {MouseEvent} event 
 */
function handleToggleClick(event) {
  const btn = event.target.closest('.dark-mode-toggle');
  if (!btn) return;
  // Determine current mode and compute the next one
  const currentMode = localStorage.getItem('themeMode') || 'light';
  const idx = THEME_CYCLE.indexOf(currentMode);
  const nextMode = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  localStorage.setItem('themeMode', nextMode);
  applyTheme(document.body, nextMode);
  updateAllToggleIcons(nextMode);
}

/**
 * Apply the given theme to the document body by toggling CSS classes.
 * Removes any other theme classes before adding the appropriate one.
 * @param {HTMLElement} bodyEl 
 * @param {string} mode - 'light' | 'dark' | 'sepia'
 */
function applyTheme(bodyEl, mode) {
  bodyEl.classList.remove('dark-mode');
  bodyEl.classList.remove('sepia-mode');
  if (mode === 'dark') {
    bodyEl.classList.add('dark-mode');
  } else if (mode === 'sepia') {
    bodyEl.classList.add('sepia-mode');
  }
}

/**
 * Update the icon for all toggle buttons to reflect the current mode.
 * @param {string} mode 
 */
function updateAllToggleIcons(mode) {
  const buttons = document.querySelectorAll('.dark-mode-toggle');
  buttons.forEach(btn => {
    updateToggleIcon(btn, mode === 'dark', mode);
  });
}

/**
 * Update the icon on the toggle button based on mode. Extends the existing
 * updateToggleIcon to support sepia mode.
 * @param {HTMLElement|null} btn 
 * @param {boolean} isDark - kept for backward compatibility
 * @param {string} mode - current theme mode
 */
function updateToggleIcon(btn, isDark, mode) {
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (!icon) return;
  // Determine the appropriate icon for the given mode
  let className;
  switch (mode) {
    case 'dark':
      className = 'fas fa-sun';
      break;
    case 'sepia':
      className = 'fas fa-mug-hot';
      break;
    default:
      className = 'fas fa-moon';
      break;
  }
  icon.className = className;
}

// Hook into DOMContentLoaded to initialise theme when any toggle exists
document.removeEventListener('DOMContentLoaded', initHandler);
function initHandler() {
  if (document.querySelector('.dark-mode-toggle')) {
    initDarkMode();
  }
}
document.addEventListener('DOMContentLoaded', initHandler);

// NOTE: Automatic initialisation occurs through initHandler defined above.