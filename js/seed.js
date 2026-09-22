/* ============================================================
   seed.js — наполнение демонстрационными данными
   Запускается при первом открытии (если БД пуста) или по кнопке
   в Настройках.
   ============================================================ */

const Seed = (() => {

  // Этапы работ (каноничный порядок конвейера)
  const STAGES = [
    'problem',    // 1. Проблема выявлена
    'contractor', // 2. Подрядчик найден
    'contract',   // 3. Договор заключён
    'prepay',     // 4. Предоплата
    'doing',      // 5. Выполнение работ
    'accept',     // 6. Приёмка
    'final',      // 7. Окончательная оплата
    'done',       // 8. Завершено
  ];
  const STAGE_NAMES = {
    problem:'Проблема', contractor:'Подрядчик', contract:'Договор',
    prepay:'Предоплата', doing:'Выполнение', accept:'Приёмка', final:'Финал. оплата', done:'Завершено',
  };

  // ============ ФОРМУЛЯРЫ-ХАРАКТЕРИСТИКИ ПАРКОВ (ТИ) ============
  // Данные из формуляров, заполненных управляющими объектами.
  // Накладываются на карточки парков при сиде и через разовую миграцию applyTiSpecs().
  const TI_SPECS = {
    'Парк «Хорошо»': {
      address: 'Хорошёвское ш., вл. 27',
      area: 1364,
      hasRestaurant: true,
      restaurantArea: 232,
      restaurantTerrace: 45.2,
      restaurantSeats: 131,
      opened: 2025,
      openedDate: '24.01.2025',
      attendance: 'будни ~30 / пятница 35–45 / выходные 180–200 детей',
      capacity: 120,
      operators: 8,
      peakHours: 'будни 17:00–19:00, пятница 17:00–19:00, выходные 14:00–18:00',
      visitorsMonth: 1500,
      eventsMonth: '90–100',
      avgCheckEvent: 77000,
      avgCheckRestaurant: 3300,
      restaurantVisitorsMonth: 980,
      avgCheckEntry: 3750,
      attractions: [
        'Детский игровой комплекс (серия YK, конф. 03)',
        'Карусель «3 чаши»',
        'Карусель «Чаша»',
        'Карусель «Волшебник»',
        'Интерактивный аттракцион «Выше шаг»',
        'Карусель «Качели»',
        'Большой лабиринт',
      ],
      description: 'Семейный активити-парк сети Амбиленд в ТРЦ «Хорошо!». 7 единиц игрового оборудования и аттракционов, ресторан на 131 место (зал 232 м² + веранда 45,2 м²). Открыт 24.01.2025.',
    },
    'Парк «Океания»': {
      area: 1789,
      hasRestaurant: false,
      restaurantArea: null,
      restaurantTerrace: null,
      restaurantSeats: null,
      opened: 2025,
      openedDate: '20.12.2025',
      attendance: 'будни 57–90 / пятница 90–180 / выходные 250–300',
      capacity: 103,
      capacityNote: 'фактически в парке ~200–210 чел.',
      operators: 9,
      peakHours: 'будни 17:00–18:00, пятница 16:00–19:00, выходные 16:00–18:00',
      visitorsMonth: 3500,
      avgCheckEvent: 32000,
      avgCheckEntry: 3200,
      attractions: [
        'Лабиринт «Большая космическая станция»',
        'Лабиринт «Малый лабиринт космос»',
        'Аттракцион «Вулкан»',
        'Аттракцион «Небесная башня»',
        'Скайрайдер',
        'Батутная арена (малая)',
      ],
      description: 'Парк Амбиленд в ТРЦ «Океания» (Кутузовский пр-т). 6 аттракционов: космические лабиринты, «Вулкан», «Небесная башня», скайрайдер, батутная арена. Без ресторана. Введён в эксплуатацию 20.12.2025.',
    },
  };

  // ---- Даты-помощники ----
  const today = new Date();
  const dstr = (d) => d.toISOString().slice(0,10);
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate()-n); return d; };
  const daysAhead = (n) => daysAgo(-n);

  async function run(force = false) {
    const parks = await DB.getAll('parks');
    if (parks.length && !force) return { skipped: true };

    await DB.clearAll();

    // ============ ПАРКИ (id объявляем раньше, чтобы связать с пользователями) ============
    // Фиксированные ID: все браузеры (компьютеры) должны получать ОДНИ И ТЕ ЖЕ
    // демо-записи, иначе при синхронизации случайные ID превратятся в дубли
    // парков и пользователей на каждом новом компьютере.
    const p1='park_horosho', p2='park_columbus', p3='park_vegas', p4='park_okeania';

    // ============ ПОЛЬЗОВАТЕЛИ ============
    const directorId = 'user_director';
    const m1 = 'user_horosho', m2 = 'user_columbus', m3 = 'user_vegas', m4 = 'user_okeania';

    const users = [
      { id: directorId, login:'director', pwdHash: Auth.hashPwd('0987'), role:'director', name:'Генеральный директор' },
      { id: m1, login:'horosho',  pwdHash: Auth.hashPwd('1234'), role:'manager', name:'Управляющий парка «Хорошо»',  parkId:p1 },
      { id: m2, login:'columbus', pwdHash: Auth.hashPwd('men2345'), role:'manager', name:'Управляющий парка «Колумбус»', parkId:p2 },
      { id: m3, login:'vegas',    pwdHash: Auth.hashPwd('3456'), role:'manager', name:'Управляющий парка «Вегас»',    parkId:p3 },
      { id: m4, login:'okeania',  pwdHash: Auth.hashPwd('men4567'), role:'manager', name:'Управляющий парка «Океания»',  parkId:p4 },
    ];

    // Общие контакты сети Амбиленд
    const NET = { site:'ambi.land', phone:'+7 (495) 121-23-24', email:'info@ambi.land', restaurantBrand:'ambi.rest' };

    const parksData = [
      { id:p1, name:'Парк «Хорошо»',  mall:'ТРЦ «Хорошо!»',  city:'Москва',
        address:'Хорошёвское шоссе, 27', metro:'Полежаевская', floor:'2 этаж',
        area:3500, hasRestaurant:true, restaurantBrand:NET.restaurantBrand,
        hours:'10:00–22:00', opened:2019, managerId:m1, managerName:'Управляющий парка «Хорошо»',
        phone:NET.phone, email:NET.email, site:NET.site,
        attractions:['Скалодром «Небесная башня»','Батутные зоны','Горки с ватрушками','Лабиринты','Сухие бассейны','Карусели и качели','Игровые домики'],
        description:'Семейный активити-парк сети Амбиленд в ТРЦ «Хорошо!». Аттракционы для детей от 5 лет и взрослых.' },
      { id:p2, name:'Парк «Колумбус»', mall:'ТРЦ «Columbus»', city:'Москва',
        address:'ул. Кировоградская, 13А', metro:'Пражская / Калужская', floor:'2 этаж',
        area:4000, hasRestaurant:true, restaurantBrand:NET.restaurantBrand,
        hours:'10:00–22:00', opened:2020, managerId:m2, managerName:'Управляющий парка «Колумбус»',
        phone:NET.phone, email:NET.email, site:NET.site,
        attractions:['Скалодром «Небесная башня»','Скайрайдер','Батутные зоны','Горки с ватрушками','Лабиринты','Боулинг','Тир','Сухие бассейны'],
        description:'Флагман сети Амбиленд в ТРЦ «Columbus». Самый крупный парк — скайрайдер, расширенный скалодром, боулинг.' },
      { id:p3, name:'Парк «Вегас»', mall:'ТРК «VEGAS Сити»', city:'Москва',
        address:'Крокус Сити', metro:'Мякинино', floor:'—',
        area:4000, hasRestaurant:true, restaurantBrand:NET.restaurantBrand,
        hours:'10:00–22:00', opened:2021, managerId:m3, managerName:'Управляющий парка «Вегас»',
        phone:NET.phone, email:NET.email, site:NET.site,
        attractions:['Скалодром','Батутные зоны','Большие горки','Лабиринты','Игровые домики','Мини-игры'],
        description:'Парк Амбиленд в ТРК «VEGAS Сити» (Крокус Сити), площадь 4000 м².' },
      { id:p4, name:'Парк «Океания»', mall:'ТРЦ «Океания»', city:'Москва',
        address:'Кутузовский проспект', metro:'Славянский бульвар / Парк Победы', floor:'2 этаж',
        area:3000, hasRestaurant:false, restaurantBrand:'',
        hours:'10:00–22:00', opened:2022, managerId:m4, managerName:'Управляющий парка «Океания»',
        phone:NET.phone, email:NET.email, site:NET.site,
        attractions:['Батутные зоны','Горки','Лабиринты','Сухие бассейны','Карусели'],
        description:'Парк Амбиленд в ТРЦ «Океания» (Кутузовский пр-т). Без ресторана.' },
    ];

    // Накладываем данные формуляров-характеристик (ТИ) на карточки парков
    for (const p of parksData) {
      const spec = TI_SPECS[p.name];
      if (spec) Object.assign(p, spec);
    }

    // ============ РАБОТЫ ============
    // Реестр работ очищен по запросу руководства — демо-работы удалены.
    // Новые работы добавляются вручную через интерфейс («+ Новая работа»).
    const works = [];

    // ============ ДОГОВОРЫ ============
    // Договоры привязаны к работам — очищены вместе с реестром работ.
    const contracts = [];

    // ============ ОБОРУДОВАНИЕ ============
    // Оборудование = аттракционы и зоны парка (из «Общих данных»), статус по умолчанию «Работает».
    // ID детерминированные (<store>_<parkId>_<name>), чтобы синхронизация между
    // компьютерами не плодила дубли сеянных записей.
    const equipment = [
      ...[p1, p2, p3, p4].flatMap(pid =>
        (parksData.find(p => p.id === pid).attractions || []).map(name => ({ id: `eq_${pid}_${name}`, parkId: pid, name, status: 'ok' }))),
    ];

    // ============ ПОМЕЩЕНИЯ ============
    const premises = [
      ...pm(p1, [['Административное здание','ok','Косметический ремонт требуется через 6 мес.'],['Склад инвентаря','warn','Течь кровли, срочно'],['Ресторан (зал 200м²)','ok','После ремонта'],['Туалетные блоки (2)','ok','В норме']]),
      ...pm(p2, [['Главный павильон','ok','ОК'],['Склад','ok','ОК'],['Ресторан (зал 150м²)','warn','Требуется вентиляция'],['Раздевалки','ok','ОК']]),
      ...pm(p3, [['База инструкторов','ok','ОК'],['Склад снаряжения','warn','Сыро, нужен ремонт'],['Ресторан (зал 120м²)','ok','ОК']]),
      ...pm(p4, [['Кассовый блок','ok','ОК'],['Склад','ok','ОК'],['Комната отдыха','ok','ОК']]),
    ];

    // ============ РАЗРЕШИТЕЛЬНАЯ ДОКУМЕНТАЦИЯ (со сроками) ============
    const documents = [
      ...doc(p1, [['Лицензия на эксплуатацию высотных сооружений', dstr(daysAhead(45))],['Заключение Роспотребнадзора (ресторан)', dstr(daysAgo(10))],['Пожарная декларация', dstr(daysAhead(120))],['Договор на вывоз ТБО', dstr(daysAhead(8))]]),
      ...doc(p2, [['Сертификат безопасности батутов', dstr(daysAhead(200))],['Санитарно-эпидемиолог. заключение', dstr(daysAhead(30))],['Лицензия Ростехнадзора', dstr(daysAgo(25))]]),
      ...doc(p3, [['Разрешение на пользование лесным участком', dstr(daysAhead(60))],['Заключение СЭС (ресторан)', dstr(daysAhead(15))],['Пожарный сертификат', dstr(daysAhead(90))]]),
      ...doc(p4, [['Свидетельство ОПО', dstr(daysAhead(180))],['Договор на дезинфекцию', dstr(daysAgo(5))]]),
    ];

    // ============ ЖУРНАЛЫ ИНСТРУКТАЖЕЙ ============
    const journals = [
      ...jr(p1, [['Журнал инструктажа по ТБ на высоте','ok', dstr(daysAgo(2))],['Журнал инструктажа посетителей','ok', dstr(daysAgo(1))],['Журнал пожарной безопасности','warn', dstr(daysAgo(20))],['Журнал медосмотра персонала','ok', dstr(daysAgo(5))]]),
      ...jr(p2, [['Журнал инструктажа батутной зоны','ok', dstr(daysAgo(3))],['Журнал инструктажа персонала','bad', dstr(daysAgo(45))],['Журнал пищевой безопасности (ресторан)','warn', dstr(daysAgo(15))]]),
      ...jr(p3, [['Журнал инструктажа верёвочного парка','ok', dstr(daysAgo(1))],['Журнал инструктажа по лесу','ok', dstr(daysAgo(4))],['Журнал медосмотра','warn', dstr(daysAgo(18))]]),
      ...jr(p4, [['Журнал инструктажа по ТБ','ok', dstr(daysAgo(2))],['Журнал инструктажа посетителей','warn', dstr(daysAgo(12))]]),
    ];

    await DB.bulkPut('users', users);
    await DB.bulkPut('parks', parksData);
    await DB.bulkPut('works', works);
    await DB.bulkPut('contracts', contracts);
    await DB.bulkPut('equipment', equipment);
    await DB.bulkPut('premises', premises);
    await DB.bulkPut('documents', documents);
    await DB.bulkPut('journals', journals);

    return { skipped: false, counts: { parks:4, users:5, works:works.length, contracts:contracts.length } };
  }

  // Разовая миграция: применяет данные формуляров ТИ к уже созданным (сеянным ранее) БД.
  // Срабатывает один раз на каждый браузер (флаг в localStorage).
  // Обновляет общие данные парков и пересобирает их оборудование по новым перечням.
  async function applyTiSpecs() {
    const FLAG = 'ambi_ti_specs_v3';
    if (localStorage.getItem(FLAG)) return;
    const parks = await DB.getAll('parks');
    for (const park of parks) {
      const spec = TI_SPECS[park.name];
      if (!spec) continue;
      Object.assign(park, spec);
      await DB.put('parks', park);
      const old = await DB.getByIndex('equipment', 'parkId', park.id);
      for (const e of old) await DB.remove('equipment', e.id);
      await DB.bulkPut('equipment', (park.attractions || []).map(name =>
        ({ id: `eq_${park.id}_${name}`, parkId: park.id, name, status: 'ok' })));
    }
    localStorage.setItem(FLAG, '1');
  }

  // Разовая миграция: приводит ID сидированных парков и пользователей к каноническим
  // значениям (тем, что создаёт run() выше). Нужна для синхронизации между компьютерами:
  // старые базы с случайными ID иначе породили бы дубли при merge.
  // Срабатывает один раз на каждый браузер (флаг в localStorage).
  async function canonicalizeIdsOnce() {
    const FLAG = 'ambi_canon_ids_v4';
    if (localStorage.getItem(FLAG)) return;

    const PARK_IDS = {
      'Парк «Хорошо»': 'park_horosho',
      'Парк «Колумбус»': 'park_columbus',
      'Парк «Вегас»': 'park_vegas',
      'Парк «Океания»': 'park_okeania',
    };
    const USER_IDS = {
      director: 'user_director', horosho: 'user_horosho', columbus: 'user_columbus',
      vegas: 'user_vegas', okeania: 'user_okeania',
    };
    const REF_STORES = ['works', 'contracts', 'equipment', 'premises', 'documents', 'journals'];

    const parks = await DB.getAll('parks');
    for (const p of parks) {
      const canon = PARK_IDS[p.name];
      if (!canon || p.id === canon) continue;
      const oldId = p.id;
      for (const store of REF_STORES) {
        const rows = await DB.getByIndex(store, 'parkId', oldId);
        for (const r of rows) { r.parkId = canon; await DB.put(store, r); }
      }
      const users = await DB.getAll('users');
      for (const u of users) {
        if (u.parkId === oldId) { u.parkId = canon; await DB.put('users', u); }
      }
      p.id = canon;
      await DB.put('parks', p);
      await DB.remove('parks', oldId);
    }

    const users = await DB.getAll('users');
    for (const u of users) {
      const canon = USER_IDS[(u.login || '').toLowerCase()];
      if (!canon || u.id === canon) continue;
      const oldId = u.id;
      u.id = canon;
      await DB.put('users', u);
      await DB.remove('users', oldId);
    }

    // --- дочерние демо-записи: приводим ID к тому же детерминированному формату,
    // что использует run() (<store>_<parkId>_<name>), иначе синхронизация даст дубли ---
    const CHILD_STORES = [['equipment', 'eq'], ['premises', 'pm'], ['documents', 'doc'], ['journals', 'jr']];
    for (const [store, prefix] of CHILD_STORES) {
      const rows = await DB.getAll(store);
      for (const r of rows) {
        if (!r.parkId || !r.name) continue;
        const canon = `${prefix}_${r.parkId}_${r.name}`;
        if (r.id === canon) continue;
        const oldId = r.id;
        r.id = canon;
        await DB.put(store, r);
        await DB.remove(store, oldId);
      }
    }

    // Сессия могла ссылаться на старый ID пользователя — если запись не найдена, разлогиниваем
    try {
      const sess = JSON.parse(sessionStorage.getItem('parks_session') || 'null');
      if (sess && !(await DB.getByKey('users', sess.userId))) {
        sessionStorage.removeItem('parks_session');
      }
    } catch { /* сессии нет — ок */ }

    localStorage.setItem(FLAG, '1');
  }

  // ============ Хелперы-конструкторы записей ============
  function work(parkId, title, stage, prevStage, amount, extra) {
    return { id: DB.uid(), parkId, title, stage, amount, createdAt: Date.now(), ...extra };
  }
  function hist(entries) {
    return entries.map(([text, date, who]) => ({ text, date: typeof date==='string'?date:dstr(date), who, ts: Date.now() }));
  }
  function contract(parkId, w, fileName) {
    return {
      id: DB.uid(), parkId, workId: w.id, title: w.title,
      fileName, contractNo: w.contractNo || '', contractor: w.contractor || '',
      amount: w.amount || 0,
      // Извлечённые структурированные данные (как если бы распарсили PDF)
      extracted: {
        parties: {
          customer: { name:'ООО «Активити Парки»', inn:'2310000123', kpp:'231001001', ogrn:'1022301234567', address:'г. Краснодар, ул. Парковая, 1' },
          contractor: { name: w.contractor || '—', inn:'2310000456', kpp:'231001001', ogrn:'1032301765432', address:'г. Сочи, ул. Подрядная, 9', phone:'+7 (862) 123-45-67' },
        },
        payments: {
          total: w.amount || 0, prepayPct: w.prepayPct || 30, prepayAmount: Math.round((w.amount||0)*(w.prepayPct||30)/100),
          finalPct: 100-(w.prepayPct||30), finalAmount: w.amount - Math.round((w.amount||0)*(w.prepayPct||30)/100),
          terms: 'Оплата безналичным путём. Аванс в течение 5 дней после подписания, окончательный расчёт — в течение 10 дней после подписания акта приёмки.',
        },
        schedule: {
          startDate: dstr(daysAgo(30)), endDate: w.deadline || dstr(daysAhead(20)),
          milestones: [{ date: w.deadline||dstr(daysAhead(20)), title:'Сдача работ' }],
        },
        subject: {
          description: w.desc || w.title,
          warranty: 'Гарантия на выполненные работы — 12 месяцев с даты подписания акта.',
          responsibility: 'За нарушение сроков Подрядчик уплачивает пени 0,1% от цены договора за каждый день просрочки.',
        },
      },
      createdAt: Date.now(),
    };
  }
  // оборудование: [название, состояние(1-5), status]
  const eq = (parkId, rows) => rows.map(([name, cond, status]) => ({ id:DB.uid(), parkId, name, condition:cond, status, note:'' }));
  // помещения: [название, status, note]
  const pm = (parkId, rows) => rows.map(([name, status, note]) => ({ id: `pm_${parkId}_${name}`, parkId, name, status, note }));
  // документы: [название, срок]
  const doc = (parkId, rows) => rows.map(([name, validTo]) => ({ id: `doc_${parkId}_${name}`, parkId, name, validTo, issued: dstr(daysAgo(300)) }));
  // журналы: [название, status, последняя запись]
  const jr = (parkId, rows) => rows.map(([name, status, lastEntry]) => ({ id: `jr_${parkId}_${name}`, parkId, name, status, lastEntry }));

  return { run, applyTiSpecs, canonicalizeIdsOnce, STAGES, STAGE_NAMES };
})();
