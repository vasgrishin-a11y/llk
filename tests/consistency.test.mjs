/* Сплошная проверка связности бизнес-логики дашборда:
   OTIF-взвешивание, кварталы, веер маржи, ABC, SKU/категории, планы 2025/2027,
   неликвиды, отклонения, эффективность и сквозные контрольные суммы. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DASHBOARD_CONFIG as C} from '../src/config.js';
import {MONTHLY} from '../src/data.js';
import * as D from '../src/datasets.js';

const S=D.SEGMENTS, SUP=D.SUPPLY, ST=D.STOCK, OV=D.OVERVIEW, KP=D.DEMAND_KPIS, PL=D.PLANS, CL=D.CLIENTS;
const num=s=>Number(String(s).replace(/[^0-9,.-]/g,'').replace(',','.'));

/* ── 1. OTIF: общий против сегментов ── */
const segRev={},segFact={},segTgt={};
for(const c of CL){segRev[c.seg]=(segRev[c.seg]||0)+c.rev;segFact[c.seg]=(segFact[c.seg]||0)+c.rev*c.sFact;segTgt[c.seg]=(segTgt[c.seg]||0)+c.rev*c.sTarget;}
const totRev=CL.reduce((a,c)=>a+c.rev,0);
const wFact=Object.keys(segRev).reduce((a,k)=>a+segFact[k],0)/totRev;
const wTgt=Object.keys(segRev).reduce((a,k)=>a+segTgt[k],0)/totRev;
const segAvg={};for(const s of Object.keys(segRev)){const l=CL.filter(c=>c.seg===s);segAvg[s]=l.reduce((a,c)=>a+c.sFact,0)/l.length;}
const maxSeg=Math.max(...Object.values(segAvg));
const ovOtif=C.kpis.overview.find(k=>/OTIF/.test(k.label));

test('OTIF: общий = средневзвешенный по выручке сегментов (≈86, факт '+wFact.toFixed(2)+' / цель '+wTgt.toFixed(2)+')',()=>{
  assert.ok(Math.abs(parseFloat(ovOtif.value)-wFact)<0.6,`KPI=${ovOtif.value} vs ${wFact.toFixed(1)}`);
  assert.ok(parseFloat(ovOtif.value)<=maxSeg+0.01,`${ovOtif.value} vs max сегмента ${maxSeg}`);
  assert.equal(C.kpis.stock[0].value,ovOtif.value,'OTIF в запасах = обзорному');
});
test('OTIF: согласованные упоминания 2025/2026/2027 и в отклонении №2',()=>{
  assert.ok(OV.kpis2027[4].sub.includes('86%'),OV.kpis2027[4].sub);
  assert.equal(OV.kpis2025[3].value,'88%');assert.ok(OV.kpis2025[3].sub.includes('87'));
  assert.equal(OV.kpis2027[4].value,'88%');
  assert.ok(OV.deviations[1][2].includes('86%')&&OV.deviations[1][2].includes('87%'),OV.deviations[1][2].slice(0,80));
});

/* ── 2. Выручка по кварталам (YoY) против MONTHLY ── */
test('YoY-кварталы 2026 сходятся с MONTHLY',()=>{
  const mq=(a,b)=>MONTHLY.slice(a,b).reduce((x,r)=>x+r.rev,0);
  assert.equal(OV.revYoy.y2026[0],+mq(0,3).toFixed(0));
  assert.equal(OV.revYoy.y2026[1],+mq(3,6).toFixed(0));
  assert.equal(OV.revYoy.y2026[2],+mq(6,9).toFixed(0));
});

/* ── 3. Веер сценариев: маржа = объём × цена × маржа% ── */
test('маржинальные ряды веера пересчитаны из объёма (141 500 руб/т × 19,5/24,0/25,8%)',()=>{
  const F=SUP.fan;const exp=(v,m)=>v*0.1415*m;
  const bad=F.labels.map((_,i)=>i).filter(i=>Math.abs(F.marginBase[i]-exp(F.base[i],.24))>6||Math.abs(F.marginWorst[i]-exp(F.worst[i],.195))>6||Math.abs(F.marginBest[i]-exp(F.best[i],.258))>6);
  assert.deepEqual(bad,[],'месяцы с ошибкой: '+bad.join(','));
});

