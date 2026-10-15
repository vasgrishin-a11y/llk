#!/usr/bin/env node
/* ═══════════════ Единая выгрузка бизнес-данных дашборда In.Plan IBP ═══════════════
   Собирает ВСЕ отчётные данные дашборда (вкладки «Обзор», «1. Сегментация», «2. Спрос»,
   «3. Запасы», «4. Поставки», «5. Планы», «6. Действия») в один Markdown-файл, который
   можно выгрузить и загрузить в другой ИИ-инструмент.

   Источник данных — те же модули, что рендерит дашборд:
     src/data.js      — помесячное ядро (янв–дек 2026) и сводка YTD;
     src/config.js    — KPI-панель «Обзора»;
     src/datasets.js  — все отчётные датасеты и расчётные срезы вкладок.

   Запуск:  node tools/export-business-data.mjs [путь/к/файлу.md]
   По умолчанию: exports/In.Plan_IBP_данные_окт-2026.md */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const load=p=>import(pathToFileURL(path.join(ROOT,p)).href);

const {MONTHLY,summary,CANON}=await load('src/data.js');
const {DASHBOARD_CONFIG:C}=await load('src/config.js');
const DS=await load('src/datasets.js');
const {OVERVIEW,SEGMENTS,SEG_LEVELS,DEMAND,DEMAND_KPIS,STOCK,SUPPLY,HEATMAP,PLANS,ACTIONS,MONTHS18,HIST_MONTHS18}=DS;

const V=(pl,a,b,qlabel,opts)=>DS.planView(pl,a,b,qlabel,opts);

/* ═══════════════ Markdown-хелперы ═══════════════ */
const out=[];
const p=s=>out.push(s);
const H1=t=>p('\n# '+t+'\n');
const H2=t=>p('\n## '+t+'\n');
const H3=t=>p('\n### '+t+'\n');
const H4=t=>p('\n#### '+t+'\n');

/* HTML из датасетов → чистый текст: <br> в перевод строки, теги и entity — в символы,
   неразрывные пробелы — в обычные (иначе ИИ видит «46 500» как неразрывную строку). */
const strip=s=>String(s==null?'':s)
  .replace(/<br\s*\/?>/gi,'\n')
  .replace(/<\/(p|div|li)>/gi,'\n')
  .replace(/<[^>]*>/g,'')
  .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<')
  .replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
  .replace(/[\u00a0\u202f]/g,' ')
  .replace(/[ \t]+/g,' ')
  .replace(/ *\n */g,'\n')
  /* дефис перед числом — в типографский минус (в отчётах встречаются оба варианта) */
  .replace(/(^|[\s(])-(?=\d)/g,'$1−')
  .trim();

/* Значение для ячейки таблицы: одна строка, без переводов строк и «|» */
const cell=s=>strip(s).replace(/\n+/g,' · ').replace(/\|/g,'\\|')||'—';

const NUM=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d}).replace(/\u00a0|\u202f/g,' ');
const PCT=(a,b,d=1)=>b?NUM(a/b*100,d)+'%':'—';
const PLUS=v=>(v>=0?'+':'−')+NUM(Math.abs(v));

/* Таблица: rows — массив массивов либо объектов {cells, cls} (row-sum / row-total → жирным) */
function mdTable(heads,rows){
  const line=r=>{
    const o=Array.isArray(r)?{cells:r}:r;
    const tot=typeof o.cls==='string'&&/row-(sum|total)/.test(o.cls);
    return '| '+o.cells.map(c=>{
      const t=cell(c);
      return tot&&t!=='—'?'**'+t.replace(/\*\*/g,'')+'**':t;
    }).join(' | ')+' |';
  };
  p('| '+heads.map(cell).join(' | ')+' |');
  p('|'+heads.map(()=>' --- ').join('|')+'|');
  rows.forEach(r=>p(line(r)));
  p('');
}

/* Вывод (📌…) — цитатой, чтобы не сливалось с таблицами */
function insight(text){
  const t=strip(text);
  if(!t)return;
  p(t.split('\n').map(l=>'> '+l).join('\n'));
  p('');
}
const info=(label,text)=>{const t=strip(text);if(t)p('**'+label+'** '+t.replace(/\n/g,'\n\n'));p('');};

/* Панель KPI-карточек: {label,value,sub,dev:{text,kind},foot,tip};
   значения могут быть функциями от сводки YTD (как в src/config.js). */
function kpiPanel(list,withTip=false){
  const rv=x=>typeof x==='function'?x(s):x;
  p('| KPI | Значение | Расшифровка значения | Отклонение | Доп. строка |');
  p('| --- | --- | --- | --- | --- |');
  list.forEach(k=>{
    const dev=rv(k.dev);
    const arrow=dev&&!/^[▲▼]/.test(String(dev.text))?(dev.kind==='pos'?'▲ ':dev.kind==='neg'?'▼ ':''):'';
    p('| '+[rv(k.label),rv(k.value),rv(k.sub),dev?arrow+dev.text:'—',rv(k.foot)||'—'].map(cell).join(' | ')+' |');
  });
  p('');
  if(withTip){
    p('**Методика расчёта KPI (из подсказок дашборда):**\n');
    list.filter(k=>k.tip).forEach(k=>p('- **'+strip(rv(k.label))+'** — '+strip(k.tip)));
    p('');
  }
}

/* Ряд: подписи + несколько именованных массивов */
function seriesTable(labels,series,unitNote){
  const heads=['Период',...series.map(s=>s.name)];
  const rows=labels.map((l,i)=>[l,...series.map(s=>{
    const v=s.data[i];
    if(v==null)return '—';
    return typeof v==='number'?(s.d!=null?NUM(v,s.d):NUM(v)):String(v);
  })]);
  if(unitNote)p('*'+unitNote+'*\n');
  mdTable(heads,rows);
}

const SEG_KEYS_ORDER=['diamond','platinum','gold','silver','bronze'];
const SEG_LBL_RU={diamond:'💎 Бриллиант',platinum:'⬣ Платина',gold:'● Золото',silver:'⚪ Серебро',bronze:'🟤 Бронза'};

/* ═══════════════ Титул и рамка документа ═══════════════ */
const s=summary(MONTHLY);
const today=new Date().toISOString().slice(0,10);
const factRows=MONTHLY.filter(r=>r.type!=='Прогноз');
const fcRows=MONTHLY.filter(r=>r.type==='Прогноз');
const sumBy=(list,k)=>list.reduce((a,x)=>a+x[k],0);

H1('In.Plan IBP — единая выгрузка бизнес-данных дашборда (октябрь 2026)');
p('**Что это за файл.** Один текстовый документ со всеми бизнес-данными дашборда «Ежемесячный цикл'
  +' интегрированного бизнес-планирования (S&OP / IBP)»: KPI, клиенты и каналы, спрос и точность прогноза,'
  +' запасы, цепочка поставок и сценарии, 7 под-планов на 18 месяцев, план действий и итоговое решение.\n');
