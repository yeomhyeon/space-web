import * as THREE from 'three';
import { Universe } from './universe.js?v=28';
import { FireworkSystem } from './fireworks.js?v=28';
import { forge } from './craft.js';
import { store } from './store.js';
import { EMOJI_BY_ID, ARCHIVE_GOAL } from './data.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const canvas = $('#scene');
const universe = new Universe(canvas);
const fireworks = new FireworkSystem(universe);

let pendingRecipe = null;     // 발사 대기 폭죽
let started = false;

// ---------- 렌더 루프 ----------
// universe.update()가 자체 clock delta를 소비하므로 fireworks엔 근사 고정 dt를 전달
function tick(){
  universe.update();
  fireworks.update(0.016);
  requestAnimationFrame(tick);
}
tick();

// 이모지 채집 콜백
universe.onCollect = (data)=>{
  const c = store.addEmoji(data.id);
  refreshCounts(); renderDock();
  toast(`${data.e} ${data.name} 채집! (×${c})`, 900);
  setHint(`${store.collectionTotal()}개의 감정을 모았습니다 · ✨ 폭죽 제작에서 조합해보세요`);
};

// ---------- 인트로 ----------
$('#startBtn').addEventListener('click', enterUniverse);
$('#enableHandBtn').addEventListener('click', async ()=>{
  await enableHands(); enterUniverse();
});
function enterUniverse(){
  if(started) return; started = true;
  $('#intro').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#dock').classList.remove('hidden');
  $('#btnReset').classList.remove('hidden');
  refreshCounts(); renderDock();
  // 시작 시 살짝 카메라 진입 연출
  universe.flyTo(new THREE.Vector3(0,0,0), 90, 1600);
}

// ---------- 채집: 클릭(짧은 탭) ----------
let downX=0, downY=0, downT=0;
canvas.addEventListener('pointerdown', e=>{ downX=e.clientX; downY=e.clientY; downT=performance.now(); });
canvas.addEventListener('pointerup', e=>{
  const moved = Math.hypot(e.clientX-downX, e.clientY-downY);
  const dt = performance.now()-downT;
  if(moved<6 && dt<400){ tryGrab(); }
});
function tryGrab(){
  const data = universe.grabHovered();
  if(!data){ /* 빈 곳 클릭 */ }
}

// ---------- HUD 버튼 ----------
$('#btnCraft').addEventListener('click', openCraft);
$('#btnArchive').addEventListener('click', openArchive);
$('#btnHand').addEventListener('click', ()=>enableHands());

// ---------- 초기화 (두 번 눌러 확인) ----------
const btnReset = $('#btnReset');
let resetArmed = false, resetTimer;
btnReset.addEventListener('click', ()=>{
  if(!resetArmed){
    resetArmed = true;
    btnReset.classList.add('confirm');
    btnReset.textContent = '정말 초기화? 한 번 더 ↺';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(()=>{
      resetArmed = false;
      btnReset.classList.remove('confirm');
      btnReset.textContent = '↺ 초기화';
    }, 3000);
  } else {
    store.reset();        // 컬렉션·도감·발사 기록 초기화
    location.reload();    // 새 우주로 다시 시작
  }
});
$$('.panel-close').forEach(b=>b.addEventListener('click', ()=>{
  $('#'+b.dataset.close).classList.add('hidden');
}));
$$('.panel').forEach(p=>p.addEventListener('click', e=>{ if(e.target===p) p.classList.add('hidden'); }));

// ---------- 발사 (Space / 버튼 / 손) ----------
addEventListener('keydown', e=>{
  if(e.code==='Space' && started){ e.preventDefault(); launchPending(); }
  if(e.code==='Escape'){ $$('.panel').forEach(p=>p.classList.add('hidden')); }
});
function launchPending(){
  if(!pendingRecipe){
    toast('먼저 ✨ 폭죽 제작에서 폭죽을 빚으세요', 1200); return;
  }
  const apex = fireworks.launch(pendingRecipe);
  // 영화처럼 폭죽 쪽으로 시선
  setTimeout(()=>{
    const rec = pendingRecipe;
    const isNew = store.isNewFirework(rec.key);
    store.recordFirework(rec);
    const n = store.addLaunch();
    universe.evolve(n);
    refreshCounts();
    if(isNew) toast(`✦ NEW! ${rec.name} ${rec.rarity}`, 2200);
    else toast(`${rec.name} 발사 ✦`, 1400);
    setHint(`우주가 ${n}번의 폭죽으로 물들고 있습니다`);
  }, (1.6/Math.max(0.6,pendingRecipe.params.speed))*1000 + 50);
}

