import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DASHBOARD_CONFIG as C} from '../src/config.js';
import {MONTHLY,normalizeRows,filterData,summary} from '../src/data.js';
import {drawChart,CHART_TYPES} from '../src/charts.js';
import {HEATMAP,PLANS,DEMAND_KPIS,CLIENTS,SEGMENTS,STOCK,SUPPLY,planView} from '../src/datasets.js';

test('index содержит основные области UI и canvas',()=>{
  const h=fs.readFileSync('index.html','utf8');
  assert.match(h,/id="app"/);
  assert.match(h,/xlsx.full.min.js/);
  assert.match(h,/canvas/);
});

test('конфиг: 7 рабочих вкладок без раздела качества данных',()=>{
  assert.equal(C.tabs.length,7);
  assert.deepEqual(C.tabs.map(t=>t.id),['overview','segments','demand','stock','supply','plans','actions']);
  assert.equal(C.kpis.overview.length,7);
  assert.ok(!C.kpis.overview.some(k=>/Средняя цена/.test(k.label)),'карточка средней цены удалена');
  for(const t of ['segments','stock','supply','plans'])assert.ok(C.kpis[t].length>=5,`KPI для ${t}`);
  // KPI спроса — динамические по годам (src/datasets.js)
  assert.deepEqual(Object.keys(DEMAND_KPIS),['y2025','y2026','y2027']);
  Object.values(DEMAND_KPIS).forEach(list=>assert.ok(list.length>=4,'динамические KPI спроса'));
  assert.equal(DEMAND_KPIS.y2026[0].label,'Отклонение от плана YTD');
  assert.ok(/4 кв\. 2026/.test(DEMAND_KPIS.y2026[1].label),'вторая карточка 2026 — неогр. спрос 4 кв.');
  assert.equal(DEMAND_KPIS.y2026[2].label,'Прогноз года');
  assert.equal(DEMAND_KPIS.y2026[2].value,'542 000 т');
  assert.equal(DEMAND_KPIS.y2026[3].label,'Потенциал выручки 2026');
});

test('демо-данные: тонны, млн руб. и канонический YTD',()=>{
  assert.equal(MONTHLY.length,12);
  const f=MONTHLY.filter(r=>r.type==='Факт');
  assert.equal(f.length,9);
  assert.equal(f.reduce((a,x)=>a+x.planVol,0),415000);
  assert.equal(f.reduce((a,x)=>a+x.vol,0),390000);
  assert.ok(Math.abs(f.reduce((a,x)=>a+x.rev,0)-55185.3)<1.5);
  assert.ok(MONTHLY.every(x=>x.valid));
});

test('сводка: YTD 390000/415000, выручка и средняя цена руб/т',()=>{
  const s=summary(MONTHLY);
  assert.equal(s.vol,390000);
  assert.ok(Math.abs(s.rev-55185)<1);
  assert.ok(Math.abs(s.volPct-93.98)<0.1);
  assert.ok(Math.abs(s.revPct-92.34)<0.2);
  assert.ok(Math.abs(s.avgPrice-141500)<2);
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
  const q4=planView('sales',0,3,'q4-2026');
  assert.match(q4.kpis[0].value,/129/);
  assert.match(q4.kpis[0].sub,/18.?255/);
  assert.ok(!q4.kpis.some(k=>k.label==='Средняя цена'));
});

test('сегментация, разрыв и запасы соответствуют обновлённой бизнес-логике',()=>{
  assert.equal(CLIENTS.length,22);
  assert.equal(CLIENTS.reduce((a,c)=>a+c.rev,0),73440);
  assert.ok(CLIENTS.some(c=>c.name==='Михайловский ГОК им. А.В. Варичева'));
  assert.ok(!SEGMENTS.revDonut.labels.some(x=>/Прочие/.test(x)));
  assert.equal(SUPPLY.gap.table.rows.slice(0,5).reduce((a,r)=>a+Number(String(r[6]).replace(/[^0-9]/g,'')),0),19000);
  assert.ok(STOCK.coverage.echelons.labels.includes('3PL — итого'));
  assert.equal(STOCK.dead.tons.series.length,3);
  assert.ok(!STOCK.dead.tons.series.some(s=>/распродажи/.test(s[0])));
});

