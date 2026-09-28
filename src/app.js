/* ═══════════════ Дашборд ОППиУ «Лубри-Тех» — компоновка экранов ═══════════════
   Тот же подход, что и в базовом шаблоне: config.js задаёт вкладки/KPI,
   data.js — загружаемое ядро данных (XLSX), datasets.js — отчётные демо-данные,
   charts.js — canvas-рендеринг. Состояние (вкладка, тема, меню) — в localStorage,
   локальные переключатели вкладок — в `ui` (в памяти), открытые таблицы — `open`. */
import {DASHBOARD_CONFIG as C} from './config.js';
import {MONTHLY,normalizeRows,summary} from './data.js';
import {OVERVIEW,SEGMENTS,DEMAND,STOCK,SUPPLY,HEATMAP,PLANS,ACTIONS,M12_LABELS,QUARTERS,QRANGE} from './datasets.js';
import {drawChart} from './charts.js';
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
const kpiCard=k=>{const dev=rv(k.dev);return `<article class="kpi"${k.tip?` aria-label="${esc(k.tip)}"`:''}>${k.tip?`<div class="tooltip">${esc(k.tip)}</div>`:''}<div class="muted kpi-label">${rv(k.label)}</div><div class="value ${k.color||''}">${rv(k.value)}</div><div class="kpi-sub">${rv(k.sub)}</div>${dev?`<div class="dev dev-${dev.kind||'neu'}">${dev.text}</div>`:''}</article>`};
const kpis=tid=>(C.kpis[tid]||[]).length?`<section class="kpis">${C.kpis[tid].map(kpiCard).join('')}</section>`:'';