p('**Источник.** Дашборд In.Plan (репозиторий `vasgrishin-a11y/llk`): отчётные датасеты `src/datasets.js`,'
  +' помесячное ядро `src/data.js`, KPI-панель `src/config.js`. Выгрузка собрана из тех же модулей,'
  +' что и экран, поэтому цифры не расходятся с дашбордом.\n');
p('**Сформировано:** '+today+' · **цикл планирования:** октябрь 2026 · **отчётный период:** январь–сентябрь 2026 (факт)'
  +' · **горизонт:** октябрь 2026 – март 2028 (18 месяцев) · **фокус:** зимний сезон 4 кв. 2026 – 1 кв. 2027.\n');
p('**Единицы измерения.** Объём — тонны (т); деньги — млн руб.; цена — руб/т; запасы — дни покрытия;'
  +' уровень сервиса и точность прогноза — проценты (%).\n');
p('**Формат чисел.** Русская локаль: десятичный разделитель — запятая (`141,5`), разделитель групп — обычный'
  +' пробел (`73 440`). Даты — в формате ДД.ММ.ГГГГ, месяцы — «Окт 2026».\n');
p('**Характер данных.** Это модельный (демонстрационный) кейс вертикально интегрированного производителя'
  +' масел и технических жидкостей: цифры согласованы между разделами сквозными контрольными суммами'
  +' (см. ниже) и предназначены для отработки управленческого цикла IBP.\n');
p('**Как пользоваться.** Файл самодостаточен: загрузите его целиком в чат с ИИ-ассистентом (Markdown-таблицы'
  +' читаются как есть) и задавайте вопросы по любому разделу — «оцени отклонения», «построй сценарий 2027»,'
  +' «предложи план снижения WAPE», «проверь связность цифр». Раздел 0 в конце файла — словарь показателей.\n');

H2('Сквозные контрольные суммы и формулы');
p('Базовые формулы связности модели:\n');
p('- выручка, млн руб. = объём, т × цена, руб/т ÷ 1 000 000;');
p('- валовая прибыль, млн руб. = выручка × валовая маржа, %;');
p('- валовая прибыль на тонну, руб/т = валовая прибыль ÷ объём × 1 000 000;');
p('- покрытие спроса, % = доступный объём ÷ неограниченный спрос × 100;\n');
p('Контрольные итоги, по которым сходятся разделы:\n');
p('| Показатель | Значение | Где используется |');
p('| --- | --- | --- |');
p('| Факт 9 мес. 2026 (янв–сен) | '+NUM(CANON.factVol)+' т / '+NUM(CANON.factRev)+' млн руб. ('
  +NUM(s.volPct,1)+'% / '+NUM(s.revPct,1)+'% плана 415 000 т / 59 760 млн руб.) | Обзор, Сегментация, Спрос, Запасы, Планы |');
p('| Бизнес-план 2026 | 546 000 т / 78 624 млн руб. / валовая прибыль 19 046 млн руб. (24,0%) | все разделы |');
p('| Год 2026, прошлый цикл S&OP | 517 500 т / 73 162,8 млн руб. (94,8% / 93,1% плана) | Обзор, Спрос |');
p('| Год 2026, новый цикл (сценарий В, утверждён) | 519 000 т / 73 440 млн руб. / ВП 17 663 млн руб. | Обзор, Сегментация, Поставки, Планы |');
p('| Неограниченный спрос 4 кв. 2026 | 152 000 т (134 600 + промо 10 200 + корректировка 7 200) | Спрос, Поставки |');
p('| Разрыв предложения 4 кв. 2026 (сценарий А) | −19 000 т (152 000 − 133 000; Серебро −8 000, Бронза −11 000) | Поставки, Планы |');
p('| Утверждённый план 4 кв. 2026 (сценарий В) | 129 000 т / 18 255 млн руб. / ВП 5 002 млн руб. (27,4%) | Поставки, Планы, Действия |');
p('| Цена 2026 / 2025 | 141 500 / 142 300 руб/т (план 144 000 руб/т) | Спрос, Планы |');
p('| Запасы на Сен 2026 / цель | 55 300 т / 6 033 млн руб. при цели 43 000 т (+21,6%) | Запасы, Планы |');
p('| WAPE 3 кв. 2026 / цель | 16,4% / ≤10% | Обзор, Спрос, Запасы, Действия |');
p('| Уровень сервиса OTIF / цель | 86% / 87% (средневзвешенно по выручке сегментов 33/24/22/14/7%) | Обзор, Сегментация, Запасы |');
p('| Портфель сегментации | 22 именованных клиента, 7 каналов продаж, 73 440 млн руб. выручки года | Сегментация, Поставки |');
p('| 18-месячный план продаж / производства | 774 000 т / 776 600 т (загрузка 93%) | Планы |');

H2('Содержание');
[
  ['1. Обзор','итоги 2026, помесячное ядро, YoY по кварталам, точность прогноза, 6 ключевых отклонений'],
  ['2. Сегментация','22 клиента в 5 сегментах, 7 каналов, выручка и затраты по каналам'],
  ['3. Спрос','неограниченный спрос против плана, согласованный прогноз, WAPE по категориям, bias, FVA, сезонность, выбор моделей'],
  ['4. Запасы','покрытие по каналам/продуктам/эшелонам, план и ретроспектива 18 мес., неликвиды, сырьё и ГП, ABC-XYZ, MTS/MTO'],
  ['5. Поставки','карта цепочки и ограничения, покрытие спроса по сегментам (сценарии А/Б/В), тепловая карта клиент × продукт'],
  ['6. Планы','7 под-планов: продажи, производство, перемещения, закупки, запасы, себестоимость, выручка'],
  ['7. Действия','план мероприятий, статусы, вехи, эффект, итоговое решение'],
].forEach(([t,d],i)=>p(String(i+1)+'. **'+t+'** — '+d+'.'));
p('');

/* ═══════════════ 1. ОБЗОР ═══════════════ */
H2('1. Обзор');
H3('1.1. KPI цикла (вкладка «Обзор»)');
kpiPanel(C.kpis.overview.map(k=>({
  label:k.label,value:k.value,sub:k.sub,
  dev:typeof k.dev==='function'?k.dev(s):k.dev,
  foot:typeof k.foot==='function'?k.foot(s):k.foot,
  tip:k.tip,
})),true);

