import * as pdfjsLib from './pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';

const $ = id => document.getElementById(id);
const el = {
  openBtn:$('openBtn'),emptyOpenBtn:$('emptyOpenBtn'),fileInput:$('fileInput'),sheetsBtn:$('sheetsBtn'),sheetPanel:$('sheetPanel'),closeSheetsBtn:$('closeSheetsBtn'),sheetList:$('sheetList'),sheetSearch:$('sheetSearch'),scanStatus:$('scanStatus'),backBtn:$('backBtn'),linkBtn:$('linkBtn'),prevBtn:$('prevBtn'),nextBtn:$('nextBtn'),pageInput:$('pageInput'),pageTotal:$('pageTotal'),sheetName:$('sheetName'),zoomOutBtn:$('zoomOutBtn'),zoomInBtn:$('zoomInBtn'),fitBtn:$('fitBtn'),rotateBtn:$('rotateBtn'),viewer:$('viewer'),stage:$('stage'),canvas:$('pdfCanvas'),linkLayer:$('linkLayer'),drawBox:$('drawBox'),emptyState:$('emptyState'),fileStatus:$('fileStatus'),zoomStatus:$('zoomStatus'),linkDialog:$('linkDialog'),linkDestination:$('linkDestination'),linkForm:$('linkForm'),saveLinkBtn:$('saveLinkBtn'),toast:$('toast')
};
const ctx=el.canvas.getContext('2d',{alpha:false});
const state={pdf:null,fileName:'',page:1,rotation:0,renderScale:1.35,viewScale:1,fitScale:1,x:0,y:0,renderTask:null,pages:[],sheetMap:new Map(),history:[],manualLinks:{},linkMode:false,drawStart:null,pendingRect:null,pointers:new Map(),gesture:null,dragging:false};
const SHEET_RE=/\b(?:[A-Z]{1,3}[-.]?\d{1,3}(?:[.-]\d{1,3}){0,3}|[A-Z]{1,3}\d{2,4})\b/gi;

