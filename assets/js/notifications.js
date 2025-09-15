// file: assets/js/notifications.js
// Notifications page logic

import config from './config.js';
import { apiFetch } from './api.js';

const container = document.getElementById('notifications-container');

// Render notifications list
function renderNotifications(notifs) {
    container.innerHTML = '';
    if (!Array.isArray(notifs) || notifs.length === 0) {
        container.innerHTML = '<p>Không có thông báo.</p>';
        return;
    }
    notifs.forEach(n => {
        const item = document.createElement('div');
        item.className = 'list-group-item list-group-item-action flex-column align-items-start';
        // Determine read state
        // `is_read` is provided by the API as a boolean; fallback to `read` for legacy
        let read = n.is_read || n.read || false;
        item.innerHTML = `
            <div class="d-flex w-100 justify-content-between">
                <h5 class="mb-1">${n.title}</h5>
                <small>${new Date(n.created_at).toLocaleString()}</small>
            </div>
            <p class="mb-1">${n.message}</p>
            ${n.link_url ? `<small><a href="${n.link_url}">Xem chi tiết</a></small>` : ''}
        `;
        if (!read) {
            item.classList.add('list-group-item-warning');
        }
        // Click to mark as read
        item.addEventListener('click', async () => {
            if (!read) {
                try {
                    await apiFetch(`/notifications/${n.id}/read`, { method: 'POST' });
                    item.classList.remove('list-group-item-warning');
                    read = true;
                } catch (err) {
                    console.error(err);
                    alert(err.message || 'Lỗi đánh dấu thông báo');
                }
            }
        });
        container.appendChild(item);
    });
}

async function loadNotifications() {
    try {
        const notifs = await apiFetch('/notifications');
        renderNotifications(notifs);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p class="text-danger">${err.message || 'Lỗi tải thông báo'}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadNotifications();
});