H3('1.2. Помесячное ядро 2026 (янв–дек): план и факт/прогноз');
p('*Ядро дашборда: загружается из XLSX и питает KPI «Обзора» и раздел «Спрос» по 2026 году. '
  +'Янв–сен — факт, окт–дек — прогноз предыдущего цикла S&OP (сентябрь 2026).*\n');
{
  const heads=['Месяц','Тип','План объёма (т)','Факт/Прогноз объёма (т)','Выполнение %',
    'План выручки (млн руб.)','Факт/Прогноз выручки (млн руб.)','Выполнение %','Средняя цена (руб/т)'];
  const row=r=>[r.period,r.type,NUM(r.planVol),NUM(r.vol),PCT(r.vol,r.planVol,1),
    NUM(r.planRev,1),NUM(r.rev,1),PCT(r.rev,r.planRev,1),NUM(r.price)];
  const tot=(list,label,type)=>{
    const pl=list.reduce((a,x)=>a+x.planVol,0),v=list.reduce((a,x)=>a+x.vol,0);
    const pr=list.reduce((a,x)=>a+x.planRev,0),rv=list.reduce((a,x)=>a+x.rev,0);
    return {cells:[label,type,NUM(pl),NUM(v),PCT(v,pl,1),NUM(pr,1),NUM(rv,1),PCT(rv,pr,1),NUM(v?rv/v*1e6:0)],cls:'row-sum'};
  };
  const rows=[...MONTHLY.map(row),
    tot(factRows,'Итого факт '+factRows[0].period+'–'+factRows.at(-1).period,'Факт'),
    tot(fcRows,'Итого прогноз '+fcRows[0].period+'–'+fcRows.at(-1).period,'Прогноз'),
    {...tot(MONTHLY,'Итого 2026 (факт + прогноз)','План/Факт'),cls:'row-total'}];
  mdTable(heads,rows);
}
p('Ориентиры 4 квартала 2026 (что требуется для годового бизнес-плана 546 000 т / 78 624 млн руб.):\n');
p('| Сценарий | Объём 4 кв. (т) | Выручка 4 кв. (млн руб.) | ВП 4 кв. (млн руб.) | Комментарий |');
p('| --- | --- | --- | --- | --- |');
p('| Требуется в 4 кв. для годового плана | 156 000 | 23 439,0 | 6 385 | Цель при плане 546 000 т; НЕДОСТИЖИМА: неограниченный спрос всего 152 000 т |');
p('| 4 кв. — S&OP предыдущего цикла | 127 500 | 17 977,5 | — | Отставание до цели −28 500 т / −5 461,5 млн руб. |');
p('| 4 кв. — новый S&OP (сценарий В, утверждён) | 129 000 | 18 255,0 | 5 002 | +1 500 т к прошлому циклу; год 519 000 т / 73 440 млн руб. |');
p('');

H3('1.3. 2025 год (факт) и бизнес-план 2027');
seriesTable(OVERVIEW.labels12,[
  {name:'План объёма 2025 (т)',data:OVERVIEW.perf2025.planVol},
  {name:'Факт объёма 2025 (т)',data:OVERVIEW.perf2025.vol},
  {name:'План выручки 2025 (млн руб.)',data:OVERVIEW.perf2025.planRev},
  {name:'Факт выручки 2025 (млн руб.)',data:OVERVIEW.perf2025.rev},
],'Итог 2025: 527 000 т (+0,4% к плану 525 000 т), выручка 75 000 млн руб. (+7,2% к плану 69 930 млн), средняя цена 142 300 руб/т, валовая маржа 23,1% (ВП 17 325 млн), чистая прибыль ~10 млрд руб.');
insight(OVERVIEW.insight2025);
seriesTable(OVERVIEW.labels12,[
  {name:'План объёма 2027 (т)',data:OVERVIEW.perf2027.planVol},
  {name:'Прогноз объёма 2027 (т)',data:OVERVIEW.perf2027.vol},
  {name:'План выручки 2027 (млн руб.)',data:OVERVIEW.perf2027.planRev},
  {name:'Прогноз выручки 2027 (млн руб.)',data:OVERVIEW.perf2027.rev},
],'План 2027: 545 000 т / ~78 000 млн руб. при цене 143 100 руб/т; прогноз цикла S&OP — 545 000 т / 77 100 млн руб.');
insight(OVERVIEW.insight2027);
H4('KPI 2025 года (факт)');
kpiPanel(OVERVIEW.kpis2025);
H4('KPI 2027 года (план и цели)');
kpiPanel(OVERVIEW.kpis2027);

H3('1.4. Сравнение с прошлым годом по кварталам');
seriesTable(OVERVIEW.volYoy.labels,[
  {name:'Объём 2025 (т)',data:OVERVIEW.volYoy.y2025},
  {name:'Объём 2026 (т)',data:OVERVIEW.volYoy.y2026},
  {name:'План 2026 (т)',data:OVERVIEW.volYoy.plan},
]);
mdTable(OVERVIEW.volYoy.heads,OVERVIEW.volYoy.rows);
insight(OVERVIEW.volYoy.insight);
seriesTable(OVERVIEW.revYoy.labels,[
  {name:'Выручка 2025 (млн руб.)',data:OVERVIEW.revYoy.y2025},
  {name:'Выручка 2026 (млн руб.)',data:OVERVIEW.revYoy.y2026},
  {name:'Маржа 2025 %',data:OVERVIEW.revYoy.m2025,d:1},
  {name:'Маржа 2026 %',data:OVERVIEW.revYoy.m2026,d:1},
]);
mdTable(OVERVIEW.revYoy.heads,OVERVIEW.revYoy.rows);
insight(OVERVIEW.revYoy.insight);

H3('1.5. Точность прогноза по кварталам (WAPE)');
seriesTable(OVERVIEW.accuracy.labels,[
  {name:'WAPE, факт %',data:OVERVIEW.accuracy.acc,d:1},
  {name:'Цель WAPE %',data:OVERVIEW.accuracy.labels.map(()=>OVERVIEW.accuracy.target),d:1},
]);
mdTable(OVERVIEW.accuracy.heads,OVERVIEW.accuracy.rows);
insight(OVERVIEW.accuracy.insight);
insight(OVERVIEW.insight2026);

H3('1.6. Ключевые отклонения цикла (6)');
OVERVIEW.deviations.forEach(([kind,title,text],i)=>{
  const tag=kind==='danger'?'🔴 критично':kind==='warning'?'🟡 внимание':'🔵 к сведению';
  p('**'+(i+1)+'. '+strip(title)+'** · _'+tag+'_\n');
  p(strip(text).replace(/\n/g,'\n\n'));
  p('');
});

/* ═══════════════ 2. СЕГМЕНТАЦИЯ ═══════════════ */
H2('2. Сегментация (клиентская матрица «маржа × ценность»)');
H3('2.1. KPI по сегментам (уровень сервиса OTIF, факт против цели)');
kpiPanel(C.kpis.segments);