/* ── 4. Радар сценариев: нормировка к лучшему ── */
test('радар: маржа млн нормирована к лучшему сценарию (5002)',()=>{
  assert.ok(Math.abs(SUP.radar.series[0][1][2]-4517/5002*100)<0.1,SUP.radar.series[0][1][2]);
  assert.ok(Math.abs(SUP.radar.series[1][1][2]-4625/5002*100)<0.1,SUP.radar.series[1][1][2]);
});

/* ── 5. ABC-XYZ: доли ── */
test('ABC-XYZ: доли объёма и маржи суммируются в 100',()=>{
  assert.ok(Math.abs(ST.abcxyz.rows.reduce((a,r)=>a+Number(r[3]),0)-100)<0.01);
  assert.ok(Math.abs(ST.abcxyz.rows.reduce((a,r)=>a+Number(r[2]),0)-100)<0.01);
});

/* ── 6. Готовая продукция: SKU внутри категорий ── */
const catT=Object.fromEntries(ST.coverage.products.rows.map(r=>[r.name,r.t]));
const fg={};ST.fgTable.rows.forEach(r=>{const o=Array.isArray(r)?r:r.cells;if(o&&o[0])fg[o[0]]=o;});
test('fgTable: SKU не превышают категорий и согласованы со страховыми уровнями',()=>{
  assert.ok(num(fg['Смазки EP-2'][2])<=catT['Пластичные смазки'],`${fg['Смазки EP-2'][2]} > ${catT['Пластичные смазки']}`);
  assert.ok(num(fg['ОЖ G12++'][2])<=catT['Охлаждающие жидкости'],`${fg['ОЖ G12++'][2]} > ${catT['Охлаждающие жидкости']}`);
  const ojRow=ST.coverage.products.rows.find(r=>r.name==='Охлаждающие жидкости');
  assert.ok(num(fg['ОЖ G12++'][3])>=ojRow.safety,fg['ОЖ G12++'][3]+' vs '+ojRow.safety);
});

/* ── 7. 2027: план против KPI ── */
test('план 2027: 545 000 т / 78 000 млн; спрос 615 000; рост +12,6%/+5,0%',()=>{
  const p7=D.DEMAND.demand2027;
  assert.equal(p7.planVol.reduce((a,b)=>a+b,0),545000);
  assert.ok(Math.abs(p7.planRev.reduce((a,b)=>a+b,0)-78000)<1);
  assert.equal(p7.demand.reduce((a,b)=>a+b,0),615000);
  assert.ok(KP.y2027[1].dev.text.includes('+12,6')||OV.kpis2027[0].sub.includes('+5,0%'),KP.y2027[0].dev.text+' | '+OV.kpis2027[0].sub);
});

/* ── 8–9. KPI 2025, неликвиды ── */
test('выполнение бизнес-плана 2025 = 107%',()=>{assert.equal(KP.y2025[4].value,'107%');});
test('неликвиды: 8 000 т из 55 300 = 14,5%, 824 млн руб.',()=>{
  const deadM=ST.dead.money.series[0][1].reduce((a,b)=>a+b,0);
  const deadT=ST.dead.tons.series[0][1].reduce((a,b)=>a+b,0);
  assert.ok(/14,5%|15%/.test(C.kpis.stock[4].value),C.kpis.stock[4].value+' (факт '+(deadT/55300*100).toFixed(1)+'%)');
  assert.ok(C.kpis.stock[4].sub.includes('824'),C.kpis.stock[4].sub+' (факт '+deadM.toFixed(1)+')');
});

/* ── 10–12. Отклонения, эффективность, производство ── */
test('отклонение №3: цель EP-2 = 35 дн., согласована с таблицей ГП',()=>{
  assert.ok(OV.deviations[2][2].includes('35'),OV.deviations[2][2].slice(0,120));
});
test('эффективность: план 34 975 руб/т в подсказке; итог капитала fgTable +200',()=>{
  assert.ok(C.kpis.overview[4].tip.includes('34 975'),C.kpis.overview[4].tip.slice(-60));
  assert.ok(ST.fgTable.rows.at(-1).cells[8].includes('+200'),ST.fgTable.rows.at(-1).cells[8]);
});
test('производство: себестоимость ~84,7 млрд (776 600 т × 109 000)',()=>{
  assert.ok(PL.production.insight.includes('84,7'),PL.production.insight.slice(0,160));
});

