/* ═══════════════ Ядро данных дашборда ОППиУ «Лубри-Тех» ═══════════════
   MONTHLY — основной помесячный датасет (объём/выручка/цена, план и факт),
   который можно заменить загрузкой XLSX (см. normalizeRows). Остальные
   отчётные датасеты (сегментация, сценарии, планы и т.д.) — в src/datasets.js. */

export const MONTHLY=[
  {period:'Янв 2026',type:'Факт',planVol:100,vol:95,planRev:38,rev:36.5,price:384},
  {period:'Фев 2026',type:'Факт',planVol:100,vol:98,planRev:38,rev:36.9,price:377},
  {period:'Мар 2026',type:'Факт',planVol:100,vol:102,planRev:38,rev:36.1,price:354},
  {period:'Апр 2026',type:'Факт',planVol:100,vol:100,planRev:38,rev:35.7,price:357},
  {period:'Май 2026',type:'Факт',planVol:100,vol:105,planRev:38,rev:36.5,price:348},
  {period:'Июн 2026',type:'Факт',planVol:100,vol:108,planRev:38,rev:36.1,price:334},
  {period:'Июл 2026',type:'Факт',planVol:100,vol:110,planRev:38,rev:35.7,price:325},
  {period:'Авг 2026',type:'Факт',planVol:100,vol:107,planRev:38,rev:35.3,price:330},
  {period:'Сен 2026',type:'Факт',planVol:100,vol:103,planRev:38,rev:35.7,price:347},
  {period:'Окт 2026',type:'Прогноз',planVol:100,vol:101,planRev:38,rev:36.2,price:358},
  {period:'Ноя 2026',type:'Прогноз',planVol:100,vol:100,planRev:38,rev:36,price:360},
  {period:'Дек 2026',type:'Прогноз',planVol:100,vol:102,planRev:38,rev:36.8,price:361},
].map(r=>({...r,valid:!!r.period&&r.planVol>0&&r.vol>0&&r.rev>0}));

/* Число из ячейки: пробелы — разделители групп, запятая — десятичный разделитель */
const num=v=>{if(v==null||v==='')return 0;if(typeof v==='number')return isFinite(v)?v:0;
  let s=String(v).trim().replace(/[\s  ]/g,'');
  if(s.includes(',')&&!s.includes('.')){const p=s.split(',');s=p.length===2&&p[1].length<=2?p[0]+'.'+p[1]:s.replace(/,/g,'');}
  const n=parseFloat(s);return isFinite(n)?n:0;};
const str=v=>String(v==null?'':v).trim();

/* Схема XLSX: Период, Тип (Факт/Прогноз), План объема, Факт объема,
   План выручки, Факт выручки, Цена. Принимаются и английские названия. */
export const normalizeRows=(rows=[])=>rows.map(r=>{
  const price=num(r.price??r['Цена']??r['Средняя цена']);
  const rec={period:str(r.period??r['Период']??r['Месяц']),
    type:str(r.type??r['Тип'])||'Факт',
    planVol:num(r.planVol??r['План объема']??r['План объёма']??r['План, тыс. кЛ']),
    vol:num(r.vol??r['Факт объема']??r['Факт объёма']??r['Объем']??r['Объём']),
    planRev:num(r.planRev??r['План выручки']),
    rev:num(r.rev??r['Факт выручки']??r['Выручка']),
    price:0};
  rec.price=price||(rec.vol>0?rec.rev/rec.vol*1000:0);
  rec.valid=!!rec.period&&rec.planVol>=0&&rec.vol>=0;
  return rec;});

/* Обобщённая фильтрация по совпадению ключей (period, type, …) */
export const filterData=(data,filters={})=>data.filter(x=>Object.entries(filters).every(([k,v])=>!v||x[k]===v));

/* Канонические итоги годового отчёта (янв–сен): помесячные ряды отчёта —
   округлённые индексы динамики, официальный YTD зафиксирован в KPI отдельно */
export const CANON={factVol:880,factRev:320.5};

/* Сводка по фактическим строкам — источник KPI вкладки «Обзор» */
export const summary=data=>{
  const f=data.filter(x=>x.type!=='Прогноз');
  const planVol=f.reduce((a,x)=>a+x.planVol,0),vol=data===MONTHLY?CANON.factVol:f.reduce((a,x)=>a+x.vol,0);
  const planRev=f.reduce((a,x)=>a+x.planRev,0),rev=data===MONTHLY?CANON.factRev:f.reduce((a,x)=>a+x.rev,0);
  return{rows:data.length,factRows:f.length,planVol,vol,planRev,rev,
    volPct:planVol?vol/planVol*100:0,revPct:planRev?rev/planRev*100:0,
    avgPrice:vol?rev/vol*1000:0,custom:data!==MONTHLY,
    invalid:data.filter(x=>!x.valid).length};};

const N=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const signed=v=>(v>=0?'▲ +':'▼ ')+N(v,1).replace('-','−');
export const OBJ={
  N,signed,
  pct:(v,d=1)=>N(v,d)+'%',
};