/* ═══════════════ Обзор ═══════════════ */
function perfRows(m){
  const rr=(r,cls)=>({cells:[r.period,r.type,N(r.planVol),N(r.vol),N(r.planVol?r.vol/r.planVol*100:0,0)+'%',NF(r.planRev),NF(r.rev),N(r.planRev?r.rev/r.planRev*100:0,0)+'%',N(r.price)],cls});
  const tot=(list,label,type)=>{const pv=list.reduce((a,x)=>a+x.planVol,0),v=list.reduce((a,x)=>a+x.vol,0),pr=list.reduce((a,x)=>a+x.planRev,0),rv2=list.reduce((a,x)=>a+x.rev,0);
    return {cells:[label,type,N(pv),N(v),N(pv?v/pv*100:0,0)+'%',NF(pr),NF(rv2),N(pr?rv2/pr*100:0,0)+'%',N(v?rv2/v*1000:0)],cls:'row-sum'};};
  if(m===MONTHLY){ // канонические итоги отчёта (см. CANON в data.js)
    return [...MONTHLY.map(r=>rr(r,r.type==='Прогноз'?'row-fc':'')),
      {cells:['Янв–Сен 2026 факт','Факт','900','880','98%','342,0','320,5','94%','347'],cls:'row-sum'},
      {cells:['Окт–Дек 2026 прогноз','Прогноз','300','303','101%','114,0','109,0','96%','360'],cls:'row-sum'},
      {cells:['Год 2026 итого (план/факт)','План/Факт','1 200','1 183','99%','456,0','429,5','94%','363'],cls:'row-total'}];}
  const f=m.filter(r=>r.type!=='Прогноз'),fc=m.filter(r=>r.type==='Прогноз');
  const rows=m.map(r=>rr(r,r.type==='Прогноз'?'row-fc':''));
  if(f.length>1)rows.splice(f.length,0,tot(f,f[0].period+'–'+f.at(-1).period,'Факт'));
  if(fc.length)rows.push(tot(fc,fc.length>1?fc[0].period+'–'+fc.at(-1).period:fc[0].period,'Прогноз'));
  const all=tot(m,'Итого','План/Факт');all.cls='row-total';all.cells[0]='Год итого';rows.push(all);
  return rows;
}
function vOverview(){
  const m=data,p=ui.ovp??'2026';
  const perfH=['Месяц','Тип','План объема (тыс. кЛ)','Факт/Прогноз объема (тыс. кЛ)','Выполнение %','План выручки (млн руб.)','Факт/Прогноз выручки (млн руб.)','Выполнение %','Средняя цена (руб/л)'];
  let chartHtml='',ins='';
  if(p==='2026'){
    const labels=m.map(r=>shortM(r.period));
    J('#c-ovperf','combo',[
      {data:m.map(r=>r.type==='Прогноз'?null:r.vol),kind:'bar',color:'#20A7C9'},
      {data:m.map(r=>r.type==='Прогноз'?r.vol:null),kind:'bar',color:'#90CAF9'},
      {data:m.map(r=>r.planVol),kind:'bar',color:'#e8ecef'},
      {data:m.map(r=>r.type==='Прогноз'?null:r.rev),kind:'line',axis:1,color:'#D93025'},
      {data:m.map(r=>r.type==='Прогноз'?r.rev:null),kind:'line',axis:1,color:'#FF8A80',dash:true},
    ],labels,{height:340,legend:['Объем факт (тыс. кЛ)','Объем прогноз (тыс. кЛ)','Объем план (тыс. кЛ)','Выручка факт (млн руб.)','Выручка прогноз (млн руб.)'],yTitle:'Объем (тыс. кЛ)',y1Title:'Выручка (млн руб.)'});
    ins=OVERVIEW.insight2026;
  }else{
    const d=OVERVIEW.perf2027;
    J('#c-ovperf','combo',[
      {data:d.planVol,kind:'bar',color:'#e8ecef'},
      {data:d.vol,kind:'bar',color:'#90CAF9'},
      {data:d.planRev,kind:'line',axis:1,color:'#8c9bae',dash:true},
      {data:d.rev,kind:'line',axis:1,color:'#4CAF50'},
    ],M12_LABELS,{height:340,legend:['Объем план 2027 (тыс. кЛ)','Объем прогноз прошлого цикла (тыс. кЛ)','Выручка план 2027 (млн руб.)','Выручка прогноз прошлого цикла (млн руб.)'],yTitle:'Объем (тыс. кЛ)',y1Title:'Выручка (млн руб.)'});
    ins=OVERVIEW.insight2027;
  }
  const V=OVERVIEW.volYoy,R=OVERVIEW.revYoy,A=OVERVIEW.accuracy;
  J('#c-ovyoy','combo',[
    {data:V.y2025,kind:'bar',color:'#e8ecef'},
    {data:V.y2026,kind:'bar',color:'#20A7C9'},
    {data:V.plan,kind:'line',color:'#D93025',dash:true},
  ],V.labels,{height:280,legend:['Объем 2025 (тыс. кЛ)','Объем 2026 (тыс. кЛ)','План 2026 (тыс. кЛ)']});
  J('#c-ovrev','combo',[
    {data:R.y2025,kind:'bar',color:'#e8ecef'},
    {data:R.y2026,kind:'bar',color:'#FF9800'},
    {data:R.m2025,kind:'line',axis:1,color:'#4CAF50'},
    {data:R.m2026,kind:'line',axis:1,color:'#D93025'},
  ],R.labels,{height:280,legend:['Выручка 2025 (млн)','Выручка 2026 (млн)','Маржа 2025 %','Маржа 2026 %'],y1Title:'Маржа %'});
  J('#c-ovacc','line',[
    {data:A.acc,color:'#4CAF50'},
    {data:Array(A.labels.length).fill(A.target),color:'#D93025',dash:true},
  ],A.labels,{height:280,legend:['Точность (%)','Целевая точность'],max:12});
  return kpis('overview')
    +card('📈 Объем и выручка: факт и план',sw('ovp',[['2026','2026 год'],['2027','2027 год']])+canvas('c-ovperf','Столбчато-линейный график объема и выручки: план, факт, прогноз')+insight(ins)+tbl('tbl-ov-perf',perfH,perfRows(m)))
    +`<div class="grid">`
    +card('📊 Объем: сравнение с прошлым годом',canvas('c-ovyoy','Столбчатая диаграмма: объем 2025 и 2026 по кварталам')+insight(V.insight)+tbl('tbl-vol-yoy',V.heads,V.rows))
    +card('💰 Выручка и маржа: сравнение с прошлым годом',canvas('c-ovrev','Столбчато-линейный график: выручка и маржа по кварталам')+insight(R.insight)+tbl('tbl-rev-yoy',R.heads,R.rows))
    +`</div>`
    +card('🎯 Точность прогноза по кварталам',canvas('c-ovacc','Линейный график точности прогноза по кварталам')+insight(A.insight)+tbl('tbl-acc',A.heads,A.rows))
    +card('⚠️ Ключевые отклонения',OVERVIEW.deviations.map(([k,t,d])=>info(k,`<b>${t}</b><br>${d}`)).join(''));
}

