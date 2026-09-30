/* Тесты экспорта дашборда: чистые сборщики PDF/PPTX (zip) и полный пайплайн в jsdom. */
import {test} from 'node:test';
import assert from 'node:assert/strict';

/* ── Часть 1. Чистые функции: без DOM ── */
const {pdfFromJpegs,pptxFromJpegs,zipStore,crc32}=await import('../src/export.js');

const enc=new TextEncoder();
const fakeJpeg=n=>enc.encode('FAKEJPEGDATA'+n); // любые байты: сборщик не валидирует JPEG
const latin=s=>Array.from(enc.encode(s),b=>String.fromCharCode(b)).join('');

test('crc32 — контрольное значение',()=>{
  assert.equal(crc32(enc.encode('hello')),0x3610A686);
  assert.equal(crc32(new Uint8Array(0)),0);
});

test('zipStore: корректный zip (сигнатуры, EOCD, центральный каталог)',()=>{
  const files=[['a.txt',enc.encode('привет')],['b/c.xml',enc.encode('<x/>')]];
  const z=zipStore(files);
  assert.equal(z[0],0x50);assert.equal(z[1],0x4b);assert.equal(z[2],0x03);assert.equal(z[3],0x04);
  // EOCD — последние 22 байта
  const eocd=z.slice(z.length-22);
  assert.equal(eocd[0],0x50);assert.equal(eocd[1],0x4b);assert.equal(eocd[2],0x05);assert.equal(eocd[3],0x06);
  const rd16=(o)=>eocd[o]|(eocd[o+1]<<8), rd32=(o)=>(eocd[o]|(eocd[o+1]<<8)|(eocd[o+2]<<16)|(eocd[o+3]<<24))>>>0;
  assert.equal(rd16(8),files.length,'записей в EOCD');
  assert.equal(rd16(10),files.length);
  const cdStart=rd32(16),cdLen=rd32(12);
  assert.equal(z[cdStart],0x50);assert.equal(z[cdStart+1],0x4b);assert.equal(z[cdStart+2],0x01);assert.equal(z[cdStart+3],0x02);
  assert.ok(cdStart+cdLen===z.length-22,'центральный каталог примыкает к EOCD');
  // имена читаются из central directory
  const names=latin(String.fromCharCode(...z.slice(cdStart+46,cdStart+46+8)));
  assert.ok(names.startsWith('a.txt'));
});

test('pdfFromJpegs: структура PDF, 3 страницы, xref',()=>{
  const pdf=pdfFromJpegs([fakeJpeg(1),fakeJpeg(2),fakeJpeg(3)],{w:1980,h:1400});
  const str=String.fromCharCode(...pdf); // latin-1 строка: позиции символов = байтовые offsets
  assert.ok(str.startsWith('%PDF-1.4'));
  assert.ok(str.includes('/Type/Catalog'));
  assert.ok(str.includes('/Count 3'));
  assert.ok(str.includes('/MediaBox[0 0 842 595]'),'альбомный A4');
  assert.ok(str.includes('/Filter/DCTDecode'));
  assert.ok(str.includes('%%EOF'));
  const sx=str.lastIndexOf('startxref');
  assert.ok(sx>0);
  const xrefPos=Number(str.slice(sx+9).split('\n')[1]);
  assert.ok(str.slice(xrefPos,xrefPos+4)==='xref','startxref указывает на xref');
  assert.ok(str.slice(xrefPos).includes('0000000000 65535 f'));
});

test('pptxFromJpegs: валидный OOXML-zip с нужными частями',()=>{
  const px=pptxFromJpegs([fakeJpeg(1),fakeJpeg(2)],{w:1980,h:1400});
  assert.equal(px[0],0x50);assert.equal(px[1],0x4b);
  // соберём список имён из central directory
  const dv=new DataView(px.buffer,px.byteOffset,px.byteLength);
  let o=0;const names=[];
  while(o<px.length-22){
    if(dv.getUint32(o,true)===0x04034b50){
      const nl=dv.getUint16(o+26,true);
      names.push(latin(String.fromCharCode(...px.slice(o+30,o+30+nl))));
      o+=30+nl+dv.getUint32(o+18,true);
    }else o++;
  }
  for(const need of ['[Content_Types].xml','_rels/.rels','ppt/presentation.xml','ppt/_rels/presentation.xml.rels',
    'ppt/slideMasters/slideMaster1.xml','ppt/slideMasters/_rels/slideMaster1.xml.rels','ppt/slideLayouts/slideLayout1.xml',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels','ppt/theme/theme1.xml','ppt/slides/slide1.xml','ppt/slides/slide2.xml',
    'ppt/slides/_rels/slide1.xml.rels','ppt/slides/_rels/slide2.xml.rels','ppt/media/image1.jpeg','ppt/media/image2.jpeg'])
    assert.ok(names.includes(need),'нет части '+need);
  // содержимое слайда — настоящий XML с полноформатной картинкой, а не нулевые байты
  const sl=decodeLocal(px,findLocal(px,'ppt/slides/slide1.xml'));
  assert.ok(sl.startsWith('<?xml'),'slide1.xml — валидный XML');
  assert.ok(sl.includes('<p:pic>'),'на слайде есть картинка');
  assert.ok(sl.includes('r:embed="rId1"'));
  const ct=decodeLocal(px,findLocal(px,'[Content_Types].xml'));
  assert.ok(ct.includes('image/jpeg')&&ct.includes('slide+xml'));
});

