/* ═══════════════ Экспорт дашборда в PDF / PPTX (альбомный формат) ═══════════════
   Подход без внешних библиотек:
   1. Все 7 вкладок рендерятся в скрытый контейнер (канвасы графиков рисуются
      штатным движком src/charts.js), SVG-схема цепочки сериализуется в <img>.
   2. Страницы (A4 landscape) компонуются на canvas: шапка раздела, KPI-карточки,
      1–3 графика на страницу (большие — по одному), выводы. Таблицы «📋 Данные»
      и блок «Ключевые отклонения» в экспорт не попадают.
   3. PDF собирается вручную (страницы = JPEG DCTDecode), PPTX — минимальный
      OOXML-пакет (zip без сжатия), где каждый слайд — полноформатное изображение.
   Экспортируемые функции pdfFromJpegs / pptxFromJpegs / zip чистые и тестируемые. */
import {DASHBOARD_CONFIG as C} from './config.js';
import {SEGMENTS, ACTIONS} from './datasets.js';

const PAGE_W=1980, PAGE_H=1400;          // A4 landscape ≈ 1.414
const MARGIN=56, HEADER_H=132, FOOTER_H=40;
const CONTENT_W=PAGE_W-MARGIN*2;
const INNER_H=PAGE_H-HEADER_H-FOOTER_H-MARGIN*0.5;
const GAP=22;
const FONT="'Open Sans','Segoe UI',Arial,sans-serif";
const INK='#1a2b4a', MUTED='#64748b', LINE='#dbe4ef', ACCENT='#7c3aed';

/* ─────────── общие утилиты ─────────── */
const b64ToBytes=b64=>{
  const bin=atob(b64); const u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  return u8;
};
const dataUrlBytes=url=>b64ToBytes(String(url).split(',')[1]||'');
const stripTags=html=>{const d=document.createElement('div');d.innerHTML=html==null?'':html;return (d.textContent||'').replace(/\s+/g,' ').trim();};
const nfmt=v=>Number(v||0).toLocaleString('ru-RU');
let measureCtx=null;
const mctx=()=>{if(!measureCtx){const c=document.createElement('canvas');measureCtx=c.getContext('2d');}return measureCtx;};
function wrapLines(text,maxW,font,limit=99){
  const ctx=mctx();ctx.font=font;
  const words=String(text||'').split(' ');const lines=[];let cur='';
  for(const w of words){
    const t=cur?cur+' '+w:w;
    if(ctx.measureText(t).width<=maxW||!cur)cur=t;
    else{lines.push(cur);cur=w;if(lines.length>=limit)break;}
  }
  if(cur&&lines.length<limit)lines.push(cur);
  if(lines.length>=limit&&words.length>lines.join(' ').split(' ').length)lines[limit-1]+='…';
  return lines;
}
function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

/* ─────────── 1. Сбор контента вкладок ─────────── */
function svgToImage(svg){
  return new Promise(res=>{
    let done=false;
    const finish=v=>{if(!done){done=true;res(v);}};
    const timer=setTimeout(()=>finish(null),2500); // страховка от незагрузившегося SVG
    try{
      const xml=new XMLSerializer().serializeToString(svg);
      const url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}));
      const img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);clearTimeout(timer);finish(img);};
      img.onerror=()=>{URL.revokeObjectURL(url);clearTimeout(timer);finish(null);};
      img.src=url;
    }catch(e){clearTimeout(timer);finish(null);}
  });
}
const chartGeom=cv=>{
  /* host экспорта — 1400px; при отсутствии layout-информации (jsdom/скрытый рендер)
     считаем канвас во всю ширину host, как в реальном браузере */
  const w=cv.clientWidth||parseFloat(cv.style.width)||1400;
  const h=parseFloat(cv.style.height)||280;
  return {w,h,ratio:h/w};
};
/* Собираем структурное описание раздела из скрытого рендера.
   Исключаем: карточку «Ключевые отклонения», таблицы «📋 Данные», тепловые карты. */
