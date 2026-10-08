/* Smoke-тест: приложение в целом рендерится в DOM (jsdom, canvas отключён —
   drawChart корректно выходит при недоступном 2D-контексте). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',{url:'http://localhost/'});
const w=dom.window;
w.scrollTo=()=>{};
globalThis.window=w;
globalThis.document=w.document;
globalThis.localStorage=w.localStorage;
globalThis.getComputedStyle=w.getComputedStyle.bind(w);

const $=s=>w.document.querySelector(s);
const $$=s=>[...w.document.querySelectorAll(s)];
const click=(s)=>{const el=$(s);assert.ok(el,`элемент ${s} найден`);el.click();};

test('приложение рендерит все рабочие вкладки и элементы управления',async()=>{
  await import('../src/app.js');
  assert.ok($$('#content .kpi').length>=7,'KPI обзора');
  assert.ok($$('canvas.chart').length>0,'canvas обзора');
  assert.equal($$('[data-tab="quality"]').length,0,'раздел качества данных удалён');

  for(const id of ['segments','demand','stock','supply','plans','actions']){
    click(`[data-tab="${id}"]`);
    assert.ok($('#content').innerHTML.length>500,`вкладка ${id} не пуста`);
  }
  for(const id of ['segments','demand','stock','supply']){
    click(`[data-tab="${id}"]`);
    assert.ok($$('canvas.chart').length>=2,`графики на ${id}`);
  }

  // сегментация: иконка «на пересмотр» — один красно-зелёный круг (2 полуокружности)
  click('[data-tab="segments"]');
  assert.equal($$('.sm-legend svg circle').length,2,'иконка пересмотра: красно-зелёное кольцо');
  assert.equal($$('.sm-dot.sm-rev-down').length,1,'АСТОН — красная рамка');
  assert.equal($$('.sm-dot.sm-rev-up').length,2,'НЛМК и ЕВРАЗ КГОК — зелёные рамки');

  // спрос: масштаб графика FVA не от нуля — есть пояснение
  click('[data-tab="demand"]');
  assert.match($('#content').textContent,/Ось объёма — не от нуля/);

  // запасы: алерт по категориям ниже страхового уровня
  click('[data-tab="stock"]');
  click('[data-sw="invview"][data-val="products"]');
  assert.match($('#content').textContent,/Алерт: ниже страхового запаса/);
  assert.match($('#content').textContent,/Масла моторные — 18 дн\. при страховом 20/);

  // эшелоны: 3PL выделен цветом отдельно от заводов и обозначен в легенде
  click('[data-sw="invview"][data-val="echelons"]');
  const echelonChart=$('#c-cover').__cfg;
  const threePlIndex=echelonChart.labels.indexOf('3PL — итого');
  assert.ok(threePlIndex>=0,'в эшелонах есть итог 3PL');
  assert.equal(echelonChart.series[1].pointColors[threePlIndex],'#7C3AED','3PL выделен фиолетовым');
  assert.ok(echelonChart.opts.legendExtra.some(x=>x.t==='3PL — факт'),'3PL указан в легенде');

  // запасы: карточка ретроспективы за прошедшие 18 месяцев идёт после карточки «Неликвиды»
  const stockCards=$$('#content .card h2').map(h=>h.textContent);
  const deadIdx=stockCards.findIndex(t=>/Неликвиды/.test(t));
  const retroIdx=stockCards.findIndex(t=>/Анализ запасов за прошедшие 18 месяцев/.test(t));
  assert.ok(deadIdx>=0&&retroIdx>deadIdx,'график за прошедшие 18 мес. расположен после Неликвидов');
  assert.equal($('#c-invplan').__cfg.labels[0],'Апр 2025');
  assert.equal($('#c-invplan').__cfg.labels[17],'Сен 2026');
  assert.ok(Array.isArray($('#c-invplan').__cfg.opts.fillBetween),'две зоны подсветки: выше цели и ниже страхового');

  // режим «Точность прогноза»: без «светофора» — все столбцы одного цвета,
  // отклонения показаны бейджами недопоставки/перетовара, а линии страхового и
  // целевого уровня есть в легенде, но выключены по умолчанию
  click('[data-sw="invhistview"][data-val="wape"]');
  const wapeChart=$('#c-invplan').__cfg;
  assert.equal(wapeChart.type,'combo');
  assert.ok(!wapeChart.series[0].pointColors,'светофор по столбцам убран');
  assert.equal(wapeChart.series[0].color,'#20A7C9','все столбцы одного цвета');
  const risks=wapeChart.series[0].risks;
  assert.ok(Array.isArray(risks)&&risks.length===18,'индикаторы отклонений по всем месяцам');
  assert.ok(risks.some(r=>r&&r.type==='under')&&risks.some(r=>r&&r.type==='over'),'есть бейджи недопоставки и перетовара');
  assert.deepEqual(risks.slice(2,4).map(r=>r&&r.type),['under','under'],'пробои июн–июл 2025 отмечены');
  assert.equal(wapeChart.series.filter(s=>s.hidden).length,2,'страховой и целевой уровни выключены по умолчанию');
  assert.equal(typeof wapeChart.opts.tipExtra,'function','интерактивный тултип с Δ к цели в режиме точности прогноза');
  // стоимостный режим того же графика — те же минималистичные правила
  click('[data-sw="invmode"][data-val="money"]');
  const wapeMoney=$('#c-invplan').__cfg;
  assert.ok(!wapeMoney.series[0].pointColors&&Array.isArray(wapeMoney.series[0].risks),'стоимостный режим: один цвет + бейджи');
  assert.equal(wapeMoney.series.filter(s=>s.hidden).length,2,'стоимостный режим: уровни выключены по умолчанию');
  click('[data-sw="invmode"][data-val="tons"]');
  click('[data-sw="invhistview"][data-val="stocks"]');

  // поставки: зоны разрыва в полосах, без отдельной строки «Не покрыто (разрыв)»
  click('[data-tab="supply"]');
  const spbNode=$$('.cg-node').find(g=>g.textContent.includes('Санкт-Петербург'));
  assert.ok(spbNode,'узел СЗ Санкт-Петербург найден на карте цепочки поставок');
  const spbX=parseFloat(spbNode.querySelector('rect').getAttribute('x'));
  assert.ok(spbX>=235,`узел СЗ Санкт-Петербург (x=${spbX}) не перекрывает подпись «Склады 3PL по регионам»`);
  assert.ok($$('.gap-bar-un').length>=2,'штрихуемые зоны разрыва в полосах');
  assert.ok(!$('.gap-chart').textContent.includes('Не покрыто (разрыв)'),'отдельная строка разрыва удалена');
  assert.match($('#content').textContent,/Серебро −8 000 т \+ Бронза −11 000 т = −19 000 т/);
  assert.ok(!$('#content').textContent.includes('S&OP пред. цикла ·'),'S&OP пред. цикла убран из анализа сценариев');

  click('[data-tab="supply"]');
  click('[data-sw="hmscen"][data-val="C"]');
  assert.match($('#content').innerHTML,/hm-delta-neg-good/);
  click('[data-sw="hmmode"][data-val="mrg"]');
  assert.match($('#content').innerHTML,/hm-cell/);

  // сценарии: кнопок «Свернуть сценарий» нет — вместо них пропорциональное увеличение
  assert.equal($$('.scen-toggle').length,0,'кнопки «+/−» у сценариев удалены');
  assert.equal($$('[data-scen-toggle]').length,0,'переключателей сворачивания сценария нет');
  assert.ok(!$('#content').innerHTML.includes('Свернуть сценарий'),'подписи «Свернуть сценарий» нет');
  assert.ok(!$$('.scen').some(x=>x.classList.contains('collapsed')),'сценарии всегда раскрыты');
  assert.equal($$('.scen > .chart-expand').length,3,'кнопки увеличения у всех трёх сценариев');

  const scen=$('#content .scen');assert.ok(scen,'карточка сценария есть');
  const scenExp=scen.querySelector(':scope > .chart-expand');
  assert.ok(scenExp,'у карточки сценария есть кнопка увеличения');
  const vw=w.innerWidth,vh=w.innerHeight;
  const stageW=()=>parseFloat($('.zoom-stage').style.width);
  const stageH=()=>parseFloat($('.zoom-stage').style.height);
  const zoomK=()=>parseFloat(/scale\(([\d.]+)\)/.exec($('.zoom-scale').style.transform)[1]);
  scenExp.click();
  assert.ok($('.zoom-layer')&&$('.zoom-stage'),'открылось окно увеличения');
  assert.ok($('.zoom-win .zoom-scale .scen.zoom-clone'),'внутри окна — копия карточки сценария');
  assert.equal($('.zoom-clone .chart-expand'),null,'у копии нет кнопки увеличения');
  assert.ok($('.fs-backdrop'),'фон-подложка показана');
  assert.ok(w.document.body.classList.contains('fs-lock'),'страница под окном не прокручивается');
  assert.ok(!scen.classList.contains('fs'),'сценарий больше не растягивается на весь экран');
  assert.ok(scen.closest('#content'),'исходная карточка осталась на своём месте');
  assert.ok(stageW()<=vw*0.7+1,`ширина окна ${stageW()}px ≤ 70% экрана (${vw}px)`);
  assert.ok(stageH()<=vh*0.7+1,`высота окна ${stageH()}px ≤ 70% экрана (${vh}px)`);
  assert.ok(zoomK()>=1&&zoomK()<=2.2,`масштаб ${zoomK()} в пределах 1…2,2`);
  /* окно равно масштабированному контенту — пустых полей внутри нет */
  const fitW=parseFloat($('.zoom-fit').style.width),fitH=parseFloat($('.zoom-fit').style.height);
  const scW=parseFloat($('.zoom-scale').style.width),scH=parseFloat($('.zoom-scale').style.height);
  assert.ok(Math.abs(scW*zoomK()-fitW)<1.01,'ширина окна = ширине контента');
  assert.ok(Math.abs(scH*zoomK()-fitH)<1.01,'высота окна = высоте контента');
  assert.ok(Math.abs(stageW()-fitW)<1.01&&Math.abs(stageH()-fitH)<1.01,'окно обрезано ровно по контенту');
  assert.equal(w.document.activeElement,$('.zoom-win'),'фокус переведён в окно увеличения');
  $('.zoom-win').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
  assert.equal(w.document.activeElement,$('.zoom-close'),'Tab не выпускает фокус из окна');
  $('.zoom-close').click();
  assert.ok(!$('.zoom-layer')&&!$('.fs-backdrop'),'крестик закрывает окно увеличения');
  scen.click();
  assert.ok($('.zoom-layer'),'клик по самой карточке тоже увеличивает её');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));
  assert.ok(!$('.zoom-layer')&&!$('.fs-backdrop'),'Esc закрывает окно увеличения');
  scenExp.click();assert.ok($('.zoom-layer'),'кнопка снова открывает увеличение');
  scenExp.click();assert.ok(!$('.zoom-layer'),'повторный клик по кнопке возвращает обычный размер');
  assert.match(scenExp.title,/70% экрана/,'подсказка кнопки объясняет размер окна');

  // то же самое для панели «Выполнение бизнес-плана 2026»
  const sy=$('#content .scen-year');assert.ok(sy,'панель выполнения бизнес-плана есть');
  const syExp=sy.querySelector(':scope > .chart-expand');
  assert.ok(syExp,'у панели бизнес-плана есть кнопка увеличения');
  syExp.click();
  assert.ok($('.zoom-win .zoom-scale .scen-year.zoom-clone'),'панель бизнес-плана увеличена в окне');
  assert.match($('.zoom-win').getAttribute('aria-label'),/Выполнение бизнес-плана 2026/,'у окна есть подписанная метка');
  assert.ok(stageW()<=vw*0.7+1&&stageH()<=vh*0.7+1,'окно панели тоже ≤ 70% экрана');
  assert.ok(!sy.classList.contains('fs'),'панель не разворачивается на весь экран');
  syExp.click();
  assert.ok(!$('.zoom-layer'),'панель вернулась к обычному размеру');
  // карточки с графиками по-прежнему разворачиваются на весь экран
  const chartCard=$$('#content .card').find(c=>c.querySelector('canvas.chart'));
  chartCard.querySelector(':scope > .chart-expand').click();
  assert.ok(chartCard.classList.contains('fs'),'карточка с графиком разворачивается на весь экран');
  chartCard.querySelector(':scope > .chart-expand').click();
  assert.ok(!chartCard.classList.contains('fs'),'повторный клик сворачивает карточку обратно');
  // радар сравнения сценариев — с подписями осей
  assert.equal($('#c-radar').__cfg.type,'radar','радар сравнения сценариев');

  const tg=$('[data-toggle]');
  assert.ok(tg,'кнопка «📋 Данные» есть');
  tg.click();
  assert.ok($('.tbl-wrap.show'),'таблица раскрылась');

  click('[data-tab="overview"]');
  /* «Ключевые отклонения» сворачиваются по образцу «Данные» */
  const devBtn=$('[data-toggle="ov-deviations"]');
  assert.ok(devBtn,'кнопка сворачивания отклонений есть');
  assert.match(devBtn.textContent,/Показать отклонения/);
  assert.ok(!$('#ov-deviations').classList.contains('show'),'отклонения скрыты по умолчанию');
  devBtn.click();
  assert.ok($('#ov-deviations').classList.contains('show'),'отклонения раскрылись');
  assert.match(devBtn.textContent,/Скрыть отклонения/);
  assert.ok($$('#ov-deviations .info').length>=3,'строки отклонений отрисованы');
  devBtn.click();
  assert.ok(!$('#ov-deviations').classList.contains('show'),'отклонения снова скрыты');

  click('[data-sw="ovp"][data-val="2027"]');
  assert.ok($('#c-ovperf'),'chart overview 2027');

  click('[data-tab="plans"]');
  const pqAct=$$('.switch [data-sw="pq"]').find(b=>b.classList.contains('active'));
  assert.ok(pqAct&&pqAct.dataset.val==='q4-2026','по умолчанию открывается 4 кв. 2026');
  click('[data-sw="plan"][data-val="inventory"]');
  click('[data-sw="pq"][data-val="q4-2026"]');
  assert.ok($('#c-plan'),'chart плана остатков');
  assert.match($('#content').textContent,/План запасов: базовый уровень следует целевому запасу/);
  assert.match($('#content').textContent,/Дек 2026 — итого/,'детализация по месяцам есть');
  assert.match($('#content').textContent,/ПС Ворсино/,'детализация до складов есть');

  // переключение на 18 месяцев в Плане запасов показывает отметки плановых остановов
  click('[data-sw="pq"][data-val="all"]');
  assert.equal($('#c-plan').__cfg.opts.marks.length,3,'3 плановых останова на горизонте 18 мес.');

  // возвращаемся в 4 кв. 2026 для тестов видов графика, фильтров и рисков
  click('[data-sw="pq"][data-val="q4-2026"]');

  // переключалка видов графика в Плане запасов + быстрые мульти-фильтры
  click('[data-sw="planinvview"][data-val="warehouses"]');
  assert.equal($('#c-plan').__cfg.type,'stacked','помесячный стек по заводам и 3PL');
  assert.equal($('#c-plan').__cfg.series.length,6,'по умолчанию: 5 заводов ПС + Все склады 3PL');
  assert.ok($('#c-plan').__cfg.opts.legend.includes('Все склады 3PL'),'агрегированный уровень 3PL');
  click('[data-sw="invWhLevel"][data-val="Detail"]');
  assert.equal($('#c-plan').__cfg.series.length,10,'детализация: 5 заводов ПС + 5 регионов 3PL');
  click('[data-sw="invWhLevel"][data-val="agg"]');
  assert.ok($('[data-invcat="mot"]'),'быстрый фильтр по категориям продуктов есть');
  click('[data-invcat="mot"]');
  click('[data-invcat="grs"]');
  assert.equal($$('[data-invcat].active').length,2,'выбраны 2 категории продуктов одновременно');
  click('[data-invcat="all"]');
  // полоса рисков: бейджи перетовара/дефицита + фильтр «Только риски»
  assert.ok($('.risk-strip'),'полоса рисков отрисована');
  assert.ok($$('.risk-badge').length>=1,'есть бейджи рисков');
  click('[data-sw="invrisk"][data-val="1"]');
  assert.equal($('#c-plan').__cfg.series.length,1,'«Только риски» 4 кв. (агг.): один ПС Ворсино');
  assert.equal($('#c-plan').__cfg.opts.legend[0],'ПС Ворсино');
  click('[data-sw="invrisk"][data-val="0"]');

  click('[data-sw="planinvview"][data-val="wh_detail"]');
  assert.equal($('#c-plan').__cfg.type,'line','динамика выборки складов, как сводный план');
  assert.deepEqual($('#c-plan').__cfg.labels.slice(0,3),['Окт 2026','Ноя 2026','Дек 2026'],'ось X — периоды');
  assert.equal($('#c-plan').__cfg.series.length,3,'все 17 складов: только суммарные линии');
  assert.ok($('[data-invwh="ps_vors"]'),'фильтр выбора складов есть');
  click('[data-invwh="ps_vors"]');
  click('[data-invwh="3pl_msk"]');
  assert.equal($$('[data-invwh].active').length,2,'выбраны 2 склада одновременно');
  assert.equal($('#c-plan').__cfg.series.length,5,'2 склада: 3 суммарные линии + 2 индивидуальные');
  assert.ok($('.risk-strip'),'полоса рисков в динамике по складам');
  click('[data-invwh="all"]');

  click('[data-sw="planinvview"][data-val="products"]');
  assert.equal($('#c-plan').__cfg.type,'stacked','помесячный стек по категориям продуктов');
  assert.equal($('#c-plan').__cfg.series.length,8,'8 категорий продуктов');
  assert.ok($('[data-invnode="ps_perm"]'),'быстрый фильтр по заводам и регионам 3PL есть');
  click('[data-invnode="ps_perm"]');
  click('[data-invnode="3pl_sib"]');
  assert.equal($$('[data-invnode].active').length,2,'выбраны завод и регион 3PL одновременно');
  click('[data-invnode="all"]');
  click('[data-sw="invrisk"][data-val="1"]');
  assert.equal($('#c-plan').__cfg.series.length,2,'риски 4 кв.: смазки (перетовар) + трансмиссионные (дефицит)');
  click('[data-sw="invrisk"][data-val="0"]');
  click('[data-sw="planinvview"][data-val="summary"]');

  click('[data-tab="actions"]');
  assert.ok(!$('#theme'),'переключателя темы нет');
  assert.ok($('.topnav'),'верхнее меню есть');
  assert.ok($('.topbar .brand'),'брендовый топбар есть');
  assert.ok(!$('.rail'),'левого меню нет');
  assert.ok($('#upload.tb-btn'),'загрузка Excel — икон-кнопка');
  assert.ok($('#reset.tb-btn'),'сброс — икон-кнопка');
  /* экспорт: кнопка справа вверху с выбором формата */
  assert.ok($('#exportBtn.tb-btn'),'кнопка экспорта в топбаре');
  const menu=$('#exportMenu');
  assert.ok(menu&&menu.hidden,'меню форматов скрыто по умолчанию');
  assert.ok(menu.querySelector('[data-exp="pdf"]')&&menu.querySelector('[data-exp="pptx"]'),'пункты PDF и PPTX');
  assert.ok($('#exportBtn').closest('.topbar-actions'),'кнопка в правой группе топбара');
  click('#reset');
  assert.ok($('[data-tab="overview"]'),'сброс вернул обзор');
});

