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

const sp=x=>String(x).replace(/\u00a0/g,' ');   // данные форматируются через F(): неразрывный пробел

test('разрыв покрытия спроса: Серебро и Бронза в сумме не покрыты ровно на 19 000 т',()=>{
  const rows=SUPPLY.gap.table.rows;
  const silver=rows.find(r=>/Серебро/.test(r[0])),bronze=rows.find(r=>/Бронза/.test(r[0]));
  assert.equal(sp(silver[5]),'15 000');assert.equal(sp(silver[6]),'−8 000');
  assert.equal(sp(bronze[5]),'10 000');assert.equal(sp(bronze[6]),'−11 000');
  assert.equal(23000-15000+21000-10000,19000);
  // проценты покрытия соответствуют доступно/спрос
  assert.equal(sp(silver[4]),'65,2%');assert.equal(sp(bronze[4]),'47,6%');
  // в диаграмме остаются только штрихуемые зоны разрыва в полосах сегментов — без отдельной строки разрыва
  assert.ok(SUPPLY.gap.rows.some(r=>r.gapW>0),'зоны разрыва в полосах');
  assert.ok(!SUPPLY.gap.rows.some(r=>r.gapRow||/Не покрыто \(разрыв\)/.test(r.label||'')),'отдельная строка разрыва удалена');
  const silverBar=SUPPLY.gap.rows.find(r=>/Серебро/.test(r.label));
  assert.equal(sp(silverBar.value),'15 000 т');
  assert.equal(sp(silverBar.gapVal),'8 000 т');
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

test('drawChart: ряд с hidden:true выключен по умолчанию, но включается легендой',()=>{
  const {canvas}=mkStub();
  const labels=['Апр 2025','Май 2025','Июн 2025','Июл 2025'];
  const mk=()=>[
    {data:[44200,48600,29400,30800],kind:'bar',color:'#20A7C9',risks:[null,null,{type:'under',pct:-33},{type:'under',pct:-28}]},
    {data:[31680,31680,32040,31680],kind:'line',dash:true,hidden:true},
    {data:[44000,44200,44500,44000],kind:'line',dash:true,hidden:true},
    {data:[11.8,14.6,15.3,14.8],kind:'line',axis:1},
  ];
  const opts={legend:['Фактический запас, т','Страховой уровень запасов','Целевой уровень запасов','WAPE прогноза спроса %']};
  drawChart(canvas,'combo',mk(),labels,opts);
  assert.ok(canvas.__state.hidden.has(1)&&canvas.__state.hidden.has(2),'уровни страхового и целевого запаса скрыты по умолчанию');
  assert.ok(!canvas.__state.hidden.has(0)&&!canvas.__state.hidden.has(3),'столбцы и WAPE видимы');
  // перерисовка на том же canvas (разворот карточки, ресайз) не сбрасывает состояние,
  // а включение ряда кликом легенды не затирается последующей отрисовкой
  canvas.__state.hidden.delete(1);
  drawChart(canvas,'combo',mk(),labels,opts);
  assert.ok(!canvas.__state.hidden.has(1),'включенный легендой ряд остаётся видимым');
  assert.ok(canvas.__state.hidden.has(2),'остальные скрытые ряды не всплывают');
});

/* ── Тепловая карта клиент × продукт: связность с графиками покрытия и сценариями ── */
const SEG_OF=Object.fromEntries(CLIENTS.map(c=>[c.name,c.seg]));
const segOfRow=i=>SEG_OF[HEATMAP.clients[i][0]];
const r1=v=>Math.round(v*10)/10;
const SCEN={A:'A',B:'B',C:'C'};

test('тепловая карта: покрытие ячейки = покрытию сегмента на графике «Покрытие спроса»',()=>{
  /* В сценариях А и Б действует правило приоритетной матрицы на уровне сегмента:
     у всех клиентов сегмента покрытие одинаково и равно плану сегмента. */
  for(const sc of ['A','B']){
    const G=SUPPLY.gaps[sc],H=HEATMAP.abs[sc]||HEATMAP[sc];
    HEATMAP.clients.forEach((_,i)=>{
      const seg=segOfRow(i),cov=r1(G.segAlloc[seg]/SUPPLY.segDemand[seg]*100);
      H.cov.m[i].forEach(v=>{
        if(v==null)return;                       // категория клиенту не поставляется
        assert.equal(v,cov,`${sc} / ${HEATMAP.clients[i][0]}: ${v}% ≠ ${cov}%`);
      });
    });
  }
});

test('тепловая карта В: покрытие клиента = его объём к спросу, итог сегмента = плану сегмента',()=>{
  const H=HEATMAP.abs.C;
  const segAgg={};
  HEATMAP.clients.forEach((_,i)=>{
    const seg=segOfRow(i);
    assert.equal(H.cov.ct[i],r1(HEATMAP.vols.C[i]/HEATMAP.dem[i]*100),
      `В / ${HEATMAP.clients[i][0]}: покрытие ≠ объёму к спросу`);
    (segAgg[seg]=segAgg[seg]||{v:0,d:0});segAgg[seg].v+=HEATMAP.vols.C[i];segAgg[seg].d+=HEATMAP.dem[i];
  });
  ['diamond','platinum','gold','silver','bronze'].forEach(seg=>{
    const cov=r1(SUPPLY.gaps.C.segAlloc[seg]/SUPPLY.segDemand[seg]*100);
    assert.ok(Math.abs(r1(segAgg[seg].v/segAgg[seg].d*100)-cov)<0.06,
      `В / ${seg}: итог по клиентам ${segAgg[seg].v.toFixed(0)} т ≠ плану сегмента ${cov}%`);
  });
  /* адресные контракты MTO-премиум растут, хвост Бронзы отдаёт объём */
  const idx=n=>HEATMAP.clients.findIndex(([x])=>x===n);
  const dVol=n=>Math.round(HEATMAP.vols.C[idx(n)]-HEATMAP.vols.A[idx(n)]);
  /* заказ НЛМК 3 000 т размещается в пределах спрогнозированного спроса: до 100% покрытия */
  const nlmc=HEATMAP.clients.findIndex(([x])=>x==='НЛМК');
  const room=Math.round(HEATMAP.dem[nlmc]-HEATMAP.vols.A[nlmc]);
  assert.equal(dVol('НЛМК'),room,`НЛМК: +${room} т — ровно до своего спрогнозированного спроса`);
  assert.equal(HEATMAP.abs.C.cov.ct[nlmc],100,'НЛМК: покрытие ровно 100%');
  assert.equal(Math.round(HEATMAP.cap[0].want),3000,'НЛМК: заказ 3 000 т');
  assert.equal(Math.round(HEATMAP.cap[0].left),HEATMAP.contracts.C[0].vol-room,'остаток заказа не размещён у клиента');
  assert.equal(dVol('ЕВРАЗ КГОК'),1000,'ЕВРАЗ КГОК: +1 000 т премиальных продуктов');
  /* остаток заказа разлили по другим клиентам Серебра — сегментный план не поехал */
  const silv=['Лебединский ГОК','Масло24 (маркетплейс)','Михайловский ГОК им. А.В. Варичева','Камский кабель'];
  assert.equal(silv.reduce((a,nm)=>a+dVol(nm),0)+dVol('НЛМК'),
    SUPPLY.gaps.C.segAlloc.silver-SUPPLY.gaps.A.segAlloc.silver,'Серебро: +3 000 т целиком размещены в сегменте');
  assert.ok(silv.every(nm=>dVol(nm)>0),'остаток неразмещённого заказа у других клиентов Серебра');
  assert.ok(dVol('Сургутнефтегаз')<0&&dVol('Татнефть-АЗС Центр')<0&&dVol('Уральская Сталь')<0,
    'Бронза без контракта отдаёт объём');
  assert.equal(Math.round(['НЛМК','Лебединский ГОК','Масло24 (маркетплейс)','Михайловский ГОК им. А.В. Варичева','Камский кабель',
    'Сургутнефтегаз','ЕВРАЗ КГОК','Татнефть-АЗС Центр','Уральская Сталь']
    .reduce((a,n)=>a+dVol(n),0)),
    (SUPPLY.gaps.C.segAlloc.silver-SUPPLY.gaps.A.segAlloc.silver)+(SUPPLY.gaps.C.segAlloc.bronze-SUPPLY.gaps.A.segAlloc.bronze),
    'Серебро +3 000 т и Бронза −2 000 т — итог по двум сегментам как в плане');
});

test('тепловая карта: покрытие не бывает больше 100% ни у одного клиента',()=>{
  /* Ни сценарий Б (100% спрос закрыт), ни адресные контракты сценария В не могут дать
     покрытию перевалить за 100%: объём клиента размещается в пределах его спрогнозированного
     спроса, а остаток заказа расходится по другим клиентам сегмента. */
  for(const sc of ['A','B','C']){
    const H=HEATMAP.abs[sc]||HEATMAP[sc];
    H.cov.m.forEach((row,i)=>row.forEach(v=>{
      if(v==null)return;
      const name=HEATMAP.clients[i][0];
      assert.ok(v<=100,`${sc}: ${name} ${v}% > 100%`);
    }));
    assert.ok(H.cov.ctAll<=100,`${sc}: итог по портфелю ${H.cov.ctAll}% > 100%`);
    const seg={};
    HEATMAP.clients.forEach((_,i)=>{const g=segOfRow(i);(seg[g]=seg[g]||{v:0,d:0});
      seg[g].v+=HEATMAP.vols[sc][i];seg[g].d+=HEATMAP.dem[i];});
    Object.entries(seg).forEach(([g,x])=>assert.ok(x.v/x.d*100<=100.05,`${sc}: покрытие сегмента ${g} = ${(x.v/x.d*100).toFixed(1)}% > 100%`));
  }
});

test('тепловая карта: дельты Б и В равны разнице абсолютных значений к сценарию А',()=>{
  for(const sc of ['B','C']){
    const A=HEATMAP.abs.A,S=HEATMAP.abs[sc],D=HEATMAP[sc];
    for(const mode of ['cov','mrg']){
      S[mode].m.forEach((row,i)=>row.forEach((v,j)=>{
        const exp=(A[mode].m[i][j]==null||v==null)?null:r1(v-A[mode].m[i][j]);
        assert.equal(D[mode].m[i][j],exp,`${sc}.${mode}[${i}][${j}]: ${D[mode].m[i][j]} ≠ ${exp}`);
      }));
      S[mode].mt.forEach((v,j)=>assert.equal(D[mode].mt[j],r1(v-A[mode].mt[j]),`${sc}.${mode} итог по продукту ${j}`));
      S[mode].ct.forEach((v,i)=>assert.equal(D[mode].ct[i],r1(v-A[mode].ct[i]),`${sc}.${mode} итог по клиенту ${i}`));
      assert.equal(D[mode].ctAll,r1(S[mode].ctAll-A[mode].ctAll),`${sc}.${mode} общий итог`);
    }
  }
});

test('тепловая карта: знак дельты покрытия повторяет знак изменения объёма сегмента',()=>{
  ['diamond','platinum','gold','silver','bronze'].forEach(seg=>{
    const idxs=CLIENTS.map((c,i)=>c.seg===seg?i:-1).filter(i=>i>=0);
    const vol=sc=>idxs.reduce((a,i)=>a+HEATMAP.vols[sc][i],0);
    const dem=idxs.reduce((a,i)=>a+HEATMAP.dem[i],0);
    for(const sc of ['B','C']){
      const dVol=vol(sc)-vol('A');
      const dCov=(vol(sc)-vol('A'))/dem*100;
      if(dVol===0)assert.ok(Math.abs(dCov)<0.06,`${sc}/${seg}: объём не менялся, покрытие ${dCov}`);
      else assert.ok(Math.sign(dCov)===Math.sign(dVol),
        `${sc}/${seg}: объём ${dVol>0?'+':''}${dVol} т, покрытие ${dCov} п.п.`);
    }
  });
});

test('тепловая карта В: маржинальные MTO-контракты в плюсе, хвост Бронзы отдаёт объём',()=>{
  const idx=n=>HEATMAP.clients.findIndex(([x])=>x===n);
  const d=n=>HEATMAP.C.mrg.ct[idx(n)];
  const base=n=>HEATMAP.abs.A.mrg.ct[idx(n)];
  const P=0.1415;
  const gp=(n,mgn,sc)=>HEATMAP.vols[sc][idx(n)]*P*(mgn/100+HEATMAP.calib[sc]);
  /* строка клиента = объём × ставка; дельта В к А складывается из размещённой части
     контракта по ставке сценария В и переоценки базы А на калибровку В (А +1,04 → В +4,25 п.п.) */
  assert.equal(Math.round(HEATMAP.vols.C[idx('НЛМК')]-HEATMAP.vols.A[idx('НЛМК')]),
    Math.round(HEATMAP.dem[idx('НЛМК')]-HEATMAP.vols.A[idx('НЛМК')]),
    'НЛМК: размещён ровно свободный спрос клиента, не весь заказ');
  [['ЕВРАЗ КГОК',27],['НЛМК',25]].forEach(([n,mgn])=>{
    const exp=gp(n,mgn,'C')-gp(n,mgn,'A');
    assert.ok(Math.abs(d(n)-exp)<1.5,`${n}: Δмаржи ${d(n)} ≠ ${exp.toFixed(1)} млн`);
  });
  assert.ok(d('ЕВРАЗ КГОК')>0,'ЕВРАЗ КГОК в сценарии В в плюсе (маржинальный добор объёма)');
  assert.ok(d('НЛМК')>0,'НЛМК в сценарии В в плюсе');
  assert.ok(d('Сургутнефтегаз')<0&&d('Татнефть-АЗС Центр')<0&&d('Уральская Сталь')<0,
    'низкомаржинальный хвост Бронзы (16–18%) в минусе');
  assert.ok(HEATMAP.abs.C.mrg.ct[idx('ЕВРАЗ КГОК')]>base('ЕВРАЗ КГОК'),
    'валовая прибыль ЕВРАЗ КГОК в В больше, чем в А');
  /* контракт виден в строке: 1 000 т × 141 500 руб/т × (27% + калибровка В) */
  const contract=1000*P*(27/100+HEATMAP.calib.C);
  assert.ok(Math.abs(d('ЕВРАЗ КГОК')-contract)>1,
    `ЕВРАЗ КГОК: дельта ${d('ЕВРАЗ КГОК')} = контракт ${contract.toFixed(1)} + переоценка базы`);
  assert.ok(d('ЕВРАЗ КГОК')>contract,'дельта ЕВРАЗ КГОК ≥ стоимости контракта');
  /* Бронза отдаёт нетто 2 000 т хвоста и получает 1 000 т премиума → итог около нуля */
  const bronzeD=CLIENTS.reduce((a,c,i)=>a+(c.seg==='bronze'?HEATMAP.C.mrg.ct[i]:0),0);
  assert.ok(Math.abs(bronzeD)<15,'Бронза: итог Δмаржи '+bronzeD.toFixed(1)+' млн (срез хвоста компенсирован премиумом)');
  /* Серебро забирает весь прирост: +3 000 т у НЛМК дают основную часть дельты сценария */
  const silverD=CLIENTS.reduce((a,c,i)=>a+(c.seg==='silver'?HEATMAP.C.mrg.ct[i]:0),0);
  assert.ok(silverD>150,'Серебро: итог Δмаржи +'+silverD.toFixed(1)+' млн');
  assert.ok(HEATMAP.C.mrg.ct[HEATMAP.clients.findIndex(([x])=>x==='НЛМК')]>silverD*0.45,
    'НЛМК даёт почти половину прироста Серебра одним клиентом (адресный контракт, а не «размазанный» бонус)');
  /* калибровка В меньше, чем в модели без контрактов: премия разложена явно, а не «всему портфелю» */
  assert.ok(HEATMAP.calib.C*100>4&&HEATMAP.calib.C*100<4.4,'калибровка В '+(HEATMAP.calib.C*100).toFixed(2)+' п.п.');
});

test('тепловая карта: итоги строк и столбцов лежат внутри диапазона ячеек',()=>{
  for(const sc of ['A','B','C']){
    const H=HEATMAP.abs[sc]||HEATMAP[sc];
    H.cov.mt.forEach((v,j)=>{
      const col=H.cov.m.map(r=>r[j]).filter(x=>x!=null);
      assert.ok(v>=Math.min(...col)-0.05&&v<=Math.max(...col)+0.05,`${sc}: итог по продукту ${j} = ${v} вне [${Math.min(...col)}, ${Math.max(...col)}]`);
    });
    H.cov.ct.forEach((v,i)=>{
      const row=H.cov.m[i].filter(x=>x!=null);
      assert.ok(v>=Math.min(...row)-0.05&&v<=Math.max(...row)+0.05,`${sc}: итог по клиенту ${i} = ${v} вне строки`);
    });
  }
});

test('тепловая карта: валовая прибыль портфеля по сценариям сходится с финансовой моделью квартала',()=>{
  [['A','А'],['B','Б'],['C','В']].forEach(([sc,id])=>{
    let gp=0,vol=0;
    CLIENTS.forEach((c,i)=>{
      const v=HEATMAP.vols[sc][i];
      vol+=v;gp+=v*0.1415*(c.marginPct/100+HEATMAP.calib[sc]);
    });
    const target=SUPPLY.scenYear.rows.find(r=>r.id===id).q4gp;
    assert.ok(Math.abs(gp-target)<1,`${sc}: ВП портфеля ${gp.toFixed(1)} млн ≠ ${target} млн`);
    assert.ok(Math.abs(vol-SUPPLY.gaps[sc].available)<1,`${sc}: объём портфеля ${vol.toFixed(0)} т ≠ ${SUPPLY.gaps[sc].available} т`);
    /* объёмы клиентов внутри сегмента сходятся к плану сегмента */
    const segRev={};CLIENTS.forEach(c=>segRev[c.seg]=(segRev[c.seg]||0)+c.rev);
    Object.keys(segRev).forEach(seg=>{
      const v=CLIENTS.reduce((a,c,i)=>a+(c.seg===seg?HEATMAP.vols[sc][i]:0),0);
      assert.ok(Math.abs(v-SUPPLY.gaps[sc].segAlloc[seg])<1,`${sc}: ${seg} ${v.toFixed(0)} т ≠ ${SUPPLY.gaps[sc].segAlloc[seg]} т`);
    });
  });
});

test('тепловая карта: в карте весь портфель — 22 клиента, включая ЕВРАЗ КГОК (на пересмотр ↑)',()=>{
  assert.equal(HEATMAP.clients.length,22);
  assert.deepEqual(HEATMAP.clients.map(([n])=>n),CLIENTS.map(c=>c.name),'карта содержит всех клиентов портфеля в том же порядке');
  assert.equal(HEATMAP.clients.filter(([n])=>SEG_OF[n]==='silver').length,5);
  assert.equal(HEATMAP.clients.filter(([n])=>SEG_OF[n]==='bronze').length,4);
  assert.equal(HEATMAP.clients.filter(([n])=>['diamond','platinum','gold'].includes(SEG_OF[n])).length,13);
  ['АСТОН','НЛМК','ЕВРАЗ КГОК'].forEach(n=>assert.ok(HEATMAP.clients.some(([x])=>x===n),n+' отсутствует в карте'));
  /* Серебро и Бронза обслуживаются по сокращённой матрице: 6 категорий из 8.
     Исключение — ЕВРАЗ КГОК: контракт MTO-премиум по трансмиссионным маслам (7 категорий). */
  HEATMAP.clients.forEach(([n],i)=>{
    const empty=HEATMAP.A.cov.m[i].filter(v=>v==null).length;
    const exp=n==='ЕВРАЗ КГОК'?1:(['silver','bronze'].includes(SEG_OF[n])?2:0);
    assert.equal(empty,exp,`${n}: пустых ячеек ${empty}, ожидалось ${exp}`);
  });
  /* таблица данных: заголовки и строки согласованы, есть объёмы и дельта к А */
  const FT=HEATMAP.flatTable;
  assert.ok(FT.heads.slice(0,4).join('|').includes('Объём'),'таблица данных: колонки объёма');
  FT.rows.forEach(r=>{const cells=r.cells||r;assert.equal(cells.length,FT.heads.length,'число колонок таблицы данных');});
  /* выборки нет: итог карты равен валовой прибыли сценария, таблица данных — все строки */
  [['A','А'],['B','Б'],['C','В']].forEach(([sc,id])=>{
    const gp=SUPPLY.scenYear.rows.find(r=>r.id===id).q4gp;
    assert.ok(Math.abs(HEATMAP.abs[sc].mrg.ctAll-gp)<1,`${sc}: итог карты ${HEATMAP.abs[sc].mrg.ctAll} ≠ ${gp} млн`);
  });
  assert.equal(HEATMAP.flatTable.rows.length,23,'таблица данных: 22 клиента + итоговая строка');
  assert.ok(/все 22 клиента/i.test(SUPPLY.heatmapMethodology.Acov),'методология: карта по всему портфелю');
});
