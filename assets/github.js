/* ============================================================
   АмбиЛенд — интеграция с GitHub API
   Прямой коммит из браузера: документы и роли хранятся в репозитории,
   после push GitHub Pages пересобирает сайт (~1 мин) и изменения
   видны всем. Токен — fine-grained, только Contents+Pages одного репо.
   Конфиг — window.GH_CONFIG в index.html (owner, repo, branch, token).
   ============================================================ */

const GH = (() => {
  'use strict';

  const cfg = window.GH_CONFIG || {};
  const API = 'https://api.github.com';

  const ready = !!(cfg.owner && cfg.repo && cfg.token);
  const base = ready ? `${API}/repos/${cfg.owner}/${cfg.repo}` : null;
  const branch = cfg.branch || 'main';

  const headers = () => ({
    'Authorization': 'Bearer ' + cfg.token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });

  /* ---------- Низкий уровень ---------- */
  async function req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { ...headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 204) return { ok: true, status: 204 };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.message || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------- Файлы (Contents API) ---------- */
  // Метаданные файла (sha и пр.) или null, если файла нет
  async function getFile(path) {
    try {
      return await req('GET', `${base}/contents/${encodeURI(path)}?ref=${branch}`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // Прочитать файл (текст JSON → объект) или null, если нет
  async function readJSON(path) {
    try {
      const data = await req('GET', `${base}/contents/${encodeURI(path)}?ref=${branch}`);
      if (data.content == null) return null;
      const bin = atob(data.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      return { json: JSON.parse(text), sha: data.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // Записать файл (создать или обновить). content — строка (utf8) или Uint8Array.
  async function writeFile(path, content, message, sha) {
    let b64;
    if (content instanceof Uint8Array) {
      b64 = u8ToB64(content);
    } else {
      b64 = u8ToB64(new TextEncoder().encode(String(content)));
    }
    const body = { message, content: b64, branch };
    if (sha) body.sha = sha;
    const data = await req('PUT', `${base}/contents/${encodeURI(path)}`, body);
    return data;
  }

  async function deleteFile(path, message, sha) {
    return req('DELETE', `${base}/contents/${encodeURI(path)}`, { message, sha, branch });
  }

  function u8ToB64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  async function fileToU8(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  /* ---------- Проверка доступа ---------- */
  async function test() {
    if (!ready) return { ok: false, error: 'Не задан GH_CONFIG (owner/repo/token)' };
    try {
      const data = await req('GET', base);
      return { ok: true, repo: data.full_name, branch: data.default_branch };
    } catch (e) {
      return { ok: false, error: e.message, status: e.status };
    }
  }

  return {
    ready, base, branch,
    readJSON, writeFile, deleteFile, getFile, fileToU8, test, u8ToB64,
  };
})();