test('геометрия окна увеличения: ≈70% экрана, пропорционально и без пустых полей',async()=>{
  const {zoomGeom}=await import('../src/app.js');
  /* карточка сценария (450×340) на экране 1440×900 */
  const g=zoomGeom(450,340,1440,900);
  assert.ok(g.k>1&&g.k<=2.2,`масштаб ${g.k.toFixed(3)} — увеличение в допустимых пределах`);
  assert.ok(g.w<=1440*0.7+1e-6&&g.h<=900*0.7+1e-6,'окно не больше 70% экрана');
  assert.ok(Math.abs(g.h-900*0.7)<1e-6,'по ограничивающей стороне окно занимает ровно 70% высоты');
  assert.ok(Math.abs(g.w/g.h-450/340)<1e-9,'пропорции контента сохранены');
  assert.ok(Math.abs(g.w-g.w0*g.k)<1e-6&&Math.abs(g.h-g.h0*g.k)<1e-6,'размер окна = размеру контента');
  assert.equal(g.winW,g.w);assert.equal(g.winH,g.h,'пустых полей внутри окна нет');
  /* широкая панель «Выполнение бизнес-плана 2026» (726×520) увеличивается скромнее */
  const sy=zoomGeom(726,520,1440,900);
  assert.ok(sy.k>1&&sy.k<g.k,`широкая панель: масштаб ${sy.k.toFixed(3)} < ${g.k.toFixed(3)}`);
  assert.ok(Math.abs(sy.h-900*0.7)<1e-6,'панель тоже упирается в 70% высоты');
  /* очень большой экран — масштаб ограничен потолком 2,2× */
  assert.equal(zoomGeom(300,200,3840,2160).k,2.2,'масштаб не превышает 2,2×');
  /* блок крупнее 70% экрана: не уменьшаем, окно ограничено экраном, появляется прокрутка */
  const big=zoomGeom(1600,1200,1440,900);
  assert.equal(big.k,1,'крупный блок не уменьшается');
  assert.equal(big.winW,1440-32,'окно не выходит за пределы экрана');
  assert.ok(big.winW<big.w&&big.winH<big.h,'окно крупного блока меньше контента — появится прокрутка');
  /* узкий экран (ноутбук 1280×720) — окно всё равно вписывается в 70% */
  const small=zoomGeom(420,320,1280,720);
  assert.ok(small.winW<=1280*0.7+1e-6&&small.winH<=720*0.7+1e-6,'на 1280×720 окно ≤ 70% экрана');
  assert.ok(small.k>1,'на небольшом экране контент всё равно увеличивается');
});

