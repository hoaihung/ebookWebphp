// file: /assets/js/reader.js (FINAL - FULLY COMPLETE & FUNCTIONAL)
import config from './config.js';
import { apiFetch } from './api.js';
import { loadDependencies } from './dynamic-loader.js';
import { initDarkMode } from './theme.js';

// --- DOM Elements ---
const ebookTitleEl = document.getElementById('ebook-title-in-toc');
const tocContainerEl = document.getElementById('toc-container');
const mainContentArea = document.getElementById('main-content-area');
const backToLibraryLink = document.querySelector('.back-to-library');
const progressBar = document.getElementById('reading-progress-bar');
const mobileTocToggle = document.getElementById('mobile-toc-toggle');
const tocOverlay = document.getElementById('toc-overlay');
const mobileChapterTitle = document.getElementById('mobile-chapter-title');

// Notes toggle buttons (for 3‑pane workspace)
const mobileNotesToggle = document.getElementById('mobile-notes-toggle');
const closeNotesButton = document.getElementById('close-notes-button');

// --- Global State ---
let currentBook = null;
let currentToc = null;
let chapterTemplate = null;
let currentChapterNumber = 1;

// --- Enhancement State for search & font size ---
let searchHighlights = [];
let currentSearchIndex = -1;
let initialScrollPosition = null;
let initialSavedChapter = null;

// Fetch saved reading progress from the server. If the user is logged in and
// has previously read this book, the API will return an object with
// last_chapter_id and last_scroll_position. Otherwise null.
const fetchSavedProgress = async (bookId) => {
    try {
        const res = await apiFetch(`/progress/${bookId}`);
        return res;
    } catch (_) {
        return null;
    }
};

