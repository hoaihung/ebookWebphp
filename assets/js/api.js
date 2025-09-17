// file: /assets/js/api.js
// A small helper module to centralise API interactions and token
// management. Frontend modules should import functions from this file
// instead of calling fetch() directly when accessing the backend.

import config from './config.js';

// In the session-based implementation we no longer rely on JWT tokens.
// However, we keep dummy get/set/clear functions for backward
// compatibility. They always return null or do nothing.
const TOKEN_KEY = 'ebook_token';

export function getToken() {
    return null;
}

export function setToken(token) {
    // no-op
}

export function clearToken() {
    // no-op
}

/**
 * Perform an HTTP request against the backend API. This function
 * automatically prefixes the path with the configured API_BASE and
 * attaches the Authorization header if a token is present. It also
 * handles JSON parsing for convenience.
 *
 * @param {string} path - The path portion of the API URL (e.g. '/books').
 * @param {object} options - Additional fetch options (method, headers, body, etc.).
 * @returns {Promise<any>} The parsed JSON response.
 */
// assets/js/api.js
export async function apiFetch(path, opts = {}) {
  const { method = 'GET', body, headers = {} } = opts;
  const url = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : '/'+path}`;

  // Lấy CSRF token từ <meta> hoặc localStorage/cookie
  const meta = document.querySelector('meta[name="csrf-token"]');
  // Try to find a CSRF token from multiple sources.  In order of priority:
  //   1. A <meta name="csrf-token"> tag (allows templates to inject directly)
  //   2. window.csrfToken (set by admin.js when fetching /admin/csrf)
  //   3. localStorage entry (populated from the X-CSRF-Token response header)
  //   4. The XSRF-TOKEN cookie (set by send_csrf_cookie() on the backend)
  let csrf = null;
  if (meta && meta.content) {
    csrf = meta.content;
  } else if (typeof window !== 'undefined' && window.csrfToken) {
    csrf = window.csrfToken;
  } else if (localStorage.getItem('csrfToken')) {
    csrf = localStorage.getItem('csrfToken');
  } else {
    csrf = getCookie('XSRF-TOKEN');
  }

  const res = await fetch(url, {
    method,
    credentials: 'include', // <-- QUAN TRỌNG: gửi cookie phiên
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...headers,
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

  // Gợi ý: nếu server trả token mới trong header, lưu lại
  const newCsrf = res.headers.get('X-CSRF-Token');
  if (newCsrf) localStorage.setItem('csrfToken', newCsrf);

  if (!res.ok) {
    let detail = {};
    try { detail = await res.json(); } catch {}
    const err = new Error(`HTTP ${res.status}`);
    err.detail = detail;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([$?*|{}\]\\^])/g,'\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
