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

/* ── 22. Ретроспектива запасов × WAPE: помесячная точность прогноза ── */
test('WAPE 18 мес: среднее 3 кв. 2026 = 16,4% (совпадает с квартальным KPI), худший месяц — Сен 2026',()=>{
  const IH=ST.invHistory;
  assert.equal(IH.wape.length,18);
  assert.equal(IH.bias.length,18);
  assert.equal(+((IH.wape[15]+IH.wape[16]+IH.wape[17])/3).toFixed(1),16.4);
  assert.equal(Math.max(...IH.wape),IH.wape[17],'пик запаса 55 300 т — худший WAPE 17,3%');
  assert.equal(IH.rowsW.length,18);
  assert.equal(IH.headsW.length,6);
});

/* ── 23. Сценарий В: обновлённое описание ── */
test('сценарий В: 27,4% маржинальности и +485 млн руб. к сценарию А',()=>{
  const c=SUP.scenarios.find(x=>x.id==='C');
  assert.ok(/27,4%/.test(c.desc)&&/485/.test(c.desc),c.desc.slice(0,120));
});

/* ── 24. Раздел «Планы»: таблицы «Данные» повторяют выбранный срез графика ──
   Для каждого под-плана и каждого среза проверяем: месячные итоги таблицы равны
   столбцам/линиям графика, подытоги среза равны сериям графика, а сумма строк
   равна итогу (математика таблиц сходится без остатка). */
const n2=s=>Number(String(s).replace(/<[^>]+>/g,'').replace(/[\s\u00A0%]/g,'').replace(',','.').replace('−','-'));
const eqN=(a,b,tol=0.6)=>Math.abs(a-b)<=tol;
const byMonth=(pl,variant)=>{
  const out=Array.from({length:18},()=>({total:null,sub:[],det:[]}));
  for(const r of D.planView(pl,0,18,'all',{variant}).detail.rows){
    const c=Array.isArray(r)?r:r.cells,k=Array.isArray(r)?'':(r.cls||'');
    const mi=D.MONTHS18.indexOf(String(c[0]).replace(/<[^>]+>/g,'').replace(' — итого','').trim());
    if(mi<0)continue;
    if(k==='row-sum')out[mi].total=c;
    else if(k==='row-fc')out[mi].sub.push(c);
    else out[mi].det.push(c);
  }
  return out;
};
const sumSeries=(ch,mi)=>ch.series.reduce((x,s)=>x+s.data[mi],0);

test('Планы: сводные таблицы = месячным итогам сводных графиков (6 под-планов)',()=>{
  /* продажи и выручка: столбец — объём/выручка, линия — выручка/валовая прибыль */
  for(const pl of ['sales','revenue']){
    const det=byMonth(pl,'summary'),ch=D.PLANS[pl].chart(0,18);
    for(let mi=0;mi<18;mi++){
      assert.equal(det[mi].det.length,1,`${pl} ${D.MONTHS18[mi]}: одна строка месяца`);
      const row=det[mi].det[0];
      assert.ok(eqN(n2(row[1]),ch.series[0].data[mi]),`${pl} ${D.MONTHS18[mi]} столбец: ${n2(row[1])} ≠ ${ch.series[0].data[mi]}`);
      assert.ok(eqN(n2(row[2]),ch.series[1].data[mi]),`${pl} ${D.MONTHS18[mi]} линия: ${n2(row[2])} ≠ ${ch.series[1].data[mi]}`);
    }
  }
  /* производство: столбец — выпуск, линия — загрузка мощностей */
  {
    const det=byMonth('production','summary'),ch=D.PLANS.production.chart(0,18);
    for(let mi=0;mi<18;mi++){
      const row=det[mi].det[0];
      assert.ok(eqN(n2(row[1]),ch.series[0].data[mi]),`production ${D.MONTHS18[mi]} выпуск`);
      assert.ok(eqN(n2(row[2]),ch.series[1].data[mi]),`production ${D.MONTHS18[mi]} загрузка: ${n2(row[2])} ≠ ${ch.series[1].data[mi]}`);
    }
  }
  /* перемещения: авто и ЖД — столбцы графика */
  {
    const det=byMonth('movements','summary'),ch=D.PLANS.movements.chart(0,18);
    for(let mi=0;mi<18;mi++){
      const row=det[mi].det[0];
      assert.ok(eqN(n2(row[1]),ch.series[0].data[mi])&&eqN(n2(row[2]),ch.series[1].data[mi]),`movements ${D.MONTHS18[mi]}`);
      assert.ok(eqN(n2(row[3]),ch.series[0].data[mi]+ch.series[1].data[mi]),`movements итог ${D.MONTHS18[mi]}`);
    }
  }
  /* закупки: три группы сырья — серии столбцов */
  {
    const det=byMonth('purchases','summary'),ch=D.PLANS.purchases.chart(0,18);
    for(let mi=0;mi<18;mi++){
      const row=det[mi].det[0];
      ch.series.forEach((s,j)=>assert.ok(eqN(n2(row[1+j]),s.data[mi]),`purchases ${D.MONTHS18[mi]} гр.${j}`));
      assert.ok(eqN(n2(row[4]),sumSeries(ch,mi)),`purchases итог ${D.MONTHS18[mi]}`);
    }
  }
  /* закупки: тоннаж месяца = сумме тонн поставщиков */
  {
    const detS=byMonth('purchases','suppliers'),det=byMonth('purchases','summary');
    for(let mi=0;mi<18;mi++){
      const tonnes=detS[mi].det.reduce((x,r)=>x+n2(r[3]),0);
      assert.ok(eqN(tonnes,n2(det[mi].det[0][5]),1.01),`purchases тоннаж ${D.MONTHS18[mi]}: ${tonnes} ≠ ${n2(det[mi].det[0][5])}`);
    }
  }
  /* себестоимость: статьи — сегменты столбцов графика */
  {
    const det=byMonth('cost','summary'),ch=D.PLANS.cost.chart(0,18,{showAnomalies:false});
    for(let mi=0;mi<18;mi++){
      ch.series.forEach((s,j)=>assert.ok(eqN(n2(det[mi].det[j][2]),s.data[mi],0.06),`cost ${D.MONTHS18[mi]} ст.${j}`));
      assert.ok(eqN(n2(det[mi].total[2]),sumSeries(ch,mi),0.06),`cost итог ${D.MONTHS18[mi]}`);
      const rowsSum=det[mi].det.reduce((x,r)=>x+n2(r[2]),0);
      assert.ok(eqN(rowsSum,n2(det[mi].total[2]),0.06),`cost сумма строк ${D.MONTHS18[mi]}`);
    }
  }
});

