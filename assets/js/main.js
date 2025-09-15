// file: /assets/js/main.js (FINAL & COMPLETE - FULL CODE & FIXED)
import config from './config.js';
import { apiFetch } from './api.js';
import { Notice } from './notify.js';

// --- DOM Elements ---
const dom = {
    userInfoContainer: document.getElementById('user-info-container'),
    bookGridContainer: document.getElementById('book-grid-container'),
    paginationContainer: document.getElementById('pagination-container'),
    searchInput: document.getElementById('search-input'),
    founderPackBanner: document.getElementById('founder-pack-banner'),
    authModal: document.getElementById('auth-modal'),
    mainNavContainer: document.getElementById('main-nav-container'),
    librarySectionTitle: document.getElementById('library-section-title'),
    siteLogo: document.getElementById('site-logo'),
    heroTitle: document.getElementById('hero-title'),
    heroSubtitle: document.getElementById('hero-subtitle'),
    heroCta: document.getElementById('hero-cta'),
    footerContent: document.getElementById('footer-content'),
    authModalContent: document.getElementById('auth-modal-content'),
    aboutModalContent: document.getElementById('about-modal-content'),
    pricingModalContent: document.getElementById('pricing-modal-content'),
    categoryFilterContainer: document.getElementById('category-filter-container'),
    purchaseModal: document.getElementById('purchase-modal'),
    purchaseModalContent: document.getElementById('purchase-modal-content'),
    mobileMenuToggle: document.getElementById('mobile-menu-toggle'), // DOM cho mobile menu
    mobileNavMenu: document.getElementById('mobile-nav-menu'), // DOM cho mobile menu
    mobileNavOverlay: document.getElementById('mobile-nav-overlay'), // DOM cho mobile menu overlay
    mobileMainNav: document.querySelector('.mobile-main-nav'), // DOM cho mobile menu nav links
    mobileAuthActions: document.querySelector('.mobile-auth-actions'), // DOM cho mobile menu auth buttons
    closeMobileNav: document.getElementById('close-mobile-nav') // DOM cho nút đóng mobile nav
    ,quickFilterContainer: document.getElementById('quick-filter-container')
    ,continueReadingContainer: document.getElementById('continue-reading-container')
};

// Element for continue reading section visibility
const continueReadingSection = document.getElementById('continue-reading-section');

// --- State ---
const state = {
    allBooks: [], // Chứa tất cả sách đã tải
    booksPerPage: 12, // Số sách mỗi trang
    userOwnedBookIds: new Set(), // Sách user sở hữu
    userPackages: [], // Gói user sở hữu
    currentUserSession: null, // Session hiện tại
    siteContent: null,
    currentFilter: 'all' // Lọc sách hiện tại: all, free, owned, paid
};

// --- Render Functions ---

// Hàm render modal mua sách
const renderPurchaseModal = (book) => {
    if (!dom.purchaseModalContent) return;

    const priceFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(book.price);
    const instructions = state.siteContent.purchase_instructions;
    
    let ctaButtons = '';
    if (!state.currentUserSession) {
        ctaButtons = `
            <div class="modal-actions">
                <a href="login.html" class="button">${state.siteContent.auth.loginButton}</a>
                <a href="register.html" class="button button-secondary">${state.siteContent.auth.registerButton}</a>
            </div>
        `;
    }

    dom.purchaseModalContent.innerHTML = `
        <button class="modal-close" data-modal-close>×</button>
        <div class="purchase-modal-header">
            <img src="${config.URLS.ROOT}${book.cover_image_url}" alt="Bìa sách ${book.title}" class="purchase-modal-cover">
            <div>
                <h3>${book.title}</h3>
                <p class="purchase-modal-price">${priceFormatted}</p>
            </div>
        </div>
        <div class="purchase-instructions">
            <h4>${instructions.title}</h4>
            <p>${instructions.content}</p>
            <div class="bank-info">
                ${instructions.bank_info}<br>
                ${instructions.transfer_note}
            </div>
            <p class="confirmation-note">${instructions.confirmation_note}</p>
        </div>
        ${ctaButtons}
    `;
};

