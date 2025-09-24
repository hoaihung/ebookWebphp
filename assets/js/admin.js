// file: /assets/js/admin.js
// Admin panel logic for EbookLib. Provides CRUD operations for books,
// users and notifications via the backend API.

import config from './config.js';
import { apiFetch } from './api.js';
// Drag-and-drop sorting was replaced by simple up/down controls. The sortable helper is no longer imported.
// import { makeSortable } from './vendor/sortable-lite.js';

// DOM references (sections and forms)
const loadBooksBtn = document.getElementById('load-books-btn');
const booksTableBody = document.querySelector('#books-table tbody');
const bookForm = document.getElementById('book-form');
const bookFormResetBtn = document.getElementById('book-form-reset');

const loadUsersBtn = document.getElementById('load-users-btn');
const usersTableBody = document.querySelector('#users-table tbody');

const loadNotifsBtn = document.getElementById('load-notifs-btn');
const notifsTableBody = document.querySelector('#notifs-table tbody');
const notifForm = document.getElementById('notif-form');
const notifFormResetBtn = document.getElementById('notif-form-reset');

// Packages DOM references
const loadPackagesBtn = document.getElementById('load-packages-btn');
const packagesTableBody = document.querySelector('#packages-table tbody');
const packageForm = document.getElementById('package-form');
const packageFormResetBtn = document.getElementById('package-form-reset');
const packageIdInput = document.getElementById('package-id');
const packageNameInput = document.getElementById('package-name');
const packageAccessTypeInput = document.getElementById('package-access-type');
const packagePriceInput = document.getElementById('package-price');
const packageTotalSlotsInput = document.getElementById('package-total-slots');
const packageIsActiveInput = document.getElementById('package-is-active');
const packageDescriptionInput = document.getElementById('package-description');

// New DOM references for cover upload and chapters editing
const coverInput = document.getElementById('book-cover');
const coverUrlInput = document.getElementById('book-cover-url');
const coverPreview = document.getElementById('book-cover-preview');
const coverRemoveBtn = document.getElementById('book-cover-remove');

// Updated section references for books/users/packages/notifications (sidebar sections)
const booksSection = document.getElementById('books-section');
const usersSection = document.getElementById('users-section');
const packagesSection = document.getElementById('packages-section');
const notificationsSection = document.getElementById('notifications-section');
const chaptersSection = document.getElementById('chapters-section');
const chaptersTableBody = document.querySelector('#chapters-table tbody');
const chaptersBookTitle = document.getElementById('chapters-book-title');
const backToBooksBtn = document.getElementById('back-to-books');

// Additional references for add chapter button and heading
const addChapterBtn = document.getElementById('add-chapter-btn');
const chapterEditorHeading = document.getElementById('chapter-editor-heading');

const chapterEditor = document.getElementById('chapter-editor');
const chapterIdInput = document.getElementById('chapter-id');
const chapterTitleInput = document.getElementById('chapter-title');
const chapterContentTextarea = document.getElementById('chapter-content');
const saveChapterBtn = document.getElementById('save-chapter-btn');
const cancelChapterBtn = document.getElementById('cancel-chapter-btn');

// New inputs for chapter ordering and sort key
const chapterNumberInput = document.getElementById('chapter-number');
const chapterSortInput = document.getElementById('chapter-sort');
const chaptersWarningDiv = document.getElementById('chapters-warning');

// Track current book for chapters editing
let currentBookId = null;
let currentBookTitle = '';

// CSRF token for admin actions. Will be set when the admin panel loads.
let csrfToken = null;

// Global arrays to store all books and packages for user assignment
let availableBooks = [];
let availablePackages = [];

// Fetch the CSRF token for admin operations. This should be called once
// when the admin page loads. The token is stored on the window object so
// apiFetch can attach it to subsequent requests. If fetching fails, the
// admin may not be authorised.
async function fetchCsrfToken() {
    try {
        const res = await apiFetch('/admin/csrf');
        if (res && res.token) {
            window.csrfToken = res.token;
            csrfToken = res.token;
        }
    } catch (err) {
        console.warn('Không thể lấy CSRF token:', err.message || err);
    }
}
// Helper: parse Markdown into legacy JSON blocks. Returns { title, blocks }
function parseMarkdownToBlocks(md) {
    const lines = md.split(/\r?\n/);
    const blocks = [];
    let i = 0;
    let title = '';
    const n = lines.length;
    while (i < n) {
        let line = lines[i].trim();
        // Skip blank lines
        if (!line) { i++; continue; }
        // Callout starting with :::info, :::warn or :::success
        const calloutMatch = line.match(/^:::\s*(info|warn|success)/i);
        if (calloutMatch) {
            const levelRaw = calloutMatch[1].toLowerCase();
            let level = levelRaw;
            if (level === 'warn') level = 'warning';
            if (level === 'info') level = 'info';
            if (level === 'success') level = 'success';
            i++;
            const calloutLines = [];
            while (i < n && !/^:::/i.test(lines[i].trim())) {
                calloutLines.push(lines[i].replace(/\r$/, ''));
                i++;
            }
            // Skip closing :::
            if (i < n && /^:::/i.test(lines[i].trim())) {
                i++;
            }
            blocks.push({ type: 'alert', level: level, text: calloutLines.join('\n').trim() });
            continue;
        }
        // Quotes starting with >
        if (line.startsWith('>')) {
            const quoteLines = [];
            while (i < n && lines[i].trim().startsWith('>')) {
                const ql = lines[i].trim().replace(/^>\s?/, '');
                quoteLines.push(ql);
                i++;
            }
            blocks.push({ type: 'quote', text: quoteLines.join('\n') });
            continue;
        }
        // Unordered list (- or *)
        if (/^[-*]\s+/.test(line)) {
            const items = [];
            while (i < n && /^[-*]\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
                i++;
            }
            blocks.push({ type: 'list', items });
            continue;
        }
        // Ordered list (1., 2., etc.)
        if (/^\d+\.\s+/.test(line)) {
            const items = [];
            while (i < n && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
                i++;
            }
            blocks.push({ type: 'list', items });
            continue;
        }
        // Heading (#, ##, ###)
        const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2].trim();
            if (level === 1 && !title) {
                title = text;
            }
            blocks.push({ type: 'subheading', text });
            i++;
            continue;
        }
        // Paragraph: gather until blank line or special
        const paraLines = [];
        while (i < n) {
            const cline = lines[i];
            const trimmed = cline.trim();
            if (!trimmed) break;
            if (/^:::\s*(info|warn|success)/i.test(trimmed) || trimmed.startsWith('>') || /^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^#{1,3}\s+/.test(trimmed)) {
                break;
            }
            paraLines.push(cline.replace(/\r$/, ''));
            i++;
        }
        if (paraLines.length > 0) {
            blocks.push({ type: 'paragraph', text: paraLines.join('\n').trim() });
            continue;
        }
        // Fallback
        i++;
    }
    return { title, blocks };
}

