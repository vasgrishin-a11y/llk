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