// Render modal hiển thị chi tiết sách
const renderBookDetailsModal = (book) => {
    const detailsModalContent = document.getElementById('details-modal-content');
    if (!detailsModalContent) return;
    // Determine ownership and access
    const isLifetime = state.userPackages.some(p => p && p.access_type === 'lifetime_all_access');
    const isOwned = state.currentUserSession && state.userOwnedBookIds.has(book.id);
    const canRead = book.access_level === 'free' || isLifetime || isOwned;
    const priceFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(book.price);
    // Buttons depending on access
    let actionButtons = '';
    if (canRead) {
        actionButtons = `<a href="reader.html?book_id=${book.id}" class="button">Đọc ngay</a>`;
    } else if (!state.currentUserSession) {
        actionButtons = `<a href="login.html" class="button">Đăng nhập</a> <a href="register.html" class="button button-secondary">Đăng ký</a>`;
    } else {
        actionButtons = `<button class="button" data-action-required="login">Mua sách</button>`;
    }
    detailsModalContent.innerHTML = `
        <button class="modal-close" data-modal-close>×</button>
        <div class="book-details-header">
            <img src="${config.URLS.ROOT}${book.cover_image_url}" alt="Bìa sách ${book.title}" class="details-cover">
            <div>
                <h3>${book.title}</h3>
                <p class="details-author">${book.author || ''}</p>
                <p class="details-price">${priceFormatted}</p>
            </div>
        </div>
        <div class="book-details-body">
            <p>${book.description || 'Không có mô tả.'}</p>
            <p><strong>Hình thức:</strong> ${book.access_level === 'free' ? 'Miễn phí' : 'Trả phí'}</p>
        </div>
        <div class="modal-actions">${actionButtons}</div>
    `;
};


const populateStaticContent = (content) => { // content được truyền từ initializePage
    state.siteContent = content; // Gán content vào state toàn cục
    
    document.title = content.site.title;
    const metaDescription = document.querySelector('meta[name="description"]');
    if(metaDescription) metaDescription.setAttribute('content', content.site.description);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if(ogTitle) ogTitle.setAttribute('content', content.site.title);
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if(ogDescription) ogDescription.setAttribute('content', content.site.description);

    if (dom.siteLogo) dom.siteLogo.textContent = content.site.logoText;
    if (dom.heroTitle) dom.heroTitle.textContent = content.hero.title;
    if (dom.heroSubtitle) dom.heroSubtitle.textContent = content.hero.subtitle;
    if (dom.heroCta) dom.heroCta.textContent = content.hero.ctaButton;
    if (dom.footerContent) dom.footerContent.innerHTML = content.site.footerText;
    if (dom.librarySectionTitle) dom.librarySectionTitle.textContent = content.librarySection.title;
    if (dom.searchInput) dom.searchInput.placeholder = content.librarySection.searchPlaceholder;
    //if (dom.categoryFilterContainer) dom.categoryFilterContainer.innerHTML = `<button class="filter-btn active" data-category="all">${content.librarySection.filterAll}</button>`;
    
    if (dom.mainNavContainer) {
        // Build navigation links. Include a link to the personal list (mylist.html) if available.
        const myListLabel = (content.navigation && content.navigation.myList) || 'Danh sách';
        dom.mainNavContainer.innerHTML = `<a href="mylist.html">${myListLabel}</a>` +
            `<a href="#book-grid-section">${content.navigation.library}</a>` +
            `<a href="#" data-modal-target="pricing-modal">${content.navigation.pricing}</a>` +
            `<a href="#" data-modal-target="about-modal">${content.navigation.about}</a>`;
    }

    // Populate mobile navigation
    if (dom.mobileMainNav) {
        const myListLabel = (content.navigation && content.navigation.myList) || 'Danh sách';
        dom.mobileMainNav.innerHTML = `<a href="mylist.html">${myListLabel}</a>` +
            `<a href="#book-grid-section">${content.navigation.library}</a>` +
            `<a href="#" data-modal-target="pricing-modal">${content.navigation.pricing}</a>` +
            `<a href="#" data-modal-target="about-modal">${content.navigation.about}</a>`;
    }
    // Mobile Auth Actions handled in renderHeader directly
    
    if (dom.authModalContent) {
        dom.authModalContent.innerHTML = `<button class="modal-close" data-modal-close>×</button><h3>${content.auth.modalTitle}</h3><p>${content.auth.modalText}</p><div class="modal-actions"><a href="login.html" class="button">${content.auth.loginButton}</a><a href="register.html" class="button button-secondary">${content.auth.registerButton}</a></div>`;
    }
    if (dom.aboutModalContent) {
        dom.aboutModalContent.innerHTML = `<button class="modal-close" data-modal-close>×</button><h3>${content.modals.about.title}</h3>${content.modals.about.content}`;
    }
    if (dom.pricingModalContent) {
        const pricing = content.modals.pricing;
        let pricingHtml = `<button class="modal-close" data-modal-close>×</button><h3>${pricing.title}</h3><div class="pricing-grid">`;
        pricing.packages.forEach(pkg => {
            pricingHtml += `<div class="pricing-card ${pkg.isFeatured ? 'featured' : ''}"><h4>${pkg.name}</h4><p class="price">${pkg.price}</p><p>${pkg.description}</p><ul>${pkg.features.map(f => `<li>${f}</li>`).join('')}</ul><a href="${pkg.ctaButton.link}" class="button" data-link-type="${pkg.ctaButton.link.startsWith('#') ? 'anchor' : 'page'}">${pkg.ctaButton.text}</a></div>`;
        });
        pricingHtml += `</div>`;
        dom.pricingModalContent.innerHTML = pricingHtml;
    }
};

