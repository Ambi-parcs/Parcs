/* GitHub-интеграция: автокоммит документов и ролей в репозиторий.
   Токен берётся ТОЛЬКО из localStorage (введён админом через UI).
   В GH_CONFIG.token токен не задаётся — это исключает утечку в открытом коде.
   Репозиторий должен быть приватным, чтобы исключить чтение кода посторонними. */
const GH = (() => {
  const cfg = window.GH_CONFIG || {};
  const API = 'https://api.github.com';
  // Токен: ТОЛЬКО из localStorage. GH_CONFIG.token игнорируется.
  const token = localStorage.getItem('gh_token') || '';
  let tokenAlive = !!token;
  const readReady = !!(cfg.owner && cfg.repo);
  const base = `${API}/repos/${cfg.owner}/${cfg.repo}`;
  const branch = cfg.branch || 'main';

  const TOKEN_DEAD_MSG = 'GitHub-токен недействителен (истёк или отозван). Нажмите кнопку «GitHub токен» и введите новый.';
  const TOKEN_MISSING_MSG = 'GitHub-токен не задан. Нажмите кнопку «GitHub токен» в панели инструментов.';

  async function req(method, url, body, skipAuth) {
    const useTok = !skipAuth && token && tokenAlive;
    if (!useTok && method !== 'GET') {
      throw new Error(TOKEN_MISSING_MSG);
    }
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
    if (r.status === 401 && useTok) {
      tokenAlive = false;
      try { localStorage.removeItem('gh_token'); } catch (e) { /* приватный режим */ }
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
    let f;
    try {
      f = await getFile(path);
    } catch (e) {
      // Приватный репозиторий: анонимное чтение с GitHub Pages НЕ работает.
      // Если токен не задан или отвергнут — сообщаем об этом явно.
      if (!hasToken()) {
        throw new Error(TOKEN_MISSING_MSG);
      }
      throw e;
    }
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
    get ready() { return !!(cfg.owner && cfg.repo && token && tokenAlive); },
    readReady,
    base, branch, readJSON, writeFile, deleteFile, getFile, fileToU8, test, u8ToB64, setToken, hasToken
  };
})();