H3('2.2. Сегменты ценности: объём портфеля и валовая прибыль');
{
  const rows=SEG_LEVELS.map(L=>{
    const list=SEGMENTS.clients.filter(c=>c.seg===L.id);
    const rev=list.reduce((a,c)=>a+c.rev,0),gp=list.reduce((a,c)=>a+c.gp,0);
    return [L.icon+' '+L.label,strip(L.desc),String(list.length),
      NUM(rev),PCT(rev,73440,1),NUM(gp,1),NUM(rev?gp/rev*100:0,1)+'%',
      list.map(c=>c.name).join(', ')];
  });
  rows.push({cells:['**Итого портфель**','22 именованных клиента, 7 каналов','22','**73 440**','**100%**',
    '**'+NUM(SEGMENTS.clients.reduce((a,c)=>a+c.gp,0),1)+'**','**'+
    NUM(SEGMENTS.clients.reduce((a,c)=>a+c.gp,0)/73440*100,1)+'%**','—'],cls:'row-total'});
  mdTable(['Сегмент','Описание','Клиентов','Выручка года 2026 (млн руб.)','Доля выручки %',
    'Валовая прибыль (млн руб.)','Маржа %','Клиенты'],rows);
}
p('*Выручка года 2026 = факт янв–сен 55 185 млн руб. + утверждённый сценарий В 4 кв. 18 255 млн руб. = 73 440 млн руб. '
  +'Выручка Бриллианта уменьшена на 2 000 млн руб. в пользу канала «Онлайн продажи» (маркетплейс «Масло24»), суммарная выручка портфеля не изменилась.*\n');

H3('2.3. Реестр 22 клиентов (выручка, маржа, валовая прибыль, сервис)');
{
  const rows=SEGMENTS.clients.map(c=>[
    c.name+(c.review?' ⚑'+(c.revDir==='down'?'↓ на пересмотр (понижение)':'↑ на пересмотр (повышение)'):''),
    (SEG_LEVELS.find(L=>L.id===c.seg)||{}).label||c.seg,
    c.channel,
    NUM(c.rev),NUM(c.marginPct,0)+'%',NUM(c.gp,1),NUM(c.cost,1),
    NUM(c.sTarget,0)+'%',NUM(c.sFact,0)+'%',(c.sFact-c.sTarget>=0?'+':'−')+Math.abs(c.sFact-c.sTarget)+' п.п.',
    c.priority,
  ]);
  rows.push({cells:['**Итого / средневзвешенно**','—','—','**73 440**','**24,1%**',
    '**'+NUM(SEGMENTS.clients.reduce((a,c)=>a+c.gp,0),1)+'**','—','—','**86%**','**−1 п.п.**','—'],cls:'row-total'});
  mdTable(['Клиент','Сегмент','Канал продаж','Выручка 2026 (млн руб.)','Маржа %','Валовая прибыль (млн руб.)',
    'Себестоимость (млн руб.)','OTIF цель','OTIF факт','Δ к цели','Приоритет'],rows);
}
insight(SEGMENTS.bubbleInsight);
p('**Клиенты «на пересмотр» (валовая прибыль выбивается из сегмента):**\n');
p('| Клиент | Сегмент | Выручка (млн руб.) | Маржа % | ВП (млн руб.) | ВП на уровне | Решение |');
p('| --- | --- | --- | --- | --- | --- | --- |');
SEGMENTS.clients.filter(c=>c.review).forEach(c=>{
  const peer=c.revDir==='down'?'Золото (сегмент ниже)':'сегмент выше текущего';
  p('| '+c.name+' | '+(SEG_LEVELS.find(L=>L.id===c.seg)||{}).label+' | '+NUM(c.rev)+' | '+NUM(c.marginPct,0)
    +'% | '+NUM(c.gp,1)+' | '+peer+' | '+(c.revDir==='down'?'кандидат на понижение Платина → Золото':'кандидат на повышение')+' |');
});
p('');

H3('2.4. Выручка по 7 каналам продаж');
p('**Год 2026 — 73 440 млн руб. (факт 9 мес. 55 185 + сценарий В 4 кв. 18 255)**\n');
mdTable(SEGMENTS.revDonut.heads,SEGMENTS.revDonut.year.rows);
insight(SEGMENTS.revDonut.year.insight);
p('**Факт янв–сен 2026 — 55 185 млн руб.**\n');
mdTable(SEGMENTS.revDonut.heads,SEGMENTS.revDonut.ytd.rows);
insight(SEGMENTS.revDonut.ytd.insight);

H3('2.5. Структура затрат по каналам продаж');
seriesTable(SEGMENTS.costStack.labels,SEGMENTS.costStack.series.map(([name,data])=>({name:name+', млн руб.',data})));
mdTable(SEGMENTS.costStack.heads,SEGMENTS.costStack.rows);
insight(SEGMENTS.costStack.insight);

/* ═══════════════ 3. СПРОС ═══════════════ */
H2('3. Спрос');
H3('3.1. KPI спроса по годам (2025 / 2026 / 2027)');
[['2025','y2025'],['2026','y2026'],['2027','y2027']].forEach(([y,k])=>{
  H4('Спрос, '+y+' год');
  kpiPanel(DEMAND_KPIS[k]);
});
insight(DEMAND.insight2025);
insight(DEMAND.insight2026);
insight(DEMAND.insight2027);

H3('3.2. Спрос против бизнес-плана 2026 (помесячно)');
mdTable(DEMAND.periodTable.heads,DEMAND.periodTable.rows);

H3('3.3. Формирование согласованного прогноза 4 кв. 2026 (waterfall)');
seriesTable(DEMAND.waterfall.labels,[{name:'Объём, т',data:DEMAND.waterfall.values}]);
mdTable(DEMAND.waterfall.heads,DEMAND.waterfall.rows);
insight(DEMAND.waterfall.insight);

H3('3.4. Точность прогноза по категориям продуктов (WAPE по горизонтам)');
{
  const tot=DEMAND.accCat.rows.reduce((a,r)=>a+r.vol,0);
  const wAvg=k=>DEMAND.accCat.rows.reduce((a,r)=>a+r.w[k]*r.vol,0)/tot;
  const rows=DEMAND.accCat.rows.map(r=>[r.name,NUM(r.w[0],1)+'%',NUM(r.w[1],1)+'%',NUM(r.w[2],1)+'%',NUM(r.w[3],1)+'%',
    r.bias,NUM(r.vol),r.mode]);
  rows.push({cells:['**Взвешенно по объёму**','**'+NUM(wAvg(0),1)+'%**','**'+NUM(wAvg(1),1)+'%**',
    '**'+NUM(wAvg(2),1)+'%**','**'+NUM(wAvg(3),1)+'%**','—','**'+NUM(tot)+'**','Цель WAPE ≤10%'],cls:'row-sum'});
  mdTable(['Категория продукта','WAPE 1 мес.','WAPE 3 мес.','WAPE 6 мес.','WAPE 12 мес.',
    'Систем. ошибка %','Объём, т/мес','Режим планирования'],rows);
}
mdTable(DEMAND.accCat.heads,DEMAND.accCat.rows.map(r=>[r.name,NUM(r.w[0],1),NUM(r.w[1],1),NUM(r.w[2],1),NUM(r.w[3],1),r.bias,NUM(r.vol),r.mode]));
insight(DEMAND.accCat.insight);