const renderHeader = (session) => {
    state.currentUserSession = session;
    // Render desktop header
    if (dom.userInfoContainer) {
    if (session) {
        // Build email + logout button
        dom.userInfoContainer.innerHTML = `<span class="user-email">${session.email}</span><button id="logout-button-desktop" class="button button-secondary">${state.siteContent?.auth?.logoutButton || 'Đăng xuất'}</button>`;
        // Always show the notification bell icon when user is logged in
        (async () => {
            try {
                const notifs = await apiFetch('/notifications');
                let unread = 0;
                if (Array.isArray(notifs)) {
                    notifs.forEach(n => {
                        if (!n.is_read) unread++;
                    });
                }
                const bell = document.createElement('span');
                bell.className = 'notification-bell';
                bell.title = unread > 0 ? `Bạn có ${unread} thông báo chưa đọc` : 'Thông báo';
                // Use Font Awesome bell icon
                bell.innerHTML = `<i class="fa-solid fa-bell"></i>`;
                if (unread > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'notif-badge';
                    badge.textContent = unread;
                    bell.appendChild(badge);
                }
                // Insert bell at the beginning of user info container
                bell.style.cursor = 'pointer';
                bell.addEventListener('click', () => {
                    window.location.href = 'notifications.html';
                });
                dom.userInfoContainer.prepend(bell);
            } catch (err) {
                console.warn('Không thể tải thông báo:', err);
            }
        })();
        document.getElementById('logout-button-desktop').addEventListener('click', async () => {
            try {
                await apiFetch('/logout', { method: 'POST' });
            } catch (err) {
                console.warn('Logout error', err);
            }
            window.location.reload();
        });
    } else {
        dom.userInfoContainer.innerHTML = `<a href="login.html" class="button">${state.siteContent?.auth?.loginButton || 'Đăng nhập'}</a>`;
    }
    }

    // Render mobile auth actions (email/logout or login/register) in mobile menu
    if (dom.mobileAuthActions) { // dom.mobileAuthActions là div chứa các nút
        if (session) {
            dom.mobileAuthActions.innerHTML = `<div class="mobile-user-info"><span class="user-email">${session.email}</span></div><button id="mobile-logout-button" class="button">${state.siteContent.auth.logoutButton}</button>`;
            document.getElementById('mobile-logout-button').addEventListener('click', async () => {
                try {
                    await apiFetch('/logout', { method: 'POST' });
                } catch (err) {
                    console.warn('Logout error', err);
                }
                window.location.reload();
            });
        } else {
            dom.mobileAuthActions.innerHTML = `<a href="login.html" class="button">${state.siteContent.auth.loginButton}</a><a href="register.html" class="button button-secondary">${state.siteContent.auth.registerButton}</a>`;
        }
    }

    // If user is admin, append an Admin link to the main navigation and mobile navigation
    if (session && session.role === 'admin') {
        if (dom.mainNavContainer && !dom.mainNavContainer.querySelector('.admin-link')) {
            const adminLink = document.createElement('a');
            adminLink.href = config.URLS.ADMIN;
            adminLink.textContent = 'Quản trị';
            adminLink.classList.add('admin-link');
            dom.mainNavContainer.appendChild(adminLink);
        }
        if (dom.mobileMainNav && !dom.mobileMainNav.querySelector('.admin-link')) {
            const adminLinkMobile = document.createElement('a');
            adminLinkMobile.href = config.URLS.ADMIN;
            adminLinkMobile.textContent = 'Quản trị';
            adminLinkMobile.classList.add('admin-link');
            dom.mobileMainNav.appendChild(adminLinkMobile);
        }
    }
};

