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

  // поставки: полосы разрыва с красной зоной непокрытия, итог 19 000 т
  click('[data-tab="supply"]');
  assert.ok($$('.gap-bar-un').length>=2,'красная зона непокрытия в полосах');
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

  click('[data-tab="actions"]');
  assert.ok(!$('#theme'),'переключателя темы нет');
  assert.ok($('.topnav'),'верхнее меню есть');
  assert.ok($('.topbar .brand'),'брендовый топбар есть');
  assert.ok(!$('.rail'),'левого меню нет');
  assert.ok($('#upload.tb-btn'),'загрузка Excel — икон-кнопка');
  assert.ok($('#reset.tb-btn'),'сброс — икон-кнопка');
  click('#reset');
  assert.ok($('[data-tab="overview"]'),'сброс вернул обзор');
});
