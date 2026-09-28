/* Smoke-тест: приложение в целом рендерится в DOM (jsdom, canvas отключён —
   drawChart корректно выходит при недоступном 2D-контексте). Проверяем все
   вкладки, локальные переключатели, сворачиваемые таблицы и сброс до демо. */
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

test('приложение рендерит все вкладки и их элементы управления',async()=>{
  await import('../src/app.js');
  assert.ok($$('#content .kpi').length>=8,'KPI обзора');
  assert.ok($$('canvas.chart').length>0,'canvas обзора');

  // все вкладки без ошибок и с содержимым
  for(const id of ['segments','demand','stock','supply','plans','actions','quality']){
    click(`[data-tab="${id}"]`);
    assert.ok($('#content').innerHTML.length>500,`вкладка ${id} не пуста`);
  }
  for(const id of ['segments','demand','stock','supply']){
    click(`[data-tab="${id}"]`);
    assert.ok($$('canvas.chart').length>=2,`графики на ${id}`);
  }

  // тепловая карта: сценарий В + дельта-ячейки, маржинальный режим
  click('[data-tab="supply"]');
  click('[data-sw="hmscen"][data-val="C"]');
  assert.match($('#content').innerHTML,/hm-delta-neg-good/);
  click('[data-sw="hmmode"][data-val="mrg"]');
  assert.match($('#content').innerHTML,/hm-cell/);

  // сворачиваемая таблица
  const tg=$('[data-toggle]');
  assert.ok(tg,'кнопка «📋 Данные» есть');
  tg.click();
  assert.ok($('.tbl-wrap.show'),'таблица раскрылась');

  // обзор: переключение на 2027 год
  click('[data-tab="overview"]');
  click('[data-sw="ovp"][data-val="2027"]');
  assert.ok($('#c-ovperf'),'chart overview 2027');

  // планы: подвкладка и квартальный фильтр
  click('[data-tab="plans"]');
  click('[data-sw="plan"][data-val="inventory"]');
  click('[data-sw="pq"][data-val="q4-2026"]');
  assert.ok($('#c-plan'),'chart плана остатков');
  assert.match($('#content').textContent,/План запасов: Запасы снижаются/);
  assert.match($('#content').textContent,/4 кв\. 2026 в среднем/); // квартальный фильтр срезал горизонт до Окт–Дек

  // тема и сброс
  click('[data-tab="actions"]');
  click('#theme');
  assert.equal(w.document.documentElement.dataset.theme,'dark');
  click('#reset');
  assert.ok($('[data-tab="overview"]'),'сброс вернул обзор');
});
