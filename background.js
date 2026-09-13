// Service Worker для уведомлений расширения "Инфостарт Курс SM"
// Работает в фоне Chrome, проверяет курс и транзакции по расписанию

let previousRate = null;
let notificationId = 0;

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
    notify_rate_up: true,
    notify_rate_down: true,
    notify_downloads: true,
    rate_threshold: 5, // порог изменения курса в %
    telegram_enabled: false,
    telegram_token: '',
    telegram_chat_id: ''
};