H3('3.5. Систематическая ошибка прогноза по каналам (bias)');
seriesTable(DEMAND.bias.labels,[{name:'Систем. ошибка, %',data:DEMAND.bias.data,d:1}]);
mdTable(DEMAND.bias.heads,DEMAND.bias.rows);
insight(DEMAND.bias.insight);

H3('3.6. Статистический прогноз vs корректировки продаж vs факт (FVA)');
seriesTable(DEMAND.fva.labels,[
  {name:'Статистический прогноз (т)',data:DEMAND.fva.stat},
  {name:'Корректировка продаж (т)',data:DEMAND.fva.corr},
  {name:'Факт (т)',data:DEMAND.fva.fact},
]);
mdTable(DEMAND.fva.heads,DEMAND.fva.rows);
insight(DEMAND.fva.insight);

H3('3.7. Сезонность: базовый спрос и промо-прирост');
seriesTable(DEMAND.seasonal.labels,[
  {name:'Базовый спрос (т)',data:DEMAND.seasonal.base},
  {name:'Промо-прирост (т)',data:DEMAND.seasonal.promo},
]);
mdTable(DEMAND.seasonal.heads,DEMAND.seasonal.rows);
insight(DEMAND.seasonal.insight);

H3('3.8. Выбор математической модели прогнозирования');
p(strip(DEMAND.modelsIntro));
p('');
p('| Канал/сегмент | Модель | WAPE | Bias | Почему | Альтернативы |');
p('| --- | --- | --- | --- | --- | --- |');
DEMAND.models.forEach(m=>p('| '+[strip(m.name),m.model,m.acc,m.bias,strip(m.why),strip(m.others)].map(cell).join(' | ')+' |'));
p('');
p('**Сводка по портфелю моделей:**\n');
DEMAND.modelsSummary.forEach(([k,v])=>p('- '+strip(k)+' '+strip(v)));
p('');
mdTable(DEMAND.modelsTable.heads,DEMAND.modelsTable.rows);
insight(DEMAND.modelsDecision);

/* ═══════════════ 4. ЗАПАСЫ ═══════════════ */
H2('4. Запасы');
H3('4.1. KPI запасов и сервиса');
kpiPanel(C.kpis.stock);

H3('4.2. Покрытие запасов: каналы / категории продуктов / эшелоны');
[['channels','По каналам сбыта','insight'],['products','По категориям продуктов','insightShort'],['echelons','По эшелонам','insight']]
  .forEach(([key,label,insKey])=>{
    const CV=STOCK.coverage[key];
    H4(label);
    mdTable(STOCK.coverage.heads,CV.tableRows);
    p('*Средневзвешенно по тоннажу: '+NUM(CV.avgDays,1)+' дня покрытия против цели '+NUM(CV.avgTarget,1)
      +' · запас '+NUM(CV.totT)+' т · стоимость '+NUM(CV.totCost)+' млн руб. · выше цели: '+CV.above
      +' позиций · ниже страхового: '+CV.below+' позиций.*\n');
    insight(CV[insKey]||CV.insight);
  });
p('Алерт по продуктам: масла моторные — 18 дней при страховом уровне 20 и трансмиссионные масла — 16 при 19;'
  +' требуется срочное пополнение ~2–3 тыс. т и переброска объёмов с заводских складов.\n');

H3('4.3. План запасов на 18 месяцев (сводный IBP, тонны)');
mdTable(STOCK.invPlan.heads,STOCK.invPlan.rows);
insight(STOCK.invPlan.insightTons);
mdTable(STOCK.invPlan.headsM,STOCK.invPlan.rowsM);
insight(STOCK.invPlan.insightMoney);
mdTable(STOCK.invPlan.headsD,STOCK.invPlan.rowsD);
p('**Плановые остановы производства (вертикальные отметки на графике):**\n');
STOCK.invPlan.stops.forEach(x=>p('- '+MONTHS18[x.i]+' — '+strip(x.label).replace(/^Останов:\s*/,'')));
p('');
p('*Себестоимость запаса: '+NUM(DS.COST_TON,4)+' млн руб./т (77% от цены 141 500 руб/т). '
  +'Страховой уровень = 72% целевого запаса, точка заказа = 90% целевого.*\n');

H3('4.4. Ретроспектива запасов за 18 месяцев (Апр 2025 – Сен 2026)');
mdTable(STOCK.invHistory.heads,STOCK.invHistory.rows);
insight(STOCK.invHistory.insightTons);
mdTable(STOCK.invHistory.headsM,STOCK.invHistory.rowsM);
insight(STOCK.invHistory.insightMoney);
p('**Запас и точность прогноза спроса (WAPE / смещение) за те же 18 месяцев**\n');
mdTable(STOCK.invHistory.headsW,STOCK.invHistory.rowsW);
insight(STOCK.invHistory.insightWape);
p('**Прошедшие остановы и ремонты:**\n');
STOCK.invHistory.stops.forEach(x=>p('- '+HIST_MONTHS18[x.i]+' — '+strip(x.label).replace(/^Останов:\s*/,'')));
p('');

H3('4.5. Неликвиды и риск списания');
p(strip(STOCK.dead.methodology));
p('');
seriesTable(STOCK.dead.tons.labels,STOCK.dead.tons.series.map(([name,data])=>({name,data})));
seriesTable(STOCK.dead.money.labels,STOCK.dead.money.series.map(([name,data])=>({name,data})));
mdTable(STOCK.dead.heads,STOCK.dead.rows);
insight(STOCK.dead.insight);
info('💰 Эффект:',STOCK.dead.effect);

H3('4.6. Сырьё: состояние запасов');
p(strip(STOCK.rawmMethodology));
p('');
p('| Сырьё | Дней покрытия | Цель | Δ | Финансовый эффект |');
p('| --- | --- | --- | --- | --- |');
STOCK.rawm.forEach(x=>p('| '+[strip(x.name),x.days,x.target,x.delta,strip(x.effect)].map(cell).join(' | ')+' |'));
p('');
mdTable(STOCK.rawmTable.heads,STOCK.rawmTable.rows);

H3('4.7. Готовая продукция: состояние запасов');
p('| Позиция | Дней покрытия | Норма/цель | Δ | Комментарий |');
p('| --- | --- | --- | --- | --- |');
STOCK.fgm.forEach(x=>p('| '+[strip(x.name),x.days,x.target,x.delta,strip(x.effect)].map(cell).join(' | ')+' |'));
p('');
mdTable(STOCK.fgTable.heads,STOCK.fgTable.rows);

H3('4.8. Матрица ABC-XYZ (ABC по марже, XYZ по вариативности спроса)');
p('Координаты позиций на карте (x — вариативность спроса XYZ, y — доля маржи ABC), точки на диаграмме:')
p('');
mdTable(['Сегмент','Точки (x; y)'],STOCK.abcxyz.scatter.map(s2=>[s2.name,s2.points.map(pt=>'('+pt.x+'; '+pt.y+')').join(', ')]));
mdTable(STOCK.abcxyz.heads,STOCK.abcxyz.rows);
insight(STOCK.abcxyz.insight);