async function collectSections(renderViewInto){
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-30000px;top:0;visibility:hidden;pointer-events:none;width:1400px;z-index:-1';
  document.body.appendChild(host);
  const sections=[];
  try{
    for(const t of C.tabs){
      renderViewInto(host,t.id);
      await new Promise(r=>setTimeout(r,10));
      const sec={title:t.label,desc:t.desc||'',kpis:[],blocks:[]};
      host.querySelectorAll('.kpis .kpi').forEach(k=>{
        const dev=k.querySelector('.dev');
        sec.kpis.push({label:(k.querySelector('.kpi-label')||{}).textContent||'',
          value:(k.querySelector('.value')||{}).textContent||'',
          sub:(k.querySelector('.kpi-sub')||{}).textContent||'',
          dev:dev?dev.textContent:'',devKind:dev?/dev-pos/.test(dev.className)?'pos':/dev-neg/.test(dev.className)?'neg':'neu':''});
      });
      let insightUsed=false;
      for(const card of host.querySelectorAll('.card')){
        const h=(card.querySelector('h2')||{}).textContent||'';
        if(/Ключевые отклонения/.test(h))continue;                     // исключено по требованию
        const insEl=card.querySelector('.insight');
        const insight=insEl?stripTags(insEl.innerHTML):'';
        const infoEl=card.querySelector('.info');
        const note=insight||(infoEl?stripTags(infoEl.innerHTML):'');
        if(/Сегментация клиентов/.test(h)){sec.blocks.push({kind:'segmatrix',caption:h,insight:note});insightUsed=true;continue;}
        if(/План действий/.test(h)){sec.blocks.push({kind:'actions',caption:h});continue;}
        const svg=card.querySelector('svg.cg-svg');
        if(svg){const img=await svgToImage(svg);if(img){const vb=svg.viewBox.baseVal;sec.blocks.push({kind:'chart',big:true,caption:h,src:img,ratio:vb&&vb.height?vb.height/vb.width:0.62,insight:note});insightUsed=true;continue;}}
        const minis=[];
        let first=true;
        for(const cv of card.querySelectorAll('canvas.chart')){
          if(/^c-mini/.test(cv.id)){minis.push({caption:(cv.closest('article')?.querySelector('h5')||{}).textContent||'',src:cv,geom:chartGeom(cv)});continue;}
          const g=chartGeom(cv);
          sec.blocks.push({kind:'chart',big:g.h>=400,caption:h,src:cv,ratio:g.ratio,insight:first?note:''});
          insightUsed=insightUsed||first;first=false;
        }
        if(minis.length)sec.blocks.push({kind:'minis',caption:h,items:minis,insight:''});
        /* карточки без графиков: полезный текст (вехи, результаты, решение, выводы) */
        if(!card.querySelector('canvas.chart')&&!svg&&!/Сегментация клиентов|План действий/.test(h)){
          const texts=[...card.querySelectorAll('.info,.result,.sy-note,.decision')].map(el=>stripTags(el.innerHTML)).filter(Boolean);
          const sy=card.querySelector('.scen-year');
          if(sy)texts.unshift(stripTags(sy.innerHTML));
          if(texts.length)sec.blocks.push({kind:'text',caption:h,lines:texts});
        }
      }
      if(sec.kpis.length||sec.blocks.length)sections.push(sec);
    }
  }finally{host.remove();}
  return sections;
}

/* ─────────── 2. Компоновка страниц (1–3 графика, большие — по одному) ─────────── */
function insightH(text){
  if(!text)return 0;
  const lines=wrapLines(text,CONTENT_W-72,'400 24px '+FONT,8);
  return 26+lines.length*32+18;
}
function atomHeight(a){
  if(a.kind==='kpis'){const rows=Math.ceil(a.items.length/4);return rows*168+(rows-1)*GAP;}
  if(a.kind==='chart'){return 48+Math.min(Math.round(CONTENT_W*a.ratio),900)+(a.insight?insightH(a.insight):0);}
  if(a.kind==='minis')return 48+2*176+GAP;
  if(a.kind==='segmatrix')return 48+5*170;
  if(a.kind==='actions')return 48+44+10*66;
  if(a.kind==='text'){return 48+a.lines.reduce((s,l)=>s+wrapLines(l,CONTENT_W-72,'400 24px '+FONT,6).length*32+20,0);}
  return 0;
}
function layoutPages(sections){
  const pages=[];
  const fresh=sec=>{const p={sec,used:0,charts:0,big:false,items:[]};pages.push(p);return p;};
  for(const sec of sections){
    let page=null;
    const atoms=[];
    if(sec.kpis.length)atoms.push({kind:'kpis',items:sec.kpis});
    atoms.push(...sec.blocks);
    for(const a of atoms){
      if(!page)page=fresh(sec);
      const isChart=a.kind==='chart'||a.kind==='minis'||a.kind==='segmatrix';
      let h=atomHeight(a);
      /* большой график — один на странице; не более 3 графиков на странице */
      if(isChart&&((a.big&&page.charts>0)||(page.big&&page.charts>0)||page.charts>=3)){page=fresh(sec);}
      let avail=INNER_H-page.used;
      if(h>avail&&page.items.length>0){page=fresh(sec);avail=INNER_H;}
      if(h>avail){ /* масштабируем график под оставшееся место */
        a=Object.assign({},a,{scaledH:Math.max(320,avail-48-(a.insight?insightH(a.insight):0))});
        h=atomHeight(a);
      }
      page.items.push(a);page.used+=h+GAP;
      if(isChart){page.charts++;if(a.big)page.big=true;}
    }
  }
  return pages.filter(p=>p.items.length);
}