/* ═══════════════ 1. Сегментация ═══════════════ */
function vSegments(){
  const S=SEGMENTS;
  const bubbles='<div class="bubblemap">'
    +'<div class="zone zone-strategic"><span>Стратегические</span></div>'
    +'<div class="zone zone-core"><span>Ядро</span></div>'
    +'<div class="zone zone-perspective"><span>Перспективные</span></div>'
    +'<div class="zone zone-transactional"><span>Транзакционные</span></div>'
    +S.bubbles.map(b=>`<div class="bubble bubble-${b.cls}" style="${b.st}" title="${esc(b.t)}">${b.n}<br>${b.v}</div>`).join('')
    +'</div>';
  J('#c-segrev','donut',[S.revDonut.data],S.revDonut.labels,{height:300,colors:['#4CAF50','#20A7C9','#FF9800','#D93025','#9C27B0']});
  J('#c-segcost','stacked',S.costStack.series.map(([n,d,c])=>({data:d,color:c})),S.costStack.labels,{height:300,legend:S.costStack.series.map(x=>x[0])});
  return kpis('segments')
    +card('📊 Сегментация клиентов',bubbles+insight(S.bubbleInsight)+tbl('tbl-seg',S.clients.heads,S.clients.rows))
    +`<div class="grid">`
    +card('🥧 Распределение выручки по сегментам',canvas('c-segrev','Кольцевая диаграмма распределения выручки по сегментам')+insight(S.revDonut.insight)+tbl('tbl-rev',S.revDonut.heads,S.revDonut.rows))
    +card('📊 Структура затрат по сегментам за текущий год',canvas('c-segcost','Стековая диаграмма структуры затрат по сегментам')+insight(S.costStack.insight)+tbl('tbl-cost',S.costStack.heads,S.costStack.rows))
    +`</div>`;
}