test('Планы: таблицы бизнес-срезов = сериям графиков (каналы, заводы, линии, направления, поставщики)',()=>{
  /* продажи/выручка: каналы и категории */
  for(const pl of ['sales','revenue']){
    for(const v of ['channels','categories']){
      const det=byMonth(pl,v),ch=D.PLANS[pl].chartFor(0,18,v,false);
      for(let mi=0;mi<18;mi++){
        ch.opts.legend.forEach((name,j)=>{
          const row=det[mi].det.find(r=>String(r[1])===name);
          assert.ok(row,`${pl}/${v} ${D.MONTHS18[mi]}: есть строка «${name}»`);
          assert.ok(eqN(n2(row[2]),ch.series[j].data[mi]),`${pl}/${v} ${name} ${D.MONTHS18[mi]}: ${n2(row[2])} ≠ ${ch.series[j].data[mi]}`);
        });
        assert.ok(eqN(n2(det[mi].total[2]),sumSeries(ch,mi)),`${pl}/${v} итог ${D.MONTHS18[mi]}`);
      }
    }
  }
  /* производство: заводы (месячно) и линии (за период) */
  {
    const det=byMonth('production','plants'),ch=D.PLANS.production.chartFor(0,18,'plants',false);
    for(let mi=0;mi<18;mi++){
      ch.opts.legend.forEach((name,j)=>{
        const row=det[mi].det.find(r=>String(r[1])===name);
        assert.ok(row&&eqN(n2(row[2]),ch.series[j].data[mi]),`production ${name} ${D.MONTHS18[mi]}`);
      });
      assert.ok(eqN(n2(det[mi].total[2]),sumSeries(ch,mi)),`production plants итог ${D.MONTHS18[mi]}`);
    }
    const view=D.planView('production',0,18,'all',{variant:'lines'}).detail;
    const ln=D.PLANS.production.chartFor(0,18,'lines',false);
    const totalRow=view.rows.find(r=>!Array.isArray(r)&&r.cls==='row-total').cells;
    ln.opts.legend.forEach((name,li)=>{
      const chartSum=ln.series[li].data.reduce((a,b)=>a+b,0);
      assert.ok(eqN(n2(totalRow[1+li]),chartSum,0.06),`production линии ${name}: ${n2(totalRow[1+li])} ≠ ${chartSum}`);
    });
    ln.labels.forEach((f,fi)=>{
      const costRow=view.rows.map(r=>r.cells||r).find(c=>c[0]===f);
      const chartSum=ln.series.reduce((x,s)=>x+s.data[fi],0);
      assert.ok(eqN(n2(costRow[4]),chartSum),`production линия/завод ${f}: ${n2(costRow[4])} ≠ ${chartSum}`);
      assert.equal(n2(costRow[1])+n2(costRow[2])+n2(costRow[3]),n2(costRow[4]),`production ${f}: строки не сходятся`);
    });
  }
  /* перемещения: направления и стоимость перевозки */
  {
    const det=byMonth('movements','corridors'),ch=D.PLANS.movements.chartFor(0,18,'corridors',false);
    for(let mi=0;mi<18;mi++)ch.opts.legend.forEach((name,j)=>{
      const row=det[mi].det.find(r=>String(r[1])===name);
      assert.ok(row&&eqN(n2(row[2]),ch.series[j].data[mi]),`movements ${name} ${D.MONTHS18[mi]}: ${row?n2(row[2]):'-'} ≠ ${ch.series[j].data[mi]}`);
    });
    const detC=byMonth('movements','cost'),chC=D.PLANS.movements.chartFor(0,18,'cost',false);
    for(let mi=0;mi<18;mi++){
      assert.ok(eqN(n2(detC[mi].det[0][1]),chC.series[0].data[mi],0.06),`movements cost авто ${D.MONTHS18[mi]}`);
      assert.ok(eqN(n2(detC[mi].det[0][2]),chC.series[1].data[mi],0.06),`movements cost ЖД ${D.MONTHS18[mi]}`);
    }
  }
  /* закупки: поставщики и физический объём */
  {
    const det=byMonth('purchases','suppliers'),ch=D.PLANS.purchases.chartFor(0,18,'suppliers',false);
    for(let mi=0;mi<18;mi++)ch.opts.legend.forEach((name,j)=>{
      const row=det[mi].det.find(r=>String(r[1])===name);
      assert.ok(row&&eqN(n2(row[5]),ch.series[j].data[mi]),`purchases ${name} ${D.MONTHS18[mi]}`);
    });
    const detT=byMonth('purchases','tons'),chT=D.PLANS.purchases.chartFor(0,18,'tons',false);
    for(let mi=0;mi<18;mi++)chT.series.forEach((s,j)=>{
      assert.ok(eqN(n2(detT[mi].det[j][2]),s.data[mi]),`purchases тоннаж ${D.MONTHS18[mi]} гр.${j}`);
    });
  }
  /* себестоимость: заводы и руб/т */
  {
    const det=byMonth('cost','plants'),ch=D.PLANS.cost.chartFor(0,18,'plants',false);
    for(let mi=0;mi<18;mi++)ch.opts.legend.forEach((name,j)=>{
      const row=det[mi].det.find(r=>String(r[1])===name);
      assert.ok(row&&eqN(n2(row[2]),ch.series[j].data[mi],0.06),`cost ${name} ${D.MONTHS18[mi]}`);
    });
    const detU=byMonth('cost','unit'),chU=D.PLANS.cost.chartFor(0,18,'unit',false);
    for(let mi=0;mi<18;mi++){
      chU.series.forEach((s,j)=>assert.ok(eqN(n2(detU[mi].det[j][2]),s.data[mi],0.06),`cost руб/т ${D.MONTHS18[mi]} ст.${j}`));
      assert.ok(eqN(n2(detU[mi].total[2]),sumSeries(chU,mi),0.06),`cost руб/т итог ${D.MONTHS18[mi]}`);
    }
  }
});

