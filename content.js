console.log('SM content.js: скрипт загружен, URL:', window.location.href);
chrome.storage.local.get(['sm_rate', 'sm_all_stats'], function(result) {
    let currentRate = result.sm_rate || 170;
    let cachedStats = result.sm_all_stats || [];
    let currentView = 'month';
    
    const isTransact = window.location.href.includes('transact');

    // Список разрешённых типов операций для учёта
    const ALLOWED_OPERATIONS = [
        'Скачивание файла',
        'Платное скачивание файла'
    ];

    // Проверяет, относится ли строка таблицы к разрешённому типу операции
    const isAllowedOperation = (cells) => {
        if (cells.length < 4) return false;
        const desc = cells[3].innerText.trim();
        return ALLOWED_OPERATIONS.some(op => desc.startsWith(op));
    };

    // Пробует декодировать ArrayBuffer в строку, определяя кодировку
    const decodeResponse = (buf) => {
        // Сначала пробуем windows-1251
        try {
            const text = new TextDecoder('windows-1251').decode(buf);
            // Проверяем, есть ли в тексте узнаваемые русские слова из операций
            if (text.includes('Скачивание') || text.includes('Платное') || text.includes('$m')) {
                return text;
            }
        } catch (e) {}
        // Если не нашли — пробуем UTF-8
        try {
            return new TextDecoder('utf-8').decode(buf);
        } catch (e) {}
        return new TextDecoder('windows-1251').decode(buf);
    };

    // 1. ОБНОВЛЕНИЕ КУРСА С БИРЖИ
    // Фоновый fetch курса — срабатывает при каждом открытии любой страницы расширения
    const fetchRateInBackground = () => {
        console.log('SM content.js fetchRateInBackground: начинаю запрос к бирже');
        const stockUrl = 'https://infostart.ru/profile/money/stockexchange/';
        fetch(stockUrl, { credentials: 'include' })
            .then(resp => {
                console.log('SM content.js fetch статус:', resp.status, resp.url);
                return resp.arrayBuffer();
            })
            .then(buf => {
                console.log('SM content.js fetch: получен ArrayBuffer, размер', buf.byteLength);
                const html = decodeResponse(buf);
                console.log('SM content.js fetch: HTML длина', html.length, 'первые 300 символов:', html.substring(0, 300));
                // Курс в <span class="exh-buy-row">157</span> после текста "Текущий:"
                // Ищем курс regex прямо в HTML: <span class="exh-buy-row">157</span>
                const rateMatch = html.match(/<span class=["']exh-sale-row["']>\s*([\d,.]+)\s*<\/span>/);
                console.log('SM content.js курс найден:', rateMatch ? rateMatch[1] : 'НЕ НАЙДЕНО');
                const newRate = rateMatch ? parseFloat(rateMatch[1].replace(',', '.')) : NaN;
                console.log('SM content.js распаршенный курс:', newRate);
                if (!isNaN(newRate) && newRate > 0 && newRate < 100000) {
                    chrome.storage.local.set({ 'sm_rate': newRate });
                    currentRate = newRate;
                    console.log('SM content.js курс обновлен:', currentRate);
                    // Уведомление в background об изменении курса
                    console.log('SM content.js отправляю RATE_UPDATED:', newRate);
                    chrome.runtime.sendMessage({ type: 'RATE_UPDATED', rate: newRate }).catch(err => console.log('SM content.js ошибка отправки RATE_UPDATED:', err));
                    // Обновляем дашборд через storage — так renderInfo подхватит новый курс
                    chrome.storage.local.get(['sm_all_stats'], function(r) {
                        const stats = r.sm_all_stats || cachedStats;
                        const valDay = document.getElementById('sm-val-day');
                        if (valDay) {
                            const rateLabel = document.querySelector('#sm-dashboard [style*="color:#888"]');
                            if (rateLabel) rateLabel.innerText = `ЗА СЕГОДНЯ (Курс: ${newRate})`;
                            const fmt = v => (v * newRate).toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2});
                            const todayStr = new Date().toLocaleDateString('ru-RU');
                            const monthStr = todayStr.substring(3);
                            const daySM = stats.filter(e => e.date === todayStr).reduce((a,b) => a+b.sm, 0);
                            const monthSM = stats.filter(e => e.date.endsWith(monthStr)).reduce((a,b) => a+b.sm, 0);
                            const totalSM = stats.reduce((a,b) => a+b.sm, 0);
                            document.getElementById('sm-val-day').innerText = daySM.toFixed(2) + ' $m';
                            document.getElementById('sm-val-day-rub').innerText = fmt(daySM) + ' ₽';
                            document.getElementById('sm-val-month').innerText = monthSM.toFixed(2) + ' $m';
                            document.getElementById('sm-val-month-rub').innerText = fmt(monthSM) + ' ₽';
                            document.getElementById('sm-val-total').innerText = totalSM.toFixed(2) + ' $m';
                            document.getElementById('sm-val-total-rub').innerText = fmt(totalSM) + ' ₽';
                            // Перерисовываем суммы в таблице с новым курсом
                            document.querySelectorAll('.sm-done').forEach(el => el.remove());
                            document.querySelectorAll('tr').forEach(row => {
                                const cells = row.querySelectorAll('td');
                                // Показываем рублёвые суммы только для разрешённых операций
                                if (!isAllowedOperation(cells)) return;
                                [1, 2].forEach(idx => {
                                    const cell = cells[idx];
                                    if (!cell) return;
                                    const cellText = cell.innerText.trim();
                                    if (/^[\d.,]+\$m/.test(cellText)) {
                                        const val = parseFloat(cellText.split('$')[0].replace(',', '.').replace(/[^\d.]/g, ''));
                                        if (!isNaN(val)) {
                                            const d = document.createElement('div');
                                            d.className = 'sm-done';
                                            d.style.cssText = 'color:#1976d2; font-weight:bold; font-size:0.85em; margin-top:2px;';
                                            d.innerText = `(${(val * newRate).toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2})} ₽)`;
                                            cell.appendChild(d);
                                        }
                                    }
                                });
                            });
                        }
                    });
                } else {
                    console.log('SM content.js курс НЕ валидный:', newRate);
                }
            })
            .catch(e => console.log('SM content.js Ошибка получения курса:', e));
    };

    if (isTransact) {
        // Только на странице транзакций — забираем курс с биржи в фоне
        fetchRateInBackground();

    // 2. ДАШБОРД И ТРАНЗАКЦИИ
    if (isTransact) {
        const createDashboard = () => {
            if (document.getElementById('sm-dashboard')) return;
            const target = document.querySelector('.pagination') || document.querySelector('.modern-page-navigation') || document.querySelector('table');
            if (!target) return;

            const dash = document.createElement('div');
            dash.id = 'sm-dashboard';
            dash.style.cssText = "background:#f8f9fa; border:1px solid #ddd; border-radius:8px; padding:15px; margin-bottom:20px; font-family:sans-serif; color:#333;";
            
            dash.innerHTML = `
                <style>
                    #sm-settings-btn:hover { background:#d0d0d0 !important; transform:scale(1.1); }
                    /* Toggle Switch */
                    .sm-toggle { appearance:none; -webkit-appearance:none; width:36px; height:20px; background:#ccc; border-radius:10px; position:relative; cursor:pointer; transition:background 0.2s; flex-shrink:0; margin:0; }
                    .sm-toggle::before { content:''; position:absolute; top:2px; left:2px; width:16px; height:16px; background:#fff; border-radius:50%; transition:transform 0.2s; }
                    .sm-toggle:checked { background:#4caf50; }
                    .sm-toggle:checked::before { transform:translateX(16px); }
                </style>
                <!-- Шапка с блоками статистики и кнопкой настроек -->
                <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 15px;">
                    <div style="flex: 1; min-width: 140px; background:#fff; padding:10px; border-radius:6px; border:1px solid #eee;">
                        <div style="font-size:11px; color:#888;">ЗА СЕГОДНЯ (Курс: ${currentRate})</div>
                        <div id="sm-val-day" style="font-size:18px; font-weight:bold; color:#28a745;">0.00 $m</div>
                        <div id="sm-val-day-rub" style="color:#1976d2; font-size:14px; font-weight:bold;">0.00 ₽</div>
                    </div>
                    <div style="flex: 1; min-width: 140px; background:#fff; padding:10px; border-radius:6px; border:1px solid #eee;">
                        <div style="font-size:11px; color:#888;">МЕСЯЦ</div>
                        <div id="sm-val-month" style="font-size:18px; font-weight:bold; color:#28a745;">0.00 $m</div>
                        <div id="sm-val-month-rub" style="color:#1976d2; font-size:14px; font-weight:bold;">0.00 ₽</div>
                    </div>
                    <div style="flex: 1; min-width: 140px; background:#fff; padding:10px; border-radius:6px; border:1px solid #eee;">
                        <div style="font-size:11px; color:#888;">ОБЩИЙ ИТОГ</div>
                        <div id="sm-val-total" style="font-size:18px; font-weight:bold; color:#28a745;">0.00 $m</div>
                        <div id="sm-val-total-rub" style="color:#1976d2; font-size:14px; font-weight:bold;">0.00 ₽</div>
                    </div>
                    <div style="display:flex; align-items:stretch; min-width:50px;">
                        <div style="cursor:pointer; font-size:24px; background:#e8e8e8; border-radius:6px; padding:20px 8px; transition:background 0.2s, transform 0.2s; line-height:1; display:flex; align-items:center;" id="sm-settings-btn" title="Настройки">⚙️</div>
                    </div>
                </div>
                
                <!-- График -->
                <div id="sm-chart-box" style="display:none; background:#fff; padding:15px; border:1px solid #eee; border-radius:6px; margin-bottom:15px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-size:12px; font-weight:bold; color:#666;">ГРАФИК ДОХОДА (₽)</div>
                        <div id="sm-filters" style="display:flex; gap:5px;">
                            <button data-v="month" style="cursor:pointer; font-size:10px; padding:3px 8px; border:1px solid #ddd; background:#eee; border-radius:3px;">Месяц</button>
                            <button data-v="year" style="cursor:pointer; font-size:10px; padding:3px 8px; border:1px solid #ddd; background:#fff; border-radius:3px;">Год</button>
                            <button data-v="all" style="cursor:pointer; font-size:10px; padding:3px 8px; border:1px solid #ddd; background:#fff; border-radius:3px;">Все</button>
                        </div>
                    </div>
                    <div id="sm-canvas" style="width:100%; height:150px; position:relative;"></div>
                </div>

                <!-- Прогноз -->
                <div id="sm-prediction-box" style="background:#fff; padding:15px; border:1px solid #eee; border-radius:6px; margin-bottom:15px;">
                    <div style="font-size:11px; color:#999; text-align:center;">Загрузка прогноза...</div>
                </div>

                <!-- Модальное окно настроек -->
                <div id="sm-settings-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.4); z-index:9999; justify-content:center; align-items:center;">
                    <div style="background:#fff; border-radius:10px; padding:25px; max-width:400px; width:90%; box-shadow:0 4px 20px rgba(0,0,0,0.2); font-size:14px; max-height:90vh; overflow-y:auto;">
                        <div style="font-size:16px; font-weight:bold; margin-bottom:15px; color:#333;">⚙️ Настройки</div>

                        <!-- Блок: История (наверху) -->
                        <div style="margin-bottom:15px;">
                            <div style="font-size:12px; font-weight:bold; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #eee;">📊 История</div>
                            
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span style="font-size:12px; color:#666;">Страниц:</span>
                                <input type="number" id="sm-pages-input" value="10" min="1" max="100" style="width:55px; padding:4px; border:1px solid #ccc; border-radius:4px;">
                                <button id="sm-load-btn" style="cursor:pointer; padding:5px 10px; background:#007bff; color:#fff; border:none; border-radius:4px; font-size:12px;">📥 Догрузить</button>
                                <span id="sm-status" style="font-size:11px; color:#999;"></span>
                            </div>
                        </div>
                        
                        <!-- Блок: Уведомления -->
                        <div style="margin-bottom:15px;">
                            <div style="font-size:12px; font-weight:bold; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #eee;">🔔 Уведомления</div>
                            
                            <!-- Повышение курса + порог в одной строке -->
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                    <input type="checkbox" class="sm-toggle" id="sm-notify-rate-up" checked>
                                    <span>🟢 Повышение курса $m</span>
                                </label>
                                <div style="display:flex; align-items:center; gap:6px;">
                                    <span style="font-size:11px; color:#666; white-space:nowrap;">Порог:</span>
                                    <input type="number" id="sm-rate-threshold" value="5" min="0.01" max="50" step="0.01" style="width:60px; padding:3px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                                    <span style="font-size:11px; color:#666;">%</span>
                                </div>
                            </div>
                            
                            <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
                                <input type="checkbox" class="sm-toggle" id="sm-notify-rate-down" checked>
                                <span>🔴 Понижение курса $m</span>
                            </label>
                            
                            <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
                                <input type="checkbox" class="sm-toggle" id="sm-notify-downloads" checked>
                                <span>💰 Покупки</span>
                            </label>
                            
                            <div style="margin-top:10px;">
                                <button id="sm-test-notify" style="cursor:pointer; padding:5px 10px; background:#ff9800; color:#fff; border:none; border-radius:4px; font-size:12px;">🔔 Проверить уведомления</button>
                            </div>
                        </div>
                        
                        <!-- Блок: Отображение -->
                        <div style="margin-bottom:15px;">
                            <div style="font-size:12px; font-weight:bold; color:#666; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #eee;">👁️ Отображение</div>
                            
                            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                <input type="checkbox" class="sm-toggle" id="sm-show-prediction" checked>
                                <span>Показывать прогноз дохода</span>
                            </label>
                        </div>
                        
                        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:5px;">
                            <button id="sm-settings-close" style="cursor:pointer; padding:6px 14px; background:#eee; color:#333; border:none; border-radius:4px;">Закрыть</button>
                            <button id="sm-settings-save" style="cursor:pointer; padding:6px 14px; background:#007bff; color:#fff; border:none; border-radius:4px;">Сохранить</button>
                        </div>
                    </div>
                </div>
            `;
            target.parentNode.insertBefore(dash, target);

            document.querySelectorAll('#sm-filters button').forEach(btn => {
                btn.onclick = () => {
                    currentView = btn.getAttribute('data-v');
                    document.querySelectorAll('#sm-filters button').forEach(b => b.style.background = '#fff');
                    btn.style.background = '#eee';
                    drawChart(cachedStats);
                };
            });
            document.getElementById('sm-load-btn').onclick = collectHistory;
            document.getElementById('sm-test-notify').onclick = testNotifications;

            // Настройки уведомлений
            const settingsBtn = document.getElementById('sm-settings-btn');
            const settingsModal = document.getElementById('sm-settings-modal');
            const settingsClose = document.getElementById('sm-settings-close');
            const settingsSave = document.getElementById('sm-settings-save');

            // Загружаем сохранённые настройки
            chrome.storage.local.get(['sm_settings'], function(result) {
                const s = result.sm_settings || {};
                document.getElementById('sm-notify-rate-up').checked = s.notify_rate_up !== false;
                document.getElementById('sm-notify-rate-down').checked = s.notify_rate_down !== false;
                document.getElementById('sm-notify-downloads').checked = s.notify_downloads !== false;
                document.getElementById('sm-rate-threshold').value = s.rate_threshold || 5;
                document.getElementById('sm-show-prediction').checked = s.show_prediction !== false;
                // Применяем видимость прогноза
                const predBox = document.getElementById('sm-prediction-box');
                if (predBox) {
                    predBox.style.display = s.show_prediction !== false ? 'block' : 'none';
                }
            });

            settingsBtn.onclick = () => { settingsModal.style.display = 'flex'; };
            settingsClose.onclick = () => { settingsModal.style.display = 'none'; };
            settingsModal.onclick = (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none'; };
            settingsSave.onclick = () => {
                const settings = {
                    notify_rate_up: document.getElementById('sm-notify-rate-up').checked,
                    notify_rate_down: document.getElementById('sm-notify-rate-down').checked,
                    notify_downloads: document.getElementById('sm-notify-downloads').checked,
                    rate_threshold: parseFloat(document.getElementById('sm-rate-threshold').value) || 5,
                    show_prediction: document.getElementById('sm-show-prediction').checked
                };
                chrome.storage.local.set({ sm_settings: settings }).catch(() => {});
                // Применяем видимость прогноза
                const predBox = document.getElementById('sm-prediction-box');
                if (predBox) {
                    predBox.style.display = settings.show_prediction ? 'block' : 'none';
                }
                settingsModal.style.display = 'none';
            };
        };

        const drawChart = (data) => {
            const container = document.getElementById('sm-canvas');
            if (!container || data.length === 0) return;
            document.getElementById('sm-chart-box').style.display = 'block';

            let grouped = {};
            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();

            if (currentView === 'month') {
                const days = new Date(currentYear, currentMonth, 0).getDate();
                for (let i = 1; i <= days; i++) grouped[i.toString().padStart(2, '0')] = 0;
                data.forEach(e => {
                    const [d, m, y] = e.date.split('.');
                    if (parseInt(m) === currentMonth && parseInt(y) === currentYear) {
                        grouped[d] = (grouped[d] || 0) + (e.sm * currentRate);
                    }
                });
            } else if (currentView === 'year') {
                for (let i = 1; i <= 12; i++) grouped[i.toString().padStart(2, '0')] = 0;
                data.forEach(e => {
                    const [d, m, y] = e.date.split('.');
                    if (parseInt(y) === currentYear) grouped[m] = (grouped[m] || 0) + (e.sm * currentRate);
                });
            } else {
                data.forEach(e => {
                    const mKey = e.date.substring(3);
                    grouped[mKey] = (grouped[mKey] || 0) + (e.sm * currentRate);
                });
            }

            const keys = Object.keys(grouped).sort((a,b) => {
                if (currentView === 'all') {
                    const [m1, y1] = a.split('.'); const [m2, y2] = b.split('.');
                    return new Date(y1, m1-1) - new Date(y2, m2-1);
                }
                return a.localeCompare(b, undefined, {numeric: true});
            });

            const maxVal = Math.max(...Object.values(grouped), 500);
            const w = container.clientWidth;
            const h = 110;
            const colW = (w - 50) / keys.length;

            let svgHtml = `<svg width="100%" height="150" style="overflow:visible">`;
            [0, 0.5, 1].forEach(tick => {
                const yPos = h - (tick * h) + 20;
                svgHtml += `<line x1="45" y1="${yPos}" x2="${w}" y2="${yPos}" stroke="#f3f3f3" stroke-width="1" />`;
                svgHtml += `<text x="40" y="${yPos + 3}" font-size="8" fill="#bbb" text-anchor="end">${Math.round(maxVal * tick)}</text>`;
            });

            keys.forEach((k, i) => {
                const val = grouped[k];
                const colH = (val / maxVal) * h;
                const x = 45 + (i * colW);
                const y = h - colH + 20;
                svgHtml += `<rect x="${x + colW*0.1}" y="${y}" width="${Math.max(colW * 0.8, 1)}" height="${colH}" fill="#28a745" rx="1">
                                <title>${k}: ${val.toLocaleString()} ₽</title>
                            </rect>`;
                if (keys.length < 15 || i % 4 === 0 || i === keys.length-1) {
                    svgHtml += `<text x="${x + colW/2}" y="${h + 35}" font-size="8" fill="#999" text-anchor="middle">${k}</text>`;
                }
            });
            svgHtml += `</svg>`;
            container.innerHTML = svgHtml;
        };

        const updateTable = () => {
            document.querySelectorAll('tr').forEach(row => {
                const cells = row.querySelectorAll('td');
                // Показываем рублёвые суммы только для разрешённых операций
                if (!isAllowedOperation(cells)) return;
                // Обрабатываем только 2-ю и 3-ю колонки (приход/расход $m), не баланс
                [1, 2].forEach(idx => {
                    const cell = cells[idx];
                    if (!cell) return;
                    const cellText = cell.innerText.trim();
                    // Только если ячейка содержит сумму вида '1.00$m [SM]', не описание
                    if (/^[\d.,]+\$m/.test(cellText) && !cell.querySelector('.sm-done')) {
                        const val = parseFloat(cellText.split('$')[0].replace(',', '.').replace(/[^\d.]/g, ''));
                        if (!isNaN(val)) {
                            const d = document.createElement('div');
                            d.className = 'sm-done';
                            d.style.cssText = 'color:#1976d2; font-weight:bold; font-size:0.85em; margin-top:2px;';
                            d.innerText = `(${(val * currentRate).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽)`;
                            cell.appendChild(d);
                        }
                    }
                });
            });
        };

        const parseRows = (doc) => {
            let found = [];
            doc.querySelectorAll('tr').forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 4) {
                    const txt = cells[1].innerText;
                    if (txt.includes('$m') && !txt.includes('-') && isAllowedOperation(cells)) {
                        const val = parseFloat(txt.split('$')[0].replace(',', '.').replace(/[^\d.]/g, ''));
                        const fullDate = cells[0].innerText.trim();
                        // Извлекаем тип операции из описания (до номера лота)
                        const desc = cells[3].innerText.trim();
                        const typeMatch = desc.match(/^([^\d#№]+)/);
                        const type = typeMatch ? typeMatch[1].trim() : desc;
                        if (!isNaN(val)) found.push({ id: fullDate + '_' + val, date: fullDate.split(' ')[0], sm: val, type: type });
                    }
                }
            });
            return found;
        };

        const renderInfo = (data) => {
            const todayStr = new Date().toLocaleDateString('ru-RU');
            const monthStr = todayStr.substring(3);
            const format = (v) => (v * currentRate).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});

            const daySM = data.filter(e => e.date === todayStr).reduce((a, b) => a + b.sm, 0);
            const monthSM = data.filter(e => e.date.endsWith(monthStr)).reduce((a, b) => a + b.sm, 0);
            const totalSM = data.reduce((a, b) => a + b.sm, 0);

            if (document.getElementById('sm-val-day')) {
                // Обновляем лейбл с актуальным курсом
                const rateLabel = document.querySelector('#sm-dashboard [style*="color:#888"]');
                if (rateLabel) rateLabel.innerText = `ЗА СЕГОДНЯ (Курс: ${currentRate})`;
                document.getElementById('sm-val-day').innerText = daySM.toFixed(2) + ' $m';
                document.getElementById('sm-val-day-rub').innerText = format(daySM) + ' ₽';
                document.getElementById('sm-val-month').innerText = monthSM.toFixed(2) + ' $m';
                document.getElementById('sm-val-month-rub').innerText = format(monthSM) + ' ₽';
                document.getElementById('sm-val-total').innerText = totalSM.toFixed(2) + ' $m';
                document.getElementById('sm-val-total-rub').innerText = format(totalSM) + ' ₽';
                drawChart(data);
                drawPrediction(data);
            }
        };

        // 3. AI-ПРОГНОЗ ПРИБЫЛИ
        const drawPrediction = (data) => {
            const container = document.getElementById('sm-prediction-box');
            if (!container) return;

            // Проверяем настройку показа прогноза и отрисовываем внутри коллбэка
            chrome.storage.local.get(['sm_settings'], function(result) {
                const s = result.sm_settings || {};
                if (s.show_prediction === false) {
                    container.style.display = 'none';
                    return;
                }
                container.style.display = 'block';

                if (data.length < 5) {
                    container.innerHTML = '<div style="font-size:11px; color:#999; text-align:center;">Недостаточно данных для прогноза</div>';
                    return;
                }

                const now = new Date();
                const currentMonth = now.getMonth() + 1;
                const currentYear = now.getFullYear();
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
                const today = now.getDate();
                const daysPassed = today;
                const daysRemaining = daysInMonth - today;

                // Группируем данные по месяцам для анализа истории
                const monthlyData = {};
                data.forEach(e => {
                    const [d, m, y] = e.date.split('.');
                    const key = `${m}.${y}`;
                    if (!monthlyData[key]) monthlyData[key] = 0;
                    monthlyData[key] += e.sm * currentRate;
                });

                // Считаем доход за текущий месяц
                let currentMonthTotal = 0;
                data.forEach(e => {
                    const [d, m, y] = e.date.split('.');
                    if (parseInt(m) === currentMonth && parseInt(y) === currentYear) {
                        currentMonthTotal += e.sm * currentRate;
                    }
                });

                // Считаем средний дневной доход в текущем месяце
                const dailyAvgCurrent = daysPassed > 0 ? currentMonthTotal / daysPassed : 0;

                // Анализируем аналогичные месяцы (те же номера месяцев в прошлые годы)
                const similarMonths = [];
                Object.entries(monthlyData).forEach(([key, value]) => {
                    const [m, y] = key.split('.').map(Number);
                    if (m === currentMonth && (y !== currentYear || daysPassed >= daysInMonth)) {
                        const monthDays = new Date(y, m, 0).getDate();
                        const avgDaily = value / monthDays;
                        similarMonths.push({ year: y, total: value, avgDaily });
                    }
                });

                // Рассчитываем прогноз несколькими методами и берём средневзвешенное значение
                const method1_currentTrend = currentMonthTotal + (dailyAvgCurrent * daysRemaining);
                let method2_historicalAvg = null;
                if (similarMonths.length > 0) {
                    const avgHistoricalDaily = similarMonths.reduce((sum, m) => sum + m.avgDaily, 0) / similarMonths.length;
                    method2_historicalAvg = currentMonthTotal + (avgHistoricalDaily * daysRemaining);
                }
                const method3_proportional = daysPassed > 0 ? (currentMonthTotal / daysPassed) * daysInMonth : 0;

                let predictedEndOfMonth;
                let predictionMethod;
                let confidence = 'средняя';
                let confidenceColor = '#ff9800';

                if (similarMonths.length >= 2 && method2_historicalAvg !== null) {
                    const weightCurrent = 0.4;
                    const weightHistorical = 0.6;
                    predictedEndOfMonth = (method1_currentTrend * weightCurrent) + (method2_historicalAvg * weightHistorical);
                    predictionMethod = 'на основе текущего месяца и истории';
                    confidence = 'высокая';
                    confidenceColor = '#28a745';
                } else if (daysPassed >= 5) {
                    predictedEndOfMonth = method1_currentTrend;
                    predictionMethod = 'на основе динамики текущего месяца';
                } else {
                    predictedEndOfMonth = method3_proportional;
                    predictionMethod = 'предварительный (мало данных)';
                    confidence = 'низкая';
                    confidenceColor = '#f44336';
                }

                predictedEndOfMonth = Math.max(0, predictedEndOfMonth);

                const trendIcon = predictedEndOfMonth > currentMonthTotal ? '↗' : predictedEndOfMonth < currentMonthTotal ? '↘' : '→';
                const additionalIncome = Math.max(0, predictedEndOfMonth - currentMonthTotal);

                container.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="font-size:12px; font-weight:bold; color:#666;">🤖 ПРОГНОЗ ДО КОНЦА МЕСЯЦА ${trendIcon}</div>
                        <div style="font-size:9px; color:${confidenceColor};">Достоверность: ${confidence}</div>
                    </div>
                    <div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:12px; border-radius:6px; text-align:center; margin-bottom:8px;">
                        <div style="font-size:10px; color:rgba(255,255,255,0.9);">Ожидаемый итог за ${currentMonth}.${currentYear}</div>
                        <div style="font-size:20px; font-weight:bold; color:#fff; margin-top:4px;">${predictedEndOfMonth.toLocaleString('ru-RU', {maximumFractionDigits: 0})} ₽</div>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                        <div style="background:#f8f9fa; padding:8px; border-radius:4px; text-align:center;">
                            <div style="font-size:9px; color:#666;">УЖЕ ЗАРАБОТАНО</div>
                            <div style="font-size:13px; font-weight:bold; color:#28a745;">${currentMonthTotal.toLocaleString('ru-RU', {maximumFractionDigits: 0})} ₽</div>
                        </div>
                        <div style="background:#f8f9fa; padding:8px; border-radius:4px; text-align:center;">
                            <div style="font-size:9px; color:#666;">ОЖИДАЕТСЯ (${daysRemaining} дн.)</div>
                            <div style="font-size:13px; font-weight:bold; color:#1976d2;">+${additionalIncome.toLocaleString('ru-RU', {maximumFractionDigits: 0})} ₽</div>
                        </div>
                    </div>
                    <div style="margin-top:6px; font-size:9px; color:#999; text-align:center;">
                        *Прогноз ${predictionMethod}${similarMonths.length > 0 ? ` (учтено ${similarMonths.length} похожих мес.)` : ''}
                    </div>
                `;
            });
        };

        const autoSync = () => {
            const current = parseRows(document);
            let combined = [...cachedStats];
            let changed = false;
            let newItems = [];
            current.forEach(r => {
                if (!combined.find(x => x.id === r.id)) { combined.push(r); changed = true; newItems.push(r); }
            });
            if (changed) {
                chrome.storage.local.set({ 'sm_all_stats': combined });
                cachedStats = combined;
                // Уведомление о новых транзакциях
                if (newItems.length > 0) {
                    chrome.runtime.sendMessage({
                        type: 'NEW_TRANSACTIONS',
                        transactions: newItems,
                        rate: currentRate
                    }).catch(() => {});
                }
            }
            renderInfo(cachedStats);
        };

        const collectHistory = async () => {
            const btn = document.getElementById('sm-load-btn');
            const status = document.getElementById('sm-status');
            const pages = parseInt(document.getElementById('sm-pages-input').value) || 1;
            btn.disabled = true;
            let results = [...cachedStats];

            for (let i = 1; i <= pages; i++) {
                status.innerText = `Стр. ${i}...`;
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.set('PAGEN_1', i);
                    const resp = await fetch(url.toString());
                    const buf = await resp.arrayBuffer();
                    const html = decodeResponse(buf);
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    parseRows(doc).forEach(r => {
                        if (!results.find(x => x.id === r.id)) results.push(r);
                    });
                    await new Promise(r => setTimeout(r, 200)); // Защита от 503
                } catch (e) {}
            }
            chrome.storage.local.set({ 'sm_all_stats': results }, () => {
                cachedStats = results;
                renderInfo(results);
                btn.disabled = false;
                status.innerText = '✅ Готово';
            });
        };

        // Тестовая функция для проверки уведомлений
        const testNotifications = () => {
            // Тест изменения курса
            chrome.runtime.sendMessage({
                type: 'RATE_UPDATED',
                rate: currentRate + Math.round(currentRate * 0.1) // +10%
            }).catch(() => {});

            // Тест новых транзакций
            setTimeout(() => {
                chrome.runtime.sendMessage({
                    type: 'NEW_TRANSACTIONS',
                    transactions: [
                        { sm: 5.00, type: 'Скачивание файла' },
                        { sm: 3.50, type: 'Платное скачивание файла' }
                    ],
                    rate: currentRate
                }).catch(() => {});
            }, 1000);
        };

        createDashboard();
        updateTable();
        autoSync();

        setInterval(() => {
            createDashboard();
            updateTable();
        }, 3000);
    }
}
});
