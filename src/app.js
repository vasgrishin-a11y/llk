/* ═══════════════ Дашборд In.Plan S&OP — компоновка экранов ═══════════════
   Тот же подход, что и в базовом шаблоне: config.js задаёт вкладки/KPI,
   data.js — загружаемое ядро данных (XLSX), datasets.js — отчётные демо-данные,
   charts.js — canvas-рендеринг. Состояние (вкладка) — в localStorage,
   локальные переключатели вкладок — в `ui` (в памяти), открытые таблицы — `open`. */
import {DASHBOARD_CONFIG as C} from './config.js';
import {MONTHLY,normalizeRows,summary} from './data.js';
import {OVERVIEW,SEGMENTS,DEMAND,DEMAND_KPIS,STOCK,SUPPLY,HEATMAP,PLANS,ACTIONS,M12_LABELS,MONTHS18,PLAN_PERIODS,planRange,planView,COST_TON} from './datasets.js';
import {drawChart} from './charts.js';
import {exportDashboard} from './export.js';
import {storage} from './storage.js';

let data=MONTHLY;
let tab=storage.get('tab','overview');
const ui={};               // локальные переключатели: год, вид покрытия, сценарий…
const open=new Set();      // id раскрытых блоков «📋 Данные»
let summ=summary(data);
let jobs=[];               // очередь canvas-отрисовок текущего рендера

const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const N=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const NF=(v,d=1)=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const rv=x=>typeof x==='function'?x(summ):x;
const shortM=p=>String(p).split(' ')[0];

/* ── HTML-хелперы (тот же паттерн, что у шаблона) ── */
const insight=t=>`<div class="insight">${t}</div>`;
const info=(kind,inner)=>`<div class="info info-${kind}">${inner}</div>`;
const J=(sel,type,series,labels,opts)=>jobs.push([sel,type,series,labels,opts]);
const canvas=(id,aria)=>`<canvas id="${id}" class="chart" role="img" aria-label="${esc(aria)}"></canvas>`;
const card=(title,inner,sub)=>`<article class="card"><h2>${title}</h2>${sub?`<div class="muted card-sub">${sub}</div>`:''}${inner}</article>`;
const tbl=(id,heads,rows)=>{
  const isOpen=open.has(id);
  return `<button class="toggle" data-toggle="${id}">${isOpen?'📋 Скрыть данные ▲':'📋 Данные ▼'}</button><div class="tbl-wrap${isOpen?' show':''}" id="${id}"><table class="dense"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{const o=Array.isArray(r)?{cells:r}:r;return `<tr${o.cls?` class="${o.cls}"`:''}>${o.cells.map(c=>`<td>${c}</td>`).join('')}</tr>`}).join('')}</tbody></table></div>`};
const sw=(group,items)=>{const cur=ui[group]??items[0][0];return `<div class="switch">${items.map(([v,l])=>`<button class="${cur===v?'active':''}" data-sw="${group}" data-val="${v}">${l}</button>`).join('')}</div>`};
const kpiCard=k=>{const dev=rv(k.dev),foot=rv(k.foot);return `<article class="kpi"${k.tip?` aria-label="${esc(k.tip)}"`:''}>${k.tip?`<div class="tooltip">${esc(k.tip)}</div>`:''}<div class="muted kpi-label">${rv(k.label)}${k.tip?` <span class="infodot" data-info="${esc(k.tip)}">i</span>`:''}</div><div class="value ${k.color||''}">${rv(k.value)}</div><div class="kpi-sub">${rv(k.sub)}</div>${foot?`<div class="kpi-foot">${foot}</div>`:''}${dev?`<div class="dev dev-${dev.kind||'neu'}">${dev.text}</div>`:''}</article>`};
const kpis=tid=>(C.kpis[tid]||[]).length?`<section class="kpis">${C.kpis[tid].map(kpiCard).join('')}</section>`:'';

/* ═══════════════ Обзор ═══════════════ */
function perfRows(m){
  const rr=(r,cls)=>({cells:[r.period,r.type,N(r.planVol),N(r.vol),N(r.planVol?r.vol/r.planVol*100:0,0)+'%',NF(r.planRev),NF(r.rev),N(r.planRev?r.rev/r.planRev*100:0,0)+'%',N(r.price)],cls});
  const tot=(list,label,type)=>{const pv=list.reduce((a,x)=>a+x.planVol,0),v=list.reduce((a,x)=>a+x.vol,0),pr=list.reduce((a,x)=>a+x.planRev,0),rv2=list.reduce((a,x)=>a+x.rev,0);
    return {cells:[label,type,N(pv),N(v),N(pv?v/pv*100:0,0)+'%',NF(pr),NF(rv2),N(pr?rv2/pr*100:0,0)+'%',N(v?rv2/v*1_000_000:0)],cls:'row-sum'};};
  const f=m.filter(r=>r.type!=='Прогноз'),fc=m.filter(r=>r.type==='Прогноз');
  const rows=m.map(r=>rr(r,r.type==='Прогноз'?'row-fc':''));
  if(f.length>1)rows.splice(f.length,0,tot(f,f[0].period+'–'+f.at(-1).period,'Факт'));
  if(fc.length)rows.push(tot(fc,fc.length>1?fc[0].period+'–'+fc.at(-1).period:fc[0].period,'Прогноз'));
  const all=tot(m,'Итого','План/Факт');all.cls='row-total';all.cells[0]='Год итого';rows.push(all);
  return rows;
}
/* дополнительные строки-ориентиры под таблицей «Обзор · 2026» */
const OV_EXTRA_ROWS=[
  {cells:['<b>Требуется в 4 кв. для годового плана</b>','Цель','131 000','<b>156 000</b>','119%','18 864,0','<b>23 439,0</b>','124%','150 250'],cls:'row-sum'},
  {cells:['<b>4 кв. — S&OP предыдущего цикла</b>','Пред. цикл','131 000','127 500','97%','18 864,0','17 977,5','95%','141 000'],cls:'row-fc'},
  {cells:['<b>Отставание пред. цикла до цели</b>','Разрыв','—','<b>−28 500</b>','—','—','<b>−5 461,5</b>','—','—'],cls:'row-total'},
  {cells:['<b>4 кв. — новый S&OP (сценарий В)</b>','Новый цикл','131 000','<b>129 000</b>','98%','18 864,0','<b>18 255,0</b>','97%','141 512'],cls:'row-sum'},
];
function vOverview(){
  if(ui.ovp==null)ui.ovp='2026';
  const m=data,p=ui.ovp;
  const perfH=['Месяц','Тип','План объема (т)','Факт/Прогноз объема (т)','Выполнение %','План выручки (млн руб.)','Факт/Прогноз выручки (млн руб.)','Выполнение %','Средняя цена (руб/т)'];
  let ins='';
  if(p==='2026'){
    const labels=m.map(r=>shortM(r.period));
    const volColors=m.map(r=>r.type==='Прогноз'?'#90CAF9':'#20A7C9');
    const NQ=OVERVIEW.q4Need;
    J('#c-ovperf','combo',[
      {data:m.map(r=>r.planVol),kind:'bar',color:'#e3e7ec'},
      {data:m.map(r=>r.vol),kind:'bar',color:'#20A7C9',pointColors:volColors},
      {data:NQ.vol,kind:'bar',color:'#D93025'},
      {data:m.map(r=>r.planRev),kind:'line',axis:1,color:'#9aa6b6',dash:true},
      {data:m.map(r=>r.rev),kind:'line',axis:1,color:'#20A7C9'},
      {data:NQ.rev,kind:'line',axis:1,color:'#D93025',dash:true},
    ],labels,{height:380,legend:['План объёма, бизнес-план (т)','Факт янв–сен / прогноз окт–дек (т)','Требуется в 4 кв. для годового плана (т)','План выручки (млн руб.)','Факт янв–сен / прогноз окт–дек (млн руб.)','Требуется выручки в 4 кв. (млн руб.)'],yTitle:'Объём (т)',y1Title:'Выручка (млн руб.)'});
    ins=OVERVIEW.insight2026;
  }else if(p==='2025'){
    const d=OVERVIEW.perf2025;
    J('#c-ovperf','combo',[
      {data:d.planVol,kind:'bar',color:'#e3e7ec'},
      {data:d.vol,kind:'bar',color:'#20A7C9'},
      {data:d.planRev,kind:'line',axis:1,color:'#9aa6b6',dash:true},
      {data:d.rev,kind:'line',axis:1,color:'#4CAF50'},
    ],M12_LABELS,{height:340,legend:['План объёма 2025 (т)','Факт объёма 2025 (т)','План выручки 2025 (млн руб.)','Факт выручки 2025 (млн руб.)'],yTitle:'Объём (т)',y1Title:'Выручка (млн руб.)'});
    ins=OVERVIEW.insight2025;
  }else{
    const d=OVERVIEW.perf2027;
    J('#c-ovperf','combo',[
      {data:d.planVol,kind:'bar',color:'#e3e7ec'},
      {data:d.vol,kind:'bar',color:'#90CAF9'},
      {data:d.planRev,kind:'line',axis:1,color:'#9aa6b6',dash:true},
      {data:d.rev,kind:'line',axis:1,color:'#4CAF50'},
    ],M12_LABELS,{height:340,legend:['План объёма 2027 (т)','Прогноз объёма 2027 (т)','План выручки 2027 (млн руб.)','Прогноз выручки 2027 (млн руб.)'],yTitle:'Объём (т)',y1Title:'Выручка (млн руб.)'});
    ins=OVERVIEW.insight2027;
  }
  const V=OVERVIEW.volYoy,R=OVERVIEW.revYoy,A=OVERVIEW.accuracy;
  J('#c-ovyoy','combo',[
    {data:V.y2025,kind:'bar',color:'#e8ecef'},
    {data:V.y2026,kind:'bar',color:'#20A7C9'},
    {data:V.plan,kind:'line',color:'#D93025',dash:true},
  ],V.labels,{height:280,legend:['Объем 2025 (т)','Объем 2026 (т)','План 2026 (т)']});
  J('#c-ovrev','combo',[
    {data:R.y2025,kind:'bar',color:'#e8ecef'},
    {data:R.y2026,kind:'bar',color:'#FF9800'},
    {data:R.m2025,kind:'line',axis:1,color:'#4CAF50'},
    {data:R.m2026,kind:'line',axis:1,color:'#D93025'},
  ],R.labels,{height:280,legend:['Выручка 2025 (млн)','Выручка 2026 (млн)','Маржа 2025 %','Маржа 2026 %'],y1Title:'Маржа %',min1:22.4,max1:23.6});
  J('#c-ovacc','line',[
    {data:A.acc,color:'#D93025',fill:true},
    {data:Array(A.labels.length).fill(A.target),color:'#4CAF50',dash:true},
  ],A.labels,{height:280,legend:['WAPE, факт (%)','Цель WAPE ≤10%'],max:20,yTitle:'WAPE, %'});
  const ovKpiList=p==='2025'?OVERVIEW.kpis2025:p==='2027'?OVERVIEW.kpis2027:(C.kpis.overview||[]);
  return `<section class="kpis">${ovKpiList.map(kpiCard).join('')}</section>`
    +card('📈 Объём и выручка: факт и план',sw('ovp',[['2025','2025 год'],['2026','2026 год'],['2027','2027 год']])+canvas('c-ovperf','Столбчато-линейный график объёма и выручки: план, факт, прогноз')+insight(ins)+(p==='2026'?tbl('tbl-ov-perf',perfH,[...perfRows(m),...OV_EXTRA_ROWS]):''))
    +`<div class="grid">`
    +card('📊 Объем: сравнение с прошлым годом',canvas('c-ovyoy','Столбчатая диаграмма: объем 2025 и 2026 по кварталам')+insight(V.insight)+tbl('tbl-vol-yoy',V.heads,V.rows))
    +card('💰 Выручка и маржа: сравнение с прошлым годом',canvas('c-ovrev','Столбчато-линейный график: выручка и маржа по кварталам')+insight(R.insight)+tbl('tbl-rev-yoy',R.heads,R.rows))
    +`</div>`
    +card('🎯 Точность прогноза по кварталам (WAPE, ниже — лучше)',canvas('c-ovacc','Линейный график ошибки прогноза WAPE по кварталам')+insight(A.insight)+tbl('tbl-acc',A.heads,A.rows))
    /* Ключевые отклонения — сворачиваемый блок (как «Данные»): по умолчанию скрыт */
    +card('⚠️ Ключевые отклонения',`<button class="toggle" data-toggle="ov-deviations" data-open="⚠️ Скрыть отклонения ▲" data-closed="⚠️ Показать отклонения ▼">${open.has('ov-deviations')?'⚠️ Скрыть отклонения ▲':'⚠️ Показать отклонения ▼'}</button>`
      +`<div class="tbl-wrap dev-wrap${open.has('ov-deviations')?' show':''}" id="ov-deviations">${OVERVIEW.deviations.map(([k,t,d])=>info(k,`<b>${t}</b><br>${d}`)).join('')}</div>`);
}

