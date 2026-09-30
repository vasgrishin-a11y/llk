/* ═══════════════ Интерактивный canvas-движок графиков In.Plan ═══════════════
   Самостоятельный рендеринг без chart-библиотек. Единая точка входа:
   drawChart(canvas, type, series, labels, opts).

   Интерактивность (подход как в Superset/ECharts, но без зависимостей):
   • плавающий HTML-тултип с вертикальным crosshair и значениями всех рядов;
   • клик по легенде — включает/выключает ряд (данные и оси пересчитываются);
   • колесо мыши — зум по оси X, перетаскивание — панорама;
   • двойной клик — сброс зума; для scatter — тултип по ближайшей точке.

   series — массив рядов; ряд — либо массив значений [1,2,3], либо объект:
   { data:[...], kind:'bar'|'line', axis:0|1, color:'#hex', dash:true,
     fill:true, r:6, pointColors:[...] }.
   opts: { height, legend:[...], colors:[...], yTitle, y1Title, max, min,
           max1, min1, barValues, compact, center, maxX, maxY, xTitle,
           quadrants, unit, valueFmt, stackH:true (гориз. стек) }. */
const PALETTE=['#20A7C9','#4CAF50','#FF9800','#D93025','#8c9bae','#90CAF9','#9C27B0','#1a2b4a'];
export const CHART_TYPES=['line','bar','stacked','hbar','combo','area','waterfall','band','donut','radar','scatter'];
const FONT="'Open Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const nf=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d}).replace('-','−');
const fm=v=>{const a=Math.abs(v);if(a>=10000)return nf(v/1000,0)+' тыс.';if(a>=1000)return nf(v/1000,1)+' тыс.';return nf(v,Number.isInteger(v)?0:1);};
const autoD=v=>Number.isInteger(v)?0:1;
const ZOOMABLE=new Set(['line','bar','stacked','combo','area','band','waterfall']);

/* ── Общий плавающий тултип (один на документ) ── */
function tipEl(){
  if(typeof document==='undefined')return null;
  let t=document.getElementById('__chartTip');
  if(!t){t=document.createElement('div');t.id='__chartTip';
    t.style.cssText='position:fixed;z-index:9999;pointer-events:none;display:none;'
      +'background:#1f1f20;color:#fff;font:400 12px/1.5 '+FONT+';padding:8px 10px;'
      +'border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.28);max-width:280px;white-space:nowrap';
    document.body.appendChild(t);}
  return t;
}
function showTip(html,x,y){const t=tipEl();if(!t)return;t.innerHTML=html;t.style.display='block';
  const w=t.offsetWidth,h=t.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
  let nx=x+16,ny=y+16;if(nx+w>vw-8)nx=x-w-16;if(ny+h>vh-8)ny=y-h-16;
  t.style.left=Math.max(6,nx)+'px';t.style.top=Math.max(6,ny)+'px';}
function hideTip(){const t=document.getElementById('__chartTip');if(t)t.style.display='none';}

export function drawChart(canvas,type,series,labels=[],opts={}){
  if(!canvas||typeof canvas.getContext!=='function')return;
  canvas.__cfg={type,series:series||[],labels:labels||[],opts:opts||{}};
  if(!canvas.__state)canvas.__state={hidden:new Set(),hover:null,zoom:null,drag:null};
  ensureInteractive(canvas);
  paint(canvas);
}

