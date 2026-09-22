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
    const colPages = [];

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Склеиваем текст с сохранением строк (по координате Y)
      const lines = groupIntoLines(content.items);
      text += lines.join('\n') + '\n';
      // Дополнительно — колоночное представление (для реквизитов «ЗАКАЗЧИК | ПОДРЯДЧИК»)
      colPages.push(splitLinesByColumn(content.items));
      if (onProgress) onProgress(i / totalPages);
    }

    return {
      text,
      pageCount: totalPages,
      contractNo: parseContractNo(text),
      parties: parseParties(text, colPages),
      payments: parsePayments(text),
      schedule: parseSchedule(text),
      subject:  parseSubject(text),
      rawExcerpt: text.slice(0, 1500),
    };
  }

  // Разбивает текст страницы на строки с сохранением позиций частей.
  // Границу колонок ищем в parseParties по строке-заголовку «ЗАКАЗЧИК | ПОДРЯДЧИК» —
  // она надёжнее фиксированной середины страницы (колонки могут начинаться левее центра).
  function splitLinesByColumn(items) {
    return groupRows(items);
  }

  // Группировка текстовых элементов в строки по Y-координате (части сохраняются)
  function groupRows(items) {
    const rows = [];
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x: it.transform[4], str: it.str });
    }
    rows.sort((a, b) => b.y - a.y); // сверху вниз
    return rows;
  }
  function joinParts(parts) {
    return parts.slice().sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim();
  }
  function groupIntoLines(items) {
    return groupRows(items).map(r => joinParts(r.parts)).filter(Boolean);
  }

  // ============ НОМЕР ДОГОВОРА ============
  function parseContractNo(text) {
    const norm = text.replace(/[ \t]+/g, ' ');
    const m = norm.match(/(?:договор(?:\s+подряда|\s+оказания\s+услуг|\s+поставки)?|соглашение)[^0-9№]{0,25}№?\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-\/\\]{0,19})/i);
    return m ? m[1].trim() : '';
  }

  // ============ РЕКВИЗИТЫ СТОРОН ============
  function parseParties(text, colPages) {
    const out = { customer: {}, contractor: {} };
    const norm = text.replace(/[ \t]+/g, ' ');
    const fromBlock = (block, pattern) => { const m = block.match(pattern); return m ? (m[1]||m[0]).trim() : null; };
    // Адрес часто идёт одной строкой с телефоном («Адрес: ..., тел. ...») — отрезаем телефон
    const addrFrom = (block) => {
      const a = fromBlock(block, /(?:Адрес|Юр\.?\s*адрес)[:\s]*([^\n]{5,80})/i);
      return a ? a.split(/[,;]\s*[Тт]ел|(?<=\d)\s*тел\./)[0].trim() : null;
    };
    const bankFrom = (block) => {
      // «Банк: …». \b не работает с кириллицей — используем литеральные lookaround'ы,
      // чтобы «Банка ВТБ» не давало ложное срабатывание.
      let bank = fromBlock(block, /(?<![А-Яа-яЁёA-Za-z])Банк(?![А-Яа-яЁёa-z])[:\s]*([^\n]{2,60})/i);
      if (!bank) {
        bank = fromBlock(block, /Банка\s+([А-ЯA-Z0-9«»\-\s().]{2,30})/i);
        if (bank) bank = bank.split(/\s*г\./)[0].trim();
      }
      const account = fromBlock(block, /(?:р\/с|к\/с|Номер\s+сч[её]та|расч[её]тный\s+сч[её]т)[:\s№]*(\d{16,20})/i);
      const bic = fromBlock(block, /БИК[:\s]*(\d{9})/i);
      return { bank, account, bic };
    };

    // Имя стороны ищем построчно: строки про банк пропускаем (иначе АО «АЛЬФА-БАНК»
    // выигрывает у имени ИП), приоритет у имён ИП — они идут первой строкой колонки.
    const nameFrom = (block) => {
      for (const ln of (block || '').split('\n')) {
        if (/банк/i.test(ln)) continue;
        const m = firstMatch(ln, [
          /([А-ЯЁ]{3,}(?:\s+[А-ЯЁ]{2,}){0,2}\s*\(ИП\))/,                 // «ИСАК АНДРЕЙ ГЕОРГИЕВИЧ (ИП)»
          /ИП\s+([А-ЯЁ]{3,}(?:\s+[А-ЯЁ]{2,}){0,2})/i,
          /Индивидуальный\s+Предприниматель\s+([А-ЯЁ]{3,}(?:\s+[А-ЯЁ]{2,}){0,2})/i,
          /((?:ООО|АО|ОАО|ЗАО|ПАО)\s*[«"][^«"»\n]{2,60}[»"])/,
          /((?:ООО|АО|ОАО|ЗАО|ПАО)\s+[А-ЯA-Z0-9][А-ЯA-Za-z0-9 «»\-.&]{1,60})/,
        ]);
        if (m) return m;
      }
      return '';
    };

    // --- Шаг 1: блок «РЕКВИЗИТЫ СТОРОН» в конце договора — самый надёжный источник.
    // Роли ищем по строкам «Заказчик:» / «Исполнитель:» / «Подрядчик:», продолжение
    // блока (адрес на следующей строке) присоединяем, пока не встретится другая роль.
    const reqIdx = norm.toLowerCase().lastIndexOf('реквизит');
    if (reqIdx >= 0) {
      const lines = norm.slice(reqIdx).split('\n');
      const roleRes = [
        ['customer',   /^\s*заказчик\s*:/i],
        ['contractor', /^\s*(?:исполнитель|подрядчик)\s*:/i],
      ];
      const chunks = { customer: [], contractor: [] };
      let cur = null;
      for (const ln of lines) {
        let roleLine = false;
        for (const [key, re] of roleRes) {
          if (re.test(ln)) {
            cur = key; roleLine = true;
            chunks[key].push(ln.replace(/^\s*(?:заказчик|исполнитель|подрядчик)\s*:\s*/i, ''));
            break;
          }
        }
        if (!roleLine && cur) chunks[cur].push(ln);
      }
      const custBlock = chunks.customer.join('\n').trim();
      const conBlock  = chunks.contractor.join('\n').trim();
      if (custBlock || conBlock) {
        out.customer.name     = nameFrom(custBlock);
        out.customer.inn      = fromBlock(custBlock, /ИНН[:\s]*(\d{8,12})/i);
        out.customer.kpp      = fromBlock(custBlock, /КПП[:\s]*(\d{6,9})/i);
        out.customer.ogrn     = fromBlock(custBlock, /ОГРН[:\s]*(\d{10,15})/i);
        out.customer.address  = addrFrom(custBlock);
        Object.assign(out.customer, bankFrom(custBlock));
        out.contractor.name   = nameFrom(conBlock);
        out.contractor.inn    = fromBlock(conBlock, /ИНН[:\s]*(\d{8,12})/i);
        out.contractor.kpp    = fromBlock(conBlock, /КПП[:\s]*(\d{6,9})/i);
        out.contractor.ogrn   = fromBlock(conBlock, /ОГРН[:\s]*(\d{10,15})/i);
        out.contractor.address = addrFrom(conBlock);
        out.contractor.phone  = fromBlock(conBlock, /[Тт]ел(?:\.|ефон)?[:\s]*(\+?\d[\d\s\-\(\)]{6,18}\d)/);
        Object.assign(out.contractor, bankFrom(conBlock));
        if (out.customer.name || out.contractor.name) return out;
      }
    }

    // --- Шаг 1.5: двухколоночный блок подписей «ЗАКАЗЧИК | ПОДРЯДЧИК» ---
    // Типично для договоров с ИП: реквизиты идут двумя колонками без слов «Заказчик:»,
    // в плоском тексте колонки склеены. Границу колонок берём из самой строки-заголовка
    // (самый большой разрыв между словами) — фиксированная середина страницы ненадёжна,
    // колонки могут начинаться левее центра.
    if (colPages) {
      for (const pageRows of colPages) {
        let hdrIdx = -1, boundary = 0;
        for (let i = 0; i < pageRows.length; i++) {
          const all = pageRows[i].parts.map(p => p.str).join(' ');
          if (all.length <= 40 && /заказчик/i.test(all) && /подрядчик|исполнитель/i.test(all)
            && !/именуем|обязуется/i.test(all)) {
            const parts = pageRows[i].parts.slice().sort((a, b) => a.x - b.x);
            let gapAt = 0, gapMax = 0;
            for (let j = 1; j < parts.length; j++) {
              const g = parts[j].x - parts[j - 1].x;
              if (g > gapMax) { gapMax = g; gapAt = j; }
            }
            if (gapAt > 0) {
              hdrIdx = i;
              boundary = (parts[gapAt - 1].x + parts[gapAt].x) / 2;
            }
            break;
          }
        }
        if (hdrIdx < 0) continue;
        const custLines = [], conLines = [];
        for (const r of pageRows.slice(hdrIdx + 1)) {
          const L = [], R = [];
          for (const p of r.parts) (p.x < boundary ? L : R).push(p);
          if (L.length) custLines.push(joinParts(L));
          if (R.length) conLines.push(joinParts(R));
        }
        const custBlock = custLines.join('\n');
        const conBlock  = conLines.join('\n');
        // адрес в колонке может переноситься на следующие строки — собираем с продолжениями
        const colAddress = (block) => {
          const m = block.match(/(Юридический адрес|Почтовый адрес|Адрес получателя|Адрес)\s*[:\s]*([^\n]+)/i);
          if (!m) return null;
          const label = m[1];
          let val = m[2].trim();
          const lines = block.split('\n');
          const start = lines.findIndex(l => l.indexOf(label) >= 0);
          for (let i = start + 1; i < Math.min(start + 4, lines.length); i++) {
            const ln = lines[i].trim();
            if (/^(ИНН|КПП|ОГРН|Банк|БИК|Кор\.?|р\/с|к\/с|Номер|Валюта|Название|Подпись|\/|Почтовый|Юридический|Адрес)/i.test(ln)) break;
            if (ln) val += ' ' + ln;
          }
          return val.split(/[,;]\s*[Тт]ел/)[0].trim();
        };
        const cust = {
          name: nameFrom(custBlock),
          inn: fromBlock(custBlock, /ИНН[:\s]*(\d{10,12})/i),
          kpp: fromBlock(custBlock, /КПП[:\s]*(\d{6,9})/i),
          ogrn: fromBlock(custBlock, /ОГРН[:\s]*(\d{10,15})/i),
          address: colAddress(custBlock),
          ...bankFrom(custBlock),
        };
        const contr = {
          name: nameFrom(conBlock),
          inn: fromBlock(conBlock, /ИНН[:\s]*(\d{10,12})/i),
          kpp: fromBlock(conBlock, /КПП[:\s]*(\d{6,9})/i),
          ogrn: fromBlock(conBlock, /ОГРН[:\s]*(\d{10,15})/i),
          address: colAddress(conBlock),
          phone: fromBlock(conBlock, /[Тт]ел(?:\.|ефон)?[:\s]*(\+?\d[\d\s\-\(\)]{6,18}\d)/),
          ...bankFrom(conBlock),
        };
        out.customer = cust;
        out.contractor = contr;
        if (cust.name || contr.name) return out;
      }
    }

    // --- Шаг 2 (fallback): эвристики по всему тексту.
    // Берём ПОСЛЕДНЕЕ вхождение роли с двоеточием (это блок реквизитов, а не предмет договора)
    // и режем его по следующей строке-роли, чтобы не захватить чужие данные.
    const partyColonBlock = (role) => {
      const re = new RegExp(role + '\\s*:', 'gi');
      let idx = -1, m;
      while ((m = re.exec(norm)) !== null) idx = m.index;
      if (idx < 0) return '';
      const tail = norm.slice(idx);
      const stop = tail.search(/\n\s*(?:заказчик|исполнитель|подрядчик)\s*:/i);
      return stop > 0 ? tail.slice(0, stop) : tail.slice(0, 400);
    };
    const custBlock2 = partyColonBlock('заказчик');
    const conBlock2  = partyColonBlock('(?:исполнитель|подрядчик)');

    out.customer.name   = out.customer.name   || nameFrom(custBlock2) || firstMatch(norm, [/Заказчик[^\n]*?["«]([^"»]+)["»]/i]);
    out.customer.inn     = out.customer.inn     || fromBlock(custBlock2, /ИНН[:\s]*(\d{8,12})/i);
    out.customer.kpp     = out.customer.kpp     || fromBlock(custBlock2, /КПП[:\s]*(\d{6,9})/i);
    out.customer.ogrn    = out.customer.ogrn    || fromBlock(custBlock2, /ОГРН[:\s]*(\d{10,15})/i);
    out.customer.address = out.customer.address || addrFrom(custBlock2);

    out.contractor.name = out.contractor.name || nameFrom(conBlock2) || firstMatch(norm, [/(?:Исполнитель|Подрядчик)[^\n]*?["«]([^"»]+)["»]/i]);
    out.contractor.inn     = out.contractor.inn     || fromBlock(conBlock2, /ИНН[:\s]*(\d{8,12})/i);
    out.contractor.kpp     = out.contractor.kpp     || fromBlock(conBlock2, /КПП[:\s]*(\d{6,9})/i);
    out.contractor.ogrn    = out.contractor.ogrn    || fromBlock(conBlock2, /ОГРН[:\s]*(\d{10,15})/i);
    out.contractor.address = out.contractor.address || addrFrom(conBlock2);
    out.contractor.phone   = out.contractor.phone   || fromBlock(conBlock2, /[Тт]ел(?:\.|ефон)?[:\s]*(\+?\d[\d\s\-\(\)]{6,18}\d)/);

    return out;
  }

  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ============ СУММА И ЭТАПЫ ОПЛАТЫ ============
  function parsePayments(text) {
    const out = { total: null, prepayPct: null, prepayAmount: null, finalPct: null, finalAmount: null, terms: '' };
    const norm = text.replace(/[ \t]+/g, ' ');

    // Общая сумма договора. Число может быть с разделителями и текстовой
    // расшифровкой в скобках: «485 000 (Четыреста восемьдесят пять тысяч) руб.».
    // Окно до числа — широкое: между словом «стоимость» и суммой часто длинная конструкция
    // («Стоимость всех работ и материалов, по данному Договору составляет …»).
    const moneyTail = '(\\d[\\d\\s.,]{1,20}?)\\s*(?:\\([^)]{1,120}\\)\\s*)?(?:руб|₽|р\\.)';
    const totalMatch = norm.match(new RegExp('(?:стоимост(?:ь|и)[^\\n]{0,90}?составляет|цена\\s+договора|сумма\\s+договора)[^0-9%]{0,60}?' + moneyTail, 'i'))
      || norm.match(new RegExp('(?:стоимость|цена|сумма)[^0-9%]{0,60}?' + moneyTail, 'i'));
    if (totalMatch) out.total = parseMoney(totalMatch[1]);

    // Процент предоплаты/аванса (с % или прописью «N процентов»)
    const prepayPct = norm.match(/(?:аванс|предоплата|предварительная\s*оплата)[^0-9%]{0,20}(\d{1,3})\s*(?:%|процентов?)/i);
    if (prepayPct) out.prepayPct = parseInt(prepayPct[1]);

    // Сумма аванса — окно [\s\S], т.к. между словом «аванс» и суммой может стоять
    // «(аванс) в размере 30% от цены договора —», а рядом с суммой — расшифровка в скобках.
    const prepayAmt = norm.match(/(?:аванс|предоплат\w*|предварительн\w+\s*оплат\w*)[\s\S]{0,140}?(\d[\d\s.,]{1,15}?)\s*(?:\([^)]{1,120}\)\s*)?(?:руб|₽|р\.)/i);
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

    // Порядок расчётов (контекстная фраза) — требуем двоеточие после заголовка,
    // чтобы не цеплять сам заголовок раздела («2. Стоимость работ и порядок расчётов»)
    const termsMatch = norm.match(/(?:порядок\s*расч[её]тов|условия\s*оплаты|порядок\s*оплаты)\s*:\s*([^\n]{20,400})/i);
    if (termsMatch) out.terms = termsMatch[1].trim();

    return out;
  }

  // ============ СРОКИ ============
  const WORD_MONTHS = { 'января':'01','февраля':'02','марта':'03','апреля':'04','мая':'05','июня':'06','июля':'07','августа':'08','сентября':'09','октября':'10','ноября':'11','декабря':'12' };
  function parseSchedule(text) {
    const out = { startDate: '', endDate: '', milestones: [] };
    const norm = text.replace(/[ \t]+/g, ' ');

    const start = norm.match(/(?:срок\s*начала|начало\s*работ|начать\s*выполнение|(?:начинаются|начинается)\s*(?:с\s*даты|в)|вступает\s*в\s*силу)[^0-9]{0,25}(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/i);
    if (start) out.startDate = normDate(start[1]);

    const end = norm.match(/(?:срок\s*окончания|срок\s*выполнения|окончание\s*работ|до|не\s*позднее)[^0-9]{0,15}(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})/i);
    if (end) out.endDate = normDate(end[1]);

    // Дата словами: «18» сентября 2026 г. (цифры в документе могут быть разряжены: «1 8», «202 6»)
    if (!out.startDate) {
      const wd = norm.match(/«\s*(\d(?:\s?\d)?)\s*»\s*(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s*(\d{4}|\d{3}\s?\d)/i);
      if (wd) {
        const y = wd[3].replace(/\s/g, '');
        const d = wd[1].replace(/\s/g, '').padStart(2, '0');
        out.startDate = `${y}-${WORD_MONTHS[wd[2].toLowerCase()]}-${d}`;
      }
    }

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