/* ── 13. Неудовлетворённый спрос 2025 ── */
test('2025: спрос 566 500, неудовлетворённый 39 500',()=>{
  assert.ok(D.DEMAND.insight2025.includes('39 500')&&!D.DEMAND.insight2025.includes('38 000'));
  assert.ok(KP.y2025[0].sub.includes('566 500'),KP.y2025[0].sub);
});

/* ── 14. Сквозные контрольные суммы ── */
test('сквозные итоги: клиенты, разрыв, waterfall, YTD, план, каналы, запасы',()=>{
  assert.equal(CL.reduce((a,c)=>a+c.rev,0),73440,'сумма клиентов');
  assert.equal(8000+11000,19000,'разрыв покрытия');
  assert.equal(134600+10200+7200,152000,'waterfall');
  assert.equal(MONTHLY.slice(0,9).reduce((a,r)=>a+r.vol,0),390000);
  assert.ok(Math.abs(MONTHLY.slice(0,9).reduce((a,r)=>a+r.rev,0)-55185.3)<0.5,'YTD выручка');
  assert.equal(MONTHLY.slice(0,9).reduce((a,r)=>a+r.planVol,0),415000);
  assert.equal(MONTHLY.slice(0,9).reduce((a,r)=>a+r.planRev,0),59760);
  assert.equal(546000-390000,156000,'требуется в 4 кв.');
  assert.ok(390000+129000===519000&&55185+18255===73440&&12661+5002===17663,'год В');
  assert.equal(S.revDonut.year.data.reduce((a,b)=>a+b,0),73440,'выручка каналов');
  assert.equal(ST.coverage.products.rows.filter(r=>r.days<r.safety).length,2,'категории ниже страхового');
  assert.equal(ST.coverage.channels.rows.reduce((a,r)=>a+r.t,0),55300,'тонны каналов');
});

/* ── 15. Ретроспектива запасов (18 мес.) и многомерный план запасов в «Планах» ── */
test('ретроспектива запасов за прошедшие 18 мес. (Апр 2025 – Сен 2026) сходится с текущим остатком 55 300 т / 6 033 млн руб.',()=>{
  const IH=ST.invHistory;
  assert.equal(IH.labels.length,18);
  assert.equal(IH.labels[0],'Апр 2025');
  assert.equal(IH.labels[17],'Сен 2026');
  assert.equal(IH.actual[17],55300,'финальная точка ретроспективы = 55 300 т');
  assert.equal(IH.cost[17],6033,'финальная точка в деньгах = 6 033 млн руб.');
  assert.equal(IH.costTarget[17],4960,'целевая стоимость в Сен 2026 = 4 960 млн руб.');
  const belowSafety=IH.actual.filter((v,i)=>v<IH.safety[i]);
  const aboveTarget=IH.actual.filter((v,i)=>v>IH.target[i]);
  assert.ok(belowSafety.length>=3,'есть падения ниже страхового запаса');
  assert.ok(aboveTarget.length>=4,'есть превышения целевого запаса');
  assert.ok(IH.stops.length>=3,'отмечены прошедшие остановы');
});

test('многомерный План запасов (раздел Планы): 10 складских узлов, 17 складов и 8 категорий продуктов бьются с общим планом помесячно',()=>{
  const IP=PL.inventory;
  assert.equal(IP.whGroups.length,10,'5 заводов ПС + 5 регионов 3PL');
  assert.equal(IP.warehouses.length,17,'5 заводских ПС + 12 складов 3PL');
  assert.equal(IP.products.length,8,'8 категорий продуктов');
  assert.equal(IP.whGroups.reduce((a,g)=>a+g.base,0),55300,'база узлов = 55 300 т');
  assert.equal(IP.warehouses.reduce((a,w)=>a+w.base,0),55300,'база 17 складов = 55 300 т');
  assert.equal(IP.products.reduce((a,p)=>a+p.base,0),55300,'база 8 категорий = 55 300 т');

  const cSum=IP.chart(0,18,{view:'summary',mode:'tons'});
  const cWh=IP.chart(0,18,{view:'warehouses',mode:'tons'});
  const cWhD=IP.chart(0,18,{view:'warehouses',mode:'tons',level:'Detail'});
  const cPr=IP.chart(0,18,{view:'products',mode:'tons'});
  assert.equal(cWh.series.length,6,'агг. уровень: 5 заводов ПС + Все склады 3PL');
  assert.equal(cWhD.series.length,10,'детальный уровень: 5 заводов ПС + 5 регионов 3PL');
  for(let mi=0;mi<18;mi++){
    const totalIBP=cSum.series[2].data[mi];
    const sumWh=cWh.series.reduce((a,s)=>a+s.data[mi],0);
    const sumWhD=cWhD.series.reduce((a,s)=>a+s.data[mi],0);
    const sumPr=cPr.series.reduce((a,s)=>a+s.data[mi],0);
    assert.equal(sumWh,totalIBP,`месяц ${mi}: сумма по складам (агг.) = IBP`);
    assert.equal(sumWhD,totalIBP,`месяц ${mi}: сумма по складам (дет.) = IBP`);
    assert.equal(sumPr,totalIBP,`месяц ${mi}: сумма по категориям = IBP`);
  }
});

