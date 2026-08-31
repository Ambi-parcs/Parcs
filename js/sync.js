/* ============================================================
   sync.js — синхронизация данных раздела 1 через Vercel
   Загружает parks-data.json с сервера, мержит с локальными
   изменениями, сохраняет обратно.
   ============================================================ */

const Sync = (() => {
  const PROXY = window.VERCEL_PROXY || '';
  const SYNC_KEY = 'parks_last_sync_ts';
  let _syncing = false;

  function enabled() { return !!PROXY; }

  async function pull() {
    if (!enabled()) return null;
    const r = await fetch(`${PROXY}/api/sync`, { method: 'GET' });
    if (!r.ok) throw new Error('Sync pull failed: ' + r.status);
    const res = await r.json();
    return res.content || res;
  }

  async function push(data, message) {
    if (!enabled()) return null;
    const r = await fetch(`${PROXY}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, message }),
    });
    if (!r.ok) throw new Error('Sync push failed: ' + r.status);
    return r.json();
  }

  async function exportDB() {
    const out = {};
    for (const s of Object.keys(DB.STORES)) {
      out[s] = await DB.getAll(s);
    }
    out.files_meta = (await DB.getAllFiles()).map(f => ({
      id: f.id, name: f.name, size: f.size, type: f.type, ext: f.ext,
      tags: f.tags, note: f.note, uploadedAt: f.uploadedAt,
    }));
    return out;
  }

  async function importDB(remote, strategy = 'merge') {
    for (const s of Object.keys(DB.STORES)) {
      if (s === 'files' || s === 'contractFiles') continue;
      const remoteData = remote[s] || [];
      if (!remoteData.length) continue;

      if (strategy === 'replace') {
        await DB.clear(s);
        await DB.bulkPut(s, remoteData);
      } else {
        const local = await DB.getAll(s);
        const localMap = new Map(local.map(x => [x.id, x]));
        const merged = [];
        for (const r of remoteData) {
          const l = localMap.get(r.id);
          if (!l) {
            merged.push(r);
          } else {
            const rTime = r.ts || r.createdAt || r.uploadedAt || 0;
            const lTime = l.ts || l.createdAt || l.uploadedAt || 0;
            merged.push(rTime > lTime ? r : l);
          }
        }
        const remoteIds = new Set(remoteData.map(x => x.id));
        for (const l of local) {
          if (!remoteIds.has(l.id)) merged.push(l);
        }
        await DB.clear(s);
        await DB.bulkPut(s, merged);
      }
    }
  }

  async function sync() {
    if (_syncing) return { ok: false, error: 'Sync already in progress' };
    if (!enabled()) return { ok: false, error: 'Vercel proxy not configured' };

    _syncing = true;
    try {
      let remote = null;
      try { remote = await pull(); } catch (e) { remote = null; }
      if (remote && remote.parks) await importDB(remote, 'merge');
      const local = await exportDB();
      local.version = 1;
      local.updatedAt = new Date().toISOString();
      local.syncedBy = Auth.current() ? Auth.current().name : 'unknown';
      await push(local, `Sync: ${local.syncedBy} @ ${new Date().toLocaleString('ru-RU')}`);
      localStorage.setItem(SYNC_KEY, String(Date.now()));
      return { ok: true, message: 'Синхронизировано' };
    } catch (err) {
      console.error('Sync error:', err);
      return { ok: false, error: err.message };
    } finally {
      _syncing = false;
    }
  }

  async function load() {
    if (!enabled()) return { ok: false, error: 'Vercel proxy not configured' };
    try {
      const remote = await pull();
      if (remote && remote.parks && remote.parks.length) {
        await importDB(remote, 'merge');
        return { ok: true, message: 'Данные загружены с сервера' };
      }
      return { ok: true, message: 'Нет данных на сервере' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function lastSync() {
    const ts = localStorage.getItem(SYNC_KEY);
    return ts ? new Date(+ts) : null;
  }

  function renderSyncButton() {
    if (!enabled()) return '';
    const last = lastSync();
    const label = last ? `🔄 ${last.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '🔄 Синхронизировать';
    return `<button id="syncBtn" class="btn btn-ghost btn-sm" onclick="Sync.doSync()" title="Синхронизировать данные с сервером">${label}</button>`;
  }

  async function doSync() {
    const btn = document.getElementById('syncBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Синхронизация…'; }
    const res = await sync();
    if (btn) {
      btn.disabled = false;
      btn.textContent = res.ok ? '✅ ' + res.message : '❌ ' + res.error;
      setTimeout(() => { btn.textContent = renderSyncButton().replace(/<[^>]+>/g, ''); }, 2000);
    }
    if (res.ok && window.App) {
      App.renderNavParks();
      App.route();
    }
    return res;
  }

  return { enabled, sync, load, pull, push, lastSync, renderSyncButton, doSync };
})();
