/* GitHub-интеграция: автокоммит документов и ролей в репозиторий. */
const GH = (() => {
  const cfg = window.GH_CONFIG || {};
  const API = 'https://api.github.com';
  // Токен: из GH_CONFIG, или из localStorage (вводится один раз админом)
  const token = cfg.token !== 'GITHUB_TOKEN_HERE' ? cfg.token : (localStorage.getItem('gh_token') || '');
  const ready = !!(cfg.owner && cfg.repo && token);
  const base = `${API}/repos/${cfg.owner}/${cfg.repo}`;
  const branch = cfg.branch || 'main';

  async function req(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
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
    return !!token;
  }

  return { ready, base, branch, readJSON, writeFile, deleteFile, getFile, fileToU8, test, u8ToB64, setToken, hasToken };
})();
