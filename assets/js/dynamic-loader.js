const loadedScripts = new Set();

const loadScript = (url) => {
    if (loadedScripts.has(url)) {
        return Promise.resolve(); // Đã tải rồi, không cần tải lại
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
            loadedScripts.add(url);
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

export const loadDependencies = async (chapterJson) => {
    if (!chapterJson.mainContent || !Array.isArray(chapterJson.mainContent.blocks)) {
        return; // Không có block nội dung, không cần tải gì cả
    }
    const promises = [];
    const hasCode = chapterJson.mainContent.blocks.some(b => b.type === 'codeBlock');
    const hasFormula = chapterJson.mainContent.blocks.some(b => b.type === 'formula');

    if (hasCode) {
        // Tải cả CSS và JS cho highlight.js
        // (Giả sử bạn đã bỏ link CSS ra khỏi HTML)
        promises.push(loadScript('//cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js'));
    }
    if (hasFormula) {
        promises.push(loadScript('https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js'));
    }

    await Promise.all(promises);

    // Khởi tạo các thư viện sau khi đã tải xong
    if (hasCode && typeof hljs !== 'undefined') {
        hljs.highlightAll();
    }
    if (hasFormula && typeof MathJax !== 'undefined') {
        MathJax.typeset();
    }
};