/* ═══════════════ 1. Сегментация ═══════════════
   Матрица «маржа × ценность»: 5 уровней (Бриллиант → Бронза) диагональными
   полосами; размер круга = валовая прибыль клиента; фильтры — по каналу
   продаж и по «выбивающимся» клиентам (на пересмотр). */
function segMatrixHTML(){
  const off=ui.segOff||new Set();
  const chan=ui.segchan??'all',rev=ui.segrev??'0';
  const CL=SEGMENTS.clients;
  const on=d=>!off.has(d.seg)&&(chan==='all'||d.channel===chan)&&(rev==='0'||d.review);
  /* Масштаб круга — от мин. до макс. ВП по всем 22 клиентам (не от нуля), иначе клиенты
     внутри одного сегмента (близкие по ВП) визуально почти не отличаются. Область круга
     пропорциональна ВП внутри этого диапазона (sqrt), диапазон диаметра — 34–134px,
     что даёт разницу площади ~15× между самым маленьким и самым крупным клиентом. */
  const gpVals=CL.map(c=>c.gp),minGp=Math.min(...gpVals),maxGp=Math.max(...gpVals);
  const R_MIN=34,R_MAX=134;
  const size=gp=>Math.round(R_MIN+Math.sqrt((gp-minGp)/(maxGp-minGp))*(R_MAX-R_MIN));
  const shortName=n=>n.length>16?n.split(' ')[0].slice(0,15):n;
  const bands=SEGMENTS.levels.map(L=>{
    const all=CL.filter(c=>c.seg===L.id);
    const revSum=all.reduce((a,c)=>a+c.rev,0),gpSum=all.reduce((a,c)=>a+c.gp,0);
    const list=all.slice().sort((a,b)=>b.gp-a.gp);
    const dots=list.map(d=>{
      const r=size(d.gp),isOn=on(d);
      const revTxt=d.review?(d.revDir==='down'?' · ⚑ на пересмотр ↓ (кандидат на понижение)':' · ⚑ на пересмотр ↑ (кандидат на повышение)'):'';
      const tip=`<b>${esc(d.name)}</b>${d.review?(d.revDir==='down'?' ⚑↓':' ⚑↑'):''}<br><span class="r">${esc(L.label)} · ${esc(d.channel)}${revTxt}</span><br>`
        +`Выручка: ${NF(d.rev,0)} млн руб/год<br>Валовая прибыль: <b>${NF(d.gp,1)} млн руб.</b> (${NF(d.marginPct,0)}%)<br>`
        +`Себестоимость: ${NF(d.cost,0)} млн руб.<br>Сервис: ${d.sFact}% (цель ${d.sTarget}%)`;
      const showVal=r>=44;
      return `<div class="sm-dot${isOn?'':' dim'}${d.review?(d.revDir==='down'?' sm-rev-down':' sm-rev-up'):''}" data-smtip="${esc(tip)}" style="width:${r}px;height:${r}px;background:${L.color}">`
        +`<span class="sm-dot-n" style="font-size:${r>100?11:r>75?10:r>55?9:8}px">${esc(shortName(d.name))}</span>`
        +(showVal?`<span class="sm-dot-v" style="font-size:${r>100?10:r>75?9:8}px">${NF(d.gp,0)}</span>`:'')+`</div>`;
    }).join('');
    return `<div class="sm-band${off.has(L.id)?' sm-band-off':''}" style="--sc:${L.color}">`
      +`<div class="sm-band-head"><span class="sm-band-chip"></span><div class="sm-band-t">${esc(L.label)}`
      +`<span class="sm-band-meta">${all.length} клиентов · ${NF(revSum,0)} млн руб. · ВП ${NF(gpSum,0)} млн руб.</span></div></div>`
      +`<div class="sm-band-plot">${off.has(L.id)?'<span class="sm-band-hidden">сегмент скрыт</span>':dots}</div></div>`;
  }).join('');
  const legend=SEGMENTS.levels.map(s=>`<button data-segtoggle="${s.id}" class="${off.has(s.id)?'off':''}"><i style="background:${s.color}"></i>${s.label} (${CL.filter(c=>c.seg===s.id).length})</button>`).join('')
    /* одна иконка «на пересмотр»: круг с красно-зелёным кольцом, прозрачный внутри —
       красная половина = кандидат на понижение, зелёная = кандидат на повышение */
    +`<span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600">`
    +`<svg width="15" height="15" viewBox="0 0 16 16" style="flex-shrink:0" aria-hidden="true">`
    +`<circle cx="8" cy="8" r="5.6" fill="none" stroke="#d6455b" stroke-width="3.2" stroke-dasharray="17.6 17.6" transform="rotate(-90 8 8)"/>`
    +`<circle cx="8" cy="8" r="5.6" fill="none" stroke="#137333" stroke-width="3.2" stroke-dasharray="17.6 17.6" stroke-dashoffset="-17.6" transform="rotate(-90 8 8)"/></svg>`
    +`⚑ На пересмотр (${CL.filter(c=>c.review).length})</span>`
    +`<span class="muted" style="font-size:11px">Размер круга — валовая прибыль клиента, млн руб. Кольцо — «на пересмотр»: красное — кандидат на понижение, зелёное — на повышение. Клик по легенде скрывает сегмент</span>`;
  return `<div id="seg-host"><div class="segbands">${bands}</div><div class="sm-legend">${legend}</div></div>`;
}
function vSegments(){
  const S=SEGMENTS;
  const rvm=ui.revmode??'year',RD=S.revDonut[rvm==='ytd'?'ytd':'year'];
  J('#c-segrev','donut',[RD.data],S.revDonut.labels,{height:340,colors:['#0082a9','#7c3aed','#20A7C9','#d6455b','#e8930c','#4CAF50','#00897b','#b0b8c4'],center:RD.center,centerSub:RD.centerSub});
  J('#c-segcost','stacked',S.costStack.series.map(([n,d,c])=>({data:d,color:c})),S.costStack.labels,{height:300,legend:S.costStack.series.map(x=>x[0])});
  return kpis('segments')
    +card('📊 Сегментация клиентов','Портфель 2026 разделён на 5 сегментов ценности. Размер круга — валовая прибыль клиента, млн руб. Наведите на круг — детали клиента.'
      +`<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;margin:6px 0 4px"><div><div class="muted" style="font-size:11px;margin-bottom:4px">Канал продаж</div>${sw('segchan',[['all','Все каналы'],...SEGMENTS.channels.map(c=>[c,SEGMENTS.chShort[c]])])}</div><div><div class="muted" style="font-size:11px;margin-bottom:4px">Выбивающиеся</div>${sw('segrev',[['0','Все клиенты'],['1','⚑ Только «на пересмотр»']])}</div></div>`
      +segMatrixHTML()+insight(S.bubbleInsight)+tbl('tbl-seg',S.matrix.th,S.matrix.row))
    +`<div class="grid">`
    +card('🥧 Распределение выручки по каналам продаж',sw('revmode',[['year','Год 2026 (факт 9 мес. + прогноз)'],['ytd','Факт янв–сен 2026']])
      +canvas('c-segrev','Кольцевая диаграмма распределения выручки по каналам продаж')
      +insight(RD.insight)+tbl('tbl-rev',S.revDonut.heads,RD.rows))
    +card('📊 Структура затрат по каналам продаж',canvas('c-segcost','Стековая диаграмма структуры затрат по каналам продаж')+insight(S.costStack.insight)+tbl('tbl-cost',S.costStack.heads,S.costStack.rows))
    +`</div>`;
}


/* ═══════════════ 2. Спрос ═══════════════ */
/* Тепловая карта WAPE: строки — все категории продуктов, колонки — горизонты прогноза.
   Цвет ячейки — уровень ошибки: чем темнее красный, тем хуже прогнозируемость. */