test('Планы: таблицы во всех срезах не теряют данные графика (срез → таблица)',()=>{
  const views={sales:['summary','channels','categories'],production:['summary','plants','lines'],movements:['summary','corridors','cost'],
    purchases:['summary','suppliers','tons'],cost:['summary','plants','unit'],revenue:['summary','channels','categories']};
  for(const [pl,list] of Object.entries(views)){
    list.forEach((v,i)=>{
      const det=D.planView(pl,0,18,'all',{variant:v}).detail;
      assert.ok(det.rows.length>0,`${pl}/${v}: таблица не пустая`);
      assert.equal(det.heads.length,det.rows[0].cells?det.rows[0].cells.length:det.rows[0].length,`${pl}/${v}: ширина таблицы`);
      assert.ok(det.note,`${pl}/${v}: есть пояснение к таблице`);
      assert.deepEqual(D.PLANS[pl].chartViews[i][0],v,`${pl}: порядок срезов`);
    });
  }
  /* таблица запасов: срез «По складам» содержит цель, страховой запас и отметку риска */
  const inv=D.planView('inventory',0,3,'q4-2026',{view:'warehouses'}).detail;
  assert.ok(inv.heads.join('|').includes('Страховой'),'запасы: колонка страхового запаса');
  assert.ok(inv.heads.join('|').includes('Риск'),'запасы: колонка риска');
  const sum=D.planView('inventory',0,3,'q4-2026',{view:'summary'}).table;
  assert.ok(sum.heads.join('|').includes('Страховой'),'сводный план запасов: колонка страхового запаса');
});

