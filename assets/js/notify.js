// Simple notification/toast system for the frontend.
// Provides a Notice object with show() that displays auto‑dismissable
// messages in the corner of the page. Also overrides window.alert() to
// use these toasts instead of blocking alerts.

export const Notice = {
  /**
   * Ensure the notice container exists in the DOM. If it doesn't exist
   * yet it will be created on demand. This container holds individual
   * notice toasts.
   */
  ensureContainer() {
    let container = document.getElementById('notice-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notice-container';
      container.className = 'notice-container';
      document.body.appendChild(container);
    }
    return container;
  },
  /**
   * Display a new toast message. Type can be one of: info, success,
   * error or warning. Message is a string. Duration is optional and
   * defaults to 3500ms.
   */
  show(type = 'info', message = '', duration = 3500) {
    const container = this.ensureContainer();
    const toast = document.createElement('div');
    toast.className = `notice notice-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    // Remove the toast after animation ends or duration expires
    const remove = () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    };
    // Use animationend if supported, otherwise fallback to timeout
    toast.addEventListener('animationend', remove);
    setTimeout(remove, duration + 500);
  }
};

// Override global alert() to display a toast instead. The type is
// determined heuristically based on the message prefix.
window.alert = function(msg) {
  const text = (msg || '').toString().trim();
  let type = 'info';
  if (/^(Đã|Thành công|Success)/i.test(text)) type = 'success';
  else if (/^(Lỗi|Error|Không thể|Failed)/i.test(text)) type = 'error';
  else if (/^(Cảnh báo|Warning)/i.test(text)) type = 'warning';
  Notice.show(type, text);
};