// Immediately fetch CSRF token on module load
fetchCsrfToken();

// User form references
const userForm = document.getElementById('user-form');
const userFormResetBtn = document.getElementById('user-form-reset');
const userIdInput = document.getElementById('user-id');
const userEmailInput = document.getElementById('user-email');
const userRoleSelect = document.getElementById('user-role');
const userPasswordInput = document.getElementById('user-password');

// New DOM references for TOC upload and chapters import
const tocFileInput = document.getElementById('book-toc-file');
const chapterImportFolderInput = document.getElementById('chapter-import-folder');
const importChaptersBtn = document.getElementById('import-chapters-btn');
// New: save order button for chapters
const saveOrderBtn = document.getElementById('save-order-btn');
const editTocBtn = document.getElementById('edit-toc-btn');
const tocEditorContainer = document.getElementById('toc-editor');
const tocJsonEditor = document.getElementById('toc-json-editor');
const saveTocBtn = document.getElementById('save-toc-btn');
const cancelTocBtn = document.getElementById('cancel-toc-btn');

// Chapter format selection and markdown textarea
const chapterFormatSelect = document.getElementById('chapter-format');
const chapterMdTextarea = document.getElementById('chapter-md-content');
const chapterJsonContainer = document.getElementById('chapter-json-container');
const chapterMdContainer = document.getElementById('chapter-md-container');

// Notification helper for admin. Displays modal messages and replaces window.alert.
export const AdminNotice = {
    el: null,
    titleEl: null,
    msgEl: null,
    iconEl: null,
    closeBtn: null,
    timer: null,
    ensure() {
        if (this.el) return;
        this.el = document.getElementById('admin-notice');
        if (!this.el) return;
        this.titleEl = document.getElementById('admin-notice-title');
        this.msgEl = document.getElementById('admin-notice-message');
        this.iconEl = document.getElementById('admin-notice-icon');
        this.closeBtn = document.getElementById('admin-notice-close');
        this.closeBtn.addEventListener('click', () => this.hide());
        this.el.addEventListener('click', (e) => {
            if (e.target === this.el) this.hide();
        });
    },
    show(type = 'info', message = '') {
        this.ensure();
        if (!this.el) {
            console.warn('AdminNotice element not found');
            return;
        }
        const icons = { success: '✅', error: '⛔', info: 'ℹ️', warning: '⚠️' };
        this.iconEl.textContent = icons[type] || 'ℹ️';
        this.titleEl.textContent = type.toUpperCase();
        this.msgEl.textContent = message;
        this.el.style.display = 'flex';
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.hide(), 3500);
    },
    hide() {
        if (this.el) this.el.style.display = 'none';
    }
};

// Override default alert to use AdminNotice in admin UI
window.alert = (msg) => {
    const trimmed = (msg || '').toString().trim();
    let type = 'info';
    if (/^(Đã|Đã\s|Xóa|Xoá|Cập nhật|Tạo)/i.test(trimmed)) {
        type = 'success';
    } else if (/^(Lỗi|Không|Error|Không thể)/i.test(trimmed)) {
        type = 'error';
    }
    AdminNotice.show(type, trimmed);
};

// Helper: clear book form
function resetBookForm() {
    bookForm.reset();
    document.getElementById('book-id').value = '';
    // Reset cover input and hidden field
    if (coverInput) coverInput.value = '';
    if (coverUrlInput) coverUrlInput.value = '';
    // Hide preview and remove button
    if (coverPreview) {
        coverPreview.style.display = 'none';
        coverPreview.src = '';
    }
    if (coverRemoveBtn) {
        coverRemoveBtn.style.display = 'none';
    }

    // Clear extra fields for TOC and folder import when resetting
    if (tocFileInput) tocFileInput.value = '';
    if (chapterImportFolderInput) chapterImportFolderInput.value = '';
    // Disable import chapters button when no book is selected
    if (importChaptersBtn) importChaptersBtn.disabled = true;

    // Show import folder for new book, hide chapter import for existing
    const bookFolderContainer = document.getElementById('book-folder-container');
    const chapterImportContainer = document.getElementById('chapter-import-container');
    if (bookFolderContainer) bookFolderContainer.style.display = '';
    if (chapterImportContainer) chapterImportContainer.style.display = 'none';
}

