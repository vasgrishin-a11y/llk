/* ═══════════════ Ядро данных дашборда S&OP / IBP ═══════════════
   Единицы канонической модели:
   • объём — тонны;
   • выручка — млн руб.;
   • цена — руб/т.
   Формула связности: revenueMln = volumeTons × priceRubPerTon / 1 000 000. */

export const MONTHLY=[
  {period:'Янв 2026',type:'Факт',planVol:20000,vol:19000,planRev:170.0,rev:155.8,price:8200},
  {period:'Фев 2026',type:'Факт',planVol:25000,vol:24000,planRev:212.5,rev:196.8,price:8200},
  {period:'Мар 2026',type:'Факт',planVol:28000,vol:28000,planRev:238.0,rev:229.6,price:8200},
  {period:'Апр 2026',type:'Факт',planVol:28000,vol:28000,planRev:238.0,rev:229.6,price:8200},
  {period:'Май 2026',type:'Факт',planVol:30000,vol:30000,planRev:255.0,rev:246.0,price:8200},
  {period:'Июн 2026',type:'Факт',planVol:31000,vol:27000,planRev:263.5,rev:221.4,price:8200},
  {period:'Июл 2026',type:'Факт',planVol:27000,vol:21000,planRev:229.5,rev:172.2,price:8200},
  {period:'Авг 2026',type:'Факт',planVol:30000,vol:24000,planRev:255.0,rev:196.8,price:8200},
  {period:'Сен 2026',type:'Факт',planVol:26000,vol:24500,planRev:221.0,rev:200.9,price:8200},
  // Финальный ограниченный S&OP-план Q4: 87 500 т из 100 000 т неограниченного спроса.
  {period:'Окт 2026',type:'Прогноз',planVol:25000,vol:29000,planRev:212.5,rev:237.8,price:8200},
  {period:'Ноя 2026',type:'Прогноз',planVol:25000,vol:29250,planRev:212.5,rev:239.85,price:8200},
  {period:'Дек 2026',type:'Прогноз',planVol:25000,vol:29250,planRev:212.5,rev:239.85,price:8200},
].map(r=>({...r,valid:!!r.period&&r.planVol>=0&&r.vol>=0&&r.rev>=0}));

/* Число из ячейки: пробелы — разделители групп, запятая — десятичный разделитель */
const num=v=>{if(v==null||v==='')return 0;if(typeof v==='number')return isFinite(v)?v:0;
  let s=String(v).trim().replace(/[\s  ]/g,'');
  if(s.includes(',')&&!s.includes('.')){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0]+'.'+p[1]:s.replace(/,/g,'');}
  const n=parseFloat(s);return isFinite(n)?n:0;};
const str=v=>String(v==null?'':v).trim();

/* Схема XLSX: Период, Тип (Факт/Прогноз), План объема, Факт объема,
   План выручки, Факт выручки, Цена. Принимаются и английские названия. */
export const normalizeRows=(rows=[])=>rows.map(r=>{
  const price=num(r.price??r['Цена']??r['Средняя цена']??r['Цена, руб/т']);
  const rec={period:str(r.period??r['Период']??r['Месяц']),
    type:str(r.type??r['Тип'])||'Факт',
    planVol:num(r.planVol??r['План объема']??r['План объёма']??r['План, т']),
    vol:num(r.vol??r['Факт объема']??r['Факт объёма']??r['Объем']??r['Объём']??r['Факт/Прогноз объема']),
    planRev:num(r.planRev??r['План выручки']),
    rev:num(r.rev??r['Факт выручки']??r['Выручка']??r['Факт/Прогноз выручки']),
    price:0};
  rec.price=price||(rec.vol>0?rec.rev/rec.vol*1_000_000:0);
  rec.valid=!!rec.period&&rec.planVol>=0&&rec.vol>=0;
  return rec;});

/* Обобщённая фильтрация по совпадению ключей (period, type, …) */
export const filterData=(data,filters={})=>data.filter(x=>Object.entries(filters).every(([k,v])=>!v||x[k]===v));

/* Канонические YTD-итоги отчёта: считаются из январь–сентябрь, без ручных
   «косметических» итогов — это защищает KPI и графики от рассинхронизации. */
export const CANON={factVol:225500,factRev:1849.1};

/* Сводка по фактическим строкам — источник KPI вкладки «Обзор» */
export const summary=data=>{
  const f=data.filter(x=>x.type!=='Прогноз');
  const planVol=f.reduce((a,x)=>a+x.planVol,0),vol=data===MONTHLY?CANON.factVol:f.reduce((a,x)=>a+x.vol,0);
  const planRev=f.reduce((a,x)=>a+x.planRev,0),rev=data===MONTHLY?CANON.factRev:f.reduce((a,x)=>a+x.rev,0);
  return{rows:data.length,factRows:f.length,planVol,vol,planRev,rev,
    volPct:planVol?vol/planVol*100:0,revPct:planRev?rev/planRev*100:0,
    avgPrice:vol?rev/vol*1_000_000:0,custom:data!==MONTHLY,
    invalid:data.filter(x=>!x.valid).length};};

const N=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const signed=v=>(v>=0?'▲ +':'▼ ')+N(v,1).replace('-','−');
export const OBJ={
  N,signed,
  pct:(v,d=1)=>N(v,d)+'%',
};