test('раздел «Планы»: таблица «Данные» перестраивается под выбранный срез графика',async()=>{
  await import('../src/app.js');
  click('[data-tab="plans"]');
  click('[data-sw="plan"][data-val="sales"]');
  click('[data-sw="pq"][data-val="q4-2026"]');
  /* сводный срез: месячные итоги графика «План объёма + выручка» */
  assert.match($('#tbl-plan-sales').textContent,/План объёма \(т\)/, 'сводная таблица продаж');
  assert.match($('#content').textContent,/тот же срез, что и на графике/, 'подпись к таблице есть');
  /* каналы и категории — свои срезы */
  click('[data-sw="planview"][data-val="channels"]');
  assert.match($('#tbl-plan-sales').textContent,/Канал продаж/);
  assert.match($('#tbl-plan-sales').textContent,/Ключевые B2B/);
  click('[data-sw="planview"][data-val="categories"]');
  assert.match($('#tbl-plan-sales').textContent,/Категория продукта/);
  /* производство: периодный срез по линиям */
  click('[data-sw="plan"][data-val="production"]');
  click('[data-sw="planview"][data-val="lines"]');
  assert.match($('#tbl-plan-production').textContent,/Линия №1 \(т\)/);
  assert.match($('#tbl-plan-production').textContent,/Итого по линиям/);
  /* перемещения: стоимость перевозки авто/ЖД */
  click('[data-sw="plan"][data-val="movements"]');
  click('[data-sw="planview"][data-val="cost"]');
  assert.match($('#tbl-plan-movements').textContent,/Авто \(млн руб\.\)/);
  /* аномалии: в таблице появляется колонка «Отклонение» */
  click('[data-sw="plan"][data-val="cost"]');
  click('[data-sw="plananom"][data-val="1"]');
  click('[data-sw="planview"][data-val="unit"]');
  assert.match($('#tbl-plan-cost').textContent,/Отклонение/);
  click('[data-sw="plananom"][data-val="0"]');
  /* возврат к сводному срезу */
  click('[data-sw="plan"][data-val="sales"]');
  click('[data-sw="planview"][data-val="summary"]');
  assert.match($('#tbl-plan-sales').textContent,/Итого за период/);
});