// Helper: render books table
function renderBooksTable(books) {
    booksTableBody.innerHTML = '';
    // Save to global availableBooks for user assignment
    availableBooks = books.map(b => ({ id: b.id, title: b.title }));
    books.forEach(book => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${book.id}</td>
            <td>${book.title || ''}</td>
            <td>${book.author || ''}</td>
            <td>${book.access_level}</td>
            <td>${book.price || 0}</td>
            <td>${book.is_published ? '✔️' : '❌'}</td>
            <td>
                <button class="edit-book-btn" data-id="${book.id}">Sửa</button>
                <button class="delete-book-btn" data-id="${book.id}">Xoá</button>
                <button class="chapters-book-btn" data-id="${book.id}" data-title="${book.title || ''}">Chương</button>
            </td>
        `;
        booksTableBody.appendChild(tr);
    });
}

// Load books list
async function loadBooks() {
    try {
        const books = await apiFetch('/admin/books');
        renderBooksTable(books);
    } catch (err) {
        console.error('Lỗi tải sách:', err);
        alert(err.message || 'Lỗi tải sách');
    }
}

// Render chapters table
function renderChaptersTable(chapters) {
    chaptersTableBody.innerHTML = '';
    chapters.forEach(ch => {
        const tr = document.createElement('tr');
        tr.dataset.id = ch.id;
        tr.dataset.chapterNumber = ch.chapter_number;
        // Move controls cell with up and down buttons
        const moveTd = document.createElement('td');
        moveTd.className = 'move-cell';
        const upBtn = document.createElement('button');
        upBtn.className = 'move-up btn btn-sm btn-light me-1';
        upBtn.setAttribute('type', 'button');
        upBtn.setAttribute('title', 'Di chuyển lên');
        upBtn.textContent = '↑';
        const downBtn = document.createElement('button');
        downBtn.className = 'move-down btn btn-sm btn-light';
        downBtn.setAttribute('type', 'button');
        downBtn.setAttribute('title', 'Di chuyển xuống');
        downBtn.textContent = '↓';
        moveTd.appendChild(upBtn);
        moveTd.appendChild(downBtn);
        // ID column
        const idTd = document.createElement('td');
        idTd.textContent = ch.id;
        // Order column (displays current order). No input field; number shown will update when reordering.
        const orderTd = document.createElement('td');
        orderTd.textContent = ch.chapter_number;
        orderTd.setAttribute('data-col', 'chapter_number');
        // Title column
        const titleTd = document.createElement('td');
        titleTd.textContent = ch.title || '';
        // Actions column
        const actionsTd = document.createElement('td');
        const editBtnEl = document.createElement('button');
        editBtnEl.className = 'edit-chapter-btn btn btn-sm btn-secondary me-1';
        editBtnEl.dataset.id = ch.id;
        editBtnEl.textContent = 'Sửa';
        const delBtnEl = document.createElement('button');
        delBtnEl.className = 'delete-chapter-btn btn btn-sm btn-danger';
        delBtnEl.dataset.id = ch.id;
        delBtnEl.textContent = 'Xoá';
        actionsTd.appendChild(editBtnEl);
        actionsTd.appendChild(delBtnEl);
        // Append cells
        tr.appendChild(moveTd);
        tr.appendChild(idTd);
        tr.appendChild(orderTd);
        tr.appendChild(titleTd);
        tr.appendChild(actionsTd);
        chaptersTableBody.appendChild(tr);
    });
    // After rendering, update order numbers based on current row order
    updateChapterOrderDisplay();
}

// Update the displayed chapter order numbers after drag-and-drop. The order is
// determined by the position of rows in the table body. The second cell
// (index 1) of each row is updated to reflect the new sequential number.
function updateChapterOrderDisplay() {
    const rows = chaptersTableBody.querySelectorAll('tr');
    rows.forEach((row, idx) => {
        const cells = row.children;
        // The order column is now at index 2 (after move controls and ID)
        if (cells.length > 2) {
            cells[2].textContent = idx + 1;
        }
    });
    // Disable up on first row and down on last row for clarity
    rows.forEach((row, idx) => {
        const upBtn = row.querySelector('.move-up');
        const downBtn = row.querySelector('.move-down');
        if (upBtn) upBtn.disabled = (idx === 0);
        if (downBtn) downBtn.disabled = (idx === rows.length - 1);
    });
}

// Load chapters for a book and show the chapters section
async function loadChaptersForBook(bookId, bookTitle) {
    try {
        const chapters = await apiFetch(`/admin/books/${bookId}/chapters`);
        renderChaptersTable(chapters);
        chaptersBookTitle.textContent = bookTitle;
        // Show chapters section and hide other sections
        booksSection.classList.add('hidden');
        usersSection.classList.add('hidden');
        packagesSection.classList.add('hidden');
        notificationsSection.classList.add('hidden');
        chapterEditor.classList.add('hidden');
        chaptersSection.classList.remove('hidden');
        // Hide any previous warnings when loading chapters list
        if (chaptersWarningDiv) {
            chaptersWarningDiv.classList.add('d-none');
            chaptersWarningDiv.textContent = '';
        }
    } catch (err) {
        console.error(err);
        alert(err.message || 'Lỗi tải chương');
    }
}

// Handle back to books list
if (backToBooksBtn) {
    backToBooksBtn.addEventListener('click', () => {
        chaptersSection.classList.add('hidden');
        chapterEditor.classList.add('hidden');
        // Show the books section via sidebar nav
        const navContainer = document.getElementById('admin-sidebar');
        if (navContainer) {
            const booksLink = navContainer.querySelector('.nav-link[data-section="books-section"]');
            if (booksLink) booksLink.click();
        }
    });
}

// Handle clicks in chapters table (edit)
chaptersTableBody.addEventListener('click', (e) => {
    // Handle move up and down buttons
    const upBtnEl = e.target.closest('.move-up');
    if (upBtnEl) {
        const row = upBtnEl.closest('tr');
        if (row) {
            const prev = row.previousElementSibling;
            if (prev) {
                chaptersTableBody.insertBefore(row, prev);
                updateChapterOrderDisplay();
            }
        }
        return;
    }
    const downBtnEl = e.target.closest('.move-down');
    if (downBtnEl) {
        const row = downBtnEl.closest('tr');
        if (row) {
            const next = row.nextElementSibling;
            if (next) {
                chaptersTableBody.insertBefore(next, row);
                updateChapterOrderDisplay();
            }
        }
        return;
    }
    // Handle edit button
    const editBtn = e.target.closest('.edit-chapter-btn');
    if (editBtn) {
        const cid = editBtn.dataset.id;
        editChapter(cid);
        return;
    }
    // Handle delete button
    const deleteBtn = e.target.closest('.delete-chapter-btn');
    if (deleteBtn) {
        const cid = deleteBtn.dataset.id;
        if (!cid) return;
        if (!confirm('Bạn có chắc chắn muốn xoá chương này?')) return;
        apiFetch(`/admin/chapters/${cid}`, { method: 'DELETE' })
            .then(() => {
                alert('Đã xoá chương.');
                if (currentBookId) {
                    loadChaptersForBook(currentBookId, currentBookTitle);
                }
            })
            .catch(err => {
                console.error(err);
                alert(err.message || 'Lỗi xoá chương');
            });
        return;
    }
});

// Drag events for chapters reordering are now handled by sortable-lite.js.

// Fetch a chapter and open editor
async function editChapter(chapterId) {
    try {
        const ch = await apiFetch(`/admin/chapters/${chapterId}`);
        chapterIdInput.value = ch.id;
        chapterTitleInput.value = ch.title || '';
        // Populate chapter number
        if (chapterNumberInput) {
            chapterNumberInput.value = ch.chapter_number !== undefined ? ch.chapter_number : '';
            chapterNumberInput.dataset.originalNumber = (ch.chapter_number ?? '') + '';
        }
        // Populate sort key from content.meta.sort_key if exists
        if (chapterSortInput) {
            let sortVal = '';
            if (ch.content && ch.content.meta && ch.content.meta.sort_key) {
                sortVal = ch.content.meta.sort_key;
            }
            chapterSortInput.value = sortVal;
        }
        chapterContentTextarea.value = JSON.stringify(ch.content || {}, null, 2);
        // Always default editor to JSON when editing existing chapter
        if (chapterFormatSelect) {
            chapterFormatSelect.value = 'json';
            if (typeof updateChapterFormatUI === 'function') updateChapterFormatUI();
        }
        // Hide any warnings when editing
        if (chaptersWarningDiv) {
            chaptersWarningDiv.classList.add('d-none');
            chaptersWarningDiv.textContent = '';
        }
        // Switch to editor view
        chaptersSection.classList.add('hidden');
        chapterEditor.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        alert(err.message || 'Lỗi tải chương');
    }
}

// Save chapter changes
if (saveChapterBtn) {
    saveChapterBtn.addEventListener('click', async () => {
        const id = chapterIdInput.value;
        let title = chapterTitleInput.value.trim();
        let content = null;
        // Determine format (json vs markdown)
        const format = chapterFormatSelect ? chapterFormatSelect.value : 'json';
        if (format === 'markdown') {
            // Parse Markdown into blocks on client side
            const mdText = chapterMdTextarea ? chapterMdTextarea.value || '' : '';
            const parsed = parseMarkdownToBlocks(mdText);
            if (!title && parsed.title) {
                title = parsed.title;
            }
            content = { blocks: parsed.blocks };
        } else {
            // JSON: parse from textarea
            try {
                content = JSON.parse(chapterContentTextarea.value || '{}');
            } catch (e) {
                // Fallback: attempt to treat the input as Markdown if JSON parse fails
                const raw = chapterContentTextarea.value || '';
                const parsed = parseMarkdownToBlocks(raw);
                if (parsed && parsed.blocks && parsed.blocks.length > 0) {
                    if (!title && parsed.title) {
                        title = parsed.title;
                    }
                    content = { blocks: parsed.blocks };
                } else {
                    alert('Nội dung JSON không hợp lệ.');
                    return;
                }
            }
        }
        // Add sort key into meta if provided
        const sortVal = chapterSortInput ? chapterSortInput.value.trim() : '';
        if (sortVal) {
            if (!content.meta) content.meta = {};
            content.meta.sort_key = sortVal;
        }
        // Normalise meta keys to ensure frontend can load: fill missing keys
        // Determine chapter number from input
        const numVal = chapterNumberInput && chapterNumberInput.value !== '' ? parseInt(chapterNumberInput.value) : null;
        let numForSend = numVal;
        if (id && chapterNumberInput) {
          const original = chapterNumberInput.dataset.originalNumber;
          if (original !== undefined && original !== '' && Number(original) === numVal) {
            numForSend = null; // không gửi nếu không đổi
          }
        }
        // Set chapterNumber fields if missing
        if (numVal !== null && !isNaN(numVal)) {
            // At root
            content.chapterNumber = numVal;
            // In meta
            if (!content.meta) content.meta = {};
            content.meta.chapter_number = numVal;
        }
        // Determine base title: prefer manual title input, else parsed title
        const baseTitle = title || (content.meta && content.meta.chapterTitle) || (content.chapterTitle) || '';
        // Set title fields if missing
        if (baseTitle) {
            if (!content.title) content.title = baseTitle;
            if (!content.chapterTitle) content.chapterTitle = baseTitle;
            if (!content.meta) content.meta = {};
            if (!content.meta.title) content.meta.title = baseTitle;
            if (!content.meta.chapterTitle) content.meta.chapterTitle = baseTitle;
        }
        // Estimate reading time if not provided
        if (!content.readingTimeInMinutes) {
            // Count words from all text fields in blocks
            let textConcat = '';
            if (content.blocks && Array.isArray(content.blocks)) {
                content.blocks.forEach(b => {
                    if (typeof b.text === 'string') textConcat += ' ' + b.text;
                    if (typeof b.content === 'string') textConcat += ' ' + b.content;
                    if (Array.isArray(b.items)) {
                        b.items.forEach(it => {
                            if (typeof it === 'string') textConcat += ' ' + it;
                        });
                    }
                });
            }
            const words = textConcat.trim().split(/\s+/).filter(w => w.length > 0);
            const minutes = Math.max(1, Math.ceil(words.length / 200));
            content.readingTimeInMinutes = minutes;
        }
        // Set default difficulty if missing
        if (!content.difficulty) {
            content.difficulty = 'Trung bình';
        }
        // Ensure learningObjectives structure exists
        if (!content.learningObjectives) {
            content.learningObjectives = { title: '', objectives: [] };
        }
        // Ensure objectives array exists (alias to learningObjectives.objectives if missing)
        if (!content.objectives) {
            if (content.learningObjectives && Array.isArray(content.learningObjectives.objectives)) {
                content.objectives = [...content.learningObjectives.objectives];
            } else {
                content.objectives = [];
            }
        }
        try {
            let res;
            if (id) {
                // Update existing chapter
                const body = { title, content };
                if (numForSend !== null) { body.chapter_number = numForSend; }
                res = await apiFetch(`/admin/chapters/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(body)
                });
            } else {
                // Create new chapter for current book
                const body = { title, content };
                if (numForSend !== null) { body.chapter_number = numForSend; }
                res = await apiFetch(`/admin/books/${currentBookId}/chapters`, {
                    method: 'POST',
                    body: JSON.stringify(body)
                });
            }
            // Show warnings if any
            if (res && res.warnings && res.warnings.length > 0) {
                if (chaptersWarningDiv) {
                    chaptersWarningDiv.textContent = res.warnings.join('\n');
                    chaptersWarningDiv.classList.remove('d-none');
                } else {
                    alert(res.warnings.join('\n'));
                }
            }
            const successMsg = id ? 'Đã cập nhật chương.' : 'Đã tạo chương mới.';
            alert(successMsg);
            // Reload chapters and return to list
            await loadChaptersForBook(currentBookId, currentBookTitle);
        } catch (err) {
            console.error(err);
            alert(err.message || 'Lỗi lưu chương');
        }
    });
}

