const PIN_HASH = '96fb537cfb0fc4d42763567f56ac64e4d5a879eda980b5e107ddb177f39a992d';
const pinGate = document.getElementById('pinGate');
const pinForm = document.getElementById('pinForm');
const pinInput = document.getElementById('pinInput');
const pinMessage = document.getElementById('pinMessage');

function unlockPlanner(){
  document.body.classList.remove('pin-locked');
  document.getElementById('app').setAttribute('aria-hidden','false');
  pinGate.hidden = true;
  try{ sessionStorage.setItem('yfa-planner-unlocked','yes'); }catch{}
}
async function hashPin(value){
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
if(sessionStorage.getItem('yfa-planner-unlocked') === 'yes') unlockPlanner();
else setTimeout(()=>pinInput.focus(),80);
pinForm.addEventListener('submit',async event=>{
  event.preventDefault();
  pinMessage.textContent='CHECKING…';
  if(await hashPin(pinInput.value) === PIN_HASH){
    pinMessage.textContent='WELCOME BACK';
    setTimeout(unlockPlanner,180);
  }else{
    pinMessage.textContent='THAT PIN IS NOT CORRECT';
    pinInput.value='';
    const card=pinGate.querySelector('.pin-card');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    pinInput.focus();
  }
});

const SINGLE_SLOTS = [
  ['top','TOP','♧'],
  ['bottoms','BOTTOMS','♢'],
  ['outerwear','OUTERWEAR','♤'],
  ['shoes','SHOES','⌁'],
  ['accessories','ACCESSORIES','▢'],
  ['jewelry','JEWELRY','◎']
];

const SLOT_LABELS = Object.fromEntries(SINGLE_SLOTS.map(([key,label]) => [key,label]));
const DEFAULT_PREVIEW_LAYOUT = {
  top:         {x:50, y:31, w:46, z:4},
  bottoms:     {x:50, y:61, w:50, z:3},
  outerwear:   {x:50, y:39, w:60, z:5},
  shoes:       {x:50, y:87, w:39, z:6},
  accessories: {x:72, y:47, w:26, z:7},
  jewelry:     {x:34, y:19, w:20, z:8}
};

const state = {
  id: crypto.randomUUID(),
  name: '',
  date: new Date().toISOString().slice(0,10),
  notes: '',
  singles: {},
  previewLayout: {},
  makeupIdeas: [],
  hairIdeas: [],
  inspiration: []
};

let activeSingleSlot = null;
let activeMultiSlot = null;
let selectedPreviewSlot = null;
let previewGesture = null;
let toastTimer = null;
let bgBusySlot = null;

const el = id => document.getElementById(id);
const filePicker = el('filePicker');
const multiFilePicker = el('multiFilePicker');

function renderSingleCards(){
  const host = el('leftColumn');
  host.innerHTML = SINGLE_SLOTS.map(([key,label,icon]) => `
    <div class="slot-card">
      <div class="slot-title"><h3>${label}</h3><span class="slot-icon">${icon}</span></div>
      <div class="upload-box" data-upload="${key}"></div>
    </div>
  `).join('');
  refreshSingles();
}

function refreshSingles(){
  document.querySelectorAll('[data-upload]').forEach(box => {
    const key = box.dataset.upload;
    const item = state.singles[key];
    box.classList.toggle('has-image', !!item);
    box.classList.toggle('bg-busy', bgBusySlot === key);
    box.innerHTML = item ? `
      <img src="${item.data}" alt="${key}" />
      ${bgBusySlot === key ? '<div class="bg-processing"><span></span><b>REMOVING BG</b></div>' : ''}
      <div class="slot-tools">
        <button class="tool-chip" data-replace="${key}" type="button">REPLACE</button>
        <button class="tool-chip" data-bg-action="${item.bgRemoved ? 'restore' : 'remove'}" data-bg-slot="${key}" type="button">${item.bgRemoved ? 'RESTORE BG' : 'REMOVE BG'}</button>
        <button class="tool-chip" data-remove="${key}" type="button">REMOVE</button>
      </div>
    ` : '';
  });
  renderPreview();
}

function defaultLayoutFor(key){
  const d = DEFAULT_PREVIEW_LAYOUT[key] || {x:50,y:50,w:40,z:3};
  return {...d};
}

function ensurePreviewLayout(){
  if(!state.previewLayout || typeof state.previewLayout !== 'object') state.previewLayout = {};
  for(const [key,item] of Object.entries(state.singles || {})){
    if(key === 'makeup-main' || !item) continue;
    if(!state.previewLayout[key]) state.previewLayout[key] = defaultLayoutFor(key);
  }
  for(const key of Object.keys(state.previewLayout)){
    if(!state.singles[key] || key === 'makeup-main') delete state.previewLayout[key];
  }
}

function renderPreview(){
  ensurePreviewLayout();
  const host = el('outfitPreview');
  const entries = Object.entries(state.singles).filter(([key,v]) => v && key !== 'makeup-main');
  const hasItems = entries.length > 0;

  host.className = `outfit-preview${hasItems ? '' : ' empty-preview'}`;
  const pieces = entries.map(([key,item]) => {
    const l = state.previewLayout[key];
    const selected = selectedPreviewSlot === key ? ' selected' : '';
    return `
      <div class="preview-piece${selected}" data-preview-piece="${key}"
           style="left:${l.x}%;top:${l.y}%;width:${l.w}%;z-index:${l.z};"
           role="button" tabindex="0" aria-label="${SLOT_LABELS[key] || key}. Drag to move and resize from the corner.">
        <img src="${item.data}" alt="${SLOT_LABELS[key] || key}" draggable="false" />
        <span class="piece-name">${SLOT_LABELS[key] || key}</span>
        <button class="resize-handle" type="button" data-resize-piece="${key}" aria-label="Resize ${SLOT_LABELS[key] || key}">↘</button>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="silhouette" aria-hidden="true"></div>
    ${pieces}
    ${hasItems ? '<div class="preview-help">TAP A PIECE · DRAG TO MOVE · CORNER TO RESIZE</div>' : '<div class="preview-copy"><span>DRAG &amp; DROP YOUR PIECES</span><small>BUILD YOUR LOOK</small></div>'}
    <div class="preview-target" aria-hidden="true">⌖</div>
  `;
  updatePreviewEditorBar();
}

function updatePreviewEditorBar(){
  const bar = el('previewEditorBar');
  if(!bar) return;
  const valid = selectedPreviewSlot && state.singles[selectedPreviewSlot] && selectedPreviewSlot !== 'makeup-main';
  bar.hidden = !valid;
  if(valid){
    el('selectedPieceLabel').textContent = `${SLOT_LABELS[selectedPreviewSlot] || selectedPreviewSlot} SELECTED`;
    const bgBtn = el('previewBgBtn');
    if(bgBtn){
      const item = state.singles[selectedPreviewSlot];
      bgBtn.textContent = item?.bgRemoved ? 'RESTORE BG' : 'REMOVE BG';
      bgBtn.disabled = bgBusySlot === selectedPreviewSlot;
    }
  }
}

function selectPreviewPiece(key){
  if(!state.singles[key]) return;
  selectedPreviewSlot = key;
  document.querySelectorAll('[data-preview-piece]').forEach(node => node.classList.toggle('selected', node.dataset.previewPiece === key));
  updatePreviewEditorBar();
}

function clearPreviewSelection(){
  selectedPreviewSlot = null;
  document.querySelectorAll('[data-preview-piece]').forEach(node => node.classList.remove('selected'));
  updatePreviewEditorBar();
}

function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }

function beginPreviewGesture(e, mode, key){
  if(!state.previewLayout[key]) return;
  e.preventDefault();
  e.stopPropagation();
  selectPreviewPiece(key);

  const host = el('outfitPreview');
  const rect = host.getBoundingClientRect();
  const layout = state.previewLayout[key];
  const piece = host.querySelector(`[data-preview-piece="${key}"]`);
  previewGesture = {
    mode, key,
    pointerId:e.pointerId,
    startX:e.clientX,
    startY:e.clientY,
    rect,
    original:{...layout},
    startWidthPx:piece?.getBoundingClientRect().width || rect.width * layout.w / 100
  };
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function movePreviewGesture(e){
  if(!previewGesture || e.pointerId !== previewGesture.pointerId) return;
  e.preventDefault();
  const g = previewGesture;
  const layout = state.previewLayout[g.key];
  if(!layout) return;

  if(g.mode === 'move'){
    const dxPct = ((e.clientX - g.startX) / g.rect.width) * 100;
    const dyPct = ((e.clientY - g.startY) / g.rect.height) * 100;
    layout.x = clamp(g.original.x + dxPct, 2, 98);
    layout.y = clamp(g.original.y + dyPct, 2, 98);
  }else if(g.mode === 'resize'){
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const deltaPx = (dx + dy) / 2;
    const newWidthPx = clamp(g.startWidthPx + deltaPx, g.rect.width * .08, g.rect.width * .95);
    layout.w = (newWidthPx / g.rect.width) * 100;
  }

  const piece = el('outfitPreview').querySelector(`[data-preview-piece="${g.key}"]`);
  if(piece){
    piece.style.left = `${layout.x}%`;
    piece.style.top = `${layout.y}%`;
    piece.style.width = `${layout.w}%`;
  }
}

async function endPreviewGesture(e){
  if(!previewGesture || (e.pointerId != null && e.pointerId !== previewGesture.pointerId)) return;
  previewGesture = null;
  await saveDraft();
}

function changeLayer(direction){
  if(!selectedPreviewSlot || !state.previewLayout[selectedPreviewSlot]) return;
  const layouts = Object.values(state.previewLayout);
  const current = state.previewLayout[selectedPreviewSlot];
  if(direction === 'front') current.z = Math.max(1, ...layouts.map(x => Number(x.z) || 1)) + 1;
  if(direction === 'back') current.z = Math.max(1, Math.min(...layouts.map(x => Number(x.z) || 1)) - 1);
  renderPreview();
  saveDraft();
}

function resetSelectedPiece(){
  if(!selectedPreviewSlot) return;
  state.previewLayout[selectedPreviewSlot] = defaultLayoutFor(selectedPreviewSlot);
  renderPreview();
  saveDraft();
}

function loadImage(src){
  return new Promise((resolve,reject)=>{
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function sampleCorner(data,width,height,startX,startY,size=10){
  let red=0,green=0,blue=0,count=0;
  for(let y=startY;y<Math.min(height,startY+size);y++){
    for(let x=startX;x<Math.min(width,startX+size);x++){
      const offset=(y*width+x)*4;
      red+=data[offset]; green+=data[offset+1]; blue+=data[offset+2]; count++;
    }
  }
  return [red/count,green/count,blue/count];
}

async function removeSimpleBackground(source){
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(image,0,0);
  const frame = context.getImageData(0,0,canvas.width,canvas.height);
  const pixels = frame.data;
  const width = canvas.width;
  const height = canvas.height;
  const sampleSize = Math.max(4,Math.min(12,Math.floor(Math.min(width,height)/20)));
  const backgrounds = [
    sampleCorner(pixels,width,height,0,0,sampleSize),
    sampleCorner(pixels,width,height,width-sampleSize,0,sampleSize),
    sampleCorner(pixels,width,height,0,height-sampleSize,sampleSize),
    sampleCorner(pixels,width,height,width-sampleSize,height-sampleSize,sampleSize)
  ];
  const removed = new Uint8Array(width*height);
  const queue = new Int32Array(width*height);
  let head=0,tail=0;
  const thresholdSquared = 78*78;

  function matchesBackground(index){
    const offset=index*4;
    let closest=Infinity;
    for(const color of backgrounds){
      const red=pixels[offset]-color[0];
      const green=pixels[offset+1]-color[1];
      const blue=pixels[offset+2]-color[2];
      closest=Math.min(closest,red*red+green*green+blue*blue);
    }
    return closest <= thresholdSquared;
  }
  function add(index){
    if(index<0 || index>=removed.length || removed[index] || !matchesBackground(index)) return;
    removed[index]=1;
    queue[tail++]=index;
  }

  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
  for(let y=1;y<height-1;y++){add(y*width);add(y*width+width-1);}
  while(head<tail){
    const index=queue[head++];
    const x=index%width;
    if(x>0) add(index-1);
    if(x<width-1) add(index+1);
    if(index>=width) add(index-width);
    if(index<width*(height-1)) add(index+width);
  }
  for(let index=0;index<removed.length;index++){
    if(removed[index]) pixels[index*4+3]=0;
  }
  for(let y=1;y<height-1;y++){
    for(let x=1;x<width-1;x++){
      const index=y*width+x;
      if(!removed[index] && (removed[index-1]||removed[index+1]||removed[index-width]||removed[index+width])){
        pixels[index*4+3]=Math.min(pixels[index*4+3],150);
      }
    }
  }
  context.putImageData(frame,0,0);
  return canvas.toDataURL('image/png');
}

async function removeBackgroundForSlot(key){
  const item = state.singles[key];
  if(!item || bgBusySlot) return;
  bgBusySlot = key;
  refreshSingles();
  updatePreviewEditorBar();
  toast('Removing a plain background…');
  try{
    if(!item.originalData) item.originalData = item.data;
    item.data = await removeSimpleBackground(item.originalData);
    item.bgRemoved = true;
    await saveDraft();
    toast('Background removed');
  }catch(err){
    console.error('Background removal failed', err);
    toast('Could not remove that background');
  }finally{
    bgBusySlot = null;
    refreshSingles();
    if(selectedPreviewSlot === key) selectPreviewPiece(key);
  }
}

async function restoreBackgroundForSlot(key){
  const item = state.singles[key];
  if(!item?.originalData || bgBusySlot) return;
  item.data = item.originalData;
  item.bgRemoved = false;
  await saveDraft();
  refreshSingles();
  if(selectedPreviewSlot === key) selectPreviewPiece(key);
  toast('Original background restored');
}

function toggleBackgroundForSlot(key){
  const item = state.singles[key];
  if(!item) return;
  return item.bgRemoved ? restoreBackgroundForSlot(key) : removeBackgroundForSlot(key);
}

function renderMulti(slot, targetId, max){
  const list = state[slot] || [];
  const cards = [];
  for(let i=0;i<max;i++){
    const item=list[i];
    cards.push(item ? `
      <div class="mini-card">
        <img src="${item.data}" alt="inspiration ${i+1}" />
        <button class="mini-remove" data-multi-remove="${slot}" data-index="${i}" aria-label="Remove">✕</button>
      </div>` : `
      <button class="mini-card empty" type="button" data-multi-empty="${slot}" aria-label="Add image"></button>`);
  }
  el(targetId).innerHTML = cards.join('');
}

function renderAllMulti(){
  renderMulti('makeupIdeas','makeupIdeasGrid',6);
  renderMulti('inspiration','inspirationGrid',3);
}

async function processImage(file){
  const src = await fileToDataURL(file);
  return await downscale(src, 1024, .82, file.type);
}
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file);
  });
}
function downscale(src,maxDim,quality,mimeType='image/jpeg'){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload=()=>{
      const scale = Math.min(1,maxDim/Math.max(img.width,img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(img.width*scale));
      canvas.height = Math.max(1,Math.round(img.height*scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const keepAlpha = /png|webp/i.test(mimeType || '');
      resolve(canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg',quality));
    };
    img.src=src;
  });
}

function toast(msg){
  const t=el('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),1800);
}

function snapshot(){
  return JSON.parse(JSON.stringify({
    ...state,
    name: el('lookName').value.trim() || `Look ${el('lookDate').value || ''}`.trim(),
    date: el('lookDate').value,
    notes: el('notes').value
  }));
}

function loadSnapshot(s){
  Object.assign(state, JSON.parse(JSON.stringify(s)));
  if(!state.previewLayout) state.previewLayout = {};
  selectedPreviewSlot = null;
  el('lookName').value=state.name || '';
  el('lookDate').value=state.date || '';
  el('notes').value=state.notes || '';
  refreshSingles(); renderAllMulti();
  el('savedDialog').close();
  toast('Look loaded');
}

function resetState(){
  state.id=crypto.randomUUID(); state.name=''; state.date=new Date().toISOString().slice(0,10); state.notes=''; state.singles={}; state.previewLayout={}; state.makeupIdeas=[]; state.hairIdeas=[]; state.inspiration=[];
  selectedPreviewSlot=null;
  el('lookName').value=''; el('lookDate').value=state.date; el('notes').value=''; refreshSingles(); renderAllMulti(); saveDraft();
}

const DB_NAME = 'yfa-outfit-planner';
const DB_STORE = 'data';
let dbPromise;
function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
async function dbGet(key){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readonly');
    const req=tx.objectStore(DB_STORE).get(key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function dbSet(key,value){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(value,key);
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error);
  });
}
async function getSaved(){ return (await dbGet('savedLooks')) || []; }
async function setSaved(items){
  try{await dbSet('savedLooks',items);return true}catch(e){toast('Could not save on this device');return false}
}
async function saveDraft(){
  try{await dbSet('draft',snapshot())}catch{}
}
async function saveCurrent(){
  const snap=snapshot();
  const saved=await getSaved();
  const existing=saved.findIndex(x=>x.id===snap.id);
  if(existing>=0) saved[existing]=snap; else saved.unshift(snap);
  if(await setSaved(saved)){state.name=snap.name;state.date=snap.date;state.notes=snap.notes;await saveDraft();toast('Look saved');}
}

async function renderSaved(){
  const saved=await getSaved();
  const host=el('savedLooksGrid');
  if(!saved.length){host.innerHTML='<div style="color:#8e8e8e;padding:30px 4px;letter-spacing:2px;font-size:11px">NO SAVED LOOKS YET</div>';return}
  host.innerHTML=saved.map((look,idx)=>{
    const imgs=Object.values(look.singles||{}).filter(Boolean).slice(0,4);
    return `<article class="saved-look">
      <div class="saved-look-cover">${imgs.map(x=>`<img src="${x.data}" alt=""/>`).join('')}</div>
      <div class="saved-look-meta">
        <div><h3>${escapeHtml(look.name||'Untitled look')}</h3><small>${look.date||''}</small></div>
        <div class="saved-look-actions"><button data-load-look="${idx}">OPEN</button><button data-delete-look="${idx}">⌫</button></div>
      </div>
    </article>`;
  }).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

document.addEventListener('click', async e=>{
  const upload=e.target.closest('[data-upload]');
  const bgAction=e.target.closest('[data-bg-action]');
  if(upload && !e.target.closest('[data-remove]') && !e.target.closest('[data-replace]') && !bgAction){activeSingleSlot=upload.dataset.upload;filePicker.click();}
  const rep=e.target.closest('[data-replace]'); if(rep){activeSingleSlot=rep.dataset.replace;filePicker.click();}
  if(bgAction){
    const key=bgAction.dataset.bgSlot;
    if(bgAction.dataset.bgAction === 'restore') await restoreBackgroundForSlot(key);
    else await removeBackgroundForSlot(key);
  }
  const rem=e.target.closest('[data-remove]'); if(rem){const key=rem.dataset.remove; delete state.singles[key]; delete state.previewLayout[key]; if(selectedPreviewSlot===key) selectedPreviewSlot=null; refreshSingles();saveDraft();}
  const multi=e.target.closest('[data-multi-upload]'); if(multi){activeMultiSlot=multi.dataset.multiUpload;multiFilePicker.click();}
  const emptyMulti=e.target.closest('[data-multi-empty]'); if(emptyMulti){activeMultiSlot=emptyMulti.dataset.multiEmpty==='makeupIdeas'?'makeup-ideas':emptyMulti.dataset.multiEmpty;multiFilePicker.click();}
  const mrem=e.target.closest('[data-multi-remove]'); if(mrem){state[mrem.dataset.multiRemove].splice(Number(mrem.dataset.index),1);renderAllMulti();saveDraft();}
  const load=e.target.closest('[data-load-look]'); if(load){const saved=await getSaved();loadSnapshot(saved[Number(load.dataset.loadLook)]);}
  const del=e.target.closest('[data-delete-look]'); if(del){const saved=await getSaved();saved.splice(Number(del.dataset.deleteLook),1);await setSaved(saved);await renderSaved();}
  if(e.target === el('outfitPreview')) clearPreviewSelection();
});

el('outfitPreview').addEventListener('pointerdown', e=>{
  const resize=e.target.closest('[data-resize-piece]');
  if(resize){beginPreviewGesture(e,'resize',resize.dataset.resizePiece);return;}
  const piece=e.target.closest('[data-preview-piece]');
  if(piece){beginPreviewGesture(e,'move',piece.dataset.previewPiece);}
});
window.addEventListener('pointermove', movePreviewGesture, {passive:false});
window.addEventListener('pointerup', endPreviewGesture);
window.addEventListener('pointercancel', endPreviewGesture);

el('outfitPreview').addEventListener('keydown', e=>{
  const piece=e.target.closest('[data-preview-piece]');
  if(piece && (e.key==='Enter' || e.key===' ')){e.preventDefault();selectPreviewPiece(piece.dataset.previewPiece);}
});

filePicker.addEventListener('change',async()=>{
  const f=filePicker.files?.[0]; if(!f||!activeSingleSlot)return;
  toast('Adding image…');
  const data=await processImage(f);
  state.singles[activeSingleSlot]={data,name:f.name};
  if(activeSingleSlot !== 'makeup-main' && !state.previewLayout[activeSingleSlot]) state.previewLayout[activeSingleSlot]=defaultLayoutFor(activeSingleSlot);
  filePicker.value=''; refreshSingles(); await saveDraft();
});
multiFilePicker.addEventListener('change',async()=>{
  const files=[...(multiFilePicker.files||[])]; if(!files.length||!activeMultiSlot)return;
  const limits={'makeup-ideas':6,'hair-ideas':4,'inspiration':3};
  const stateKey={'makeup-ideas':'makeupIdeas','hair-ideas':'hairIdeas','inspiration':'inspiration'}[activeMultiSlot];
  const remaining=Math.max(0,limits[activeMultiSlot]-state[stateKey].length);
  for(const f of files.slice(0,remaining)){state[stateKey].push({data:await processImage(f),name:f.name});}
  multiFilePicker.value='';renderAllMulti();await saveDraft();toast('Images added');
});

el('saveLookBtn').addEventListener('click',saveCurrent);
el('printLookBtn').addEventListener('click',()=>{
  state.name = el('lookName').value.trim() || `Look ${el('lookDate').value || ''}`.trim();
  state.date = el('lookDate').value;
  state.notes = el('notes').value;
  document.body.dataset.printName = state.name;
  clearPreviewSelection();
  window.print();
});
el('clearBtn').addEventListener('click',()=>{if(confirm('Clear this look?'))resetState()});
el('newLookBtn').addEventListener('click',()=>{if(confirm('Start a new look? Your current look will stay only if you saved it.'))resetState()});
el('viewSavedBtn').addEventListener('click',async()=>{await renderSaved();el('savedDialog').showModal()});
el('closeSavedBtn').addEventListener('click',()=>el('savedDialog').close());
el('inspireBtn').addEventListener('click',()=>el('inspirationPanel').scrollIntoView({behavior:'smooth',block:'center'}));
el('fullscreenBtn').addEventListener('click',()=>{const p=el('outfitPreview');if(document.fullscreenElement)document.exitFullscreen();else p.requestFullscreen?.()});
el('sendBackBtn').addEventListener('click',()=>changeLayer('back'));
el('bringFrontBtn').addEventListener('click',()=>changeLayer('front'));
el('previewBgBtn').addEventListener('click',()=>{if(selectedPreviewSlot) toggleBackgroundForSlot(selectedPreviewSlot)});
el('resetPieceBtn').addEventListener('click',resetSelectedPiece);

['lookName','lookDate','notes'].forEach(id=>el(id).addEventListener('input',()=>saveDraft()));

(async function init(){
  renderSingleCards();
  const draft=await dbGet('draft');
  if(draft){try{loadSnapshot(draft);}catch{}}
  else{el('lookDate').value=state.date;renderAllMulti();}
})();