const wapeClass=v=>v<=10?'wp-ok':v<=15?'wp-good':v<=20?'wp-mid':v<=30?'wp-bad':'wp-worst';
function wapeHeatmapHTML(AC){
  const totVol=AC.rows.reduce((a,r)=>a+r.vol,0);
  const wAvg=k=>AC.rows.reduce((a,r)=>a+r.w[k]*r.vol,0)/totVol;
  const cell=(v,extra='')=>`<td class="wp ${wapeClass(v)}"${extra}>${NF(v,1)}%</td>`;
  let h=`<div class="hm-scroll"><table class="hm wape"><thead><tr><th class="row-header">Категория продукта</th>`
    +AC.horizons.map(x=>`<th>WAPE<br>${x}</th>`).join('')
    +`<th>Объём<br>т/мес</th><th>Смещение<br>%</th><th class="wp-mode">Режим планирования</th></tr></thead><tbody>`;
  AC.rows.forEach(r=>{
    h+=`<tr><td class="row-header">${esc(r.name)}</td>`
      +r.w.map(v=>cell(v,` data-info="${esc(r.name+' · WAPE '+NF(v,1)+'% · цель ≤10%')}"`)).join('')
      +`<td class="wp-num">${N(r.vol)}</td><td class="wp-num">${r.bias}</td><td class="wp-mode">${esc(r.mode)}</td></tr>`;
  });
  h+=`<tr class="row-sum"><td class="row-header">📊 Взвешенно по объёму</td>`
    +AC.horizons.map((_,k)=>cell(+wAvg(k).toFixed(1))).join('')
    +`<td class="wp-num">${N(totVol)}</td><td class="wp-num">—</td><td class="wp-mode">Цель WAPE ≤10%</td></tr>`;
  return h+`</tbody></table></div>`;
}
function vDemand(){
  if(ui.dmp==null)ui.dmp='2026';
  const D=DEMAND,p=ui.dmp;
  let dins='';
  if(p==='2026'){
    const facts=MONTHLY.filter(r=>r.type==='Факт'),unc=D.uncQ4;
    const vol=[...facts.map(r=>r.vol),...unc],rev=[...facts.map(r=>r.rev),...unc.map(v=>v*141500/1_000_000)];
    const pc=[...facts.map(()=>'#20A7C9'),...unc.map(()=>'#90CAF9')];
    J('#c-demand','combo',[
      {data:MONTHLY.map(r=>r.planVol),kind:'bar',color:'#e3e7ec'},
      {data:vol,kind:'bar',pointColors:pc,color:'#20A7C9'},
      {data:MONTHLY.map(r=>r.planRev),kind:'line',axis:1,color:'#9aa6b6',dash:true},
      {data:rev,kind:'line',axis:1,color:'#D93025'},
    ],M12_LABELS,{height:340,legend:['План объёма (т)','Факт / неогр. спрос (т)','План выручки (млн руб.)','Факт/прогноз выручки (млн руб.)'],yTitle:'Объём (т)',y1Title:'Выручка (млн руб.)'});
    dins=D.insight2026;
  }else if(p==='2025'){
    const d=D.demand2025;
    J('#c-demand','combo',[
      {data:d.planVol,kind:'bar',color:'#e3e7ec'},
      {data:d.demand,kind:'bar',color:'#20A7C9'},
      {data:d.planRev,kind:'line',axis:1,color:'#9aa6b6',dash:true},
      {data:d.rev,kind:'line',axis:1,color:'#4CAF50'},
    ],M12_LABELS,{height:340,legend:['План объёма 2025 (т)','Факт объёма 2025 (т)','План выручки 2025 (млн руб.)','Факт выручки 2025 (млн руб.)'],yTitle:'Объём (т)',y1Title:'Выручка (млн руб.)'});
    dins=D.insight2025;
  }else{
    const d=D.demand2027;
    J('#c-demand','combo',[
      {data:d.planVol,kind:'bar',color:'#e3e7ec'},
      {data:d.demand,kind:'bar',color:'#90CAF9'},
      {data:d.planRev,kind:'line',axis:1,color:'#8c9bae',dash:true},
      {data:d.rev,kind:'line',axis:1,color:'#4CAF50'},
    ],M12_LABELS,{height:340,legend:['План объёма 2027 (т)','Неогр. спрос 2027 (т)','План выручки 2027 (млн руб.)','Прогноз выручки 2027 (млн руб.)'],yTitle:'Объём (т)',y1Title:'Выручка (млн руб.)'});
    dins=D.insight2027;
  }
  const W=D.waterfall,AC=D.accCat,B=D.bias,F=D.fva,SE=D.seasonal;
  J('#c-wf','waterfall',[{data:W.values,color:'#20A7C9'}],W.labels,{height:330,yTitle:'Объём, т',wfUpColor:'#FF9800',wfTotalColor:'#4CAF50'});
  J('#c-bias','hbar',[{data:B.data,pointColors:B.colors,color:'#20A7C9'}],B.labels,{height:280});
  /* Масштаб оси Y — НЕ от нуля: данные лежат в диапазоне 35,5–49,6 тыс. т,
     при оси от 0 линии сжаты в верхней трети и разница не читается. */
  const fvaAll=[...F.stat,...F.corr,...F.fact].filter(v=>v!=null);
  const fvaMin=Math.floor((Math.min(...fvaAll)-1500)/500)*500;
  const fvaMax=Math.ceil((Math.max(...fvaAll)+900)/500)*500;
  J('#c-fva','line',[
    {data:F.stat,color:'#20A7C9'},
    {data:F.corr,color:'#FF9800'},
    {data:F.fact,color:'#8c9bae',dash:true},
  ],F.labels,{height:300,min:fvaMin,max:fvaMax,yTitle:'Объём, т',legend:['Статистический прогноз','Корректировка продаж','Факт']});
  J('#c-seas','area',[
    {data:SE.base,color:'#20A7C9'},
    {data:SE.promo,color:'#FF9800'},
  ],SE.labels,{height:340,legend:['Базовый спрос (т)','Промо-прирост (т)'],yTitle:'Спрос, т'});
  D.models.forEach((m,i)=>J('#c-mini'+i,'line',[
    {data:m.fact,color:'#1a2b4a'},
    {data:m.fc,color:'#4CAF50',fill:true},
  ],['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен'],{height:96,compact:true,legend:['Факт',m.fcName]}));
  const modelCards=D.models.map((m,i)=>`<article class="model champ"><h5>${m.name} <span class="badge">ЛУЧШАЯ</span></h5><canvas id="c-mini${i}" class="chart" role="img" aria-label="Мини-график: факт и прогноз модели ${esc(m.model)}"></canvas><div class="stat"><b>Модель:</b> ${m.model}</div><div class="stat"><b>Ошибка прогноза:</b> ${m.acc}</div><div class="stat"><b>Систематическая ошибка:</b> ${m.bias}</div><div class="stat"><b>Почему:</b> ${m.why}</div><div class="stat dim">${m.others}</div></article>`).join('')
    +`<article class="model"><h5>📊 Сводка по моделям</h5><div class="info">${D.modelsSummary.map(([k,v])=>`<div class="stat"><b>${k}</b> ${v}</div>`).join('')}</div><div class="info info-success">${D.modelsDecision}</div></article>`;
  /* KPI-карточки спроса — динамические: пересчитываются для выбранного года */
  const dk=`<section class="kpis">${(DEMAND_KPIS['y'+p]||DEMAND_KPIS.y2026).map(k=>`<article class="kpi"><div class="muted kpi-label">${k.label}</div><div class="value">${k.value}</div><div class="kpi-sub">${k.sub}</div>${k.dev?`<div class="dev dev-${k.dev.kind||'neu'}">${k.dev.text}</div>`:''}</article>`).join('')}</section>`;
  return dk
    +card('📈 Спрос против годового бизнес-плана',sw('dmp',[['2025','2025 год'],['2026','2026 год'],['2027','2027 год']])+canvas('c-demand','Столбчато-линейный график спроса против плана')+insight(dins)+(p==='2026'?tbl('tbl-demand-period',D.periodTable.heads,D.periodTable.rows):''))
    +`<div class="grid">`
    +card('📉 Формирование согласованного прогноза (4 кв. 2026)',canvas('c-wf','Водопад: формирование согласованного прогноза')
      +'<div class="muted" style="font-size:11px;margin-top:6px">Каждый прирост отсчитывается от накопленного уровня предыдущего шага; под столбцом приростa — накопленный итог.</div>'
      +insight(W.insight)+tbl('tbl-wf',W.heads,W.rows))
    +card('🌡️ Точность прогноза по категориям — тепловая карта WAPE',wapeHeatmapHTML(AC)+`<div class="hm-legend">${AC.legend}</div>`+insight(AC.insight)+tbl('tbl-acc2',AC.heads,AC.rows.map(r=>[r.name,NF(r.w[0]),NF(r.w[1]),NF(r.w[2]),NF(r.w[3]),r.bias,N(r.vol),r.mode])))
    +`</div><div class="grid">`
    +card('📉 Систематическая ошибка по каналам',canvas('c-bias','Горизонтальная диаграмма систематической ошибки по каналам')+insight(B.insight)+tbl('tbl-bias',B.heads,B.rows))
    +card('🔍 Статистический прогноз vs корректировка продаж vs факт',canvas('c-fva','Линейный график: статистика, корректировки и факт')
      +`<div class="muted" style="font-size:11px;margin-top:6px">Ось объёма — не от нуля (от ${N(fvaMin)} до ${N(fvaMax)} т): масштаб выбран так, чтобы расхождения статистического прогноза, корректировок продаж и факта были видны явно.</div>`
      +insight(F.insight)+tbl('tbl-fva',F.heads,F.rows))
    +`</div>`
    +card('📊 Базовый спрос и промо-прирост по сезонам',canvas('c-seas','Стековая областная диаграмма сезонного спроса')+insight(SE.insight)+tbl('tbl-seas',SE.heads,SE.rows))
    +card('🤖 Выбор математической модели прогнозирования по сегментам',`<div class="muted" style="margin-bottom:10px">${D.modelsIntro}</div><div class="grid-3">${modelCards}</div>`+tbl('tbl-models',D.modelsTable.heads,D.modelsTable.rows));
}