test('три клиента «на пересмотр»: ВП на уровне соседнего сегмента, направления ↑/↓',()=>{
  const rev=CLIENTS.filter(c=>c.review);
  assert.equal(rev.length,3);
  const by=n=>CLIENTS.find(c=>c.name===n);
  const gpRange=seg=>{const g=CLIENTS.filter(c=>c.seg===seg).map(c=>c.gp);return [Math.min(...g),Math.max(...g)];};
  const [gMin,gMax]=gpRange('gold'),[sMin,sMax]=gpRange('silver');
  // АСТОН (Платина): ВП на уровне Золота, кандидат на понижение — выручка не менялась
  const a=by('АСТОН');
  assert.equal(a.rev,4300);assert.equal(a.revDir,'down');
  assert.ok(a.gp>=gMin&&a.gp<=gMax,`ВП АСТОН (${a.gp}) в диапазоне Золота ${gMin}–${gMax}`);
  // НЛМК (Серебро): ВП на уровне Золота, кандидат на повышение
  const n=by('НЛМК');
  assert.equal(n.rev,2400);assert.equal(n.revDir,'up');
  assert.ok(n.gp>=gMin&&n.gp<=gMax,`ВП НЛМК (${n.gp}) в диапазоне Золота ${gMin}–${gMax}`);
  // ЕВРАЗ КГОК (Бронза): ВП на уровне Серебра, кандидат на повышение
  const e=by('ЕВРАЗ КГОК');
  assert.equal(e.rev,1300);assert.equal(e.revDir,'up');
  assert.ok(e.gp>=sMin&&e.gp<=sMax,`ВП ЕВРАЗ КГОК (${e.gp}) в диапазоне Серебра ${sMin}–${sMax}`);
});

test('онлайн-канал получил объём, донаты и итоги бьются',()=>{
  const online=CLIENTS.filter(c=>c.channel==='Онлайн продажи');
  assert.equal(online.length,1);
  assert.equal(online[0].rev,2000);
  const year=SEGMENTS.revDonut.year.data,ytd=SEGMENTS.revDonut.ytd.data;
  assert.equal(year.reduce((a,b)=>a+b,0),73440);
  assert.equal(Math.round(ytd.reduce((a,b)=>a+b,0)),55185);
  assert.equal(year[SEGMENTS.revDonut.labels.indexOf('Онлайн')],2000);
  assert.ok(year[5]/73440>0.02&&year[5]/73440<0.04,'доля онлайн ≈3%');
});

test('разрыв покрытия спроса: Серебро и Бронза в сумме не покрыты ровно на 19 000 т',()=>{
  const rows=SUPPLY.gap.table.rows;
  const silver=rows.find(r=>/Серебро/.test(r[0])),bronze=rows.find(r=>/Бронза/.test(r[0]));
  assert.equal(silver[5],'15 000');assert.equal(silver[6],'−8 000');
  assert.equal(bronze[5],'10 000');assert.equal(bronze[6],'−11 000');
  assert.equal(23000-15000+21000-10000,19000);
  // проценты покрытия соответствуют доступно/спрос
  assert.equal(silver[4],'65,2%');assert.equal(bronze[4],'47,6%');
  // в диаграмме остаются только штрихуемые зоны разрыва в полосах сегментов — без отдельной строки разрыва
  assert.ok(SUPPLY.gap.rows.some(r=>r.gapW>0),'зоны разрыва в полосах');
  assert.ok(!SUPPLY.gap.rows.some(r=>r.gapRow||/Не покрыто \(разрыв\)/.test(r.label||'')),'отдельная строка разрыва удалена');
  const silverBar=SUPPLY.gap.rows.find(r=>/Серебро/.test(r.label));
  assert.equal(silverBar.value,'15 000 т');
  assert.equal(silverBar.gapVal,'8 000 т');
});

test('запасы: моторные и трансмиссионные масла ниже страхового уровня (алерт)',()=>{
  const P=STOCK.coverage.products;
  const mot=P.rows.find(r=>r.name==='Масла моторные'),tr=P.rows.find(r=>r.name==='Трансмиссионные масла');
  assert.ok(mot.days<mot.safety,`моторные ${mot.days}<${mot.safety}`);
  assert.ok(tr.days<tr.safety,`трансмиссионные ${tr.days}<${tr.safety}`);
  assert.equal(P.rows.filter(r=>r.days<r.safety).length,2);
  assert.match(P.insightShort,/алерт/);
});

test('сценарии: S&OP пред. цикла убран из анализа выполнения годового плана',()=>{
  assert.ok(!('prev' in SUPPLY.scenYear));
  assert.equal(SUPPLY.scenYear.rows.length,3);
  assert.deepEqual(SUPPLY.scenYear.rows.map(r=>r.id),['А','Б','В']);
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

test('drawChart: красная зона fillBetween и доп. пункты легенды legendExtra',()=>{
  const {canvas}=mkStub();
  const series=[{data:[100,110,105,120,115],color:'#20A7C9'},{data:[90,95,92,96,94],color:'#4CAF50',dash:true}];
  const opts={legend:['План запасов IBP','Целевой запас'],fillBetween:{upper:0,lower:1,color:'#D93025',alpha:.16},
    legendExtra:[{t:'Превышение плана над целью',color:'rgba(217,48,37,.35)'}]};
  drawChart(canvas,'line',series,['м1','м2','м3','м4','м5'],opts);
  // скрытие ряда легендой не должно ломать отрисовку зоны
  canvas.__state.hidden.add(1);
  drawChart(canvas,'line',series,['м1','м2','м3','м4','м5'],opts);
  // only:'both' — вся область между линиями
  drawChart(canvas,'line',series,['м1','м2','м3','м4','м5'],{...opts,fillBetween:{upper:0,lower:1,only:'both'}});
});
