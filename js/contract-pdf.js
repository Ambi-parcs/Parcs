/* ============================================================
   contract-pdf.js — извлечение данных из PDF-договоров
   Использует pdf.js (загружается с CDN в index.html).
   Достаёт 4 группы: реквизиты сторон, суммы/этапы оплаты,
   сроки, предмет договора и гарантии.
   ============================================================ */

const ContractPDF = (() => {

  // Настройка worker'а pdf.js (CDN-путь)
  function setupWorker() {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Библиотека pdf.js не загружена. Проверьте интернет-соединение.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // ---- Главный метод: PDF-файл → текст → структурированные данные ----
  async function extract(file, onProgress) {
    setupWorker();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const totalPages = pdf.numPages;
    let text = '';

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Склеиваем текст с сохранением строк (по координате Y)
      const lines = groupIntoLines(content.items);
      text += lines.join('\n') + '\n';
      if (onProgress) onProgress(i / totalPages);
    }

    return {
      text,
      pageCount: totalPages,
      parties: parseParties(text),
      payments: parsePayments(text),
      schedule: parseSchedule(text),
      subject:  parseSubject(text),
      rawExcerpt: text.slice(0, 1500),
    };
  }

  // Группировка текстовых элементов в строки по Y-координате
  function groupIntoLines(items) {
    const rows = [];
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x: it.transform[4], str: it.str });
    }
    rows.sort((a, b) => b.y - a.y); // сверху вниз
    return rows.map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim())
               .filter(Boolean);
  }

  // ============ РЕКВИЗИТЫ СТОРОН ============
  function parseParties(text) {
    const out = { customer: {}, contractor: {} };
    const norm = text.replace(/[ \t]+/g, ' ');

    // --- Шаг 1: блоки сторон в разделе реквизитов ---
    // В разделе «РЕКВИЗИТЫ СТОРОН» стороны перечислены явно:
    //   Заказчик: ООО «Название»   ...ИНН...
    //   Подрядчик: ООО «Название»  ...ИНН...
    // Берём ПОСЛЕДНИЙ такой блок для каждой роли (он самый полный).
    const partyBlock = (role) => {
      // блок = от «role:» до следующего вхождения другой роли или до конца раздела
      const re = new RegExp(role + '\\s*[: ]([^\\n]*(?:\\n[^\\n]*){0,6})', 'gi');
      let last = null, m;
      while ((m = re.exec(norm)) !== null) last = m[1];
      return last || '';
    };
    const custBlock = partyBlock('Заказчик');
    const conBlock  = partyBlock('(?:Исполнитель|Подрядчик)');

    // Название из блока (без \b — он не работает с кириллицей в JS)
    const nameFrom = (block) => firstMatch(block, [
      /["«]([^"»]{2,80})["»]/,
      /(ИП\s+[А-ЯЁ][А-ЯЁа-яё.\- ]{2,40})/,
      /(ООО\s+[А-ЯA-Z0-9][А-ЯA-Za-z0-9 «»\-.&]{1,60}|АО\s+[А-ЯA-Z0-9][А-ЯA-Za-z0-9 «»\-.&]{1,60})/,
    ]) || '';

    out.customer.name   = nameFrom(custBlock) || firstMatch(norm, [/Заказчик[^\n]*?["«]([^"»]+)["»]/i]);
    out.contractor.name = nameFrom(conBlock)  || firstMatch(norm, [/(?:Исполнитель|Подрядчик)[^\n]*?["«]([^"»]+)["»]/i]);

    // --- Шаг 2: реквизиты — из соответствующего блока (это надёжнее поиска «рядом») ---
    const fromBlock = (block, pattern) => { const m = block.match(pattern); return m ? (m[1]||m[0]).trim() : null; };
    out.customer.inn     = fromBlock(custBlock, /ИНН[:\s]*(\d{8,12})/i);
    out.customer.kpp     = fromBlock(custBlock, /КПП[:\s]*(\d{6,9})/i);
    out.customer.ogrn    = fromBlock(custBlock, /ОГРН[:\s]*(\d{10,15})/i);
    out.customer.address = fromBlock(custBlock, /(?:Адрес|Юр\.?\s*адрес)[:\s]*([^\n]{5,80})/i);

    out.contractor.inn     = fromBlock(conBlock, /ИНН[:\s]*(\d{8,12})/i);
    out.contractor.kpp     = fromBlock(conBlock, /КПП[:\s]*(\d{6,9})/i);
    out.contractor.ogrn    = fromBlock(conBlock, /ОГРН[:\s]*(\d{10,15})/i);
    out.contractor.address = fromBlock(conBlock, /(?:Адрес|Юр\.?\s*адрес)[:\s]*([^\n]{5,80})/i);
    out.contractor.phone   = fromBlock(conBlock, /[Тт]ел(?:\.|ефон)?[:\s]*(\+?\d[\d\s\-\(\)]{6,18}\d)/);

    return out;
  }

  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ============ СУММА И ЭТАПЫ ОПЛАТЫ ============
  function parsePayments(text) {
    const out = { total: null, prepayPct: null, prepayAmount: null, finalPct: null, finalAmount: null, terms: '' };
    const norm = text.replace(/[ \t]+/g, ' ');

    // Общая сумма договора
    const totalMatch = norm.match(/(?:стоимость|цена(?:\s*договора)?|сумма\s*договора)[^0-9]{0,15}([\d\s.,]+)\s*(?:руб|₽|р\.)/i);
    if (totalMatch) out.total = parseMoney(totalMatch[1]);

    // Процент предоплаты/аванса (с % или прописью «N процентов»)
    const prepayPct = norm.match(/(?:аванс|предоплата|предварительная\s*оплата)[^0-9%]{0,20}(\d{1,3})\s*(?:%|процентов?)/i);
    if (prepayPct) out.prepayPct = parseInt(prepayPct[1]);

    // Сумма аванса
    const prepayAmt = norm.match(/(?:аванс|предоплата)[^0-9]{0,30}([\d\s.,]+)\s*(?:руб|₽|р\.)/i);
    if (prepayAmt) out.prepayAmount = parseMoney(prepayAmt[1]);

    if (out.prepayPct == null && out.prepayAmount != null && out.total) {
      out.prepayPct = Math.round(out.prepayAmount / out.total * 100);
    }

    // Финальный расчёт
    const finalPct = norm.match(/(?:окончательн[ао][яй]\s*оплата|окончательный\s*расч[её]т|остаток)[^0-9%]{0,25}(\d{1,3})\s*%/i);
    if (finalPct) out.finalPct = parseInt(finalPct[1]);
    if (out.finalPct == null && out.prepayPct != null) out.finalPct = 100 - out.prepayPct;

    if (out.total != null) {
      if (out.prepayAmount == null && out.prepayPct != null) out.prepayAmount = Math.round(out.total * out.prepayPct / 100);
      if (out.finalAmount == null && out.finalPct != null) out.finalAmount = Math.round(out.total * out.finalPct / 100);
    }

    // Порядок расчётов (контекстная фраза)
    const termsMatch = norm.match(/(?:порядок\s*расч[её]тов|условия\s*оплаты|порядок\s*оплаты)[:\s]?([^\n]{20,400})/i);
    if (termsMatch) out.terms = termsMatch[1].trim();

    return out;
  }

  // ============ СРОКИ ============
  function parseSchedule(text) {
    const out = { startDate: '', endDate: '', milestones: [] };
    const norm = text.replace(/[ \t]+/g, ' ');

    const start = norm.match(/(?:срок\s*начала|начало\s*работ|начать\s*выполнение|(?:начинаются|начинается)\s*(?:с\s*даты|в)|вступает\s*в\s*силу)[^0-9]{0,25}(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/i);
    if (start) out.startDate = normDate(start[1]);

    const end = norm.match(/(?:срок\s*окончания|срок\s*выполнения|окончание\s*работ|до|не\s*позднее)[^0-9]{0,15}(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/i);
    if (end) out.endDate = normDate(end[1]);

    // Контрольные даты/этапы
    const msRe = /(?:этап|сдача|приемка|приёмка)[^0-9]{0,20}(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/gi;
    let m;
    while ((m = msRe.exec(norm)) !== null) {
      out.milestones.push({ date: normDate(m[1]), title: 'Этап работ' });
    }
    return out;
  }

  // ============ ПРЕДМЕТ И ГАРАНТИИ ============
  function parseSubject(text) {
    const out = { description: '', warranty: '', responsibility: '' };
    const norm = text.replace(/[ \t]+/g, ' ');

    const subj = norm.match(/(?:предмет\s*договора)[:\s]?([^\n]{30,500})/i);
    if (subj) out.description = subj[1].trim().slice(0, 400);

    const warranty = norm.match(/(?:гарантийн[ао][яй]\s*(?:обязательств|срок|качеств)|гарантия)[:\s]?([^\n]{20,400})/i);
    if (warranty) out.warranty = warranty[1].trim().slice(0, 400);

    const resp = norm.match(/(?:ответственность\s*сторон)[:\s]?([^\n]{20,400})/i);
    if (resp) out.responsibility = resp[1].trim().slice(0, 400);

    return out;
  }

  // ============ Вспомогательные ============
  function firstMatch(text, patterns) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return (m[1] || m[0]).trim();
    }
    return null;
  }
  // Поиск паттерна в окрестности ключевого слова.
  // last=true → ищем от ПОСЛЕДНЕГО вхождения якоря (надёжно для блока реквизитов внизу договора).
  function findNear(text, anchor, pattern, window = 400, last = false) {
    const re = new RegExp(anchor, 'gi');
    let idx = -1, am;
    while ((am = re.exec(text)) !== null) {
      idx = am.index;
      if (!last) break; // первое вхождение
    }
    if (idx < 0) return null;
    // Окно: немного назад (для «ИНН» на той же строке перед названием) + вперёд
    const slice = text.slice(Math.max(0, idx - 60), idx + window);
    const m = slice.match(pattern);
    return m ? (m[1] || m[0]).trim() : null;
  }
  function parseMoney(s) {
    return parseInt(String(s).replace(/[^\d]/g, '')) || null;
  }
  function normDate(s) {
    const p = s.split(/[.\-/]/);
    if (p.length < 3) return s;
    let [d, m, y] = p;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  return { extract, parseParties, parsePayments, parseSchedule, parseSubject };
})();
