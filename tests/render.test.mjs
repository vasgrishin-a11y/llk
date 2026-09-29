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
  assert.ok($$('#content .kpi').length>=8,'KPI обзора');
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
  click('[data-sw="plan"][data-val="inventory"]');
  click('[data-sw="pq"][data-val="q4-2026"]');
  assert.ok($('#c-plan'),'chart плана остатков');
  assert.match($('#content').textContent,/План запасов: Запасы растут/);
  assert.match($('#content').textContent,/4 кв\. 2026 в среднем/);

  click('[data-tab="actions"]');
  assert.ok(!$('#theme'),'переключателя темы нет');
  assert.ok($('.topnav'),'верхнее меню есть');
  assert.ok(!$('.rail'),'левого меню нет');
  assert.ok($('#upload.icon-btn'),'загрузка Excel — икон-кнопка');
  assert.ok($('#reset.icon-btn'),'сброс — икон-кнопка');
  click('#reset');
  assert.ok($('[data-tab="overview"]'),'сброс вернул обзор');
});