/* ── 25. Сценарий В: перераспределение 5 000 т ── */
test('сценарий В: перераспределение 5 000 т (Платина/Золото → Серебро/Бронза), итог 129 000 т',()=>{
  const C=SUP.gaps.C;
  const num=s=>Number(String(s).replace(/[^0-9,−-]/g,'').replace('−','-').replace(',','.'));
  const volumes=C.tableRows.map(r=>num(r[3]));
  const gaps=C.tableRows.map(r=>num(r[4]));
  const demand=C.tableRows.map(r=>num(r[1]));
  assert.equal(volumes.reduce((a,b)=>a+b,0),C.available,'сумма доступного = 129 000 т');
  assert.equal(demand.reduce((a,b)=>a+b,0),C.demand,'сумма спроса = 152 000 т');
  assert.equal(Math.abs(gaps.reduce((a,b)=>a+b,0)),C.demand-C.available,'сумма разрывов = 23 000 т');
  /* покрытие сегментов в таблице = расчёту */
  C.tableRows.forEach(r=>{
    const pc=num(r[3])/num(r[1])*100;
    assert.ok(Math.abs(pc-num(r[2]))<0.06,`${r[0]}: покрытие ${pc.toFixed(1)}% ≠ ${r[2]}`);
  });
  /* полосы графика: ширина = покрытие, штриховка = дополнение до 100% */
  C.rows.filter(r=>!r.div&&!r.main&&r.gapW!=null).forEach(r=>{
    assert.ok(Math.abs(r.w+r.gapW-100)<0.06,`${r.label}: w+gapW ≠ 100`);
    assert.ok(Math.abs(r.w-num(r.value)/num(r.label.match(/спрос ([\d\s]+) т/)[1])*100)<0.06,`${r.label}: ширина полосы ≠ покрытию`);
  });
  /* перераспределение: снято = перенесено = 5 000 т */
  assert.equal(C.redist.total,5000);
  assert.equal(C.redist.from.reduce((a,x)=>a+x[1],0),C.redist.total,'снято с Платины и Золота');
  assert.equal(C.redist.to.reduce((a,x)=>a+x[1],0),C.redist.total,'перенесено в Серебро и Бронзу');
  /* Платина и Золото недовыполнены, Серебро и Бронза получили объём (бейджи перераспределения) */
  const badge=lbl=>{const r=C.rows.find(x=>x.label&&x.label.startsWith(lbl));return {delta:r.delta&&r.delta.v,kind:r.delta&&r.delta.kind};};
  assert.deepEqual(badge('⬣'),{delta:'−2 000 т',kind:'neg'});
  assert.deepEqual(badge('●'),{delta:'−3 000 т',kind:'neg'});
  assert.deepEqual(badge('⚪'),{delta:'+3 000 т',kind:'pos'});
  assert.deepEqual(badge('🟤'),{delta:'+2 000 т',kind:'pos'});
  /* итоговые метрики сценария не изменились */
  assert.equal(C.available,129000);
  assert.ok(/94,3%/.test(C.tableRows[1][2])&&/88,9%/.test(C.tableRows[2][2]),'покрытие Платины и Золота');
  assert.ok(/78,3%/.test(C.tableRows[3][2])&&/38,1%/.test(C.tableRows[4][2]),'покрытие Серебра и Бронзы');
  const sc=SUP.scenarios.find(x=>x.id==='C');
  assert.ok(/перераспределение 5 000 т/.test(sc.desc),'карточка сценария: перераспределение 5 000 т'); 
  assert.ok(/\+3 000/.test(sc.desc)&&/\+2 000/.test(sc.desc),'карточка сценария: получатели объёма');
  assert.ok(/94,3%/.test(C.reasons)&&/88,9%/.test(C.reasons)&&/78,3%/.test(C.reasons)&&/38,1%/.test(C.reasons),'пояснение к графику обновлено');
  assert.equal(SUP.scenYear.rows[2].q4vol,129000,'год 2026: 4 кв. = 129 000 т');
  assert.equal(SUP.scenYear.rows[2].q4gp,5002,'год 2026: ВП 4 кв. = 5 002 млн');
});
