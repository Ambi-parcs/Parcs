/* ============================================================
   app.js — роутер, отрисовка всех разделов, обработчики
   ============================================================ */

const App = (() => {
  let charts = []; // храним инстансы Chart.js для уничтожения

  // ---------- Утилиты ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fmtMoney = (n) => (n || 0).toLocaleString('ru-RU') + ' ₽';
  const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s); if (isNaN(d)) return s; return d.toLocaleDateString('ru-RU'); };
  const today = () => new Date().toISOString().slice(0, 10);
  function toast(msg, isError = false) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast', 2600);
  }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- Расчёт 3 критериев ----------
  // Возвращает {payments, schedule, quality}: 'ok'|'warn'|'bad'|'neutral'
  function calcCriteria(work) {
    const now = new Date();
    // 1. ПЛАТЕЖИ
    let payments = 'neutral';
    if (work.stage === 'done') {
      payments = (work.prepayPaid && work.finalPaid) ? 'ok' : 'warn';
    } else if (['prepay', 'doing', 'accept', 'final'].includes(work.stage)) {
      // должен быть внесён аванс
      payments = work.prepayPaid > 0 ? 'ok' : 'bad';
    } else if (work.stage === 'contract') {
      payments = 'neutral';
    }

    // 2. СРОКИ
    let schedule = 'neutral';
    if (work.deadline) {
      const dl = new Date(work.deadline);
      const daysLeft = Math.ceil((dl - now) / 86400000);
      if (daysLeft < 0 && work.stage !== 'done') schedule = 'bad';
      else if (daysLeft < 7 && work.stage !== 'done') schedule = 'warn';
      else schedule = 'ok';
    }

    // 3. КАЧЕСТВО
    let quality = 'neutral';
    if (work.stage === 'accept') quality = 'warn';
    if (work.stage === 'done') {
      if (work.qualityStatus === 'accepted') quality = work.quality >= 4 ? 'ok' : 'warn';
      else quality = 'bad';
    }
    return { payments, schedule, quality };
  }

  const CRIT_LABEL = { payments: '💳', schedule: '📅', quality: '✓' };

  // ============================================================
  // ИНИЦИАЛИЗАЦИЯ
  // ============================================================
  async function init() {
    await DB.open();
    await Seed.run(); // наполнить демо-данными, если пусто
    await migrateFilesFromContracts(); // перенести PDF-договоры в новое хранилище (v6)
    await clearWorksOnce(); // разовая очистка реестра работ (по запросу руководства)

    // Если уже есть сессия — показать приложение
    if (Auth.current()) showApp();

    // Форма входа
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await Auth.login($('#loginUser').value, $('#loginPass').value);
      if (res.ok) {
        $('#loginError').textContent = '';
        $('#loginForm').reset();
        showApp();
      } else {
        $('#loginError').textContent = res.error;
      }
    });

    $('#logoutBtn').addEventListener('click', () => { Auth.logout(); location.reload(); });
    window.addEventListener('hashchange', route);
    $('#modalClose').addEventListener('click', closeModal);
    $('.modal-backdrop').addEventListener('click', closeModal);
  }

  function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderUserBox();
    renderNavParks();
    // При входе сбрасываем на дашборд, чтобы управляющий не попал на чужой парк
    // по «зависшему» hash от предыдущей сессии.
    location.hash = '#/dashboard';
    route();
  }

  async function renderUserBox() {
    const s = Auth.current();
    $('#userBox').innerHTML = `<div class="user-name">${escapeHtml(s.name)}</div>
      <div class="user-role">${s.role === 'director' ? 'Гендиректор' : 'Управляющий парком'}</div>`;
  }

  async function renderNavParks() {
    let parks = await DB.getAll('parks');
    const filter = Auth.visibleParkFilter();
    if (filter) parks = parks.filter(p => p.id === filter);
    const works = await DB.getAll('works');
    const nav = parks.map(p => {
      const hasIssue = works.some(w => {
        if (w.parkId !== p.id) return false;
        const c = calcCriteria(w);
        return c.payments === 'bad' || c.schedule === 'bad' || c.quality === 'bad';
      });
      const idx = p.name.indexOf('\u00AB'); // символ «
      const shortName = idx >= 0 ? p.name.slice(idx) : p.name;
      return `<a href="#/park/${p.id}" class="nav-item park-item ${hasIssue ? 'has-issues' : ''}">
        <span class="park-dot"></span>${escapeHtml(shortName)}</a>`;
    }).join('');
    $('#navParks').innerHTML = nav;
  }

  // ============================================================
  // РОУТЕР
  // ============================================================
  async function route() {
    const hash = location.hash.slice(1) || '/dashboard';
    const parts = hash.split('/').filter(Boolean); // ['park', id]
    const view = $('#view');
    view.scrollTop = 0;
    destroyCharts();

    // Активный пункт меню
    document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));

    if (parts[0] === 'dashboard') return renderDashboard();
    if (parts[0] === 'board')     return renderBoard();
    if (parts[0] === 'park')      return renderPark(parts[1], parts[2]);
    if (parts[0] === 'storage') {
      // Поддерживаем: #/storage, #/storage/tag/<имя>
      const tag = parts[1] === 'tag' && parts[2] ? decodeURIComponent(parts[2]) : null;
      return renderStorage(tag);
    }
    if (parts[0] === 'settings')  return renderSettings();
  }

  // ============================================================
  // ДАШБОРД
  // ============================================================
  async function renderDashboard() {
    $('#viewTitle').textContent = Auth.isDirector() ? 'Дашборд — все парки' : 'Дашборд';
    $('#viewActions').innerHTML = Auth.isDirector()
      ? `<button class="btn btn-primary btn-sm" onclick="App.openNewPark()">＋ Новый парк</button>
         <button class="btn btn-ghost btn-sm" onclick="App.exportBackup()">⬇ Экспорт</button>`
      : '';
    setActiveNav('dashboard');

    let works = await DB.getAll('works');
    let parks = await DB.getAll('parks');
    const filter = Auth.visibleParkFilter();
    if (filter) {
      works = works.filter(w => w.parkId === filter);
      parks = parks.filter(p => p.id === filter);
    }

    let overduePay = 0, overdueSch = 0, qualityBad = 0, inProgress = 0, done = 0;
    works.forEach(w => {
      const c = calcCriteria(w);
      if (c.payments === 'bad') overduePay++;
      if (c.schedule === 'bad') overdueSch++;
      if (c.quality === 'bad') qualityBad++;
      if (w.stage === 'done') done++; else inProgress++;
    });

    const kpi = (label, val, sub, cls, onClick) =>
      `<div class="kpi ${cls||''} clickable" ${onClick?`onclick="${onClick}"`:''}>
        <div class="kpi-label">${label}</div><div class="kpi-value">${val}</div><div class="kpi-sub">${sub||''}</div></div>`;

    let html = `<div class="kpi-grid">
      ${kpi('Всего работ', works.length, `${parks.length} парков`, 'ok')}
      ${kpi('В работе', inProgress, `Завершено: ${done}`)}
      ${kpi('Просрочка платежей', overduePay, overduePay? 'требует внимания':'норма', overduePay?'bad':'ok')}
      ${kpi('Просрочка сроков', overdueSch, overdueSch? 'дедлайны горят':'норма', overdueSch?'bad':'ok')}
      ${kpi('Проблемы качества', qualityBad, qualityBad? 'есть замечания':'норма', qualityBad?'bad':'ok')}
    </div>`;

    // Карточки парков
    html += `<div class="section-title">🏪 Парки</div><div class="parks-grid">`;
    for (const p of parks) {
      const pw = works.filter(w => w.parkId === p.id);
      const pBad = pw.filter(w => { const c = calcCriteria(w); return c.payments==='bad'||c.schedule==='bad'||c.quality==='bad'; }).length;
      const pDone = pw.filter(w => w.stage === 'done').length;
      const budget = pw.reduce((s, w) => s + (w.amount || 0), 0);
      html += `<div class="park-card" onclick="location.hash='#/park/${p.id}'">
        <h3>${escapeHtml(p.name)} ${p.hasRestaurant?'<span class="park-badge">ресторан</span>':''}</h3>
        <div class="park-addr">${escapeHtml(p.address)}</div>
        <div class="park-stats">
          <div class="park-stat">Работ<b>${pw.length}</b></div>
          <div class="park-stat">Завершено<b>${pDone}</b></div>
          <div class="park-stat">Проблем<b style="color:${pBad?'var(--bad)':'var(--ok)'}">${pBad}</b></div>
          <div class="park-stat">Бюджет<b>${fmtMoney(budget)}</b></div>
        </div></div>`;
    }
    html += `</div>`;

    // Графики
    html += `<div class="section-title">📈 Аналитика</div><div class="charts-grid">
      <div class="chart-box"><h4>Работы по этапам</h4><canvas id="chartStages"></canvas></div>
      <div class="chart-box"><h4>Бюджет по паркам</h4><canvas id="chartBudget"></canvas></div>
    </div>`;
    $('#view').innerHTML = html;

    // График: работы по этапам
    const stagesCount = {};
    Seed.STAGES.forEach(s => stagesCount[s] = 0);
    works.forEach(w => stagesCount[w.stage] = (stagesCount[w.stage] || 0) + 1);
    drawChart('chartStages', 'bar', {
      labels: Seed.STAGES.map(s => Seed.STAGE_NAMES[s]),
      datasets: [{ label: 'Кол-во работ', data: Seed.STAGES.map(s => stagesCount[s]), backgroundColor: '#0f766e' }]
    }, { plugins: { legend: { display: false } } });

    // График: бюджет по паркам
    const budgetByPark = parks.map(p => works.filter(w => w.parkId === p.id).reduce((s, w) => s + (w.amount || 0), 0));
    drawChart('chartBudget', 'doughnut', {
      labels: parks.map(p => p.name),
      datasets: [{ data: budgetByPark, backgroundColor: ['#0f766e', '#0891b2', '#7c3aed', '#d97706', '#16a34a'] }]
    });
  }

  // ============================================================
  // КАНБАН — ЭТАПЫ РАБОТ
  // ============================================================
  async function renderBoard() {
    $('#viewTitle').textContent = 'Этапы работ';
    $('#viewActions').innerHTML = `<button class="btn btn-primary btn-sm" onclick="App.openNewWork()">＋ Новая работа</button>`;
    setActiveNav('board');

    const works = await DB.getAll('works');
    const parks = await DB.getAll('parks');
    const parkName = (id) => (parks.find(p => p.id === id) || {}).name || '—';
    const filter = Auth.visibleParkFilter();
    const visible = filter ? works.filter(w => w.parkId === filter) : works;

    let html = `<div class="board">`;
    for (const stage of Seed.STAGES) {
      const items = visible.filter(w => w.stage === stage);
      html += `<div class="column">
        <div class="column-head"><span class="col-name">${Seed.STAGE_NAMES[stage]}</span><span class="col-count">${items.length}</span></div>
        <div class="column-body">`;
      for (const w of items) {
        const c = calcCriteria(w);
        html += `<div class="card stage-${stage}" onclick="App.openWork('${w.id}')">
          <div class="card-title">${escapeHtml(w.title)}</div>
          <div class="card-park">${escapeHtml(parkName(w.parkId))}</div>
          <div class="card-amount">${fmtMoney(w.amount)}</div>
          <div class="crit-row">
            ${critBadge('payments', c.payments)}
            ${critBadge('schedule', c.schedule)}
            ${critBadge('quality', c.quality)}
          </div>
        </div>`;
      }
      html += `</div></div>`;
    }
    html += `</div>`;
    $('#view').innerHTML = html;
  }

  function critBadge(type, status) {
    const cls = status === 'ok' ? 'crit-ok' : status === 'warn' ? 'crit-warn' : status === 'bad' ? 'crit-bad' : 'crit-neutral';
    const txt = type === 'payments' ? 'Платежи' : type === 'schedule' ? 'Сроки' : 'Кач-во';
    return `<span class="crit ${cls}">${CRIT_LABEL[type]} ${txt}</span>`;
  }

  // ============================================================
  // ДЕТАЛЬ РАБОТЫ (модальное)
  // ============================================================
  async function openWork(id) {
    const w = await DB.getByKey('works', id);
    if (!w) return;
    const park = await DB.getByKey('parks', w.parkId);
    const contracts = await DB.getByIndex('contracts', 'parkId', w.parkId);
    const myContracts = contracts.filter(c => c.workId === w.id);
    const c = calcCriteria(w);

    const stageIdx = Seed.STAGES.indexOf(w.stage);
    let timeline = Seed.STAGES.map((s, i) => {
      const done = i < stageIdx;
      const current = i === stageIdx;
      const date = done && w.history ? (w.history.find(h => h.text && h.text.toLowerCase().includes(Seed.STAGE_NAMES[s].toLowerCase()))) : null;
      return `<div class="tl-step ${done?'done':''} ${current?'current':''}">
        <span class="tl-dot"></span><span class="tl-label">${Seed.STAGE_NAMES[s]}</span>
        <span class="tl-date">${date?fmtDate(date.date):''}</span></div>`;
    }).join('');

    const historyHtml = (w.history || []).slice().reverse().map(h =>
      `<div class="history-item"><b>${fmtDate(h.date)}</b> — ${escapeHtml(h.text)} <i>(${escapeHtml(h.who||'')})</i></div>`).join('');

    const contractHtml = myContracts.length
      ? myContracts.map(con => `<button class="btn btn-ghost btn-sm" onclick="location.hash='#/storage/${con.id}'">📄 ${escapeHtml(con.fileName||'Договор')}</button>`).join(' ')
      : `<span class="help">Договоров нет. Загрузите в разделе «Хранилище».</span>`;

    const body = `<div class="work-detail">
      <h4>${escapeHtml(w.title)}</h4>
      <div class="row">
        <div class="field"><label>Парк</label><div style="padding:9px 0">${escapeHtml(park?.name||'—')}</div></div>
        <div class="field"><label>Сумма</label><div style="padding:9px 0;font-weight:700">${fmtMoney(w.amount)}</div></div>
      </div>
      <div class="row">
        <div class="field"><label>Подрядчик</label><div style="padding:9px 0">${escapeHtml(w.contractor||'—')}</div></div>
        <div class="field"><label>№ договора</label><div style="padding:9px 0">${escapeHtml(w.contractNo||'—')}</div></div>
      </div>
      <div class="row">
        <div class="field"><label>Дедлайн</label><div style="padding:9px 0">${fmtDate(w.deadline)}</div></div>
        <div class="field"><label>3 критерия</label><div style="padding:9px 0">
          ${critBadge('payments', c.payments)} ${critBadge('schedule', c.schedule)} ${critBadge('quality', c.quality)}</div></div>
      </div>
      ${w.desc ? `<div class="field"><label>Описание проблемы</label><div class="help" style="font-size:13px;color:var(--ink)">${escapeHtml(w.desc)}</div></div>` : ''}
      <h4>Конвейер этапов</h4>
      <div class="timeline">${timeline}</div>
      <h4>Договоры</h4>
      <div>${contractHtml}</div>
      <h4>История изменений</h4>
      <div class="history-list">${historyHtml || '<div class="help">Пусто</div>'}</div>
    </div>`;

    // Кнопки: перевод на следующий этап + редактирование
    const isLast = stageIdx >= Seed.STAGES.length - 1;
    const footer = `
      <button class="btn btn-ghost" onclick="App.editWork('${w.id}')">✎ Редактировать</button>
      <button class="btn btn-primary" ${isLast?'disabled':''} onclick="App.advanceWork('${w.id}')">
        ${isLast ? 'Завершено' : '→ ' + Seed.STAGE_NAMES[Seed.STAGES[stageIdx+1]]}</button>`;
    openModal(w.title, body, footer, true);
  }

  // Перевод работы на следующий этап
  async function advanceWork(id) {
    const w = await DB.getByKey('works', id);
    const stageIdx = Seed.STAGES.indexOf(w.stage);
    if (stageIdx >= Seed.STAGES.length - 1) return;
    const next = Seed.STAGES[stageIdx + 1];
    w.stage = next;
    const who = Auth.current().name;
    if (!w.history) w.history = [];
    let text = `Переведено на этап: ${Seed.STAGE_NAMES[next]}`;
    // Особые случаи
    if (next === 'prepay' && w.prepayPaid) text += ` (аванс ${fmtMoney(w.prepayPaid)} внесён)`;
    if (next === 'final') text += ` (финальный платёж ${fmtMoney(w.finalPaid||0)})`;
    if (next === 'done') text += ` (качество: ${w.quality||'—'}/5)`;
    w.history.push({ text, date: today(), who, ts: Date.now() });
    await DB.put('works', w);
    closeModal();
    toast(`Этап: ${Seed.STAGE_NAMES[next]}`);
    route();
    renderNavParks();
  }

  // ============================================================
  // РЕДАКТИРОВАНИЕ / СОЗДАНИЕ РАБОТЫ
  // ============================================================
  async function editWork(id) {
    const w = await DB.getByKey('works', id);
    const parks = await DB.getAll('parks');
    const parkOpts = parks.map(p => `<option value="${p.id}" ${p.id===w.parkId?'selected':''}>${escapeHtml(p.name)}</option>`).join('');

    const body = `<div class="field"><label>Название работы</label>
        <input id="ed_title" value="${escapeHtml(w.title)}"></div>
      <div class="row">
        <div class="field"><label>Парк</label><select id="ed_park">${parkOpts}</select></div>
        <div class="field"><label>Сумма, ₽</label><input id="ed_amount" type="number" value="${w.amount||0}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Подрядчик</label><input id="ed_contractor" value="${escapeHtml(w.contractor||'')}"></div>
        <div class="field"><label>№ договора</label><input id="ed_contractNo" value="${escapeHtml(w.contractNo||'')}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Дедлайн</label><input id="ed_deadline" type="date" value="${w.deadline||''}"></div>
        <div class="field"><label>Этап</label><select id="ed_stage">${Seed.STAGES.map(s=>`<option value="${s}" ${s===w.stage?'selected':''}>${Seed.STAGE_NAMES[s]}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Аванс внесён, ₽</label><input id="ed_prepayPaid" type="number" value="${w.prepayPaid||0}"></div>
        <div class="field"><label>Финал. оплата, ₽</label><input id="ed_finalPaid" type="number" value="${w.finalPaid||0}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Качество (1-5)</label><input id="ed_quality" type="number" min="0" max="5" value="${w.quality||0}"></div>
        <div class="field"><label>Статус приёмки</label><select id="ed_qstatus">
          <option value="pending" ${w.qualityStatus==='pending'?'selected':''}>—</option>
          <option value="accepted" ${w.qualityStatus==='accepted'?'selected':''}>Принято</option>
          <option value="rejected" ${w.qualityStatus==='rejected'?'selected':''}>Не принято</option>
        </select></div>
      </div>
      <div class="field"><label>Описание</label><textarea id="ed_desc" rows="3">${escapeHtml(w.desc||'')}</textarea></div>`;

    const footer = `
      <button class="btn btn-danger" onclick="App.deleteWork('${w.id}')">🗑 Удалить</button>
      <button class="btn btn-ghost" onclick="App.openWork('${w.id}')">Отмена</button>
      <button class="btn btn-primary" onclick="App.saveWork('${w.id}')">Сохранить</button>`;
    openModal('Редактирование работы', body, footer);
  }

  async function saveWork(id) {
    const w = await DB.getByKey('works', id);
    const prev = { ...w };
    Object.assign(w, {
      title: $('#ed_title').value.trim(),
      parkId: $('#ed_park').value,
      amount: +$('#ed_amount').value || 0,
      contractor: $('#ed_contractor').value.trim(),
      contractNo: $('#ed_contractNo').value.trim(),
      deadline: $('#ed_deadline').value,
      stage: $('#ed_stage').value,
      prepayPaid: +$('#ed_prepayPaid').value || 0,
      finalPaid: +$('#ed_finalPaid').value || 0,
      quality: +$('#ed_quality').value || 0,
      qualityStatus: $('#ed_qstatus').value,
      desc: $('#ed_desc').value.trim(),
    });
    // Запись в историю заметных изменений
    const changes = [];
    if (prev.amount !== w.amount) changes.push(`Сумма: ${fmtMoney(prev.amount)} → ${fmtMoney(w.amount)}`);
    if (prev.stage !== w.stage) changes.push(`Этап: ${Seed.STAGE_NAMES[prev.stage]} → ${Seed.STAGE_NAMES[w.stage]}`);
    if (prev.deadline !== w.deadline) changes.push(`Дедлайн: ${fmtDate(prev.deadline)} → ${fmtDate(w.deadline)}`);
    if (prev.prepayPaid !== w.prepayPaid) changes.push(`Аванс: ${fmtMoney(prev.prepayPaid)} → ${fmtMoney(w.prepayPaid)}`);
    if (prev.finalPaid !== w.finalPaid) changes.push(`Финальная оплата: ${fmtMoney(prev.finalPaid)} → ${fmtMoney(w.finalPaid)}`);
    if (changes.length) {
      if (!w.history) w.history = [];
      w.history.push({ text: 'Изменения: ' + changes.join('; '), date: today(), who: Auth.current().name, ts: Date.now() });
    }
    await DB.put('works', w);
    toast('Сохранено');
    openWork(id);
    renderNavParks();
  }

  async function deleteWork(id) {
    if (!confirm('Удалить работу безвозвратно?')) return;
    await DB.remove('works', id);
    closeModal();
    toast('Удалено');
    route();
    renderNavParks();
  }

  async function openNewWork() {
    const parks = await DB.getAll('parks');
    const filter = Auth.visibleParkFilter();
    const parkOpts = parks.map(p => `<option value="${p.id}" ${p.id===filter?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
    const body = `<div class="field"><label>Название работы / проблема</label>
        <input id="nw_title" placeholder="Напр.: Замена канатов зиплайна"></div>
      <div class="row">
        <div class="field"><label>Парк</label><select id="nw_park">${parkOpts}</select></div>
        <div class="field"><label>Сумма, ₽ (ориентир)</label><input id="nw_amount" type="number" value="0"></div>
      </div>
      <div class="field"><label>Дедлайн</label><input id="nw_deadline" type="date"></div>
      <div class="field"><label>Описание проблемы</label><textarea id="nw_desc" rows="3"></textarea></div>`;
    const footer = `<button class="btn btn-ghost" onclick="App.closeModalFn()">Отмена</button>
      <button class="btn btn-primary" onclick="App.createWork()">Создать</button>`;
    openModal('Новая работа', body, footer);
  }

  async function createWork() {
    const w = {
      id: DB.uid(),
      title: $('#nw_title').value.trim(),
      parkId: $('#nw_park').value,
      amount: +$('#nw_amount').value || 0,
      deadline: $('#nw_deadline').value,
      desc: $('#nw_desc').value.trim(),
      stage: 'problem',
      contractor: '', contractNo: '', prepayPct: 30, prepayPaid: 0, finalPaid: 0,
      quality: 0, qualityStatus: 'pending',
      problemDate: today(),
      history: [{ text: 'Создана новая работа', date: today(), who: Auth.current().name, ts: Date.now() }],
      createdAt: Date.now(),
    };
    if (!w.title) { toast('Введите название', true); return; }
    await DB.put('works', w);
    closeModal();
    toast('Работа создана');
    route();
    renderNavParks();
  }

  // ============================================================
  // ДЕТАЛЬ ПАРКА + 4 РАЗРЕЗА
  // ============================================================
  async function renderPark(parkId, tab = 'board') {
    const park = await DB.getByKey('parks', parkId);
    if (!park) { $('#viewTitle').textContent = 'Парк не найден'; $('#view').innerHTML = ''; return; }
    setActiveNav(null);

    $('#viewTitle').textContent = park.name;
    // Кнопки: редактировать парк может директор или управляющий этого парка,
    // очистка работ — только директор
    const canEdit = canEditPark(park);
    const editBtn = canEdit
      ? `<button class="btn btn-ghost btn-sm" onclick="App.editPark('${park.id}')">✎ Редактировать парк</button>` : '';
    const clearBtn = Auth.isDirector()
      ? `<button class="btn btn-ghost btn-sm" onclick="App.clearParkWorks('${park.id}')">🧹 Очистить от работ</button>` : '';
    $('#viewActions').innerHTML = `${editBtn}${clearBtn}<button class="btn btn-primary btn-sm" onclick="App.openNewWork()">＋ Работа</button>`;

    const works = (await DB.getByIndex('works', 'parkId', parkId));
    const docs = await DB.getByIndex('documents', 'parkId', parkId);
    let eq_ = await DB.getByIndex('equipment', 'parkId', parkId);
    const pm_ = await DB.getByIndex('premises', 'parkId', parkId);
    const jr_ = await DB.getByIndex('journals', 'parkId', parkId);

    // Синхронизация: список оборудования = список аттракционов и зон из «Общих данных»
    eq_ = await syncEquipment(park, eq_);

    // Подсчёт «плохих» для бейджей
    const docBad = docs.filter(d => isDocExpired(d)).length;
    const eqBad = eq_.filter(e => e.status === 'repair' || e.status === 'in_repair').length;
    const pmBad = pm_.filter(p => p.status === 'bad').length;
    const jrBad = jr_.filter(j => j.status === 'bad').length;

    // По умолчанию (без указанной вкладки) — «Общие сведения»
    const activeTab = tab || 'info';

    const tabs = [
      ['info', 'ℹ️ Общие'],
      ['board', '📋 Работ', works.length],
      ['equipment', '🔧 Оборудование', eqBad],
      ['premises', '🏗 Помещения', pmBad],
      ['documents', '📜 Документы', docBad],
      ['journals', '📖 Журналы', jrBad],
    ];

    let html = `<div class="tabs">${tabs.map(([key, label, badge]) =>
      `<div class="tab ${activeTab===key?'active':''}" onclick="location.hash='#/park/${parkId}/${key}'">${label}${badge?`<span class="tab-badge">${badge}</span>`:''}</div>`).join('')}</div>`;

    if (activeTab === 'info') html += parkInfoTab(park, _parkInfoEditing === parkId);
    else if (activeTab === 'board') html += await parkWorksTab(works, parkId);
    else if (activeTab === 'equipment') html += equipmentTab(eq_, parkId, canEditPark(park));
    else if (activeTab === 'premises') html += premisesTab(pm_, parkId);
    else if (activeTab === 'documents') html += documentsTab(docs, parkId);
    else if (activeTab === 'journals') html += journalsTab(jr_, parkId);

    $('#view').innerHTML = html;
  }

  // Права на редактирование общих данных парка:
  // директор — любой парк, управляющий — только свой парк
  function canEditPark(park) {
    if (Auth.isDirector()) return true;
    const s = Auth.current();
    return !!(s && s.role === 'manager' && s.parkId === park.id);
  }

  let _parkInfoEditing = null;
  async function editParkInfo(parkId) {
    const park = await DB.getByKey('parks', parkId);
    if (!park || !canEditPark(park)) { toast('Нет прав на редактирование', true); return; }
    _parkInfoEditing = parkId;
    route();
  }
  function cancelParkInfoEdit() { _parkInfoEditing = null; route(); }

  // Поля общих данных парка: [ключ, подпись, тип]
  const PARK_INFO_FIELDS = [
    ['name', 'Название парка', 'text'],
    ['mall', 'ТРЦ / торговый центр', 'text'],
    ['city', 'Город', 'text'],
    ['address', 'Адрес', 'text'],
    ['metro', 'Метро', 'text'],
    ['floor', 'Этаж', 'text'],
    ['area', 'Площадь парка, м²', 'number'],
    ['restaurantArea', 'Площадь ресторана, м²', 'number'],
    ['opened', 'Год открытия', 'number'],
    ['hours', 'Часы работы', 'text'],
    ['managerName', 'Управляющий (ФИО)', 'text'],
    ['phone', 'Телефон', 'text'],
    ['email', 'Email', 'text'],
    ['site', 'Сайт', 'text'],
  ];

  // Вкладка «Общие сведения» — таблица; директор и управляющий парка могут редактировать
  function parkInfoTab(park, editMode = false) {
    const canEdit = canEditPark(park);
    const headBtns = canEdit
      ? (editMode
        ? `<button class="btn btn-ghost btn-sm" onclick="App.cancelParkInfoEdit()">Отмена</button>
           <button class="btn btn-primary btn-sm" onclick="App.saveParkInfo('${park.id}')">💾 Сохранить</button>`
        : `<button class="btn btn-primary btn-sm" onclick="App.editParkInfo('${park.id}')">✎ Редактировать</button>`)
      : '';

    if (editMode && canEdit) {
      const rows = PARK_INFO_FIELDS.map(([key, label, type]) =>
        `<tr><td class="pi-label">${label}</td>
           <td><input class="pi-input" id="pi_${key}" type="${type}" value="${escapeAttr(park[key] ?? '')}"></td></tr>`).join('');
      const attrStr = (park.attractions || []).join('\n');
      return `<div class="park-info">
        <div class="park-info-header">
          <div><h3>Общие данные — редактирование</h3>
          <div class="park-info-sub">Заполните или исправьте данные и нажмите «Сохранить»</div></div>
          <div style="display:flex;gap:8px">${headBtns}</div>
        </div>
        <table class="table info-table"><tbody>
          ${rows}
          <tr><td class="pi-label">Ресторан</td>
            <td><select class="pi-input" id="pi_hasRestaurant">
              <option value="true" ${park.hasRestaurant ? 'selected' : ''}>Есть</option>
              <option value="false" ${!park.hasRestaurant ? 'selected' : ''}>Нет</option>
            </select></td></tr>
          <tr><td class="pi-label">Бренд ресторана</td>
            <td><input class="pi-input" id="pi_restaurantBrand" value="${escapeAttr(park.restaurantBrand || '')}"></td></tr>
          <tr><td class="pi-label">Аттракционы и зоны<br><span class="help">по одному на строку</span></td>
            <td><textarea class="pi-input" id="pi_attractions" rows="4">${escapeHtml(attrStr)}</textarea></td></tr>
          <tr><td class="pi-label">Описание</td>
            <td><textarea class="pi-input" id="pi_description" rows="3">${escapeHtml(park.description || '')}</textarea></td></tr>
        </tbody></table>
      </div>`;
    }

    const attrs = (park.attractions || []).map(x => `<span class="chip">${escapeHtml(x)}</span>`).join('');
    const val = (v, suffix) => (v === null || v === undefined || v === '') ? '<span class="pi-empty">— не заполнено —</span>' : escapeHtml(String(v)) + (suffix || '');
    const rows = PARK_INFO_FIELDS.map(([key, label]) =>
      `<tr><td class="pi-label">${label}</td>
         <td>${val(park[key], (key === 'area' || key === 'restaurantArea') && park[key] ? ' м²' : '')}</td></tr>`).join('');
    return `<div class="park-info">
      <div class="park-info-header">
        <div>
          <h3>${escapeHtml(park.name)}</h3>
          <div class="park-info-sub">${escapeHtml(park.mall || '')}${park.city ? ', ' + escapeHtml(park.city) : ''}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${park.hasRestaurant ? `<span class="park-badge">ресторан ${escapeHtml(park.restaurantBrand || '')}</span>` : `<span class="park-badge gray">без ресторана</span>`}
          ${headBtns}
        </div>
      </div>
      <table class="table info-table"><tbody>
        ${rows}
        <tr><td class="pi-label">Ресторан</td>
          <td>${park.hasRestaurant ? 'Есть' + (park.restaurantBrand ? ' (' + escapeHtml(park.restaurantBrand) + ')' : '') : 'Нет'}</td></tr>
        ${park.description ? `<tr><td class="pi-label">Описание</td><td>${escapeHtml(park.description)}</td></tr>` : ''}
      </tbody></table>
      ${attrs ? `<div class="section-title">🎢 Аттракционы и зоны</div><div class="chips">${attrs}</div>` : ''}
    </div>`;
  }

  // Сохранение общих данных из таблицы
  async function saveParkInfo(parkId) {
    const park = await DB.getByKey('parks', parkId);
    if (!park || !canEditPark(park)) { toast('Нет прав на редактирование', true); return; }
    const g = (id) => document.getElementById(id);
    const name = g('pi_name').value.trim();
    if (!name) { toast('Название парка не может быть пустым', true); return; }
    PARK_INFO_FIELDS.forEach(([key, , type]) => {
      const v = g('pi_' + key).value.trim();
      park[key] = type === 'number' ? (+v || null) : v;
    });
    park.hasRestaurant = g('pi_hasRestaurant').value === 'true';
    park.restaurantBrand = g('pi_restaurantBrand').value.trim();
    park.attractions = g('pi_attractions').value.split('\n').map(s => s.trim()).filter(Boolean);
    park.description = g('pi_description').value.trim();
    await DB.put('parks', park);
    _parkInfoEditing = null;
    toast('Общие данные сохранены');
    route();
  }

  // ============ СОЗДАНИЕ / РЕДАКТИРОВАНИЕ ПАРКА ============
  function editPark(id) {
    DB.getByKey('parks', id).then(park => {
      if (!park) return;
      if (!canEditPark(park)) { toast('Нет прав на редактирование', true); return; }
      openParkForm('Редактирование парка', park);
    });
  }

  function openNewPark() {
    if (!Auth.isDirector()) { toast('Только директор может создавать парки', true); return; }
    openParkForm('Новый парк', {});
  }

  function openParkForm(title, park) {
    const p = park || {};
    const attrStr = (p.attractions || []).join('\n');
    const body = `<div class="field"><label>Название парка *</label>
        <input id="pk_name" value="${escapeAttr(p.name||'')}" placeholder="Парк «Название»"></div>
      <div class="row">
        <div class="field"><label>ТРЦ / торговый центр</label><input id="pk_mall" value="${escapeAttr(p.mall||'')}"></div>
        <div class="field"><label>Город</label><input id="pk_city" value="${escapeAttr(p.city||'Москва')}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Адрес</label><input id="pk_address" value="${escapeAttr(p.address||'')}"></div>
        <div class="field"><label>Метро</label><input id="pk_metro" value="${escapeAttr(p.metro||'')}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Этаж</label><input id="pk_floor" value="${escapeAttr(p.floor||'')}"></div>
        <div class="field"><label>Площадь парка, м²</label><input id="pk_area" type="number" value="${p.area||''}"></div>
        <div class="field"><label>Площадь ресторана, м²</label><input id="pk_restaurantArea" type="number" value="${p.restaurantArea||''}"></div>
        <div class="field"><label>Год открытия</label><input id="pk_opened" type="number" value="${p.opened||''}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Часы работы</label><input id="pk_hours" value="${escapeAttr(p.hours||'10:00–22:00')}"></div>
        <div class="field"><label>Управляющий (ФИО)</label><input id="pk_managerName" value="${escapeAttr(p.managerName||'')}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Телефон</label><input id="pk_phone" value="${escapeAttr(p.phone||'')}"></div>
        <div class="field"><label>Email</label><input id="pk_email" value="${escapeAttr(p.email||'')}"></div>
        <div class="field"><label>Сайт</label><input id="pk_site" value="${escapeAttr(p.site||'')}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Ресторан</label><select id="pk_hasRestaurant">
          <option value="true" ${p.hasRestaurant?'selected':''}>Есть</option>
          <option value="false" ${!p.hasRestaurant?'selected':''}>Нет</option>
        </select></div>
        <div class="field"><label>Бренд ресторана</label><input id="pk_restaurantBrand" value="${escapeAttr(p.restaurantBrand||'')}"></div>
      </div>
      <div class="field"><label>Аттракционы и зоны</label>
        <textarea id="pk_attractions" rows="4" placeholder="По одному на строку:&#10;Скалодром&#10;Батутные зоны&#10;Горки">${escapeHtml(attrStr)}</textarea>
        <div class="help">По одному аттракциону на строку</div></div>
      <div class="field"><label>Описание</label><textarea id="pk_description" rows="3">${escapeHtml(p.description||'')}</textarea></div>`;

    const footer = `
      ${p.id && Auth.isDirector() ? `<button class="btn btn-danger" onclick="App.deletePark('${p.id}')">🗑 Удалить парк</button>`:''}
      <button class="btn btn-ghost" onclick="App.closeModalFn()">Отмена</button>
      <button class="btn btn-primary" onclick="App.savePark('${p.id||''}')">Сохранить</button>`;
    openModal(title, body, footer, true);
  }

  async function savePark(id) {
    const name = $('#pk_name').value.trim();
    if (!name) { toast('Введите название парка', true); return; }
    const existing = id ? await DB.getByKey('parks', id) : {};
    const data = {
      ...existing,
      name,
      mall: $('#pk_mall').value.trim(),
      city: $('#pk_city').value.trim(),
      address: $('#pk_address').value.trim(),
      metro: $('#pk_metro').value.trim(),
      floor: $('#pk_floor').value.trim(),
      area: +$('#pk_area').value || null,
      restaurantArea: +$('#pk_restaurantArea').value || null,
      opened: +$('#pk_opened').value || null,
      hours: $('#pk_hours').value.trim(),
      managerName: $('#pk_managerName').value.trim(),
      phone: $('#pk_phone').value.trim(),
      email: $('#pk_email').value.trim(),
      site: $('#pk_site').value.trim(),
      hasRestaurant: $('#pk_hasRestaurant').value === 'true',
      restaurantBrand: $('#pk_restaurantBrand').value.trim(),
      attractions: $('#pk_attractions').value.split('\n').map(s=>s.trim()).filter(Boolean),
      description: $('#pk_description').value.trim(),
    };
    await DB.put('parks', data);
    closeModal();
    toast(id ? 'Парк обновлён' : 'Парк создан');
    await renderNavParks();
    if (id) route(); else location.hash = '#/dashboard';
  }

  async function deletePark(id) {
    const works = await DB.getByIndex('works', 'parkId', id);
    if (works.length) { toast('Сначала удалите '+works.length+' работ парка', true); return; }
    if (!confirm('Удалить парк безвозвратно?')) return;
    await DB.remove('parks', id);
    closeModal();
    toast('Парк удалён');
    await renderNavParks();
    location.hash = '#/dashboard';
  }

  function escapeAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

  // Очистка парка от всех работ (+ связанных договоров и PDF-файлов).
  // Сам парк, оборудование, помещения, документы и журналы остаются.
  async function clearParkWorks(parkId) {
    if (!Auth.isDirector()) { toast('Только директор может очищать работы', true); return; }
    const works = await DB.getByIndex('works', 'parkId', parkId);
    if (!works.length) { toast('В парке нет работ'); return; }

    // Посчитаем связанные договоры и файлы для информативного подтверждения
    const contracts = await DB.getByIndex('contracts', 'parkId', parkId);
    const linkedContracts = contracts.filter(c => c.workId && works.some(w => w.id === c.workId));
    let linkedFiles = 0;
    for (const c of linkedContracts) linkedFiles += (await DB.getFilesByContract(c.id)).length;

    const who = Auth.current().name;
    const park = await DB.getByKey('parks', parkId);
    const detail = [
      `работ: ${works.length}`,
      linkedContracts.length ? `договоров: ${linkedContracts.length}` : null,
      linkedFiles ? `PDF-файлов: ${linkedFiles}` : null,
    ].filter(Boolean).join(', ');
    if (!confirm(`Очистить парк «${park?.name||''}» от работ?\n\nБудет удалено: ${detail}.\n\nСам парк и карточки (оборудование, документы и т.д.) останутся. Действие необратимо.`)) return;

    // Удаляем работы
    for (const w of works) await DB.remove('works', w.id);
    // Удаляем связанные договоры и их PDF-файлы
    for (const c of linkedContracts) {
      const files = await DB.getFilesByContract(c.id);
      for (const f of files) await DB.deleteFile(f.id);
      await DB.remove('contracts', c.id);
    }
    toast(`Парк очищен: удалено работ — ${works.length}`);
    route();
    renderNavParks();
  }

  async function parkWorksTab(works, parkId) {
    if (!works.length) return emptyState('Работ нет', '＋ Новая работа', `App.openNewWork()`);
    let html = `<div class="board">`;
    for (const stage of Seed.STAGES) {
      const items = works.filter(w => w.stage === stage);
      html += `<div class="column"><div class="column-head"><span class="col-name">${Seed.STAGE_NAMES[stage]}</span><span class="col-count">${items.length}</span></div><div class="column-body">`;
      for (const w of items) {
        const c = calcCriteria(w);
        html += `<div class="card stage-${stage}" onclick="App.openWork('${w.id}')">
          <div class="card-title">${escapeHtml(w.title)}</div><div class="card-amount">${fmtMoney(w.amount)}</div>
          <div class="crit-row">${critBadge('payments',c.payments)}${critBadge('schedule',c.schedule)}${critBadge('quality',c.quality)}</div></div>`;
      }
      html += `</div></div>`;
    }
    return html + `</div>`;
  }

  // Статусы оборудования (аттракционов и зон)
  const EQ_STATUS = {
    ok:        { label: 'Работает',           cls: 'status-ok' },
    repair:    { label: 'Требует ремонта',    cls: 'status-bad' },
    in_repair: { label: 'В процессе ремонта', cls: 'status-warn' },
  };
  // Миграция старых статусов демо-данных в новые
  const EQ_STATUS_LEGACY = { service: 'in_repair', trouble: 'repair', broken: 'repair' };
  function eqStatus(e) { return EQ_STATUS[e.status] ? e.status : (EQ_STATUS_LEGACY[e.status] || 'ok'); }

  // Синхронизация оборудования с перечнем «Аттракционы и зоны» из общих данных:
  // новые позиции добавляются со статусом «Работает», убранные из перечня — удаляются
  async function syncEquipment(park, items) {
    const names = (park.attractions || []).map(s => s.trim()).filter(Boolean);
    let changed = false;
    // удалить позиции, которых больше нет в перечне
    for (const e of items.filter(e => !names.includes(e.name))) {
      await DB.remove('equipment', e.id);
      changed = true;
    }
    let list = items.filter(e => names.includes(e.name));
    // добавить новые позиции из перечня
    for (const n of names) {
      const existing = list.filter(e => e.name === n);
      if (existing.length) {
        // дубликаты одной позиции (из старых данных) — удаляем лишние
        for (const dup of existing.slice(1)) { await DB.remove('equipment', dup.id); changed = true; }
        if (existing.length > 1) list = list.filter(e => e.name !== n || e.id === existing[0].id);
        continue;
      }
      const rec = { id: DB.uid(), parkId: park.id, name: n, status: 'ok' };
      await DB.put('equipment', rec);
      list.push(rec);
      changed = true;
    }
    // сохранить порядок перечня
    list.sort((x, y) => names.indexOf(x.name) - names.indexOf(y.name));
    return list;
  }

  function equipmentTab(items, parkId, canEdit) {
    if (!items.length) return emptyState('Перечень пуст — добавьте аттракционы и зоны во вкладке «Общие»');
    const rows = items.map(e => {
      const st = eqStatus(e);
      const statusCell = canEdit
        ? `<select class="pi-input eq-status" data-id="${e.id}" onchange="App.saveEquipmentStatus('${e.id}', this.value)">
            ${Object.entries(EQ_STATUS).map(([k, v]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>`
        : `<span class="status-pill ${EQ_STATUS[st].cls}">${EQ_STATUS[st].label}</span>`;
      return `<tr><td><b>${escapeHtml(e.name)}</b></td><td>${statusCell}</td></tr>`;
    }).join('');
    const head = canEdit
      ? `<div class="help" style="margin:0 0 10px">Список формируется из перечня «Аттракционы и зоны» во вкладке «Общие». Меняйте статус прямо в таблице — сохранение сразу.</div>` : '';
    return head + `<table class="table"><thead><tr><th>Оборудование / зона</th><th style="width:230px">Состояние</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function saveEquipmentStatus(id, status) {
    const e = await DB.getByKey('equipment', id);
    if (!e) return;
    const park = await DB.getByKey('parks', e.parkId);
    if (!park || !canEditPark(park)) { toast('Нет прав на изменение', true); return; }
    e.status = status;
    await DB.put('equipment', e);
    toast('Статус обновлён: ' + (EQ_STATUS[status] || {}).label);
    route(); // перерисовать бейджи вкладок
  }

  function premisesTab(items) {
    if (!items.length) return emptyState('Помещения не добавлены');
    const cls = { ok:'status-ok', warn:'status-warn', bad:'status-bad' };
    const lbl = { ok:'Норма', warn:'Внимание', bad:'Проблема' };
    return `<table class="table"><thead><tr><th>Помещение</th><th>Статус</th><th>Примечание</th></tr></thead><tbody>
      ${items.map(p => `<tr><td><b>${escapeHtml(p.name)}</b></td>
        <td><span class="status-pill ${cls[p.status]||''}">${lbl[p.status]||p.status}</span></td>
        <td>${escapeHtml(p.note||'')}</td></tr>`).join('')}
    </tbody></table>`;
  }

  function documentsTab(items) {
    if (!items.length) return emptyState('Документы не добавлены');
    const cls = { ok:'status-ok', warn:'status-warn', bad:'status-bad' };
    return `<table class="table"><thead><tr><th>Документ</th><th>Действует до</th><th>Статус</th></tr></thead><tbody>
      ${items.map(d => { const s = docStatus(d); return `<tr><td><b>${escapeHtml(d.name)}</b></td>
        <td>${fmtDate(d.validTo)}</td>
        <td><span class="status-pill ${cls[s]}">${docStatusLabel(d, s)}</span></td></tr>`; }).join('')}
    </tbody></table>`;
  }

  function journalsTab(items) {
    if (!items.length) return emptyState('Журналы не добавлены');
    const cls = { ok:'status-ok', warn:'status-warn', bad:'status-bad' };
    const lbl = { ok:'Актуален', warn:'Проверить', bad:'Просрочен' };
    return `<table class="table"><thead><tr><th>Журнал</th><th>Статус</th><th>Последняя запись</th></tr></thead><tbody>
      ${items.map(j => `<tr><td><b>${escapeHtml(j.name)}</b></td>
        <td><span class="status-pill ${cls[j.status]||''}">${lbl[j.status]||j.status}</span></td>
        <td>${fmtDate(j.lastEntry)}</td></tr>`).join('')}
    </tbody></table>`;
  }

  function isDocExpired(d) {
    if (!d.validTo) return false;
    const days = (new Date(d.validTo) - new Date()) / 86400000;
    return days < 0; // полностью истёк
  }
  function docStatus(d) {
    if (!d.validTo) return 'ok';
    const days = (new Date(d.validTo) - new Date()) / 86400000;
    if (days < 0) return 'bad';
    if (days < 30) return 'warn';
    return 'ok';
  }
  function docStatusLabel(d, s) {
    if (s === 'bad') return 'Просрочен';
    if (s === 'warn') return 'Истекает скоро';
    return 'Действует';
  }

  // ============================================================
  // ХРАНИЛИЩЕ + ЗАГРУЗКА PDF
  // ============================================================

  // ---- Утилиты для произвольных файлов (store "files") ----
  const TAGS_KEY = 'parks_tags';
  const MIGRATION_FLAG = 'files_migrated_v6';

  // Расширение имени файла без точки, в нижнем регистре
  function fileExt(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  // Иконка + цвет по типу/расширению файла
  function fileVisual(rec) {
    const t = (rec.type || '').toLowerCase();
    const ext = rec.ext || fileExt(rec.name);
    if (t.startsWith('image/')) return { icon: '🖼️', cls: 'ft-image' };
    if (t === 'application/pdf' || ext === 'pdf') return { icon: '📄', cls: 'ft-pdf' };
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || t.includes('spreadsheet') || t.includes('excel'))
      return { icon: '📊', cls: 'ft-sheet' };
    if (['doc', 'docx', 'odt', 'rtf'].includes(ext) || t.includes('word') || t.includes('document'))
      return { icon: '📝', cls: 'ft-doc' };
    if (['ppt', 'pptx', 'odp'].includes(ext) || t.includes('presentation'))
      return { icon: '📑', cls: 'ft-slide' };
    if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return { icon: '🗜️', cls: 'ft-arch' };
    if (t.startsWith('audio/')) return { icon: '🎵', cls: 'ft-audio' };
    if (t.startsWith('video/')) return { icon: '🎬', cls: 'ft-video' };
    if (['txt', 'md', 'json', 'xml', 'js', 'py', 'html', 'css'].includes(ext) || t.startsWith('text/'))
      return { icon: '📃', cls: 'ft-text' };
    return { icon: '📦', cls: 'ft-other' };
  }

  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' КБ';
    return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
  }

  // Справочник тегов в localStorage
  function getTagsCatalog() {
    try { return JSON.parse(localStorage.getItem(TAGS_KEY)) || []; }
    catch { return []; }
  }
  function saveTagsCatalog(tags) {
    const set = [...new Set(tags.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    localStorage.setItem(TAGS_KEY, JSON.stringify(set));
    return set;
  }
  function rememberTags(tags) {
    const cur = getTagsCatalog();
    saveTagsCatalog([...cur, ...tags]);
  }

  // Определить цвет тега по хешу строки (детерминированный, стабильный)
  const TAG_COLORS = ['tg-brand', 'tg-blue', 'tg-green', 'tg-amber', 'tg-violet'];
  function tagColor(tag) {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
  }

  // Одноразовая миграция: PDF-договоры из contractFiles → files (тег «Договор»)
  // Разовая очистка реестра работ и связанных договоров (по запросу руководства).
  // Срабатывает один раз на каждый браузер (флаг в localStorage).
  async function clearWorksOnce() {
    const FLAG = 'ambi_works_cleared_v1';
    if (localStorage.getItem(FLAG)) return;
    await DB.clear('works');
    await DB.clear('contracts');
    await DB.clear('contractFiles');
    localStorage.setItem(FLAG, '1');
  }

  async function migrateFilesFromContracts() {
    if (localStorage.getItem(MIGRATION_FLAG)) return;
    try {
      const existing = await DB.getAll('contractFiles');
      for (const f of existing) {
        // пропускаем дубли (на случай повторного запуска)
        const dup = (await DB.getAllFiles()).some(x => x.id === ('cf_' + f.id) || (x.name === f.name && x.size === f.size && (x.tags || []).includes('Договор')));
        if (dup) continue;
        await DB.saveFileRecord({
          id: 'cf_' + f.id,
          name: f.name,
          size: f.size,
          type: f.type || 'application/pdf',
          ext: 'pdf',
          tags: ['Договор'],
          note: f.contractId ? `Перенесён из договоров (id ${f.contractId})` : '',
          uploadedAt: f.uploadedAt || Date.now(),
        }, f.blob);
      }
      rememberTags(['Договор']);
      localStorage.setItem(MIGRATION_FLAG, '1');
    } catch (err) {
      console.warn('files migration skipped:', err);
    }
  }

  let _fileSearch = '';

  async function renderStorage(tag = null) {
    $('#viewTitle').textContent = 'Хранилище файлов';
    $('#viewActions').innerHTML =
      `<button class="btn btn-ghost btn-sm" onclick="App.uploadContract()">📄 Договор PDF</button>
       <button class="btn btn-primary btn-sm" onclick="App.uploadFile()">⬆ Загрузить файл</button>`;
    setActiveNav('storage');

    const all = (await DB.getAllFiles())
      .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));

    // Облако тегов (считаем по всем файлам, без учёта поиска)
    const tagCounts = {};
    all.forEach(f => (f.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
    const catalog = getTagsCatalog();
    const allTags = [...new Set([...Object.keys(tagCounts), ...catalog])]
      .sort((a, b) => a.localeCompare(b, 'ru'));

    const tagBar = allTags.length
      ? allTags.map(t => `<button class="tag-chip ${tagColor(t)} ${tag === t ? 'active' : ''}"
            onclick="location.hash='#/storage/tag/${encodeURIComponent(t)}'">
            <span class="tag-hash">#</span>${escapeHtml(t)}
            <span class="tag-count">${tagCounts[t] || 0}</span></button>`).join('')
      : `<div class="help">Тегов пока нет. Они появятся при загрузке файлов.</div>`;

    // Фильтрация: по тегу + по строке поиска
    let view = all;
    if (tag) view = view.filter(f => (f.tags || []).includes(tag));
    if (_fileSearch) {
      const q = _fileSearch.toLowerCase();
      view = view.filter(f => (f.name || '').toLowerCase().includes(q)
        || (f.tags || []).some(t => t.toLowerCase().includes(q))
        || (f.note || '').toLowerCase().includes(q));
    }

    const cards = view.length
      ? view.map(f => {
          const v = fileVisual(f);
          const tags = (f.tags || []).map(t =>
            `<span class="tag-chip ${tagColor(t)} sm" onclick="event.stopPropagation();location.hash='#/storage/tag/${encodeURIComponent(t)}'">#${escapeHtml(t)}</span>`).join('');
          return `<div class="file-card ${v.cls}" onclick="App.openFile('${f.id}')">
            <div class="file-icon">${v.icon}</div>
            <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="file-meta">${humanSize(f.size)} • ${fmtDate(new Date(f.uploadedAt || Date.now()).toISOString())}</div>
            ${tags ? `<div class="file-tags">${tags}</div>` : ''}
          </div>`;
        }).join('')
      : `<div class="empty" style="grid-column:1/-1">
           <div class="empty-icon">📁</div>
           ${all.length ? 'Ничего не найдено по фильтру.' : 'Файлов пока нет.'}
           ${all.length ? '' : '<button class="btn btn-primary" style="margin-top:12px" onclick="App.uploadFile()">⬆ Загрузить первый файл</button>'}
         </div>`;

    const totalInfo = `Всего: <b>${all.length}</b>${tag ? ` • фильтр: <b>#${escapeHtml(tag)}</b>` : ''}${view.length !== all.length ? ` • показано: ${view.length}` : ''}`;

    $('#view').innerHTML = `<div class="storage-files">
      <div class="tag-bar">
        <div class="tag-bar-title">🏷 Теги</div>
        <div class="chips">${tagBar}</div>
        ${tag ? `<button class="btn btn-ghost btn-sm" onclick="location.hash='#/storage'">✕ сбросить фильтр</button>` : ''}
      </div>
      <div class="files-main">
        <div class="files-toolbar">
          <input type="search" class="file-search" id="fileSearch" placeholder="🔍 Поиск по имени, тегу, описанию…"
            value="${escapeHtml(_fileSearch)}" oninput="App.onFileSearch(this.value)">
          <div class="help">${totalInfo}</div>
        </div>
        <div class="files-grid">${cards}</div>
      </div>
    </div>`;

    const si = $('#fileSearch');
    if (si && _fileSearch) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
  }

  function onFileSearch(q) {
    _fileSearch = q;
    const grid = $('.files-grid');
    // Лёгкая перерисовка без полного route (сохраняем фокус в поле)
    if (!grid) return;
    // Перерисуем через route только если нужно обновить счётчики; здесь — локальный фильтр
    renderStorageFilesOnly();
  }

  async function renderStorageFilesOnly() {
    const all = (await DB.getAllFiles()).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    const hashParts = location.hash.slice(1).split('/').filter(Boolean);
    const tag = hashParts[1] === 'tag' && hashParts[2] ? decodeURIComponent(hashParts[2]) : null;
    let view = all;
    if (tag) view = view.filter(f => (f.tags || []).includes(tag));
    if (_fileSearch) {
      const q = _fileSearch.toLowerCase();
      view = view.filter(f => (f.name || '').toLowerCase().includes(q)
        || (f.tags || []).some(t => t.toLowerCase().includes(q))
        || (f.note || '').toLowerCase().includes(q));
    }
    const grid = $('.files-grid');
    if (!grid) return;
    grid.innerHTML = view.length
      ? view.map(f => {
          const v = fileVisual(f);
          const tags = (f.tags || []).map(t =>
            `<span class="tag-chip ${tagColor(t)} sm" onclick="event.stopPropagation();location.hash='#/storage/tag/${encodeURIComponent(t)}'">#${escapeHtml(t)}</span>`).join('');
          return `<div class="file-card ${v.cls}" onclick="App.openFile('${f.id}')">
            <div class="file-icon">${v.icon}</div>
            <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="file-meta">${humanSize(f.size)} • ${fmtDate(new Date(f.uploadedAt || Date.now()).toISOString())}</div>
            ${tags ? `<div class="file-tags">${tags}</div>` : ''}
          </div>`;
        }).join('')
      : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📁</div>Ничего не найдено по фильтру.</div>`;
  }

  function kvList(rows) {
    return rows.filter(r => r[1]).map(([k, v]) => `<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v).slice(0,120))}</span></div>`).join('') || '<div class="help">Не распознано</div>';
  }

  // ---- Загрузка PDF-договора ----
  let _cachedWorks = [];
  async function uploadContract() {
    const parks = await DB.getAll('parks');
    const filter = Auth.visibleParkFilter();
    _cachedWorks = await DB.getAll('works');
    const parkOpts = parks.map(p => `<option value="${p.id}" ${p.id===filter?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
    const workOptsHtml = (parkId) => _cachedWorks.filter(w => !parkId || w.parkId === parkId)
      .map(w => `<option value="${w.id}">${escapeHtml(w.title)}</option>`).join('');

    const body = `<div class="field"><label>Парк</label><select id="up_park" onchange="document.getElementById('up_work').innerHTML=App.workOpts(this.value)">${parkOpts}</select></div>
      <div class="field"><label>Связать с работой (необязательно)</label><select id="up_work"><option value="">— без привязки —</option>${workOptsHtml(filter)}</select></div>
      <div class="field"><label>PDF-договор</label>
        <div class="dropzone" id="up_drop">
          <div class="dropzone-icon">📄</div>
          <div><b>Перетащите файл сюда</b> или нажмите</div>
          <input type="file" id="up_file" accept="application/pdf" style="display:none">
          <div class="help" id="up_filename"></div>
        </div>
      </div>
      <div id="up_scanresult"></div>`;

    const footer = `<button class="btn btn-ghost" onclick="App.closeModalFn()">Отмена</button>
      <button class="btn btn-primary" id="up_savebtn" onclick="App.processUpload()" disabled>Сканировать и сохранить</button>`;
    openModal('Загрузка PDF-договора', body, footer);

    // Drag&drop
    const drop = $('#up_drop'), fileInput = $('#up_file');
    drop.onclick = () => fileInput.click();
    fileInput.onchange = () => { if (fileInput.files[0]) onFilePicked(fileInput.files[0]); };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragover'); };
    drop.ondragleave = () => drop.classList.remove('dragover');
    drop.ondrop = (e) => {
      e.preventDefault(); drop.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') { fileInput.files = e.dataTransfer.files; onFilePicked(f); }
      else toast('Нужен PDF-файл', true);
    };
    function onFilePicked(f) {
      $('#up_filename').textContent = `✓ ${f.name} (${(f.size/1024).toFixed(0)} КБ)`;
      _pendingFile = f;
      $('#up_savebtn').disabled = false;
    }
  }

  async function processUpload() {
    if (!_pendingFile) { toast('Выберите файл', true); return; }
    const parkId = $('#up_park').value;
    const workId = $('#up_work').value || null;
    const result = $('#up_scanresult');
    result.innerHTML = `<div class="help">Сканирование PDF…</div><div class="scan-progress"><div id="up_bar"></div></div>`;

    try {
      const data = await ContractPDF.extract(_pendingFile, (p) => {
        $('#up_bar').style.width = Math.round(p * 100) + '%';
      });
      // Сохраняем договор
      const work = workId ? await DB.getByKey('works', workId) : null;
      const contract = {
        id: DB.uid(), parkId, workId,
        title: work ? work.title : _pendingFile.name.replace(/\.pdf$/i, ''),
        fileName: _pendingFile.name,
        contractNo: work?.contractNo || data.payments?.terms ? '' : '',
        contractor: work?.contractor || data.parties?.contractor?.name || '',
        amount: data.payments?.total || work?.amount || 0,
        extracted: data,
        createdAt: Date.now(),
      };
      await DB.put('contracts', contract);
      // Сохраняем сам файл
      const savedFile = await DB.saveFile({ contractId: contract.id, name: _pendingFile.name, size: _pendingFile.size, type: 'application/pdf' }, _pendingFile);
      // Дублируем в единое хранилище файлов (с тегом «Договор»), чтобы договор
      // был виден в разделе «Хранилище» сразу, без ожидания миграции при перезапуске.
      await DB.saveFileRecord({
        id: 'cf_' + savedFile.id,
        name: _pendingFile.name, size: _pendingFile.size, type: 'application/pdf', ext: 'pdf',
        tags: ['Договор'],
        note: work ? `Связан с работой: ${work.title}` : '',
      }, _pendingFile);
      rememberTags(['Договор']);

      closeModal();
      toast('Договор сохранён и отсканирован');
      _pendingFile = null;
      location.hash = '#/storage';
    } catch (err) {
      result.innerHTML = `<div class="help" style="color:var(--bad)">Ошибка сканирования: ${escapeHtml(err.message)}<br>Проверьте, что это текстовый PDF (не скан).</div>`;
    }
  }

  // Синхронная версия для onchange select'а (использует кэш, заполненный в uploadContract)
  function workOpts(parkId) {
    return _cachedWorks.filter(w => !parkId || w.parkId === parkId)
      .map(w => `<option value="${w.id}">${escapeHtml(w.title)}</option>`).join('');
  }

  async function reextract(contractId) {
    const files = await DB.getFilesByContract(contractId);
    if (!files.length) { toast('Файл PDF не найден', true); return; }
    const f = files[0];
    toast('Сканирование…');
    const blob = await DB.getFile(f.id);
    const file = new File([blob.blob], f.name, { type: 'application/pdf' });
    try {
      const data = await ContractPDF.extract(file);
      const c = await DB.getByKey('contracts', contractId);
      c.extracted = data;
      await DB.put('contracts', c);
      toast('Пересканировано');
      route();
    } catch (err) { toast('Ошибка: ' + err.message, true); }
  }

  async function downloadFile(fileId, name) {
    const rec = await DB.getFile(fileId);
    if (!rec) return;
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function deleteContract(id) {
    if (!confirm('Удалить договор и файл?')) return;
    const files = await DB.getFilesByContract(id);
    for (const f of files) await DB.deleteFile(f.id);
    // Удаляем и migrated-копию из files (если есть)
    for (const f of files) { try { await DB.deleteFileRecord('cf_' + f.id); } catch {} }
    await DB.remove('contracts', id);
    toast('Удалено');
    location.hash = '#/storage';
  }

  // ============================================================
  // ПРОИЗВОЛЬНЫЕ ФАЙЛЫ (store "files")
  // ============================================================
  let _pendingFiles = [];
  const FILE_SIZE_WARN = 25 * 1024 * 1024; // мягкий лимит 25 МБ

  function tagsFromString(s) {
    return [...new Set((s || '').split(/[,;\n]/).map(t => t.trim()).filter(Boolean))];
  }

  async function uploadFile() {
    const catalog = getTagsCatalog();
    const opts = catalog.map(t => `<option value="${escapeHtml(t)}">`).join('');

    const body = `<div class="field"><label>Файлы</label>
        <div class="dropzone" id="fu_drop">
          <div class="dropzone-icon">⬆️</div>
          <div><b>Перетащите файлы сюда</b> или нажмите</div>
          <input type="file" id="fu_file" multiple style="display:none">
          <div class="help" id="fu_list">Можно несколько файлов любого типа</div>
        </div>
      </div>
      <div class="field"><label>Теги <span class="help">(через запятую, новые создаются автоматически)</span></label>
        <input type="text" id="fu_tags" placeholder="договор, смета, июль" list="fu_tagslist" autocomplete="off">
        <datalist id="fu_tagslist">${opts}</datalist>
      </div>
      <div class="field"><label>Примечание <span class="help">(необязательно)</span></label>
        <textarea id="fu_note" rows="2" placeholder="Комментарий к файлу(ам)"></textarea>
      </div>
      <div id="fu_warn"></div>`;

    const footer = `<button class="btn btn-ghost" onclick="App.closeModalFn()">Отмена</button>
      <button class="btn btn-primary" id="fu_savebtn" onclick="App.processFileUpload()" disabled>Сохранить</button>`;
    openModal('Загрузка файлов', body, footer, true);

    _pendingFiles = [];
    const drop = $('#fu_drop'), fileInput = $('#fu_file');
    drop.onclick = () => fileInput.click();
    fileInput.onchange = () => { if (fileInput.files.length) onPicked([...fileInput.files]); };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragover'); };
    drop.ondragleave = () => drop.classList.remove('dragover');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('dragover'); onPicked([...e.dataTransfer.files]); };

    function onPicked(arr) {
      _pendingFiles = arr;
      $('#fu_list').innerHTML = arr.map(f => {
        const v = fileVisual({ name: f.name, type: f.type });
        const big = f.size > FILE_SIZE_WARN;
        return `<div class="fu-row">${v.icon} ${escapeHtml(f.name)} <span class="help">${humanSize(f.size)}</span>${big ? ' <span style="color:var(--warn)">⚠ большой файл</span>' : ''}</div>`;
      }).join('');
      $('#fu_savebtn').disabled = !arr.length;
      const bigTotal = arr.some(f => f.size > FILE_SIZE_WARN);
      $('#fu_warn').innerHTML = bigTotal
        ? `<div class="help" style="color:var(--warn);margin-top:8px">⚠ Некоторые файлы больше 25 МБ. Браузер их сохранит, но экспорт/импорт бэкапа будет медленнее.</div>`
        : '';
    }
  }

  async function processFileUpload() {
    if (!_pendingFiles.length) { toast('Выберите файлы', true); return; }
    const tags = tagsFromString($('#fu_tags').value);
    const note = $('#fu_note').value.trim();
    const btn = $('#fu_savebtn');
    btn.disabled = true;
    btn.textContent = `Сохранение… (0/${_pendingFiles.length})`;

    let saved = 0, failed = 0;
    for (let i = 0; i < _pendingFiles.length; i++) {
      const f = _pendingFiles[i];
      try {
        await DB.saveFileRecord({
          name: f.name, size: f.size, type: f.type, ext: fileExt(f.name),
          tags: [...tags], note,
        }, f);
        saved++;
      } catch (err) {
        console.error('file save failed', f.name, err);
        failed++;
      }
      btn.textContent = `Сохранение… (${i + 1}/${_pendingFiles.length})`;
    }
    if (tags.length) rememberTags(tags);

    closeModal();
    _pendingFiles = [];
    toast(`Сохранено файлов: ${saved}${failed ? `, ошибок: ${failed}` : ''}`);
    location.hash = '#/storage';
    route();
  }

  async function openFile(id) {
    const f = await DB.getFileRecord(id);
    if (!f) { toast('Файл не найден', true); return; }
    const v = fileVisual(f);
    const tagChips = (f.tags || []).map(t =>
      `<button class="tag-chip ${tagColor(t)}" onclick="location.hash='#/storage/tag/${encodeURIComponent(t)}';App.closeModalFn()">#${escapeHtml(t)}</button>`).join('');
    const isImage = (f.type || '').startsWith('image/');
    const isPdf = (f.type || '').includes('pdf') || f.ext === 'pdf';
    const isPreviewable = isImage || isPdf;
    const url = isPreviewable ? URL.createObjectURL(f.blob) : '';

    const previewHtml = isImage
      ? `<img class="file-preview" src="${url}" alt="${escapeHtml(f.name)}">`
      : isPdf
      ? `<iframe class="file-preview" src="${url}"></iframe>`
      : `<div class="file-no-preview"><div class="empty-icon">${v.icon}</div><div class="help">Предпросмотр недоступен — скачайте файл.</div></div>`;

    const body = `<div class="file-detail">
        <div class="file-detail-head">
          <div class="file-icon ${v.cls} big">${v.icon}</div>
          <div>
            <h3>${escapeHtml(f.name)}</h3>
            <div class="help">${humanSize(f.size)} • ${escapeHtml(f.type || '—')} • ${fmtDate(new Date(f.uploadedAt || Date.now()).toISOString())}</div>
          </div>
        </div>
        ${previewHtml}
        ${f.note ? `<div class="file-note">${escapeHtml(f.note)}</div>` : ''}
        <div class="chips">${tagChips || '<span class="help">тегов нет</span>'}</div>
      </div>`;

    const footer = `<button class="btn btn-ghost btn-sm" onclick="App.editFileTags('${f.id}')">🏷 Теги</button>
      <button class="btn btn-ghost btn-sm" onclick="App.downloadFileRecord('${f.id}')">⬇ Скачать</button>
      <button class="btn btn-danger btn-sm" onclick="App.deleteFileRecord('${f.id}')">🗑 Удалить</button>`;
    openModal(f.name, body, footer, true);

    // Освобождаем object URL при закрытии модалки
    const cleanup = () => { if (url) URL.revokeObjectURL(url); $('#modalClose').removeEventListener('click', cleanup); $('.modal-backdrop').removeEventListener('click', cleanup); };
    $('#modalClose').addEventListener('click', cleanup);
    $('.modal-backdrop').addEventListener('click', cleanup);
  }

  async function editFileTags(id) {
    const f = await DB.getFileRecord(id);
    if (!f) return;
    const catalog = getTagsCatalog();
    const opts = catalog.map(t => `<option value="${escapeHtml(t)}">`).join('');
    const body = `<div class="field"><label>Теги <span class="help">(через запятую)</span></label>
        <input type="text" id="ft_tags" value="${escapeHtml((f.tags || []).join(', '))}" list="ft_tagslist" autofocus>
        <datalist id="ft_tagslist">${opts}</datalist></div>
      <div class="field"><label>Примечание</label>
        <textarea id="ft_note" rows="2">${escapeHtml(f.note || '')}</textarea></div>`;
    const footer = `<button class="btn btn-ghost" onclick="App.openFile('${f.id}')">Назад</button>
      <button class="btn btn-primary" onclick="App.saveFileTags('${f.id}')">Сохранить</button>`;
    openModal('Теги и описание', body, footer, true);
  }

  async function saveFileTags(id) {
    const tags = tagsFromString($('#ft_tags').value);
    const note = $('#ft_note').value.trim();
    await DB.updateFileRecord(id, { tags, note });
    if (tags.length) rememberTags(tags);
    toast('Сохранено');
    openFile(id);
  }

  async function downloadFileRecord(id) {
    const f = await DB.getFileRecord(id);
    if (!f) return;
    const url = URL.createObjectURL(f.blob);
    const a = document.createElement('a');
    a.href = url; a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function deleteFileRecord(id) {
    const f = await DB.getFileRecord(id);
    if (!f) return;
    if (!confirm(`Удалить файл «${f.name}»?`)) return;
    await DB.deleteFileRecord(id);
    toast('Удалено');
    closeModal();
    route();
  }

  // ============================================================
  // НАСТРОЙКИ + БЭКАП
  // ============================================================
  async function renderSettings() {
    $('#viewTitle').textContent = 'Настройки';
    $('#viewActions').innerHTML = '';
    setActiveNav('settings');

    const counts = await Promise.all(Object.keys(DB.STORES).map(async s => [s, (await DB.getAll(s)).length]));
    const stats = counts.map(([s, n]) => `<div class="park-stat">${s}<b>${n}</b></div>`).join('');

    const body = `<div class="section-title">💾 Резервное копирование</div>
      <p class="help" style="margin-bottom:12px">Данные хранятся в этом браузере. Делайте экспорт регулярно, чтобы не потерять их при очистке кэша.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
        <button class="btn btn-primary" onclick="App.exportBackup()">⬇ Экспорт в файл</button>
        <label class="btn btn-ghost" style="cursor:pointer">⬆ Импорт из файла<input type="file" id="set_import" accept=".json" style="display:none" onchange="App.importBackup(this.files[0])"></label>
      </div>
      <div class="section-title">📊 Состояние базы</div>
      <div class="park-stats" style="max-width:400px">${stats}</div>
      <div class="section-title" style="margin-top:24px">⚠️ Опасная зона</div>
      <button class="btn btn-danger" onclick="App.resetDemo()">🗑 Сбросить и заполнить демо-данными</button>
      <p class="help" style="margin-top:8px">Удалит все данные и создаст примеры заново.</p>`;

    $('#view').innerHTML = body;
  }

  async function exportBackup() {
    const out = { version: 2, exportedAt: new Date().toISOString(), data: {}, tagsCatalog: getTagsCatalog() };
    for (const s of Object.keys(DB.STORES)) out.data[s] = await DB.getAll(s);
    // Файлы PDF-договоров — как base64
    const files = await DB.getAll('contractFiles');
    out.data.contractFiles_b64 = [];
    for (const f of files) {
      const b64 = await blobToB64(f.blob);
      out.data.contractFiles_b64.push({ ...f, blob: b64 });
    }
    // Произвольные файлы (store "files") — как base64
    const recs = await DB.getAllFiles();
    out.data.files_b64 = [];
    for (const f of recs) {
      const b64 = await blobToB64(f.blob);
      out.data.files_b64.push({ ...f, blob: b64 });
    }
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `parks_backup_${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Экспортировано (файлов: ${recs.length})`);
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.data) throw new Error('Неверный формат');
      await DB.clearAll();
      for (const s of Object.keys(DB.STORES)) {
        // Хранилища с blob восстанавливаем отдельно ниже
        if (s === 'contractFiles' || s === 'files') continue;
        if (data.data[s]) await DB.bulkPut(s, data.data[s]);
      }
      // PDF-договоры
      if (data.data.contractFiles_b64) {
        for (const f of data.data.contractFiles_b64) {
          const blob = b64ToBlob(f.blob, f.type || 'application/pdf');
          await DB.saveFile({ contractId: f.contractId, name: f.name, size: f.size, type: f.type }, blob);
        }
      }
      // Произвольные файлы
      if (data.data.files_b64) {
        for (const f of data.data.files_b64) {
          const blob = b64ToBlob(f.blob, f.type || 'application/octet-stream');
          await DB.saveFileRecord({
            id: f.id, name: f.name, size: f.size, type: f.type, ext: f.ext,
            tags: f.tags || [], note: f.note || '', uploadedAt: f.uploadedAt,
          }, blob);
        }
      }
      // Справочник тегов
      if (Array.isArray(data.tagsCatalog)) saveTagsCatalog(data.tagsCatalog);
      // На случай повторной миграции после импорта — сбрасываем флаг не нужно,
      // т.к. данные уже восстановлены напрямую.
      toast('Импортировано');
      route();
      renderNavParks();
    } catch (err) {
      toast('Ошибка импорта: ' + err.message, true);
    }
  }

  async function resetDemo() {
    if (!confirm('Удалить ВСЕ данные и заполнить демонстрационными?')) return;
    await Seed.run(true);
    toast('Демо-данные восстановлены');
    route();
    renderNavParks();
  }

  // ============================================================
  // ВСПОМОГАТЕЛЬНЫЕ
  // ============================================================
  function openModal(title, body, footer, wide) {
    $('#modalTitle').innerHTML = title;
    $('#modalBody').innerHTML = body;
    $('#modalFooter').innerHTML = footer || '';
    $('#modal').classList.remove('hidden');
    $('#modal .modal-dialog').classList.toggle('wide', !!wide);
  }
  function closeModal() { $('#modal').classList.add('hidden'); }

  function setActiveNav(route) {
    if (route) {
      const a = document.querySelector(`.nav-item[data-route="${route}"]`);
      if (a) a.classList.add('active');
    }
  }

  function emptyState(title, btnLabel, onclick) {
    return `<div class="empty"><div class="empty-icon">📋</div><h3>${title}</h3>${btnLabel?`<button class="btn btn-primary" style="margin-top:12px" onclick="${onclick}">${btnLabel}</button>`:''}</div>`;
  }

  function drawChart(id, type, data, options = {}) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const ch = new Chart(ctx, { type, data, options: { responsive: true, maintainAspectRatio: false, ...options } });
    charts.push(ch);
  }
  function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

  function blobToB64(blob) {
    return new Promise((res) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob);
    });
  }
  function b64ToBlob(b64, type) {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }

  let _pendingFile = null;

  return {
    init, route, renderDashboard, renderBoard, renderPark, renderStorage,
    openWork, editWork, saveWork, deleteWork, openNewWork, createWork, advanceWork,
    uploadContract, processUpload, reextract, downloadFile, deleteContract,
    uploadFile, processFileUpload, openFile, editFileTags, saveFileTags,
    downloadFileRecord, deleteFileRecord, onFileSearch,
    exportBackup, importBackup, resetDemo, closeModalFn: closeModal,
    calcCriteria, workOpts,
    editPark, openNewPark, savePark, deletePark, clearParkWorks,
    canEditPark, editParkInfo, saveParkInfo, cancelParkInfoEdit, saveEquipmentStatus,
  };
})();

// Глобальный ярлык для inline-обработчиков
window.App = App;
document.addEventListener('DOMContentLoaded', App.init);
