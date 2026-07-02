// MediaPipe Tasks Vision · HandLandmarker 기반 손동작 우주 탐험 조작
// - 양손 핀치: 확대/축소
// - 한 손(펼침): 가장자리로 밀어 시선 이동 · 손바닥 밀고 당겨 전진/후진 · 중앙은 채집 커서
// - 주먹: 채집(Grab) · 위로 던지기: 폭죽 발사 · 오래 멈춤: 정보 보기
// 실패(미지원/웹캠 거부) 시 throw → 호출측이 마우스/키보드로 폴백
const TV = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const clamp = (v,a,b)=> v<a?a : v>b?b : v;
// 데드존을 넘어선 양만큼 -1..1 로 정규화
function beyond(v, dz){
  if(v >  dz) return clamp((v-dz)/(0.5-dz), 0, 1);
  if(v < -dz) return clamp((v+dz)/(0.5-dz), -1, 0);
  return 0;
}

export class HandTracker {
  constructor({ video, canvas, onControl, onGrab, onThrow, onInspect, onGesture }){
    this.video = video; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.onControl = onControl || (()=>{});
    this.onGrab    = onGrab    || (()=>{});
    this.onThrow   = onThrow   || (()=>{});
    this.onInspect = onInspect || (()=>{});
    this.onGesture = onGesture || (()=>{});
    this.running = false;
    this.lastState = 'none';
    this.pinchRef = null;      // 양손 중립 간격 기준값(고정)
    this.sizeRef = null;       // 한 손 크기(깊이) 기준값
    this.posHist = [];         // 손바닥 중심 이력 (속도용)
    this.lastGrab = 0; this.lastThrow = 0; this.lastInspect = 0;
    this.stillSince = 0; this.lastTs = 0;
    // 발사 충전(주먹 꾹 쥐고 유지 → 펴서 발사)
    this.fistStart = 0; this.charged = false;
  }