/* ═══════════════ 3. Запасы ═══════════════ */
function vStock(){
  const S=STOCK,v=ui.invview??'channels',dm=ui.deadmode??'tons',im=ui.invmode??'tons',hv=ui.invhistview??'stocks';
  const covKey=v==='channels'?'channels':v==='products'?'products':'echelons';
  const CV=S.coverage[covKey];
  /* страховой запас — заливкой под линией; таблица синхронизирована с переключателем.
     Столбцы ниже страхового уровня подсвечиваются красным (алерт). */
  const covAlerts=CV.rows.filter(r=>r.days<r.safety);
  const isEchelon=v==='echelons';
  const threePlColor='#7C3AED';
  const coverageLegend=isEchelon
    ?['Страховой запас, дней (заливка)','Заводы — факт','Целевой запас, дней']
    :['Страховой запас, дней (заливка)','Дней покрытия, факт','Целевой запас, дней'];
  const coverageLegendExtra=[
    ...(isEchelon?[{t:'3PL — факт',color:threePlColor}]:[]),
    ...(covAlerts.length?[{t:'Ниже страхового уровня (алерт)',color:'#D93025'}]:[]),
  ];
  J('#c-cover','combo',[
    {data:CV.safety,kind:'line',color:'#b39ddb',fill:'#b39ddb',dash:true},
    {data:CV.days,kind:'bar',color:'#20A7C9',pointColors:CV.days.map((d,i)=>{
      if(d<CV.safety[i])return '#D93025';
      return isEchelon&&/^3PL\b/.test(CV.labels[i])?threePlColor:'#20A7C9';
    })},
    {data:CV.target,kind:'line',color:'#4CAF50',dash:true},
  ],CV.labels,{height:340,legend:coverageLegend,yTitle:'Дней покрытия',
    legendExtra:coverageLegendExtra.length?coverageLegendExtra:null});
  const covAlertHtml=covAlerts.length
    ?info('danger','<b>🔴 Алерт: ниже страхового запаса — '+covAlerts.length+' '+(['позиция','позиции','позиций'])[covAlerts.length===1?0:covAlerts.length<5?1:2]+'</b><br>'
      +covAlerts.map(r=>`<b>${esc(r.name)}</b> — ${r.days} дн. при страховом ${r.safety} (−${r.safety-r.days} дн.)`).join(' · ')
      +'. Зимний всплеск спроса ускорил оборачиваемость: требуется срочное пополнение и переброска объёма с заводских складов.')
    :'';
  const covRows=v==='channels'?S.coverage.channelsRows:v==='products'?S.coverage.productsRows:S.coverage.echelonsRows;
  const IH=S.invHistory;
  const retroFill=[
    {upper:2,lower:1,color:'#FF9800',alpha:.20},
    {upper:0,lower:2,color:'#D93025',alpha:.24},
  ];
  const retroLegendExtra=[
    {t:'Выше целевого запаса (перетовар)',color:'rgba(255,152,0,.40)'},
    {t:'Ниже страхового запаса (пробой)',color:'rgba(217,48,37,.42)'},
  ];
  /* Режим «Точность прогноза» — минималистично, без «светофора» по столбцам:
     все столбцы одного цвета, отклонения показаны бейджами ⚠ (недопоставка/перетовар),
     а линии страхового и целевого уровня есть в легенде, но выключены по умолчанию. */
  const histRisk=IH.labels.map((_,i)=>IH.actual[i]<IH.safety[i]?{type:'under',pct:IH.pct[i]}
    :IH.actual[i]>IH.target[i]*1.05?{type:'over',pct:IH.pct[i]}:null);
  /* Интерактивный тултип для всех режимов карточки: Δ к цели, статус и остановы */
  const histTip=i=>{
    if(i==null||i<0||i>=IH.labels.length)return '';
    const a=IH.actual[i],saf=IH.safety[i],tgt=IH.target[i];
    const dev=(IH.pct[i]>=0?'+':'−')+Math.abs(IH.pct[i])+'%';
    const st=a<saf?'<b style="color:#FF8A80">недопоставка — ниже страхового уровня</b>'
      :a>tgt*1.05?'<b style="color:#FFB74D">перетовар — выше целевого уровня</b>':'в целевом коридоре';
    const stop=(IH.stops||[]).find(x=>x.i===i);
    return '<div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.2)">Δ к цели: <b>'+dev+'</b> · '+st
      +(stop?'<br>⛔ '+esc(stop.label.replace('Останов: ','')):'')+'</div>';
  };
  if(hv==='wape'){
    const WAPE_TGT=IH.labels.map(()=>10);
    J('#c-invplan','combo',[
      {data:im==='tons'?IH.actual:IH.cost,kind:'bar',color:'#20A7C9',risks:histRisk},
      {data:im==='tons'?IH.safety:IH.costSafety,kind:'line',color:'#8c9bae',dash:true,hidden:true},
      {data:im==='tons'?IH.target:IH.costTarget,kind:'line',color:'#4CAF50',dash:true,hidden:true},
      {data:IH.wape,kind:'line',color:'#7c3aed',axis:1},
      {data:WAPE_TGT,kind:'line',color:'#1a2b4a',axis:1,dash:true},
    ],IH.labels,{height:340,
      legend:im==='tons'
        ?['Фактический запас, т','Страховой уровень запасов','Целевой уровень запасов','WAPE прогноза спроса %','Цель WAPE ≤10%']
        :['Стоимость запаса, млн руб.','Страховой уровень запасов','Целевой уровень запасов','WAPE прогноза спроса %','Цель WAPE ≤10%'],
      yTitle:im==='tons'?'т':'млн руб.',y1Title:'WAPE %',marks:IH.stops,tipExtra:histTip,
      legendExtra:[{t:'⚠ Недопоставка — ниже страхового уровня',color:'#D93025'},{t:'⚠ Перетовар — выше целевого уровня',color:'#E8930C'}]});
  }else if(im==='tons'){
    J('#c-invplan','line',[
      {data:IH.safety,color:'#8c9bae',dash:true},
      {data:IH.target,color:'#4CAF50',dash:true},
      {data:IH.actual,color:'#20A7C9'},
    ],IH.labels,{height:340,legend:IH.legend,yTitle:'т',marks:IH.stops,tipExtra:histTip,
      fillBetween:retroFill,legendExtra:retroLegendExtra});
  }else{
    J('#c-invplan','line',[
      {data:IH.costSafety,color:'#8c9bae',dash:true},
      {data:IH.costTarget,color:'#4CAF50',dash:true},
      {data:IH.cost,color:'#20A7C9'},
    ],IH.labels,{height:340,legend:IH.legendMoney,yTitle:'млн руб.',marks:IH.stops,tipExtra:histTip,
      fillBetween:retroFill,legendExtra:retroLegendExtra});
  }
  const DD=S.dead[dm];
  J('#c-dead','hbar',DD.series.map(([n,d,c])=>({data:d,color:c})),DD.labels,{height:300,legend:DD.series.map(x=>x[0])});
  const AX=S.abcxyz;
  J('#c-abc','scatter',AX.scatter.map(s=>({data:s.points,color:s.color,r:7})),[],{height:340,legend:AX.scatter.map(s=>s.name),xTitle:'Вариативность спроса (XYZ)',yTitle:'Доля маржи (ABC)'});
  J('#c-mto','donut',[S.mtomts.data],S.mtomts.labels,{height:340,colors:S.mtomts.colors});
  const statCard=x=>`<article class="kpi bt-${x.cls}"><div class="muted kpi-label">${x.name}</div><div class="value ${x.cls}">${x.days}</div><div class="kpi-sub">${x.target}</div><div class="dev dev-${x.cls==='green'?'pos':x.cls==='red'?'neg':'neu'}">${x.delta}</div><div class="kpi-foot ${x.cls}">${x.effect}</div></article>`;
  return kpis('stock')
    +card('📦 Покрытие запасов',sw('invview',[['channels','По каналам сбыта'],['products','По категориям продуктов'],['echelons','По эшелонам']])+canvas('c-cover','Диаграмма покрытия запасов в днях; красные столбцы — ниже страхового уровня')+covAlertHtml+insight(CV.insight||CV.insightShort)+tbl('tbl-inv-coverage',S.coverage.heads,covRows))
    +card('🔴 Неликвиды',sw('deadmode',[['tons','В тоннах'],['money','В деньгах']])+canvas('c-dead','Столбчатая диаграмма неликвидов')+insight(S.dead.insight)+info('success',S.dead.effect)+tbl('tbl-dead',S.dead.heads,S.dead.rows),S.dead.methodology)
    +card('📈 Анализ запасов за прошедшие 18 месяцев (Апр 2025 – Сен 2026)',(IH.stops?`<div class="muted" style="font-size:11px;margin-bottom:4px">⛔ Вертикальные отметки на графике — прошедшие остановы и ремонты: ${IH.stops.map(x=>esc(x.label.replace('Останов: ','')) ).join(' · ')}</div>`:'')+sw('invhistview',[['stocks','Запасы'],['wape','⚡ Точность прогноза']])+sw('invmode',[['tons','Тонны'],['money','Стоимость, млн руб.']])+canvas('c-invplan','Анализ запасов за прошедшие 18 месяцев: падения ниже страхового запаса и превышение целевого коридора')+insight(hv==='wape'?IH.insightWape:im==='tons'?IH.insightTons:IH.insightMoney)+tbl('tbl-inv-plan',hv==='wape'?IH.headsW:im==='tons'?IH.heads:IH.headsM,hv==='wape'?IH.rowsW:im==='tons'?IH.rows:IH.rowsM))
    +card('🏭 Сырье: состояние запасов',`<div class="grid-3">${S.rawm.map(statCard).join('')}</div>`+tbl('tbl-rm',S.rawmTable.heads,S.rawmTable.rows))
    +card('📦 Готовая продукция: состояние запасов',`<div class="grid-3">${S.fgm.map(statCard).join('')}</div>`+tbl('tbl-fg',S.fgTable.heads,S.fgTable.rows))
    +`<div class="grid">`
    +card('📊 Матрица ABC-XYZ (ABC по марже, XYZ по вариативности спроса)',canvas('c-abc','Точечная диаграмма матрицы ABC-XYZ')+insight(AX.insight)+tbl('tbl-abc',AX.heads,AX.rows))
    +card('📦 Стратегия пополнения: на склад vs под заказ',canvas('c-mto','Кольцевая диаграмма MTS/MTO')+insight(S.mtomts.insight)+tbl('tbl-mto',S.mtomts.heads,S.mtomts.rows))
    +`</div>`;
}