const renderBooks = (booksToRender) => {
    if (!dom.bookGridContainer) return;
    if (booksToRender.length === 0) {
        dom.bookGridContainer.innerHTML = '<p class="loader-text">Không tìm thấy cuốn sách nào.</p>';
        return;
    }
    const isLifetimeMember = state.userPackages.some(p => p && p.access_type === 'lifetime_all_access');
    dom.bookGridContainer.innerHTML = booksToRender.map(book => {
        let statusHTML, canRead = false, actionRequired = 'none';
        if (book.access_level === 'free' || isLifetimeMember) {
            statusHTML = `<div class="book-card__status book-card__status--free">Miễn phí</div>`;
            if (isLifetimeMember) statusHTML = `<div class="book-card__status book-card__status--owned">Đã sở hữu</div>`;
            canRead = true;
        } else if (state.currentUserSession && state.userOwnedBookIds.has(book.id)) {
            statusHTML = `<div class="book-card__status book-card__status--owned">Đã sở hữu</div>`;
            canRead = true;
        } else {
            statusHTML = `<div class="book-card__status book-card__status--paid">Trả phí</div>`;
            actionRequired = 'login';
        }
        // Build the full cover image URL. If the book has no cover_image_url
        // specified, fall back to a placeholder image to avoid requests to
        // `/null` which can cause 500 errors on some servers.
        let coverImageUrl;
        if (book.cover_image_url) {
            coverImageUrl = `${config.URLS.ROOT}${book.cover_image_url}`;
        } else {
            coverImageUrl = 'assets/images/book-placeholder.png';
        }
        // Determine reading progress from localStorage
        let progressHTML = '';
        try {
            const progressDataStr = localStorage.getItem(`progress_${book.id}`);
            if (progressDataStr) {
                const progressData = JSON.parse(progressDataStr);
                if (progressData && typeof progressData.chapterIndex !== 'undefined') {
                    const chapterIndex = parseInt(progressData.chapterIndex);
                    // Approximate ratio assuming 20 chapters if unknown
                    const ratio = Math.min(1, (chapterIndex + 1) / 20);
                    progressHTML = `<div class="book-card__progress"><div class="progress-bar" style="width:${(ratio * 100).toFixed(0)}%"></div><span>Chương ${chapterIndex + 1}</span></div>`;
                }
            }
        } catch (e) {
            // ignore
        }
        // Build quick actions inline (below the title). These buttons will be visible
        // at all times rather than overlaying the cover. They use the same
        // action-btn class for consistency with existing event handlers.
        // Determine if this book is in the user's personal list. Use getMyList() directly
        // rather than relying on stale state so that the icons reflect the current list.
        let isFavorite = false;
        try {
            const myList = getMyList();
            isFavorite = Array.isArray(myList) && myList.includes(book.id);
        } catch (_) {
            isFavorite = false;
        }
        const favIconClass = isFavorite ? 'fas' : 'far';
        const actionsInlineHTML = `
            <div class="book-card__actions-inline">
                <button class="action-btn action-read" data-action="read" title="Đọc ngay"><i class="fas fa-book-open"></i> Đọc</button>
                <button class="action-btn action-details" data-action="details" title="Chi tiết"><i class="fas fa-info-circle"></i> Chi tiết</button>
                <button class="action-btn action-favorite" data-action="favorite" title="Thêm vào danh sách"><i class="${favIconClass} fa-bookmark"></i> Yêu thích</button>
                <button class="action-btn action-share" data-action="share" title="Chia sẻ"><i class="fas fa-share-alt"></i> Chia sẻ</button>
            </div>`;
        return `<div class="book-card" data-book-id="${book.id}" data-can-read="${canRead}" data-action-required="${actionRequired}">
            <div class="book-card__cover"><img src="${coverImageUrl}" alt="Bìa sách ${book.title}"></div>
            <div class="book-card__info">
                <h3 class="book-card__title">${book.title}</h3>
                <p class="book-card__author">${book.author}</p>
                ${actionsInlineHTML}
                ${progressHTML}
            </div>
            ${statusHTML}
        </div>`;
    }).join('');
};

