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
export async function apiFetch(path, options = {}) {
    const headers = options.headers || {};
    // Automatically set JSON Content-Type if we send a body
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    // Attach CSRF token for state-changing requests if available. The admin
    // page will set window.csrfToken after fetching from /admin/csrf. We use
    // window because this module has no direct access to admin.js variables.
    const method = (options.method || 'GET').toUpperCase();
    if (typeof window !== 'undefined' && window.csrfToken && !['GET','OPTIONS','HEAD'].includes(method)) {
        headers['X-CSRF-Token'] = window.csrfToken;
    }
    const fetchOptions = {
        ...options,
        headers,
        credentials: 'include' // include cookies (PHP session)
    };
    const response = await fetch(`${config.URLS.API_BASE}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw data;
    }
    return data;
}