/* ─────────── 3. Отрисовка страницы ─────────── */
function drawKpis(ctx,items,y){
  const per=4,cw=(CONTENT_W-3*GAP)/per,chh=150;
  items.forEach((k,i)=>{
    const row=Math.floor(i/per),col=i%per;
    const x=MARGIN+col*(cw+GAP),yy=y+row*(chh+GAP);
    ctx.fillStyle='#f7f8fc';rr(ctx,x,yy,cw,chh,14);ctx.fill();
    ctx.strokeStyle=LINE;ctx.lineWidth=2;rr(ctx,x,yy,cw,chh,14);ctx.stroke();
    ctx.textAlign='left';
    ctx.fillStyle=MUTED;ctx.font='600 21px '+FONT;
    const lbl=wrapLines(k.label,cw-44,'600 21px '+FONT,1)[0]||'';
    ctx.fillText(lbl,x+22,yy+36);
    ctx.fillStyle=INK;ctx.font='700 44px '+FONT;ctx.fillText(k.value,x+22,yy+88);
    ctx.fillStyle=MUTED;ctx.font='400 21px '+FONT;
    wrapLines(k.sub,cw-44,'400 21px '+FONT,2).forEach((l,j)=>ctx.fillText(l,x+22,yy+118+j*26));
    if(k.dev){
      const good=k.devKind==='pos',bad=k.devKind==='neg';
      ctx.font='700 19px '+FONT;const tw=ctx.measureText(k.dev).width;
      ctx.fillStyle=good?'#e6f4ea':bad?'#fdeaea':'#fdf3e2';
      rr(ctx,x+22,yy+chh-34,tw+26,26,13);ctx.fill();
      ctx.fillStyle=good?'#137333':bad?'#D93025':'#b26a00';
      ctx.fillText(k.dev,x+35,yy+chh-15);
    }
  });
  return y+Math.ceil(items.length/per)*(chh+GAP)-GAP;
}
function drawInsightBox(ctx,text,y){
  if(!text)return y;
  const lines=wrapLines(text,CONTENT_W-72,'400 24px '+FONT,8);
  const h=26+lines.length*32+18;
  ctx.fillStyle='#f6f5fb';rr(ctx,MARGIN,y,CONTENT_W,h,10);ctx.fill();
  ctx.fillStyle=ACCENT;ctx.fillRect(MARGIN,y,6,h);
  ctx.fillStyle='#3f3f45';ctx.font='400 24px '+FONT;ctx.textAlign='left';
  lines.forEach((l,i)=>ctx.fillText(l,MARGIN+30,y+30+i*32));
  return y+h;
}
function drawChartItem(ctx,a,y){
  ctx.textAlign='left';ctx.fillStyle=INK;ctx.font='700 30px '+FONT;
  ctx.fillText(a.caption,MARGIN,y+30);
  let yy=y+48;
  const maxH=a.scaledH!=null?a.scaledH:Math.min(Math.round(CONTENT_W*a.ratio),900);
  const w=CONTENT_W,h=Math.max(200,maxH);
  ctx.fillStyle='#fff';rr(ctx,MARGIN,yy,w,h,12);ctx.fill();
  ctx.strokeStyle=LINE;ctx.lineWidth=2;rr(ctx,MARGIN,yy,w,h,12);ctx.stroke();
  ctx.save();rr(ctx,MARGIN,yy,w,h,12);ctx.clip();
  const s=a.src;
  const sw=s.width||s.naturalWidth,sh=s.height||s.naturalHeight;
  const scale=Math.min(w/sw,h/sh);
  const dw=sw*scale,dh=sh*scale;
  ctx.drawImage(s,MARGIN+(w-dw)/2,yy+(h-dh)/2,dw,dh);
  ctx.restore();
  yy+=h;
  if(a.insight)yy=drawInsightBox(ctx,a.insight,yy+14);
  return yy;
}
function drawMinis(ctx,a,y){
  ctx.textAlign='left';ctx.fillStyle=INK;ctx.font='700 30px '+FONT;
  ctx.fillText(a.caption,MARGIN,y+30);
  let yy=y+48;
  const cols=4,cw=(CONTENT_W-3*GAP)/4,chh=160;
  a.items.forEach((m,i)=>{
    const col=i%cols,row=Math.floor(i/cols);
    const x=MARGIN+col*(cw+GAP),cy=yy+row*(chh+GAP);
    ctx.fillStyle='#fff';rr(ctx,x,cy,cw,chh,10);ctx.fill();
    ctx.strokeStyle=LINE;ctx.lineWidth=2;rr(ctx,x,cy,cw,chh,10);ctx.stroke();
    const s=m.src,sw=s.width||s.naturalWidth,sh=s.height||s.naturalHeight;
    ctx.save();rr(ctx,x,cy,cw,chh,10);ctx.clip();
    ctx.drawImage(s,x+8,cy+8,cw-16,cw-16);
    ctx.restore();
    ctx.fillStyle=MUTED;ctx.font='600 19px '+FONT;
    const cap=wrapLines(m.caption.replace('🏆 ',''),cw-20,'600 19px '+FONT,2);
    cap.forEach((l,j)=>ctx.fillText(l,x+12,cy+cw-14+j*22));
  });
  return yy+2*chh+GAP;
}
function drawSegMatrix(ctx,y){
  const CL=SEGMENTS.clients;
  const maxGp=Math.max(...CL.map(c=>c.gp));
  let yy=y+48;
  for(const L of SEGMENTS.levels){
    const list=CL.filter(c=>c.seg===L.id).sort((a,b)=>b.gp-a.gp);
    const rev=list.reduce((s,c)=>s+c.rev,0),gp=list.reduce((s,c)=>s+c.gp,0);
    ctx.fillStyle=L.color;rr(ctx,MARGIN,yy+8,16,16,4);ctx.fill();
    ctx.textAlign='left';ctx.fillStyle=INK;ctx.font='700 26px '+FONT;
    ctx.fillText(L.label,MARGIN+30,yy+24);
    ctx.fillStyle=MUTED;ctx.font='400 22px '+FONT;
    ctx.fillText(`${list.length} ${['клиент','клиента','клиентов'][list.length===1?0:list.length<5?1:2]} · ${nfmt(rev)} млн руб. · ВП ${nfmt(gp)} млн руб.`,MARGIN+170,yy+24);
    let x=MARGIN+8;const cy=yy+102;
    for(const c of list){
      const r=Math.round(16+Math.sqrt(c.gp/maxGp)*36);
      if(c.review){ /* рамка «на пересмотр»: красная — понижение, зелёная — повышение */
        ctx.strokeStyle=c.revDir==='down'?'#D93025':'#137333';ctx.lineWidth=5;
        ctx.beginPath();ctx.arc(x+r,cy,r+7,0,7);ctx.stroke();
      }
      ctx.fillStyle=L.color;ctx.beginPath();ctx.arc(x+r,cy,r,0,7);ctx.fill();
      ctx.fillStyle='#fff';ctx.textAlign='center';
      ctx.font=`700 ${r>34?22:16}px `+FONT;
      ctx.fillText(nfmt(c.gp),x+r,cy+7);
      ctx.fillStyle=MUTED;ctx.font='600 17px '+FONT;
      const nm=c.name.split(' ')[0].slice(0,14);
      ctx.fillText(nm,x+r,Math.min(yy+162,cy+r+22));
      ctx.textAlign='left';
      x+=2*r+44;
    }
    yy+=170;
  }
  return yy;
}
function drawActions(ctx,y){
  ctx.textAlign='left';ctx.fillStyle=INK;ctx.font='700 30px '+FONT;
  ctx.fillText('План действий ОППиУ — октябрь 2026',MARGIN,y+30);
  let yy=y+48;
  const cols=[MARGIN,MARGIN+50,MARGIN+1020,MARGIN+1350,MARGIN+1560];
  const heads=['№','Действие','Владелец','Срок','Статус'];
  ctx.fillStyle='#eef1f7';rr(ctx,MARGIN,yy,CONTENT_W,44,8);ctx.fill();
  ctx.fillStyle=INK;ctx.font='700 21px '+FONT;
  heads.forEach((h,i)=>ctx.fillText(h,cols[i]+10,yy+29));
  yy+=44;
  ctx.font='400 21px '+FONT;
  ACTIONS.rows.forEach((r,row)=>{
    if(row%2===0){ctx.fillStyle='#fafbfd';ctx.fillRect(MARGIN,yy,CONTENT_W,64);}
    ctx.fillStyle=MUTED;ctx.fillText(r[0],cols[0]+10,yy+38);
    ctx.fillStyle=INK;
    wrapLines(r[1],cols[2]-cols[1]-30,'400 21px '+FONT,2).forEach((l,j)=>ctx.fillText(l,cols[1]+10,yy+26+j*25));
    ctx.fillStyle=MUTED;ctx.fillText(r[2],cols[2]+10,yy+38);
    ctx.fillText(r[3],cols[3]+10,yy+38);
    const st=r[5];
    ctx.fillStyle=/Выполнено/.test(st)?'#137333':/работе/.test(st)?'#b26a00':'#64748b';
    ctx.font='600 20px '+FONT;ctx.fillText(st,cols[4]+10,yy+38);
    ctx.font='400 21px '+FONT;
    yy+=64;
  });
  ctx.strokeStyle=LINE;ctx.lineWidth=2;rr(ctx,MARGIN,y+48,CONTENT_W,yy-y-48,8);ctx.stroke();
  return yy;
}
function drawTextItem(ctx,a,y){
  ctx.textAlign='left';ctx.fillStyle=INK;ctx.font='700 30px '+FONT;
  ctx.fillText(a.caption,MARGIN,y+30);
  let yy=y+48;
  for(const l of a.lines){
    const lines=wrapLines(l,CONTENT_W-72,'400 24px '+FONT,6);
    const h=lines.length*32+16;
    ctx.fillStyle='#f7f8fc';rr(ctx,MARGIN,yy,CONTENT_W,h,10);ctx.fill();
    ctx.fillStyle='#3f3f45';ctx.font='400 24px '+FONT;
    lines.forEach((t,i)=>ctx.fillText(t,MARGIN+24,yy+26+i*32));
    yy+=h+14;
  }
  return yy;
}
function renderPage(page,idx,total){
  const cv=document.createElement('canvas');
  cv.width=PAGE_W;cv.height=PAGE_H;
  const ctx=cv.getContext('2d');
  if(!ctx)throw new Error('canvas 2d недоступен');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,PAGE_W,PAGE_H);
  ctx.fillStyle=ACCENT;ctx.fillRect(0,0,PAGE_W,10);
  /* шапка */
  ctx.textAlign='left';ctx.fillStyle=MUTED;ctx.font='600 22px '+FONT;
  ctx.fillText(C.title+' · In.Plan',MARGIN,52);
  ctx.fillStyle=MUTED;ctx.font='400 22px '+FONT;ctx.textAlign='right';
  ctx.fillText('Октябрь 2026',PAGE_W-MARGIN,52);
  ctx.textAlign='left';ctx.fillStyle=INK;ctx.font='700 46px '+FONT;
  ctx.fillText(page.sec.title,MARGIN,102);
  ctx.strokeStyle=LINE;ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(MARGIN,HEADER_H-14);ctx.lineTo(PAGE_W-MARGIN,HEADER_H-14);ctx.stroke();
  /* контент */
  let y=HEADER_H+16;
  for(const a of page.items){
    if(a.kind==='kpis')y=drawKpis(ctx,a.items,y);
    else if(a.kind==='chart')y=drawChartItem(ctx,a,y);
    else if(a.kind==='minis')y=drawMinis(ctx,a,y);
    else if(a.kind==='segmatrix'){ctx.fillStyle=INK;ctx.font='700 30px '+FONT;ctx.textAlign='left';ctx.fillText(a.caption,MARGIN,y+30);y=drawSegMatrix(ctx,y);if(a.insight)y=drawInsightBox(ctx,a.insight,y+14);}
    else if(a.kind==='actions')y=drawActions(ctx,y);
    else if(a.kind==='text')y=drawTextItem(ctx,a,y);
    y+=GAP;
  }
  /* футер */
  ctx.fillStyle=MUTED;ctx.font='400 20px '+FONT;ctx.textAlign='left';
  ctx.fillText('Сформировано автоматически · экспорт дашборда IBP',MARGIN,PAGE_H-22);
  ctx.textAlign='right';
  ctx.fillText(`стр. ${idx} из ${total}`,PAGE_W-MARGIN,PAGE_H-22);
  return cv;
}

