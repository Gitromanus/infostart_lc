// Service Worker для уведомлений расширения "Инфостарт Курс SM"
// Работает в фоне Chrome, проверяет курс и транзакции по расписанию

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

// Создаём будильники при установке/обновлении расширения
chrome.runtime.onInstalled.addListener(() => {
    // Проверка курса каждые 30 минут
    chrome.alarms.create('sm-check-rate', { periodInMinutes: 30 });
    // Проверка транзакций каждый час
    chrome.alarms.create('sm-check-transactions', { periodInMinutes: 60 });
});

// Обработчик будильников
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sm-check-rate') {
        fetchRateFromBackground();
    } else if (alarm.name === 'sm-check-transactions') {
        fetchTransactionsFromBackground();
    }
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

// Получить настройки
function getSettings(callback) {
    chrome.storage.local.get(['sm_settings'], function(result) {
        callback({ ...DEFAULT_SETTINGS, ...(result.sm_settings || {}) });
    });
}

// Пробует декодировать ArrayBuffer в строку, определяя кодировку
function decodeResponse(buf) {
    try {
        const text = new TextDecoder('windows-1251').decode(buf);
        if (text.includes('Скачивание') || text.includes('Платное') || text.includes('$m')) {
            return text;
        }
    } catch (e) {}
    try {
        return new TextDecoder('utf-8').decode(buf);
    } catch (e) {}
    return new TextDecoder('windows-1251').decode(buf);
}

// Фоновый запрос курса с биржи
function fetchRateFromBackground() {
    fetch('https://infostart.ru/profile/money/stockexchange/', { credentials: 'include' })
        .then(resp => resp.arrayBuffer())
        .then(buf => {
            const html = decodeResponse(buf);
            const rateMatch = html.match(/<span class=["']exh-sale-row["']>\s*([\d,.]+)\s*<\/span>/);
            const newRate = rateMatch ? parseFloat(rateMatch[1].replace(',', '.')) : NaN;
            if (!isNaN(newRate) && newRate > 0 && newRate < 100000) {
                chrome.storage.local.set({ 'sm_rate': newRate });
                handleRateUpdate(newRate);
            }
        })
        .catch(() => {});
}

// Фоновый запрос транзакций
function fetchTransactionsFromBackground() {
    fetch('https://infostart.ru/profile/money/transact/', { credentials: 'include' })
        .then(resp => resp.arrayBuffer())
        .then(buf => {
            const html = decodeResponse(buf);
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('tr');
            let newTransactions = [];
            const allowedOps = ['Скачивание файла', 'Платное скачивание файла'];

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 4) return;
                const desc = cells[3].innerText.trim();
                if (!allowedOps.some(op => desc.startsWith(op))) return;

                // Парсим сумму $m из ячеек 1 и 2
                let sm = 0;
                [1, 2].forEach(idx => {
                    const cell = cells[idx];
                    if (!cell) return;
                    const text = cell.innerText.trim();
                    if (/^[\d.,]+\s*\$m/.test(text)) {
                        sm += parseFloat(text.split('$')[0].replace(',', '.').replace(/[^\d.]/g, ''));
                    }
                });

                if (sm > 0) {
                    // Извлекаем ID транзакции
                    const links = row.querySelectorAll('a');
                    let id = '';
                    links.forEach(a => {
                        const href = a.getAttribute('href') || '';
                        const m = href.match(/ID=(\d+)/);
                        if (m) id = m[1];
                    });
                    if (!id) {
                        // Если нет ID в ссылке, генерируем из даты+суммы
                        const dateCell = cells[0] ? cells[0].innerText.trim() : '';
                        id = dateCell + '_' + sm.toFixed(2);
                    }
                    newTransactions.push({ id, sm, type: desc });
                }
            });

            // Сравниваем с сохранёнными
            chrome.storage.local.get(['sm_all_stats'], function(result) {
                const cached = result.sm_all_stats || [];
                const reallyNew = newTransactions.filter(t => !cached.find(x => x.id === t.id));
                if (reallyNew.length > 0) {
                    // Сохраняем обновлённый список
                    const combined = [...cached, ...reallyNew];
                    chrome.storage.local.set({ 'sm_all_stats': combined });
                    // Получаем текущий курс для рублёвого эквивалента
                    chrome.storage.local.get(['sm_rate'], function(r) {
                        const rate = r.sm_rate || 170;
                        handleNewTransactions(reallyNew, rate);
                    });
                }
            });
        })
        .catch(() => {});
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

        const byType = {};
        transactions.forEach(t => {
            const type = t.type || 'Транзакция';
            if (!byType[type]) byType[type] = 0;
            byType[type] += t.sm;
        });

        if (transactions.length === 1) {
            const t = transactions[0];
            const rub = (t.sm * rate).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            showNotification(
                `💰 ${t.type || 'Новая транзакция'}`,
                `${t.sm.toFixed(2)} $m (${rub} ₽)`
            );
            return;
        }

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