function toast(message){el.toast.textContent=message;el.toast.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.toast.classList.remove('show'),1800)}
function normalizeSheet(s){return String(s||'').trim().toUpperCase().replace(/\s+/g,'').replace(/_/g,'-')}
function controls(enabled){['sheetsBtn','backBtn','linkBtn','prevBtn','nextBtn','pageInput','sheetName','zoomOutBtn','zoomInBtn','fitBtn','rotateBtn'].forEach(k=>el[k].disabled=!enabled)}
function updateToolbar(){if(!state.pdf)return;el.pageInput.value=state.page;el.pageTotal.textContent=`/ ${state.pdf.numPages}`;el.prevBtn.disabled=state.page<=1;el.nextBtn.disabled=state.page>=state.pdf.numPages;el.backBtn.disabled=!state.history.length;const info=state.pages[state.page-1];el.sheetName.value=info?.name||`PAGE-${state.page}`;el.zoomStatus.textContent=`${Math.round(state.viewScale*100)}%`;document.querySelectorAll('.sheet-card').forEach(b=>b.classList.toggle('active',Number(b.dataset.page)===state.page))}
function applyTransform(){el.stage.style.transform=`translate(${state.x}px,${state.y}px) scale(${state.viewScale})`;el.zoomStatus.textContent=`${Math.round(state.viewScale*100)}%`}
function fitPage(){if(!el.canvas.width||!el.canvas.height)return;const pad=20;state.fitScale=Math.min((el.viewer.clientWidth-pad)/el.canvas.width,(el.viewer.clientHeight-pad)/el.canvas.height);state.viewScale=Math.max(.08,state.fitScale);state.x=(el.viewer.clientWidth-el.canvas.width*state.viewScale)/2;state.y=(el.viewer.clientHeight-el.canvas.height*state.viewScale)/2;applyTransform()}
function setZoom(next,anchorX=el.viewer.clientWidth/2,anchorY=el.viewer.clientHeight/2){const old=state.viewScale;next=Math.max(.08,Math.min(8,next));const localX=(anchorX-state.x)/old,localY=(anchorY-state.y)/old;state.viewScale=next;state.x=anchorX-localX*next;state.y=anchorY-localY*next;applyTransform()}
function viewportPoint(e){const r=el.viewer.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function stagePoint(e){const p=viewportPoint(e);return{x:(p.x-state.x)/state.viewScale,y:(p.y-state.y)/state.viewScale}}

async function openPdf(file){
  try{
    const data=await file.arrayBuffer();state.pdf=await pdfjsLib.getDocument({data}).promise;state.fileName=file.name;state.page=1;state.rotation=0;state.pages=Array.from({length:state.pdf.numPages},(_,i)=>({page:i+1,name:`PAGE-${i+1}`,description:'',thumb:''}));state.sheetMap.clear();state.history=[];state.manualLinks={};
    controls(true);el.emptyState.hidden=true;el.stage.hidden=false;el.fileStatus.textContent=file.name;el.pageTotal.textContent=`/ ${state.pdf.numPages}`;el.scanStatus.textContent='Scanning sheet names…';
    await renderPage(1,true);scanPlanSet();
  }catch(err){console.error(err);toast('Could not open this PDF');el.fileStatus.textContent='PDF open failed'}
}

async function renderPage(pageNumber,fit=false){
  if(!state.pdf)return;state.page=Math.max(1,Math.min(state.pdf.numPages,pageNumber));
  if(state.renderTask){try{state.renderTask.cancel()}catch{}}
  const page=await state.pdf.getPage(state.page);const viewport=page.getViewport({scale:state.renderScale,rotation:state.rotation});
  el.canvas.width=Math.ceil(viewport.width);el.canvas.height=Math.ceil(viewport.height);el.canvas.style.width=`${viewport.width}px`;el.canvas.style.height=`${viewport.height}px`;el.linkLayer.style.width=`${viewport.width}px`;el.linkLayer.style.height=`${viewport.height}px`;el.stage.style.width=`${viewport.width}px`;el.stage.style.height=`${viewport.height}px`;
  state.renderTask=page.render({canvasContext:ctx,viewport});try{await state.renderTask.promise}catch(err){if(err?.name!=='RenderingCancelledException')throw err}
  await renderLinks(page,viewport);if(fit)fitPage();updateToolbar();
}

async function scanPlanSet(){
  let found=0;
  for(let n=1;n<=state.pdf.numPages;n++){
    const page=await state.pdf.getPage(n);const viewport=page.getViewport({scale:1});const tc=await page.getTextContent();let best=null;
    for(const item of tc.items){
      const matches=String(item.str||'').match(SHEET_RE)||[];if(!matches.length)continue;
      const pt=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
      for(const raw of matches){const name=normalizeSheet(raw);const lowerRight=pt[0]>viewport.width*.55&&pt[1]>viewport.height*.55;const score=(lowerRight?100:0)+Math.min(item.height||0,30)+(name.includes('.')||name.includes('-')?10:0);if(!best||score>best.score)best={name,score}}
    }
    if(best){state.pages[n-1].name=best.name;state.sheetMap.set(best.name,n);found++}
    if(n===1||n%4===0||n===state.pdf.numPages){el.scanStatus.textContent=`Scanning ${n} of ${state.pdf.numPages}…`;buildSheetList()}
  }
  el.scanStatus.textContent=`${state.pdf.numPages} pages • ${found} sheet names found`;buildSheetList();populateDestinations();renderPage(state.page,false);toast('Plan links are ready')
}

async function makeThumb(info){if(info.thumb)return info.thumb;const page=await state.pdf.getPage(info.page);const vp=page.getViewport({scale:.16});const c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;info.thumb=c.toDataURL('image/jpeg',.65);return info.thumb}
function buildSheetList(){
  const q=normalizeSheet(el.sheetSearch.value);el.sheetList.textContent='';
  state.pages.filter(p=>!q||p.name.includes(q)||String(p.page).includes(q)).forEach(info=>{const b=document.createElement('button');b.className='sheet-card';b.dataset.page=info.page;b.innerHTML=`<div class="thumb" aria-hidden="true"></div><span class="sheet-meta"><strong>${info.name}</strong><span>PDF page ${info.page}</span></span>`;b.addEventListener('click',()=>{navigate(info.page,true);el.sheetPanel.classList.remove('open')});el.sheetList.appendChild(b);makeThumb(info).then(src=>{const box=b.querySelector('.thumb');box.style.background=`white url(${src}) center/contain no-repeat`}).catch(()=>{});});updateToolbar()
}
function populateDestinations(){el.linkDestination.textContent='';state.pages.forEach(p=>{const o=document.createElement('option');o.value=p.page;o.textContent=`${p.name} — page ${p.page}`;el.linkDestination.appendChild(o)})}

async function renderLinks(page,viewport){
  el.linkLayer.textContent='';const tc=await page.getTextContent();
  for(const item of tc.items){
    const matches=String(item.str||'').match(SHEET_RE)||[];if(!matches.length)continue;
    const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);const h=Math.max(16,Math.abs(item.height||10)*state.renderScale);const w=Math.max(28,(item.width||String(item.str).length*7)*state.renderScale);
    for(const raw of matches){const text=normalizeSheet(raw);if(!state.sheetMap.has(text)||state.sheetMap.get(text)===state.page)continue;addLinkBox({x,y:y-h,w,h,target:state.sheetMap.get(text),kind:'auto',title:`Open ${text}`})}
  }
  for(const link of state.manualLinks[state.page]||[]){const r=viewport.convertToViewportRectangle(link.pdfRect);const x=Math.min(r[0],r[2]),y=Math.min(r[1],r[3]),w=Math.abs(r[2]-r[0]),h=Math.abs(r[3]-r[1]);addLinkBox({x,y,w,h,target:link.target,kind:'manual',title:`Open ${state.pages[link.target-1]?.name||'page '+link.target}`})}
}
function addLinkBox({x,y,w,h,target,kind,title}){const a=document.createElement('button');a.className=`plan-link ${kind}`;a.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;a.title=title;a.setAttribute('aria-label',title);a.addEventListener('click',e=>{e.stopPropagation();navigate(target,true)});el.linkLayer.appendChild(a)}
async function navigate(target,remember){if(!state.pdf||target===state.page)return;if(remember)state.history.push({page:state.page,x:state.x,y:state.y,zoom:state.viewScale,rotation:state.rotation});state.rotation=0;await renderPage(target,true)}
async function goBack(){const h=state.history.pop();if(!h)return;state.rotation=h.rotation;await renderPage(h.page,false);state.x=h.x;state.y=h.y;state.viewScale=h.zoom;applyTransform();updateToolbar()}