// Cancel chapter editing
if (cancelChapterBtn) {
    cancelChapterBtn.addEventListener('click', () => {
        chapterEditor.classList.add('hidden');
        // Show chapters list again
        chaptersSection.classList.remove('hidden');
    });
}

// Event: handle edit/delete buttons in books table
booksTableBody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-book-btn');
    const deleteBtn = e.target.closest('.delete-book-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        // Fetch full book details to populate form and show cover
        apiFetch(`/books/${id}`)
            .then(book => {
                document.getElementById('book-id').value = id;
                document.getElementById('book-title').value = book.title || '';
                document.getElementById('book-author').value = book.author || '';
                document.getElementById('book-access-level').value = book.access_level || 'free';
                document.getElementById('book-price').value = book.price || 0;
                document.getElementById('book-published').checked = !!book.is_published;
                document.getElementById('book-description').value = book.description || '';
                document.getElementById('book-template').value = book.template_path || '';
                document.getElementById('book-folder').value = '';
                document.getElementById('book-send-notification').checked = false;
                // Cover preview
                if (book.cover_image_url) {
                    coverUrlInput.value = book.cover_image_url;
                    if (coverPreview) {
                        coverPreview.src = `${config.URLS.ROOT}${book.cover_image_url}`;
                        coverPreview.style.display = 'block';
                    }
                    if (coverRemoveBtn) {
                        coverRemoveBtn.style.display = 'inline-block';
                    }
                } else {
                    coverUrlInput.value = '';
                    if (coverPreview) {
                        coverPreview.src = '';
                        coverPreview.style.display = 'none';
                    }
                    if (coverRemoveBtn) {
                        coverRemoveBtn.style.display = 'none';
                    }
                }

                // Switch import inputs: hide folder import (used for new book) and show chapter import for existing
                const bookFolderContainer = document.getElementById('book-folder-container');
                const chapterImportContainer = document.getElementById('chapter-import-container');
                if (bookFolderContainer) bookFolderContainer.style.display = 'none';
                if (chapterImportContainer) chapterImportContainer.style.display = '';

                // Enable chapter import tools when editing an existing book
                if (importChaptersBtn) {
                    importChaptersBtn.disabled = false;
                }
                if (tocFileInput) {
                    // Clear any previously selected TOC file
                    tocFileInput.value = '';
                }
                if (chapterImportFolderInput) {
                    // Clear previously entered folder path
                    chapterImportFolderInput.value = '';
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
            })
            .catch(err => {
                console.error(err);
                alert(err.message || 'Lỗi tải thông tin sách');
            });
    }
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        if (confirm('Bạn có chắc chắn muốn xoá sách này?')) {
            apiFetch(`/admin/books/${id}`, { method: 'DELETE' })
                .then(() => {
                    alert('Đã xoá sách.');
                    loadBooks();
                })
                .catch(err => {
                    console.error(err);
                    alert(err.message || 'Lỗi xoá sách');
                });
        }
    }
    const chaptersBtn = e.target.closest('.chapters-book-btn');
    if (chaptersBtn) {
        const id = chaptersBtn.dataset.id;
        const title = chaptersBtn.dataset.title;
        currentBookId = parseInt(id);
        currentBookTitle = title;
        loadChaptersForBook(currentBookId, currentBookTitle);
    }
});