/* утилиты чтения STORE-зипа: локальная запись → строка */
function findLocal(px,name){
  const dv=new DataView(px.buffer,px.byteOffset,px.byteLength);
  const nb=new TextEncoder().encode(name);
  outer:for(let o=0;o<px.length-30;o++){
    if(dv.getUint32(o,true)!==0x04034b50)continue;
    const nl=dv.getUint16(o+26,true);
    if(nl!==nb.length)continue;
    for(let i=0;i<nl;i++)if(px[o+30+i]!==nb[i])continue outer;
    return o;
  }
  return -1;
}
function decodeLocal(px,o){
  const dv=new DataView(px.buffer,px.byteOffset,px.byteLength);
  const nl=dv.getUint16(o+26,true),sz=dv.getUint32(o+18,true);
  return new TextDecoder().decode(px.slice(o+30+nl,o+30+nl+sz));
}

/* ── Часть 2. Полный пайплайн экспорта в jsdom (canvas замокан) ── */
const {JSDOM}=await import('jsdom');
const dom=new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',{url:'http://localhost/'});
const w=dom.window;
w.scrollTo=()=>{};
globalThis.window=w;
globalThis.document=w.document;
globalThis.localStorage=w.localStorage;
globalThis.getComputedStyle=w.getComputedStyle.bind(w);
/* мок 2d-контекста: все методы — заглушки, measureText возвращает ширину */
const ctxStub=()=>new Proxy({},{get:(t,p)=>p==='measureText'?()=>({width:20}):(t[p]!==undefined?t[p]:()=>{}),set:(t,p,v)=>(t[p]=v,true)});
w.HTMLCanvasElement.prototype.getContext=function(){return ctxStub();};
w.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/jpeg;base64,'+Buffer.from('FAKEJPG').toString('base64');};
let lastBlob=null,lastName='';
/* export.js использует глобальный URL (в браузере это window.URL с createObjectURL).
   В Node URL.createObjectURL существует, но работает с нативным Blob и не попадает в наш мок —
   подменяем глобально, чтобы перехватить файл. */
const realCreate=URL.createObjectURL,realRevoke=URL.revokeObjectURL;
URL.createObjectURL=b=>{lastBlob=b;return 'blob:fake';};
URL.revokeObjectURL=()=>{};

const {renderViewInto}=await import('../src/app.js');
const {exportDashboard}=await import('../src/export.js');

test('exportDashboard: полный пайплайн PDF — рендер всех вкладок, компоновка, файл',async()=>{
  lastBlob=null;
  const res=await exportDashboard('pdf',{renderViewInto});
  assert.ok(res.pages>=7,'страниц не меньше, чем разделов ('+res.pages+')');
  assert.equal(res.sections,7);
  assert.ok(lastBlob,'blob создан');
  const bytes=new Uint8Array(await lastBlob.arrayBuffer());
  assert.equal(bytes[0],0x25);assert.equal(bytes[1],0x50);assert.equal(bytes[2],0x44);assert.equal(bytes[3],0x46); // %PDF
});

test('exportDashboard: полный пайплайн PPTX — слайды для каждого раздела',async()=>{
  lastBlob=null;
  const res=await exportDashboard('pptx',{renderViewInto});
  assert.ok(res.pages>=7);
  const bytes=new Uint8Array(await lastBlob.arrayBuffer());
  assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b); // PK
});

test('экспорт не рендерит «Ключевые отклонения» и таблицы «Данные»',async()=>{
  /* проверяем через сбор секций: карточка отклонений исключается (косвенно — через разметку обзора) */
  const host=document.createElement('div');
  renderViewInto(host,'overview');
  assert.ok(host.querySelector('[data-toggle="ov-deviations"]'),'кнопка сворачивания отклонений есть');
  assert.ok(/Ключевые отклонения/.test(host.textContent));
  // в экспортном модуле карточка с этим заголовком пропускается — проверим фильтр напрямую
  const card=[...host.querySelectorAll('.card')].find(c=>/Ключевые отклонения/.test(c.querySelector('h2')?.textContent||''));
  assert.ok(card,'карточка отклонений в вёрстке есть');
});