function toggleLinkMode(){state.linkMode=!state.linkMode;state.drawStart=null;el.linkBtn.classList.toggle('primary',state.linkMode);el.linkBtn.setAttribute('aria-pressed',String(state.linkMode));el.linkBtn.textContent=state.linkMode?'DRAW LINK':'LINK';toast(state.linkMode?'Drag a box around the callout':'Link tool off')}
function updateDrawBox(a,b){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);Object.assign(el.drawBox.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});el.drawBox.hidden=false;return{x,y,w,h}}
async function saveManualLink(){const r=state.pendingRect;if(!r)return;const page=await state.pdf.getPage(state.page);const vp=page.getViewport({scale:state.renderScale,rotation:state.rotation});const p1=vp.convertToPdfPoint(r.x,r.y),p2=vp.convertToPdfPoint(r.x+r.w,r.y+r.h);(state.manualLinks[state.page]??=[]).push({pdfRect:[p1[0],p1[1],p2[0],p2[1]],target:Number(el.linkDestination.value)});state.pendingRect=null;el.drawBox.hidden=true;await renderPage(state.page,false);toast('Plan link saved')}

el.openBtn.onclick=el.emptyOpenBtn.onclick=()=>el.fileInput.click();el.fileInput.onchange=()=>{const f=el.fileInput.files?.[0];if(f)openPdf(f);el.fileInput.value=''};
el.sheetsBtn.onclick=()=>el.sheetPanel.classList.add('open');el.closeSheetsBtn.onclick=()=>el.sheetPanel.classList.remove('open');el.sheetSearch.oninput=buildSheetList;el.prevBtn.onclick=()=>navigate(state.page-1,true);el.nextBtn.onclick=()=>navigate(state.page+1,true);el.backBtn.onclick=goBack;el.pageInput.onchange=()=>navigate(Number(el.pageInput.value),true);el.sheetName.onchange=()=>{const info=state.pages[state.page-1],old=info.name;state.sheetMap.delete(old);info.name=normalizeSheet(el.sheetName.value)||`PAGE-${state.page}`;state.sheetMap.set(info.name,state.page);buildSheetList();populateDestinations();renderPage(state.page,false)};el.zoomInBtn.onclick=()=>setZoom(state.viewScale*1.25);el.zoomOutBtn.onclick=()=>setZoom(state.viewScale/1.25);el.fitBtn.onclick=fitPage;el.rotateBtn.onclick=()=>{state.rotation=(state.rotation+90)%360;renderPage(state.page,true)};el.linkBtn.onclick=toggleLinkMode;
el.linkForm.addEventListener('submit',e=>{if(e.submitter===el.saveLinkBtn){e.preventDefault();saveManualLink().then(()=>el.linkDialog.close())}});
el.linkDialog.addEventListener('close',()=>{if(state.pendingRect){state.pendingRect=null;state.drawStart=null;el.drawBox.hidden=true}});