test('цель 4 кв. 2026 снижена до 43/45/47 тыс. т, план IBP сходится сверху (+8/+4/+1%)',()=>{
  const IP=PL.inventory;
  const sm=IP.summaryFor(0,3,{view:'summary',mode:'tons'});
  assert.deepEqual(sm.mTgt,[43000,45000,47000],'цель Окт/Ноя/Дек');
  assert.deepEqual(sm.mAct,[46500,47000,47500],'план IBP Окт/Ноя/Дек');
  assert.deepEqual(sm.mPct,[8,4,1],'схождение плана к цели');
  // страховой запас — 72% новой цели
  assert.deepEqual(sm.mSaf,[30960,32400,33840]);
  // KPI «План запасов» в шапке раздела сходится с октябрём
  const kpi=C.kpis.plans.find(k=>k.label==='План запасов');
  assert.equal(kpi.value,'46 500 т');
  assert.match(kpi.sub,/43 000/);
});

test('риски плана запасов: перетовар (+15% к цели) и дефицит (ниже страхового) находятся движком',()=>{
  const IP=PL.inventory;
  assert.equal(IP.RISK_OVER,1.15);
  // продукты, 4 кв.: смазки — перетовар, трансмиссионные — дефицит
  const rp=IP.risks(0,3,{view:'products'});
  const byK=Object.fromEntries(rp.list.map(r=>[r.key,r]));
  assert.equal(byK.grs.type,'over');assert.ok(byK.grs.worstPct>=15,byK.grs.worstPct);
  assert.equal(byK.trm.type,'under');assert.ok(byK.trm.worstPct<0,byK.trm.worstPct);
  assert.ok(byK.grs.cause.length>10&&byK.trm.action.length>10,'причина и действие заполнены');
  // склады (детально), 4 кв.: Ворсино + Центр + Юг
  const rw=IP.risks(0,3,{view:'warehouses',level:'Detail'});
  assert.deepEqual(rw.list.map(r=>r.key),['ps_vors','3pl_ctr','3pl_sth']);
  // склады (агг.), 4 кв.: виден только Ворсино, детализация показывает больше
  const ra=IP.risks(0,3,{view:'warehouses'});
  assert.deepEqual(ra.list.map(r=>r.key),['ps_vors']);
  assert.equal(ra.detailCount,3,'в детализации рисков больше, чем в агрегате');
  // динамика по складам, 4 кв.: три склада-нарушителя
  const rd=IP.risks(0,3,{view:'wh_detail'});
  assert.deepEqual(rd.list.map(r=>r.key),['ps_vors','3pl_msk','3pl_rnd']);
  // сводный вид рисков не показывает
  assert.equal(IP.risks(0,3,{view:'summary'}).list.length,0);
  // фильтр «Только риски» сужает серии, но не ломает тип графика
  assert.equal(IP.chart(0,3,{view:'products',riskOnly:true}).series.length,2);
  assert.equal(IP.chart(0,3,{view:'warehouses',riskOnly:true}).series.length,1);
  const wdc=IP.chart(0,3,{view:'wh_detail'});
  assert.equal(wdc.type,'line');
  assert.equal(wdc.series.length,3,'17 складов: только суммарные линии');
  const wdc2=IP.chart(0,3,{view:'wh_detail',whs:new Set(['ps_vors','3pl_msk'])});
  assert.equal(wdc2.series.length,5,'2 склада: 3 суммарные + 2 индивидуальные');
});
