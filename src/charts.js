/* ═══════════════ Лёгкий canvas-движок графиков ═══════════════
   Самостоятельный рендеринг без chart-библиотек. Единая точка входа:
   drawChart(canvas, type, series, labels, opts).

   series — массив рядов; ряд — либо массив значений [1,2,3], либо объект:
   { data:[...], kind:'bar'|'line', axis:0|1, color:'#hex', dash:true,
     fill:true, r:6, pointColors:[...] }.
   opts: { height, legend:[...], colors:[...], yTitle, y1Title, max, min,
           max1, min1, barValues:true, compact:true, center:'текст',
           maxX, maxY, xTitle, yTitle, quadrants:false }.

   Расширяемый реестр типов ядра: новые отрисовщики добавляются сюда же,
   без смены API (см. README). */
const PALETTE=['#20A7C9','#4CAF50','#FF9800','#D93025','#8c9bae','#90CAF9','#9C27B0','#1a2b4a'];
export const CHART_TYPES=['line','bar','stacked','hbar','combo','area','waterfall','band','donut','radar','scatter'];
const FONT="'Open Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const nf=(v,d=0)=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const fm=v=>{const a=Math.abs(v);if(a>=10000)return nf(v/1000,0)+' тыс.';if(a>=1000)return nf(v/1000,1)+' тыс.';return nf(v,Number.isInteger(v)?0:1);};