H3('4.9. Стратегия пополнения: на склад (MTS) vs под заказ (MTO)');
seriesTable(STOCK.mtomts.labels,[{name:'Доля объёма, %',data:STOCK.mtomts.data}]);
mdTable(STOCK.mtomts.heads,STOCK.mtomts.rows);
insight(STOCK.mtomts.insight);

/* ═══════════════ 5. ПОСТАВКИ ═══════════════ */
H2('5. Поставки');
H3('5.1. KPI поставок');
kpiPanel(C.kpis.supply);

H3('5.2. Карта цепочки поставок: уровни и объекты');
p(strip(SUPPLY.mapDesc));
p('');
SUPPLY.mapRows.forEach(row=>{
  H4(strip(row.label)+' ('+row.nodes.length+' объектов)');
  p('| Объект | Статус | Ограничение / комментарий |');
  p('| --- | --- | --- |');
  row.nodes.forEach(n=>{
    const st=n.r?'🔴 Разрыв '+n.r+' т':n.w?'🟡 Узкое место':'🟢 Норма';
    p('| '+[strip(n.n.replace('|',' · ')),st,strip(n.rt||n.w||'')].map(cell).join(' | ')+' |');
  });
  p('');
});
p('**Разрыв цепочки без компенсирующих мер — 19 000 т:**\n');
p('| Причина | Влияние |');
p('| --- | --- |');
SUPPLY.mapConstraints.forEach(([icon,text,val])=>p('| '+icon+' '+cell(text)+' | '+val+' |'));
p('');
mdTable(SUPPLY.mapTable.heads,SUPPLY.mapTable.rows);

H3('5.3. Детализация ограничений предложения');
seriesTable(SUPPLY.constraints.labels,[{name:'Влияние на объём, т',data:SUPPLY.constraints.data}]);
mdTable(SUPPLY.constraints.heads,SUPPLY.constraints.rows);
insight(SUPPLY.constraints.insight);

H3('5.4. Покрытие спроса 4 кв. 2026: неограниченный спрос и сценарии А/Б/В');
{
  const rows=Object.values(SUPPLY.gaps).map(G=>{
    const cov=SEG_KEYS_ORDER.map(k=>NUM(G.segAlloc[k]/SUPPLY.segDemand[k]*100,1)+'%').join(' / ');
    return [G.name,NUM(G.demand),NUM(G.available),NUM(G.available/G.demand*100,1)+'%',
      (G.gap?'−'+NUM(G.gap):'0'),cov,NUM(G.segAlloc.diamond)+'/'+NUM(G.segAlloc.platinum)+'/'+NUM(G.segAlloc.gold)
      +'/'+NUM(G.segAlloc.silver)+'/'+NUM(G.segAlloc.bronze)];
  });
  mdTable(['Сценарий','Неогр. спрос (т)','Доступно (т)','Покрытие %','Разрыв (т)',
    'Покрытие по сегментам (Бриллиант/Платина/Золото/Серебро/Бронза)',
    'Доступный объём по сегментам (т)'],rows);
}
p('*Неограниченный спрос 4 кв. 2026 по сегментам: Бриллиант '+NUM(SUPPLY.segDemand.diamond)+' т, Платина '
  +NUM(SUPPLY.segDemand.platinum)+' т, Золото '+NUM(SUPPLY.segDemand.gold)+' т, Серебро '+NUM(SUPPLY.segDemand.silver)
  +' т, Бронза '+NUM(SUPPLY.segDemand.bronze)+' т — итого 152 000 т.*\n');
Object.values(SUPPLY.gaps).forEach(G=>{
  H4('Сценарий '+G.name+' — доступно '+NUM(G.available)+' из '+NUM(G.demand)+' т'
    +(G.gap?' (разрыв −'+NUM(G.gap)+' т)':' (покрытие 100%)'));
  mdTable(['Сегмент','Неогр. спрос (т)','Покрытие %','Доступно (т)','Разрыв (т)'],G.tableRows);
  info(G.gap?'⚠️ Разрыв:':'✅ Покрытие:',G.reasons);
  insight('<b>📌 Вывод:</b> '+G.insight);
  if(G.redist){
    p('**Перераспределение внутри квартала:** снято '+NUM(G.redist.total)+' т '
      +G.redist.from.map(([k,v])=>SEG_LBL_RU[k]+' −'+NUM(v)+' т').join(' и ')+' → передано '
      +G.redist.to.map(([k,v])=>SEG_LBL_RU[k]+' +'+NUM(v)+' т').join(' и ')+'; в план не приняты '+NUM(G.redist.dropped)
      +' т низкомаржинального хвоста. Изменение к сценарию А: '
      +G.redist.deltas.filter(([,v])=>v).map(([k,v])=>SEG_LBL_RU[k]+' '+(v>0?'+':'−')+NUM(Math.abs(v))+' т').join(', ')
      +' — итого '+(G.redist.netVol<0?'−':'+')+NUM(Math.abs(G.redist.netVol))+' т ('+NUM(SUPPLY.gaps.A.available)+' → '
      +NUM(G.available)+' т).\n');
  }
});
mdTable(SUPPLY.gap.table.heads,SUPPLY.gap.table.rows);

H3('5.5. Карточки сценариев 4 кв. 2026');
SUPPLY.scenarios.forEach(sc=>{
  H4(strip(sc.title));
  p('*'+strip(sc.rank)+'*\n');
  p(strip(sc.desc).replace(/\n/g,'\n\n'));
  p('');
  p('| Показатель | Значение |');
  p('| --- | --- |');
  sc.metrics.forEach(([k,v])=>p('| '+cell(k)+' | '+cell(v)+' |'));
  p('');
});
p(strip(SUPPLY.kpiNote));
p('');

H3('5.6. Выполнение бизнес-плана 2026 при каждом сценарии');
p('*Бизнес-план 2026: '+NUM(SUPPLY.scenYear.plan.vol)+' т / '+NUM(SUPPLY.scenYear.plan.rev)+' млн руб. / ВП '
  +NUM(SUPPLY.scenYear.plan.gp)+' млн руб. Факт янв–сен: '+NUM(SUPPLY.scenYear.ytd.vol)+' т / '
  +NUM(SUPPLY.scenYear.ytd.rev)+' млн руб. / ВП '+NUM(SUPPLY.scenYear.ytd.gp)+' млн руб.*\n');
mdTable(SUPPLY.scenYear.heads,SUPPLY.scenYear.rows.map(r=>({cells:[
  r.name,NUM(r.q4vol),NUM(r.q4rev,1),NUM(r.q4gp),NUM(r.q4mgn,1)+'%',
  NUM(r.vol),NUM(r.vol/SUPPLY.scenYear.plan.vol*100,1)+'%',
  NUM(r.rev),NUM(r.rev/SUPPLY.scenYear.plan.rev*100,1)+'%',
  NUM(r.gp),NUM(r.gp/SUPPLY.scenYear.plan.gp*100,1)+'%',NUM(r.mgn,1)+'%']})));