// Handle book form submission
bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('book-id').value;
    const title = document.getElementById('book-title').value.trim();
    const author = document.getElementById('book-author').value.trim();
    const description = document.getElementById('book-description').value.trim();
    const templatePath = document.getElementById('book-template').value.trim();
    const accessLevel = document.getElementById('book-access-level').value;
    const price = parseFloat(document.getElementById('book-price').value || '0');
    const isPublished = document.getElementById('book-published').checked;
    const folder = document.getElementById('book-folder').value.trim();
    const sendNotification = document.getElementById('book-send-notification').checked;
    const payload = {
        title,
        author,
        description,
        template_path: templatePath || undefined,
        access_level: accessLevel,
        price,
        is_published: isPublished,
        folder: folder || undefined,
        send_notification: sendNotification
    };
    // Include cover image URL if present
    const coverUrl = coverUrlInput.value ? coverUrlInput.value.trim() : '';
    if (coverUrl) {
        payload.cover_image_url = coverUrl;
    }
    try {
        let savedBookId = (id && Number(id) > 0) ? Number(id) : null;
        if (id) {
            await apiFetch(`/admin/books/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('Đã cập nhật sách.');
        } else {
            const res = await apiFetch('/admin/books', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            savedBookId = res.book_id;
            alert('Đã tạo sách mới với ID ' + savedBookId);
        }
        // If a TOC file is provided and book ID is available, update the toc_json
        if (tocFileInput && tocFileInput.files && tocFileInput.files.length > 0 && savedBookId) {
            const file = tocFileInput.files[0];
            try {
                const text = await file.text();
                const tocObj = JSON.parse(text);
                await apiFetch(`/admin/books/${savedBookId}/toc`, {
                    method: 'PUT',
                    body: JSON.stringify({ toc: tocObj })
                });
                alert('Đã cập nhật mục lục cho sách.');
            } catch (e) {
                console.error(e);
                alert('Không thể đọc hoặc parse file TOC. Vui lòng đảm bảo file JSON hợp lệ.');
            }
        }
        resetBookForm();
        loadBooks();
    } catch (err) {
        console.error(err);
        alert(err.message || 'Lỗi lưu sách - CSRF');
    }
});

bookFormResetBtn.addEventListener('click', resetBookForm);

// Render users table
function renderUsersTable(users, entitlementsMap = {}) {
    usersTableBody.innerHTML = '';
    users.forEach(user => {
        const tr = document.createElement('tr');
        // Build book options
        let bookOptions = '<option value="">Chọn sách...</option>';
        availableBooks.forEach(b => {
            bookOptions += `<option value="${b.id}">${b.title}</option>`;
        });
        // Build package options
        let packageOptions = '<option value="">Chọn gói...</option>';
        availablePackages.forEach(p => {
            packageOptions += `<option value="${p.id}">${p.name}</option>`;
        });
        // Build entitlements display using badges
        let entHTML = '';
        const ent = entitlementsMap[user.id] || { books: [], packages: [] };
        const entPieces = [];
        if (ent.books && ent.books.length > 0) {
            ent.books.forEach(b => {
                const title = b.title || `Sách #${b.id}`;
                entPieces.push(
                    `<span class="entitlement-badge book-badge" title="Sách: ${title}">` +
                    `${title}<span class="remove-ent" data-user-id="${user.id}" data-type="book" data-ent-id="${b.id}" title="Bỏ quyền truy cập">×</span>` +
                    `</span>`
                );
            });
        }
        if (ent.packages && ent.packages.length > 0) {
            ent.packages.forEach(p => {
                const name = p.name || `Gói #${p.id}`;
                entPieces.push(
                    `<span class="entitlement-badge package-badge" title="Gói: ${name}">` +
                    `${name}<span class="remove-ent" data-user-id="${user.id}" data-type="package" data-ent-id="${p.id}" title="Bỏ quyền truy cập">×</span>` +
                    `</span>`
                );
            });
        }
        entHTML = entPieces.join(' ');
        tr.innerHTML = `
            <td>${user.id}</td>
            <td>${user.email}</td>
            <td>
                <select class="user-role-select form-select form-select-sm" data-id="${user.id}">
                    <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
                </select>
            </td>
            <td>${entHTML || '<span class="text-muted">-</span>'}</td>
            <td>
                <select class="assign-book-select form-select form-select-sm" data-id="${user.id}">
                    ${bookOptions}
                </select>
                <button class="assign-book-btn btn btn-sm btn-primary mt-1" data-id="${user.id}">Gán</button>
            </td>
            <td>
                <select class="assign-package-select form-select form-select-sm" data-id="${user.id}">
                    ${packageOptions}
                </select>
                <button class="assign-package-btn btn btn-sm btn-primary mt-1" data-id="${user.id}">Gán</button>
            </td>
            <td>
                <button class="edit-user-btn btn btn-sm btn-secondary" data-id="${user.id}">Sửa</button>
                <button class="delete-user-btn btn btn-sm btn-danger ms-1" data-id="${user.id}">Xoá</button>
            </td>
        `;
        usersTableBody.appendChild(tr);
    });
}

// Load users list
async function loadUsers() {
    try {
        // Ensure available books and packages are loaded before rendering users
        if (availableBooks.length === 0 || availablePackages.length === 0) {
            await loadAvailableResources();
        }
        const users = await apiFetch('/admin/users');
        // Fetch entitlements for each user
        const entMap = {};
        await Promise.all(users.map(async (u) => {
            try {
                const ent = await apiFetch(`/admin/users/${u.id}/entitlements`);
                entMap[u.id] = ent;
            } catch (err) {
                console.warn('Không thể tải quyền sở hữu cho người dùng', u.id, err);
                entMap[u.id] = { books: [], packages: [] };
            }
        }));
        renderUsersTable(users, entMap);
    } catch (err) {
        console.error(err);
        alert(err.message || 'Lỗi tải người dùng');
    }
}

