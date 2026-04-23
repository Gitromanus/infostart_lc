chrome.storage.local.get(['sm_rate', 'sm_all_stats'], function(result) {
    let currentRate = result.sm_rate || 167.06;
    let cachedStats = result.sm_all_stats || [];
    let currentView = 'month'; 
    
    const isTransact = window.location.href.includes('transact');
    const isStock = window.location.href.includes('stockexchange');

    // 1. ОБНОВЛЕНИЕ КУРСА С БИРЖИ
    if (isStock) {
        const updateRate = () => {
            const match = document.body.innerText.match(/Текущий:\s*([\d\s,.]+)\s*руб/i);
            if (match && match[1]) {
                const newRate = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
                if (!isNaN(newRate) && newRate !== currentRate) {
                    chrome.storage.local.set({ 'sm_rate': newRate });
                    currentRate = newRate;
                    console.log('Курс SM обновлен:', currentRate);
                }
            }
        };
        updateRate();
        setInterval(updateRate, 3000);
    }

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
                <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 15px;">
                    <div style="flex: 1; min-width: 140px; background:#fff; padding:10px; border-radius:6px; border:1px solid #eee;">
                        <div style="font-size:11px; color:#888;">ЗА СЕГОДНЯ (Курс: ${currentRate})</div>
                        <div id="sm-val-day" style="font-size:18px; font-weight:bold; color:#28a745;">0.00 $m</div>
                        <div id="sm-val-day-rub" style="color:#d32f2f; font-size:14px; font-weight:bold;">0.00 ₽</div>
                    </div>
                    <div style="flex: 1; min-width: 140px; background:#fff; padding:10px; border-radius:6px; border:1px solid #eee;">
                        <div style="font-size:11px; color:#888;">МЕСЯЦ</div>
                        <div id="sm-val-month" style="font-size:18px; font-weight:bold; color:#28a745;">0.00 $m</div>
                        <div id="sm-val-month-rub" style="color:#d32f2f; font-size:14px; font-weight:bold;">0.00 ₽</div>
                    </div>
                    <div style="flex: 1; min-width: 140px; background:#fff; padding:10px; border-radius:6px; border:1px solid #eee;">
                        <div style="font-size:11px; color:#888;">ОБЩИЙ ИТОГ</div>
                        <div id="sm-val-total" style="font-size:18px; font-weight:bold; color:#28a745;">0.00 $m</div>
                        <div id="sm-val-total-rub" style="color:#d32f2f; font-size:14px; font-weight:bold;">0.00 ₽</div>
                    </div>
                </div>
                
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

                <div id="sm-prediction-box" style="background:#fff; padding:15px; border:1px solid #eee; border-radius:6px; margin-bottom:15px;">
                    <div style="font-size:11px; color:#999; text-align:center;">Загрузка прогноза...</div>
                </div>

                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="number" id="sm-pages-input" value="10" style="width:50px; padding:3px;">
                    <button id="sm-load-btn" style="cursor:pointer; padding:6px 12px; background:#007bff; color:#fff; border:none; border-radius:4px;">Догрузить историю</button>
                    <span id="sm-status" style="font-size:12px; color:#999;"></span>
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
            document.querySelectorAll('td').forEach(cell => {
                if (cell.innerText.includes('$m') && !cell.innerText.includes('-') && !cell.querySelector('.sm-done')) {
                    const val = parseFloat(cell.innerText.split('$')[0].replace(',', '.').replace(/[^\d.]/g, ''));
                    if (!isNaN(val)) {
                        const d = document.createElement('div');
                        d.className = 'sm-done';
                        d.style.cssText = 'color:#d32f2f; font-weight:bold; font-size:0.85em; margin-top:2px;';
                        d.innerText = `(${(val * currentRate).toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽)`;
                        cell.appendChild(d);
                    }
                }
            });
        };

        const parseRows = (doc) => {
            let found = [];
            doc.querySelectorAll('tr').forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    const txt = cells[1].innerText;
                    if (txt.includes('$m') && !txt.includes('-')) {
                        const val = parseFloat(txt.split('$')[0].replace(',', '.').replace(/[^\d.]/g, ''));
                        const fullDate = cells[0].innerText.trim();
                        if (!isNaN(val)) found.push({ id: fullDate + '_' + val, date: fullDate.split(' ')[0], sm: val });
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
            const currentMonthKey = `${currentMonth}.${currentYear}`;
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
                    // Если это тот же месяц но прошлого года, учитываем только если прошло достаточно дней
                    const monthDays = new Date(y, m, 0).getDate();
                    const avgDaily = value / monthDays;
                    similarMonths.push({ year: y, total: value, avgDaily });
                }
            });

            // Рассчитываем прогноз несколькими методами и берём средневзвешенное значение
            
            // Метод 1: Экстраполяция текущего месяца
            const method1_currentTrend = currentMonthTotal + (dailyAvgCurrent * daysRemaining);
            
            // Метод 2: На основе средней динамики похожих месяцев
            let method2_historicalAvg = null;
            if (similarMonths.length > 0) {
                const avgHistoricalDaily = similarMonths.reduce((sum, m) => sum + m.avgDaily, 0) / similarMonths.length;
                method2_historicalAvg = currentMonthTotal + (avgHistoricalDaily * daysRemaining);
            }
            
            // Метод 3: Простое масштабирование (пропорция дней)
            const method3_proportional = daysPassed > 0 ? (currentMonthTotal / daysPassed) * daysInMonth : 0;

            // Выбираем метод или комбинируем
            let predictedEndOfMonth;
            let predictionMethod;
            let confidence = 'средняя';
            let confidenceColor = '#ff9800';

            if (similarMonths.length >= 2 && method2_historicalAvg !== null) {
                // Если есть история похожих месяцев, используем взвешенное среднее
                const weightCurrent = 0.4;
                const weightHistorical = 0.6;
                predictedEndOfMonth = (method1_currentTrend * weightCurrent) + (method2_historicalAvg * weightHistorical);
                predictionMethod = 'на основе текущего месяца и истории';
                confidence = 'высокая';
                confidenceColor = '#28a745';
            } else if (daysPassed >= 5) {
                // Если прошло достаточно дней в месяце, используем тренд текущего месяца
                predictedEndOfMonth = method1_currentTrend;
                predictionMethod = 'на основе динамики текущего месяца';
            } else {
                // Мало данных - используем пропорциональный метод
                predictedEndOfMonth = method3_proportional;
                predictionMethod = 'предварительный (мало данных)';
                confidence = 'низкая';
                confidenceColor = '#f44336';
            }

            predictedEndOfMonth = Math.max(0, predictedEndOfMonth);

            // Определяем тренд
            const trendIcon = predictedEndOfMonth > currentMonthTotal ? '↗' : predictedEndOfMonth < currentMonthTotal ? '↘' : '→';
            const trendText = predictedEndOfMonth > currentMonthTotal ? 'рост' : predictedEndOfMonth < currentMonthTotal ? 'снижение' : 'стабильно';
            const trendColor = predictedEndOfMonth > currentMonthTotal ? '#28a745' : predictedEndOfMonth < currentMonthTotal ? '#d32f2f' : '#999';

            // Прогнозируемый дополнительный доход до конца месяца
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
        };

        const autoSync = () => {
            const current = parseRows(document);
            let combined = [...cachedStats];
            let changed = false;
            current.forEach(r => {
                if (!combined.find(x => x.id === r.id)) { combined.push(r); changed = true; }
            });
            if (changed) {
                chrome.storage.local.set({ 'sm_all_stats': combined });
                cachedStats = combined;
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
                    const doc = new DOMParser().parseFromString(new TextDecoder('windows-1251').decode(buf), 'text/html');
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

        createDashboard();
        updateTable();
        autoSync();

        setInterval(() => {
            createDashboard();
            updateTable();
        }, 3000);
    }
});