insight(SUPPLY.scenYear.insight);

H3('5.7. Сравнение сценариев «объём против маржи» (радар)');
seriesTable(SUPPLY.radar.axes,SUPPLY.radar.series.map(([name,data,color])=>({name:'Сценарий '+name.slice(-1)+' (шкала 0–'+SUPPLY.radar.max+')',data})));
mdTable(SUPPLY.radar.heads,SUPPLY.radar.rows);
insight(SUPPLY.radar.insight);

H3('5.8. Сценарный веер на 18 месяцев (пессимистичный / базовый / оптимистичный)');
mdTable(SUPPLY.fan.heads,SUPPLY.fan.labels.map((m,i)=>[m,NUM(SUPPLY.fan.worst[i]),NUM(SUPPLY.fan.base[i]),
  NUM(SUPPLY.fan.best[i]),NUM(SUPPLY.fan.marginWorst[i]),NUM(SUPPLY.fan.marginBase[i]),
  NUM(SUPPLY.fan.marginBest[i]),SUPPLY.fan.drivers[i]]));
insight(SUPPLY.fan.insight);

H3('5.9. Тепловая карта «клиент × продукт» (4 кв. 2026)');
p('*Выборка 16 клиентов: все 13 приоритетных (Бриллиант 4, Платина 4, Золото 5) и 3 контрольных — '
  +'НЛМК (Серебро), Сургутнефтегаз и Уральская Сталь (Бронза). Покрытие приходит из правила приоритетной матрицы '
  +'по сегменту клиента; валовая прибыль = объём × 141 500 руб/т × (маржа клиента + калибровка сценария). '
  +'Для сценариев Б и В приведены отклонения к сценарию А (покрытие — в п.п., маржа — в млн руб.). '
  +'Категории «Технические жидкости» и «Трансмиссионные масла» не поставляются Серебру и Бронзе.*\n');
{
  const hdr=['Клиент / сегмент',...HEATMAP.products,'Итого'];
  const rows=(mtx,tot,fmt)=>{
    const r=HEATMAP.clients.map(([name,seg],i)=>[seg+' '+name,...mtx[i].map(fmt),tot[i]==null?'—':fmt(tot[i])]);
    return r;
  };
  const fema=v=>v==null?'—':NUM(v,1)+'%';
  const fdelta=v=>v==null?'—':(v>0?'+':'−')+NUM(Math.abs(v),1);
  const fmln=v=>v==null?'—':NUM(v,1);
  H4('Сценарий А — покрытие спроса, %');
  mdTable(hdr,rows(HEATMAP.A.cov.m,HEATMAP.A.cov.ct,fema));
  H4('Сценарий А — валовая прибыль, млн руб.');
  mdTable(hdr,rows(HEATMAP.A.mrg.m,HEATMAP.A.mrg.ct,fmln));
  H4('Сценарий Б — отклонение покрытия к А, п.п.');
  mdTable(hdr,rows(HEATMAP.abs.B.cov.m,HEATMAP.abs.B.cov.ct,fdelta));
  H4('Сценарий Б — отклонение валовой прибыли к А, млн руб.');
  mdTable(hdr,rows(HEATMAP.abs.B.mrg.m,HEATMAP.abs.B.mrg.ct,fdelta));
  H4('Сценарий В — отклонение покрытия к А, п.п.');
  mdTable(hdr,rows(HEATMAP.abs.C.cov.m,HEATMAP.abs.C.cov.ct,fdelta));
  H4('Сценарий В — отклонение валовой прибыли к А, млн руб.');
  mdTable(hdr,rows(HEATMAP.abs.C.mrg.m,HEATMAP.abs.C.mrg.ct,fdelta));
  p('*Итоги по продуктам (столбцы карты), млн руб. и %: совокупная валовая прибыль 16 клиентов выборки '
    +'в сценарии А — '+NUM(HEATMAP.A.mrg.ctAll,1)+' млн руб.; покрытие выборки — '+NUM(HEATMAP.A.cov.ctAll,1)+'%. '
    +'Калибровка маржи сценариев к ставкам клиентов: Б '+NUM(HEATMAP.calib.B*100,2)+' п.п., В '
    +NUM(HEATMAP.calib.C*100,2)+' п.п.*\n');
}
insight(SUPPLY.heatmapInsights.cov);
insight(SUPPLY.heatmapInsights.mrg);
insight(SUPPLY.heatmapInsights.delta);
p('**Плоская выгрузка карты (по клиентам, форматы «А/Б/В»):**\n');
mdTable(HEATMAP.flatTable.heads,HEATMAP.flatTable.rows);

