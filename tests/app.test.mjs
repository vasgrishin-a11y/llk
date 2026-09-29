import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DASHBOARD_CONFIG as C} from '../src/config.js';
import {MONTHLY,normalizeRows,filterData,summary} from '../src/data.js';
import {drawChart,CHART_TYPES} from '../src/charts.js';
import {HEATMAP,PLANS} from '../src/datasets.js';

test('index содержит основные области UI и canvas',()=>{
  const h=fs.readFileSync('index.html','utf8');
  assert.match(h,/id="app"/);
  assert.match(h,/xlsx.full.min.js/);
  assert.match(h,/canvas/);
});

test('конфиг: 7 рабочих вкладок без раздела качества данных',()=>{
  assert.equal(C.tabs.length,7);
  assert.deepEqual(C.tabs.map(t=>t.id),['overview','segments','demand','stock','supply','plans','actions']);
  assert.equal(C.kpis.overview.length,8);
  for(const t of ['segments','demand','stock','supply','plans'])assert.ok(C.kpis[t].length>=5,`KPI для ${t}`);
});

test('демо-данные: тонны, млн руб. и канонический YTD',()=>{
  assert.equal(MONTHLY.length,12);
  const f=MONTHLY.filter(r=>r.type==='Факт');
  assert.equal(f.length,9);
  assert.equal(f.reduce((a,x)=>a+x.planVol,0),245000);
  assert.equal(f.reduce((a,x)=>a+x.vol,0),225500);
  assert.ok(Math.abs(f.reduce((a,x)=>a+x.rev,0)-1849.1)<0.01);
  assert.ok(MONTHLY.every(x=>x.valid));
});

test('сводка: YTD 225500/245000, выручка и средняя цена руб/т',()=>{
  const s=summary(MONTHLY);
  assert.equal(s.vol,225500);
  assert.ok(Math.abs(s.rev-1849.1)<0.01);
  assert.ok(Math.abs(s.volPct-92.04)<0.1);
  assert.ok(Math.abs(s.revPct-88.79)<0.2);
  assert.ok(Math.abs(s.avgPrice-8200)<0.2);
  assert.ok(!s.custom&&s.invalid===0);
});

test('normalizeRows понимает русские колонки, млн руб. и руб/т',()=>{
  const [r]=normalizeRows([{'Период':'Окт 2026','Тип':'Прогноз','План объема':'10000','Факт объема':'10000','План выручки':'85','Факт выручки':'82'}]);
  assert.equal(r.type,'Прогноз');
  assert.equal(r.planVol,10000);
  assert.ok(Math.abs(r.rev-82)<1e-9);
  assert.ok(Math.abs(r.price-8200)<0.2);
  assert.ok(r.valid);
});

test('filterData фильтрует по типу строки',()=>{
  assert.equal(filterData(MONTHLY,{type:'Прогноз'}).length,3);
  assert.deepEqual(filterData([],{}),[]);
});

test('тепловая карта и планы имеют согласованную размерность',()=>{
  const h=HEATMAP.A.cov;
  assert.equal(h.m.length,HEATMAP.clients.length);
  h.m.forEach(r=>assert.equal(r.length,HEATMAP.products.length));
  assert.equal(Object.keys(PLANS).length,7);
  const c=PLANS.sales.chart(0,3);
  assert.equal(c.labels.length,3);
  c.series.forEach(s=>assert.equal(s.data.length,3));
});

const mkStub=()=>{
  const ctx=new Proxy({},{get:(t,p)=>p==='measureText'?()=>({width:20}):(t[p]!==undefined?t[p]:()=>{}),set:(t,p,v)=>(t[p]=v,true)});
  return {canvas:{clientWidth:420,style:{},width:0,height:0,getContext:()=>ctx}};
};
test('drawChart отрисовывает все зарегистрированные типы без ошибок',()=>{
  const {canvas}=mkStub();
  const labels=['Янв','Фев','Мар','Апр','Май','Июн','Июл'];
  const cases={
    line:[[10,20,15,25,30,28,32]],
    bar:[{data:[10,20,15,25,30,28,32],kind:'bar',barValues:true}],
    stacked:[[10,20,15,25,30,28,32],[5,5,5,5,5,5,5]],
    hbar:[[8.2,5.1,-6.4,-6.7,1.2,-9.3,3]],
    combo:[{data:[10,20,15,25,30,28,32],kind:'bar'},{data:[2,4,3,5,6,5,7],kind:'line',axis:1}],
    area:[[80,85,90,95,100,105,110],[20,15,10,5,8,15,25]],
    waterfall:[[87500,7500,5000,100000]],
    band:[[47,50,51,48,47,45,44],[40,42,43,41,40,38,37],[35,37,38,36,35,33,33]],
    donut:[[52,21,16,6,5]],
    radar:[{data:[87.5,96,87,93,90,92,100],color:'#20A7C9'}],
    scatter:[{data:[{x:10,y:90},{x:15,y:88},{x:75,y:20}],color:'#4CAF50'}],
  };
  for(const t of CHART_TYPES){
    assert.ok(cases[t],`кейс для типа ${t}`);
    drawChart(canvas,t,cases[t],t==='radar'?labels:t==='waterfall'?['Базовый','+Промо','+Корр.','Итого']:labels,
      {legend:['ряд 1','ряд 2','ряд 3'],xTitle:'X',yTitle:'Y',compact:t==='line'});
  }
});
