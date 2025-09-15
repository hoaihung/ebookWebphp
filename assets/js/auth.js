// file: /assets/js/auth.js (MỚI)
import config from './config.js';
import { apiFetch } from './api.js';

// We no longer store JWT tokens in localStorage because the backend
// now uses PHP sessions. The dummy functions below remain for backward
// compatibility in case other modules import them. They do nothing.
const saveToken = (token) => {};
const clearToken = () => {};

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authMessageEl = document.getElementById('auth-message');

// Hàm lấy URL để redirect sau khi đăng nhập/đăng ký thành công
const getRedirectUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect');
    // Nếu có redirect và nó là một URL hợp lệ trên trang của mình, quay lại đó.
    // Ngược lại, về trang chủ.
    if (redirect && redirect.startsWith(config.URLS.ROOT)) {
        return redirect;
    }
    return config.URLS.LIBRARY; // Trang thư viện (index.html)
};

// Hàm hiển thị thông báo
const showMessage = (message, isError = false) => {
    authMessageEl.textContent = message;
    authMessageEl.className = isError ? 'auth-message error' : 'auth-message success';
};

// --- Logic Đăng nhập ---
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMessage('');
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        try {
            const result = await apiFetch('/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            // On success, result contains { user: {...} }
            window.location.href = getRedirectUrl();
        } catch (err) {
            console.error(err);
            showMessage('Đã xảy ra lỗi. Vui lòng thử lại.', true);
        }
    });
}

// --- Logic Đăng ký ---
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMessage('');
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        if (password.length < 6) {
            showMessage('Mật khẩu phải có ít nhất 6 ký tự.', true);
            return;
        }
        try {
            const result = await apiFetch('/register', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            // On success, result contains { user: {...} }
            showMessage('Đăng ký thành công! Đang chuyển hướng...', false);
            setTimeout(() => {
                window.location.href = getRedirectUrl();
            }, 1000);
        } catch (err) {
            console.error(err);
            showMessage('Đã xảy ra lỗi. Vui lòng thử lại.', true);
        }
    });
}