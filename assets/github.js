/* GitHub-интеграция: автокоммит документов и ролей в репозиторий. */
const GH = (() => {
  const cfg = window.GH_CONFIG || {};
  const API = 'https://api.github.com';
  // Токен: приоритет у введённого админом (localStorage), затем GH_CONFIG.
  // Токен из GH_CONFIG может устареть — свежий, введённый кнопкой
  // «GitHub токен», должен перекрывать устаревший.
  const lsToken = localStorage.getItem('gh_token') || '';
  const token = lsToken || (cfg.token !== 'GITHUB_TOKEN_HERE' ? cfg.token : '');
  // Живость токена выясняется по ответу GitHub: 401 означает, что токен
  // истёк или отозван. Пока 401 не было — считаем живым; после — перестаём
  // отправлять его, чтобы чтение публичного репозитория не отваливалось
  // и опубликованные документы не пропадали из списка.
  let tokenAlive = !!token;
  // Чтение публичного репозитория токена не требует
  const readReady = !!(cfg.owner && cfg.repo);
  const base = `${API}/repos/${cfg.owner}/${cfg.repo}`;
  const branch = cfg.branch || 'main';

  const TOKEN_DEAD_MSG = 'GitHub-токен недействителен (истёк или отозван). Нажмите кнопку «GitHub токен» и введите новый.';

  async function req(method, url, body, skipAuth) {
    const useTok = !skipAuth && token && tokenAlive;
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
    if (useTok) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    // Токен отвергнут GitHub: помечаем мёртвым и убираем из хранилища,
    // чтобы кнопка «GitHub токен» снова появилась и можно было ввести новый.
    if (r.status === 401 && useTok) {
      tokenAlive = false;
      try { localStorage.removeItem('gh_token'); } catch (e) { /* приватный режим */ }
      // Публичное чтение повторяем без токена — документы не должны пропадать
      if (method === 'GET') return req(method, url, body, true);
      throw new Error(TOKEN_DEAD_MSG);
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `HTTP ${r.status}`);
    }
    return r.json();
  }

  async function getFile(path) {
    try {
      return await req('GET', `${base}/contents/${path}?ref=${branch}`);
    } catch (e) {
      if (e.message.includes('404') || e.message === 'Not Found') return null;
      throw e;
    }
  }

  async function readJSON(path) {
    const f = await getFile(path);
    if (!f) return null;
    const u8 = Uint8Array.from(atob(f.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    return { json: JSON.parse(new TextDecoder('utf-8').decode(u8)), sha: f.sha };
  }

  function u8ToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  async function writeFile(path, content, message, sha) {
    const u8 = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return req('PUT', `${base}/contents/${path}`, {
      message, content: u8ToB64(u8), branch, ...(sha ? { sha } : {})
    });
  }

  async function deleteFile(path, message, sha) {
    return req('DELETE', `${base}/contents/${path}`, { message, sha, branch });
  }

  async function fileToU8(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  async function test() {
    return req('GET', `${base}`);
  }

  function setToken(t) {
    localStorage.setItem('gh_token', t);
    location.reload();
  }

  function hasToken() {
    return !!(token && tokenAlive);
  }

  return {
    // ready динамический: становится false, как только GitHub отверг токен,
    // поэтому раздел сразу честно показывает «Офлайн» и кнопку ввода токена
    get ready() { return !!(cfg.owner && cfg.repo && token && tokenAlive); },
    readReady,
    base, branch, readJSON, writeFile, deleteFile, getFile, fileToU8, test, u8ToB64, setToken, hasToken
  };
})();