  async start(){
    const vision = await import(`${TV}/vision_bundle.mjs`);
    const { FilesetResolver, HandLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks(`${TV}/wasm`);
    const opts = {
      baseOptions:{ modelAssetPath: MODEL, delegate:'GPU' },
      numHands:2, runningMode:'VIDEO',
      minHandDetectionConfidence:0.6, minHandPresenceConfidence:0.5, minTrackingConfidence:0.5,
    };
    try{ this.landmarker = await HandLandmarker.createFromOptions(fileset, opts); }
    catch(e){ opts.baseOptions.delegate = 'CPU'; this.landmarker = await HandLandmarker.createFromOptions(fileset, opts); }

    const stream = await navigator.mediaDevices.getUserMedia({ video:{ width:480, height:360, facingMode:'user' } });
    this.video.srcObject = stream; await this.video.play();
    this.canvas.width = 320; this.canvas.height = 240;

    this.running = true;
    const loop = ()=>{ if(!this.running) return; this._tick(); requestAnimationFrame(loop); };
    loop();
  }

  stop(){
    this.running = false;
    if(this.video.srcObject) this.video.srcObject.getTracks().forEach(t=>t.stop());
  }

  _tick(){
    const ts = performance.now();
    if(ts - this.lastTs < 22) { requestAnimationFrame(()=>this.running && this._tick()); return; }
    this.lastTs = ts;
    let res;
    try{ res = this.landmarker.detectForVideo(this.video, ts); }catch(e){ return; }
    this._process(res, ts);
  }

  _process(res, ts){
    const ctx = this.ctx; ctx.clearRect(0,0,320,240);
    try{ ctx.drawImage(this.video, 0,0,320,240); }catch(e){}
    const hands = res.landmarks || [];

    if(hands.length === 0){
      this.onControl({ active:false });
      this.onGesture('none','손이 보이지 않음');
      this.pinchRef = null; this.sizeRef = null; this.posHist.length = 0;
      this.stillSince = 0; this.lastState = 'none';
      this.charged = false;
      return;
    }

    this._draw(ctx, hands);

    // ---- 보조 (x는 거울처럼 좌우 반전: 손을 오른쪽 → 화면 오른쪽) ----
    const palm = lm => { const ids=[0,5,9,13,17]; let x=0,y=0; for(const i of ids){ x+=lm[i].x; y+=lm[i].y; } return { x: 1-(x/ids.length), y: y/ids.length }; };
    const sizeOf = lm => Math.hypot(lm[0].x-lm[9].x, lm[0].y-lm[9].y);
    const openCount = lm => { let n=0; for(const [tip,pip] of [[8,6],[12,10],[16,14],[20,18]]) if(lm[tip].y < lm[pip].y - 0.02) n++; return n; };

    // ===== 양손 → 핀치 줌 (위치 기반: 벌린 채 유지하면 계속 확대) =====
    if(hands.length >= 2){
      const A = palm(hands[0]), B = palm(hands[1]);
      const d = Math.hypot(A.x-B.x, A.y-B.y);
      if(this.pinchRef == null) this.pinchRef = d;   // 양손 진입 시점의 "중립 간격" 고정
      const dz = 0.05;                                // 유지(멈춤) 데드존
      const delta = d - this.pinchRef;                // + 벌림 / - 모음
      let dolly = 0;
      if(delta >  dz) dolly = clamp((delta - dz) * 5.0,  0, 1);  // 벌린 채 유지 → 계속 확대
      else if(delta < -dz) dolly = clamp((delta + dz) * 5.0, -1, 0); // 모은 채 유지 → 계속 축소
      this.sizeRef = null; this.posHist.length = 0; this.stillSince = 0;
      this.onControl({ active:true, mode:'zoom', dolly, yaw:0, pitch:0, forward:0 });
      this.onGesture('zoom',
        dolly > 0.02 ? '🔍 확대 중 — 중립으로 모으면 멈춤'
        : dolly < -0.02 ? '🔍 축소 중 — 중립으로 벌리면 멈춤'
        : '✋✋ 벌리면 확대 · 모으면 축소 · 유지하면 멈춤');
      this.lastState = 'zoom';
      return;
    }

    // ===== 한 손 =====
    this.pinchRef = null;   // 양손이 풀리면 다음 줌은 새 중립 간격에서 시작
    const lm = hands[0];
    const P = palm(lm), sz = sizeOf(lm), open = openCount(lm);
    const isFist = open <= 1, isOpen = open >= 3;
    const ndcx = P.x*2-1, ndcy = -(P.y*2-1);   // 채집 커서 (NDC)

    // 손바닥 속도
    this.posHist.push({ x:P.x, y:P.y, t:ts }); if(this.posHist.length>6) this.posHist.shift();
    let vx=0, vy=0;
    if(this.posHist.length>=2){
      const a=this.posHist[0], b=this.posHist[this.posHist.length-1];
      const dt=(b.t-a.t)/1000 || 0.001; vx=(b.x-a.x)/dt; vy=(b.y-a.y)/dt;
    }
    const speed = Math.hypot(vx, vy);

    // ===== 주먹 → 채집 + 발사 충전(꾹 쥐고 유지) =====
    if(isFist){
      if(this.lastState !== 'fist'){
        if(ts-this.lastGrab > 700){ this.lastGrab = ts; this.onGrab(); }  // 주먹 진입 = 채집
        this.fistStart = ts; this.charged = false;
      }
      const held = ts - this.fistStart;
      const CHARGE = 850;                          // 약 0.85초 유지하면 충전
      if(held >= CHARGE) this.charged = true;
      this.onControl({ active:true, mode:'grab', ndcx, ndcy, yaw:0, pitch:0, forward:0 });
      if(this.charged){
        this.onGesture('fist','✊ 충전 완료 — 손을 펴서 발사! 🎆');
      } else {
        const bars = Math.round(Math.min(1, held/CHARGE) * 5);
        this.onGesture('fist', `✊ 폭죽 충전 ${'▰'.repeat(bars)}${'▱'.repeat(5-bars)} (꾹 쥐고 유지)`);
      }
      this.lastState = 'fist'; this.stillSince = 0; this.sizeRef = null;
      return;
    }

    // ===== 펼친 손 → 탐험 =====
    // 발사: 주먹을 충전한 뒤 손을 펴면 발사
    if(this.charged && this.lastState === 'fist' && ts-this.lastThrow > 1000){
      this.lastThrow = ts; this.charged = false;
      this.onThrow();
    }

    // 시선 이동: 손을 가장자리로 밀면
    const dz = 0.22;
    const ox = P.x-0.5, oy = P.y-0.5;
    const yaw   = beyond(ox, dz);     // 손 오른쪽(+) → 오른쪽을 봄
    const pitch = -beyond(oy, dz);    // 손 위(oy 음수) → 위를 봄(+)

    // 전진/후진: 손 크기(깊이). 밀면 커지고(전진), 당기면 작아짐(후진)
    if(this.sizeRef == null) this.sizeRef = sz;
    else this.sizeRef += (sz - this.sizeRef) * 0.012;   // 아주 느린 재중심
    let forward = 0;
    const szRatio = sz/this.sizeRef - 1;
    if(Math.abs(szRatio) > 0.07) forward = clamp(szRatio*3.0, -1, 1);

    // 정보 보기: 오래 멈춤
    if(isOpen && speed < 0.22 && yaw===0 && pitch===0 && forward===0){
      if(this.stillSince === 0) this.stillSince = ts;
      else if(ts-this.stillSince > 1300 && ts-this.lastInspect > 2500){ this.lastInspect = ts; this.stillSince = ts; this.onInspect(); }
    } else this.stillSince = 0;

    this.onControl({ active:true, mode:'look', ndcx, ndcy, yaw, pitch, forward });
    const moving = Math.abs(yaw)>0.05 || Math.abs(pitch)>0.05;
    this.onGesture('open', forward>0.1?'전진 유영':forward<-0.1?'후진 유영':moving?'시선 이동':'펼친 손 — 탐험');
    this.lastState = 'open';
  }

  _draw(ctx, hands){
    const C=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
    for(const lm of hands){
      ctx.strokeStyle='rgba(122,162,255,0.55)'; ctx.lineWidth=2;
      for(const [a,b] of C){ ctx.beginPath(); ctx.moveTo(lm[a].x*320,lm[a].y*240); ctx.lineTo(lm[b].x*320,lm[b].y*240); ctx.stroke(); }
      ctx.fillStyle='rgba(200,220,255,0.95)';
      for(const i of [4,8,12,16,20]){ ctx.beginPath(); ctx.arc(lm[i].x*320, lm[i].y*240, 3, 0, 7); ctx.fill(); }
      const ids=[0,5,9,13,17]; let x=0,y=0; for(const i of ids){ x+=lm[i].x; y+=lm[i].y; } x/=ids.length; y/=ids.length;
      ctx.strokeStyle='rgba(255,138,209,0.95)'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(x*320, y*240, 11, 0, 7); ctx.stroke();
    }
  }
}