/* ═══════════════ 4. Поставки ═══════════════ */
/* Интерактивная схема-граф цепочки поставок (SVG): узлы → потоки, подсветка ограничений */
function chainGraphHTML(){
  const R=SUPPLY.mapRows;
  const VW=1712,leftPad=232,rightPad=34,top=76,rowGap=176,NH=70;
  const VH=top+rowGap*(R.length-1)+NH+52;
  const slot=t=>(VW-leftPad-rightPad)/R[t].nodes.length;
  const nw=t=>Math.min(168,slot(t)*0.84);
  const cx=(t,i)=>leftPad+(i+0.5)*slot(t);
  const cy=t=>top+t*rowGap+NH/2;
  const RAIL='#7c3aed',AUTO='#0d9488',INTRA='#94a3b8',BAD='#e0243c',WARN='#e8930c';
  let edges='',nodes='',labels='';
  /* тонкие незаметные связи: тип определяет только цвет линии, ограничения на потоках не показываем */
  const edge=(x1,y1,x2,y2,color,op)=>`<line x1="${x1.toFixed(1)}" y1="${(y1+NH/2).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y2-NH/2).toFixed(1)}" stroke="${color}" stroke-width="1" opacity="${op}"/>`;
  // поставщики → заводы: ЖД
  R[0].nodes.forEach((s0,i)=>{R[1].nodes.forEach((p,j)=>{edges+=edge(cx(0,i),cy(0),cx(1,j),cy(1),RAIL,.2);});});
  // завод → свой заводской склад: внутризаводское перемещение
  R[1].nodes.forEach((p,i)=>{const w=Math.min(i,R[2].nodes.length-1);edges+=edge(cx(1,i),cy(1),cx(2,w),cy(2),INTRA,.55);});
  // заводские склады → 3PL / опорные концентраторы: авто
  const REGION={
    'СЗ|Санкт-Петербург':['ПС Торжок','ПС Ворсино'],'СЗ|Петрозаводск':['ПС Торжок'],
    'Центр|Москва':['ПС Торжок','ПС Ворсино'],'Центр|Нижний Новгород':['ПС Ворсино','ПС Торжок'],'Центр|Воронеж':['ПС Ворсино','ПС Волгоград'],
    'Юг|Ростов-на-Дону':['ПС Волгоград','ПС Ворсино'],'Юг|Краснодар':['ПС Волгоград','ПС Ворсино'],
    'Сибирь|Тюмень (ОК)':['ПС Тюмень','ПС Пермь'],'Сибирь|Новосибирск':['ПС Тюмень'],'Сибирь|Красноярск':['ПС Тюмень'],
    'Восток|Хабаровск':['ПС Тюмень'],'Восток|Владивосток':['ПС Тюмень']};
  const psIdx=new Map(R[2].nodes.map((n,i)=>[n.n,i]));
  R[3].nodes.forEach((c3,i)=>{(REGION[c3.n]||[]).forEach(ps=>{const wi=psIdx.get(ps);if(wi==null)return;edges+=edge(cx(2,wi),cy(2),cx(3,i),cy(3),AUTO,.22);});});
  R.forEach((row,t)=>{
    const W=nw(t);
    labels+=`<text x="14" y="${(cy(t)-4).toFixed(1)}" font-size="15" font-weight="700" fill="#3f3f45">${esc(row.label)}</text>`
      +`<text x="14" y="${(cy(t)+14).toFixed(1)}" font-size="12" fill="#8c9096">${row.nodes.length} объектов</text>`;
    row.nodes.forEach((n,i)=>{const x=cx(t,i)-W/2,y=top+t*rowGap;const nm=n.n.split('|');
      const state=n.r?'Разрыв':n.w?'Узкое место':'Норма';
      const tip=`<b>${esc(nm.join(' · '))}</b><br><span class="r">${esc(row.label)}</span>`
        +(n.r?`<br>🔴 <b>Разрыв ${esc(n.r)} т</b><br>${esc(n.rt||'')}`
            :n.w?`<br>🟡 <b>Узкое место (предупреждение)</b><br>${esc(n.w)}<br><span class="r">На разрыв 4 кв. не влияет</span>`
                :'<br>🟢 Без ограничений');
      const stroke=n.r?BAD:n.w?WARN:'#d9d7e2',fill=n.r?'#fff3f5':n.w?'#fff9ec':'#ffffff';
      nodes+=`<g class="cg-node" data-smtip="${esc(tip)}" data-state="${state}">`
        +`<rect x="${x.toFixed(1)}" y="${y}" width="${W.toFixed(1)}" height="${NH}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${n.r?2.4:n.w?2:1.2}"/>`
        +`<text x="${(x+W/2).toFixed(1)}" y="${y+26}" text-anchor="middle" font-size="21">${n.icon}</text>`
        +`<text x="${(x+W/2).toFixed(1)}" y="${y+45}" text-anchor="middle" font-size="${Math.min(13,(W-8)*1.75/Math.max(nm[0].length,1)).toFixed(1)}" font-weight="600" fill="#2f2f33">${esc(nm[0])}</text>`
        +(nm[1]?`<text x="${(x+W/2).toFixed(1)}" y="${y+60}" text-anchor="middle" font-size="${Math.min(11.5,(W-8)*1.75/Math.max(nm[1].length,1)).toFixed(1)}" fill="#8c9096">${esc(nm[1])}</text>`:'')
        +(n.r?`<g><rect x="${(x+W-58).toFixed(1)}" y="${y-12}" width="62" height="21" rx="6" fill="${BAD}"/>`
             +`<text x="${(x+W-27).toFixed(1)}" y="${y+3}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">${esc(String(n.r))} т</text></g>`
          :n.w?`<g><rect x="${(x+W-26).toFixed(1)}" y="${y-12}" width="30" height="21" rx="6" fill="${WARN}"/>`
             +`<text x="${(x+W-11).toFixed(1)}" y="${y+3}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">!</text></g>`:'')
        +`</g>`;});});
  return `<div class="chaingraph"><svg class="cg-svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Схема цепочки поставок">${edges}${nodes}${labels}</svg>`
    +`<div class="cg-legend">`
      +`<span><i style="border-top-color:${RAIL}"></i>ЖД</span>`
      +`<span><i style="border-top-color:${AUTO}"></i>Авто</span>`
      +`<span><i style="border-top-color:${INTRA}"></i>Внутризаводское перемещение</span>`
      +`<span><span class="dotc" style="background:#fff3f5;border:2px solid ${BAD}"></span>Разрыв — объект ограничивает объём</span>`
      +`<span><span class="dotc" style="background:#fff9ec;border:2px solid ${WARN}"></span>Узкое место — предупреждение, разрыва не создаёт</span>`
    +`</div></div>`;
}
const fmtM1=v=>Number(v).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1}).replace('-','−');
function hmCell(cell,mode,scen){
  const obj=cell&&typeof cell==='object',v=obj?cell.v:cell,good=obj&&cell.good;
  if(scen==='A'){
    if(v==null)return `<td class="hm-cell ${mode==='cov'?'hm-0':'hm-m-na'}">—</td>`;
    const cls=mode==='cov'?(v>=100?'hm-100':v>=90?'hm-90':v>=80?'hm-80':v>=70?'hm-70':v>=60?'hm-60':v>=50?'hm-50':v>=40?'hm-40':v>=30?'hm-30':'hm-0')
      :(v>=50?'hm-m-high':v>=25?'hm-m-good':v>=15?'hm-m-mid':v>=8?'hm-m-low':v>=3?'hm-m-vlow':v>=0?'hm-m-minimal':'hm-m-loss');
    return `<td class="hm-cell ${cls}">${mode==='cov'?v+'%':fmtM1(v)}</td>`;
  }
  if(v==null)return `<td class="hm-cell hm-delta-zero">—</td>`;
  if(v===0)return `<td class="hm-cell hm-delta-zero">0${mode==='cov'?'%':''}</td>`;
  const txt=(v>0?'+':'−')+(mode==='cov'?Math.abs(v):fmtM1(Math.abs(v)))+(mode==='cov'?'%':'');
  if(v>0)return `<td class="hm-cell hm-delta-pos">${txt}</td>`;
  if(good)return `<td class="hm-cell hm-delta-neg hm-delta-neg-good">${txt} ✓</td>`;
  return `<td class="hm-cell hm-delta-neg">${txt}</td>`;
}
function hmTable(scen,mode){
  const HH=HEATMAP[scen][mode];
  let h=`<div class="hm-scroll"><table class="hm"><thead><tr><th class="row-header">Клиент / Сегмент</th>${HEATMAP.products.map(p=>`<th>${p.replace(/ ([^ ]+)$/,'<br>$1')}</th>`).join('')}<th class="hm-total">${mode==='cov'?'Итого<br>покрытие':'Итого<br>маржа'}</th></tr></thead><tbody>`;
  HEATMAP.clients.forEach(([name,seg],i)=>{
    h+=`<tr><td class="row-header">${seg} ${name}</td>${HH.m[i].map(c=>hmCell(c,mode,scen)).join('')}${hmCell(HH.ct[i],mode,scen)}</tr>`;
  });
  h+=`<tr class="row-sum"><td class="row-header">📊 Итого по продукту</td>${HH.mt.map(c=>hmCell(c,mode,scen)).join('')}${hmCell(HH.ctAll,mode,scen)}</tr></tbody></table></div>`;
  return h;
}
/* Аналитика «Выполнение годового плана 2026 при каждом сценарии» — рядом с радаром */
function scenYearHTML(Y){
  const p=Y.plan;
  const bar=(v,max,c)=>`<span class="sy-bar"><i style="width:${Math.max(2,Math.min(100,v/max*100)).toFixed(1)}%;background:${c}"></i></span>`;
  const pc=(a,b)=>NF(a/b*100,1)+'%';
  const line=(r,cls)=>`<div class="sy-row ${cls||''}">`
    +`<div class="sy-name">${r.name}</div>`
    +`<div class="sy-m"><span class="sy-k">Объём 2026</span><b>${N(r.vol)} т</b><span class="sy-p">${pc(r.vol,p.vol)}</span>${bar(r.vol,p.vol,'#20A7C9')}</div>`
    +`<div class="sy-m"><span class="sy-k">Выручка 2026</span><b>${N(r.rev)} млн</b><span class="sy-p">${pc(r.rev,p.rev)}</span>${bar(r.rev,p.rev,'#7c3aed')}</div>`
    +`<div class="sy-m"><span class="sy-k">Валовая прибыль</span><b>${N(r.gp)} млн</b><span class="sy-p">${pc(r.gp,p.gp)} · маржа ${NF(r.mgn,1)}%</span>${bar(r.gp,p.gp,'#4CAF50')}</div>`
    +`</div>`;
  return `<div class="scen-year"><div class="sy-head">Выполнение бизнес-плана 2026 <b>${N(p.vol)} т / ${N(p.rev)} млн руб. / ВП ${N(p.gp)} млн руб.</b>`
    +`<div class="muted">Факт янв–сен: ${N(Y.ytd.vol)} т · ${N(Y.ytd.rev)} млн руб. · ВП ${N(Y.ytd.gp)} млн руб. Год = факт + выбранный сценарий 4 кв. Сравниваются только сценарии А/Б/В текущего цикла.</div></div>`
    +Y.rows.map(r=>line(r,'sy-'+r.cls+(r.cls==='c'?' sy-best':''))).join('')
    +`<div class="sy-note">🏆 Сценарий В даёт максимум валовой прибыли года — <b>${N(Y.rows[2].gp)} млн руб.</b> (${pc(Y.rows[2].gp,p.gp)} плана), Сценарий Б — максимум объёма и выручки, но −${N(Y.rows[1].gp<Y.rows[2].gp?Y.rows[2].gp-Y.rows[1].gp:0)} млн руб. прибыли к В.</div></div>`;
}
function scenYearRows(Y){
  const p=Y.plan,pc=(a,b)=>NF(a/b*100,1)+'%';
  const row=(r,cls)=>({cells:[r.name||r.id,N(r.q4vol),NF(r.q4rev,1),N(r.q4gp),NF(r.q4mgn,1)+'%',N(r.vol),pc(r.vol,p.vol),N(r.rev),pc(r.rev,p.rev),N(r.gp),pc(r.gp,p.gp),NF(r.mgn,1)+'%'],cls});
  return [
    {cells:['<b>Бизнес-план 2026 (требуется в 4 кв.)</b>','156 000','23 439,0','6 385','27,2%','<b>'+N(p.vol)+'</b>','100%','<b>'+N(p.rev)+'</b>','100%','<b>'+N(p.gp)+'</b>','100%','24,0%'],cls:'row-total'},
    ...Y.rows.map(r=>row(r,r.cls==='c'?'row-sum':'')),
  ];
}
function vSupply(){
  const S=SUPPLY;
  /* Полоса сегмента: цветная часть — доступный объём, лёгкая штриховка — разрыв.
     Справа остаются только объёмы: доступный и, при наличии, малый красный объём разрыва. */
  const gap=S.gap.rows.map(r=>r.div?'<div class="gap-divider"></div>':`<div class="gap-row"><div class="gap-label${r.main?' main':''}">${r.label}</div><div class="gap-bar-bg"><div class="gap-bar" style="width:${r.w}%;background:${r.c}"></div>${r.gapW?`<div class="gap-bar gap-bar-un" style="width:${r.gapW}%"></div>`:''}</div><div class="gap-val${r.main?' main':''}" style="color:${r.c}">${r.value}${r.gapVal?`<br><small class="neg">${r.gapVal}</small>`:''}</div></div>`).join('');
  J('#c-constr','hbar',[{data:S.constraints.data,pointColors:S.constraints.colors,color:'#D93025'}],S.constraints.labels,{height:280,barValuesIn:true,barValueFont:13});
  J('#c-radar','radar',S.radar.series.map(([n,d,c])=>({data:d,color:c})),S.radar.axes,{height:400,legend:S.radar.series.map(x=>x[0]),max:S.radar.max||120});
  const F=S.fan;
  J('#c-fan','band',[
    {data:F.best,color:'#20A7C9'},
    {data:F.base,color:'#1a2b4a'},
    {data:F.worst,color:'#8c9bae'},
  ],F.labels,{height:420,legend:['Оптимистичный ('+F.pctB+')','Базовый','Пессимистичный ('+F.pctW+')'],yTitle:'Объем, т/мес',
    min:Math.floor((Math.min(...F.worst)-1500)/1000)*1000,max:Math.ceil((Math.max(...F.best)+1200)/1000)*1000});
  const fanRows=F.labels.map((m,i)=>[m,N(F.worst[i]),N(F.base[i]),N(F.best[i]),N(F.marginWorst[i]),N(F.marginBase[i]),N(F.marginBest[i]),F.drivers[i]]);
  if(!ui.scenCollapsed)ui.scenCollapsed=new Set();
  const scenCards=S.scenarios.map(s=>{const col=ui.scenCollapsed.has(s.id);
    return `<article class="scen scen-${s.cls}${col?' collapsed':''}"><div class="scen-head"><h4>${s.title}</h4>`
    +`<button class="scen-toggle" data-scen-toggle="${s.id}" aria-expanded="${!col}" title="${col?'Развернуть сценарий':'Свернуть сценарий'}" aria-label="${col?'Развернуть':'Свернуть'} ${esc(s.title)}">${col?'+':'−'}</button></div>`
    +`<div class="scen-body">${s.rank?`<div class="scen-rank">${s.rank}</div>`:''}<div class="scen-desc">${s.desc}</div>${s.metrics.map(([k,v,c])=>`<div class="scen-metric"><span>${k}</span><b class="${c}">${v}</b></div>`).join('')}</div></article>`;}).join('');
  const hs=ui.hmscen??'A',hm=ui.hmmode??'cov';
  const heatmapHtml=sw('hmscen',[['A','Сценарий А (Базовый)'],['B','Сценарий Б (Захват рынка)'],['C','Сценарий В (Фокус на валовой прибыли)']])
    +sw('hmmode',[['cov','Покрытие спроса (%)'],['mrg','Валовая маржа (млн руб.)']])
    +(hs!=='A'?info('primary',S.kpiNote):'')
    +hmTable(hs,hm)
    +`<div class="hm-legend">${hs==='A'?S.heatmapLegends[hm]:S.heatmapLegends.delta}</div>`
    +insight(hs==='A'?S.heatmapInsights[hm]:S.heatmapInsights.delta)
    +tbl('tbl-heatmap',HEATMAP.flatTable.heads,HEATMAP.flatTable.rows);
  return kpis('supply')
    +card('🏭 Карта цепочки поставок и ограничений',chainGraphHTML()
      +`<div class="info info-danger"><b>🔴 Разрыв цепочки без компенсирующих мер: −19 000 т</b><div class="constr-grid">${S.mapConstraints.map(([i,t,d])=>`<div>${i} <b>${t}</b> ${d}</div>`).join('')}</div></div>`
      +info('warning','<b>🟡 Узкие места (предупреждения, разрыва не создают):</b> заводы Пермь (98%) и Торжок (94%); заводские склады ПС Пермь (91%), ПС Волгоград (88%) и ПС Торжок (14 из 16 рамп); склады 3PL Юг / Ростов-на-Дону (89%), Центр / Москва (88% комплектации) и Сибирь / Новосибирск (ЖД-плечо 12 суток). Держим на контроле: при росте спроса выше сценария Б они станут следующими ограничениями.')
      +tbl('tbl-supply-map',S.mapTable.heads,S.mapTable.rows),S.mapDesc)
    +card('📊 Покрытие спроса (сценарий А «Базовый»)',`<div class="gap-chart">${gap}</div>`
      +info('danger',`<b class="gap-break">⚠️ РАЗРЫВ: 19 000 т</b> · доступно 133 000 из 152 000 т · Серебро −8 000 т + Бронза −11 000 т = −19 000 т<br>${S.gap.reasons}`)
      +tbl('tbl-gap',S.gap.table.heads,S.gap.table.rows))
    +card('📊 Детализация ограничений',canvas('c-constr','Горизонтальная диаграмма ограничений цепочки (значения — на полосах)')+insight(S.constraints.insight)+tbl('tbl-constr',S.constraints.heads,S.constraints.rows))
    +`<h3 class="section-h">🎯 Сценарии покрытия спроса (закрытие разрыва)</h3><div class="grid-3">${scenCards}</div>`
    +card('📊 Сравнение сценариев: объём против маржи и выполнение годового плана 2026',
      `<div class="scen-split"><div class="scen-split-l">${canvas('c-radar','Радарная диаграмма сравнения сценариев')}</div>`
      +`<div class="scen-split-r">${scenYearHTML(S.scenYear)}</div></div>`
      +tbl('tbl-scen',S.radar.heads,S.radar.rows)
      +tbl('tbl-scen-year',S.scenYear.heads,scenYearRows(S.scenYear)))
    +card('🌊 Сценарное планирование: лучший / базовый / худший (18 месяцев)',canvas('c-fan','Веерный график сценариев на 18 месяцев')+insight(F.insight)+tbl('tbl-fan',F.heads,fanRows))
    +card('🗺️ Тепловая карта по клиентам и продуктам (4 квартал 2026)',heatmapHtml);
}