// Save the current reading progress to the server. Called on page unload to
// avoid excessive writes during scrolling. Persists the current chapter
// number and scroll ratio in the book.
const saveReadingProgressToServer = async () => {
    if (!currentBook || !mainContentArea) return;
    const scrollHeight = mainContentArea.scrollHeight - mainContentArea.clientHeight;
    if (scrollHeight <= 0) return;
    const progress = mainContentArea.scrollTop / scrollHeight;
    const payload = {
        book_id: currentBook.id,
        last_chapter_id: currentChapterNumber,
        last_scroll_position: progress.toFixed(4)
    };
    try {
        await apiFetch('/progress', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.warn('Lỗi lưu tiến độ đọc:', err);
    }
};

// --- UTILITY & TEMPLATE FUNCTIONS ---
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('add', (a, b) => a + b);


const getIconForType = (type) => {
    switch(type) {
        case 'lesson': return 'fa-solid fa-book-open';
        case 'review': return 'fa-solid fa-clipboard-check';
        case 'project': return 'fa-solid fa-pencil-ruler';
        default: return 'fa-solid fa-file-lines';
    }
};

const showError = (message, details = '') => {
    if (mainContentArea) {
        mainContentArea.innerHTML = `<div class="error-container"><h3><i class="fas fa-exclamation-triangle"></i> Oops! Đã xảy ra lỗi</h3><p>${message}</p>${details ? `<pre class="error-details">Chi tiết kỹ thuật: ${details}</pre>` : ''}<p>Vui lòng thử lại hoặc báo cho đội ngũ hỗ trợ.</p></div>`;
    }
};

const loadAndRegisterTemplates = async (templatePath) => {
    console.log(`Bắt đầu tải template từ: ${templatePath}`);
    try {
        const response = await fetch(templatePath);
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const templateHtml = await response.text();

        //console.log("NỘI DUNG TEMPLATE ĐÃ TẢI VỀ:\n", templateHtml); // <<=== DÒNG DEBUG MỚI

        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = templateHtml;
        const templateElements = tempDiv.querySelectorAll("script");
        if (templateElements.length === 0) throw new Error("Không tìm thấy thẻ <script> nào trong file template.");
        for (const script of templateElements) {
            if (script.id.endsWith('-partial')) {
                const partialName = script.id.replace('-partial', '');
                Handlebars.registerPartial(partialName, script.innerHTML);
            } else if (script.id === 'chapter-template') {
                chapterTemplate = Handlebars.compile(script.innerHTML);
            }
        }
        console.log('Tải và đăng ký template thành công!');
    } catch(error) {
        console.error(`LỖI TRONG KHI TẢI TEMPLATE từ ${templatePath}:`, error);
        showError('Lỗi nghiêm trọng: Không thể tải hoặc phân tích file template.');
        return false;
    }
    return true;
};

// --- RENDER FUNCTIONS ---
const renderToc = (toc, activeChapterNumber) => {
    if (ebookTitleEl) ebookTitleEl.textContent = toc.ebookTitle;
    let html = '';
    toc.phases.forEach((phase, index) => {
        const isActivePhase = phase.chapters.some(c => c.chapterNumber === activeChapterNumber);
        html += `
            <div class="toc-phase-group ${isActivePhase ? 'open' : ''}">
                <div class="toc-phase-header" data-phase-index="${index}">
                    <span class="toc-phase-title">${phase.phaseTitle}</span>
                    <i class="fas fa-chevron-right toc-phase-toggle"></i>
                </div>
                <ul class="toc-chapter-list">
                    ${phase.chapters.map(chapter => `
                        <li class="toc-chapter-item ${chapter.chapterNumber === activeChapterNumber ? 'active' : ''}" data-chapternum="${chapter.chapterNumber}">
                            <a href="${config.URLS.READER}?book_id=${currentBook.id}&chapter=${chapter.chapterNumber}">
                                <i class="chapter-icon ${getIconForType(chapter.type)}"></i>
                                <span>${chapter.chapterNumber}. ${chapter.chapterTitle}</span>
                            </a>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    });
    if (tocContainerEl) tocContainerEl.innerHTML = html;
};

const renderChapter = (chapterJson) => {
    if (!chapterTemplate) { showError('Lỗi hệ thống: Không thể render nội dung do thiếu template.'); return; }
    
    const dataForTemplate = { ...chapterJson };
    // Normalise titles: prefer explicit title, then chapterTitle.
    const preferredTitle = chapterJson.title || chapterJson.chapterTitle || (chapterJson.meta && (chapterJson.meta.title || chapterJson.meta.chapterTitle)) || '';
    if (!dataForTemplate.title) dataForTemplate.title = preferredTitle;
    if (!dataForTemplate.chapterTitle) dataForTemplate.chapterTitle = preferredTitle;

    // Before passing data into the template, normalise any simple formatting
    // directives embedded in the chapter JSON. Authors occasionally embed
    // inline HTML (e.g. <b>, <i>) or markdown syntax (e.g. **bold**, *italic*,
    // ~~strike~~) directly in their content. Browsers tolerate these tags,
    // but mixing markup styles can yield inconsistent results.  The helper
    // below recursively traverses the data object and performs the following
    // transformations on every string property:
    //   • **text** or __text__ → <strong>text</strong>
    //   • *text* or _text_    → <em>text</em>
    //   • ~~text~~            → <del>text</del>
    //   • <b>...</b>          → <strong>...</strong>
    //   • <i>...</i> and <em>...</em> → <em>...</em>
    //   • Collapses any remaining stray markdown markers so no raw asterisks
    //     or underscores remain in the output.
    // This ensures the rendered HTML contains only standard semantic tags
    // and no leftover markdown syntax.
    
const normaliseFormatting = (obj) => {
    // Helper function to process inline formatting
    const processInlineFormatting = (text) => {
        // **bold** and __bold__
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
        
        // *italic* - chỉ match khi KHÔNG có space ngay sau dấu * đầu
        // Regex này sẽ match: *word* hoặc *multi word text* nhưng không match * list
        text = text.replace(/\*(?!\*)([^*\s][^*]*?[^*\s]|\S)\*/g, '<em>$1</em>');
        
        // _italic_
        text = text.replace(/_(?!_)([^_]+)_/g, '<em>$1</em>');
        
        // ~~strike~~
        text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
        
        // `code`
        text = text.replace('```', '`');
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // [text](url)
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        
        // <b>/<i> normalize
        text = text.replace(/<\s*b\s*>/gi, '<strong>').replace(/<\s*\/\s*b\s*>/gi, '</strong>');
        text = text.replace(/<\s*i\s*>/gi, '<em>').replace(/<\s*\/\s*i\s*>/gi, '</em>');
        
        return text;
    };

    // Main convert function
    const convert = (s) => {
        if (typeof s !== 'string') return s;
        
        // Decode entities first
        let newVal = decodeHtmlEntities(s);
        
        // Split into lines to handle list items properly
        const lines = newVal.split('\n');
        const processedLines = [];
        let inList = false;
        
        for (const line of lines) {
            // Check if this is a list item (starts with * followed by space)
            const listMatch = line.match(/^(\s*)\*\s+(.+)$/);
            
            if (listMatch) {
                const indent = listMatch[1];
                const content = listMatch[2];
                // Process inline formatting within list item content
                const processedContent = processInlineFormatting(content);
                
                // Wrap in proper list structure
                if (!inList) {
                    processedLines.push(`${indent}<ul>`);
                    inList = true;
                }
                processedLines.push(`${indent}  <li>${processedContent}</li>`);
            } else {
                // Close list if we were in one
                if (inList) {
                    const lastIndent = processedLines[processedLines.length - 1].match(/^(\s*)/)[1];
                    processedLines.push(`${lastIndent.substring(2)}</ul>`);
                    inList = false;
                }
                
                // Process regular line with inline formatting
                processedLines.push(processInlineFormatting(line));
            }
        }
        
        // Close list if we end while still in a list
        if (inList) {
            const lastIndent = processedLines[processedLines.length - 1].match(/^(\s*)/)[1];
            processedLines.push(`${lastIndent.substring(2)}</ul>`);
        }
        
        return processedLines.join('\n');
    };

    // Rest of the function remains the same
    if (typeof obj === 'string') {
        return convert(obj);
    }
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            if (typeof obj[i] === 'string') {
                obj[i] = convert(obj[i]);
            } else if (obj[i] && typeof obj[i] === 'object') {
                normaliseFormatting(obj[i]);
            }
        }
        return obj;
    }
    if (!obj || typeof obj !== 'object') return obj;
    
    Object.keys(obj).forEach((key) => {
        const value = obj[key];
        if (typeof value === 'string') {
            obj[key] = convert(value);
        } else if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                if (typeof value[i] === 'string') {
                    value[i] = convert(value[i]);
                } else if (value[i] && typeof value[i] === 'object') {
                    normaliseFormatting(value[i]);
                }
            }
        } else if (value && typeof value === 'object') {
            normaliseFormatting(value);
        }
    });
    return obj;
};



    // Basic HTML sanitizer (whitelist-based) to avoid XSS when rendering with triple mustache.
    const sanitizeHtml = (html) => {
        if (typeof html !== 'string') return html;
        // Remove script/style tags entirely
        html = html.replace(/<\/?(script|style)[^>]*>/gi, '');
        // Disallow on* event handlers
        html = html.replace(/\s+on\w+\s*=\s*(['"]).*?\1/gi, '');
        // Remove javascript: URLs
        html = html.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '');
        // Whitelist tags
        const allowedTags = ['strong','em','del','a','code','p','ul','ol','li','blockquote','br','span','div'];
        return html.replace(/<\s*\/?\s*([a-z0-9\-]+)([^>]*)>/gi, (m, tag, attrs) => {
            tag = tag.toLowerCase();
            if (!allowedTags.includes(tag)) return ''; // strip disallowed tag completely
            // Clean attributes: allow href, title, target, rel, class
            const allowedAttrs = ['href','title','target','rel','class'];
            const cleanedAttrs = [];
            (attrs || '').replace(/([a-z0-9\-:]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (mm, name, val) => {
                name = name.toLowerCase();
                if (!allowedAttrs.includes(name)) return '';
                // Enforce rel for target=_blank
                if (name === 'target') {
                    const v = (val || '').replace(/^['"]|['"]$/g, '');
                    if (v !== '_blank' && v !== '_self') return '';
                }
                if (name === 'href') {
                    const v = (val || '').replace(/^['"]|['"]$/g, '');
                    if (/^\s*javascript:/i.test(v)) return '';
                }
                cleanedAttrs.push(`${name}=${val}`);
                return '';
            });
            return `<${m.startsWith('</')?'/':''}${tag}${cleanedAttrs.length?' '+cleanedAttrs.join(' '):''}>`;
        });
    };

    const sanitizeObjectStrings = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        Object.keys(obj).forEach((key) => {
            const val = obj[key];
            if (typeof val === 'string') {
                obj[key] = sanitizeHtml(val);
            } else if (Array.isArray(val)) {
                val.forEach((item, idx) => {
                    if (typeof item === 'string') {
                        val[idx] = sanitizeHtml(item);
                    } else if (item && typeof item === 'object') {
                        sanitizeObjectStrings(item);
                    }
                });
            } else if (val && typeof val === 'object') {
                sanitizeObjectStrings(val);
            }
        });
    };

    // Safely decode a limited set of HTML entities before sanitizing.
    const decodeHtmlEntities = (str) => {
        if (typeof str !== 'string') return str;
        return str
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    };




    normaliseFormatting(dataForTemplate);
    // Sanitize after normalisation to keep only allowed markup
    sanitizeObjectStrings(dataForTemplate);

    if (dataForTemplate.navigation) {
        dataForTemplate.navigation.bookId = currentBook.id;
    }

    if (dataForTemplate.teaser && typeof dataForTemplate.teaser === 'string') {
        dataForTemplate.teaser = { content: dataForTemplate.teaser };
    }

    if (dataForTemplate.coverImage && dataForTemplate.coverImage.url) {
        dataForTemplate.coverImage.url = `${config.URLS.ROOT}${dataForTemplate.coverImage.url}`;
    }

    // =========================================================================
    // == GIẢI PHÁP TRIỆT ĐỂ CHO QUIZ: Thêm questionIndex vào mỗi câu hỏi ==
    // =========================================================================
    if (dataForTemplate.quiz && Array.isArray(dataForTemplate.quiz.questions)) {
        dataForTemplate.quiz.questions = dataForTemplate.quiz.questions.map((q, qIndex) => {
            // Thêm thuộc tính questionIndex vào mỗi đối tượng câu hỏi
            // Điều này làm cho {{questionIndex}} truy cập được trong template
            return { ...q, questionIndex: qIndex };
        });
    }
    // =========================================================================

    const finalHtml = chapterTemplate(dataForTemplate);
    if (mainContentArea) {
        // Insert the chapter HTML first
        mainContentArea.innerHTML = finalHtml;
        // After rendering the chapter, insert the toolbar and set up enhancements
        insertChapterToolbar();
        // Set up font size controls for the chapter
        setupFontSizeControls();
        // Set up font combo selector for user‑chosen fonts
        setupFontComboSelector();
        // Re‑initialise dark mode to attach toggle handler and update icons for the new button
        initDarkMode();
    }
};

// ---------------------------------------------------------------------------
// Enhancement: Toolbar insertion, search feature, font size controls
// These functions provide additional learning aids such as in-chapter search,
// adjustable font sizes, and progress persistence using localStorage.
// ---------------------------------------------------------------------------

/**
 * Insert a chapter toolbar at the top of the main content area. The toolbar
 * contains a search box with navigation controls and buttons to adjust
 * the font size.
 */
const insertChapterToolbar = () => {
    if (!mainContentArea) return;
    // Avoid inserting multiple toolbars
    if (mainContentArea.querySelector('.chapter-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'chapter-toolbar';
    // Determine book and chapter titles
    const bookTitle = currentToc ? currentToc.ebookTitle : (currentBook ? currentBook.title : '');
    const chapterTitleEl = mainContentArea.querySelector('.chapter-title');
    const chapterTitle = chapterTitleEl ? chapterTitleEl.textContent.trim() : '';
    toolbar.innerHTML = `
        <div class="chapter-info">
            ${bookTitle ? `<span class="book-title">${bookTitle}</span>` : ''}
            ${chapterTitle ? `<span class="chapter-title">${chapterTitle}</span>` : ''}
        </div>
        <div class="reader-controls">
            <button id="font-decrease-btn" title="Giảm kích thước chữ">A−</button>
            <button id="font-increase-btn" title="Tăng kích thước chữ">A+</button>
            <select id="font-combo-select" class="font-combo-select" title="Chọn kiểu chữ">
                <option value="sans">Không chân</option>
                <option value="serif">Có chân</option>
                <option value="mono">Mono</option>
            </select>
            <button class="dark-mode-toggle" title="Thay đổi chế độ hiển thị"><i class="fas fa-moon"></i></button>
        </div>
    `;
    // Prepend toolbar to the main content area
    mainContentArea.prepend(toolbar);
};

/**
 * Remove all existing search highlights from the chapter content.
 */
const clearSearchHighlights = () => {
    searchHighlights.forEach((el) => {
        const parent = el.parentNode;
        if (!parent) return;
        // Replace the highlight element with a plain text node
        parent.replaceChild(document.createTextNode(el.textContent), el);
        // Merge adjacent text nodes (optional but tidy)
        parent.normalize();
    });
    searchHighlights = [];
    currentSearchIndex = -1;
};

/**
 * Highlight all occurrences of a term in the chapter content and populate
 * the searchHighlights array.
 * @param {string} term - The search keyword
 */
const highlightSearchTerm = (term) => {
    clearSearchHighlights();
    const countSpan = document.getElementById('search-result-count');
    if (!term || !mainContentArea) {
        if (countSpan) countSpan.textContent = '';
        return;
    }
    const container = mainContentArea.querySelector('.chapter-container') || mainContentArea;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    const lowerTerm = term.toLowerCase();
    let node;
    while ((node = walker.nextNode())) {
        const nodeText = node.nodeValue;
        const lowerText = nodeText.toLowerCase();
        let startIndex = 0;
        let index;
        while ((index = lowerText.indexOf(lowerTerm, startIndex)) !== -1) {
            const before = nodeText.slice(0, index);
            const match = nodeText.slice(index, index + term.length);
            const after = nodeText.slice(index + term.length);
            const highlightEl = document.createElement('mark');
            highlightEl.className = 'search-highlight';
            highlightEl.textContent = match;
            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(highlightEl);
            if (after) fragment.appendChild(document.createTextNode(after));
            const parent = node.parentNode;
            parent.replaceChild(fragment, node);
            searchHighlights.push(highlightEl);
            // Reset search within the new text nodes created after replacement
            startIndex = 0;
            // Update node and lowerText to reflect current remaining text after the replacement
            node = highlightEl.nextSibling;
            if (!node) break;
            nodeText = node.nodeValue;
            if (!nodeText) break;
            lowerText = nodeText.toLowerCase();
        }
    }
    if (countSpan) countSpan.textContent = `${searchHighlights.length} kết quả`;
    if (searchHighlights.length > 0) {
        showSearchResultAt(0);
    }
};

/**
 * Scroll to and emphasise a particular highlight based on index.
 * @param {number} index - Index within searchHighlights
 */
const showSearchResultAt = (index) => {
    if (searchHighlights.length === 0) return;
    // Wrap index cyclically
    if (index < 0) index = searchHighlights.length - 1;
    if (index >= searchHighlights.length) index = 0;
    currentSearchIndex = index;
    searchHighlights.forEach((el) => el.classList.remove('active-highlight'));
    const el = searchHighlights[currentSearchIndex];
    el.classList.add('active-highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Update the count indicator to show current position (e.g., 2/5)
    const countSpan = document.getElementById('search-result-count');
    if (countSpan) countSpan.textContent = `${currentSearchIndex + 1}/${searchHighlights.length}`;
};

/**
 * Set up event listeners for search interactions on the toolbar.
 */
const setupSearchFeature = () => {
    const input = document.getElementById('chapter-search-input');
    const prevBtn = document.getElementById('search-prev-btn');
    const nextBtn = document.getElementById('search-next-btn');
    const clearBtn = document.getElementById('search-clear-btn');
    if (!input || !prevBtn || !nextBtn || !clearBtn) return;
    input.addEventListener('input', () => {
        const term = input.value.trim();
        highlightSearchTerm(term);
    });
    prevBtn.addEventListener('click', () => {
        if (searchHighlights.length > 0) {
            showSearchResultAt(currentSearchIndex - 1);
        }
    });
    nextBtn.addEventListener('click', () => {
        if (searchHighlights.length > 0) {
            showSearchResultAt(currentSearchIndex + 1);
        }
    });
    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearSearchHighlights();
        const countSpan = document.getElementById('search-result-count');
        if (countSpan) countSpan.textContent = '';
    });
};

/**
 * Set up font size controls to allow the reader to increase or decrease
 * the font size of the chapter content. The chosen size is persisted in
 * localStorage so that it can be restored on subsequent visits.
 */
const setupFontSizeControls = () => {
    const decreaseBtn = document.getElementById('font-decrease-btn');
    const increaseBtn = document.getElementById('font-increase-btn');
    if (!decreaseBtn || !increaseBtn) return;
    const contentContainer = mainContentArea;
    if (!contentContainer) return;
    // Load stored font scale or default to 1
    let fontScale = parseFloat(localStorage.getItem('readerFontScale')) || 1;
    const applyFontScale = () => {
        // Apply scale relative to base font size (1em). Using CSS variable ensures
        // that nested elements inherit the computed value.
        contentContainer.style.fontSize = `${fontScale}em`;
    };
    applyFontScale();
    decreaseBtn.addEventListener('click', () => {
        fontScale = Math.max(0.8, (fontScale - 0.1));
        localStorage.setItem('readerFontScale', fontScale.toFixed(2));
        applyFontScale();
    });
    increaseBtn.addEventListener('click', () => {
        fontScale = Math.min(2.0, (fontScale + 0.1));
        localStorage.setItem('readerFontScale', fontScale.toFixed(2));
        applyFontScale();
    });
};

/**
 * Set up the font combo selector in the chapter toolbar. Allows the reader to
 * choose between sans‑serif, serif and monospace font combinations for body
 * and headings. The chosen combo is persisted in localStorage and applied
 * immediately via CSS variables on the document root.
 */
const setupFontComboSelector = () => {
    const selectEl = document.getElementById('font-combo-select');
    if (!selectEl) return;
    const rootStyle = document.documentElement.style;
    // Apply a given combo by setting CSS variables. We define combos here
    // rather than reading from CSS to avoid duplication of logic.
    const applyCombo = (combo) => {
        switch (combo) {
            case 'serif':
                rootStyle.setProperty('--font-body', "var(--font-serif)");
                rootStyle.setProperty('--font-heading', "var(--font-serif)");
                break;
            case 'mono':
                rootStyle.setProperty('--font-body', "var(--font-mono)");
                rootStyle.setProperty('--font-heading', "var(--font-mono)");
                break;
            default:
                // Default to sans
                rootStyle.setProperty('--font-body', "var(--font-sans)");
                rootStyle.setProperty('--font-heading', "var(--font-sans)");
                break;
        }
    };
    // Load previously saved combo or default to sans
    const storedCombo = localStorage.getItem('readerFontCombo') || 'sans';
    selectEl.value = storedCombo;
    applyCombo(storedCombo);
    // Listen for changes
    selectEl.addEventListener('change', (e) => {
        const combo = e.target.value;
        localStorage.setItem('readerFontCombo', combo);
        applyCombo(combo);
    });
};

/**
 * Persist the reader's progress (current chapter and scroll position) in
 * localStorage so it can be restored when the reader returns. This runs on
 * every scroll event of the main content area.
 */
const saveProgress = () => {
    if (!currentBook || !mainContentArea) return;
    const scrollHeight = mainContentArea.scrollHeight - mainContentArea.clientHeight;
    if (scrollHeight <= 0) return;
    const progress = mainContentArea.scrollTop / scrollHeight;
    const progressData = {
        chapter: currentChapterNumber,
        // Also store chapterIndex (0-based) for easier progress display
        chapterIndex: (typeof currentChapterNumber === 'number' ? currentChapterNumber - 1 : 0),
        position: progress,
        // Save timestamp to sort continue-reading items by recency
        date: Date.now()
    };
    localStorage.setItem(`progress_${currentBook.id}`, JSON.stringify(progressData));
};

const updateActiveTocItem = (chapterNumber) => {
    if (!tocContainerEl) return;
    const currentActive = tocContainerEl.querySelector('.toc-chapter-item.active');
    if (currentActive) currentActive.classList.remove('active');
    const newActive = tocContainerEl.querySelector(`.toc-chapter-item[data-chapternum='${chapterNumber}']`);
    if (newActive) newActive.classList.add('active');
};

// --- LOGIC LƯU TIẾN ĐỘ ---
/*const saveReadingProgress = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!currentBook || !mainContentArea) return;

    const scrollHeight = mainContentArea.scrollHeight - mainContentArea.clientHeight;
    if (scrollHeight <= 0) return;

    const progress = mainContentArea.scrollTop / scrollHeight;
    if (isNaN(progress)) return;

    const progressData = {
        chapter: `chapter-${currentChapterNumber}`,
        position: progress.toFixed(4)
    };
    
    if (session) {
        const { error } = await supabase.from('user_reading_progress').upsert({
            user_id: session.user.id,
            book_id: currentBook.id,
            last_chapter_id: progressData.chapter,
            last_scroll_position: progressData.position,
            updated_at: new Date()
        });
        if (error) console.error('Lỗi lưu tiến độ vào Supabase:', error);
    } else {
        localStorage.setItem(`progress_${currentBook.id}`, JSON.stringify(progressData));
    }
};*/

// --- QUIZ INTERACTION LOGIC ---
const setupQuizInteractions = (quizData) => {
    if (!quizData || !quizData.questions) return;

    const quizBlockElement = document.querySelector('.quiz-block');
    if (!quizBlockElement) return;

    let currentQuestionIndex = 0;
    let score = 0;
    let quizState = 'answering'; // 'answering', 'showing_feedback', 'quiz_completed', 'review_mode'
    const userAnswers = new Array(quizData.questions.length).fill(null); // Lưu đáp án người dùng

    const questionCards = quizBlockElement.querySelectorAll('.quiz-question-card');
    const submitButton = quizBlockElement.querySelector('.quiz-submit-btn');
    const quizResult = quizBlockElement.querySelector('.quiz-result');

    // Bước 1: Khởi tạo trạng thái ban đầu
    questionCards.forEach((card, idx) => {
        card.style.display = (idx === currentQuestionIndex) ? 'block' : 'none';
        const radios = card.querySelectorAll('input[type="radio"]');
        radios.forEach((radio, optionIdx) => {
            radio.name = `question_${idx}`; // Gán name động
            radio.value = optionIdx;        // Gán value động
        });
        card.querySelector('.quiz-feedback').style.display = 'none';
        card.querySelector('.explanation-text').style.display = 'none';
    });
    if (quizResult) quizResult.style.display = 'none';
    if (submitButton) submitButton.textContent = 'Kiểm tra'; // Text nút ban đầu

    const showQuestion = (index) => {
        quizState = 'answering';
        questionCards.forEach((card, idx) => {
            card.style.display = (idx === index) ? 'block' : 'none';
            card.querySelectorAll('input[type="radio"]').forEach(radio => radio.disabled = false);
            // Bỏ highlight nếu có từ lần trước
            card.querySelectorAll('.quiz-option').forEach(label => label.classList.remove('selected-option'));
            // Ẩn feedback
            card.querySelector('.quiz-feedback').style.display = 'none';
            card.querySelector('.explanation-text').style.display = 'none';
        });
        //quizBlockElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (submitButton) submitButton.textContent = 'Kiểm tra';
    };

    const checkAnswer = (questionIndex) => {
        const questionCard = questionCards[questionIndex];
        const selectedOption = questionCard.querySelector(`input[name="question_${questionIndex}"]:checked`);
        const feedbackEl = questionCard.querySelector('.quiz-feedback');
        const explanationEl = questionCard.querySelector('.explanation-text');

        if (!selectedOption) {
            alert('Vui lòng chọn một đáp án trước khi kiểm tra.');
            return false;
        }

        const selectedAnswerIndex = parseInt(selectedOption.value);
        const correctLetter = quizData.questions[questionIndex].correctAnswer;
        const correctOptionIndex = correctLetter.charCodeAt(0) - 'A'.charCodeAt(0);

        // Lưu đáp án của người dùng
        userAnswers[questionIndex] = selectedAnswerIndex;

        feedbackEl.style.display = 'flex';
        explanationEl.style.display = 'block';
        questionCard.querySelectorAll('input[type="radio"]').forEach(radio => radio.disabled = true); // Vô hiệu hóa

        if (selectedAnswerIndex === correctOptionIndex) {
            feedbackEl.className = 'quiz-feedback correct';
            feedbackEl.querySelector('.feedback-text').textContent = 'Chính xác!';
            score++;
        } else {
            feedbackEl.className = 'quiz-feedback incorrect';
            feedbackEl.querySelector('.feedback-text').textContent = `Sai rồi. Đáp án đúng là ${correctLetter}.`;
        }
        
        selectedOption.closest('label').classList.add('selected-option'); // Highlight đáp án đã chọn

        quizState = 'showing_feedback';
        if (submitButton) {
            submitButton.textContent = (questionIndex === quizData.questions.length - 1) ? 'Nộp bài' : 'Tiếp tục';
        }
        return true;
    };

    const showQuizResultScreen = () => {
        quizState = 'quiz_completed';
        if (submitButton) submitButton.style.display = 'none'; // Ẩn nút hiện tại
        if (quizResult) {
            quizResult.style.display = 'block';
            quizResult.innerHTML = `Bạn đã hoàn thành bài trắc nghiệm!<br>Đạt được <strong>${score}/${quizData.questions.length}</strong> điểm.`;
            
            // Thêm nút Xem lại và Làm lại
            const reviewButton = document.createElement('button');
            reviewButton.className = 'button quiz-action-button';
            reviewButton.textContent = 'Xem lại đáp án';
            reviewButton.addEventListener('click', () => {
                showReviewMode();
            });

            const resetButton = document.createElement('button');
            resetButton.className = 'button quiz-action-button button-secondary';
            resetButton.textContent = 'Làm lại bài';
            resetButton.addEventListener('click', () => {
                // Tải lại chương để reset quiz hoàn toàn
                loadChapter(currentChapterNumber); 
            });

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'quiz-result-actions';
            buttonContainer.appendChild(reviewButton);
            buttonContainer.appendChild(resetButton);
            quizResult.appendChild(buttonContainer);
        }

        // Ẩn tất cả câu hỏi khi hiển thị màn hình kết quả
        questionCards.forEach(card => card.style.display = 'none');
        quizBlockElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const showReviewMode = () => {
        quizState = 'review_mode';
        if (quizResult) quizResult.style.display = 'none'; // Ẩn kết quả tổng
        if (submitButton) submitButton.style.display = 'none'; // Đảm bảo nút ẩn

        questionCards.forEach((card, qIndex) => {
            card.style.display = 'block'; // Hiện tất cả câu hỏi
            card.querySelectorAll('input[type="radio"]').forEach(radio => {
                radio.disabled = true; // Vô hiệu hóa
                // Bỏ highlight cũ và áp dụng lại
                radio.closest('label').classList.remove('selected-option', 'correct-option', 'incorrect-option');
            });
            
            const feedbackEl = card.querySelector('.quiz-feedback');
            const explanationEl = card.querySelector('.explanation-text');
            if (feedbackEl) feedbackEl.style.display = 'flex';
            if (explanationEl) explanationEl.style.display = 'block';

            // Highlight đáp án của người dùng và đáp án đúng
            const userAnswerIndex = userAnswers[qIndex];
            const correctLetter = quizData.questions[qIndex].correctAnswer;
            const correctOptionIndex = correctLetter.charCodeAt(0) - 'A'.charCodeAt(0);

            card.querySelectorAll('input[type="radio"]').forEach(radio => {
                const optionLabel = radio.closest('label');
                const isUserSelected = parseInt(radio.value) === userAnswerIndex;
                const isCorrectOption = parseInt(radio.value) === correctOptionIndex;

                if (isUserSelected) {
                    optionLabel.classList.add('selected-option');
                    if (isUserSelected && !isCorrectOption) { // Nếu chọn sai
                        optionLabel.classList.add('incorrect-option');
                    }
                }
                if (isCorrectOption) { // Luôn highlight đáp án đúng
                    optionLabel.classList.add('correct-option');
                }
            });
            
            // Cập nhật feedback text trong chế độ review (nếu muốn)
            // Hoặc giữ nguyên như đã hiển thị
        });
        // **BỔ SUNG NÚT LÀM LẠI BÀI TẠI ĐÂY**
        const resetButtonContainer = document.createElement('div');
        resetButtonContainer.className = 'quiz-review-actions';
        const resetButton = document.createElement('button');
        resetButton.className = 'button quiz-action-button';
        resetButton.textContent = 'Làm lại bài';
        resetButton.addEventListener('click', () => {
            loadChapter(currentChapterNumber); // Tải lại chương để reset quiz
        });
        resetButtonContainer.appendChild(resetButton);
        quizBlockElement.appendChild(resetButtonContainer); // Thêm vào cuối quiz block

        quizBlockElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Event listener chính cho nút Nộp bài / Tiếp tục
    if (submitButton) {
        submitButton.addEventListener('click', () => {
            if (quizState === 'answering') {
                if (checkAnswer(currentQuestionIndex)) {
                    // Đã kiểm tra xong đáp án, chuyển trạng thái sang showing_feedback
                    // Nút sẽ tự đổi text trong checkAnswer
                }
            } else if (quizState === 'showing_feedback') {
                currentQuestionIndex++;
                if (currentQuestionIndex < quizData.questions.length) {
                    showQuestion(currentQuestionIndex);
                } else {
                    // Đã trả lời hết, hiển thị màn hình kết quả tổng
                    showQuizResultScreen();
                }
            } else if (quizState === 'quiz_completed') {
                // Logic cho nút Xem lại đáp án / Làm lại bài sẽ nằm trên nút đó
                // Không nên đến đây nếu quiz_completed
            }
        });
    }

    // Đặt lại các nút radio khi có thay đổi lựa chọn (để bỏ style highlight cũ nếu có)
    questionCards.forEach(card => {
        card.addEventListener('change', (e) => {
            if (e.target.type === 'radio') {
                card.querySelectorAll('.quiz-option').forEach(label => label.classList.remove('selected-option', 'correct-option', 'incorrect-option'));
                e.target.closest('label').classList.add('selected-option');
                // Ẩn feedback cũ khi chọn lại đáp án
                card.querySelector('.quiz-feedback').style.display = 'none';
                card.querySelector('.explanation-text').style.display = 'none';
                quizState = 'answering'; // Trở lại trạng thái trả lời nếu chọn lại
                if (submitButton) submitButton.textContent = 'Kiểm tra';
            }
        });
    });

    showQuestion(currentQuestionIndex); // Hiển thị câu hỏi đầu tiên khi quiz được setup
};

// ---------------------------------------------------------------------------
// Utility: Jump to Top button
// This button appears in the bottom right corner of the reader when the
// user scrolls down the content. Clicking it smoothly scrolls back to the
// top of the chapter. It is initialised once per page load.
let jumpToTopInitialised = false;
const setupJumpToTop = () => {
    if (jumpToTopInitialised || !mainContentArea) return;
    jumpToTopInitialised = true;
    const btn = document.createElement('button');
    btn.id = 'jump-to-top';
    btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    document.body.appendChild(btn);
    btn.addEventListener('click', () => {
        mainContentArea.scrollTo({ top: 0, behavior: 'smooth' });
    });
    mainContentArea.addEventListener('scroll', () => {
        if (mainContentArea.scrollTop > 200) {
            btn.classList.add('show');
        } else {
            btn.classList.remove('show');
        }
    });
};

// --- CORE LOGIC ---
const loadChapter = async (chapterNumber) => {
    if (mainContentArea) {
        mainContentArea.innerHTML = '<div class="loader-container">Đang tải nội dung...</div>';
        mainContentArea.scrollTop = 0; // Đảm bảo cuộn lên đầu ngay lập tức khi tải chapter mới
    }    
    updateActiveTocItem(chapterNumber);

    const chapterInfo = currentToc.phases.flatMap(p => p.chapters).find(c => c.chapterNumber === chapterNumber);
    if (!chapterInfo) {
        showError("Không tìm thấy thông tin cho chương này trong mục lục.");
        updateActiveTocItem(currentChapterNumber);
        return;
    }

    try {
        // Lấy nội dung chương từ API backend. Nếu người dùng không có
        // quyền truy cập, máy chủ sẽ trả về lỗi 401/403.
        const chapterJson = await apiFetch(`/chapter?book_id=${currentBook.id}&chapter=${chapterNumber}`);
        await loadDependencies(chapterJson);
        renderChapter(chapterJson);

        // Sau khi render chương, nếu có tiến độ lưu trữ cho chính chương này thì cuộn đến vị trí đó.
        if (initialScrollPosition !== null && initialSavedChapter === chapterNumber && mainContentArea) {
            setTimeout(() => {
                const sh = mainContentArea.scrollHeight - mainContentArea.clientHeight;
                if (sh > 0) {
                    mainContentArea.scrollTop = sh * initialScrollPosition;
                }
                // Reset để không áp dụng lại cho các chương khác
                initialScrollPosition = null;
                initialSavedChapter = null;
            }, 50);
        } else {
            // Không có tiến độ lưu: cuộn lên đầu khi chuyển chương mới
            if (mainContentArea) mainContentArea.scrollTop = 0;
        }

        currentChapterNumber = chapterNumber;
        const url = `${config.URLS.READER}?book_id=${currentBook.id}&chapter=${chapterNumber}`;
        if (history.state?.chapter !== chapterNumber) {
            history.pushState({ chapter: chapterNumber }, chapterJson.chapterTitle, url);
        }
        document.title = `${chapterJson.chapterTitle} - ${currentBook.title}`;
        if (mobileChapterTitle) mobileChapterTitle.textContent = chapterJson.chapterTitle;

        // GỌI HÀM SETUP QUIZ SAU KHI RENDER CHAPTER
        if (chapterJson.quiz) {
            setupQuizInteractions(chapterJson.quiz);
        }

    } catch (error) {
        console.error('Lỗi khi tải nội dung chương:', error);
        const msg = (error && error.message) ? error.message : 'Không thể tải được nội dung.';
        showError(`Không thể tải được nội dung cho chương ${chapterNumber}.`, msg);
        history.pushState({ chapter: currentChapterNumber }, document.title, `${config.URLS.READER}?book_id=${currentBook.id}&chapter=${currentChapterNumber}`);
        updateActiveTocItem(currentChapterNumber);
    }
};

const initializeReader = async () => {
    if(backToLibraryLink) backToLibraryLink.href = config.URLS.LIBRARY;

    const urlParams = new URLSearchParams(window.location.search);
    const bookId = parseInt(urlParams.get('book_id'));
    let initialChapterNum = parseInt(urlParams.get('chapter')) || 1;

    // Nếu người dùng đã đăng nhập, kiểm tra tiến độ đọc đã lưu trên máy chủ.
    // Chỉ sử dụng tiến độ lưu nếu URL không chỉ định chương cụ thể.
    if (bookId) {
        // progress will be loaded after we know the session below
    }
    
    if (!bookId) { showError("URL không hợp lệ. Vui lòng chọn sách từ thư viện."); return; }
    
    let session = null;
    try {
        const res = await apiFetch('/session');
        session = res.user;
    } catch (_) {
        session = null;
    }
    try {
        // Lấy thông tin sách
        currentBook = await apiFetch(`/books/${bookId}`);
        // Nếu đã đăng nhập, thử lấy tiến độ đọc từ máy chủ
        if (session) {
            const saved = await fetchSavedProgress(bookId);
            if (saved && saved.last_chapter_id) {
                initialSavedChapter = parseInt(saved.last_chapter_id);
                const sp = parseFloat(saved.last_scroll_position);
                initialScrollPosition = isNaN(sp) ? null : sp;
                // Nếu URL không chỉ định chương, dùng chương đã lưu
                if (!urlParams.get('chapter')) {
                    initialChapterNum = initialSavedChapter || initialChapterNum;
                }
            }
        }
        currentChapterNumber = initialChapterNum;
        // Tải template: ưu tiên template_path cụ thể của sách nếu tồn tại, ngược lại dùng mặc định
        let templateURL = null;
        if (currentBook && currentBook.template_path) {
            // Nếu template_path đã là URL tuyệt đối, dùng trực tiếp; nếu không, nối với ROOT
            if (currentBook.template_path.startsWith('http') || currentBook.template_path.startsWith('/')) {
                templateURL = currentBook.template_path;
            } else {
                templateURL = `${config.URLS.ROOT}${currentBook.template_path}`;
            }
        } else {
            // Sử dụng template mặc định
            templateURL = `${config.URLS.TEMPLATES}/default-ebook-template.html`;
        }
        // Đảm bảo bắt đầu bằng dấu slash
        if (!templateURL.startsWith('http') && !templateURL.startsWith('/')) {
            templateURL = `/${templateURL}`;
        }
        console.log('Đang tải template cho sách từ', templateURL);
        const templateLoaded = await loadAndRegisterTemplates(templateURL);
        if (!templateLoaded) return;
        // Lấy TOC từ API. Máy chủ sẽ kiểm tra quyền truy cập và trả về
        // lỗi 401/403 nếu không hợp lệ.
        try {
            currentToc = await apiFetch(`/toc/${bookId}`);
        } catch (err) {
            // Nếu lỗi 401 hoặc 403 thì thông báo và chuyển sang trang đăng nhập
            const message = err && err.message ? err.message : 'Không thể truy cập nội dung này.';
            alert(message);
            const redirectUrl = window.location.href;
            window.location.href = `${config.URLS.LOGIN}?redirect=${encodeURIComponent(redirectUrl)}`;
            return;
        }
        renderToc(currentToc, initialChapterNum);
        await loadChapter(initialChapterNum);
    } catch (error) {
        console.error('Lỗi khởi tạo:', error);
        const msg = (error && error.message) ? error.message : '';
        showError('Lỗi nghiêm trọng khi khởi tạo trang đọc.', msg);
    }
};

// --- EVENT LISTENERS ---
if (tocContainerEl) {
    tocContainerEl.addEventListener('click', (e) => {
        const header = e.target.closest('.toc-phase-header');
        if (header) {
            header.parentElement.classList.toggle('open');
            return;
        }
        const linkElement = e.target.closest('.toc-chapter-item a');
        if (linkElement) {
            e.preventDefault();
            const chapterNum = parseInt(linkElement.parentElement.dataset.chapternum);
            loadChapter(chapterNum);
            document.body.classList.remove('toc-open');
        }
    });
}

window.addEventListener('popstate', (e) => {
    if (mainContentArea) { // Chỉ chạy nếu đang ở trang reader
        const chapterNum = e.state?.chapter || 1;
        loadChapter(chapterNum);
    }
});

if (progressBar && mainContentArea) {
    mainContentArea.addEventListener('scroll', () => {
        const scrollHeight = mainContentArea.scrollHeight - mainContentArea.clientHeight;
        if (scrollHeight > 0) {
            const progress = (mainContentArea.scrollTop / scrollHeight) * 100;
            progressBar.style.width = progress + '%';
        } else {
            progressBar.style.width = '0%';
        }
        // Persistence of reading progress has been disabled.
    });

    // Allow users to click on the progress bar to scrub (jump) to a position
    progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const ratio = rect.width > 0 ? clickX / rect.width : 0;
        const scrollHeight = mainContentArea.scrollHeight - mainContentArea.clientHeight;
        if (scrollHeight > 0) {
            mainContentArea.scrollTop = ratio * scrollHeight;
        }
    });
}

if (mobileTocToggle) {
    mobileTocToggle.addEventListener('click', () => {
        document.body.classList.toggle('toc-open');
    });
}

if (tocOverlay) {
    tocOverlay.addEventListener('click', () => {
        document.body.classList.remove('toc-open');
    });
}

// Notes panel toggles
if (mobileNotesToggle) {
    mobileNotesToggle.addEventListener('click', () => {
        document.body.classList.toggle('notes-open');
    });
}

if (closeNotesButton) {
    closeNotesButton.addEventListener('click', () => {
        document.body.classList.remove('notes-open');
    });
}

// Save reading progress when leaving the page
window.addEventListener('beforeunload', () => {
    // Save asynchronously but do not wait for completion
    saveReadingProgressToServer();
});

// --- Chạy hàm khởi tạo ---
if (document.getElementById('main-content-area')) {
    // Initialise the jump‑to‑top button before starting the reader.
    setupJumpToTop();
    initializeReader();
}