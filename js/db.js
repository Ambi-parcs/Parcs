/* ============================================================
   db.js — слой данных (IndexedDB)
   Хранилища: parks, users, works, contracts, contractFiles,
              equipment, premises, documents, journals
   ============================================================ */

const DB = (() => {
  const DB_NAME = 'parks_control';
  const DB_VERSION = 6;

  // Метаданные хранилищ (keyPath + авто-ключ)
  const STORES = {
    parks:         { key: 'id' },
    users:         { key: 'id' },
    works:         { key: 'id', index: 'parkId', indexName: 'parkId' },
    contracts:     { key: 'id', index: 'parkId', indexName: 'parkId' },
    contractFiles: { key: 'id' },           // {id, contractId, blob, name, size, uploadedAt}
    equipment:     { key: 'id', index: 'parkId', indexName: 'parkId' },
    premises:      { key: 'id', index: 'parkId', indexName: 'parkId' },
    documents:     { key: 'id', index: 'parkId', indexName: 'parkId' },
    journals:      { key: 'id', index: 'parkId', indexName: 'parkId' },
    files:         { key: 'id' },           // {id, name, size, type, ext, tags:[], note, blob, uploadedAt}
  };

  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const oldVer = e.oldVersion;
        for (const [name, conf] of Object.entries(STORES)) {
          // При апгрейде с версии <5 пересоздаём хранилища (исправления схемы/индексов/имен).
          // Данные пересоздаются демо-сидом при необходимости.
          // ВАЖНО: files (с версии 6) НЕ пересоздаётся — миграция идёт мягко, без потери данных.
          const isLegacyRebuild = oldVer < 5 && name !== 'files';
          if (db.objectStoreNames.contains(name) && isLegacyRebuild) {
            db.deleteObjectStore(name);
          }
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: conf.key });
            if (conf.index) {
              store.createIndex(conf.indexName, conf.index, { unique: false });
            }
          }
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function _tx(store, mode = 'readonly') {
    return _db.transaction(store, mode).objectStore(store);
  }

  function req2promise(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  }

  // ---- Универсальные CRUD ----
  async function getAll(store) {
    await ensureOpen();
    return req2promise(_tx(store).getAll());
  }

  async function getByKey(store, id) {
    await ensureOpen();
    return req2promise(_tx(store).get(id));
  }

  async function put(store, obj) {
    await ensureOpen();
    if (!obj.id) obj.id = uid();
    return req2promise(_tx(store, 'readwrite').put(obj)).then(() => obj);
  }

  async function bulkPut(store, arr) {
    await ensureOpen();
    const tx = _db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    arr.forEach(o => { if (!o.id) o.id = uid(); os.put(o); });
    return new Promise((res, rej) => { tx.oncomplete = () => res(arr); tx.onerror = () => rej(tx.error); });
  }

  async function remove(store, id) {
    await ensureOpen();
    return req2promise(_tx(store, 'readwrite').delete(id));
  }

  async function clearAll() {
    await ensureOpen();
    const names = Object.keys(STORES);
    const tx = _db.transaction(names, 'readwrite');
    names.forEach(n => tx.objectStore(n).clear());
    return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }

  async function getByIndex(store, indexName, value) {
    await ensureOpen();
    return req2promise(_tx(store).index(indexName).getAll(value));
  }

  // ---- Работа с файлами PDF ----
  async function saveFile(meta, blob) {
    await ensureOpen();
    const rec = { id: uid(), ...meta, blob, uploadedAt: Date.now() };
    await req2promise(_tx('contractFiles', 'readwrite').put(rec));
    return rec;
  }

  async function getFile(id) {
    await ensureOpen();
    return req2promise(_tx('contractFiles').get(id));
  }

  async function getFilesByContract(contractId) {
    await ensureOpen();
    const all = await req2promise(_tx('contractFiles').getAll());
    return all.filter(f => f.contractId === contractId);
  }

  async function deleteFile(id) {
    await ensureOpen();
    return req2promise(_tx('contractFiles', 'readwrite').delete(id));
  }

  // ---- Произвольные файлы (store "files", с версии 6) ----
  // rec: {id?, name, size, type, ext, tags:[], note?, blob}
  async function saveFileRecord(rec, blob) {
    await ensureOpen();
    const record = {
      id: rec.id || uid(),
      name: rec.name,
      size: rec.size,
      type: rec.type,
      ext: rec.ext,
      tags: Array.isArray(rec.tags) ? rec.tags : [],
      note: rec.note || '',
      blob,
      uploadedAt: rec.uploadedAt || Date.now(),
    };
    await req2promise(_tx('files', 'readwrite').put(record));
    return record;
  }

  async function getFileRecord(id) {
    await ensureOpen();
    return req2promise(_tx('files').get(id));
  }

  async function getAllFiles() {
    await ensureOpen();
    return req2promise(_tx('files').getAll());
  }

  async function updateFileRecord(id, patch) {
    await ensureOpen();
    const rec = await req2promise(_tx('files').get(id));
    if (!rec) return null;
    const updated = { ...rec, ...patch };
    await req2promise(_tx('files', 'readwrite').put(updated));
    return updated;
  }

  async function deleteFileRecord(id) {
    await ensureOpen();
    return req2promise(_tx('files', 'readwrite').delete(id));
  }

  async function ensureOpen() {
    if (!_db) await open();
  }

  // ---- Утилиты ----
  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  return {
    STORES, open, ensureOpen, uid,
    getAll, getByKey, put, bulkPut, remove, clearAll, getByIndex,
    saveFile, getFile, getFilesByContract, deleteFile,
    saveFileRecord, getFileRecord, getAllFiles, updateFileRecord, deleteFileRecord,
  };
})();
