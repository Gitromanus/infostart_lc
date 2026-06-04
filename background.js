// Service Worker для уведомлений расширения "Инфостарт Курс SM"

let previousRate = null;
let notificationId = 0;

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
    notify_rate_up: true,
    notify_rate_down: true,
    notify_downloads: true,
    rate_threshold: 5 // порог изменения курса в %
};

// Загружаем настройки и курс при старте
chrome.storage.local.get(['sm_rate', 'sm_settings'], function(result) {
    previousRate = result.sm_rate || null;
    const settings = { ...DEFAULT_SETTINGS, ...(result.sm_settings || {}) };
    chrome.storage.local.set({ sm_settings: settings });
});

// Слушаем сообщения от content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'RATE_UPDATED':
            handleRateUpdate(message.rate);
            break;
        case 'NEW_TRANSACTIONS':
            handleNewTransactions(message.transactions, message.rate);
            break;
    }
});

// Получить настройки (синхронно из кэша)
function getSettings(callback) {
    chrome.storage.local.get(['sm_settings'], function(result) {
        callback({ ...DEFAULT_SETTINGS, ...(result.sm_settings || {}) });
    });
}

// Обработчик изменения курса
function handleRateUpdate(newRate) {
    if (previousRate === null) {
        previousRate = newRate;
        return;
    }

    const changePercent = Math.abs((newRate - previousRate) / previousRate * 100);
    const isUp = newRate > previousRate;

    getSettings(function(settings) {
        // Проверяем, нужно ли уведомлять
        if (isUp && !settings.notify_rate_up) { previousRate = newRate; return; }
        if (!isUp && !settings.notify_rate_down) { previousRate = newRate; return; }

        if (changePercent >= settings.rate_threshold) {
            const arrow = isUp ? '🟢' : '🔴';
            const direction = isUp ? 'вырос' : 'упал';
            const sign = isUp ? '+' : '-';

            showNotification(
                `Курс $m ${direction}`,
                `${arrow} ${previousRate} → ${newRate} ₽ (${sign}${changePercent.toFixed(1)}%)`
            );
        }

        previousRate = newRate;
    });
}

// Обработчик новых транзакций
function handleNewTransactions(transactions, rate) {
    if (!transactions || transactions.length === 0) return;

    getSettings(function(settings) {
        if (!settings.notify_downloads) return;

        // Группируем по типу операции
        const byType = {};
        transactions.forEach(t => {
            const type = t.type || 'Транзакция';
            if (!byType[type]) byType[type] = 0;
            byType[type] += t.sm;
        });

        // Если одна транзакция — показываем детально
        if (transactions.length === 1) {
            const t = transactions[0];
            const rub = (t.sm * rate).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            showNotification(
                `💰 ${t.type || 'Новая транзакция'}`,
                `${t.sm.toFixed(2)} $m (${rub} ₽)`
            );
            return;
        }

        // Если несколько — сводка
        let details = Object.entries(byType)
            .map(([type, sum]) => `${type}: +${sum.toFixed(2)} $m`)
            .join('\n');

        const totalSm = transactions.reduce((a, b) => a + b.sm, 0);
        const totalRub = (totalSm * rate).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});

        showNotification(
            `💰 ${transactions.length} новых транзакций`,
            `Всего: +${totalSm.toFixed(2)} $m (${totalRub} ₽)\n${details}`
        );
    });
}

// Показ уведомления
function showNotification(title, message) {
    const id = `sm-notify-${++notificationId}`;
    chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: 'icon48.png',
        title: title,
        message: message,
        priority: 2
    });

    // Авто-закрытие через 10 секунд
    setTimeout(() => {
        chrome.notifications.clear(id);
    }, 10000);
}

// Клик по уведомлению — открываем страницу транзакций
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('sm-notify-')) {
        chrome.tabs.create({ url: 'https://infostart.ru/profile/money/transact/' });
        chrome.notifications.clear(notificationId);
    }
});