// file: /assets/js/mylist.js
// Module to render the current user's personal reading list. This page
// requires the user to be logged in; otherwise they are redirected to
// the login page with a redirect back to the list.

import config from './config.js';
import { apiFetch } from './api.js';
import { Notice } from './notify.js';

// Determine storage key for the current user's list. Matches helper in main.js.
function getListKey(session) {
    const uid = session && session.id ? session.id : 'guest';
    return `mylist_${uid}`;
}

// Retrieve saved list from localStorage for the given session.
function getMyList(session) {
    try {
        const raw = localStorage.getItem(getListKey(session));
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

// Render a simple book card. Mirrors layout used on the main page for
// consistency (cover, title, author, and quick actions). Only includes
// read and remove actions.
function renderCard(book, session) {
    const coverUrl = `${config.URLS.ROOT}${book.cover_image_url}`;
    // Determine if the user can read this book (free or owned or lifetime package)
    const owned = session && (session.role === 'admin');
    // We'll just link to reader page; underlying restrictions still apply
    return `
        <div class="book-card" data-book-id="${book.id}">
            <div class="book-card__cover"><img src="${coverUrl}" alt="Bìa sách ${book.title}"></div>
            <div class="book-card__info">
                <h3 class="book-card__title">${book.title}</h3>
                <p class="book-card__author">${book.author || ''}</p>
                <div class="book-card__actions-inline">
                    <button class="action-btn" data-action="read" title="Đọc ngay"><i class="fas fa-book-open"></i> Đọc</button>
                    <button class="action-btn" data-action="details" title="Chi tiết"><i class="fas fa-info-circle"></i> Chi tiết</button>
                    <button class="action-btn" data-action="remove" title="Xóa khỏi danh sách"><i class="fas fa-times"></i> Xóa</button>
                </div>
            </div>
        </div>
    `;
}

async function init() {
    const container = document.getElementById('mylist-container');
    // Fetch current session
    let session = null;
    try {
        const res = await apiFetch('/session');
        session = res.user;
    } catch (_) {
        session = null;
    }
    // If not logged in, redirect to login page with redirect back to mylist
    if (!session) {
        const redirect = encodeURIComponent('mylist.html');
        window.location.href = `${config.URLS.LOGIN}?redirect=${redirect}`;
        return;
    }
    // Load books list from backend
    let books = [];
    try {
        books = await apiFetch('/books');
    } catch (_) {
        books = [];
    }
    if (!Array.isArray(books)) {
        books = books && Array.isArray(books.books) ? books.books : [];
    }
    // Get saved IDs
    const ids = getMyList(session);
    const filtered = books.filter(b => ids.includes(b.id));
    if (filtered.length === 0) {
        container.innerHTML = '<p>Bạn chưa thêm sách nào vào danh sách.</p>';
        return;
    }
    // Render list
    container.innerHTML = filtered.map(b => renderCard(b, session)).join('');
    // Add event listeners for actions
    container.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.action-btn');
        const card = e.target.closest('.book-card');
        if (!card || !actionBtn) return;
        const bookId = parseInt(card.dataset.bookId);
        const action = actionBtn.dataset.action;
        if (action === 'read') {
            window.location.href = `reader.html?book_id=${bookId}`;
        } else if (action === 'details') {
            // fetch details and show a simple alert or redirect to details modal on main page
            window.location.href = `reader.html?book_id=${bookId}`;
        } else if (action === 'remove') {
            const list = getMyList(session);
            const index = list.indexOf(bookId);
            if (index >= 0) {
                list.splice(index, 1);
                localStorage.setItem(getListKey(session), JSON.stringify(list));
                // remove card from DOM
                card.remove();
                if (!document.querySelector('.book-card')) {
                    container.innerHTML = '<p>Bạn chưa thêm sách nào vào danh sách.</p>';
                }
                Notice.show('info', 'Đã xóa khỏi danh sách');
            }
        }
    });
}

init();