/* ═══════════════ 2. Спрос ═══════════════ */
function vDemand(){
  const D=DEMAND,p=ui.dmp??'2026';
  if(p==='2026'){
    const facts=MONTHLY.filter(r=>r.type==='Факт'),UNC=[130,135,135],RF=[48,50,50];
    const vol=[...facts.map(r=>r.vol),...UNC],rev=[...facts.map(r=>r.rev),...RF];
    const pc=[...facts.map(()=>'#20A7C9'),...UNC.map(()=>'#90CAF9')];
    J('#c-demand','combo',[
      {data:Array(12).fill(100),kind:'bar',color:'#e8ecef'},
      {data:vol,kind:'bar',pointColors:pc,color:'#20A7C9'},
      {data:Array(12).fill(38),kind:'line',axis:1,color:'#8c9bae',dash:true},
      {data:rev,kind:'line',axis:1,color:'#D93025'},
    ],M12_LABELS,{height:340,legend:['План объема (тыс. кЛ)','Факт / неограниченный спрос (тыс. кЛ)','План выручки (млн руб.)','Факт/Прогноз выручки (млн руб.)'],yTitle:'Объем (тыс. кЛ)',y1Title:'Выручка (млн руб.)'});
  }else{
    const d=D.demand2027;
    J('#c-demand','combo',[
      {data:d.planVol,kind:'bar',color:'#e8ecef'},
      {data:d.demand,kind:'bar',color:'#90CAF9'},
      {data:d.planRev,kind:'line',axis:1,color:'#8c9bae',dash:true},
      {data:d.rev,kind:'line',axis:1,color:'#4CAF50'},
    ],M12_LABELS,{height:340,legend:['План объема 2027 (тыс. кЛ)','Неограниченный спрос 2027 (тыс. кЛ)','План выручки 2027 (млн руб.)','Прогноз выручки 2027 (млн руб.)'],yTitle:'Объем (тыс. кЛ)',y1Title:'Выручка (млн руб.)'});
  }
  const W=D.waterfall,AC=D.accCat,B=D.bias,F=D.fva,SE=D.seasonal;
  J('#c-wf','waterfall',[W.values],W.labels,{height:280});
  J('#c-accat','bar',[{data:AC.data,pointColors:AC.colors,color:'#4CAF50'}],AC.labels,{height:280,barValues:true});
  J('#c-bias','hbar',[{data:B.data,pointColors:B.colors,color:'#20A7C9'}],B.labels,{height:280});
  J('#c-fva','line',[
    {data:F.stat,color:'#20A7C9'},
    {data:F.corr,color:'#FF9800'},
    {data:F.fact,color:'#8c9bae',dash:true},
  ],F.labels,{height:280,legend:['Статистический прогноз','Корректировка продаж','Факт']});
  J('#c-seas','area',[
    {data:SE.base,color:'#20A7C9'},
    {data:SE.promo,color:'#FF9800'},
  ],SE.labels,{height:340,legend:['Базовый спрос','Промо-прирост']});
  D.models.forEach((m,i)=>J('#c-mini'+i,'line',[
    {data:m.fact,color:'#1a2b4a'},
    {data:m.fc,color:'#4CAF50',fill:true},
  ],['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен'],{height:96,compact:true,legend:['Факт',m.fcName]}));
  const modelCards=D.models.map((m,i)=>`<article class="model champ"><h5>${m.name} <span class="badge">ЛУЧШАЯ</span></h5><canvas id="c-mini${i}" class="chart" role="img" aria-label="Мини-график: факт и прогноз модели ${esc(m.model)}"></canvas><div class="stat"><b>Модель:</b> ${m.model}</div><div class="stat"><b>Точность:</b> ${m.acc}</div><div class="stat"><b>Систематическая ошибка:</b> ${m.bias}</div><div class="stat"><b>Почему:</b> ${m.why}</div><div class="stat dim">${m.others}</div></article>`).join('')
    +`<article class="model"><h5>📊 Сводка по моделям</h5><div class="info">${D.modelsSummary.map(([k,v])=>`<div class="stat"><b>${k}</b> ${v}</div>`).join('')}</div><div class="info info-success">${D.modelsDecision}</div></article>`;
  return kpis('demand')
    +card('📈 Спрос против годового бизнес-плана',sw('dmp',[['2026','2026 год'],['2027','2027 год']])+canvas('c-demand','Столбчато-линейный график спроса против плана')+insight(p==='2026'?D.insight2026:D.insight2027)+tbl('tbl-demand-period',D.periodTable.heads,D.periodTable.rows))
    +`<div class="grid">`
    +card('📉 Формирование согласованного прогноза',canvas('c-wf','Водопад: формирование согласованного прогноза')+insight(W.insight)+tbl('tbl-wf',W.heads,W.rows))
    +card('📊 Точность прогноза по категориям',canvas('c-accat','Столбчатая диаграмма точности прогноза по категориям')+insight(AC.insight)+tbl('tbl-acc2',AC.heads,AC.rows))
    +`</div><div class="grid">`
    +card('📉 Систематическая ошибка по каналам',canvas('c-bias','Горизонтальная диаграмма систематической ошибки по каналам')+insight(B.insight)+tbl('tbl-bias',B.heads,B.rows))
    +card('🔍 Статистический прогноз vs корректировка продаж vs факт',canvas('c-fva','Линейный график: статистика, корректировки и факт')+insight(F.insight)+tbl('tbl-fva',F.heads,F.rows))
    +`</div>`
    +card('📊 Базовый спрос и промо-прирост по сезонам',canvas('c-seas','Стековая областная диаграмма сезонного спроса')+insight(SE.insight)+tbl('tbl-seas',SE.heads,SE.rows))
    +card('🤖 Выбор математической модели прогнозирования по сегментам',`<div class="muted" style="margin-bottom:10px">${D.modelsIntro}</div><div class="grid-3">${modelCards}</div>`+tbl('tbl-models',D.modelsTable.heads,D.modelsTable.rows));
}

