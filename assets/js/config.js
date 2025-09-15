// file: /assets/js/config.js (VERSION 4.0 - FINAL & ROBUST)

// =========================================================================
// == CONFIGURATION FILE - NGUỒN CHÂN LÝ DUY NHẤT CHO CẤU HÌNH TOÀN CỤC ==
//         CHỈ CẦN THAY ĐỔI CÁC GIÁ TRỊ TRONG `baseConfig`
// =========================================================================

const baseConfig = {
    // Môi trường Development: vì backend và frontend được phục vụ cùng một domain
    // trong giai đoạn phát triển nên DEV_ROOT_URL có thể để trống. Khi chạy
    // ứng dụng thông qua node server, các tệp tĩnh sẽ được phục vụ từ
    // cùng domain/port.
    DEV_ROOT_URL: '',

    // Môi trường Production: thay đổi thành domain của bạn nếu triển khai
    // trên máy chủ riêng. Để trống hoặc để cùng cấu hình như DEV nếu
    // frontend và backend được phục vụ cùng domain.
    PROD_ROOT_URL: '',

    // Các đường dẫn tương đối từ gốc, LUÔN bắt đầu bằng /
    RELATIVE_PATHS: {
        LOGIN: '/login.html',
        REGISTER: '/register.html',
        LIBRARY: '/index.html',
        READER: '/reader.html',
        // Change admin path to PHP to enforce server‑side access control
        ADMIN: '/admin.php',
        ASSETS: '/assets',
        IMAGES: '/assets/images',
        TEMPLATES: '/assets/templates'
    },

    // API gốc: đường dẫn tới API backend. Vì backend phục vụ trên cùng
    // domain trong cấu hình này, chỉ cần dùng '/api'. Nếu bạn triển khai
    // backend trên domain khác, hãy cập nhật giá trị này tương ứng.
    API_BASE: '/api'
};

// --- LOGIC TỰ ĐỘNG XÂY DỰNG CÁC URL TUYỆT ĐỐI ---
const buildConfig = () => {
    const isProduction = window.location.hostname !== 'ebookweb2.local' && window.location.hostname !== '127.0.0.1';
    
    // Chọn URL gốc chính xác
    const rootUrl = isProduction ? baseConfig.PROD_ROOT_URL : baseConfig.DEV_ROOT_URL;

    // Tạo ra các URL tuyệt đối hoàn chỉnh. ROOT trỏ tới gốc của trang web.
    const absoluteUrls = {
        ROOT: rootUrl,
        API_BASE: `${rootUrl}${baseConfig.API_BASE}`
    };
    for (const key in baseConfig.RELATIVE_PATHS) {
        absoluteUrls[key] = `${rootUrl}${baseConfig.RELATIVE_PATHS[key]}`;
    }

    return {
        // Trả về một object chứa các URL đã được xây dựng hoàn chỉnh
        URLS: absoluteUrls
    };
};

const config = buildConfig();

// In ra để debug, bạn có thể xóa dòng này sau khi đã xác nhận
//console.log("Cấu hình URL đã được khởi tạo:", config.URLS);

export default config;