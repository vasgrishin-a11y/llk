#!/usr/bin/env node
/* ═══════════════ Markdown-выгрузка → CSV ═══════════════
   Разбирает готовый файл exports/In.Plan_IBP_данные_окт-2026.md на таблицы
   и раскладывает их в отдельные CSV-файлы (по одному на таблицу), плюс:

     • _index.csv        — оглавление: какой файл какой таблице соответствует;
     • _all_tables.csv   — все таблицы одним «длинным» CSV (section, table, row, column, value).

   Формат CSV: разделитель «;», кодировка UTF-8 с BOM — так файлы корректно
   открываются в русском Excel сразу двойным щелчком (десятичный разделитель
   в данных — запятая, поэтому разделитель полей именно точка с запятой).
   Если нужен стандартный вариант — запустите с флагом --comma.

   Запуск:  node tools/csv-from-markdown.mjs [файл.md] [каталог-вывода]
   По умолчанию: exports/In.Plan_IBP_данные_окт-2026.md → exports/csv */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const COMMA=process.argv.includes('--comma');
const SRC=args[0]?path.resolve(process.cwd(),args[0]):path.join(ROOT,'exports','In.Plan_IBP_данные_окт-2026.md');
const DIR=args[1]?path.resolve(process.cwd(),args[1]):path.join(ROOT,'exports','csv');
const SEP=COMMA?',':';';

/* ═══════════════ Разбор Markdown ═══════════════ */
const md=fs.readFileSync(SRC,'utf8');
const lines=md.split('\n');

const TRANSLIT={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c',
  'ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
const slug=s=>String(s).toLowerCase()
  .replace(/[а-яё]/g,ch=>TRANSLIT[ch]??'')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'table';

/* Заголовок — последняя строка вида «# / ## / ### / #### …» перед таблицей */
const headingAt=i=>{
  for(let k=i;k>=0;k--){
    const m=/^#{1,4}\s+(.*)$/.exec(lines[k]);
    if(m)return m[1].trim();
  }
  return 'Без раздела';
};
const cleanCell=s=>String(s).trim()
  .replace(/\\\|/g,'|')
  .replace(/\*\*(.*?)\*\*/g,'$1')
  .replace(/^\*|\*$/g,'')
  .trim();
const splitRow=line=>{
  // разбор по «|» с учётом экранирования «\|»
  const body=line.replace(/^\s*\|/,'').replace(/\|\s*$/,'');
  const cells=[];let cur='';
  for(let i=0;i<body.length;i++){
    const c=body[i];
    if(c==='\\'&&body[i+1]==='|'){cur+='|';i++;continue;}
    if(c==='|'){cells.push(cur);cur='';continue;}
    cur+=c;
  }
  cells.push(cur);
  return cells.map(cleanCell);
};

/* ═══════════════ Сбор таблиц ═══════════════ */
const tables=[];
let i=0;
while(i<lines.length){
  if(!lines[i].startsWith('|')){i++;continue;}
  const head=splitRow(lines[i]);
  const sep=lines[i+1]||'';
  if(!/^\s*\|[\s:|-]+\|\s*$/.test(sep)){i++;continue;}   // это не таблица
  const rows=[];let j=i+2;
  while(j<lines.length&&lines[j].startsWith('|')){rows.push(splitRow(lines[j]));j++;}
  tables.push({section:headingAt(i),heads:head,rows,line:i+1});
  i=j;
}

/* ═══════════════ Запись CSV ═══════════════ */
const csvCell=v=>{
  const s=String(v==null?'':v);
  return /["\n\r]|^\s|\s$/.test(s)||s.includes(SEP)?'"'+s.replace(/"/g,'""')+'"':s;
};
const csvLine=arr=>arr.map(csvCell).join(SEP);
const BOM='\uFEFF';                       // Excel корректно читает UTF-8
const writeCsv=(file,rows)=>fs.writeFileSync(file,BOM+rows.map(csvLine).join('\r\n')+'\r\n','utf8');

fs.rmSync(DIR,{recursive:true,force:true});
fs.mkdirSync(DIR,{recursive:true});

const indexRows=[['№','CSV-файл','Раздел','Таблица (колонки)','Строк данных','Строка в .md']];
const longRows=[['section','table','table_file','row','column','value']];
const used=new Map();

tables.forEach((t,n)=>{
  const base=String(n+1).padStart(3,'0')+'_'+slug(t.section);
  const seen=(used.get(base)||0)+1;used.set(base,seen);
  const file=seen>1?base+'_'+seen+'.csv':base+'.csv';
  writeCsv(path.join(DIR,file),[t.heads,...t.rows]);
  const title=t.heads.join(' · ');
  indexRows.push([n+1,file,t.section,title,t.rows.length,t.line]);
  t.rows.forEach((r,ri)=>r.forEach((v,ci)=>longRows.push([t.section,title,file,ri+1,t.heads[ci]??('Колонка '+(ci+1)),v])));
});
writeCsv(path.join(DIR,'_index.csv'),indexRows);
writeCsv(path.join(DIR,'_all_tables.csv'),longRows);

/* ═══════════════ ZIP с готовыми CSV ═══════════════ */
const zipPath=path.join(path.dirname(DIR),'In.Plan_IBP_данные_csv.zip');
let zipNote='';
try{
  fs.rmSync(zipPath,{force:true});
  execFileSync('zip',['-q','-r','-X',zipPath,'.'],{cwd:DIR});
  zipNote=' + архив '+(path.basename(zipPath))+' ('+(fs.statSync(zipPath).size/1024).toFixed(0)+' КБ)';
}catch(e){
  zipNote=' (утилита zip недоступна — файлы CSV лежат в '+path.relative(ROOT,DIR)+')';
}

const total=tables.reduce((a,t)=>a+t.rows.length,0);
console.log('✔ CSV готовы: '+path.relative(ROOT,DIR)+'/ — '+tables.length+' таблиц, '+total+' строк данных'
  +zipNote+'. Разделитель: "'+SEP+'", кодировка UTF-8 с BOM.');
console.log('  Оглавление: '+path.join(path.relative(ROOT,DIR),'_index.csv')
  +' · все таблицы одним файлом: '+path.join(path.relative(ROOT,DIR),'_all_tables.csv'));