// Load available books and packages for assignment
async function loadAvailableResources() {
    try {
        // Fetch books list (admin) to get id and title
        const books = await apiFetch('/admin/books');
        availableBooks = books.map(b => ({ id: b.id, title: b.title || '' }));
    } catch (err) {
        console.warn('Không thể tải danh sách sách:', err);
    }
    try {
        const pkgs = await apiFetch('/admin/packages');
        availablePackages = pkgs.map(p => ({ id: p.id, name: p.name || '' }));
    } catch (err) {
        console.warn('Không thể tải danh sách gói:', err);
    }
 }

// Event: handle user actions (role change, assign book/package)
usersTableBody.addEventListener('change', (e) => {
    const roleSelect = e.target.closest('.user-role-select');
    if (roleSelect) {
        const userId = roleSelect.dataset.id;
        const newRole = roleSelect.value;
        apiFetch(`/admin/users/${userId}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role: newRole })
        }).catch(err => {
            console.error(err);
            alert(err.message || 'Lỗi cập nhật role');
        });
    }
});

usersTableBody.addEventListener('click', (e) => {
    // Remove book/package entitlement from user
    if (e.target.classList.contains('remove-ent')) {
        const userId = e.target.dataset.userId;
        const type = e.target.dataset.type;
        const entId = e.target.dataset.entId;
        if (!userId || !type || !entId) return;
        if (!confirm('Bạn có chắc chắn muốn xoá quyền này?')) return;
        let endpoint = '';
        if (type === 'book') {
            endpoint = `/admin/users/${userId}/books/${entId}`;
        } else if (type === 'package') {
            endpoint = `/admin/users/${userId}/packages/${entId}`;
        }
        if (endpoint) {
            apiFetch(endpoint, { method: 'DELETE' })
                .then(() => {
                    alert('Đã xoá quyền khỏi người dùng.');
                    loadUsers();
                })
                .catch(err => {
                    console.error(err);
                    alert(err.message || 'Lỗi xoá quyền');
                });
        }
        return;
    }
    if (e.target.classList.contains('assign-book-btn')) {
        const userId = e.target.dataset.id;
        const select = e.target.parentElement.querySelector('.assign-book-select');
        const bookId = parseInt(select.value);
        if (!bookId) { alert('Chọn sách'); return; }
        apiFetch(`/admin/users/${userId}/books`, {
            method: 'POST',
            body: JSON.stringify({ book_id: bookId })
        }).then(() => {
            alert('Đã gán sách cho người dùng.');
            select.value = '';
        }).catch(err => {
            console.error(err);
            alert(err.message || 'Lỗi gán sách');
        });
    }
    if (e.target.classList.contains('assign-package-btn')) {
        const userId = e.target.dataset.id;
        const select = e.target.parentElement.querySelector('.assign-package-select');
        const packageId = parseInt(select.value);
        if (!packageId) { alert('Chọn gói'); return; }
        apiFetch(`/admin/users/${userId}/packages`, {
            method: 'POST',
            body: JSON.stringify({ package_id: packageId })
        }).then(() => {
            alert('Đã gán gói cho người dùng.');
            select.value = '';
        }).catch(err => {
            console.error(err);
            alert(err.message || 'Lỗi gán gói');
        });
    }

    // Edit user button
    if (e.target.classList.contains('edit-user-btn')) {
        const userId = e.target.dataset.id;
        // Find the row and fill form from cells
        const row = e.target.closest('tr');
        if (row) {
            userIdInput.value = userId;
            userEmailInput.value = row.children[1].textContent.trim();
            userRoleSelect.value = row.querySelector('.user-role-select').value;
            userPasswordInput.value = '';
            // Switch to users section via sidebar nav (optional)
            const nav = document.getElementById('admin-sidebar');
            if (nav) {
                const usersLink = nav.querySelector('.nav-link[data-section="users-section"]');
                if (usersLink) usersLink.click();
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // Delete user button
    if (e.target.classList.contains('delete-user-btn')) {
        const userId = e.target.dataset.id;
        if (confirm('Bạn có chắc chắn muốn xoá người dùng này?')) {
            apiFetch(`/admin/users/${userId}`, { method: 'DELETE' })
                .then(() => {
                    alert('Đã xoá người dùng.');
                    loadUsers();
                })
                .catch(err => {
                    console.error(err);
                    alert(err.message || 'Lỗi xoá người dùng');
                });
        }
    }
});

// Render notifications table
function renderNotifsTable(notifs) {
    notifsTableBody.innerHTML = '';
    notifs.forEach(n => {
        const tr = document.createElement('tr');
        const recipient = n.user_id ? `User ${n.user_id}` : 'Broadcast';
        tr.innerHTML = `<td>${n.id}</td><td>${recipient}</td><td>${n.title}</td><td>${n.message}</td><td>${n.created_at}</td>`;
        notifsTableBody.appendChild(tr);
    });
}

// Render packages table
function renderPackagesTable(packages) {
    packagesTableBody.innerHTML = '';
    packages.forEach(pkg => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${pkg.id}</td>
            <td>${pkg.name || ''}</td>
            <td>${pkg.description || ''}</td>
            <td>${pkg.access_type}</td>
            <td>${pkg.total_slots !== null ? pkg.total_slots : ''}</td>
            <td>${pkg.claimed_slots !== null ? pkg.claimed_slots : ''}</td>
            <td>${pkg.is_active ? '✔️' : '❌'}</td>
            <td>${pkg.price || 0}</td>
            <td>
                <button class="edit-package-btn btn btn-sm btn-secondary" data-id="${pkg.id}">Sửa</button>
                <button class="delete-package-btn btn btn-sm btn-danger ms-1" data-id="${pkg.id}">Xoá</button>
            </td>
        `;
        packagesTableBody.appendChild(tr);
    });
}

// Load packages list
async function loadPackages() {
    try {
        const packages = await apiFetch('/admin/packages');
        renderPackagesTable(packages);
    } catch (err) {
        console.error(err);
        alert(err.message || 'Lỗi tải gói');
    }
}

// Load notifications
async function loadNotifs() {
    try {
        const notifs = await apiFetch('/admin/notifications');
        renderNotifsTable(notifs);
    } catch (err) {
        console.error(err);
        alert(err.message || 'Lỗi tải thông báo');
    }
}

// Handle send notification
notifForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('notif-title').value.trim();
    const message = document.getElementById('notif-message').value.trim();
    const link = document.getElementById('notif-link').value.trim();
    const userIdVal = document.getElementById('notif-user-id').value.trim();
    const payload = { title, message };
    if (link) payload.link_url = link;
    if (userIdVal) payload.user_id = parseInt(userIdVal);
    apiFetch('/admin/notifications', {
        method: 'POST',
        body: JSON.stringify(payload)
    }).then(res => {
        alert('Đã gửi thông báo.');
        notifForm.reset();
        loadNotifs();
    }).catch(err => {
        console.error(err);
        alert(err.message || 'Lỗi gửi thông báo');
    });
});