/* ═══════════════ 5. Планы ═══════════════ */
/* Полоса рисков плана запасов: минималистичные бейджи 🟠/🔴 с пояснением при наведении.
   Использует data-smtip (HTML-тултип), как пузырьки сегментации. */
function riskStripHTML(P,a,b,invOpts){
  const iv=invOpts.view;
  if(iv==='summary'||typeof P.risks!=='function')return '';
  const R=P.risks(a,b,invOpts);
  const shortName=n=>String(n).replace(/^3PL /,'');
  if(!R.list.length){
    const fb=invOpts.riskOnly?' Фильтр «Только риски» включён, но рисков нет — показаны все позиции.':'';
    return `<div class="risk-strip"><span class="risk-title">⚠️ Риски периода:</span><span class="risk-ok">✅ Не выявлено — все позиции в коридоре (страховой … цель +15%).${fb}</span></div>`;
  }
  const badges=R.list.map(r=>{
    const icon=r.type==='under'?'🔴':'🟠';
    const wm=r.months.find(m=>m.mi===r.worstMi)||r.months[0];
    const mln=v=>N(Math.round(v*COST_TON));
    const tip=`<b>${esc(r.name)}</b> — ${r.type==='under'?'дефицит: план ниже страхового запаса':'перетовар: план выше цели более чем на 15%'}<br>`
      +`Худший месяц: <b>${esc(MONTHS18[r.worstMi])}</b> — ${esc(r.text)}<br>`
      +`План ${N(wm.plan)} т (${mln(wm.plan)} млн) · цель ${N(wm.tgt)} т · страховой ${N(wm.saf)} т<br>`
      +(r.months.length>1?`Месяцы с риском: ${r.months.map(m=>esc(MONTHS18[m.mi])).join(', ')}<br>`:'')
      +`Причина: ${esc(r.cause)}<br>Действие: ${esc(r.action)}`;
    return `<span class="risk-badge risk-${r.type}" data-smtip="${esc(tip)}">${icon} ${esc(shortName(r.name))} · ${esc(r.text)}</span>`;
  }).join('');
  let hint='';
  if(iv==='warehouses'&&R.detailCount!=null&&R.detailCount>R.list.length){
    hint=`<span class="risk-badge risk-hint" data-smtip="${esc('Агрегированный уровень сглаживает часть рисков. Переключите уровень на «По регионам (10)», чтобы увидеть все '+R.detailCount+' рисковых узлов.')}">🔍 В детализации по регионам: ${R.detailCount}</span>`;
  }
  return `<div class="risk-strip"><span class="risk-title">⚠️ Риски периода (${R.list.length}):</span>${badges}${hint}</div>`;
}
function vPlans(){
  if(ui.pq==null)ui.pq='q4-2026'; /* по умолчанию открывается 4 кв. 2026 */
  const pl=ui.plan??'sales';
  const q=ui.pq;
  const [a,b]=planRange(q,ui.pcFrom,ui.pcTo);
  const P=PLANS[pl];
  const invOpts=pl==='inventory'?{
    view:ui.planinvview??'summary',
    mode:ui.planinvmode??'tons',
    cats:ui.invCats,
    nodes:ui.invNodes,
    whs:ui.invWh,
    level:ui.invWhLevel??'agg',
    riskOnly:ui.invrisk==='1',
  }:{};
  const cdef=pl==='inventory'?P.chart(a,b,invOpts):P.chart(a,b);
  J('#c-plan',cdef.type,cdef.series,cdef.labels,cdef.opts);
  const view=planView(pl,a,b,q,invOpts);
  const kpiStrip=`<section class="kpis">${view.kpis.map(k=>`<article class="kpi"><div class="muted kpi-label">${k.label}</div><div class="value">${k.value}</div><div class="kpi-sub">${k.sub}</div></article>`).join('')}</section>`;
  // быстрые фильтры + выбор произвольного периода
  const monthOpts=(sel)=>MONTHS18.map((m,i)=>`<option value="${i}"${i===sel?' selected':''}>${m}</option>`).join('');
  const cf=Math.max(0,Math.min(17,+ui.pcFrom||0)),ct=Math.max(cf,Math.min(17,ui.pcTo==null?2:+ui.pcTo));
  const custom=`<div class="pb-custom"><span>Произвольный период:</span><select data-pcustom="from">${monthOpts(cf)}</select><span>—</span><select data-pcustom="to">${monthOpts(ct)}</select></div>`;
  const periodBar=`<div class="periodbar"><span class="pb-lbl">Период планирования</span>`
    +`<div class="switch">${PLAN_PERIODS.map(([v,l])=>`<button class="${q===v?'active':''}" data-sw="pq" data-val="${v}">${l}</button>`).join('')}</div>`
    +custom
    +`</div><div class="pb-summary">Показан период: <b>${MONTHS18[a]} – ${MONTHS18[b-1]}</b> (${b-a} мес.). Карточки, график и детальная таблица обновляются вместе.</div>`;
  let invExtra='';
  if(pl==='inventory'){
    const iv=invOpts.view;
    const stopsInRange=(P.stops||[]).filter(x=>x.i>=a&&x.i<b);
    const stopsNote=P.stops?`<div class="muted" style="font-size:11px;margin-bottom:6px">⛔ Вертикальные отметки на графике — плановые остановы производства: ${P.stops.map(x=>`${esc(x.label.replace('Останов: ',''))} (${MONTHS18[x.i]})`).join(' · ')}${stopsInRange.length?'':` · <i>в выбранном периоде остановов нет (переключите период на «2027 год» или «Все 18 мес.»)</i>`}</div>`:'';
    const viewSwitch=`<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">`
      +`<div><div class="muted" style="font-size:11px;margin-bottom:2px">Вид графика запасов</div>`
      +sw('planinvview',[
        ['summary','📈 Сводный план (IBP)'],
        ['warehouses','🏭 По складам (заводы + 3PL)'],
        ['wh_detail','🏬 Динамика по складам (выбор)'],
        ['products','🧪 По категориям продуктов (8)'],
      ])+`</div>`
      +(iv==='warehouses'?`<div><div class="muted" style="font-size:11px;margin-bottom:2px">Уровень: от общего к частному</div>`
        +sw('invWhLevel',[['agg','📦 Заводы + Все 3PL'],['Detail','🗂️ По регионам (10)']])
        +`</div>`:'')
      +`<div><div class="muted" style="font-size:11px;margin-bottom:2px">Единицы измерения</div>`
      +sw('planinvmode',[['tons','Тонны'],['money','Стоимость, млн руб.']])
      +`</div>`
      +(iv!=='summary'?`<div><div class="muted" style="font-size:11px;margin-bottom:2px">Риски</div>`
        +sw('invrisk',[['0','Все позиции'],['1','⚠️ Только риски']])
        +`</div>`:'')
      +`</div>`;
    let quickFilter='';
    if(iv==='warehouses'){
      const selCats=ui.invCats&&ui.invCats.size?ui.invCats:null;
      const allOn=!selCats||selCats.size===P.products.length;
      quickFilter=`<div class="periodbar" style="margin:6px 0 10px;padding:8px 12px;background:var(--scp-surface-2)">`
        +`<span class="pb-lbl">Быстрый фильтр по категориям (1 или несколько):</span>`
        +`<div class="switch" style="margin:0">`
        +`<button class="${allOn?'active':''}" data-invcat="all">Все категории (${P.products.length})</button>`
        +P.products.map(p=>{
          const act=selCats?selCats.has(p.id):false;
          return `<button class="${act?'active':''}" data-invcat="${p.id}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:5px"></span>${esc(p.name)}</button>`;
        }).join('')
        +`</div></div>`;
    }else if(iv==='wh_detail'){
      const selWh=ui.invWh&&ui.invWh.size?ui.invWh:null;
      const allOn=!selWh||selWh.size===P.warehouses.length;
      const plantIds=P.warehouses.filter(w=>!w.id.startsWith('3pl_')).map(w=>w.id);
      const tplIds=P.warehouses.filter(w=>w.id.startsWith('3pl_')).map(w=>w.id);
      const onlyPlants=selWh&&selWh.size===plantIds.length&&plantIds.every(id=>selWh.has(id));
      const only3pl=selWh&&selWh.size===tplIds.length&&tplIds.every(id=>selWh.has(id));
      quickFilter=`<div class="periodbar" style="margin:6px 0 10px;padding:8px 12px;background:var(--scp-surface-2)">`
        +`<span class="pb-lbl">Выбор складов (1 или несколько):</span>`
        +`<div class="switch" style="margin:0">`
        +`<button class="${allOn?'active':''}" data-invwh="all">Все склады (${P.warehouses.length})</button>`
        +`<button class="${onlyPlants?'active':''}" data-invwh="plants">🏭 Заводы ПС (5)</button>`
        +`<button class="${only3pl?'active':''}" data-invwh="3pl">🏬 Склады 3PL (12)</button>`
        +P.warehouses.map(w=>{
          const act=selWh?selWh.has(w.id):false;
          return `<button class="${act?'active':''}" data-invwh="${w.id}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${w.color};margin-right:5px"></span>${esc(w.name)}</button>`;
        }).join('')
        +`</div></div>`;
    }else if(iv==='products'){
      const selNodes=ui.invNodes&&ui.invNodes.size?ui.invNodes:null;
      const allOn=!selNodes||selNodes.size===P.whGroups.length;
      const plantIds=P.whGroups.filter(g=>g.kind==='plant').map(g=>g.id);
      const threePlIds=P.whGroups.filter(g=>g.kind==='3pl').map(g=>g.id);
      const onlyPlants=selNodes&&selNodes.size===plantIds.length&&plantIds.every(id=>selNodes.has(id));
      const only3pl=selNodes&&selNodes.size===threePlIds.length&&threePlIds.every(id=>selNodes.has(id));
      quickFilter=`<div class="periodbar" style="margin:6px 0 10px;padding:8px 12px;background:var(--scp-surface-2)">`
        +`<span class="pb-lbl">Быстрый фильтр по заводам и регионам 3PL (1 или несколько):</span>`
        +`<div class="switch" style="margin:0">`
        +`<button class="${allOn?'active':''}" data-invnode="all">Все площадки (${P.whGroups.length})</button>`
        +`<button class="${onlyPlants?'active':''}" data-invnode="plants">🏭 Все заводы ПС (5)</button>`
        +`<button class="${only3pl?'active':''}" data-invnode="3pl">🏬 Все регионы 3PL (5)</button>`
        +P.whGroups.map(g=>{
          const act=selNodes?selNodes.has(g.id):false;
          return `<button class="${act?'active':''}" data-invnode="${g.id}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color};margin-right:5px"></span>${esc(g.name)}</button>`;
        }).join('')
        +`</div></div>`;
    }
    invExtra=stopsNote+viewSwitch+quickFilter+riskStripHTML(P,a,b,invOpts);
  }
  const insText=typeof P.insightFor==='function'?(pl==='inventory'?P.insightFor(a,b,invOpts):P.insightFor(a,b)):P.insight;
  return periodBar
    +`<div class="switch" style="margin-bottom:12px">${Object.entries(PLANS).map(([id,p])=>`<button class="${pl===id?'active':''}" data-sw="plan" data-val="${id}">${p.tab}</button>`).join('')}</div>`
    +kpiStrip
    +card('📊 '+P.tab+' · '+MONTHS18[a]+' – '+MONTHS18[b-1],
      invExtra
      +canvas('c-plan','График: '+P.tab)
      +insight(insText)
      +tbl('tbl-plan-'+pl,view.detail.heads,view.detail.rows));
}