const renderPagination = (totalBooks, currentPage) => {
    if (!dom.paginationContainer) return;
    const pageCount = Math.ceil(totalBooks / state.booksPerPage);
    if (pageCount <= 1) { dom.paginationContainer.innerHTML = ''; return; }
    let html = '';
    for (let i = 1; i <= pageCount; i++) {
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    dom.paginationContainer.innerHTML = html;
};

// Render quick filter chips based on current filter state
const renderQuickFilters = () => {
    if (!dom.quickFilterContainer) return;
    const filters = [
        { key: 'all', label: 'Tất cả' },
        { key: 'free', label: 'Miễn phí' },
        { key: 'owned', label: 'Đã sở hữu' },
        { key: 'paid', label: 'Trả phí' }
    ];
    dom.quickFilterContainer.innerHTML = filters.map(f => `<button class="filter-chip ${state.currentFilter === f.key ? 'active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('');
};

// Render continue reading section from localStorage progress values
const renderContinueReading = () => {
    if (!dom.continueReadingContainer || !continueReadingSection) return;
    const keys = Object.keys(localStorage).filter(k => k.startsWith('progress_'));
    const items = [];
    keys.forEach(key => {
        const bookIdStr = key.replace('progress_', '');
        const bookId = parseInt(bookIdStr);
        if (!bookId) return;
        const progressStr = localStorage.getItem(key);
        try {
            const progressData = JSON.parse(progressStr);
            const book = state.allBooks.find(b => b.id === bookId);
            if (book && progressData && typeof progressData.chapterIndex !== 'undefined') {
                items.push({ book, progress: progressData });
            }
        } catch (e) {
            // ignore invalid JSON
        }
    });
    // Sort items by newest progress (assuming progressData.date exists)
    items.sort((a, b) => {
        const da = a.progress.date || 0;
        const db = b.progress.date || 0;
        return db - da;
    });
    // Limit to 6 items
    const displayItems = items.slice(0, 6);
    if (displayItems.length === 0) {
        continueReadingSection.style.display = 'none';
        return;
    }
    continueReadingSection.style.display = 'block';
    dom.continueReadingContainer.innerHTML = displayItems.map(item => {
        const b = item.book;
        const p = item.progress;
        const chapterIdx = parseInt(p.chapterIndex);
        const coverUrl = `${config.URLS.ROOT}${b.cover_image_url}`;
        return `<a class="continue-card" href="reader.html?book_id=${b.id}"><div class="continue-card__cover"><img src="${coverUrl}" alt="Bìa sách ${b.title}"></div><div class="continue-card__info"><h4>${b.title}</h4><p>Chương ${chapterIdx + 1}</p></div></a>`;
    }).join('');
};

// =========================================================================
// == LIST & SHARE UTILITIES                                                ==
// These helper functions support the "Thêm vào danh sách" quick action and
// sharing links. The list is stored in localStorage per user (or guest) and
// persists across sessions. Copying to clipboard uses the modern
// Clipboard API with a fallback to execCommand when necessary.
// =========================================================================

// Determine storage key for the current user's personal list. Guests share
// a single key so their list is independent of logged‑in users. If session
// information is missing, 'guest' is used as the suffix.
function getListKey() {
    const uid = state.currentUserSession && state.currentUserSession.id ? state.currentUserSession.id : 'guest';
    return `mylist_${uid}`;
}

// Load the saved list of book IDs from localStorage. Returns an array.
function getMyList() {
    try {
        const raw = localStorage.getItem(getListKey());
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

// Save the list of book IDs back to localStorage. Accepts an array.
function setMyList(list) {
    localStorage.setItem(getListKey(), JSON.stringify(list));
}

// Toggle a book's presence in the user's personal list. If the user is not
// authenticated, they are redirected to the login page with a redirect back
// to the current page. After toggling, a simple alert indicates success.
function toggleAddToList(bookId) {
    // Require login: if no current session, redirect to login with redirect param
    if (!state.currentUserSession) {
        // If the user is not logged in, redirect to the login page with a redirect
        // back to the current page. A notice informs the user what is required.
        const currentPath = window.location.pathname;
        const redirect = encodeURIComponent(currentPath);
        Notice.show('info', 'Vui lòng đăng nhập để sử dụng chức năng này');
        window.location.href = `${config.URLS.LOGIN}?redirect=${redirect}`;
        return;
    }
    const list = getMyList();
    const idx = list.indexOf(bookId);
    let added;
    if (idx >= 0) {
        list.splice(idx, 1);
        added = false;
    } else {
        list.push(bookId);
        added = true;
    }
    setMyList(list);
    // Display a toast using Notice instead of a blocking alert. The type
    // differentiates between adding and removing so that the colour of the
    // notification is appropriate.
    if (added) {
        Notice.show('success', 'Đã thêm vào danh sách');
    } else {
        Notice.show('info', 'Đã xóa khỏi danh sách');
    }
    // Update the favourite icon state for this book card and any duplicates.
    // Find all favourite buttons associated with this book and toggle the bookmark icon class.
    const cards = document.querySelectorAll(`.book-card[data-book-id="${bookId}"] .action-favorite i`);
    cards.forEach(icon => {
        if (added) {
            icon.classList.remove('far');
            icon.classList.add('fas');
        } else {
            icon.classList.remove('fas');
            icon.classList.add('far');
        }
    });
}

// Copy a string to the clipboard. Uses navigator.clipboard when available
// and falls back to a hidden textarea and document.execCommand('copy'). A
// promise is returned so callers can await completion and handle success.
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            // Notify success via toast instead of alert.
            Notice.show('success', 'Đã sao chép liên kết');
            return true;
        }
    } catch (_) {
        // continue to fallback
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let successful = false;
    try {
        successful = document.execCommand('copy');
    } catch (_) {
        successful = false;
    }
    document.body.removeChild(textarea);
    if (successful) {
        Notice.show('success', 'Đã sao chép liên kết');
    } else {
        Notice.show('error', 'Không thể sao chép liên kết');
    }
    return successful;
}

const renderFounderPackBanner = async () => {
    if (!dom.founderPackBanner) return;
    try {
        const pack = await apiFetch('/packages/1');
        if (pack && pack.is_active && pack.claimed_slots < pack.total_slots) {
            const remaining = pack.total_slots - pack.claimed_slots;
            dom.founderPackBanner.innerHTML = `<p>Ưu đãi đặc biệt! Chỉ còn <strong>${remaining}</strong> suất Gói Sáng lập truy cập trọn đời.</p>`;
            dom.founderPackBanner.style.display = 'block';
        }
    } catch (error) {
        console.error('Lỗi tải banner Gói Sáng lập:', error);
    }
};

const displayBooks = (page = 1) => {
    // Always operate on an array. If state.allBooks is not an array (e.g. undefined or an object
    // returned by the API), convert it into an array or default to an empty list. This guards
    // against the TypeError: state.allBooks.filter is not a function.
    const booksArray = Array.isArray(state.allBooks) ? state.allBooks
        : (state.allBooks && Array.isArray(state.allBooks.books) ? state.allBooks.books : []);
    const searchTerm = dom.searchInput ? dom.searchInput.value.toLowerCase().trim() : '';
    let filteredBooks = booksArray.filter(book => {
        const title = book.title || '';
        const author = book.author || '';
        const matchSearch = searchTerm === '' || title.toLowerCase().includes(searchTerm) || author.toLowerCase().includes(searchTerm);
        let matchFilter = true;
        if (state.currentFilter === 'free') {
            matchFilter = book.access_level === 'free';
        } else if (state.currentFilter === 'owned') {
            matchFilter = state.currentUserSession && (state.userOwnedBookIds.has(book.id) || state.userPackages.some(p => p && p.access_type === 'lifetime_all_access'));
        } else if (state.currentFilter === 'paid') {
            const owned = state.userOwnedBookIds.has(book.id) || state.userPackages.some(p => p && p.access_type === 'lifetime_all_access');
            matchFilter = book.access_level !== 'free' && !owned;
        } // else 'all'
        return matchSearch && matchFilter;
    });
    const start = (page - 1) * state.booksPerPage;
    const end = start + state.booksPerPage;
    const paginatedBooks = filteredBooks.slice(start, end);
    renderBooks(paginatedBooks);
    renderPagination(filteredBooks.length, page);
};

const setupEventListeners = () => {
    if (dom.bookGridContainer) {
        dom.bookGridContainer.addEventListener('click', async (e) => {
            const actionBtn = e.target.closest('.action-btn');
            const card = e.target.closest('.book-card');
            if (!card) return;
            const bookId = parseInt(card.dataset.bookId);
            const book = state.allBooks.find(b => b.id === bookId);
            const canRead = card.dataset.canRead === 'true' || card.dataset.canRead === '1';
            const requiresLogin = card.dataset.actionRequired === 'login';
            // If clicking on an action button
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                switch (action) {
                    case 'read': {
                        // Navigate to the reader if user has access; otherwise show purchase/login.
                        if (canRead) {
                            window.location.href = `reader.html?book_id=${bookId}`;
                        } else if (requiresLogin) {
                            if (book) {
                                renderPurchaseModal(book, state.currentUserSession);
                                if (dom.purchaseModal) dom.purchaseModal.style.display = 'flex';
                            } else if (dom.authModal) {
                                dom.authModal.style.display = 'flex';
                            }
                        } else {
                            // fallback: show auth modal
                            if (dom.authModal) dom.authModal.style.display = 'flex';
                        }
                        break;
                    }
                    case 'details': {
                        if (book) {
                            renderBookDetailsModal(book);
                            const detailsModal = document.getElementById('details-modal');
                            if (detailsModal) detailsModal.style.display = 'flex';
                        }
                        break;
                    }
                    case 'favorite': {
                        // Add or remove from personal list. If not logged in, redirect to login.
                        toggleAddToList(bookId);
                        break;
                    }
                    case 'share': {
                        const url = `${window.location.origin}${config.URLS.READER}?book_id=${bookId}`;
                        copyToClipboard(url);
                        break;
                    }
                    default: {
                        break;
                    }
                }
                return;
            }
            // If clicking on card itself (outside quick actions)
            if (canRead) {
                window.location.href = `reader.html?book_id=${bookId}`;
            } else {
                if (requiresLogin) {
                    if (book) {
                        renderPurchaseModal(book, state.currentUserSession);
                        if (dom.purchaseModal) dom.purchaseModal.style.display = 'flex';
                    } else if (dom.authModal) {
                        dom.authModal.style.display = 'flex';
                    }
                }
            }
        });
    }
    if (dom.paginationContainer) {
        dom.paginationContainer.addEventListener('click', (e) => {
            if (e.target.matches('.pagination-btn')) {
                const page = parseInt(e.target.dataset.page);
                displayBooks(page);
            }
        });
    }
    if (dom.searchInput) {
        let searchTimeout;
        dom.searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                displayBooks(1);
            }, 300);
        });
    }

    // Quick filter events
    if (dom.quickFilterContainer) {
        dom.quickFilterContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-chip');
            if (!btn) return;
            const key = btn.dataset.filter;
            if (!key) return;
            state.currentFilter = key;
            renderQuickFilters();
            displayBooks(1);
        });
    }
    if (dom.mobileMenuToggle) {
        dom.mobileMenuToggle.addEventListener('click', () => {
            document.body.classList.add('mobile-nav-open');
        });
    }
    if (dom.closeMobileNav) {
        dom.closeMobileNav.addEventListener('click', () => {
            document.body.classList.remove('mobile-nav-open');
        });
    }
    if (dom.mobileNavOverlay) {
        dom.mobileNavOverlay.addEventListener('click', () => {
            document.body.classList.remove('mobile-nav-open');
        });
    }

    document.addEventListener('click', e => {
        const target = e.target;
        if (target.matches('[data-modal-target]')) {
            e.preventDefault();
            const modal = document.getElementById(target.dataset.modalTarget); // SỬA LỖI CHÍNH TẢ Ở ĐÂY
            if (modal) modal.style.display = 'flex';
        }
        if (target.matches('.modal-overlay, [data-modal-close]')) {
            target.closest('.modal-overlay').style.display = 'none';
        }
    });
};

const initializePage = async () => {
    let siteContent;
    try {
        const response = await fetch('data/site-content.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}, message: ${response.statusText}`);
        siteContent = await response.json();
    } catch (error) {
        console.error("LỖI KHÔNG THỂ PHỤC HỒI: Không thể tải file site-content.json.", error);
        document.body.innerHTML = `<div style="text-align: center; padding: 50px; font-family: sans-serif;"><h1>Oops! Đã xảy ra lỗi cấu hình.</h1><p>Không thể tải dữ liệu cần thiết để hiển thị trang. Vui lòng kiểm tra lại đường dẫn và nội dung của file <strong>/data/site-content.json</strong>.</p></div>`;
        return;
    }

    state.siteContent = siteContent; // Gán siteContent vào state toàn cục
    populateStaticContent(state.siteContent); // Truyền từ state

    try {
        // Lấy session hiện tại, nếu có
        let session = null;
        try {
            const res = await apiFetch('/session');
            session = res.user;
        } catch (_) {
            session = null;
        }
        renderHeader(session);

        // Lấy danh sách sách đã publish
        let fetchedBooks = await apiFetch('/books');
        // Ensure the result is an array. If the API returned an object
        // containing a `books` property (e.g. {books: [...]}), use that.
        // Otherwise default to an empty array to avoid runtime errors.
        if (Array.isArray(fetchedBooks)) {
            state.allBooks = fetchedBooks;
        } else if (fetchedBooks && Array.isArray(fetchedBooks.books)) {
            state.allBooks = fetchedBooks.books;
        } else {
            // Unexpected response shape; log for debugging and set empty list
            console.warn('Unexpected /books response, expected array but got:', fetchedBooks);
            state.allBooks = [];
        }

        if (session) {
            try {
                const { bookIds, hasLifetime } = await apiFetch('/user/books');
                state.userOwnedBookIds = new Set(bookIds);
                // Fetch user packages to populate state.userPackages
                const userPacks = await apiFetch('/user/packages');
                // Keep only packages objects (similar structure to previous code)
                state.userPackages = Array.isArray(userPacks) ? userPacks : [];
            } catch (err) {
                console.error('Lỗi khi tải dữ liệu người dùng:', err);
            }
        }
        displayBooks(1);
        renderQuickFilters();
        renderContinueReading();
        await renderFounderPackBanner();
        setupEventListeners();
    } catch (error) {
        console.error('Lỗi khi tải dữ liệu từ máy chủ:', error);
        if (dom.bookGridContainer) dom.bookGridContainer.innerHTML = '<p class="error-message">Không thể tải thư viện sách.</p>';
    }
};

initializePage();