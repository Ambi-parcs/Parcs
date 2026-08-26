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
    const p1=DB.uid(), p2=DB.uid(), p3=DB.uid(), p4=DB.uid();

    // ============ ПОЛЬЗОВАТЕЛИ ============
    const directorId = DB.uid();
    const m1 = DB.uid(), m2 = DB.uid(), m3 = DB.uid(), m4 = DB.uid();

    const users = [
      { id: directorId, login:'director', pwdHash: Auth.hashPwd('0987'), role:'director', name:'Генеральный директор' },
      { id: m1, login:'horosho',  pwdHash: Auth.hashPwd('1234'), role:'manager', name:'Управляющий парка «Хорошо»',  parkId:p1 },
      { id: m2, login:'columbus', pwdHash: Auth.hashPwd('2345'), role:'manager', name:'Управляющий парка «Колумбус»', parkId:p2 },
      { id: m3, login:'vegas',    pwdHash: Auth.hashPwd('3456'), role:'manager', name:'Управляющий парка «Вегас»',    parkId:p3 },
      { id: m4, login:'okeania',  pwdHash: Auth.hashPwd('4567'), role:'manager', name:'Управляющий парка «Океания»',  parkId:p4 },
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

    // ============ РАБОТЫ ============
    // Реестр работ очищен по запросу руководства — демо-работы удалены.
    // Новые работы добавляются вручную через интерфейс («+ Новая работа»).
    const works = [];

    // ============ ДОГОВОРЫ ============
    // Договоры привязаны к работам — очищены вместе с реестром работ.
    const contracts = [];

    // ============ ОБОРУДОВАНИЕ ============
    // Оборудование = аттракционы и зоны парка (из «Общих данных»), статус по умолчанию «Работает»
    const equipment = [
      ...[p1, p2, p3, p4].flatMap(pid =>
        (parksData.find(p => p.id === pid).attractions || []).map(name => ({ id: DB.uid(), parkId: pid, name, status: 'ok' }))),
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
  const pm = (parkId, rows) => rows.map(([name, status, note]) => ({ id:DB.uid(), parkId, name, status, note }));
  // документы: [название, срок]
  const doc = (parkId, rows) => rows.map(([name, validTo]) => ({ id:DB.uid(), parkId, name, validTo, issued: dstr(daysAgo(300)) }));
  // журналы: [название, status, последняя запись]
  const jr = (parkId, rows) => rows.map(([name, status, lastEntry]) => ({ id:DB.uid(), parkId, name, status, lastEntry }));

  return { run, STAGES, STAGE_NAMES };
})();