/* ═══════════════ 6. Действия ═══════════════ */
function vActions(){
  const A=ACTIONS;
  J('#c-act','donut',[A.statusDonut.data],A.statusDonut.labels,{height:280,colors:A.statusDonut.colors});
  const rows=A.rows.map(r=>{const st=r[5];const cls=st.includes('✅')?'st-done':st.includes('🟡')?'st-progress':'st-pending';return {cells:[...r.slice(0,5),`<span class="${cls}">${st}</span>`,r[6]]};});
  return card('✅ План действий ОППиУ',`<div class="tbl-scroll"><table class="dense"><thead><tr>${A.heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.cells.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
    +`<div class="grid">`
    +card('📊 Статус выполнения действий',canvas('c-act','Кольцевая диаграмма статуса действий')+insight(A.statusDonut.insight)+tbl('tbl-act',A.statusDonut.heads,A.statusDonut.rows))
    +card('🗓️ Ключевые вехи (Октябрь–Ноябрь 2026)',A.milestones.map(([k,t,d])=>info(k,`<b>${t}</b> ${d}`)).join(''))
    +`</div>`
    +card('🎯 Ожидаемые результаты (прогноз 4 квартал 2026)',`<div class="results">${A.results.map(([l,v,c])=>`<div class="result"><div class="muted kpi-label">${l}</div><div class="result-v ${c}">${v}</div></div>`).join('')}</div>`)
    +`<div class="info info-success decision">${A.decision}</div>`;
}

/* ═══════════════ Каркас: верхнее меню + рабочая область ═══════════════
   Единственная навигация — горизонтальное меню сверху; тема светлая,
   действия «Загрузить Excel» / «Сбросить» — ненавязчивые икон-кнопки. */
const VIEWS={overview:vOverview,segments:vSegments,demand:vDemand,stock:vStock,supply:vSupply,plans:vPlans,actions:vActions};
/* ── Разворот карточек с графиками на весь экран ── */
const ICON_EXPAND='<svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
const ICON_COLLAPSE='<svg viewBox="0 0 24 24"><polyline points="7 3 3 3 3 7"/><polyline points="17 21 21 21 21 17"/><line x1="3" y1="3" x2="10" y2="10"/><line x1="21" y1="21" x2="14" y2="14"/></svg>';
function repaintCardCanvases(card,fs){
  const cvs=[...card.querySelectorAll('canvas.chart')];
  cvs.forEach(cv=>{
    const cfg=cv.__cfg;if(!cfg)return;
    if(fs&&cv.__origH==null)cv.__origH=cfg.opts.height||280;
    const h=fs?(cvs.length===1?Math.max(cv.__origH||280,Math.floor((window.innerHeight||800)*0.62)):cv.__origH):(cv.__origH||cfg.opts.height);
    drawChart(cv,cfg.type,cfg.series,cfg.labels,{...cfg.opts,height:h});
    if(!fs)cv.__origH=null;
  });
}
function closeFullscreen(){
  const fsCard=document.querySelector('.card.fs');
  if(fsCard){fsCard.classList.remove('fs');
    const b=fsCard.querySelector('.chart-expand');
    if(b){b.innerHTML=ICON_EXPAND;b.title='Развернуть на весь экран';b.setAttribute('aria-label','Развернуть график на весь экран');}
    repaintCardCanvases(fsCard,false);}
  document.querySelector('.fs-backdrop')?.remove();
  document.body.classList.remove('fs-lock');
}
function wireCardExpand(root){
  root.querySelectorAll('.card').forEach(card=>{
    if(!card.querySelector('canvas.chart'))return;
    if(card.querySelector('.chart-expand'))return;
    const b=document.createElement('button');
    b.className='chart-expand';b.innerHTML=ICON_EXPAND;
    b.title='Развернуть на весь экран';b.setAttribute('aria-label','Развернуть график на весь экран');
    b.addEventListener('click',ev=>{
      ev.stopPropagation();
      const isFs=card.classList.contains('fs');
      closeFullscreen();
      if(isFs)return;
      card.classList.add('fs');
      b.innerHTML=ICON_COLLAPSE;b.title='Свернуть обратно';b.setAttribute('aria-label','Свернуть график обратно');
      const bd=document.createElement('div');bd.className='fs-backdrop';
      bd.addEventListener('click',closeFullscreen);
      document.body.appendChild(bd);
      document.body.classList.add('fs-lock');
      repaintCardCanvases(card,true);
      card.scrollTop=0;
    });
    card.appendChild(b);
  });
}
function renderContent(){
  closeFullscreen();
  jobs=[];
  const el=document.querySelector('#content');
  if(!el)return;
  el.innerHTML=(VIEWS[tab]||vOverview)();
  jobs.forEach(([sel,...rest])=>drawChart(el.querySelector(sel),...rest));
  jobs=[];
  wireCardExpand(el);
}
/* Рендер любой вкладки в произвольный контейнер (используется экспортом PDF/PPTX):
   графики отрисовываются в канвасы внутри host, текущий экран не затрагивается. */
export function renderViewInto(host,tabId){
  jobs=[];
  host.innerHTML=(VIEWS[tabId]||vOverview)();
  jobs.forEach(([sel,...rest])=>drawChart(host.querySelector(sel),...rest));
  jobs=[];
}
const ICON_UPLOAD='<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
const ICON_RESET='<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
const ICON_EXPORT='<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
function render(){
  if(!C.tabs.some(x=>x.id===tab)){tab='overview';storage.set('tab',tab);}
  summ=summary(data);
  const t=C.tabs.find(x=>x.id===tab)||C.tabs[0];
  document.title=C.title;
  document.querySelector('#app').innerHTML=`<div class="app">`
    +`<div class="topbar">`
      +`<a class="brand" href="#" title="In.Plan · интегрированное бизнес-планирование">`
        +`<span class="brand-badge"><i class="bb1"></i><i class="bb2"></i><i class="bb3"></i><i class="bb4"></i></span></a>`
      +`<nav class="topnav" aria-label="Разделы дашборда">${C.tabs.map(x=>`<button class="${x.id===tab?'on':''}" data-tab="${x.id}" aria-current="${x.id===tab}"><span class="dot"></span><b>${x.label}</b></button>`).join('')}</nav>`
      +`<div class="topbar-actions">`
        +`<div class="tb-export">`
        +`<button class="tb-btn" id="exportBtn" data-tip="Экспорт дашборда: PDF или PPTX" aria-label="Экспорт дашборда" aria-haspopup="true">${ICON_EXPORT}</button>`
        +`<div class="tb-menu" id="exportMenu" hidden role="menu">`
        +`<div class="tb-menu-t">Экспорт дашборда · все разделы</div>`
        +`<button class="tb-menu-i" role="menuitem" data-exp="pdf"><span class="mi-ic">📄</span><span class="mi-tx"><b>PDF</b><small>альбомный A4 · 1–3 графика на странице</small></span></button>`
        +`<button class="tb-menu-i" role="menuitem" data-exp="pptx"><span class="mi-ic">📊</span><span class="mi-tx"><b>PPTX</b><small>альбомные слайды · без таблиц и отклонений</small></span></button>`
        +`</div></div>`
        +`<button class="tb-btn" id="upload" data-tip="Загрузить Excel (лист S&OP)" aria-label="Загрузить Excel">${ICON_UPLOAD}</button>`
        +`<input type="file" id="xlsx" accept=".xlsx,.xls" hidden>`
        +`<button class="tb-btn d" id="reset" data-tip="Вернуть демо-данные" aria-label="Вернуть демо-данные">${ICON_RESET}</button>`
      +`</div></div>`
    +`<div class="wrap">`
    +`<header><div class="hdr-left"><div><h1>${t.label}</h1><div class="h-sub">${esc(t.desc||C.subtitle)}</div></div></div>`
    +`<div class="stat">${summ.rows} строк данных · ${summ.custom?'источник: загруженный XLSX':'источник: демо-данные'}</div></header>`
    +`<div class="ctxbar"><span class="ctx-lbl">Контекст</span>${C.context.map(([k,v])=>`<span class="ctx-chip"><span class="cd"></span><b>${esc(k)}:</b>&nbsp;${esc(v)}</span>`).join('')}</div>`
    +`<main id="content"></main></div></div>`;
  renderContent();
}
/* Экспорт дашборда в PDF/PPTX: рендерим все вкладки офскрин и собираем файл */
async function runExport(format){
  const btn=document.getElementById('exportBtn');
  if(btn){btn.classList.add('busy');btn.dataset.tip='Готовлю файл…';}
  try{
    const res=await exportDashboard(format,{renderViewInto});
    if(btn)btn.dataset.tip=`Готово: ${res.pages} стр. (${format.toUpperCase()})`;
  }catch(err){
    alert('Не удалось сформировать файл: '+err.message);
    if(btn)btn.dataset.tip='Экспорт дашборда: PDF или PPTX';
  }finally{
    setTimeout(()=>{if(btn){btn.classList.remove('busy');btn.dataset.tip='Экспорт дашборда: PDF или PPTX';}},2500);
  }
}
async function readXlsx(e){
  try{
    const f=e.target.files[0];if(!f)return;
    const book=XLSX.read(await f.arrayBuffer());
    const rows=normalizeRows(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]));
    if(!rows.length)throw new Error('пустой лист');
    data=rows;tab='overview';storage.set('tab',tab);open.clear();render();
  }catch(err){alert('Не удалось прочитать XLSX: '+err.message)}
}
/* делегированные обработчики — единожды, DOM пересоздаётся при каждом render() */
document.addEventListener('click',e=>{
  const tb=e.target.closest('[data-tab]');
  if(tb){tab=tb.dataset.tab;storage.set('tab',tab);render();window.scrollTo({top:0,behavior:'smooth'});return;}
  const sg=e.target.closest('[data-segtoggle]');
  if(sg){if(!ui.segOff)ui.segOff=new Set();const c=sg.dataset.segtoggle;ui.segOff.has(c)?ui.segOff.delete(c):ui.segOff.add(c);renderContent();return;}
  const ic=e.target.closest('[data-invcat]');
  if(ic){
    const val=ic.dataset.invcat;
    if(val==='all'){ui.invCats=null;}
    else{
      if(!ui.invCats)ui.invCats=new Set();
      if(ui.invCats.has(val))ui.invCats.delete(val);else ui.invCats.add(val);
      if(!ui.invCats.size||ui.invCats.size===PLANS.inventory.products.length)ui.invCats=null;
    }
    renderContent();return;
  }
  const ind=e.target.closest('[data-invnode]');
  if(ind){
    const val=ind.dataset.invnode;
    if(val==='all'){ui.invNodes=null;}
    else if(val==='plants'){ui.invNodes=new Set(PLANS.inventory.whGroups.filter(g=>g.kind==='plant').map(g=>g.id));}
    else if(val==='3pl'){ui.invNodes=new Set(PLANS.inventory.whGroups.filter(g=>g.kind==='3pl').map(g=>g.id));}
    else{
      if(!ui.invNodes)ui.invNodes=new Set();
      if(ui.invNodes.has(val))ui.invNodes.delete(val);else ui.invNodes.add(val);
      if(!ui.invNodes.size||ui.invNodes.size===PLANS.inventory.whGroups.length)ui.invNodes=null;
    }
    renderContent();return;
  }
  const iwh=e.target.closest('[data-invwh]');
  if(iwh){
    const val=iwh.dataset.invwh;
    const WH=PLANS.inventory.warehouses;
    if(val==='all'){ui.invWh=null;}
    else if(val==='plants'){ui.invWh=new Set(WH.filter(w=>!w.id.startsWith('3pl_')).map(w=>w.id));}
    else if(val==='3pl'){ui.invWh=new Set(WH.filter(w=>w.id.startsWith('3pl_')).map(w=>w.id));}
    else{
      if(!ui.invWh)ui.invWh=new Set();
      if(ui.invWh.has(val))ui.invWh.delete(val);else ui.invWh.add(val);
      if(!ui.invWh.size||ui.invWh.size===WH.length)ui.invWh=null;
    }
    renderContent();return;
  }
  const exp=e.target.closest('[data-exp]');
  if(exp){const m=document.getElementById('exportMenu');if(m)m.hidden=true;runExport(exp.dataset.exp);return;}
  if(e.target.closest('#exportBtn')){const m=document.getElementById('exportMenu');if(m)m.hidden=!m.hidden;return;}
  if(!e.target.closest('.tb-export')){const m=document.getElementById('exportMenu');if(m)m.hidden=true;}
  const st=e.target.closest('[data-scen-toggle]');
  if(st){if(!ui.scenCollapsed)ui.scenCollapsed=new Set();const id=st.dataset.scenToggle;
    if(ui.scenCollapsed.has(id))ui.scenCollapsed.delete(id);else ui.scenCollapsed.add(id);
    renderContent();return;}
  const s=e.target.closest('[data-sw]');
  if(s){ui[s.dataset.sw]=s.dataset.val;renderContent();return;}
  const tg=e.target.closest('[data-toggle]');
  if(tg){const id=tg.dataset.toggle;if(open.has(id))open.delete(id);else open.add(id);
    const w=document.getElementById(id);if(w){w.classList.toggle('show');
      /* у блока могут быть свои подписи (например, «⚠️ Показать отклонения»), иначе — «📋 Данные» */
      const o=tg.dataset.open||'📋 Скрыть данные ▲',c=tg.dataset.closed||'📋 Данные ▼';
      tg.textContent=w.classList.contains('show')?o:c;}return;}
  if(e.target.closest('#upload')){const inp=document.querySelector('#xlsx');if(inp)inp.click();return;}
  if(e.target.closest('#reset')){data=MONTHLY;Object.keys(ui).forEach(k=>delete ui[k]);open.clear();render();return;}
});
document.addEventListener('change',e=>{
  if(e.target.id==='xlsx'){readXlsx(e);return;}
  const pc=e.target.closest?.('[data-pcustom]');
  if(pc){const which=pc.dataset.pcustom,v=+pc.value;
    if(which==='from'){ui.pcFrom=v;if((ui.pcTo==null?2:ui.pcTo)<v)ui.pcTo=v;}
    else{ui.pcTo=v;if((ui.pcFrom||0)>v)ui.pcFrom=v;}
    ui.pq='custom';renderContent();return;}
});
/* ── Плавающий информационный тултип для расчётных показателей [data-info] ── */
function infoTipEl(){let t=document.getElementById('__infoTip');if(!t){t=document.createElement('div');t.id='__infoTip';
  t.style.cssText='position:fixed;z-index:10000;pointer-events:none;display:none;background:#1f1f20;color:#fff;'
    +"font:400 12px/1.55 'Open Sans',sans-serif;padding:9px 11px;border-radius:6px;max-width:300px;"
    +'box-shadow:0 8px 28px rgba(0,0,0,.32)';document.body.appendChild(t);}return t;}
function moveInfoTip(x,y){const t=document.getElementById('__infoTip');if(!t||t.style.display==='none')return;
  const w=t.offsetWidth,h=t.offsetHeight,vw=innerWidth,vh=innerHeight;let nx=x+14,ny=y+14;
  if(nx+w>vw-8)nx=x-w-14;if(ny+h>vh-8)ny=y-h-14;t.style.left=Math.max(6,nx)+'px';t.style.top=Math.max(6,ny)+'px';}
document.addEventListener('mouseover',e=>{const el=e.target.closest?.('[data-info],[data-smtip]');if(!el)return;
  const t=infoTipEl();const html=el.getAttribute('data-smtip');if(html!=null)t.innerHTML=html;else t.textContent=el.getAttribute('data-info');
  t.style.display='block';moveInfoTip(e.clientX,e.clientY);});
document.addEventListener('mousemove',e=>{if(e.target.closest?.('[data-info],[data-smtip]'))moveInfoTip(e.clientX,e.clientY);});
document.addEventListener('mouseout',e=>{if(e.target.closest?.('[data-info],[data-smtip]')){const t=document.getElementById('__infoTip');if(t)t.style.display='none';}});
/* перерисовка canvas при изменении ширины (дебаунс) */
let rzT=null;
window.addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(()=>{
  const fsCard=document.querySelector('.card.fs');
  if(fsCard){repaintCardCanvases(fsCard,true);return;}
  renderContent();
},220);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFullscreen();});
render();