// ---------- 폭죽 제작 ----------
let selected = [];
function openCraft(){
  selected = [];
  const owned = store.ownedIds();
  const palette = $('#craftPalette');
  palette.innerHTML = '';
  if(owned.length===0){
    palette.innerHTML = `<p class="arch-empty">아직 채집한 감정이 없습니다.<br/>우주를 유영하며 빛나는 이모지를 클릭(또는 손으로 잡아) 채집하세요.</p>`;
  }
  for(const id of owned){
    const d = EMOJI_BY_ID[id];
    const cnt = store.count(id);
    const el = document.createElement('div');
    el.className='pal-item'; el.dataset.id=id;
    el.innerHTML = `<span class="pal-cnt">×${cnt}</span>
      <div class="pal-emoji">${d.e}</div>
      <span class="pal-name">${d.name}</span>
      <span class="pal-attr">${d.sub}</span>`;
    el.addEventListener('click', ()=>toggleSelect(id, el));
    palette.appendChild(el);
  }
  updateCraftState();
  $('#craftPreview').classList.add('hidden');
  $('#craft').classList.remove('hidden');
}
function toggleSelect(id, el){
  const i = selected.indexOf(id);
  if(i>=0){ selected.splice(i,1); el.classList.remove('sel'); }
  else{
    if(selected.length>=5){ toast('최대 5개까지 선택할 수 있어요', 1000); return; }
    selected.push(id); el.classList.add('sel');
  }
  updateCraftState();
}
function updateCraftState(){
  const row = $('#craftSelected');
  row.innerHTML = selected.length
    ? selected.map(id=>EMOJI_BY_ID[id].e).join(' ')
    : '<span class="ph">3~5개의 감정을 선택하세요</span>';
  const ok = selected.length>=3 && selected.length<=5;
  $('#btnForge').disabled = !ok;
  // 5개 채우면 나머지 흐리게
  $$('.pal-item').forEach(el=>{
    el.classList.toggle('dim', selected.length>=5 && !selected.includes(el.dataset.id));
  });
}
$('#btnForge').addEventListener('click', ()=>{
  const rec = forge(selected);
  pendingRecipe = rec;
  showPreview(rec);
});
function showPreview(rec){
  const pv = $('#craftPreview');
  pv.classList.remove('hidden');
  pv.innerHTML = `
    <h3>${rec.name}</h3>
    <div class="rarity">${rec.rarity}</div>
    <div class="emojis">${rec.emojis.join(' ')}</div>
    <div class="row"><span>예상 효과</span></div>
    <div class="desc">"${rec.desc}"</div>
    <div class="preview-actions">
      <button class="btn-launch" id="pvLaunch">하늘로 발사 🚀</button>
      <button class="btn-ghost" id="pvAgain">다시 빚기 (변주)</button>
    </div>`;
  $('#pvLaunch').addEventListener('click', ()=>{
    $('#craft').classList.add('hidden');
    setHint('폭죽이 장전되었습니다 — Space 또는 손을 위로 던져 발사!');
    $('#launchHint').classList.remove('hidden');
    // 살짝 카메라를 하늘 쪽으로
    launchPending();
  });
  $('#pvAgain').addEventListener('click', ()=>{
    const rec2 = forge(selected); pendingRecipe = rec2; showPreview(rec2);
  });
}

// ---------- 도감 ----------
function openArchive(){
  const grid = $('#archiveGrid');
  const list = store.archiveList().sort((a,b)=>b.stars - a.stars || b.count - a.count);
  grid.innerHTML = list.length ? '' :
    `<p class="arch-empty">아직 발견한 폭죽이 없습니다.<br/>감정을 조합해 첫 폭죽을 발사해보세요.</p>`;
  for(const f of list){
    const el = document.createElement('div');
    el.className='arch-card';
    el.innerHTML = `<div class="nm">${f.name}</div>
      <div class="rr">${f.rarity}</div>
      <div class="em">${f.emojis.join(' ')}</div>
      <div class="meta">제작 ×${f.count} · 첫 발견 ${f.first}</div>`;
    el.addEventListener('click', ()=>{
      $('#archive').classList.add('hidden');
      pendingRecipe = f.recipe;
      launchPending();
    });
    grid.appendChild(el);
  }
  const done = store.archiveCount();
  $('#archProgressText').textContent = `${done} / ${ARCHIVE_GOAL} Complete`;
  $('#archProgressBar').style.width = Math.min(100, done/ARCHIVE_GOAL*100)+'%';
  $('#archive').classList.remove('hidden');
}