notifFormResetBtn.addEventListener('click', () => notifForm.reset());

// Event: handle edit/delete buttons in packages table
packagesTableBody.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-package-btn');
    const deleteBtn = e.target.closest('.delete-package-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        // fetch package details and fill form
        apiFetch(`/admin/packages/${id}`)
            .then(pkg => {
                packageIdInput.value = pkg.id;
                packageNameInput.value = pkg.name || '';
                packageAccessTypeInput.value = pkg.access_type || '';
                packagePriceInput.value = pkg.price || 0;
                packageTotalSlotsInput.value = pkg.total_slots || 0;
                packageIsActiveInput.checked = !!pkg.is_active;
                packageDescriptionInput.value = pkg.description || '';
                // Switch to packages section via sidebar navigation
                const navContainer = document.getElementById('admin-sidebar');
                if (navContainer) {
                    const link = navContainer.querySelector('.nav-link[data-section="packages-section"]');
                    if (link) link.click();
                }
            })
            .catch(err => {
                console.error(err);
                alert(err.message || 'Lỗi tải gói');
            });
    }
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        if (confirm('Bạn có chắc chắn muốn xoá gói này?')) {
            apiFetch(`/admin/packages/${id}`, { method: 'DELETE' })
                .then(() => {
                    alert('Đã xoá gói.');
                    loadPackages();
                })
                .catch(err => {
                    console.error(err);
                    alert(err.message || 'Lỗi xoá gói');
                });
        }
    }
});

