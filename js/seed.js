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

    // ============ РАБОТЫ (~13 в разных этапах) ============
    const works = [
      // ПАРК 1 — «Высота»
      work(p1, 'Замена тормозных канатов на зиплайне', 'problem', 'contractor', 380000,
           { problemDate:dstr(daysAgo(8)), deadline:dstr(daysAhead(20)), contractor:'', prepayPct:30, prepayPaid:0, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Износ канатов на 4 трассах, выявлен при ТО. Срочно требуется замена.', history:hist([['Проблема выявлена в ходе ТО', daysAgo(8), 'Иванов И.И.']]) }),
      work(p1, 'Ремонт системы освещения скалодрома', 'accept', 'doing', 145000,
           { problemDate:dstr(daysAgo(40)), deadline:dstr(daysAgo(3)), contractor:'ООО «ЭлектроМонтаж»', contractNo:'12/ЭМ-2026', prepayPct:40, prepayPaid:58000,
             finalPaid:0, quality:0, qualityStatus:'pending', desc:'Перегорание ЩО, замена на LED. Работы выполнены, на приёмке.',
             history:hist([['Проблема выявлена', daysAgo(40),'Иванов И.И.'],['Подрядчик: ООО «ЭлектроМонтаж»', daysAgo(35),'Иванов И.И.'],['Договор 12/ЭМ-2026', daysAgo(30),'Иванов И.И.'],['Предоплата 40% = 58 000 ₽', daysAgo(28),'Иванов И.И.'],['Работы выполнены', daysAgo(5),'Иванов И.И.']]) }),
      work(p1, 'Реконструкция ресторана (кухонная зона)', 'prepay', 'contract', 1250000,
           { problemDate:dstr(daysAgo(25)), deadline:dstr(daysAhead(45)), contractor:'ООО «СтройРесторан»', contractNo:'45/СР-2026', prepayPct:50, prepayPaid:0, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Расширение кухни, новая вытяжка, замена оборудования. Договор подписан, ожидаем предоплату.',
             history:hist([['Проблема: тесная кухня', daysAgo(25),'Иванов И.И.'],['Подрядчик выбран', daysAgo(18),'Иванов И.И.'],['Договор 45/СР-2026', daysAgo(6),'Иванов И.И.']]) }),
      work(p1, 'Сертификация страховочных систем', 'done', 'done', 95000,
           { problemDate:dstr(daysAgo(90)), deadline:dstr(daysAgo(60)), contractor:'ИП Соколов А.В.', contractNo:'07/СВ-2026', prepayPct:50, prepayPaid:47500, finalPaid:47500, quality:5, qualityStatus:'accepted',
             desc:'Ежегодная сертификация. Сдано в срок, без замечаний.',
             history:hist([['Проблема: плановая сертификация', daysAgo(90),'Иванов И.И.'],['Договор 07/СВ-2026', daysAgo(85),'Иванов И.И.'],['Полная оплата', daysAgo(62),'Иванов И.И.'],['Работы приняты, оценка 5/5', daysAgo(60),'Иванов И.И.']]) }),

      // ПАРК 2 — «Волна»
      work(p2, 'Замена напольного покрытия батутной зоны', 'doing', 'contractor', 220000,
           { problemDate:dstr(daysAgo(30)), deadline:dstr(daysAhead(10)), contractor:'ООО «СпортПол»', contractNo:'33/СП-2026', prepayPct:40, prepayPaid:88000, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Разрывы покрытия на 3 батутах. Идут работы.',
             history:hist([['Жалобы посетителей', daysAgo(30),'Петрова А.С.'],['Подрядчик: ООО «СпортПол»', daysAgo(22),'Петрова А.С.'],['Договор 33/СП-2026', daysAgo(18),'Петрова А.С.'],['Предоплата 40%', daysAgo(15),'Петрова А.С.'],['Старт работ', daysAgo(7),'Петрова А.С.']]) }),
      work(p2, 'Капитальный ремонт вентиляции ресторана', 'contractor', 'problem', 310000,
           { problemDate:dstr(daysAgo(12)), deadline:dstr(daysAhead(35)), contractor:'', prepayPct:30, prepayPaid:0, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Сильные запахи из кухни в зал. Ищем подрядчика.',
             history:hist([['Жалобы на запахи', daysAgo(12),'Петрова А.С.'],['Взято в работу', daysAgo(10),'Петрова А.С.']]) }),
      work(p2, 'Замена Climbing-стен (3 модуля)', 'final', 'accept', 540000,
           { problemDate:dstr(daysAgo(70)), deadline:dstr(daysAgo(15)), contractor:'ООО «Вертикаль»', contractNo:'21/ВВ-2026', prepayPct:30, prepayPaid:162000, finalPaid:0, quality:4, qualityStatus:'accepted',
             desc:'Замена устаревших модулей. Принято с мелкими замечаниями, ждём финальный платёж.',
             history:hist([['Проблема: износ', daysAgo(70),'Петрова А.С.'],['Договор 21/ВВ-2026', daysAgo(65),'Петрова А.С.'],['Предоплата 30%', daysAgo(60),'Петрова А.С.'],['Работы выполнены', daysAgo(20),'Петрова А.С.'],['Приёмка, оценка 4/5', daysAgo(15),'Петрова А.С.']]) }),

      // ПАРК 3 — «Лес»
      work(p3, 'Обслуживание верёвочного парка (деревья)', 'doing', 'contract', 85000,
           { problemDate:dstr(daysAgo(50)), deadline:dstr(daysAhead(5)), contractor:'ООО «Арборист»', contractNo:'15/АР-2026', prepayPct:50, prepayPaid:42500, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Санитарная обрезка, замена креплений к деревьям. Идут работы.',
             history:hist([['Плановое обслуживание', daysAgo(50),'Сидоров В.П.'],['Договор 15/АР-2026', daysAgo(48),'Сидоров В.П.'],['Предоплата 50%', daysAgo(45),'Сидоров В.П.'],['Старт работ', daysAgo(20),'Сидоров В.П.']]) }),
      work(p3, 'Замена посудомоечной зоны ресторана', 'prepay', 'contract', 180000,
           { problemDate:dstr(daysAgo(20)), deadline:dstr(daysAhead(25)), contractor:'ИП Морозов К.Л.', contractNo:'09/ПМ-2026', prepayPct:40, prepayPaid:0, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Старая машина вышла из строя. Договор подписан, ждём аванс.',
             history:hist([['Поломка ПММ', daysAgo(20),'Сидоров В.П.'],['Подрядчик выбран', daysAgo(14),'Сидоров В.П.'],['Договор 09/ПМ-2026', daysAgo(3),'Сидоров В.П.']]) }),

      // ПАРК 4 — «Радуга» (без ресторана)
      work(p4, 'Ремонт детского лабиринта', 'accept', 'doing', 75000,
           { problemDate:dstr(daysAgo(35)), deadline:dstr(daysAgo(2)), contractor:'ООО «ИгровойДизайн»', contractNo:'41/ИД-2026', prepayPct:50, prepayPaid:37500, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Замена порванных элементов. Выполнено, на приёмке (есть дедлайн-просрочка).',
             history:hist([['Износ элементов', daysAgo(35),'Кузнецова Е.Д.'],['Договор 41/ИД-2026', daysAgo(30),'Кузнецова Е.Д.'],['Предоплата 50%', daysAgo(28),'Кузнецова Е.Д.'],['Работы выполнены', daysAgo(4),'Кузнецова Е.Д.']]) }),
      work(p4, 'Установка новой кассовой зоны', 'contractor', 'problem', 130000,
           { problemDate:dstr(daysAgo(6)), deadline:dstr(daysAhead(30)), contractor:'', prepayPct:30, prepayPaid:0, finalPaid:0, quality:0, qualityStatus:'pending',
             desc:'Очереди на входе. Нужна вторая касса + турникеты.',
             history:hist([['Проблема: очереди', daysAgo(6),'Кузнецова Е.Д.'],['В работе', daysAgo(4),'Кузнецова Е.Д.']]) }),
      work(p4, 'Покраска ограждений территории', 'done', 'done', 45000,
           { problemDate:dstr(daysAgo(60)), deadline:dstr(daysAgo(40)), contractor:'ИП Григорьев Р.Т.', contractNo:'03/ГР-2026', prepayPct:30, prepayPaid:13500, finalPaid:31500, quality:5, qualityStatus:'accepted',
             desc:'Косметический ремонт. Сдано.',
             history:hist([['Проблема: ржавчина', daysAgo(60),'Кузнецова Е.Д.'],['Договор 03/ГР-2026', daysAgo(55),'Кузнецова Е.Д.'],['Полная оплата', daysAgo(38),'Кузнецова Е.Д.'],['Принято, 5/5', daysAgo(40),'Кузнецова Е.Д.']]) }),
    ];

    // ============ ДОГОВОРЫ (с извлечёнными данными) ============
    const contracts = [
      contract(p1, works[1], 'Договор ЭМ-2026 на ремонт освещения.pdf'),
      contract(p1, works[2], 'Договор СР-2026 реконструкция кухни.pdf'),
      contract(p2, works[4], 'Договор СП-2026 батуты.pdf'),
      contract(p2, works[6], 'Договор ВВ-2026 climbing.pdf'),
      contract(p3, works[8], 'Договор ПМ-2026 посудомойка.pdf'),
      contract(p4, works[10],'Договор ИД-2026 лабиринт.pdf'),
    ];

    // ============ ОБОРУДОВАНИЕ ============
    const equipment = [
      ...eq(p1, [['Зиплайн «Орёл»',4,'trouble'],['Скалодром (12 трасс)',3,'ok'],['Страховочные системы',5,'ok'],['Батут «Прыжок»',3,'ok'],['Ресторан: плита индукц.',2,'service']]),
      ...eq(p2, [['Батутная зона (8 шт.)',3,'trouble'],['Climbing-стены (6)',2,'service'],['Поролоновая яма',4,'ok'],['Ресторан: холодильник',3,'ok']]),
      ...eq(p3, [['Верёвочный парк (5 трасс)',4,'service'],['Тарзанка',5,'ok'],['Ресторан: конвектомат',2,'service']]),
      ...eq(p4, [['Детский лабиринт',2,'trouble'],['Карусель «Радуга»',4,'ok'],['Качели (4 шт.)',5,'ok']]),
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