/* ══════════════ Отрисовка (перечитывает cfg + state при каждом кадре) ══════════════ */
function paint(canvas){
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const {type,opts}=canvas.__cfg;let {series,labels}=canvas.__cfg;
  const st=canvas.__state;
  const doc=typeof document!=='undefined'?document.documentElement:null;
  const css=doc&&typeof getComputedStyle==='function'?getComputedStyle(doc):{getPropertyValue:()=>''};
  const MUTED=(css.getPropertyValue('--muted')||'').trim()||'#64748b';
  const LINE=(css.getPropertyValue('--line')||'').trim()||'#dbe4ef';
  const CARD=(css.getPropertyValue('--card')||'').trim()||'#ffffff';
  const TEXT=(css.getPropertyValue('--text')||'').trim()||'#212529';
  const pal=(opts.colors||PALETTE);
  let S=(series||[]).map((s,i)=>{const o=Array.isArray(s)?{data:s}:Object.assign({},s);o.data=o.data||[];o.color=o.color||pal[i%pal.length];o.kind=o.kind||(type==='combo'?'bar':'line');o.__i=i;return o;});

  /* зум по X: срезаем labels и данные рядов на видимое окно (только декартовы) */
  let zoomActive=false;
  if(st.zoom&&ZOOMABLE.has(type)){
    const i0=Math.max(0,st.zoom.i0),i1=Math.min((labels.length||1)-1,st.zoom.i1);
    if(i1-i0>=1&&(i0>0||i1<labels.length-1)){zoomActive=true;
      labels=labels.slice(i0,i1+1);
      S=S.map(o=>{const c=Object.assign({},o);c.data=(o.data||[]).slice(i0,i1+1);if(o.pointColors)c.pointColors=o.pointColors.slice(i0,i1+1);return c;});}
  }
  /* скрытые ряды (клик по легенде) — исключаем из осей и отрисовки, но помним для легенды */
  const vis=S.filter(s=>!st.hidden.has(s.__i));

  const H=opts.height||280,W=Math.max(canvas.clientWidth||0,240),dpr=2;
  canvas.width=W*dpr;canvas.height=H*dpr;if(canvas.style)canvas.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const compact=!!opts.compact,fs=compact?8:11;
  ctx.font=fs+'px '+FONT;ctx.textAlign='left';ctx.textBaseline='alphabetic';
  const geom={type,plot:null,index:[],legendRects:[],points:[],zoomActive};canvas.__geom=geom;

  /* ── легенда (с учётом скрытия и пустых рядов) ── */
  const legendSrc=opts.legend&&opts.legend.length?opts.legend.map(String):null;
  // для декартовых прячем легенду ряда, если у него совсем нет данных в окне
  const legItems=legendSrc?legendSrc.map((t,i)=>{
    const s=S[i];const hasData=!s||(s.data||[]).some(v=>v!=null);
    return {t,i,color:(S[i]?S[i].color:pal[i%pal.length]),hidden:st.hidden.has(i),empty:!hasData};
  }).filter(it=>!it.empty):[];
  const layoutLegend=list=>{const sw=compact?7:9,gap=compact?9:14,lh=compact?12:16;let x=6,rows=1;const items=[];ctx.font=fs+'px '+FONT;
    list.forEach(o=>{const t=typeof o==='string'?o:o.t;const w=sw+5+ctx.measureText(t).width+gap;if(x+w>W-6&&x!==6){rows++;x=6}items.push(Object.assign({},typeof o==='string'?{t:o}:o,{x,row:rows-1,w}));x+=w;});
    return{rows,h:rows*lh+4,items,sw,lh};};
  const lay=legItems.length?layoutLegend(legItems):{rows:0,h:0,items:[],sw:7,lh:14};
  const drawLegend=(top)=>{ctx.font=fs+'px '+FONT;ctx.textAlign='left';geom.legendRects=[];
    lay.items.forEach(it=>{const y=top+it.row*lay.lh+lay.lh-4;
      ctx.globalAlpha=it.hidden?0.4:1;
      ctx.fillStyle=it.color;ctx.fillRect(it.x,y-lay.sw,lay.sw,lay.sw);
      ctx.fillStyle=it.hidden?MUTED:TEXT;ctx.fillText(it.t,it.x+lay.sw+5,y);
      if(it.hidden){const tw=ctx.measureText(it.t).width;ctx.strokeStyle=MUTED;ctx.beginPath();ctx.moveTo(it.x+lay.sw+5,y-4);ctx.lineTo(it.x+lay.sw+5+tw,y-4);ctx.stroke();}
      ctx.globalAlpha=1;
      geom.legendRects.push({i:it.i,x:it.x-2,y:y-lay.sw-3,w:lay.sw+9+ctx.measureText(it.t).width,h:lay.sw+7});});};

  /* ─────────── donut ─────────── */
  if(type==='donut'){
    const raw=(S[0]?S[0].data:[]).map(v=>v||0);
    const labs=(labels&&labels.length?labels:raw.map((_,i)=>String(i+1)));
    const shownTotal=raw.reduce((a,v,i)=>a+(st.hidden.has(i)?0:v),0)||1;
    const lg=layoutLegend(raw.map((v,i)=>({
      t:labs[i]+' — '+nf(v)+(st.hidden.has(i)?'':' ('+nf(v/shownTotal*100,1)+'%)'),
      i,color:pal[i%pal.length],hidden:st.hidden.has(i)})));
    const cx=W/2,cy=(H-lg.h)/2+2,r=Math.min(W,H-lg.h)*0.36;let a0=-Math.PI/2;
    const arcs=[];
    raw.forEach((v,i)=>{if(st.hidden.has(i))return;const a1=a0+v/shownTotal*Math.PI*2;const on=st.hover===i;
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,on?r+5:r,a0,a1);ctx.closePath();
      ctx.fillStyle=pal[i%pal.length];ctx.globalAlpha=st.hover==null||on?1:.55;ctx.fill();ctx.globalAlpha=1;
      if(on){ctx.strokeStyle=CARD;ctx.lineWidth=2;ctx.stroke();}
      arcs.push({i,a0,a1});a0=a1;});
    geom.donut={cx,cy,r,r0:r*0.55,total:shownTotal,vals:raw,labels:labs,arcs};
    ctx.fillStyle=CARD;ctx.beginPath();ctx.arc(cx,cy,r*0.55,0,7);ctx.fill();
    ctx.fillStyle=TEXT;ctx.textAlign='center';ctx.font=(compact?11:14)+'px '+FONT;
    ctx.fillText(opts.center!=null&&st.hidden.size===0?String(opts.center):fm(shownTotal),cx,cy+4);
    if(opts.centerSub&&st.hidden.size===0){ctx.font=(compact?8:10)+'px '+FONT;ctx.fillStyle=MUTED;ctx.fillText(String(opts.centerSub),cx,cy+18);}
    ctx.font=fs+'px '+FONT;
    // легенда доната — кликабельная (скрыть/показать сегмент), с подсветкой при наведении
    ctx.textAlign='left';geom.legendRects=[];
    lg.items.forEach(it=>{const y=(H-lg.h)+it.row*lg.lh+lg.lh-4;
      ctx.globalAlpha=it.hidden?.4:1;
      ctx.fillStyle=pal[it.i%pal.length];ctx.fillRect(it.x,y-lg.sw,lg.sw,lg.sw);
      ctx.fillStyle=it.hidden?MUTED:(st.hover===it.i?TEXT:MUTED);ctx.fillText(it.t,it.x+lg.sw+5,y);
      if(it.hidden){const tw=ctx.measureText(it.t).width;ctx.strokeStyle=MUTED;ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(it.x+lg.sw+5,y-4);ctx.lineTo(it.x+lg.sw+5+tw,y-4);ctx.stroke();}
      ctx.globalAlpha=1;
      geom.legendRects.push({i:it.i,x:it.x-2,y:y-lg.sw-3,w:lg.sw+9+ctx.measureText(it.t).width,h:lg.sw+7});});
    ctx.textAlign='left';return;
  }

  /* ─────────── radar ─────────── */
  if(type==='radar'){
    const n=labels.length;if(!n)return;
    const cx=W/2,cy=(H-lay.h)/2+10,R=Math.min(W,H-lay.h)*0.36;
    const max=opts.max||Math.max(10,Math.ceil(Math.max(...vis.flatMap(s=>s.data.filter(v=>v!=null)),1)/10)*10);
    const pt=(i,v)=>{const a=-Math.PI/2+i/n*Math.PI*2,r=Math.max(0,v)/max*R;return[cx+Math.cos(a)*r,cy+Math.sin(a)*r];};
    for(let ring=1;ring<=4;ring++){ctx.beginPath();for(let i=0;i<=n;i++){const a=-Math.PI/2+(i%n)/n*Math.PI*2,r=R*ring/4,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.strokeStyle=LINE;ctx.lineWidth=1;ctx.stroke();}
    ctx.font=(compact?8:10)+'px '+FONT;
    for(let i=0;i<n;i++){const a=-Math.PI/2+i/n*Math.PI*2;
      ctx.strokeStyle=LINE;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);ctx.stroke();
      const lx=cx+Math.cos(a)*(R+10),ly=cy+Math.sin(a)*(R+10);ctx.fillStyle=MUTED;
      ctx.textAlign=Math.abs(Math.cos(a))<0.35?'center':(Math.cos(a)>0?'left':'right');
      ctx.textBaseline=Math.abs(Math.cos(a))<0.35?(Math.sin(a)>0?'top':'bottom'):'middle';
      ctx.fillText(String(labels[i]),lx,ly);}
    ctx.textBaseline='alphabetic';
    vis.forEach(s=>{ctx.beginPath();s.data.forEach((v,i)=>{const[x,y]=pt(i,v==null?0:v);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();
      ctx.globalAlpha=0.15;ctx.fillStyle=s.color;ctx.fill();ctx.globalAlpha=1;
      ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.stroke();
      s.data.forEach((v,i)=>{const[x,y]=pt(i,v==null?0:v);ctx.beginPath();ctx.arc(x,y,2.6,0,7);ctx.fillStyle=s.color;ctx.fill();});});
    geom.radar={cx,cy,R,n,max};
    drawLegend(H-lay.h);return;
  }

  /* ─────────── scatter ─────────── */
  if(type==='scatter'){
    const padL=compact?26:40,padB=(compact?14:22)+lay.h,padT=compact?8:12,padR=12;
    const x0=padL,y0=padT,x1=W-padR,y1=H-padB,mx=opts.maxX||100,my=opts.maxY||100;
    const X=v=>x0+v/mx*(x1-x0),Y=v=>y1-v/my*(y1-y0);
    ctx.strokeStyle=LINE;ctx.lineWidth=1;ctx.font=fs+'px '+FONT;
    for(let i=0;i<=4;i++){const gx=x0+i*(x1-x0)/4,gy=y0+i*(y1-y0)/4;
      ctx.beginPath();ctx.moveTo(gx,y0);ctx.lineTo(gx,y1);ctx.moveTo(x0,gy);ctx.lineTo(x1,gy);ctx.stroke();
      ctx.fillStyle=MUTED;ctx.textAlign='center';ctx.fillText(fm(mx*i/4),gx,y1+(compact?10:13));
      ctx.textAlign='right';ctx.fillText(fm(my*(4-i)/4),x0-5,y0+i*(y1-y0)/4+3);}
    if(opts.quadrants!==false){ctx.setLineDash([5,4]);ctx.strokeStyle=MUTED;ctx.beginPath();ctx.moveTo(X(mx/2),y0);ctx.lineTo(X(mx/2),y1);ctx.moveTo(x0,Y(my/2));ctx.lineTo(x1,Y(my/2));ctx.stroke();ctx.setLineDash([]);}
    if(opts.xTitle||opts.yTitle){ctx.fillStyle=MUTED;ctx.textAlign='center';
      if(opts.xTitle)ctx.fillText(opts.xTitle,(x0+x1)/2,H-lay.h-2);
      if(opts.yTitle){ctx.save();ctx.translate(9,(y0+y1)/2);ctx.rotate(-Math.PI/2);ctx.fillText(opts.yTitle,0,0);ctx.restore();}}
    geom.points=[];
    vis.forEach(s=>(s.data||[]).forEach(p=>{const px=X(p.x),py=Y(p.y),rr=p.r||s.r||6;
      const on=st.hover&&st.hover.px===px&&st.hover.py===py;
      ctx.beginPath();ctx.arc(px,py,on?rr+2:rr,0,7);ctx.fillStyle=(p.color)||s.color;ctx.globalAlpha=on?1:.85;ctx.fill();ctx.globalAlpha=1;
      if(p.label){ctx.fillStyle=TEXT;ctx.font=(compact?8:9)+'px '+FONT;ctx.textAlign='center';ctx.fillText(p.label,px,py-rr-3);}
      geom.points.push({px,py,r:rr,meta:p,color:(p.color)||s.color});}));
    drawLegend(H-lay.h);return;
  }

  /* ─────────── hbar (одиночный / сгруппированный / стек) ─────────── */
  if(type==='hbar'){
    if(!vis.length)return;
    const cats=labels.length;const grp=vis.length;
    ctx.font=fs+'px '+FONT;
    let labelW=compact?70:90;
    if(!compact)labelW=Math.min(Math.max(...labels.map(l=>ctx.measureText(String(l)).width),40)+12,220);
    const x0=labelW+8,x1=W-(compact?36:56),y0=compact?6:10,y1=H-(compact?14:20)-lay.h;
    const stackH=!!opts.stackH;
    let allVals;
    if(stackH){allVals=[];for(let c=0;c<cats;c++){let pos=0,neg=0;vis.forEach(s=>{const v=s.data[c]||0;if(v>=0)pos+=v;else neg+=v;});allVals.push(pos,neg);}}
    else allVals=vis.flatMap(s=>s.data).filter(v=>v!=null&&isFinite(v));
    const mn=Math.min(0,...allVals),mx=Math.max(0,...allVals,1),rng=(mx-mn)||1;
    const X=v=>x0+(v-mn)/rng*(x1-x0);
    ctx.strokeStyle=LINE;for(let i=0;i<=4;i++){const v=mn+rng*i/4,gx=X(v);ctx.beginPath();ctx.moveTo(gx,y0);ctx.lineTo(gx,y1);ctx.stroke();ctx.fillStyle=MUTED;ctx.textAlign='center';ctx.fillText(fm(v),gx,y1+(compact?9:13));}
    ctx.strokeStyle=MUTED;ctx.beginPath();ctx.moveTo(X(0),y0);ctx.lineTo(X(0),y1);ctx.stroke();
    const rowH=(y1-y0)/Math.max(cats,1);
    geom.hbar={x0,rowH,y0,cats};
    for(let c=0;c<cats;c++){
      const cy=y0+rowH*(c+0.5);
      if(labels[c]!=null){ctx.fillStyle=TEXT;ctx.textAlign='right';const nm=String(labels[c]);
        const maxw=labelW; let txt=nm; while(ctx.measureText(txt).width>maxw&&txt.length>4)txt=txt.slice(0,-2);
        ctx.fillText(txt===nm?nm:txt+'…',x0-6,cy+3);}
      if(stackH){let pos=0,neg=0;
        vis.forEach(s=>{const v=s.data[c];if(v==null)return;const base=v>=0?pos:neg;const bx=Math.min(X(base),X(base+v)),bw=Math.max(Math.abs(X(base+v)-X(base)),1);
          ctx.fillStyle=(s.pointColors&&s.pointColors[c])||s.color;ctx.fillRect(bx,cy-rowH*0.3,bw,rowH*0.6);if(v>=0)pos+=v;else neg+=v;});
      }else{
        const bh=rowH*0.72/grp;
        vis.forEach((s,gi)=>{const v=s.data[c];if(v==null)return;const by=cy-rowH*0.36+gi*bh;
          const bx=Math.min(X(0),X(v)),bw=Math.max(Math.abs(X(v)-X(0)),1);
          ctx.fillStyle=(s.pointColors&&s.pointColors[c])||s.color;ctx.fillRect(bx,by,bw,bh*0.86);
          if(opts.barValuesIn){ /* значение внутри полосы, белым */
            ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 '+(compact?8:10)+'px '+FONT;
            const txt=fm(v);const tw=ctx.measureText(txt).width;
            if(bw>tw+8)ctx.fillText(txt,bx+bw/2,by+bh*0.7);
            else{ctx.fillStyle=MUTED;ctx.textAlign=v>=0?'left':'right';ctx.fillText(txt,v>=0?bx+bw+3:bx-3,by+bh*0.7);}
            ctx.font=fs+'px '+FONT;}
          else{ctx.fillStyle=MUTED;ctx.textAlign=v>=0?'left':'right';ctx.font=(compact?8:10)+'px '+FONT;
            ctx.fillText(fm(v),v>=0?bx+bw+3:bx-3,by+bh*0.7);ctx.font=fs+'px '+FONT;}});
      }
    }
    drawLegend(H-lay.h);return;
  }

  /* ─────────── декартовы (line/bar/stacked/combo/area/band/waterfall) ─────────── */
  const flat=list=>list.flat().filter(v=>v!=null&&isFinite(v));
  const barFamily=type==='bar'||type==='stacked'||type==='combo'||type==='waterfall';
  const n=Math.max(labels.length,...vis.map(s=>s.data.length),1);
  const rangeOf=list=>{const v=flat(list);return{min:Math.min(0,...v),max:Math.max(0,...v,1)};};
  let rg0,rg1=null;
  if(type==='stacked'||type==='area'){const sums=[];for(let i=0;i<n;i++)sums.push(vis.reduce((a,s)=>a+(s.data[i]||0),0));rg0=rangeOf(sums);}
  else if(type==='waterfall'){
    /* накопление: первый столбец — база, промежуточные приросты идут от неё, последний — итог */
    const d=(vis[0]||{data:[]}).data,pts=[0];let acc=d[0]||0;pts.push(acc);
    for(let i=1;i<d.length-1;i++){acc+=(d[i]||0);pts.push(acc);}
    pts.push(d.length?(d[d.length-1]||0):0);rg0=rangeOf([pts]);}
  else rg0=rangeOf(vis.filter(s=>(s.axis||0)!==1).map(s=>s.data));
  if(vis.some(s=>s.axis===1))rg1=rangeOf(vis.filter(s=>s.axis===1).map(s=>s.data));
  if(opts.max!=null)rg0.max=opts.max;if(opts.min!=null)rg0.min=opts.min;
  if(rg1){if(opts.max1!=null)rg1.max=opts.max1;if(opts.min1!=null)rg1.min=opts.min1;}
  const rot=!compact&&n>12;
  const padL=compact?28:44,padR=rg1?(compact?34:46):12,padT=compact?8:14,padB=(compact?14:rot?46:24)+lay.h;
  const x0=padL,y0=padT,x1=W-padR,y1=H-padB,pw=x1-x0,ph=y1-y0;
  const Y0=v=>y1-(v-rg0.min)/((rg0.max-rg0.min)||1)*ph;
  const Y1=v=>rg1?y1-(v-rg1.min)/((rg1.max-rg1.min)||1)*ph:Y0(v);
  const slot=barFamily?pw/n:0;
  const cxL=i=>barFamily?x0+slot*(i+0.5):x0+pw*(n>1?i/(n-1):0.5);
  geom.plot={x0,y0,x1,y1};for(let i=0;i<n;i++)geom.index.push(cxL(i));
  ctx.lineWidth=1;ctx.font=fs+'px '+FONT;
  for(let i=0;i<=4;i++){const gy=y0+ph*i/4,v0=rg0.max-(rg0.max-rg0.min)*i/4;
    ctx.strokeStyle=i===4?MUTED:LINE;ctx.beginPath();ctx.moveTo(x0,gy);ctx.lineTo(x1,gy);ctx.stroke();
    ctx.fillStyle=MUTED;ctx.textAlign='right';ctx.fillText(fm(v0),x0-5,gy+3);
    if(rg1){const v1=rg1.max-(rg1.max-rg1.min)*i/4;ctx.textAlign='left';ctx.fillText(fm(v1),x1+5,gy+3);}}
  if(opts.yTitle||opts.y1Title){ctx.textAlign='center';ctx.fillStyle=MUTED;
    if(opts.yTitle){ctx.save();ctx.translate(10,(y0+y1)/2);ctx.rotate(-Math.PI/2);ctx.fillText(opts.yTitle,0,0);ctx.restore();}
    if(rg1&&opts.y1Title){ctx.save();ctx.translate(W-8,(y0+y1)/2);ctx.rotate(Math.PI/2);ctx.fillText(opts.y1Title,0,0);ctx.restore();}}
  ctx.fillStyle=MUTED;
  const maxLbl=Math.max(1,Math.floor(pw/(compact?26:52))),step=Math.ceil(n/maxLbl);
  labels.forEach((l,i)=>{if(i%step)return;const x=cxL(i);
    if(rot){ctx.save();ctx.translate(x,y1+6);ctx.rotate(-Math.PI/5);ctx.textAlign='right';ctx.fillText(String(l),0,8);ctx.restore();}
    else{ctx.textAlign='center';ctx.fillText(String(l),x,y1+(compact?9:14));}});
  if(rg0.min<0){ctx.strokeStyle=MUTED;ctx.beginPath();ctx.moveTo(x0,Y0(0));ctx.lineTo(x1,Y0(0));ctx.stroke();}
  /* вертикальные отметки событий (например, остановы производства): opts.marks=[{i,label}] */
  if(Array.isArray(opts.marks)&&opts.marks.length){
    const i0=zoomActive&&st.zoom?st.zoom.i0:0;
    opts.marks.forEach(mk=>{const idx=(mk.i|0)-i0;if(idx<0||idx>=n)return;const mx=cxL(idx);
      ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle=mk.color||'#D93025';ctx.lineWidth=1.4;ctx.globalAlpha=.75;
      ctx.beginPath();ctx.moveTo(mx,y0);ctx.lineTo(mx,y1);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
      ctx.fillStyle=mk.color||'#D93025';ctx.beginPath();ctx.arc(mx,y0+5,4.5,0,7);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='700 7px '+FONT;ctx.textAlign='center';ctx.fillText('!',mx,y0+7.6);
      ctx.restore();ctx.font=fs+'px '+FONT;ctx.textAlign='left';});
  }

  const linePoints=s=>{const pts=[];s.data.forEach((v,i)=>{if(v!=null)pts.push([cxL(i),(s.axis===1?Y1:Y0)(v),i])});return pts;};
  const drawLineSeries=s=>{const pts=linePoints(s);if(!pts.length)return;
    ctx.setLineDash(s.dash?[6,4]:[]);ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.beginPath();
    let prevI=null;pts.forEach(([x,y,i])=>{if(prevI!==null&&i===prevI+1)ctx.lineTo(x,y);else ctx.moveTo(x,y);prevI=i;});
    ctx.stroke();ctx.setLineDash([]);
    pts.forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,compact?1.6:2.6,0,7);ctx.fillStyle=s.color;ctx.fill();});};
  const fillUnder=s=>{const pts=linePoints(s);if(pts.length<2)return;
    ctx.beginPath();ctx.moveTo(pts[0][0],Y0(0));pts.forEach(([x,y])=>ctx.lineTo(x,y));ctx.lineTo(pts[pts.length-1][0],Y0(0));ctx.closePath();
    ctx.globalAlpha=0.16;ctx.fillStyle=s.fill===true?s.color:s.fill;ctx.fill();ctx.globalAlpha=1;};

  if(type==='line'||type==='band'){
    if(type==='band'&&vis.length>=3){
      const up=linePoints(vis[0]),lo=linePoints(vis[vis.length-1]);
      if(up.length>1&&lo.length>1){ctx.beginPath();ctx.moveTo(up[0][0],up[0][1]);up.forEach(p=>ctx.lineTo(p[0],p[1]));
        for(let i=lo.length-1;i>=0;i--)ctx.lineTo(lo[i][0],lo[i][1]);ctx.closePath();
        ctx.globalAlpha=0.12;ctx.fillStyle=vis[0].color;ctx.fill();ctx.globalAlpha=1;}
      /* средние линии — полная заливка+линия; границы — тонкий пунктирный контур поверх заливки */
      vis.forEach((s,idx)=>{if(s.fill)fillUnder(s);if(idx>0&&idx<vis.length-1)drawLineSeries(s);});
      if(opts.bandStroke!==false){ctx.save();ctx.setLineDash([5,4]);ctx.strokeStyle=opts.bandStrokeColor||'#7c86a0';ctx.lineWidth=1.2;
        [up,lo].forEach(pts=>{if(pts.length>1){ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}});
        ctx.restore();}
    }
    else{vis.forEach(s=>{if(s.fill)fillUnder(s);drawLineSeries(s);});}
  }
  else if(type==='area'){
    const bottoms=new Array(n).fill(0);
    vis.forEach(s=>{const tops=[],bots=[];for(let i=0;i<n;i++){bots.push([cxL(i),Y0(bottoms[i])]);bottoms[i]+=(s.data[i]||0);tops.push([cxL(i),Y0(bottoms[i])]);}
      ctx.beginPath();ctx.moveTo(bots[0][0],bots[0][1]);tops.forEach(p=>ctx.lineTo(p[0],p[1]));
      for(let i=bots.length-1;i>=0;i--)ctx.lineTo(bots[i][0],bots[i][1]);ctx.closePath();
      ctx.globalAlpha=0.35;ctx.fillStyle=s.color;ctx.fill();ctx.globalAlpha=1;
      ctx.setLineDash(s.dash?[6,4]:[]);ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.beginPath();
      tops.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();ctx.setLineDash([]);});
  }
  else if(type==='waterfall'){
    const d=(vis[0]||{data:[]}).data,bw=slot*0.54;let acc=0,prevY=null,prevCx=null;
    d.forEach((v,i)=>{const isFirst=i===0,isLast=i===d.length-1;
      /* база и итог рисуются от нуля; промежуточные — приростом от накопленного уровня */
      const b0=isFirst||isLast?0:acc,b1=isFirst||isLast?Math.max(v,0):acc+v;
      if(isFirst)acc=v;else if(!isLast)acc+=v;
      const col=isLast?(opts.wfTotalColor||'#4CAF50'):(isFirst?vis[0].color:(v>=0?(opts.wfUpColor||'#FF9800'):(opts.wfDownColor||'#D93025')));
      const cx=cxL(i),yT=Y0(Math.max(b0,b1)),yB=Y0(Math.min(b0,b1));
      ctx.fillStyle=col;ctx.fillRect(cx-bw/2,yT,bw,Math.max(yB-yT,2));
      if(prevY!=null){ctx.save();ctx.setLineDash([4,3]);ctx.strokeStyle='#b8c0cc';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.moveTo(prevCx+bw/2,prevY);ctx.lineTo(cx-bw/2,prevY);ctx.stroke();ctx.restore();}
      prevY=Y0(b1);prevCx=cx;
      ctx.fillStyle=isFirst||isLast?TEXT:col;ctx.textAlign='center';
      ctx.font='700 '+(compact?8:11)+'px '+FONT;
      ctx.fillText(isFirst||isLast?nf(v):(v>0?'+':'−')+nf(Math.abs(v)),cx,yT-5);
      ctx.font=fs+'px '+FONT;
      if(!isFirst&&!isLast){ctx.fillStyle=MUTED;ctx.fillText('→ '+nf(b1),cx,yB+13);}});
  }
  else if(type==='stacked'){
    const cumPos=new Array(n).fill(0),cumNeg=new Array(n).fill(0),bw=slot*0.6;
    vis.forEach(s=>{for(let i=0;i<n;i++){const v=s.data[i];if(v==null)continue;
      const x=cxL(i)-bw/2;ctx.fillStyle=(s.pointColors&&s.pointColors[i])||s.color;
      if(v>=0){const yT=Y0(cumPos[i]+v),yB=Y0(cumPos[i]);ctx.fillRect(x,yT,bw,Math.max(yB-yT,1));cumPos[i]+=v;}
      else{const yT=Y0(cumNeg[i]),yB=Y0(cumNeg[i]+v);ctx.fillRect(x,yT,bw,Math.max(yB-yT,1));cumNeg[i]+=v;}}});
  }
  else{ /* bar / combo */
    const bars=vis.filter(s=>s.kind!=='line');
    const bw=Math.max(slot*0.68/Math.max(bars.length,1),2),gw=bw*bars.length;
    bars.forEach((s,bi)=>{for(let i=0;i<n;i++){const v=s.data[i];if(v==null)continue;
      const x=cxL(i)-gw/2+bi*bw,Y=s.axis===1?Y1:Y0;
      ctx.fillStyle=(s.pointColors&&s.pointColors[i])||s.color;
      const yT=Y(Math.max(v,0)),yB=Y(Math.min(v,0));
      ctx.fillRect(x,yT,bw*0.9,Math.max(yB-yT,1));
      if(opts.barValues){ctx.fillStyle=TEXT;ctx.textAlign='center';ctx.fillText(fm(v),x+bw*0.45,yT-3);}}});
    vis.filter(s=>s.kind==='line').forEach(s=>{if(s.fill)fillUnder(s);drawLineSeries(s);});
  }

  /* ── crosshair + подсветка точек при наведении ── */
  if(st.hover!=null&&typeof st.hover==='number'&&st.hover>=0&&st.hover<n){
    const hx=cxL(st.hover);
    ctx.save();ctx.strokeStyle=MUTED;ctx.setLineDash([4,3]);ctx.globalAlpha=.7;
    ctx.beginPath();ctx.moveTo(hx,y0);ctx.lineTo(hx,y1);ctx.stroke();ctx.restore();
    vis.forEach(s=>{const v=s.data[st.hover];if(v==null)return;const Y=s.axis===1?Y1:Y0;
      ctx.beginPath();ctx.arc(hx,Y(v),4,0,7);ctx.fillStyle=s.color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();});
  }
  drawLegend(H-lay.h);
  ctx.textAlign='left';ctx.setLineDash([]);
}

