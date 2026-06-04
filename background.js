// Service Worker для уведомлений расширения "Инфостарт Курс SM"

// Храним предыдущий курс для отслеживания изменений
let previousRate = null;
let notificationId = 0;

// Загружаем сохранённый курс при старте
chrome.storage.local.get(['sm_rate', 'sm_notify_rate_change', 'sm_notify_transactions'], function(result) {
    previousRate = result.sm_rate || null;
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

// Обработчик изменения курса
function handleRateUpdate(newRate) {
    if (previousRate === null) {
        previousRate = newRate;
        return;
    }

    const changePercent = Math.abs((newRate - previousRate) / previousRate * 100);
    
    // Уведомление при изменении курса более чем на 5%
    if (changePercent >= 5) {
        const direction = newRate > previousRate ? '📈' : '📉';
        const changeType = newRate > previousRate ? 'вырос' : 'упал';
        
        showNotification(
            'Курс $m изменился',
            `${direction} Курс ${changeType} с ${previousRate} до ${newRate} ₽ (${changePercent.toFixed(1)}%)`
        );
    }
    
    previousRate = newRate;
}

// Обработчик новых транзакций
function handleNewTransactions(transactions, rate) {
    if (!transactions || transactions.length === 0) return;
    
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

    // Авто-закрытие через 5 секунд
    setTimeout(() => {
        chrome.notifications.clear(id);
    }, 5000);
}

// Клик по уведомлению — открываем страницу транзакций
chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('sm-notify-')) {
        chrome.tabs.create({ url: 'https://infostart.ru/profile/money/transact/' });
        chrome.notifications.clear(notificationId);
    }
});