export function drawChart(canvas,type,series,labels=[],opts={}){
  if(!canvas||typeof canvas.getContext!=='function')return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  // Нативный tooltip по ближайшей точке графика — без тяжелой chart-библиотеки.
  if(!canvas.__inplanInteractive && typeof canvas.addEventListener==='function'){
    canvas.__inplanInteractive=true;
    canvas.addEventListener('mousemove',e=>{
      const rect=canvas.getBoundingClientRect(), x=e.clientX-rect.left;
      const labels=canvas.__inplanLabels||[], rows=canvas.__inplanSeries||[];
      if(!labels.length||!rows.length)return;
      const i=Math.max(0,Math.min(labels.length-1,Math.round(x/Math.max(rect.width,1)*(labels.length-1))));
      canvas.title=String(labels[i])+' — '+rows.map((s,n)=>{const v=(s.data||[])[i];return v==null?null:(canvas.__inplanLegend?.[n]||('Серия '+(n+1)))+': '+nf(v,Number.isInteger(v)?0:1)}).filter(Boolean).join(' · ');
    });
  }
  canvas.__inplanLabels=labels;canvas.__inplanSeries=series;canvas.__inplanLegend=opts.legend;
  const doc=typeof document!=='undefined'?document.documentElement:null;
  const css=doc&&typeof getComputedStyle==='function'?getComputedStyle(doc):{getPropertyValue:()=>''};
  const MUTED=(css.getPropertyValue('--muted')||'').trim()||'#64748b';
  const LINE=(css.getPropertyValue('--line')||'').trim()||'#dbe4ef';
  const CARD=(css.getPropertyValue('--card')||'').trim()||'#ffffff';
  const adapt=c=>c; // только светлая тема — палитра используется как есть
  const pal=(opts.colors||PALETTE).map(adapt);
  const S=(series||[]).map((s,i)=>{const o=Array.isArray(s)?{data:s}:Object.assign({},s);o.data=o.data||[];o.color=adapt(o.color||pal[i%pal.length]);o.kind=o.kind||(type==='combo'?'bar':'line');if(o.pointColors)o.pointColors=o.pointColors.map(adapt);return o;});
  const H=opts.height||280,W=Math.max(canvas.clientWidth||0,240),dpr=2;
  canvas.width=W*dpr;canvas.height=H*dpr;if(canvas.style)canvas.style.height=H+'px';
  ctx.scale(dpr,dpr);ctx.clearRect(0,0,W,H);
  const compact=!!opts.compact,fs=compact?8:11;
  ctx.font=fs+'px '+FONT;ctx.textAlign='left';ctx.textBaseline='alphabetic';

  /* ── легенда: одна компоновка используется и для замера, и для отрисовки ── */
  const legend=opts.legend&&opts.legend.length?opts.legend.map(String):null;
  const layoutLegend=list=>{const sw=compact?7:9,gap=compact?9:14,lh=compact?11:15;let x=6,rows=1;const items=[];ctx.font=fs+'px '+FONT;
    list.forEach(t=>{const w=sw+4+ctx.measureText(t).width+gap;if(x+w>W-6&&x!==6){rows++;x=6}items.push({t,x,y:rows-1,w});x+=w;});
    return{rows,h:rows*lh+2,items,sw,lh};};
  const lay=legend?layoutLegend(legend):{rows:0,h:0,items:[],sw:7,lh:11};
  const drawLegend=(items,sw,lh,colors,top)=>{ctx.font=fs+'px '+FONT;ctx.textAlign='left';
    items.forEach((it,i)=>{const y=top+it.y*lh+lh-3;ctx.fillStyle=(colors&&colors[i])||pal[i%pal.length];ctx.fillRect(it.x,y-sw,sw,sw);ctx.fillStyle=MUTED;ctx.fillText(it.t,it.x+sw+4,y);});};

  /* ─────────── donut ─────────── */
  if(type==='donut'){
    const vals=S[0]?S[0].data:[],total=vals.reduce((a,b)=>a+(b||0),0)||1;
    const lgList=(labels&&labels.length?labels:vals.map((_,i)=>String(i+1))).map((l,i)=>l+' — '+nf(vals[i])+' ('+nf((vals[i]||0)/total*100,(vals[i]||0)%1?1:0)+'%)');
    const lg=layoutLegend(lgList);
    const cx=W/2,cy=(H-lg.h)/2+2,r=Math.min(W,H-lg.h)*0.36;let a0=-Math.PI/2;
    vals.forEach((v,i)=>{const a1=a0+(v||0)/total*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,a0,a1);ctx.closePath();ctx.fillStyle=pal[i%pal.length];ctx.fill();a0=a1;});
    ctx.fillStyle=CARD;ctx.beginPath();ctx.arc(cx,cy,r*0.55,0,7);ctx.fill();
    if(opts.center){ctx.fillStyle=MUTED;ctx.textAlign='center';ctx.fillText(String(opts.center),cx,cy+4);}
    drawLegend(lg.items,lg.sw,lg.lh,null,H-lg.h);
    return;
  }

  /* ─────────── radar ─────────── */
  if(type==='radar'){
    const n=labels.length;if(!n)return;
    const cx=W/2,cy=(H-lay.h)/2+10,R=Math.min(W,H-lay.h)*0.36;
    const max=opts.max||Math.max(10,Math.ceil(Math.max(...S.flatMap(s=>s.data.filter(v=>v!=null)),1)/10)*10);
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
    S.forEach(s=>{ctx.beginPath();s.data.forEach((v,i)=>{const[x,y]=pt(i,v==null?0:v);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();
      ctx.globalAlpha=0.15;ctx.fillStyle=s.color;ctx.fill();ctx.globalAlpha=1;
      ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.stroke();
      s.data.forEach((v,i)=>{const[x,y]=pt(i,v==null?0:v);ctx.beginPath();ctx.arc(x,y,2.4,0,7);ctx.fillStyle=s.color;ctx.fill();});});
    drawLegend(lay.items,lay.sw,lay.lh,null,H-lay.h);return;
  }

  /* ─────────── scatter (матрицы типа ABC-XYZ) ─────────── */
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
    S.forEach(s=>(s.data||[]).forEach(p=>{ctx.beginPath();ctx.arc(X(p.x),Y(p.y),p.r||s.r||6,0,7);ctx.fillStyle=(p.color&&adapt(p.color))||s.color;ctx.fill();}));
    drawLegend(lay.items,lay.sw,lay.lh,null,H-lay.h);return;
  }

  const flat=list=>list.flat().filter(v=>v!=null&&isFinite(v));
  /* ─────────── hbar: горизонтальные бары с поддержкой отрицательных ─────────── */
  if(type==='hbar'){
    const s=S[0];if(!s)return;const data=s.data,n=Math.max(data.length,1);
    let labelW=compact?80:120;ctx.font=fs+'px '+FONT;
    if(!compact)labelW=Math.min(Math.max(...labels.map(l=>ctx.measureText(String(l)).width),40)+10,180);
    const x0=labelW+8,x1=W-(compact?30:48),y0=compact?6:10,y1=H-(compact?12:18)-lay.h;
    const mn=Math.min(0,...flat([data])),mx=Math.max(0,...flat([data]),1),rng=(mx-mn)||1;
    const X=v=>x0+(v-mn)/rng*(x1-x0),bh=(y1-y0)/n*0.6;
    ctx.strokeStyle=LINE;for(let i=0;i<=4;i++){const v=mn+rng*i/4,gx=X(v);ctx.beginPath();ctx.moveTo(gx,y0);ctx.lineTo(gx,y1);ctx.stroke();ctx.fillStyle=MUTED;ctx.textAlign='center';ctx.fillText(fm(v),gx,y1+(compact?9:12));}
    ctx.strokeStyle=MUTED;ctx.beginPath();ctx.moveTo(X(0),y0);ctx.lineTo(X(0),y1);ctx.stroke();
    data.forEach((v,i)=>{if(v==null)return;const cy=y0+(y1-y0)/n*(i+0.5);
      const bx=Math.min(X(0),X(v)),bw=Math.max(Math.abs(X(v)-X(0)),1);
      ctx.fillStyle=(s.pointColors&&s.pointColors[i])||s.color;ctx.fillRect(bx,cy-bh/2,bw,bh);
      if(labels[i]!=null){ctx.fillStyle=MUTED;ctx.textAlign='right';ctx.fillText(String(labels[i]),x0-6,cy+3);}
      ctx.fillStyle=MUTED;ctx.textAlign=v>=0?'left':'right';ctx.fillText(fm(v),v>=0?bx+bw+4:bx-4,cy+3);});
    drawLegend(lay.items,lay.sw,lay.lh,null,H-lay.h);return;
  }

  /* ─────────── декартовы типы ─────────── */
  const barFamily=type==='bar'||type==='stacked'||type==='combo'||type==='waterfall';
  const n=Math.max(labels.length,...S.map(s=>s.data.length),1);
  const rangeOf=list=>{const v=flat(list);return{min:Math.min(0,...v),max:Math.max(0,...v,1)};};
  let rg0,rg1=null;
  if(type==='stacked'){const sums=[];for(let i=0;i<n;i++)sums.push(S.reduce((a,s)=>a+(s.data[i]||0),0));rg0=rangeOf(sums);}
  else if(type==='waterfall'){const d=S[0].data,cum=[0];for(let i=0;i<d.length-1;i++)cum.push(cum[i]+(d[i]||0));rg0=rangeOf([cum,d]);}
  else rg0=rangeOf(S.filter(s=>(s.axis||0)!==1).map(s=>s.data));
  if(S.some(s=>s.axis===1))rg1=rangeOf(S.filter(s=>s.axis===1).map(s=>s.data));
  if(opts.max!=null)rg0.max=opts.max;if(opts.min!=null)rg0.min=opts.min;
  if(rg1){if(opts.max1!=null)rg1.max=opts.max1;if(opts.min1!=null)rg1.min=opts.min1;}
  const rot=!compact&&n>12;
  const padL=compact?28:40,padR=rg1?(compact?34:44):10,padT=compact?8:14,padB=(compact?12:rot?46:22)+lay.h;
  const x0=padL,y0=padT,x1=W-padR,y1=H-padB,pw=x1-x0,ph=y1-y0;
  const Y0=v=>y1-(v-rg0.min)/((rg0.max-rg0.min)||1)*ph;
  const Y1=v=>rg1?y1-(v-rg1.min)/((rg1.max-rg1.min)||1)*ph:Y0(v);
  const slot=barFamily?pw/n:0;
  const cxL=i=>barFamily?x0+slot*(i+0.5):x0+pw*(n>1?i/(n-1):0.5);
  /* сетка, оси, тики */
  ctx.lineWidth=1;ctx.font=fs+'px '+FONT;
  for(let i=0;i<=4;i++){const gy=y0+ph*i/4,v0=rg0.max-(rg0.max-rg0.min)*i/4;
    ctx.strokeStyle=i===4?MUTED:LINE;ctx.beginPath();ctx.moveTo(x0,gy);ctx.lineTo(x1,gy);ctx.stroke();
    ctx.fillStyle=MUTED;ctx.textAlign='right';ctx.fillText(fm(v0),x0-5,gy+3);
    if(rg1){const v1=rg1.max-(rg1.max-rg1.min)*i/4;ctx.textAlign='left';ctx.fillText(fm(v1),x1+5,gy+3);}}
  if(opts.yTitle||opts.y1Title){ctx.textAlign='center';ctx.fillStyle=MUTED;
    if(opts.yTitle){ctx.save();ctx.translate(9,(y0+y1)/2);ctx.rotate(-Math.PI/2);ctx.fillText(opts.yTitle,0,0);ctx.restore();}
    if(rg1&&opts.y1Title){ctx.save();ctx.translate(W-8,(y0+y1)/2);ctx.rotate(Math.PI/2);ctx.fillText(opts.y1Title,0,0);ctx.restore();}}
  /* подписи X с прореживанием и поворотом при длинных рядах */
  ctx.fillStyle=MUTED;
  const maxLbl=Math.max(1,Math.floor(pw/(compact?26:48))),step=Math.ceil(n/maxLbl);
  labels.forEach((l,i)=>{if(i%step)return;const x=cxL(i);
    if(rot){ctx.save();ctx.translate(x,y1+6);ctx.rotate(-Math.PI/5);ctx.textAlign='right';ctx.fillText(String(l),0,8);ctx.restore();}
    else{ctx.textAlign='center';ctx.fillText(String(l),x,y1+(compact?9:13));}});
  if(rg0.min<0){ctx.strokeStyle=MUTED;ctx.beginPath();ctx.moveTo(x0,Y0(0));ctx.lineTo(x1,Y0(0));ctx.stroke();}

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
    if(type==='band'&&S.length>=3){
      const up=linePoints(S[0]),lo=linePoints(S[S.length-1]);
      if(up.length>1&&lo.length>1){ctx.beginPath();ctx.moveTo(up[0][0],up[0][1]);up.forEach(p=>ctx.lineTo(p[0],p[1]));
        for(let i=lo.length-1;i>=0;i--)ctx.lineTo(lo[i][0],lo[i][1]);ctx.closePath();
        ctx.globalAlpha=0.12;ctx.fillStyle=S[0].color;ctx.fill();ctx.globalAlpha=1;}
    }
    S.forEach(s=>{if(s.fill)fillUnder(s);drawLineSeries(s);});
  }
  else if(type==='area'){ /* стекованные области: база + приросты (сезонность) */
    const bottoms=new Array(n).fill(0);
    S.forEach(s=>{
      const tops=[],bots=[];for(let i=0;i<n;i++){bots.push([cxL(i),Y0(bottoms[i])]);bottoms[i]+=(s.data[i]||0);tops.push([cxL(i),Y0(bottoms[i])]);}
      ctx.beginPath();ctx.moveTo(bots[0][0],bots[0][1]);tops.forEach(p=>ctx.lineTo(p[0],p[1]));
      for(let i=bots.length-1;i>=0;i--)ctx.lineTo(bots[i][0],bots[i][1]);ctx.closePath();
      ctx.globalAlpha=0.35;ctx.fillStyle=s.color;ctx.fill();ctx.globalAlpha=1;
      ctx.setLineDash(s.dash?[6,4]:[]);ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.beginPath();
      tops.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();ctx.setLineDash([]);});
  }
  else if(type==='waterfall'){
    const d=S[0].data,bw=slot*0.56;let acc=0,prevY=null,prevCx=null;
    d.forEach((v,i)=>{const isFirst=i===0,isLast=i===d.length-1;
      const b0=isFirst||isLast?0:acc,b1=isFirst||isLast?Math.max(v,0):acc+v;
      if(!isFirst&&!isLast)acc+=v;
      const col=isLast?(opts.wfTotalColor||'#4CAF50'):(isFirst?S[0].color:(v>=0?(opts.wfUpColor||'#FF9800'):(opts.wfDownColor||'#D93025')));
      const cx=cxL(i),yT=Y0(Math.max(b0,b1)),yB=Y0(Math.min(b0,b1));
      ctx.fillStyle=adapt(col);ctx.fillRect(cx-bw/2,yT,bw,Math.max(yB-yT,1.5));
      if(prevY!=null){ctx.setLineDash([3,3]);ctx.strokeStyle=MUTED;ctx.beginPath();ctx.moveTo(prevCx,prevY);ctx.lineTo(cx,prevY);ctx.stroke();ctx.setLineDash([]);}
      prevY=Y0(b1);prevCx=cx;
      ctx.fillStyle=MUTED;ctx.textAlign='center';ctx.fillText(isFirst||isLast?nf(v):(v>0?'+':'')+nf(v),cx,yT-4);});
  }
  else if(type==='stacked'){
    const cumPos=new Array(n).fill(0),cumNeg=new Array(n).fill(0),bw=slot*0.6;
    S.forEach(s=>{for(let i=0;i<n;i++){const v=s.data[i];if(v==null)continue;
      const x=cxL(i)-bw/2;ctx.fillStyle=(s.pointColors&&s.pointColors[i])||s.color;
      if(v>=0){const yT=Y0(cumPos[i]+v),yB=Y0(cumPos[i]);ctx.fillRect(x,yT,bw,Math.max(yB-yT,1));cumPos[i]+=v;}
      else{const yT=Y0(cumNeg[i]),yB=Y0(cumNeg[i]+v);ctx.fillRect(x,yT,bw,Math.max(yB-yT,1));cumNeg[i]+=v;}}});
  }
  else{ /* bar / combo */
    const bars=S.filter(s=>s.kind!=='line');
    const bw=Math.max(slot*0.68/Math.max(bars.length,1),2),gw=bw*bars.length;
    bars.forEach((s,bi)=>{for(let i=0;i<n;i++){const v=s.data[i];if(v==null)continue;
      const x=cxL(i)-gw/2+bi*bw,Y=s.axis===1?Y1:Y0;
      ctx.fillStyle=(s.pointColors&&s.pointColors[i])||s.color;
      const yT=Y(Math.max(v,0)),yB=Y(Math.min(v,0));
      ctx.fillRect(x,yT,bw*0.9,Math.max(yB-yT,1));
      if(opts.barValues){ctx.fillStyle=MUTED;ctx.textAlign='center';ctx.fillText(fm(v),x+bw*0.45,yT-3);}}});
    S.filter(s=>s.kind==='line').forEach(s=>{if(s.fill)fillUnder(s);drawLineSeries(s);});
  }
  drawLegend(lay.items,lay.sw,lay.lh,null,H-lay.h);
  ctx.textAlign='left';ctx.setLineDash([]);
}
/* Дальше по тому же паттерну подключаются pareto, heatmap, dumbbell (см. README). */
