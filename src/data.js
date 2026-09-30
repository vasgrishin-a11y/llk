/* ═══════════════ Ядро данных дашборда S&OP / IBP ═══════════════
   Единицы канонической модели:
   • объём — тонны;
   • выручка — млн руб.;
   • цена — руб/т.
   Формула связности: revenueMln = volumeTons × priceRubPerTon / 1 000 000.
   Масштаб 2025–2026: производство ~527 тыс. т, выручка ~75 млрд руб. */

export const MONTHLY=[
  {period:'Янв 2026',type:'Факт',planVol:41000,vol:39500,planRev:5904.0,rev:5589.3,price:141500},
  {period:'Фев 2026',type:'Факт',planVol:46000,vol:45000,planRev:6624.0,rev:6367.5,price:141500},
  {period:'Мар 2026',type:'Факт',planVol:48000,vol:47500,planRev:6912.0,rev:6721.3,price:141500},
  {period:'Апр 2026',type:'Факт',planVol:47000,vol:46200,planRev:6768.0,rev:6537.3,price:141500},
  {period:'Май 2026',type:'Факт',planVol:49000,vol:48300,planRev:7056.0,rev:6834.5,price:141500},
  {period:'Июн 2026',type:'Факт',planVol:50000,vol:46500,planRev:7200.0,rev:6579.8,price:141500},
  {period:'Июл 2026',type:'Факт',planVol:44000,vol:35500,planRev:6336.0,rev:5023.3,price:141500},
  {period:'Авг 2026',type:'Факт',planVol:47000,vol:39800,planRev:6768.0,rev:5631.7,price:141500},
  {period:'Сен 2026',type:'Факт',planVol:43000,vol:41700,planRev:6192.0,rev:5900.6,price:141500},
  // 4 кв. 2026 показан прогнозом S&OP ПРЕДЫДУЩЕГО цикла (сентябрь 2026): 127 500 т / 17 977,5 млн руб.
  // Новый цикл S&OP (вкладки «Спрос» → «Поставки» → «Планы») формирует сценарий В: 129 000 т / 18 255 млн руб. (примерно на 3% ниже сценария А)
  {period:'Окт 2026',type:'Прогноз',planVol:44000,vol:42000,planRev:6336.0,rev:5922.0,price:141000},
  {period:'Ноя 2026',type:'Прогноз',planVol:44000,vol:43000,planRev:6336.0,rev:6063.0,price:141000},
  {period:'Дек 2026',type:'Прогноз',planVol:43000,vol:42500,planRev:6192.0,rev:5992.5,price:141000},
].map(r=>({...r,valid:!!r.period&&r.planVol>=0&&r.vol>=0&&r.rev>=0}));

/* Число из ячейки: пробелы — разделители групп, запятая — десятичный разделитель */
const num=v=>{if(v==null||v==='')return 0;if(typeof v==='number')return isFinite(v)?v:0;
  let s=String(v).trim().replace(/[\s  ]/g,'');
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
export const CANON={factVol:390000,factRev:55185};

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