/* ─────────── 4. PDF: страницы = JPEG (DCTDecode), A4 landscape ─────────── */
export function pdfFromJpegs(jpegs,{w,h}){
  const enc=new TextEncoder();
  const PW=842,PH=595; // A4 landscape, pt
  const chunks=[];let pos=0;
  const push=b=>{chunks.push(b);pos+=b.length;};
  const pushStr=s=>push(enc.encode(s));
  const offsets={};let maxId=0;
  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageIds=jpegs.map((_,i)=>3+i*3);
  /* 1 — Catalog, 2 — Pages */
  offsets[1]=pos;pushStr('1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n');
  offsets[2]=pos;pushStr(`2 0 obj\n<</Type/Pages/Count ${jpegs.length}/Kids[${pageIds.map(id=>id+' 0 R').join(' ')}]>>\nendobj\n`);
  jpegs.forEach((jp,i)=>{
    const pid=pageIds[i],cid=pid+1,iid=pid+2;
    const content=`q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    const jb=typeof jp==='string'?dataUrlBytes(jp):jp;
    const head=enc.encode(`${pid} 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PW} ${PH}]/Resources<</XObject<</Im0 ${iid} 0 R>>>>/Contents ${cid} 0 R>>\nendobj\n`);
    offsets[pid]=pos;push(head);
    offsets[cid]=pos;pushStr(`${cid} 0 obj\n<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj\n`);
    offsets[iid]=pos;
    pushStr(`${iid} 0 obj\n<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jb.length}>>\nstream\n`);
    push(jb);
    pushStr('\nendstream\nendobj\n');
    maxId=Math.max(maxId,iid);
  });
  const xrefPos=pos;
  let xref=`xref\n0 ${maxId+1}\n0000000000 65535 f \n`;
  for(let id=1;id<=maxId;id++)xref+=(String(offsets[id]).padStart(10,'0')+' 00000 n \n');
  pushStr(xref+`trailer\n<</Size ${maxId+1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`);
  const out=new Uint8Array(pos);let o=0;
  for(const c of chunks){out.set(c,o);o+=c.length;}
  return out;
}

/* ─────────── 5. PPTX: минимальный OOXML-пакет (zip STORE) ─────────── */
const CRC_T=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export const crc32=u8=>{let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC_T[(c^u8[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
export function zipStore(files){ // files: [ [name, Uint8Array|string] ]
  const enc=new TextEncoder();
  const u16=v=>[v&255,(v>>8)&255],u32=v=>[v&255,v>>8&255,(v>>16)&255,(v>>24)&255];
  const locals=[],centrals=[];let pos=0;
  for(const [name,raw] of files){
    const data=raw instanceof Uint8Array?raw:enc.encode(String(raw)); // строки — в UTF-8 байты
    const nb=enc.encode(name),crc=crc32(data);
    const lh=new Uint8Array([0x50,0x4b,0x03,0x04,...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nb.length),...u16(0)]);
    locals.push(lh,nb,data);
    const ch=new Uint8Array([0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nb.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(pos)]);
    centrals.push(ch,nb);
    pos+=lh.length+nb.length+data.length;
  }
  const cdStart=pos,cdLen=centrals.reduce((a,c)=>a+c.length,0);
  const eocd=new Uint8Array([0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(cdLen),...u32(cdStart),...u16(0)]);
  const all=[...locals,...centrals,eocd];
  const out=new Uint8Array(all.reduce((a,c)=>a+c.length,0));let o=0;
  for(const c of all){out.set(c,o);o+=c.length;}
  return out;
}
const X=h=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${h}`;
const SP_TREE='<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
export function pptxFromJpegs(jpegs,{w,h}){
  const NS='xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  /* A4 landscape: 297×210 мм в EMU (1 мм = 36 000 EMU) */
  const CX=297*36000,CY=210*36000;
  const enc=new TextEncoder();
  const str=s=>enc.encode(s);
  const files=[];
  const slideRels=[],slideIds=[];
  jpegs.forEach((jp,i)=>{
    const n=i+1;
    const jb=typeof jp==='string'?dataUrlBytes(jp):jp;
    files.push([`ppt/media/image${n}.jpeg`,jb]);
    slideRels.push(X(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.jpeg"/></Relationships>`));
    slideIds.push(255+n);
    files.push([`ppt/slides/slide${n}.xml`,X(`<p:sld ${NS}><p:cSld><p:spTree>${SP_TREE}<p:pic><p:nvPicPr><p:cNvPr id="2" name="Страница ${n}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)]);
    files.push([`ppt/slides/_rels/slide${n}.xml.rels`,slideRels[i]]);
  });
  files.unshift(['ppt/theme/theme1.xml',X(`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="InPlan"><a:themeElements><a:clrScheme name="InPlan"><a:dk1><a:srgbClr val="1A2B4A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="212529"/></a:dk2><a:lt2><a:srgbClr val="F4F6FA"/></a:lt2><a:accent1><a:srgbClr val="7C3AED"/></a:accent1><a:accent2><a:srgbClr val="20A7C9"/></a:accent2><a:accent3><a:srgbClr val="4CAF50"/></a:accent3><a:accent4><a:srgbClr val="FF9800"/></a:accent4><a:accent5><a:srgbClr val="D93025"/></a:accent5><a:accent6><a:srgbClr val="8C9BAE"/></a:accent6><a:hlink><a:srgbClr val="7C3AED"/></a:hlink><a:folHlink><a:srgbClr val="8C9BAE"/></a:folHlink></a:clrScheme><a:fontScheme name="InPlan"><a:majorFont><a:latin typeface="Open Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Open Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="InPlan"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`)]);
  files.unshift(['ppt/slideLayouts/slideLayout1.xml',X(`<p:sldLayout ${NS} type="blank"><p:cSld><p:spTree>${SP_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)]);
  files.unshift(['ppt/slideLayouts/_rels/slideLayout1.xml.rels',X(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`)]);
  files.unshift(['ppt/slideMasters/slideMaster1.xml',X(`<p:sldMaster ${NS}><p:cSld><p:spTree>${SP_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`)]);
  files.unshift(['ppt/slideMasters/_rels/slideMaster1.xml.rels',X(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`)]);
  const presRels=[`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    ...jpegs.map((_,i)=>`<Relationship Id="rId${i+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`),
    `<Relationship Id="rId${jpegs.length+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`].join('');
  files.unshift(['ppt/_rels/presentation.xml.rels',X(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels}</Relationships>`)]);
  files.unshift(['ppt/presentation.xml',X(`<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${jpegs.map((_,i)=>`<p:sldId id="${slideIds[i]}" r:id="rId${i+2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${CX}" cy="${CY}"/><p:notesSz cx="${CY}" cy="${CX}"/></p:presentation>`)]);
  files.unshift(['_rels/.rels',X(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)]);
  const overrides=[`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    ...jpegs.map((_,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)].join('');
  files.unshift(['[Content_Types].xml',X(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides}</Types>`)]);
  return zipStore(files);
}

/* ─────────── 6. Оркестратор экспорта ─────────── */
function download(bytes,mime,name){
  const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
  const a=document.createElement('a');
  a.href=url;a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
export async function exportDashboard(format,deps={}){
  if(typeof document==='undefined'||!deps.renderViewInto)throw new Error('экспорт недоступен');
  const sections=await collectSections(deps.renderViewInto);
  if(!sections.length)throw new Error('нет данных для экспорта');
  const pages=layoutPages(sections);
  if(!pages.length)throw new Error('не удалось скомпоновать страницы');
  const canvases=pages.map((p,i)=>renderPage(p,i+1,pages.length));
  const jpegs=canvases.map(cv=>cv.toDataURL('image/jpeg',0.88));
  const dims={w:PAGE_W,h:PAGE_H};
  const stamp='окт-2026';
  if(format==='pptx'){
    download(pptxFromJpegs(jpegs,dims),'application/vnd.openxmlformats-officedocument.presentationml.presentation',`In.Plan_IBP_дашборд_${stamp}.pptx`);
  }else{
    download(pdfFromJpegs(jpegs,dims),'application/pdf',`In.Plan_IBP_дашборд_${stamp}.pdf`);
  }
  return {pages:pages.length,sections:sections.length};
}