/* ═══════════════ 3. Запасы ═══════════════ */
function vStock(){
  const S=STOCK,v=ui.invview??'channels',dm=ui.deadmode??'tons';
  const CV=S.coverage[v==='channels'?'channels':'products'];
  J('#c-cover','combo',[
    {data:CV.days,kind:'bar',color:'#20A7C9',pointColors:CV.colors},
    {data:CV.safety,kind:'line',color:'#20A7C9',dash:true},
    {data:CV.target,kind:'line',color:'#4CAF50',dash:true},
  ],CV.labels,{height:340,legend:['Дней покрытия','Страховой запас (минимум)','Целевой запас']});
  const IP=S.invPlan;
  J('#c-invplan','line',[
    {data:IP.safety,color:'#20A7C9'},
    {data:IP.reorder,color:'#FF9800',dash:true},
    {data:IP.target,color:'#4CAF50'},
    {data:IP.actual,color:'#1a2b4a',fill:true},
  ],IP.labels,{height:340,legend:['Страховой запас','Точка заказа','Целевой запас','Запас на конец периода'],yTitle:'тыс. кЛ',max:450});
  const DD=S.dead[dm];
  J('#c-dead','bar',DD.series.map(([n,d,c])=>({data:d,color:c})),DD.labels,{height:280,legend:DD.series.map(x=>x[0]),yTitle:DD.unit});
  const AX=S.abcxyz;
  J('#c-abc','scatter',AX.scatter.map(s=>({data:s.points,color:s.color,r:7})),[],{height:340,legend:AX.scatter.map(s=>s.name),xTitle:'Вариативность спроса (XYZ)',yTitle:'Доля маржи (ABC)'});
  J('#c-mto','donut',[S.mtomts.data],S.mtomts.labels,{height:340,colors:S.mtomts.colors});
  const statCard=x=>`<article class="kpi bt-${x.cls}"><div class="muted kpi-label">${x.name}</div><div class="value ${x.cls}">${x.days}</div><div class="kpi-sub">${x.target}</div><div class="dev dev-${x.cls==='green'?'pos':x.cls==='red'?'neg':'neu'}">${x.delta}</div><div class="kpi-foot ${x.cls}">${x.effect}</div></article>`;
  return kpis('stock')
    +card('📦 Покрытие запасов',sw('invview',[['channels','По каналам сбыта'],['products','По категориям продуктов']])+canvas('c-cover','Диаграмма покрытия запасов в днях')+insight(CV.insight)+tbl('tbl-inv-coverage',S.coverage.heads,S.coverage.rows))
    +card('📈 План запасов на 18 месяцев',canvas('c-invplan','Линейный график плана запасов на 18 месяцев')+insight(IP.insight)+tbl('tbl-inv-plan',IP.heads,IP.rows))
    +card('🔴 Неликвиды — кандидаты на распродажу',sw('deadmode',[['tons','В тоннах'],['money','В деньгах']])+info('primary',S.dead.methodology)+canvas('c-dead','Столбчатая диаграмма неликвидов')+info('success',S.dead.effect)+tbl('tbl-dead',S.dead.heads,S.dead.rows))
    +card('🏭 Сырье: состояние запасов',info('primary',S.rawmMethodology)+`<div class="grid-3">${S.rawm.map(statCard).join('')}</div>`+tbl('tbl-rm',S.rawmTable.heads,S.rawmTable.rows))
    +card('📦 Готовая продукция: состояние запасов',`<div class="grid-3">${S.fgm.map(statCard).join('')}</div>`+tbl('tbl-fg',S.fgTable.heads,S.fgTable.rows))
    +`<div class="grid">`
    +card('📊 Матрица ABC-XYZ (ABC по марже, XYZ по вариативности спроса)',canvas('c-abc','Точечная диаграмма матрицы ABC-XYZ')+insight(AX.insight)+tbl('tbl-abc',AX.heads,AX.rows))
    +card('📦 Стратегия пополнения: на склад vs под заказ',canvas('c-mto','Кольцевая диаграмма MTS/MTO')+insight(S.mtomts.insight)+tbl('tbl-mto',S.mtomts.heads,S.mtomts.rows))
    +`</div>`;
}