el.viewer.addEventListener('pointerdown',e=>{if(!state.pdf)return;el.viewer.setPointerCapture(e.pointerId);state.pointers.set(e.pointerId,viewportPoint(e));if(state.linkMode&&e.pointerType!=='touch'){state.drawStart=stagePoint(e);updateDrawBox(state.drawStart,state.drawStart);return}if(state.linkMode&&e.pointerType==='touch'&&state.pointers.size===1){state.drawStart=stagePoint(e);updateDrawBox(state.drawStart,state.drawStart);return}state.dragging=true;state.gesture={x:e.clientX,y:e.clientY,startX:state.x,startY:state.y}});
el.viewer.addEventListener('pointermove',e=>{if(!state.pointers.has(e.pointerId))return;state.pointers.set(e.pointerId,viewportPoint(e));if(state.linkMode&&state.drawStart&&state.pointers.size===1){state.pendingRect=updateDrawBox(state.drawStart,stagePoint(e));return}if(state.pointers.size===2){const pts=[...state.pointers.values()];const dist=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};if(!state.gesture?.pinch)state.gesture={pinch:true,dist,scale:state.viewScale,mid};setZoom(state.gesture.scale*(dist/state.gesture.dist),mid.x,mid.y);return}if(state.dragging&&state.gesture){state.x=state.gesture.startX+(e.clientX-state.gesture.x);state.y=state.gesture.startY+(e.clientY-state.gesture.y);applyTransform()}});
function pointerEnd(e){state.pointers.delete(e.pointerId);if(state.linkMode&&state.drawStart&&state.pendingRect&&state.pendingRect.w>12&&state.pendingRect.h>12){state.drawStart=null;populateDestinations();el.linkDialog.showModal()}else if(!state.pointers.size){el.drawBox.hidden=true;state.drawStart=null;state.pendingRect=null}state.dragging=false;state.gesture=null}
el.viewer.addEventListener('pointerup',pointerEnd);el.viewer.addEventListener('pointercancel',pointerEnd);el.viewer.addEventListener('wheel',e=>{if(!state.pdf)return;e.preventDefault();const p=viewportPoint(e);setZoom(state.viewScale*(e.deltaY<0?1.12:.89),p.x,p.y)},{passive:false});window.addEventListener('resize',()=>{if(state.pdf)fitPage()});

if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
