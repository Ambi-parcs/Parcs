/* ============================================================
   АмбиЛенд — общий вход портала, роли и доступы (GitHub-режим)
   ------------------------------------------------------------
   Роли и документы хранятся в репозитории (roles.json, docs/) и
   общие для всех посетителей. Вход проверяется по репозиторию.
   Без GH_CONFIG — запасной локальный режим (localStorage браузера).
   Требует assets/github.js (GH).
   ============================================================ */

const Portal = (() => {
  'use strict';

  const ROLES_KEY = 'ambi_portal_roles_v1';
  const SESSION_KEY = 'ambi_portal_session_v1';
  const ROLES_PATH = 'roles.json';

  const SECTIONS = ['kontrol', 'budget', 'analitika', 'obuchenie', 'motivatsia', 'reglamenty'];

  /* ---------- Права ---------- */
  function fullPerms() {
    const p = { 'roles.create': true };
    SECTIONS.forEach(s => { p['view.' + s] = true; p['manage.' + s] = true; });
    return p;
  }

  function hashPwd(pwd) {
    let h = 0x811c9dc5;
    for (let i = 0; i < String(pwd).length; i++) {
      h ^= String(pwd).charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  /* ---------- Локальный запасной режим ---------- */
  function defaultRoles() {
    const full = fullPerms();
    return [
      { id: 'admin', login: 'admin', pwdHash: hashPwd('0987'), name: 'Администратор',
        note: 'Полный доступ ко всем разделам и настройкам', builtin: true, perms: full },
      { id: 'cmo', login: 'cmo', pwdHash: hashPwd('cmo123'), name: 'Коммерческий директор',
        note: 'Полный доступ', builtin: true, perms: full },
      { id: 'cfo', login: 'cfo', pwdHash: hashPwd('cfo123'), name: 'Финансовый директор',
        note: 'Полный доступ', builtin: true, perms: full },
    ];
  }

  function localRoles() {
    try {
      const raw = localStorage.getItem(ROLES_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e) { /* повреждённое хранилище */ }
    const def = defaultRoles();
    localStorage.setItem(ROLES_KEY, JSON.stringify(def));
    return def;
  }

  function saveLocalRoles(list) {
    localStorage.setItem(ROLES_KEY, JSON.stringify(list));
  }

  /* ---------- GitHub-режим ---------- */
  const useGH = () => typeof GH !== 'undefined' && GH.ready;

  // Очередь коммитов ролей
  let roleQueue = Promise.resolve();
  const roleEnqueue = (fn) => {
    const run = roleQueue.then(fn, fn);
    roleQueue = run.catch(() => {});
    return run;
  };

  let _rolesCache = null;

  async function loadRolesGH() {
    const r = await GH.readJSON(ROLES_PATH);
    if (!r) {
      // первый запуск — заливаем роли по умолчанию
      const def = defaultRoles();
      await GH.writeFile(ROLES_PATH, JSON.stringify(def, null, 2), 'Роли по умолчанию');
      return { list: def, sha: null };
    }
    return { list: r.json, sha: r.sha };
  }

  async function rolesAsync() {
    if (useGH()) {
      try {
        const { list } = await loadRolesGH();
        _rolesCache = list;
        return list;
      } catch (e) {
        console.warn('[portal] GitHub роли недоступны, локальный режим:', e.message);
      }
    }
    _rolesCache = localRoles();
    return _rolesCache;
  }

  function roles() {
    if (_rolesCache) return _rolesCache;
    _rolesCache = localRoles();
    return _rolesCache;
  }

  function saveRoles(list) {
    _rolesCache = list;
    saveLocalRoles(list);
  }

  /* ---------- Сессия ---------- */
  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }
  function setSession(role) {
    const sess = { roleId: role.id, login: role.login, name: role.name, ts: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    return sess;
  }
  function logout() { localStorage.removeItem(SESSION_KEY); }

  function currentRole() {
    const s = session();
    if (!s) return null;
    return roles().find(r => r.id === s.roleId) || null;
  }

  function can(perm) {
    const r = currentRole();
    return !!(r && r.perms && r.perms[perm]);
  }

  /* ---------- Вход ---------- */
  async function login(loginValue, pwd) {
    const lg = String(loginValue).trim();
    const hash = hashPwd(pwd);
    if (useGH()) {
      try {
        const { list } = await loadRolesGH();
        _rolesCache = list;
        const role = list.find(r => r.login.toLowerCase() === lg.toLowerCase());
        if (!role) return { ok: false, error: 'Пользователь не найден' };
        if (role.pwdHash !== hash) return { ok: false, error: 'Неверный пароль' };
        return { ok: true, role, sess: setSession(role), via: 'github' };
      } catch (e) {
        console.warn('[portal] GitHub вход не сработал, локальный:', e.message);
      }
    }
    const role = localRoles().find(r => r.login.toLowerCase() === lg.toLowerCase());
    if (!role) return { ok: false, error: 'Пользователь не найден' };
    if (role.pwdHash !== hash) return { ok: false, error: 'Неверный пароль' };
    _rolesCache = localRoles();
    return { ok: true, role, sess: setSession(role), via: 'local' };
  }

  /* ---------- Роли: создание/удаление ---------- */
  async function addRole({ login: lg, password, name, note, perms }) {
    const loginNorm = String(lg).trim().toLowerCase();
    if (!loginNorm) return { ok: false, error: 'Укажите логин' };
    if (!password) return { ok: false, error: 'Укажите пароль' };

    if (useGH()) {
      try {
        return await roleEnqueue(async () => {
          const { list, sha } = await loadRolesGH();
          if (list.some(r => r.login.toLowerCase() === loginNorm)) {
            return { ok: false, error: 'Такой логин уже занят' };
          }
          const role = {
            id: 'role_' + Date.now().toString(36),
            login: String(lg).trim(),
            pwdHash: hashPwd(password),
            name: String(name || lg).trim(),
            note: String(note || '').trim(),
            builtin: false,
            perms: perms || {},
          };
          const next = list.concat([role]);
          await GH.writeFile(ROLES_PATH, JSON.stringify(next, null, 2), 'Новая роль: ' + role.name, sha);
          _rolesCache = next;
          return { ok: true, role };
        });
      } catch (e) {
        return { ok: false, error: 'GitHub: ' + e.message };
      }
    }

    const list = localRoles();
    if (list.some(r => r.login.toLowerCase() === loginNorm)) return { ok: false, error: 'Такой логин уже занят' };
    const role = {
      id: 'role_' + Date.now().toString(36),
      login: String(lg).trim(),
      pwdHash: hashPwd(password),
      name: String(name || lg).trim(),
      note: String(note || '').trim(),
      builtin: false,
      perms: perms || {},
    };
    list.push(role);
    saveRoles(list);
    return { ok: true, role };
  }

  async function deleteRole(id) {
    const role = roles().find(r => r.id === id);
    if (!role) return { ok: false, error: 'Роль не найдена' };
    if (role.builtin) return { ok: false, error: 'Встроенную роль удалить нельзя' };

    if (useGH()) {
      try {
        return await roleEnqueue(async () => {
          const { list, sha } = await loadRolesGH();
          const next = list.filter(r => r.id !== id);
          await GH.writeFile(ROLES_PATH, JSON.stringify(next, null, 2), 'Удалена роль: ' + role.name, sha);
          _rolesCache = next;
          return { ok: true };
        });
      } catch (e) {
        return { ok: false, error: 'GitHub: ' + e.message };
      }
    }

    saveRoles(localRoles().filter(r => r.id !== id));
    return { ok: true };
  }

  /* ---------- Иконки ---------- */
  const ICONS = {
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.2" r="3.6"/><path d="M4.5 20 a7.5 7.5 0 0 1 15 0"/></svg>',
    key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="14.5" r="4.2"/><path d="M11 11.5 L20 2.5"/><path d="M16.5 6 l3 3"/><path d="M13.5 9 l2.2 2.2"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 4.5 v15"/><path d="M4.5 12 h15"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 16 V4"/><path d="M6.5 9.5 L12 4 L17.5 9.5"/><path d="M4 20 h16"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6 3 h9 l4 4 v14 a1.5 1.5 0 0 1-1.5 1.5 h-11 A1.5 1.5 0 0 1 5 21 V4.5 A1.5 1.5 0 0 1 6.5 3 Z"/><path d="M14.5 3 V7.5 H19"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7 h16"/><path d="M9.5 7 V4.8 a1 1 0 0 1 1-1 h3 a1 1 0 0 1 1 1 V7"/><path d="M6.5 7 l1 13.2 a1 1 0 0 0 1 .8 h7 a1 1 0 0 0 1-.8 L17.5 7"/><path d="M10 11 v6"/><path d="M14 11 v6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M4 12.5 L9.5 18 L20 6.5"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5 V7.8 a4 4 0 0 1 8 0 v2.7"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M14 4 H6.5 a2 2 0 0 0-2 2 v12 a2 2 0 0 0 2 2 H14"/><path d="M10 12 h10.5"/><path d="M16.5 7.5 L21 12 l-4.5 4.5"/></svg>',
  };
  function icon(name) { return ICONS[name] || ''; }

  /* ---------- Модалки ---------- */
  function openModal({ title, bodyHTML, footerHTML, onOpen, wide }) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'p-modal';
    wrap.innerHTML = `
      <div class="p-modal-backdrop"></div>
      <div class="p-modal-dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
        <div class="p-modal-header">
          <h3></h3>
          <button class="p-modal-close" aria-label="Закрыть">✕</button>
        </div>
        <div class="p-modal-body">${bodyHTML}</div>
        ${footerHTML ? `<div class="p-modal-footer">${footerHTML}</div>` : ''}
      </div>`;
    wrap.querySelector('h3').textContent = title;
    document.body.appendChild(wrap);
    const close = () => closeModal();
    wrap.querySelector('.p-modal-backdrop').addEventListener('click', close);
    wrap.querySelector('.p-modal-close').addEventListener('click', close);
    wrap._escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', wrap._escHandler);
    if (onOpen) onOpen(wrap, close);
    const first = wrap.querySelector('input,select,textarea,button:not(.p-modal-close)');
    if (first) setTimeout(() => first.focus(), 30);
    return wrap;
  }

  function closeModal() {
    const old = document.querySelector('.p-modal');
    if (old) {
      document.removeEventListener('keydown', old._escHandler || (() => {}));
      old.remove();
    }
  }

  function toast(msg, isError) {
    const old = document.querySelector('.p-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'p-toast' + (isError ? ' error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3200);
  }

  /* ---------- Модалка входа ---------- */
  function openLoginModal(onSuccess) {
    openModal({
      title: 'Вход на портал',
      bodyHTML: `
        <div class="p-field">
          <label for="pLoginUser">Логин</label>
          <input type="text" id="pLoginUser" autocomplete="username" placeholder="Ваш логин">
        </div>
        <div class="p-field">
          <label for="pLoginPass">Пароль</label>
          <input type="password" id="pLoginPass" autocomplete="current-password" placeholder="Ваш пароль">
        </div>
        <div class="p-error" id="pLoginErr"></div>
        <div class="p-hint">Доступ выдаёт администратор. Если забыли пароль — обратитесь к администратору портала.</div>`,
      footerHTML: `<button class="btn-p primary" id="pLoginGo">${icon('lock')} Войти</button>`,
      onOpen(wrap, close) {
        const user = wrap.querySelector('#pLoginUser');
        const pass = wrap.querySelector('#pLoginPass');
        const err = wrap.querySelector('#pLoginErr');
        const go = wrap.querySelector('#pLoginGo');
        const submit = async () => {
          err.textContent = '';
          go.disabled = true;
          go.textContent = 'Вход…';
          const res = await login(user.value, pass.value);
          go.disabled = false;
          go.innerHTML = icon('lock') + ' Войти';
          if (!res.ok) { err.textContent = res.error; return; }
          close();
          toast('Вы вошли как ' + (res.role.name || res.role.login) + (res.via === 'github' ? '' : ' (демо-режим)'));
          if (onSuccess) onSuccess(res.role);
        };
        go.addEventListener('click', submit);
        pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        user.addEventListener('keydown', (e) => { if (e.key === 'Enter') pass.focus(); });
      }
    });
  }

  return {
    SECTIONS, fullPerms, hashPwd,
    roles, saveRoles, rolesAsync,
    login, logout, session, currentRole, can,
    addRole, deleteRole,
    icon, openModal, closeModal, toast, openLoginModal,
    useGH,
  };
})();