/* ═══════════════ 4. Поставки ═══════════════ */
function mapHTML(){
  const R=SUPPLY.mapRows;
  const conn=(x1,y1,x2,y2,cls)=>{const dx=x2-x1,dy=y2-y1,d=Math.round(Math.hypot(dx,dy)),a=(Math.atan2(dy,dx)*180/Math.PI).toFixed(1);return `<div class="map-connection ${cls}" style="width:${d}px;left:${x1}px;top:${y1}px;transform:rotate(${a}deg)"></div>`;};
  let h='<div class="map-inner">';
  R.forEach(row=>{h+=`<div class="map-row-label" style="top:${row.y+30}px">${row.label}</div>`;});
  R[0].nodes.forEach((s,i)=>{const p=R[1].nodes[i%R[1].nodes.length];h+=conn(s.x+35,R[0].y+30,p.x+35,R[1].y+30,'rail');});
  R[1].nodes.forEach((p,i)=>{const w=R[2].nodes[i];if(w)h+=conn(p.x+35,R[1].y+30,w.x+35,R[2].y+30,'auto');});
  R[2].nodes.forEach((w,i)=>{const c3=R[3].nodes[i*2]||R[3].nodes[0];h+=conn(w.x+35,R[2].y+30,c3.x+35,R[3].y+30,(w.r||c3.r)?'restricted':'auto');});
  R.forEach(row=>{row.nodes.forEach(n=>{const nm=n.n.split('|').join(' ');
    h+=`<div class="map-node${n.r?' restricted':''}" style="left:${n.x}px;top:${row.y}px" title="${esc(nm)}${n.r?' | Ограничение: '+esc(n.r):''}"><div class="node-icon">${n.icon}</div><div class="node-name">${n.n.split('|').join('<br>')}</div>${n.r?`<div class="restriction-badge">${n.r}</div>`:''}</div>`;});});
  return h+'</div>';
}
const fmtM1=v=>Number(v).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1}).replace('-','−');
function hmCell(cell,mode,scen){
  const obj=cell&&typeof cell==='object',v=obj?cell.v:cell,good=obj&&cell.good;
  if(scen==='A'){
    if(v==null)return `<td class="hm-cell ${mode==='cov'?'hm-0':'hm-m-na'}">—</td>`;
    const cls=mode==='cov'?(v>=100?'hm-100':v>=90?'hm-90':v>=80?'hm-80':v>=70?'hm-70':v>=60?'hm-60':v>=50?'hm-50':v>=40?'hm-40':v>=30?'hm-30':'hm-0')
      :(v>10?'hm-m-high':v>=5?'hm-m-good':v>=3?'hm-m-mid':v>=1.5?'hm-m-low':v>=0.5?'hm-m-vlow':v>=0?'hm-m-minimal':'hm-m-loss');
    return `<td class="hm-cell ${cls}">${mode==='cov'?v+'%':fmtM1(v)}</td>`;
  }
  if(v==null)return `<td class="hm-cell hm-delta-zero">—</td>`;
  if(v===0)return `<td class="hm-cell hm-delta-zero">0${mode==='cov'?'%':''}</td>`;
  const txt=(v>0?'+':'−')+(mode==='cov'?Math.abs(v):fmtM1(Math.abs(v)))+(mode==='cov'?'%':'');
  if(good)return `<td class="hm-cell hm-delta-neg hm-delta-neg-good">${txt} ✓</td>`;
  return `<td class="hm-cell ${v>0?'hm-delta-pos':'hm-delta-neg'}">${txt}</td>`;
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
function vSupply(){
  const S=SUPPLY;
  const gap=S.gap.rows.map(r=>r.div?'<div class="gap-divider"></div>':`<div class="gap-row"><div class="gap-label${r.main?' main':''}">${r.label}</div><div class="gap-bar-bg"><div class="gap-bar" style="width:${r.w}%;background:${r.c}"></div></div><div class="gap-val${r.main?' main':''}" style="color:${r.c}">${r.value}${r.pct?` <small>${r.pct}</small>`:''}</div></div>`).join('');
  J('#c-constr','hbar',[{data:S.constraints.data,pointColors:S.constraints.colors,color:'#D93025'}],S.constraints.labels,{height:220});
  J('#c-radar','radar',S.radar.series.map(([n,d,c])=>({data:d,color:c})),S.radar.axes,{height:380,legend:S.radar.series.map(x=>x[0]),max:120});
  const F=S.fan;
  J('#c-fan','band',[
    {data:F.best,color:'#20A7C9'},
    {data:F.base,color:'#1a2b4a'},
    {data:F.worst,color:'#8c9bae'},
  ],F.labels,{height:340,legend:['Лучший (+18%, маржа 25,8%)','Базовый (маржа 24,0%)','Худший (−12%, маржа 19,5%)'],yTitle:'Объем (тыс. кЛ)'});
  const fanRows=F.labels.map((m,i)=>[m,String(F.worst[i]),String(F.base[i]),String(F.best[i]),F.marginWorst[i],'24,0%',F.marginBest[i],F.drivers[i]]);
  const scenCards=S.scenarios.map(s=>`<article class="scen scen-${s.cls}"><h4>${s.title}</h4><div class="scen-desc">${s.desc}</div>${s.metrics.map(([k,v,c])=>`<div class="scen-metric"><span>${k}</span><b class="${c}">${v}</b></div>`).join('')}</article>`).join('');
  const hs=ui.hmscen??'A',hm=ui.hmmode??'cov';
  const methKey=(hs==='A'?'A':'B')+(hm==='cov'?'cov':'mrg');
  const heatmapHtml=sw('hmscen',[['A','Сценарий А (Базовый)'],['B','Сценарий Б (Максимальный)'],['C','Сценарий В (Маржинальный)']])
    +sw('hmmode',[['cov','Покрытие спроса (%)'],['mrg','Валовая маржа (млн руб.)']])
    +(hs!=='A'?info('primary',S.kpiNote):'')
    +info('primary',S.heatmapMethodology[methKey])
    +hmTable(hs,hm)
    +`<div class="hm-legend">${hs==='A'?S.heatmapLegends[hm]:S.heatmapLegends.delta}</div>`
    +insight(hs==='A'?S.heatmapInsights[hm]:S.heatmapInsights.delta)
    +tbl('tbl-heatmap',HEATMAP.flatTable.heads,HEATMAP.flatTable.rows);
  return kpis('supply')
    +card('🏭 Карта цепочки поставок и ограничений',info('primary',S.mapDesc)+`<div class="supplymap">${mapHTML()}</div>`
      +`<div class="info info-danger"><b>🔴 Ключевые ограничения цепочки (итого −100 тыс. кЛ):</b><div class="constr-grid">${S.mapConstraints.map(([i,t,d])=>`<div>${i} <b>${t}</b> ${d}</div>`).join('')}</div></div>`
      +tbl('tbl-supply-map',S.mapTable.heads,S.mapTable.rows))
    +card('📊 Базовый сценарий покрытия спроса',info('primary',S.gap.methodology)+`<div class="gap-chart">${gap}</div>`
      +info('danger',`<b class="gap-break">⚠️ РАЗРЫВ: 50 тыс. кЛ</b><br>${S.gap.reasons}`)
      +tbl('tbl-gap',S.gap.table.heads,S.gap.table.rows))
    +card('📊 Детализация ограничений',canvas('c-constr','Горизонтальная диаграмма ограничений цепочки')+insight(S.constraints.insight)+tbl('tbl-constr',S.constraints.heads,S.constraints.rows))
    +`<h3 class="section-h">🎯 Сценарии покрытия спроса</h3><div class="grid-3">${scenCards}</div>`
    +card('📊 Сравнение сценариев: объем против маржи',canvas('c-radar','Радарная диаграмма сравнения сценариев')+insight(S.radar.insight)+tbl('tbl-scen',S.radar.heads,S.radar.rows))
    +card('🌊 Сценарное планирование: лучший / базовый / худший (18 месяцев)',canvas('c-fan','Веерный график сценариев на 18 месяцев')+insight(F.insight)+tbl('tbl-fan',F.heads,fanRows))
    +card('🗺️ Тепловая карта по клиентам и продуктам (4 квартал 2026)',heatmapHtml);
}

/* ═══════════════ 5. Планы ═══════════════ */
function vPlans(){
  const q=ui.pq??'all',pl=ui.plan??'sales';
  const [a,b]=(QRANGE[q]||QRANGE.all);
  const P=PLANS[pl],cdef=P.chart(a,b);
  J('#c-plan',cdef.type,cdef.series,cdef.labels,cdef.opts);
  return kpis('plans')
    +card('📊 Планы на горизонт 18 месяцев (Окт 2026 – Мар 2028)',
      sw('pq',QUARTERS)
      +`<div class="switch">${Object.entries(PLANS).map(([id,p])=>`<button class="${pl===id?'active':''}" data-sw="plan" data-val="${id}">${p.tab}</button>`).join('')}</div>`
      +canvas('c-plan','График: '+P.tab)
      +insight(P.insight)
      +tbl('tbl-plan-'+pl,P.table.heads,P.table.rows));
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

/* ═══════════════ Качество данных ═══════════════ */
function vQuality(){
  const inv=data.filter(x=>!x.valid);
  const msg=inv.length?`Есть ${inv.length} строк с ошибками — проверьте заполненность периода и числовых полей.`:'Данные готовы к анализу.';
  const src=summ.custom?'загруженный XLSX':'демо-данные';
  return card('Качество данных',`<p class="notice">${msg} Проверено строк: ${data.length}. Источник: ${src}. Схема XLSX: Период, Тип (Факт/Прогноз), План объема, Факт объема, План выручки, Факт выручки, Цена.</p>`)
    +card('📋 Текущий набор данных',tbl('tbl-quality',['Период','Тип','План объема','Объем','План выручки','Выручка','Цена','Статус'],data.map(r=>({cells:[esc(r.period),esc(r.type),N(r.planVol),N(r.vol),NF(r.planRev),NF(r.rev),N(r.price),r.valid?'🟢 ОК':'🔴 Ошибка'],cls:r.valid?'':'dead'}))));
}

/* ═══════════════ Каркас ═══════════════ */
const VIEWS={overview:vOverview,segments:vSegments,demand:vDemand,stock:vStock,supply:vSupply,plans:vPlans,actions:vActions,quality:vQuality};
function renderContent(){
  jobs=[];
  const el=document.querySelector('#content');
  el.innerHTML=(VIEWS[tab]||vOverview)();
  jobs.forEach(([sel,...rest])=>drawChart(el.querySelector(sel),...rest));
  jobs=[];
}
function render(){
  summ=summary(data);
  const t=C.tabs.find(x=>x.id===tab)||C.tabs[0];
  document.title=C.title;
  document.querySelector('#app').innerHTML=`<div class="app"><aside class="side ${storage.get('compact',false)?'compact':''}"><div class="brand"><span class="label">${C.brand}</span><small> ${C.brandSub}</small></div><nav>${C.tabs.map(x=>`<button class="${x.id===tab?'active':''}" data-tab="${x.id}">▸ <span class="label">${x.label}</span></button>`).join('')}</nav><button id="compact" title="Положение меню">☰ <span class="label">Меню</span></button></aside><main><header class="top"><div><h1>${t.label}</h1><div class="muted">${C.subtitle} · ${summ.rows} строк данных${summ.custom?' (XLSX)':' (демо)'}</div><div class="context">${C.context.map(([k,v])=>`<span class="chip">${k}: <b>${v}</b></span>`).join('')}</div></div><div class="actions"><button id="theme">☾ Тема</button><label><button>Загрузить XLSX<input id="xlsx" type="file" accept=".xlsx,.xls" hidden></button></label><button id="reset">Сбросить</button></div></header><div id="content"></div></main></div>`;
  renderContent();
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
  const s=e.target.closest('[data-sw]');
  if(s){ui[s.dataset.sw]=s.dataset.val;renderContent();return;}
  const tg=e.target.closest('[data-toggle]');
  if(tg){const id=tg.dataset.toggle;if(open.has(id))open.delete(id);else open.add(id);
    const w=document.getElementById(id);if(w){w.classList.toggle('show');tg.textContent=w.classList.contains('show')?'📋 Скрыть данные ▲':'📋 Данные ▼';}return;}
  if(e.target.closest('#theme')){const n=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=n;storage.set('theme',n);renderContent();return;}
  if(e.target.closest('#compact')){storage.set('compact',!storage.get('compact',false));render();return;}
  if(e.target.closest('#reset')){data=MONTHLY;Object.keys(ui).forEach(k=>delete ui[k]);open.clear();render();return;}
});
document.addEventListener('change',e=>{if(e.target.id==='xlsx')readXlsx(e);});
/* перерисовка canvas при изменении ширины (дебаунс) */
let rzT=null;
window.addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(renderContent,220);});
document.documentElement.dataset.theme=storage.get('theme','light');
render();