// Handle package form submission
if (packageForm) {
    packageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = packageIdInput.value;
        const name = packageNameInput.value.trim();
        const access_type = packageAccessTypeInput.value.trim();
        const price = parseFloat(packagePriceInput.value || '0');
        const total_slots = parseInt(packageTotalSlotsInput.value || '0');
        const is_active = packageIsActiveInput.checked;
        const description = packageDescriptionInput.value.trim();
        const payload = {
            name,
            access_type,
            price,
            total_slots,
            is_active,
            description
        };
        if (id) {
            apiFetch(`/admin/packages/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            })
                .then(() => {
                    alert('Đã cập nhật gói.');
                    resetPackageForm();
                    loadPackages();
                })
                .catch(err => {
                    console.error(err);
                    alert(err.message || 'Lỗi cập nhật gói');
                });
        } else {
            apiFetch('/admin/packages', {
                method: 'POST',
                body: JSON.stringify(payload)
            })
                .then((res) => {
                    alert('Đã tạo gói mới với ID ' + res.package_id);
                    resetPackageForm();
                    loadPackages();
                })
                .catch(err => {
                    console.error(err);
                    alert(err.message || 'Lỗi tạo gói');
                });
        }
    });
    // helper function to reset package form
    function resetPackageForm() {
        packageForm.reset();
        packageIdInput.value = '';
        packageNameInput.value = '';
        packageAccessTypeInput.value = '';
        packagePriceInput.value = 0;
        packageTotalSlotsInput.value = 0;
        packageIsActiveInput.checked = true;
        packageDescriptionInput.value = '';
    }
    if (packageFormResetBtn) packageFormResetBtn.addEventListener('click', resetPackageForm);
}

// Attach load buttons
if (loadBooksBtn) loadBooksBtn.addEventListener('click', loadBooks);
if (loadUsersBtn) loadUsersBtn.addEventListener('click', loadUsers);
if (loadNotifsBtn) loadNotifsBtn.addEventListener('click', loadNotifs);

// Optionally auto-load lists on page load
document.addEventListener('DOMContentLoaded', () => {
    // Load books and users automatically when admin page opens
    // Đưa form về trạng thái "thêm mới" ngay từ đầu
    try { resetBookForm(); } catch(e) {}
    loadBooks();
    loadUsers();
    loadPackages();
    loadNotifs();
    // Also load available resources for user assignment
    loadAvailableResources();

    // Helper to update chapter format UI (show/hide JSON vs Markdown inputs)
    let updateChapterFormatUI = null;
    if (chapterFormatSelect) {
        updateChapterFormatUI = () => {
            const isMd = chapterFormatSelect.value === 'markdown';
            if (chapterJsonContainer) chapterJsonContainer.classList.toggle('hidden', isMd);
            if (chapterMdContainer) chapterMdContainer.classList.toggle('hidden', !isMd);
        };
        chapterFormatSelect.addEventListener('change', updateChapterFormatUI);
        // Initialize once on page load
        updateChapterFormatUI();
    }

    // Disable chapter import button on page load (only enabled when editing)
    if (importChaptersBtn) {
        importChaptersBtn.disabled = true;
    }

    // Handle cover upload when file selected
    if (coverInput) {
        coverInput.addEventListener('change', async () => {
            const file = coverInput.files && coverInput.files[0];
            if (!file) return;
            const formData = new FormData();
            formData.append('cover', file);
            try {
                const response = await fetch(`${config.URLS.API_BASE}/admin/upload-cover`, {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                const data = await response.json();
                if (!response.ok) {
                    alert(data.message || 'Lỗi tải ảnh bìa');
                    return;
                }
                // Set the URL to hidden input
                coverUrlInput.value = data.url;
                alert('Tải ảnh bìa thành công');
            } catch (err) {
                console.error(err);
                alert(err.message || 'Lỗi tải ảnh bìa');
            }
        });
    }

    // Cover remove button event
    if (coverRemoveBtn) {
        coverRemoveBtn.addEventListener('click', () => {
            if (coverUrlInput) coverUrlInput.value = '';
            if (coverPreview) {
                coverPreview.src = '';
                coverPreview.style.display = 'none';
            }
            coverRemoveBtn.style.display = 'none';
        });
    }

    // Import chapters from folder event
    if (importChaptersBtn) {
        importChaptersBtn.addEventListener('click', async () => {
            const folder = chapterImportFolderInput ? chapterImportFolderInput.value.trim() : '';
            const bookId = document.getElementById('book-id').value;
            if (!bookId) {
                alert('Bạn phải chọn hoặc đang chỉnh sửa một sách để import chương.');
                return;
            }
            if (!folder) {
                alert('Vui lòng nhập đường dẫn thư mục import.');
                return;
            }
            try {
                const res = await apiFetch(`/admin/books/${bookId}/chapters/import-folder`, {
                    method: 'POST',
                    body: JSON.stringify({ folder })
                });
                let msg = `Đã import ${res.imported} chương từ thư mục.`;
                if (res.warnings && res.warnings.length > 0) {
                    msg += '\n' + res.warnings.join('\n');
                    if (chaptersWarningDiv) {
                        chaptersWarningDiv.textContent = res.warnings.join('\n');
                        chaptersWarningDiv.classList.remove('d-none');
                    }
                }
                alert(msg);
                // Reload chapters list if we are viewing chapters for this book
                if (currentBookId && parseInt(bookId) === currentBookId) {
                    await loadChaptersForBook(currentBookId, currentBookTitle);
                }
            } catch (err) {
                console.error(err);
                alert(err.message || 'Lỗi import chương');
            }
        });
    }

    // Save chapter order event
    if (saveOrderBtn) {
        saveOrderBtn.addEventListener('click', async () => {
            // Ensure we have a book context
            if (!currentBookId) {
                alert('Vui lòng chọn một sách để sắp xếp chương.');
                return;
            }
            // Collect chapter id and assign sequential numbers based on row order
            const rows = Array.from(chaptersTableBody.querySelectorAll('tr'));
            const orderArr = rows.map((row, idx) => {
                const cid = parseInt(row.dataset.id);
                // The new chapter number is the 1-based index in the reordered list
                return { id: cid, chapter_number: idx + 1 };
            });
            try {
            const res = await apiFetch(`/admin/books/${currentBookId}/chapters/reorder`, {
                    method: 'PUT',
                    body: JSON.stringify({ items: orderArr })
                });
                alert(res.message || 'Đã lưu thứ tự chương.');
                // reload chapters after reorder
                await loadChaptersForBook(currentBookId, currentBookTitle);
            } catch (err) {
                console.error(err);
                alert(err.message || 'Lỗi lưu thứ tự chương');
            }
        });
    }

// Handle edit TOC button
if (editTocBtn) {
    editTocBtn.addEventListener('click', async () => {
        if (!currentBookId) {
            alert('Vui lòng chọn một sách để chỉnh sửa TOC.');
            return;
        }
        try {
            const res = await apiFetch(`/admin/books/${currentBookId}/toc`);
            if (res && res.toc) {
                tocJsonEditor.value = JSON.stringify(res.toc, null, 2);
            } else {
                tocJsonEditor.value = '';
            }
            // Hide other sections and show TOC editor
            chaptersSection.classList.add('hidden');
            chapterEditor.classList.add('hidden');
            tocEditorContainer.classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert(err.message || 'Lỗi tải TOC');
        }
    });
}

// Handle saving TOC changes
if (saveTocBtn) {
    saveTocBtn.addEventListener('click', async () => {
        if (!currentBookId) {
            alert('Không có sách nào được chọn.');
            return;
        }
        let tocObj;
        try {
            tocObj = JSON.parse(tocJsonEditor.value);
        } catch (e) {
            alert('Nội dung TOC không phải là JSON hợp lệ. Vui lòng kiểm tra lại.');
            return;
        }
        try {
            await apiFetch(`/admin/books/${currentBookId}/toc`, {
                method: 'PUT',
                body: JSON.stringify({ toc: tocObj })
            });
            alert('Đã lưu TOC.');
            // Hide editor and reload chapters
            tocEditorContainer.classList.add('hidden');
            await loadChaptersForBook(currentBookId, currentBookTitle);
        } catch (err) {
            console.error(err);
            alert(err.message || 'Lỗi lưu TOC');
        }
    });
}

// Cancel TOC editing
if (cancelTocBtn) {
    cancelTocBtn.addEventListener('click', () => {
        tocEditorContainer.classList.add('hidden');
        // Return to chapters list
        chaptersSection.classList.remove('hidden');
        chapterEditor.classList.add('hidden');
    });
}

    // Add chapter button event
    if (addChapterBtn) {
        addChapterBtn.addEventListener('click', () => {
            // Set blank ID to indicate create
            chapterIdInput.value = '';
            chapterTitleInput.value = '';
            // Reset both content areas
            if (chapterContentTextarea) chapterContentTextarea.value = '{}';
            if (chapterMdTextarea) chapterMdTextarea.value = '';
            // Default to JSON format when creating new chapter
            if (chapterFormatSelect) {
                chapterFormatSelect.value = 'json';
                if (typeof updateChapterFormatUI === 'function') updateChapterFormatUI();
            }
            // Reset chapter number and sort inputs
            if (chapterNumberInput) chapterNumberInput.value = '';
            if (chapterSortInput) chapterSortInput.value = '';
            // Clear warnings
            if (chaptersWarningDiv) {
                chaptersWarningDiv.classList.add('d-none');
                chaptersWarningDiv.textContent = '';
            }
            if (chapterEditorHeading) chapterEditorHeading.textContent = 'Thêm chương mới';
            if (chaptersSection) chaptersSection.classList.add('hidden');
            if (chapterEditor) chapterEditor.classList.remove('hidden');
        });
    }

    // User form submission and reset
    if (userForm) {
        const resetUserForm = () => {
            userForm.reset();
            userIdInput.value = '';
        };
        userForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const uid = userIdInput.value;
            const emailVal = userEmailInput.value.trim();
            const roleVal = userRoleSelect.value;
            const passVal = userPasswordInput.value;
            try {
                if (uid) {
                    await apiFetch(`/admin/users/${uid}`, {
                        method: 'PUT',
                        body: JSON.stringify({ email: emailVal, role: roleVal })
                    });
                    if (passVal) {
                        await apiFetch(`/admin/users/${uid}/password`, {
                            method: 'PUT',
                            body: JSON.stringify({ password: passVal })
                        });
                    }
                    alert('Đã cập nhật người dùng.');
                } else {
                    if (!passVal) {
                        alert('Cần nhập mật khẩu cho người dùng mới.');
                        return;
                    }
                    await apiFetch('/admin/users', {
                        method: 'POST',
                        body: JSON.stringify({ email: emailVal, password: passVal, role: roleVal })
                    });
                    alert('Đã tạo người dùng mới.');
                }
                resetUserForm();
                await loadUsers();
            } catch (err) {
                console.error(err);
                alert(err.message || 'Lỗi lưu người dùng');
            }
        });
        if (userFormResetBtn) {
            userFormResetBtn.addEventListener('click', () => {
                resetUserForm();
            });
        }
    }

    // Sidebar navigation: show/hide admin sections
    const sidebarNav = document.getElementById('admin-sidebar');
    if (sidebarNav) {
        sidebarNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.nav-link');
            if (!btn) return;
            // Remove active class from all nav links
            sidebarNav.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            btn.classList.add('active');
            const targetSection = btn.getAttribute('data-section');
            if (!targetSection) return;
            // Hide all admin sections
            document.querySelectorAll('.admin-section').forEach(sec => sec.classList.add('hidden'));
            // Show the target section
            const secEl = document.getElementById(targetSection);
            if (secEl) secEl.classList.remove('hidden');
            // Also hide chaptersSection and chapterEditor overlays when switching sections
            if (chaptersSection) chaptersSection.classList.add('hidden');
            if (chapterEditor) chapterEditor.classList.add('hidden');
        });
    }
});