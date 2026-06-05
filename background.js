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
    console.log('SM Service Worker запущен, предыдущий курс:', previousRate, 'настройки:', settings);
});

// Создаём будильники при установке/обновлении расширения
chrome.runtime.onInstalled.addListener(() => {
    console.log('SM Расширение установлено/обновлено, создаю будильники');
    // Проверка курса каждые 30 минут
    chrome.alarms.create('sm-check-rate', { periodInMinutes: 30 });
    // Проверка транзакций каждый час
    chrome.alarms.create('sm-check-transactions', { periodInMinutes: 60 });
});

// Обработчик будильников
chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('SM Сработал будильник:', alarm.name);
    if (alarm.name === 'sm-check-rate') {
        fetchRateFromBackground();
    } else if (alarm.name === 'sm-check-transactions') {
        fetchTransactionsFromBackground();
    }
});

// Слушаем сообщения от content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('SM background onMessage: получено сообщение', message.type, message);
    switch (message.type) {
        case 'RATE_UPDATED':
            console.log('SM background onMessage: вызываю handleRateUpdate с курсом', message.rate);
            handleRateUpdate(message.rate);
            break;
        case 'NEW_TRANSACTIONS':
            console.log('SM background onMessage: вызываю handleNewTransactions, транзакций:', message.transactions ? message.transactions.length : 0);
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
    console.log('SM fetchRateFromBackground: начинаю запрос к бирже');
    fetch('https://infostart.ru/profile/money/stockexchange/', { credentials: 'include' })
        .then(resp => {
            console.log('SM fetchRateFromBackground: статус ответа', resp.status, resp.url);
            return resp.arrayBuffer();
        })
        .then(buf => {
            console.log('SM fetchRateFromBackground: получен ArrayBuffer, размер', buf.byteLength);
            const html = decodeResponse(buf);
            console.log('SM fetchRateFromBackground: HTML длина', html.length, 'первые 500 символов:', html.substring(0, 500));
            const rateMatch = html.match(/<span class=["']exh-sale-row["']>\s*([\d,.]+)\s*<\/span>/);
            console.log('SM fetchRateFromBackground: совпадение regex', rateMatch ? rateMatch[1] : 'НЕ НАЙДЕНО');
            const newRate = rateMatch ? parseFloat(rateMatch[1].replace(',', '.')) : NaN;
            console.log('SM fetchRateFromBackground: распаршенный курс', newRate);
            if (!isNaN(newRate) && newRate > 0 && newRate < 100000) {
                console.log('SM fetchRateFromBackground: курс валидный, сохраняю', newRate);
                chrome.storage.local.set({ 'sm_rate': newRate });
                handleRateUpdate(newRate);
            } else {
                console.log('SM fetchRateFromBackground: курс НЕ валидный', newRate);
            }
        })
        .catch(err => console.log('SM fetchRateFromBackground: ОШИБКА', err));
}

// Парсит строку таблицы транзакций из HTML (без DOMParser — недоступен в Service Worker)
function parseTransactionRow(rowHtml) {
    // Извлекаем ячейки <td> из строки <tr>
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
        cells.push(tdMatch[1].trim());
    }
    if (cells.length < 4) return null;

    // Очищаем HTML-теги из содержимого ячеек
    const stripHtml = (str) => str.replace(/<[^>]*>/g, '').trim();

    const dateStr = stripHtml(cells[0]);
    const cell1 = stripHtml(cells[1]);
    const cell2 = stripHtml(cells[2]);
    const desc = stripHtml(cells[3]);

    // Проверяем тип операции
    const allowedOps = ['Скачивание файла', 'Платное скачивание файла', 'Начисление'];
    const excludedOps = ['Отмена лота'];
    if (excludedOps.some(op => desc.startsWith(op))) return null;
    if (!allowedOps.some(op => desc.startsWith(op))) return null;

    // Парсим сумму $m из ячеек 1 и 2
    let sm = 0;
    [cell1, cell2].forEach(text => {
        const m = text.match(/^([\d.,]+)\s*\$m/);
        if (m) {
            sm += parseFloat(m[1].replace(',', '.'));
        }
    });
    if (sm <= 0) return null;

    // Извлекаем ID транзакции из ссылок в строке
    const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>/gi;
    let id = '';
    let linkMatch;
    while ((linkMatch = linkRegex.exec(rowHtml)) !== null) {
        const href = linkMatch[1];
        const idMatch = href.match(/ID=(\d+)/);
        if (idMatch) { id = idMatch[1]; break; }
    }
    if (!id) {
        id = dateStr.split(' ')[0] + '_' + sm.toFixed(2);
    }

    return { id, sm, type: desc, date: dateStr.split(' ')[0] };
}

// Фоновый запрос транзакций (без DOMParser)
function fetchTransactionsFromBackground() {
    console.log('SM fetchTransactionsFromBackground: начинаю запрос транзакций');
    fetch('https://infostart.ru/profile/money/transact/', { credentials: 'include' })
        .then(resp => {
            console.log('SM fetchTransactionsFromBackground: статус ответа', resp.status, resp.url);
            return resp.arrayBuffer();
        })
        .then(buf => {
            console.log('SM fetchTransactionsFromBackground: получен ArrayBuffer, размер', buf.byteLength);
            const html = decodeResponse(buf);
            
            // Извлекаем все строки <tr> из таблицы (ищем <tr>...<td>...<td>...<td>...<td>)
            const rowRegex = /<tr[^>]*>[\s\S]*?<td[\s\S]*?<\/tr>/gi;
            const rows = html.match(rowRegex) || [];
            console.log('SM fetchTransactionsFromBackground: найдено строк в таблице', rows.length);
            
            let newTransactions = [];
            rows.forEach(rowHtml => {
                const parsed = parseTransactionRow(rowHtml);
                if (parsed) newTransactions.push(parsed);
            });

            console.log('SM fetchTransactionsFromBackground: найдено подходящих транзакций на странице', newTransactions.length);

            // Сравниваем с сохранёнными
            chrome.storage.local.get(['sm_all_stats'], function(result) {
                const cached = result.sm_all_stats || [];
                console.log('SM fetchTransactionsFromBackground: в кэше', cached.length, 'транзакций');
                const reallyNew = newTransactions.filter(t => !cached.find(x => x.id === t.id));
                console.log('SM fetchTransactionsFromBackground: действительно новых', reallyNew.length);
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
        .catch(err => console.log('SM fetchTransactionsFromBackground: ОШИБКА', err));
}

// Обработчик изменения курса
function handleRateUpdate(newRate) {
    console.log('SM handleRateUpdate: newRate=', newRate, 'previousRate=', previousRate);
    if (previousRate === null) {
        console.log('SM handleRateUpdate: первый запуск, запоминаю курс', newRate, 'без уведомления');
        previousRate = newRate;
        return;
    }

    const changePercent = Math.abs((newRate - previousRate) / previousRate * 100);
    const isUp = newRate > previousRate;
    console.log('SM handleRateUpdate: изменение', changePercent.toFixed(2) + '%', isUp ? 'вверх' : 'вниз');

    getSettings(function(settings) {
        console.log('SM handleRateUpdate: настройки', settings);
        if (isUp && !settings.notify_rate_up) { console.log('SM handleRateUpdate: уведомления о повышении отключены'); previousRate = newRate; return; }
        if (!isUp && !settings.notify_rate_down) { console.log('SM handleRateUpdate: уведомления о понижении отключены'); previousRate = newRate; return; }

        console.log('SM handleRateUpdate: порог', settings.rate_threshold, '%, изменение', changePercent.toFixed(2) + '%');
        if (changePercent >= settings.rate_threshold) {
            const arrow = isUp ? '🟢' : '🔴';
            const direction = isUp ? 'вырос' : 'упал';
            const sign = isUp ? '+' : '-';

            console.log('SM handleRateUpdate: ПОКАЗЫВАЮ УВЕДОМЛЕНИЕ');
            showNotification(
                `Курс $m ${direction}`,
                `${arrow} ${previousRate} → ${newRate} ₽ (${sign}${changePercent.toFixed(1)}%)`
            );
        } else {
            console.log('SM handleRateUpdate: изменение меньше порога, уведомление не нужно');
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