// ---------- 손 인식 ----------
let tracker = null;
async function enableHands(){
  if(tracker){ return; }
  const { HandTracker } = await import('./hands.js?v=28');
  $('#handStatus').classList.remove('hidden');
  tracker = new HandTracker({
    video: $('#handVideo'), canvas: $('#handCanvas'),
    onGesture:(state,label)=>{ $('#handGesture').textContent = label; },
    // 매 프레임 손동작 → 카메라 제어 + 채집 커서
    onControl:(ctl)=>{
      if(!started) return;
      if(!ctl.active){ universe.setHandRates(null); hideHandCursor(); return; }
      if(ctl.mode === 'zoom'){ hideHandCursor(); }   // 양손 줌 중엔 단일 커서 숨김
      else if(ctl.ndcx != null){ universe.setHandPointer(ctl.ndcx, ctl.ndcy); updateHandCursor(ctl); }
      universe.setHandRates({ yaw:ctl.yaw||0, pitch:ctl.pitch||0, dolly:ctl.dolly||0, forward:ctl.forward||0 });
    },
    onGrab:()=>{ if(started) tryGrab(); },
    onThrow:()=>{ if(started) launchPending(); },
    onInspect:()=>{ if(started) inspectHovered(); },
  });
  $('#btnHand').classList.add('on');
  try{
    await tracker.start();
    toast('✋ 손으로 우주 탐험 — 양손 핀치=줌, 손 밀기=시선/유영, 주먹=채집, 주먹 꾹 쥐고 유지 후 펴기=발사', 3400);
    setHint('손으로 우주를 만지고 밀고 끌어당겨 탐험하세요 · 손가락 벌리면 가까이, 모으면 멀리');
  }catch(err){
    console.warn('hand tracking failed', err);
    universe.setHandRates(null);
    hideHandCursor();
    $('#handStatus').classList.add('hidden');
    $('#btnHand').classList.remove('on');
    tracker = null;
    toast('손 인식을 쓸 수 없어 마우스/키보드로 진행합니다', 2200);
  }
}

// 정보 보기: 현재 손 커서가 가리키는 이모지의 이름·속성
function inspectHovered(){
  const d = universe.getHoveredData();
  if(d) toast(`${d.e}  ${d.name} · ${d.sub}`, 1600);
}

// 메인 화면에 손 위치(레티클) 표시 — 어떤 별을 조준 중인지 보여줌
const handCursorEl = $('#handCursor');
const handLabelEl = $('#handCursorLabel');
function updateHandCursor(ctl){
  const x = (ctl.ndcx*0.5 + 0.5) * innerWidth;
  const y = (-ctl.ndcy*0.5 + 0.5) * innerHeight;
  handCursorEl.style.left = x + 'px';
  handCursorEl.style.top  = y + 'px';
  handCursorEl.classList.add('show');
  const grab = ctl.mode === 'grab';
  const d = grab ? null : universe.getHoveredData();   // 조준 중인 이모지
  handCursorEl.classList.toggle('grab', grab);
  handCursorEl.classList.toggle('target', !!d);
  if(d){
    handLabelEl.style.left = x + 'px';
    handLabelEl.style.top  = (y + 46) + 'px';
    handLabelEl.textContent = `${d.e} ${d.name} · 주먹 쥐어 채집`;
    handLabelEl.classList.add('show');
  } else {
    handLabelEl.classList.remove('show');
  }
}
function hideHandCursor(){
  handCursorEl.classList.remove('show');
  handLabelEl.classList.remove('show');
}

// ---------- UI 유틸 ----------
function refreshCounts(){
  $('#collCount').textContent = store.ownedIds().length;
  $('#archCount').textContent = store.archiveCount();
}
function renderDock(){
  const dock = $('#dock');
  const owned = store.ownedIds();
  dock.innerHTML='';
  if(owned.length===0){
    dock.innerHTML = `<span style="font-size:12px;color:var(--muted);padding:6px 10px">빛나는 이모지를 채집해 감정 도크를 채우세요</span>`;
    return;
  }
  for(const id of owned){
    const d = EMOJI_BY_ID[id];
    const el = document.createElement('div');
    el.className='dock-item';
    el.innerHTML = `${d.e}<span class="cnt">${store.count(id)}</span>`;
    el.title = `${d.name} · ${d.sub}`;
    dock.appendChild(el);
  }
}
let hintTimer;
function setHint(t){
  const h=$('#hint'); h.style.opacity=0;
  clearTimeout(hintTimer);
  hintTimer=setTimeout(()=>{ h.textContent=t; h.style.opacity=1; },200);
}
let toastTimer;
function toast(msg, ms=1500){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'), ms);
}

// 초기 카운트
refreshCounts();
