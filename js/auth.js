/* ============================================================
   auth.js — вход/выход, сессия, роли
   ВНИМАНИЕ: хэш пароля здесь — НЕ настоящая защита, только
   разграничение интерфейса в демо. Реальная защита — в серверной версии.
   ============================================================ */

const Auth = (() => {
  const SESSION_KEY = 'parks_session';

  // Простой FNV-1a хэш (детерминированный, без зависимостей).
  // Подходит только для демо-разграничения интерфейса.
  function hashPwd(pwd) {
    let h = 0x811c9dc5;
    for (let i = 0; i < pwd.length; i++) {
      h ^= pwd.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
    catch { return null; }
  }

  async function login(loginValue, pwdValue) {
    const users = await DB.getAll('users');
    const user = users.find(u => u.login.toLowerCase() === loginValue.trim().toLowerCase());
    if (!user) return { ok: false, error: 'Пользователь не найден' };
    if (user.pwdHash !== hashPwd(pwdValue)) return { ok: false, error: 'Неверный пароль' };
    const sess = { userId: user.id, role: user.role, name: user.name, parkId: user.parkId || null, ts: Date.now() };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    return { ok: true, user, sess };
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function current() { return session(); }

  function isDirector() { const s = current(); return s && s.role === 'director'; }
  function isManager()  { const s = current(); return s && s.role === 'manager'; }

  // Управляющий видит только свой парк; гендиректор — все.
  function visibleParkFilter() {
    const s = current();
    if (s && s.role === 'manager') return s.parkId;
    return null; // директор или нет сессии → без фильтра
  }

  async function currentUser() {
    const s = current();
    if (!s) return null;
    return await DB.getByKey('users', s.userId);
  }

  return { hashPwd, login, logout, current, currentUser, isDirector, isManager, visibleParkFilter };
})();