/* ═══════════════ 6. ПЛАНЫ ═══════════════ */
H2('6. Планы (7 под-планов на 18 месяцев: Окт 2026 – Мар 2028)');
p('Периоды планирования в дашборде: «Все 18 мес.», «4 кв. 2026» (по умолчанию), «2027 год», «Свой период». '
  +'Ниже: сводная таблица каждого плана за все 18 месяцев и детальные срезы графика за 4 кв. 2026 (значения срезов '
  +'всегда равны сериям графика и месячным итогам сводного плана).\n');
{
  const INV_OPTS={view:'summary',mode:'tons',cats:null,nodes:null,whs:null,level:'agg',riskOnly:false};
  let n=0;
  for(const [id,P] of Object.entries(PLANS)){
    n++;
    H3('6.'+n+'. '+P.tab);
    const base=V(id,0,18,'all',id==='inventory'?INV_OPTS:{});
    p('**KPI периода «Все 18 месяцев»:**\n');
    mdTable(['KPI','Значение','Расшифровка'],base.kpis.map(k=>[k.label,k.value,k.sub]));
    const ins=typeof P.insightFor==='function'?(id==='inventory'?P.insightFor(0,3,INV_OPTS):P.insightFor(0,3)):P.insight;
    insight(ins);
    p('**Сводная таблица плана за 18 месяцев:**\n');
    mdTable(base.table.heads,base.table.rows);
    if(id!=='inventory'&&P.anomalyText)p('*⚠️ Аномалии среза (режим «Показать аномалии»):* '+strip(P.anomalyText)+'\n');
    if(id==='inventory'){
      p('**Плановые остановы (18 мес.):** '+P.stops.map(x=>MONTHS18[x.i]+' — '+strip(x.label).replace(/^Останов:\s*/,'')).join(' · ')+'\n');
      p('**Риски периода 4 кв. 2026 (перетовар > +15% к цели и дефицит ниже страхового):**\n');
      const R=P.risks(0,3,{...INV_OPTS,view:'warehouses',level:'agg'});
      if(R.list.length){
        p('| Объект | Тип риска | Худший месяц | Отклонение | Причина | Действие |');
        p('| --- | --- | --- | --- | --- | --- |');
        R.list.forEach(r=>p('| '+[r.name,r.type==='under'?'🔴 дефицит (ниже страхового)':'🟠 перетовар (+15% к цели)',
          MONTHS18[r.worstMi],r.text,strip(r.cause),strip(r.action)].map(cell).join(' | ')+' |'));
        p('');
      }else p('— рисков не выявлено.\n');
      if(R.detailCount!=null)p('*В детализации по регионам 3PL рисковых узлов: '+R.detailCount+'.*\n');
      p('**Справочник складов (17: 5 заводских ПС + 12 регионов 3PL) и категорий продуктов:**\n');
      mdTable(['Склад','Группа/регион','Базовый запас (т)','Страховой (дней)','Целевой (дней)'],
        P.warehouses.map(w=>[w.name,w.region,NUM(w.base),w.safetyDays,w.targetDays]));
      mdTable(['Категория продукта','Базовый запас (т)','Страховой (дней)','Целевой (дней)'],
        P.products.map(x=>[x.name,NUM(x.base),x.safetyDays,x.targetDays]));
    }
    const views=P.chartViews||[['summary','Сводный']];
    H4('Детальные срезы за 4 кв. 2026');
    for(const [v,label] of views){
      const vv=id==='inventory'?V(id,0,3,'q4-2026',{...INV_OPTS,view:v}):V(id,0,3,'q4-2026',{variant:v});
      p('**'+label+'**'+(vv.detail.note?' — *'+strip(vv.detail.note)+'*':'')+'\n');
      mdTable(vv.detail.heads,vv.detail.rows);
    }
  }
}
/* ═══════════════ 7. ДЕЙСТВИЯ ═══════════════ */
H2('7. Действия (план ОППиУ на ноябрь 2026)');
H3('7.1. План мероприятий');
mdTable(ACTIONS.heads,ACTIONS.rows);
H3('7.2. Статус выполнения');
seriesTable(ACTIONS.statusDonut.labels,[{name:'Действий, шт.',data:ACTIONS.statusDonut.data}]);
mdTable(ACTIONS.statusDonut.heads,ACTIONS.statusDonut.rows);
insight(ACTIONS.statusDonut.insight);
H3('7.3. Ключевые вехи (октябрь–ноябрь 2026)');
ACTIONS.milestones.forEach(([kind,when,what])=>{
  const w=strip(when);
  p('- '+w+(/[:：]$/.test(w)?' ':' — ')+strip(what));
});
p('');
H3('7.4. Ожидаемые результаты 4 кв. 2026');
mdTable(['Показатель','Цель'],ACTIONS.results.map(([l,v])=>[l,v]));
H3('7.5. Итоговое решение цикла');
p(strip(ACTIONS.decision).replace(/\n/g,'\n\n'));
p('');

/* ═══════════════ Приложение ═══════════════ */
H2('Приложение. Словарь показателей и структура выгрузки');
p('| Термин | Расшифровка |');
p('| --- | --- |');
[
  ['S&OP / IBP','Sales & Operations Planning / Integrated Business Planning — интегрированное планирование спроса, предложения, запасов и финансов на 18 месяцев.'],
  ['WAPE','Weighted Absolute Percentage Error — взвешенная по объёму абсолютная ошибка прогноза, %; цель ≤10%, факт 16,4% (3 кв. 2026).'],
  ['Bias (смещение)','Систематическая ошибка прогноза: устойчивое завышение (+) или занижение (−) прогноза против факта, %.'],
  ['FVA','Forecast Value Added — вклад корректировок продаж поверх статистического прогноза; отрицательный вклад = корректировки ухудшают точность.'],
  ['OTIF','On Time In Full — доля заказов, отгруженных вовремя и в полном объёме, %; цель 87%, факт 86% (средневзвешенно по выручке сегментов).'],
  ['Неограниченный спрос','Заявленный спрос без учёта ограничений производства, сырья и логистики.'],
  ['Покрытие спроса','Отношение доступного к отгрузке объёма к неограниченному спросу, %.'],
  ['Покрытие запасов','Дни покрытия = запас ÷ среднесуточное потребление; сравнение со страховым и целевым уровнем.'],
  ['Неликвид','Запас без оборачиваемости свыше 6 месяцев; риск списания — остаток со сроком годности менее 6 месяцев.'],
  ['ABC-XYZ','ABC — вклад в маржу (A/B/C), XYZ — вариативность спроса (X/Y/Z); определяет стратегию пополнения.'],
  ['MTS / MTO','Make To Stock (на склад) / Make To Order (под заказ).'],
  ['Бриллиант → Бронза','Пять сегментов ценности клиентов: Бриллиант (стратегическое ядро), Платина, Золото, Серебро, Бронза (транзакционная база).'],
  ['Сегменты сценария В','Перераспределение 5 000 т неподтверждённого низкомаржинального хвоста: −2 000 т Платина, −3 000 т Золото, +3 000 т Серебро (MTO-премиум), 2 000 т не приняты, Бронза −2 000 т.'],
].forEach(([t,d])=>p('| **'+t+'** | '+d+' |'));
p('');
p('**Разделы дашборда, из которых собрана выгрузка:** Обзор (KPI, помесячное ядро 2026, YoY, WAPE, отклонения) ·'
  +' 1. Сегментация (22 клиента, 5 сегментов, 7 каналов, выручка и затраты по каналам) ·'
  +' 2. Спрос (спрос против плана, waterfall, WAPE по категориям, bias, FVA, сезонность, модели) ·'
  +' 3. Запасы (покрытие, план и ретроспектива 18 мес., неликвиды, сырьё, ГП, ABC-XYZ, MTS/MTO) ·'
  +' 4. Поставки (карта цепочки и ограничения, покрытие спроса А/Б/В, сценарии, веер, тепловая карта) ·'
  +' 5. Планы (7 под-планов) · 6. Действия (мероприятия, вехи, результаты, решение).\n');
p('*Файл сгенерирован скриптом `tools/export-business-data.mjs` из модулей дашборда; '
  +'повторный запуск: `npm run export:data`.*\n');

/* ═══════════════ Запись ═══════════════ */
const target=process.argv[2]?path.resolve(process.cwd(),process.argv[2])
  :path.join(ROOT,'exports','In.Plan_IBP_данные_окт-2026.md');
fs.mkdirSync(path.dirname(target),{recursive:true});
const text=out.join('\n').replace(/^\n+/,'').replace(/\n{3,}/g,'\n\n').replace(/[ \t]+$/gm,'')+'\n';
fs.writeFileSync(target,text,'utf8');
const kb=(Buffer.byteLength(text,'utf8')/1024).toFixed(0);
console.log('✔ Выгрузка готова: '+path.relative(ROOT,target)+' — '+kb+' КБ, '+text.split('\n').length+' строк');
