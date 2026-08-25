/* ============================================================
   АмбиЛенд — движок раздела документов (GitHub-режим)
   Документы хранятся прямо в репозитории (папка docs/), после
   сохранения GitHub Pages пересобирает сайт (~1 мин) и изменения
   видны всем. Администратор добавляет и удаляет — всё коммитится
   автоматически. Без GitHub — запасной локальный режим (IndexedDB).
   Конфиг — window.SECTION. Требует github.js, portal.js, section.css.
   ============================================================ */
(() => {
  'use strict';

  const cfg = window.SECTION || {};
  const sectionId = cfg.id;
  if (!sectionId) return;

  const REGISTRY_PATH = 'docs/registry.json';

  /* ---------- IndexedDB (локальный запасной режим) ---------- */
  const DB_NAME = 'ambi_portal_docs';
  const DB_VER = 1;
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('docs')) {
          const store = db.createObjectStore('docs', { keyPath: 'id' });
          store.createIndex('section', 'section', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbPut(doc) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('docs', 'readwrite');
      tx.objectStore('docs').put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbBySection(section) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('docs', 'readonly');
      const req = tx.objectStore('docs').index('section').getAll(section);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('docs', 'readwrite');
      tx.objectStore('docs').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- GitHub: реестр и файлы ---------- */
  // Очередь коммитов — строго последовательно (sha реестра меняется)
  let ghQueue = Promise.resolve();
  const ghEnqueue = (fn) => {
    const run = ghQueue.then(fn, fn);
    ghQueue = run.catch(() => {});
    return run;
  };

  async function ghLoadRegistry() {
    const r = await GH.readJSON(REGISTRY_PATH);
    return r ? { list: r.json, sha: r.sha } : { list: [], sha: null };
  }

  async function ghAddDoc(file, title, desc) {
    return ghEnqueue(async () => {
      const reg = await ghLoadRegistry();
      const fname = Date.now().toString(36) + '-' + slugify(file.name);
      const rel = 'docs/' + sectionId + '/' + fname;
      // 1. Заливаем файл
      await GH.writeFile(rel, await GH.fileToU8(file), 'Документ: ' + title + ' (' + sectionId + ')');
      // 2. Обновляем реестр (sha мог измениться после заливки файла — читаем заново)
      const reg2 = await ghLoadRegistry();
      const doc = {
        id: 'gh_' + Date.now().toString(36),
        section: sectionId,
        title, desc,
        name: file.name,
        url: rel,
        size: file.size,
        ts: Date.now(),
      };
      const list = reg2.list.concat([doc]);
      await GH.writeFile(REGISTRY_PATH, JSON.stringify(list, null, 2), 'Реестр: добавлен «' + title + '» (' + sectionId + ')', reg2.sha);
      return doc;
    });
  }

  async function ghDeleteDoc(doc) {
    return ghEnqueue(async () => {
      // 1. Удаляем файл — нужен его sha
      const fileInfo = await GH.getFile(doc.url);
      if (fileInfo && fileInfo.sha) {
        await GH.deleteFile(doc.url, 'Удалён файл: ' + doc.title + ' (' + sectionId + ')', fileInfo.sha);
      }
      // 2. Обновляем реестр
      const reg = await ghLoadRegistry();
      const list = reg.list.filter(d => d.id !== doc.id);
      await GH.writeFile(REGISTRY_PATH, JSON.stringify(list, null, 2), 'Реестр: удалён «' + doc.title + '» (' + sectionId + ')', reg.sha);
    });
  }

  /* ---------- Утилиты ---------- */
  const FILE_META = [
    { re: /\.pdf$/i, icon: '📕', cls: 'ft-pdf', label: 'PDF' },
    { re: /\.(doc|docx|odt|rtf)$/i, icon: '📘', cls: 'ft-word', label: 'Документ' },
    { re: /\.(xls|xlsx|ods|csv)$/i, icon: '📗', cls: 'ft-excel', label: 'Таблица' },
    { re: /\.(ppt|pptx|odp)$/i, icon: '📙', cls: 'ft-ppt', label: 'Презентация' },
    { re: /\.(png|jpe?g|gif|webp|svg|bmp)$/i, icon: '🖼️', cls: 'ft-image', label: 'Изображение' },
    { re: /\.(zip|rar|7z|tar|gz)$/i, icon: '🗜️', cls: 'ft-arc', label: 'Архив' },
    { re: /\.(txt|md|log)$/i, icon: '📄', cls: 'ft-text', label: 'Текст' },
    { re: /\.(html?)$/i, icon: '🌐', cls: 'ft-web', label: 'Веб-страница' },
    { re: /\.(mp3|wav|ogg|m4a)$/i, icon: '🎵', cls: 'ft-audio', label: 'Аудио' },
    { re: /\.(mp4|webm|mov|mkv)$/i, icon: '🎬', cls: 'ft-video', label: 'Видео' },
  ];
  const fileMeta = (name) => FILE_META.find(m => m.re.test(name)) || { icon: '📎', cls: 'ft-file', label: 'Файл' };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmtSize = (b) => {
    if (b == null || isNaN(b)) return '';
    if (b < 1024) return b + ' Б';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1).replace('.', ',') + ' КБ';
    return (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ';
  };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  function slugify(name) {
    const parts = String(name).split('.');
    const ext = parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
    let base = parts.join('.').toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
    return base + ext;
  }

  /* ---------- Состояние ---------- */
  const grid = document.getElementById('docsGrid');
  const emptyEl = document.getElementById('docsEmpty');
  const staticDocs = Array.from(grid.querySelectorAll('.doc'));

  const isAdmin = () => {
    const r = Portal.currentRole();
    return !!(r && r.login && r.login.toLowerCase() === 'admin');
  };
  const canManage = () => isAdmin();

  let dirty = false;
  const markDirty = () => { dirty = true; updateSaveBtn(); };
  const clearDirty = () => { dirty = false; updateSaveBtn(); };
  let saveBtn = null;
  function updateSaveBtn() {
    if (!saveBtn) return;
    saveBtn.disabled = !dirty;
    saveBtn.classList.toggle('is-dirty', dirty);
    saveBtn.innerHTML = Portal.icon('check') + (dirty ? ' Сохранить изменения' : ' Изменения сохранены');
  }

  let query = '';
  let activeType = 'all';
  let ghDocs = [];
  let localDocs = [];
  let useGH = false;

  /* ---------- Рендер ---------- */
  function applyFilters() {
    const q = query.trim().toLowerCase();
    let visible = 0;
    const allCards = Array.from(grid.querySelectorAll('.doc'));
    allCards.forEach(card => {
      const type = (card.dataset.type || '').toLowerCase();
      const text = card.textContent.toLowerCase();
      const typeOk = activeType === 'all' || type === activeType;
      const qOk = !q || text.includes(q);
      const show = typeOk && qOk;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    if (emptyEl) {
      const any = allCards.length > 0;
      emptyEl.style.display = visible === 0 ? 'block' : 'none';
      emptyEl.querySelector('.eh-text').textContent = (!any && emptyEl.dataset.mode === 'nofiles')
        ? 'Пока нет ни одного документа.'
        : 'Ничего не найдено. Попробуйте изменить запрос или фильтр.';
    }
  }

  function renderGHDoc(doc) {
    const meta = fileMeta(doc.name);
    const el = document.createElement('a');
    el.className = 'doc is-file is-published';
    el.href = doc.url;
    el.target = '_blank';
    el.rel = 'noopener';
    el.dataset.type = meta.label.toLowerCase();
    el.innerHTML = `
      <div class="doc-icon">${meta.icon}</div>
      <div class="doc-info">
        <div class="doc-title">${esc(doc.title)}</div>
        <div class="doc-desc">${esc(doc.desc || doc.name)}${doc.size ? ' · ' + fmtSize(doc.size) : ''}${doc.ts ? ' · ' + fmtDate(doc.ts) : ''}</div>
        <span class="doc-tag">${esc(meta.label)}</span>
      </div>
      <span class="doc-pub-badge" title="Опубликовано для всех">${Portal.icon('check')} Опубликовано</span>
      ${canManage() ? `<button class="doc-del" title="Удалить документ">${Portal.icon('trash')}</button>` : ''}`;
    const del = el.querySelector('.doc-del');
    if (del) {
      del.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Удалить документ «${doc.title}» для всех?`)) return;
        del.disabled = true;
        try {
          await ghDeleteDoc(doc);
          el.remove();
          ghDocs = ghDocs.filter(d => d.id !== doc.id);
          applyFilters();
          clearDirty();
          Portal.toast('Документ удалён (видно всем через ~1 мин)');
        } catch (err) {
          del.disabled = false;
          Portal.toast('Не удалось удалить: ' + err.message, true);
        }
      });
    }
    return el;
  }

  function renderLocalDoc(doc) {
    const meta = fileMeta(doc.name);
    const el = document.createElement('div');
    el.className = 'doc is-file is-local';
    el.dataset.type = meta.label.toLowerCase();
    el.dataset.docId = doc.id;
    el.innerHTML = `
      <div class="doc-icon">${meta.icon}</div>
      <div class="doc-info">
        <div class="doc-title">${esc(doc.title)}</div>
        <div class="doc-desc">${esc(doc.desc || doc.name)} · ${fmtSize(doc.size)} · добавлен ${fmtDate(doc.ts)}</div>
        <span class="doc-tag">${esc(meta.label)}</span>
      </div>
      ${canManage() ? `<span class="doc-local-badge" title="Хранится только в этом браузере">Локальный</span><button class="doc-del" title="Удалить документ">${Portal.icon('trash')}</button>` : ''}`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.doc-del')) return;
      openDoc(doc);
    });
    const del = el.querySelector('.doc-del');
    if (del) {
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Удалить документ «${doc.title}»?`)) return;
        await dbDelete(doc.id);
        URL.revokeObjectURL(doc._url || '');
        localDocs = localDocs.filter(d => d.id !== doc.id);
        el.remove();
        applyFilters();
        markDirty();
        Portal.toast('Документ удалён');
      });
    }
    return el;
  }

  function openDoc(doc) {
    const url = doc._url || (doc._url = URL.createObjectURL(doc.blob));
    const meta = fileMeta(doc.name);
    const isPreviewable = ['ft-pdf', 'ft-image', 'ft-text', 'ft-web', 'ft-video', 'ft-audio'].includes(meta.cls);
    let previewHTML = '';
    if (isPreviewable) {
      if (meta.cls === 'ft-image') previewHTML = `<img class="sd-preview" src="${url}" alt="${esc(doc.name)}">`;
      else if (meta.cls === 'ft-video') previewHTML = `<video class="sd-preview" src="${url}" controls></video>`;
      else if (meta.cls === 'ft-audio') previewHTML = `<audio src="${url}" controls style="width:100%"></audio>`;
      else previewHTML = `<iframe class="sd-preview frame" src="${url}" title="${esc(doc.name)}"></iframe>`;
    } else {
      previewHTML = `<div class="sd-nopreview">Предпросмотр недоступен — скачайте файл.</div>`;
    }
    Portal.openModal({
      title: doc.title,
      wide: true,
      bodyHTML: `
        <div class="sd-head">
          <div class="doc-icon" style="width:44px;height:44px;font-size:20px">${meta.icon}</div>
          <div>
            <div style="font-weight:700;font-size:14px;word-break:break-all">${esc(doc.name)}</div>
            <div style="font-size:12.5px;color:var(--ink-soft)">${esc(meta.label)} · ${fmtSize(doc.size)} · добавлен ${fmtDate(doc.ts)}</div>
          </div>
        </div>
        ${doc.desc ? `<p style="font-size:13.5px;color:var(--ink-soft);margin:4px 0 12px">${esc(doc.desc)}</p>` : ''}
        ${previewHTML}`,
      footerHTML: `<a class="btn-p primary" href="${url}" download="${esc(doc.name)}">${Portal.icon('upload')} Скачать файл</a>`,
    });
  }

  async function renderAll() {
    grid.querySelectorAll('.doc.is-file').forEach(el => el.remove());
    ghDocs.forEach(doc => grid.appendChild(renderGHDoc(doc)));
    localDocs.forEach(doc => grid.appendChild(renderLocalDoc(doc)));
    applyFilters();
  }

  async function loadDocs() {
    useGH = GH.ready; // режим записи (нужен токен)
    if (GH.readReady) {
      // чтение опубликованных документов — без токена, для всех
      try {
        const reg = await ghLoadRegistry();
        ghDocs = reg.list.filter(d => d && d.section === sectionId);
      } catch (e) {
        console.warn('[section] GitHub недоступен, локальный режим:', e.message);
        useGH = false;
        ghDocs = [];
      }
    }
    localDocs = (await dbBySection(sectionId)).sort((a, b) => b.ts - a.ts);
    await renderAll();
    const authWrap = document.getElementById('toolbarAuth');
    if (authWrap) renderAuthArea(authWrap);
  }

  /* ---------- Панель инструментов ---------- */
  function buildToolbar() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;

    const box = document.createElement('div');
    box.className = 'search-box';
    box.innerHTML = `
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16 L21 21"/></svg>
      <input type="search" id="docSearch" placeholder="Поиск по ключевым словам…" aria-label="Поиск по документам">`;
    toolbar.appendChild(box);
    box.querySelector('input').addEventListener('input', (e) => { query = e.target.value; applyFilters(); });

    const types = ['all', ...new Set(staticDocs.map(d => (d.dataset.type || '').toLowerCase()).filter(Boolean))];
    if (types.length > 2) {
      const filters = document.createElement('div');
      filters.className = 'type-filters';
      const LABELS = { all: 'Все', 'прогноз': 'Прогнозы', 'отчёт': 'Отчёты', 'план': 'Планы', 'регламент': 'Регламенты', 'документ': 'Документы' };
      types.forEach(t => {
        const b = document.createElement('button');
        b.className = 'type-filter' + (t === 'all' ? ' active' : '');
        b.textContent = LABELS[t] || t;
        b.addEventListener('click', () => {
          filters.querySelectorAll('.type-filter').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          activeType = t;
          applyFilters();
        });
        filters.appendChild(b);
      });
      toolbar.appendChild(filters);
    }

    const authWrap = document.createElement('div');
    authWrap.className = 'toolbar-auth';
    authWrap.id = 'toolbarAuth';
    renderAuthArea(authWrap);
    toolbar.appendChild(authWrap);
  }

  function renderAuthArea(wrap) {
    wrap.innerHTML = '';
    const sess = Portal.session();

    if (canManage()) {
      const add = document.createElement('button');
      add.className = 'add-doc-fab';
      add.style.marginLeft = '0';
      add.innerHTML = Portal.icon('plus') + ' Добавить документ';
      add.addEventListener('click', openAddModal);
      wrap.appendChild(add);

      saveBtn = document.createElement('button');
      saveBtn.className = 'btn-p light sm save-changes';
      saveBtn.addEventListener('click', () => {
        if (!dirty) return;
        clearDirty();
        Portal.toast(useGH ? 'Изменения уже в репозитории' : 'Изменения сохранены в этом браузере');
      });
      wrap.appendChild(saveBtn);
      updateSaveBtn();

      const badge = document.createElement('span');
      badge.className = 'server-badge' + (useGH ? '' : ' offline');
      badge.title = useGH
        ? 'Документы коммитятся в GitHub и видны всем'
        : 'GitHub не настроен — документы сохраняются только в этом браузере';
      badge.innerHTML = Portal.icon(useGH ? 'check' : 'lock') + (useGH ? ' GitHub' : ' Офлайн');
      wrap.appendChild(badge);

      // Кнопка ввода GitHub-токена (только админ, только если токен не задан)
      if (isAdmin() && typeof GH !== 'undefined' && !GH.hasToken()) {
        const tokBtn = document.createElement('button');
        tokBtn.className = 'btn-p light sm';
        tokBtn.innerHTML = Portal.icon('check') + ' GitHub токен';
        tokBtn.title = 'Ввести токен для автосохранения в репозиторий';
        tokBtn.addEventListener('click', () => {
          const t = prompt('Вставьте GitHub Personal Access Token (ghp_...):', '');
          if (t && t.trim().startsWith('ghp_')) {
            GH.setToken(t.trim());
          } else if (t) {
            Portal.toast('Токен должен начинаться с ghp_');
          }
        });
        wrap.appendChild(tokBtn);
      }
    } else if (sess) {
      const hint = document.createElement('span');
      hint.className = 'auth-viewonly';
      hint.innerHTML = Portal.icon('lock') + ' Только просмотр — документы добавляет и удаляет администратор';
      wrap.appendChild(hint);
    }

    if (sess) {
      const chip = document.createElement('span');
      chip.className = 'auth-mini-chip';
      chip.innerHTML = Portal.icon('user') + ' ' + (sess.name || sess.login);
      chip.title = 'Вы вошли как ' + (sess.login || '');
      wrap.appendChild(chip);
      const out = document.createElement('button');
      out.className = 'btn-p ghost sm';
      out.innerHTML = Portal.icon('out') + ' Выйти';
      out.addEventListener('click', () => { Portal.logout(); location.reload(); });
      wrap.appendChild(out);
    } else {
      const b = document.createElement('button');
      b.className = 'btn-p primary sm';
      b.innerHTML = Portal.icon('key') + ' Войти на портал';
      b.addEventListener('click', () => Portal.openLoginModal(() => location.reload()));
      wrap.appendChild(b);
    }
  }

  /* ---------- Модалка добавления ---------- */
  let pickedFile = null;

  function openAddModal() {
    pickedFile = null;
    const note = useGH
      ? 'Файл сразу закоммитится в репозиторий и станет виден всем сотрудникам (обновление сайта ~1 мин).'
      : 'GitHub не настроен — файл сохранится только в этом браузере (демо-режим).';
    Portal.openModal({
      title: 'Добавить документ',
      bodyHTML: `
        <div class="sd-dropzone" id="sdDrop">
          <div class="sd-drop-icon">${Portal.icon('upload')}</div>
          <div class="sd-drop-title">Перетащите файл сюда</div>
          <div class="sd-drop-sub">или</div>
          <button class="btn-p ghost sm" id="sdPick" type="button">Выбрать файл с компьютера</button>
          <input type="file" id="sdFile" hidden>
        </div>
        <div class="sd-picked" id="sdPicked" style="display:none"></div>
        <div class="p-field" style="margin-top:16px">
          <label>Название документа</label>
          <input type="text" id="sdTitle" placeholder="Например: Отчёт за август 2026">
        </div>
        <div class="p-field">
          <label>Описание (необязательно)</label>
          <textarea id="sdDesc" rows="2" placeholder="Короткое описание — поможет найти документ поиском"></textarea>
        </div>
        <div class="p-error" id="sdErr"></div>
        <div class="p-hint">${note}</div>`,
      footerHTML: `<button class="btn-p primary" id="sdSave">${Portal.icon('check')} Сохранить документ</button>`,
      onOpen(wrap, close) {
        const drop = wrap.querySelector('#sdDrop');
        const fileInput = wrap.querySelector('#sdFile');
        const picked = wrap.querySelector('#sdPicked');
        const title = wrap.querySelector('#sdTitle');

        const setFile = (file) => {
          if (!file) return;
          pickedFile = file;
          const meta = fileMeta(file.name);
          drop.style.display = 'none';
          picked.style.display = 'flex';
          picked.innerHTML = `
            <div class="doc-icon" style="width:42px;height:42px;font-size:19px">${meta.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:13.5px;word-break:break-all">${esc(file.name)}</div>
              <div style="font-size:12px;color:var(--ink-soft)">${esc(meta.label)} · ${fmtSize(file.size)}</div>
            </div>
            <button class="doc-del" id="sdClear" title="Выбрать другой файл">${Portal.icon('trash')}</button>`;
          picked.querySelector('#sdClear').addEventListener('click', () => {
            pickedFile = null;
            picked.style.display = 'none';
            drop.style.display = '';
            fileInput.value = '';
          });
          if (!title.value.trim()) title.value = file.name.replace(/\.[^.]+$/, '');
        };

        wrap.querySelector('#sdPick').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
        drop.addEventListener('drop', (e) => setFile(e.dataTransfer.files[0]));

        wrap.querySelector('#sdSave').addEventListener('click', async () => {
          const err = wrap.querySelector('#sdErr');
          if (!pickedFile) { err.textContent = 'Выберите файл с компьютера'; return; }
          const t = title.value.trim();
          if (!t) { err.textContent = 'Укажите название документа'; return; }
          if (pickedFile.size > 25 * 1024 * 1024) { err.textContent = 'Файл больше 25 МБ — для таких нужен релиз GitHub, напишите мне'; return; }
          const desc = wrap.querySelector('#sdDesc').value.trim();
          const saveBtnEl = wrap.querySelector('#sdSave');
          saveBtnEl.disabled = true;
          saveBtnEl.textContent = 'Публикую…';
          try {
            if (useGH) {
              await ghAddDoc(pickedFile, t, desc);
              close();
              clearDirty();
              Portal.toast('Документ «' + t + '» опубликован для всех');
              const reg = await ghLoadRegistry();
              ghDocs = reg.list.filter(d => d && d.section === sectionId);
              await renderAll();
            } else {
              const doc = {
                id: 'doc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
                section: sectionId, title: t, desc,
                name: pickedFile.name, size: pickedFile.size, type: pickedFile.type,
                blob: pickedFile, ts: Date.now(),
              };
              await dbPut(doc);
              close();
              markDirty();
              Portal.toast('Документ «' + t + '» добавлен (локально)');
              localDocs = (await dbBySection(sectionId)).sort((a, b) => b.ts - a.ts);
              await renderAll();
            }
          } catch (e) {
            console.error('[section] save error:', e);
            err.textContent = e.message;
            saveBtnEl.disabled = false;
            saveBtnEl.innerHTML = Portal.icon('check') + ' Сохранить документ';
          }
        });
      }
    });
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- Инициализация ---------- */
  buildToolbar();
  loadDocs();
})();
