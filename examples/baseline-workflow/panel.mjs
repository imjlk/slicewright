const query=new URLSearchParams(location.search);
const renderer=query.get('renderer')==='canvas'?'canvas':'dom';
const locale=query.get('locale')==='ko'?'ko':'en';
const scale=query.get('scale')==='2'?2:1;
const fault=query.get('fault');
const textInset=4*scale;
const copy=locale==='ko'?{
  title:'숲의 우체부',body:'반짝이는 편지를 받아 숲속 친구에게 전해 주세요.',
  action:'편지 받기',idle:'새로운 편지가 기다려요.',accepted:'편지를 받았어요!',
}:{title:'Letters from the wood',body:'Collect a glowing letter and bring a little joy to a friend in the forest.',
  action:'Take letter',idle:'A new letter is waiting.',accepted:'Letter collected!'};
document.documentElement.lang=locale;
const stage=document.querySelector('#stage');
const measureContext=document.createElement('canvas').getContext('2d');
const fonts={title:`bold ${22*scale}px Georgia,serif`,body:`${16*scale}px Arial,sans-serif`,status:`${16*scale}px Arial,sans-serif`,action:`bold ${16*scale}px Arial,sans-serif`};
const heights={title:32*scale,body:26*scale,status:26*scale,action:26*scale};
let count=0,layout,canvas,ctx,panel,content,nodes,ink={};
const status=()=>count?copy.accepted:copy.idle;
function wrap(text,width,font){
  measureContext.font=font;const lines=[];let line='';
  // Preserve every character; both renderers use these same authored line breaks.
  for(const character of text){const next=line+character;if(line&&measureContext.measureText(next).width>width){const split=line.lastIndexOf(' ');if(split>=0&&split<line.length-1){lines.push(line.slice(0,split+1));line=line.slice(split+1)+character;}else{lines.push(line);line=character;}}else line=next;}
  if(line)lines.push(line);return lines;
}
function place(node,b){Object.assign(node.style,{left:`${b.x}px`,top:`${b.y}px`,width:`${b.width}px`,height:`${b.height}px`});}
function arrange(){
  const width=Math.min(620,innerWidth-32),inset=24,available=width-inset*2;
  const lines=Object.fromEntries(['title','body','status'].map(name=>[name,wrap(name==='status'?status():copy[name],available-textInset*2,fonts[name])]));
  const title={x:inset,y:58,width:available,height:lines.title.length*heights.title};
  const body={x:inset,y:title.y+title.height+12,width:available,height:lines.body.length*heights.body};
  const action={x:inset,y:body.y+body.height+20,width:available,height:heights.action+24};
  // Reserve the larger status in both states so collecting a letter keeps geometry stable.
  const statusHeight=Math.max(...[copy.idle,copy.accepted].map(text=>wrap(text,available-textInset*2,fonts.status).length))*heights.status;
  const statusBounds={x:inset,y:action.y+action.height+16,width:available,height:statusHeight};
  const height=statusBounds.y+statusHeight+28;
  // Include the usable bottom padding. Separately rounded DOM rectangles must
  // not force the final child box to sit exactly on the declared content edge.
  layout={width,height,title,body,action,status:statusBounds,lines,content:{x:inset,y:58,width:available,height:height-58-inset}};
  Object.assign(stage.style,{width:`${width}px`,height:`${height}px`});
  Object.assign(panel.style,{width:`${width}px`,height:`${height}px`});
  if(renderer==='canvas'){
    canvas.width=Math.round(width*devicePixelRatio);canvas.height=Math.round(height*devicePixelRatio);
    ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
    ctx.fillStyle='#fff9e9';ctx.fillRect(0,0,width,height);
    ctx.strokeStyle=fault==='paint'&&count?'#cf4444':'#876446';ctx.lineWidth=6;ctx.strokeRect(3,3,width-6,height-6);
    ctx.save();ctx.translate(width/2,28);ctx.rotate(Math.PI/4);ctx.fillStyle='#b8c58a';ctx.fillRect(-14,-14,28,28);ctx.restore();
    ink={};
    for(const name of ['title','body','status'])draw(name,layout[name],lines[name]);
    ctx.fillStyle='#527048';ctx.beginPath();ctx.roundRect(action.x,action.y,action.width,action.height,8);ctx.fill();
    measureContext.font=fonts.action;const textWidth=measureContext.measureText(copy.action).width;
    draw('action',{...action,x:action.x+(action.width-textWidth)/2,y:action.y+12},[copy.action],'#fff9e9');
  }else{
    panel.querySelector('.frame').style.borderColor=fault==='paint'&&count?'#cf4444':'#876446';
    place(content,layout.content);
    for(const name of ['title','body','status','action']){
      const b=layout[name];place(nodes[name],{...b,x:b.x-inset,y:b.y-58});
      if(name!=='action')nodes[name].style.padding=`0 ${textInset}px`;
      nodes[name].style.font=fonts[name];nodes[name].style.lineHeight=`${heights[name]}px`;
      if(name==='action')nodes[name].textContent=copy.action;
      else nodes[name].replaceChildren(...lines[name].map(text=>{const line=document.createElement('span');line.className='line';line.textContent=text;return line;}));
    }
  }
}
function draw(name,bounds,lines,color='#473723'){
  ctx.font=fonts[name];ctx.textBaseline='alphabetic';ctx.fillStyle=color;ink[name]=[];
  for(const [index,line]of lines.entries()){
    const x=bounds.x+(name==='action'?0:textInset),y=bounds.y+index*heights[name]+(name==='title'?24:19)*scale;
    const m=ctx.measureText(line);ctx.fillText(line,x,y);
    ink[name].push({x:x-m.actualBoundingBoxLeft,y:y-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
  }
}
function activate(){count++;arrange();}
function translate(b){const origin=panel.getBoundingClientRect();return {...b,x:origin.x+b.x,y:origin.y+b.y};}
const ready=document.fonts.ready.then(()=>{
  if(renderer==='canvas'){
    canvas=panel=document.createElement('canvas');ctx=canvas.getContext('2d');canvas.id='panel';canvas.tabIndex=0;
    canvas.setAttribute('aria-label',copy.action);
    canvas.addEventListener('click',event=>{const b=canvas.getBoundingClientRect(),x=event.clientX-b.x,y=event.clientY-b.y,a=layout.action;if(x>=a.x&&x<=a.x+a.width&&y>=a.y&&y<=a.y+a.height)activate();});
    canvas.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();activate();}});
  }else{
    panel=document.createElement('article');panel.id='panel';panel.innerHTML='<div class="frame"></div><div class="crest"></div><div id="content"><h2 id="title" class="block"></h2><p id="body" class="block"></p><button id="action"></button><p id="status" class="block" role="status"></p></div>';
    content=panel.querySelector('#content');nodes=Object.fromEntries(['title','body','action','status'].map(name=>[name,panel.querySelector(`#${name}`)]));nodes.action.addEventListener('click',activate);
  }
  stage.append(panel);arrange();addEventListener('resize',arrange);
});
window.letterPanel={ready,state:()=>({count,status:status()}),measure:(actionOnly=false)=>{
  if(actionOnly)return{bounds:translate(layout.action)};
  return{bounds:translate({x:0,y:0,width:layout.width,height:layout.height}),contentBox:translate(layout.content),
    content:Object.fromEntries(['title','body','action','status'].map(name=>[name,{bounds:translate(layout[name]),text:name==='status'?status():copy[name],textBounds:ink[name].map(translate)}]))};
}};