/* ══════════════ Интерактивность ══════════════ */
function ensureInteractive(canvas){
  if(canvas.__wired||typeof canvas.addEventListener!=='function')return;
  canvas.__wired=true;canvas.style&&(canvas.style.cursor='crosshair');
  const st=()=>canvas.__state,cfg=()=>canvas.__cfg,geom=()=>canvas.__geom||{};
  const nearestIndex=x=>{const g=geom();if(!g.index||!g.index.length)return null;
    let bi=0,bd=1e9;g.index.forEach((gx,i)=>{const d=Math.abs(gx-x);if(d<bd){bd=d;bi=i;}});return bi;};

  canvas.addEventListener('mousemove',e=>{
    const rect=canvas.getBoundingClientRect();const x=e.clientX-rect.left,y=e.clientY-rect.top;
    const g=geom(),{type,opts}=cfg();const s=st();
    // scatter — ближайшая точка
    if(type==='scatter'){let hit=null,bd=1e9;(g.points||[]).forEach(p=>{const d=Math.hypot(p.px-x,p.py-y);if(d<Math.max(p.r+4,10)&&d<bd){bd=d;hit=p;}});
      if(hit){s.hover={px:hit.px,py:hit.py};paint(canvas);const m=hit.meta;
        showTip((m.label?'<b>'+m.label+'</b><br>':'')+(m.tip||('X: '+fm(m.x)+' · Y: '+fm(m.y))),e.clientX,e.clientY);}
      else{if(s.hover){s.hover=null;paint(canvas);}hideTip();}return;}
    if(type==='donut'){const d=g.donut;if(d){
      const legHit=(g.legendRects||[]).find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h);
      if(legHit){if(s.hover!==legHit.i){s.hover=legHit.i;paint(canvas);}
        showTip('<b>'+(d.labels[legHit.i]||'')+'</b><br>'+fm(d.vals[legHit.i])+' млн руб.<br><span style="opacity:.7">клик — скрыть / показать сегмент</span>',e.clientX,e.clientY);return;}
      const dist=Math.hypot(x-d.cx,y-d.cy);
      if(dist<=d.r&&dist>=d.r0){let a=Math.atan2(y-d.cy,x-d.cx)+Math.PI/2;if(a<0)a+=Math.PI*2;
        const base=-Math.PI/2;let idx=-1;
        (d.arcs||[]).forEach(arc=>{const s0=arc.a0-base,s1=arc.a1-base;if(a>=s0&&a<s1)idx=arc.i;});
        if(idx>=0){if(s.hover!==idx){s.hover=idx;paint(canvas);}const lbl=d.labels[idx]||('#'+(idx+1));
          showTip('<b>'+lbl+'</b><br>'+fm(d.vals[idx])+' · '+nf((d.vals[idx]||0)/d.total*100,1)+'%',e.clientX,e.clientY);return;}}
      if(s.hover!=null){s.hover=null;paint(canvas);}hideTip();return;}}
    // декартовы — crosshair по ближайшему индексу
    if(!g.plot){hideTip();return;}
    if(x<g.plot.x0-6||x>g.plot.x1+6){if(s.hover!=null){s.hover=null;paint(canvas);}hideTip();return;}
    const i=nearestIndex(x);if(i==null)return;
    if(s.drag){return;}
    if(s.hover!==i){s.hover=i;paint(canvas);}
    // сбор значений видимых рядов
    let cfgSer=cfg().series,labels=cfg().labels;
    // при зуме индекс относится к срезу — восстановим подписи из geom-окна
    const zoom=(s.zoom&&geom().zoomActive)?s.zoom:null;
    const realI=zoom?zoom.i0+i:i;
    const lab=(zoom?cfg().labels.slice(zoom.i0,zoom.i1+1):cfg().labels)[i];
    const leg=opts.legend||[];
    const rows=(cfg().series||[]).map((ser,si)=>{
      if(s.hidden.has(si))return null;const arr=Array.isArray(ser)?ser:ser.data;const col=(Array.isArray(ser)?PALETTE[si%PALETTE.length]:ser.color)||PALETTE[si%PALETTE.length];
      const v=(zoom?arr.slice(zoom.i0,zoom.i1+1):arr)[i];if(v==null)return null;
      const name=leg[si]||('Ряд '+(si+1));
      return '<div style="display:flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:2px;background:'+col+';display:inline-block"></span>'+name+': <b>'+fm(v)+'</b></div>';
    }).filter(Boolean).join('');
    if(rows)showTip('<div style="margin-bottom:3px;opacity:.8">'+(lab!=null?lab:'')+'</div>'+rows,e.clientX,e.clientY);else hideTip();
  });
  canvas.addEventListener('mouseleave',()=>{const s=st();if(s.hover!=null){s.hover=null;paint(canvas);}s.drag=null;hideTip();});

  // клик по легенде — вкл/выкл ряд
  canvas.addEventListener('click',e=>{
    if(canvas.__moved){canvas.__moved=false;return;}
    const rect=canvas.getBoundingClientRect();const x=e.clientX-rect.left,y=e.clientY-rect.top;
    const g=geom();const hit=(g.legendRects||[]).find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h);
    if(hit){const s=st();if(s.hidden.has(hit.i))s.hidden.delete(hit.i);else s.hidden.add(hit.i);paint(canvas);}
  });

  // зум колесом по X (декартовы)
  canvas.addEventListener('wheel',e=>{
    const {type}=cfg();if(!ZOOMABLE.has(type))return;
    const labels=cfg().labels;const N=labels.length;if(N<4)return;
    e.preventDefault();const s=st();
    let z=s.zoom||{i0:0,i1:N-1};let span=z.i1-z.i0;
    const rect=canvas.getBoundingClientRect();const g=geom();
    const frac=g.plot?Math.min(1,Math.max(0,((e.clientX-rect.left)-g.plot.x0)/((g.plot.x1-g.plot.x0)||1))):0.5;
    const center=z.i0+frac*span;
    const factor=e.deltaY<0?0.75:1.35; // вверх — приблизить
    let newSpan=Math.round(span*factor);newSpan=Math.max(2,Math.min(N-1,newSpan));
    let i0=Math.round(center-frac*newSpan),i1=i0+newSpan;
    if(i0<0){i0=0;i1=newSpan;}if(i1>N-1){i1=N-1;i0=i1-newSpan;}i0=Math.max(0,i0);
    s.zoom=(i0<=0&&i1>=N-1)?null:{i0,i1};s.hover=null;paint(canvas);
  },{passive:false});

  // перетаскивание — панорама зума (mousedown локально, move/up — глобально, см. ниже)
  canvas.addEventListener('mousedown',e=>{const s=st();if(!s.zoom)return;s.drag={x:e.clientX,i0:s.zoom.i0,i1:s.zoom.i1};canvas.__moved=false;__dragCanvas=canvas;});
  canvas.addEventListener('dblclick',()=>{const s=st();if(s.zoom){s.zoom=null;paint(canvas);}});
}
/* Глобальные слушатели панорамы — навешиваются один раз на документ, а не на каждый canvas */
let __dragCanvas=null;
if(typeof window!=='undefined'&&window.addEventListener&&!window.__inplanPanWired){
  window.__inplanPanWired=true;
  window.addEventListener('mousemove',e=>{const canvas=__dragCanvas;if(!canvas)return;const s=canvas.__state;if(!s||!s.drag)return;
    const g=canvas.__geom||{};if(!g.plot)return;const N=canvas.__cfg.labels.length;const span=s.drag.i1-s.drag.i0;
    const dpx=e.clientX-s.drag.x;const perIdx=(g.plot.x1-g.plot.x0)/Math.max(span,1);
    const shift=Math.round(-dpx/perIdx);let i0=s.drag.i0+shift,i1=s.drag.i1+shift;
    if(i0<0){i0=0;i1=span;}if(i1>N-1){i1=N-1;i0=i1-span;}
    if(Math.abs(dpx)>3)canvas.__moved=true;
    s.zoom={i0,i1};s.hover=null;paint(canvas);});
  window.addEventListener('mouseup',()=>{if(__dragCanvas&&__dragCanvas.__state)__dragCanvas.__state.drag=null;__dragCanvas=null;});
}
