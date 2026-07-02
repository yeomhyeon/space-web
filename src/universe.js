import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EMOJIS } from './data.js';

// 이모지 → 글로우가 들어간 캔버스 텍스처
const texCache = new Map();
function emojiTexture(emoji, color){
  if(texCache.has(emoji)) return texCache.get(emoji);
  const s = 160;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  // 배경 글로우 (절제된 헤일로)
  const g = ctx.createRadialGradient(s/2,s/2,4, s/2,s/2,s/2);
  g.addColorStop(0, color+'88'); g.addColorStop(0.26, color+'2a'); g.addColorStop(0.6, color+'0d'); g.addColorStop(1, color+'00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s/2,s/2,s/2,0,Math.PI*2); ctx.fill();
  // 이모지
  ctx.font = `${s*0.6}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(emoji, s/2, s/2*1.06);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(emoji, t);
  return t;
}

export class Universe {
  constructor(canvas){
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000004, 0.00013);

    this.camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 4000);
    this.camera.position.set(0, 0, 90);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x000003, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // 컨트롤 (회전/줌/패럴랙스)
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 600;
    this.controls.enablePan = false;

    // 포스트프로세싱 (블룸 = 네온 글로우)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // strength, radius, threshold — 반경을 줄여 폭죽 형상이 번지지 않고 또렷하게
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.42, 0.22);
    this.composer.addPass(this.bloom);

    this.clock = new THREE.Clock();
    this.emojiNodes = [];
    this.hovered = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Sprite = { threshold: 0 };
    this.pointer = new THREE.Vector2(0,0);
    this.keys = {};
    this.onCollect = null;       // (node) => void  외부 콜백
    this.evolveLevel = 0;
    this.bloomBase = 0.9;        // 블룸 기준값 (진화로 상승)
    this.bloomPulse = 0;         // 폭발 순간 일시적 글로우

    // 손동작 카메라 제어 (부드럽게 스무딩)
    this.handCtl = { yaw:0, pitch:0, dolly:0, forward:0 };
    this.handTarget = null;      // {yaw,pitch,dolly,forward} 또는 null
    // 속도/감각 (부호가 반대로 느껴지면 아래 4개 부호만 뒤집으면 됨)
    this.handYawSpeed = 1.5;     // rad/s
    this.handPitchSpeed = 1.1;
    this.handDollySpeed = 1.1;   // 거리 비율/s (양손 핀치 줌 강도 — 낮을수록 천천히)
    this.handForwardSpeed = 80;  // units/s

    this._buildStarfield();
    this._buildNebula();
    this._buildStardust();
    this._buildEmojis(28);

    addEventListener('resize', ()=>this._resize());
    addEventListener('keydown', e=>{ this.keys[e.code]=true; });
    addEventListener('keyup',   e=>{ this.keys[e.code]=false; });
    canvas.addEventListener('pointermove', e=>{
      this.pointer.x = (e.clientX/innerWidth)*2-1;
      this.pointer.y = -(e.clientY/innerHeight)*2+1;
    });
  }

  // ---------- 다층 패럴랙스 스타필드 (실사 딥스페이스) ----------
  _buildStarfield(){
    this.starLayers = [];
    // 미세하고 촘촘한 별 — 멀수록 작고 흐리게 (오밀조밀한 밀도)
    const layers = [
      { n:26000, r:1700, size:1.05, op:0.8 },  // 가장 먼 미세 성진(星塵)
      { n:14000, r:1100, size:1.4,  op:0.92 }, // 중간
      { n:6000,  r:600,  size:2.0,  op:1.0  }, // 가까운 또렷한 별
    ];
    for(const L of layers){
      this._addStarLayer(L.n, L.r, L.size, L.op);
    }
    this._buildGalaxyBand();
    this._buildBrightStars();   // 밝은 청백색 주요 별 (회절 광채)
    // 오밀조밀한 성단 몇 개
    this._buildStarCluster(0.9, 0.45, 700);
    this._buildStarCluster(-0.7, -0.2, 500);
    this._buildStarCluster(0.2, 0.95, 420);
    this._buildStarCluster(-0.4, 0.6, 380);
  }

  _addStarLayer(n, R, size, op){
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n*3);
    const col = new Float32Array(n*3);
    for(let i=0;i<n;i++){
      const r = R * (0.4 + Math.random()*0.6);
      const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
      pos[i*3]   = r*Math.sin(ph)*Math.cos(th);
      pos[i*3+1] = r*Math.sin(ph)*Math.sin(th);
      pos[i*3+2] = r*Math.cos(ph);
      starColor(col, i);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color', new THREE.BufferAttribute(col,3));
    const mat = new THREE.PointsMaterial({
      size, vertexColors:true, transparent:true, opacity:op,
      sizeAttenuation:true, depthWrite:false, blending:THREE.AdditiveBlending,
      map: starTexture(), alphaTest:0.01,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.starLayers.push(pts);
  }

  // 은하수 띠 — 하늘을 가로지르는 미세한 별 밀집대 + 먼지 구름
  _buildGalaxyBand(){
    const n = 18000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n*3);
    const col = new Float32Array(n*3);
    const tilt = 0.5;
    for(let i=0;i<n;i++){
      const t = Math.random()*Math.PI*2;
      // 띠 두께: 가우시안 근사로 가운데 밀집
      const g = (Math.random()+Math.random()+Math.random()+Math.random()-2)/2;
      const band = g*0.2;
      let x = Math.cos(t), y = band, z = Math.sin(t);
      const ny = y*Math.cos(tilt) - z*Math.sin(tilt);
      const nz = y*Math.sin(tilt) + z*Math.cos(tilt);
      const r = 1550 * (0.85 + Math.random()*0.3);
      pos[i*3]=x*r; pos[i*3+1]=ny*r; pos[i*3+2]=nz*r;
      starColor(col, i);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color', new THREE.BufferAttribute(col,3));
    const mat = new THREE.PointsMaterial({
      size:1.0, vertexColors:true, transparent:true, opacity:0.78,
      sizeAttenuation:true, depthWrite:false, blending:THREE.AdditiveBlending,
      map: starTexture(), alphaTest:0.01,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.starLayers.push(pts);

    // 은하수 먼지 구름 (아주 옅은 청회색/갈색) — 띠를 따라 깔림
    const dustCols = [0x1a2a4c, 0x222a40, 0x2c2335, 0x142340];
    for(let i=0;i<9;i++){
      const t = Math.random()*Math.PI*2;
      const band = (Math.random()-0.5)*0.3;
      let y = band, z = Math.sin(t), x = Math.cos(t);
      const ny = y*Math.cos(tilt) - z*Math.sin(tilt);
      const nz = y*Math.sin(tilt) + z*Math.cos(tilt);
      const r = 1500;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTexture(dustCols[i%dustCols.length]),
        transparent:true, opacity:0.10+Math.random()*0.06, depthWrite:false, blending:THREE.AdditiveBlending,
      }));
      sp.position.set(x*r, ny*r, nz*r);
      sp.scale.setScalar(750 + Math.random()*550);
      this.scene.add(sp);
    }
  }

  // 밝은 주요 별 — 회절 광채가 있는 청백색/주황색 별
  _buildBrightStars(){
    const n = 320;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n*3);
    const col = new Float32Array(n*3);
    const c = new THREE.Color();
    for(let i=0;i<n;i++){
      const r = 320 + Math.random()*1100;
      const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
      pos[i*3]=r*Math.sin(ph)*Math.cos(th); pos[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos[i*3+2]=r*Math.cos(ph);
      const k=Math.random();
      if(k<0.62) c.setRGB(0.7,0.82,1.0);          // 청백색 (다수)
      else if(k<0.82) c.setRGB(1,1,1);             // 흰색
      else if(k<0.93) c.setRGB(1.0,0.86,0.66);     // 주황
      else c.setRGB(1.0,0.62,0.5);                 // 붉은
      const b=0.8+Math.random()*0.5;
      col[i*3]=c.r*b; col[i*3+1]=c.g*b; col[i*3+2]=c.b*b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color', new THREE.BufferAttribute(col,3));
    const mat = new THREE.PointsMaterial({
      size:11, vertexColors:true, transparent:true, opacity:1,
      sizeAttenuation:true, depthWrite:false, blending:THREE.AdditiveBlending,
      map: brightStarTexture(), alphaTest:0.01,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.starLayers.push(pts);
  }

  // 오밀조밀한 성단 (가우시안 밀집)
  _buildStarCluster(dx, dy, count){
    const dir = new THREE.Vector3(dx, dy, -1).normalize();
    const r = 1350;
    const center = dir.multiplyScalar(r);
    // 접평면 기저
    const up = Math.abs(dir.y)<0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
    const ex = new THREE.Vector3().crossVectors(dir, up).normalize();
    const ey = new THREE.Vector3().crossVectors(dir, ex).normalize();
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count*3);
    const col = new Float32Array(count*3);
    for(let i=0;i<count;i++){
      const gx=(Math.random()+Math.random()+Math.random()-1.5)*70;
      const gy=(Math.random()+Math.random()+Math.random()-1.5)*70;
      const p = center.clone().addScaledVector(ex,gx).addScaledVector(ey,gy)
        .addScaledVector(dir,(Math.random()-0.5)*40);
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z;
      starColor(col, i);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color', new THREE.BufferAttribute(col,3));
    const mat = new THREE.PointsMaterial({
      size:1.4, vertexColors:true, transparent:true, opacity:0.95,
      sizeAttenuation:true, depthWrite:false, blending:THREE.AdditiveBlending,
      map: starTexture(), alphaTest:0.01,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.starLayers.push(pts);
  }

  // ---------- 성운 / 진화 요소 (절제된 딥블루 안개) ----------
  _buildNebula(){
    this.nebula = new THREE.Group();
    this.scene.add(this.nebula);
    // 채도를 낮춘 깊은 남빛/보랏빛 — 만화같지 않게 아주 은은하게
    const colors = [0x1b2750, 0x241d44, 0x14304a, 0x2a2150];
    for(let i=0;i<5;i++){
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTexture(colors[i%colors.length]),
        transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending,
      }));
      const r = 500 + Math.random()*600;
      const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
      sp.position.set(r*Math.sin(ph)*Math.cos(th), r*Math.sin(ph)*Math.sin(th), r*Math.cos(ph));
      sp.scale.setScalar(420 + Math.random()*320);
      sp.userData.baseOpacity = 0.0;
      this.nebula.add(sp);
    }
  }

  // ---------- 잔상(stardust): 폭죽이 남기는 영속 별가루 ----------
  _buildStardust(){
    this.stardustCap = 3500;
    this.stardustCount = 0;
    this.stardustHead = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.stardustCap*3),3));
    geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(this.stardustCap*3),3));
    geo.setDrawRange(0,0);
    const mat = new THREE.PointsMaterial({ size:2.0, vertexColors:true, map:dotTexture(),
      transparent:true, opacity:0.85, depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true });
    this.stardust = new THREE.Points(geo, mat);
    this.scene.add(this.stardust);
  }
  addStardust(items){
    const g = this.stardust.geometry;
    const p = g.attributes.position.array, c = g.attributes.color.array;
    const col = new THREE.Color();
    for(const it of items){
      const i = this.stardustHead;
      p[i*3]=it.pos.x; p[i*3+1]=it.pos.y; p[i*3+2]=it.pos.z;
      col.set(it.color); c[i*3]=col.r; c[i*3+1]=col.g; c[i*3+2]=col.b;
      this.stardustHead = (this.stardustHead+1)%this.stardustCap;
      this.stardustCount = Math.min(this.stardustCap, this.stardustCount+1);
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.stardustCount);
  }
  pulseBloom(a){ this.bloomPulse = Math.min(1.2, this.bloomPulse + a); }

  // ---------- 손동작 제어 API ----------
  // 채집 커서 위치(NDC). 호버/레이캐스트가 손을 따라가게 함
  setHandPointer(x, y){ this.pointer.set(x, y); }
  // 매 프레임 손동작이 원하는 카메라 운동 비율(-1..1). null이면 정지로 감쇠
  setHandRates(r){ this.handTarget = r; }
  getHoveredData(){ return this.hovered ? this.hovered.userData.data : null; }

  // 스무딩된 비율로 카메라를 1인칭 룩/줌/유영
  _applyHand(dt){
    const tgt = this.handTarget || { yaw:0, pitch:0, dolly:0, forward:0 };
    const s = 0.14;  // 스무딩 (작을수록 부드럽고 둔함)
    const c = this.handCtl;
    c.yaw     += ((tgt.yaw||0)     - c.yaw)     * s;
    c.pitch   += ((tgt.pitch||0)   - c.pitch)   * s;
    c.dolly   += ((tgt.dolly||0)   - c.dolly)   * s;
    c.forward += ((tgt.forward||0) - c.forward) * s;
    if(Math.abs(c.yaw)<1e-4 && Math.abs(c.pitch)<1e-4 && Math.abs(c.dolly)<1e-4 && Math.abs(c.forward)<1e-4) return;

    const cam = this.camera, target = this.controls.target;
    let dir = target.clone().sub(cam.position);
    let R = dir.length();
    if(R < 1e-3) return;
    dir.divideScalar(R);
    const up = new THREE.Vector3(0,1,0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();

    // ===== 시선(1인칭 룩): 카메라가 손이 가리키는 쪽을 바라봄 =====
    // 손 오른쪽 → 오른쪽을 봄 / 손 위 → 위를 봄  (반대로 느껴지면 두 부호만 뒤집기)
    const yawA   = -c.yaw   * this.handYawSpeed   * dt;
    const pitchA =  c.pitch * this.handPitchSpeed * dt;
    if(Math.abs(yawA) > 1e-6) dir.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(up, yawA));
    if(Math.abs(pitchA) > 1e-6){
      const nd = dir.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, pitchA));
      if(Math.abs(nd.y) < 0.97) dir.copy(nd);   // 천정/천저 뒤집힘 방지
    }
    dir.normalize();
    // 카메라는 제자리, 바라보는 타깃만 회전 → 둘러보는 느낌
    target.copy(cam.position).addScaledVector(dir, R);

    // ===== 줌(돌리): 시선 방향으로 전후진 =====
    if(Math.abs(c.dolly) > 1e-3){
      R = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance,
            R * (1 - c.dolly * this.handDollySpeed * dt)));
      cam.position.copy(target).addScaledVector(dir, -R);
    }
    // ===== 전진/후진 유영: 카메라+타깃 함께 이동 =====
    if(Math.abs(c.forward) > 1e-3){
      const mv = dir.clone().multiplyScalar(c.forward * this.handForwardSpeed * dt);
      cam.position.add(mv); target.add(mv);
    }
  }

  // ---------- 이모지 별 ----------
  _buildEmojis(n){
    for(let i=0;i<n;i++) this._spawnEmoji();
  }
  _spawnEmoji(near){
    const data = EMOJIS[Math.floor(Math.random()*EMOJIS.length)];
    const tex = emojiTexture(data.e, data.color);
    const mat = new THREE.SpriteMaterial({ map:tex, transparent:true, depthWrite:false });
    const sp = new THREE.Sprite(mat);
    const r = 90 + Math.random()*260;
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
    sp.position.set(r*Math.sin(ph)*Math.cos(th), r*Math.sin(ph)*Math.sin(th), r*Math.cos(ph));
    const base = 5.5 + Math.random()*4;
    sp.scale.setScalar(base);
    sp.userData = {
      data, base, phase: Math.random()*Math.PI*2,
      spin: (Math.random()-0.5)*0.4, alive:true,
    };
    this.scene.add(sp);
    this.emojiNodes.push(sp);
    return sp;
  }

  // 외부에서 호출: 현재 조준된(호버) 이모지를 채집
  grabHovered(){
    const node = this.hovered;
    if(!node || !node.userData.alive) return null;
    node.userData.alive = false;
    this._collectAnim(node);
    if(this.onCollect) this.onCollect(node.userData.data);
    // 새 이모지 보충
    setTimeout(()=>this._spawnEmoji(), 600);
    return node.userData.data;
  }

  // 채집 연출: 입자 폭발 + 카메라로 빨려듦
  _collectAnim(node){
    burstParticles(this.scene, node.position.clone(), node.userData.data.color);
    const start = performance.now();
    const from = node.position.clone();
    const animate = ()=>{
      const t = Math.min(1, (performance.now()-start)/520);
      const target = this.camera.position.clone().add(
        this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(20));
      node.position.lerpVectors(from, target, easeIn(t));
      node.scale.setScalar(node.userData.base*(1-t*0.9));
      node.material.opacity = 1-t;
      if(t<1){ requestAnimationFrame(animate); }
      else{ this.scene.remove(node); this.emojiNodes = this.emojiNodes.filter(n=>n!==node); }
    };
    animate();
  }

  // ---------- 우주 진화 ----------
  evolve(launches){
    // 발사 수에 따라 별·은은한 성운이 단계적으로 짙어짐
    const lvl = Math.min(8, Math.floor(launches/2));
    if(lvl === this.evolveLevel) return;
    this.evolveLevel = lvl;
    // 미세한 별 추가
    this._addStars(160 + lvl*40);
    // 성운 점등 (절제된 상한)
    this.nebula.children.forEach((sp,i)=>{
      sp.userData.baseOpacity = i < lvl ? Math.min(0.22, 0.05 + i*0.035) : 0;
    });
    // 노출/블룸 아주 살짝만 상승 → 모던하게
    this.renderer.toneMappingExposure = 1.0 + lvl*0.015;
    this.bloomBase = 0.85 + lvl*0.03;
  }
  _addStars(n){
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n*3);
    const col = new Float32Array(n*3);
    for(let i=0;i<n;i++){
      const r = 250 + Math.random()*1000;
      const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
      pos[i*3]=r*Math.sin(ph)*Math.cos(th); pos[i*3+1]=r*Math.sin(ph)*Math.sin(th); pos[i*3+2]=r*Math.cos(ph);
      starColor(col, i);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color', new THREE.BufferAttribute(col,3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size:1.2, vertexColors:true, transparent:true, opacity:0.85, depthWrite:false,
      blending:THREE.AdditiveBlending, map:starTexture(), sizeAttenuation:true }));
    this.scene.add(pts);
  }

  // ---------- 루프 ----------
  update(){
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // WASD 유영
    const speed = 60*dt*(this.keys['ShiftLeft']?2.4:1);
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const move = new THREE.Vector3();
    if(this.keys['KeyW']) move.add(fwd);
    if(this.keys['KeyS']) move.add(fwd.clone().negate());
    if(this.keys['KeyD']) move.add(right);
    if(this.keys['KeyA']) move.add(right.clone().negate());
    if(this.keys['KeyE']) move.add(this.camera.up);
    if(this.keys['KeyQ']) move.add(this.camera.up.clone().negate());
    if(move.lengthSq()>0){
      move.normalize().multiplyScalar(speed);
      this.camera.position.add(move);
      this.controls.target.add(move);
    }

    // 손동작 카메라 제어 (마우스/키보드와 공존)
    this._applyHand(dt);

    // 이모지 부유 + 호버 반응
    for(const node of this.emojiNodes){
      if(!node.userData.alive) continue;
      const u = node.userData;
      node.position.y += Math.sin(t*0.6 + u.phase)*0.012;
      node.material.rotation += u.spin*dt;
    }

    // 호버 레이캐스트
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.emojiNodes, false);
    const hit = hits.find(h=>h.object.userData.alive);
    if(this.hovered && this.hovered !== (hit&&hit.object)){
      this.hovered.scale.setScalar(this.hovered.userData.base);
    }
    this.hovered = hit ? hit.object : null;
    if(this.hovered){
      const u = this.hovered.userData;
      this.hovered.scale.setScalar(u.base*1.5 + Math.sin(t*5)*0.4);
    }

    // 성운 페이드 + 아주 느린 회전
    this.nebula.rotation.y += dt*0.006;
    this.nebula.children.forEach(sp=>{
      sp.material.opacity += (sp.userData.baseOpacity - sp.material.opacity)*0.02;
    });

    // 스타필드 미세 회전 → 패럴랙스 강화
    this.starLayers.forEach((p,i)=>{ p.rotation.y += dt*0.0012*(i+1); });

    // 블룸 펄스 감쇠 (폭발 순간 화면이 확 밝아짐)
    this.bloomPulse *= 0.9;
    this.bloom.strength = this.bloomBase + this.bloomPulse;

    updateParticles(dt);
    this.controls.update();
    this.composer.render();
  }

  _resize(){
    this.camera.aspect = innerWidth/innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloom.setSize(innerWidth, innerHeight);
  }

  // 카메라를 한 지점으로 영화처럼 이동 (선택)
  flyTo(pos, dist=40, ms=1400){
    const startPos = this.camera.position.clone();
    const startTgt = this.controls.target.clone();
    const dir = startPos.clone().sub(startTgt).normalize();
    const endPos = pos.clone().add(dir.multiplyScalar(dist));
    const t0 = performance.now();
    const step = ()=>{
      const t = Math.min(1, (performance.now()-t0)/ms);
      const e = easeInOut(t);
      this.camera.position.lerpVectors(startPos, endPos, e);
      this.controls.target.lerpVectors(startTgt, pos, e);
      if(t<1) requestAnimationFrame(step);
    };
    step();
  }
}

// ---------------- 헬퍼: 텍스처 ----------------
let _dot;
function dotTexture(){
  if(_dot) return _dot;
  const c=document.createElement('canvas');c.width=c.height=64;
  const x=c.getContext('2d');const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'#fff');g.addColorStop(0.4,'#fff');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.beginPath();x.arc(32,32,32,0,7);x.fill();
  _dot=new THREE.CanvasTexture(c);return _dot;
}
// 또렷한 별 점 (작고 선명한 코어 + 얕은 글로우)
let _star;
function starTexture(){
  if(_star) return _star;
  const c=document.createElement('canvas');c.width=c.height=32;
  const x=c.getContext('2d');const g=x.createRadialGradient(16,16,0,16,16,16);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.18,'rgba(255,255,255,0.95)');
  g.addColorStop(0.45,'rgba(255,255,255,0.25)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.beginPath();x.arc(16,16,16,0,7);x.fill();
  _star=new THREE.CanvasTexture(c);return _star;
}
// 밝은 별 — 부드러운 코어 + 옅은 회절 십자 스파이크
let _bstar;
function brightStarTexture(){
  if(_bstar) return _bstar;
  const s=64; const c=document.createElement('canvas');c.width=c.height=s;
  const x=c.getContext('2d');
  // 코어 글로우
  const g=x.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.12,'rgba(255,255,255,0.95)');
  g.addColorStop(0.32,'rgba(255,255,255,0.35)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.beginPath();x.arc(s/2,s/2,s/2,0,7);x.fill();
  // 회절 십자
  x.globalCompositeOperation='lighter';
  for(const ang of [0, Math.PI/2]){
    x.save();x.translate(s/2,s/2);x.rotate(ang);
    const lg=x.createLinearGradient(-s/2,0,s/2,0);
    lg.addColorStop(0,'rgba(255,255,255,0)');lg.addColorStop(0.5,'rgba(255,255,255,0.55)');lg.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=lg;x.fillRect(-s/2,-1,s,2);
    x.restore();
  }
  _bstar=new THREE.CanvasTexture(c);return _bstar;
}
// 실제 별처럼 미묘한 색온도 + 밝기 편차 (청백색 다수)
function starColor(arr, i){
  const b = 0.4 + Math.random()*0.6;           // 밝기 편차
  const k = Math.random();
  let r=1, g=1, bl=1;
  if(k < 0.42){ r=0.74; g=0.84; bl=1.0; }       // 푸른 별 (다수)
  else if(k < 0.56){ r=0.9;  g=0.93; bl=1.0; }  // 옅은 청백
  else if(k < 0.66){ r=1.0; g=0.84; bl=0.66; }  // 따뜻한 별
  else if(k < 0.70){ r=1.0; g=0.66; bl=0.55; }  // 붉은 별 (드물게)
  arr[i*3]=r*b; arr[i*3+1]=g*b; arr[i*3+2]=bl*b;
}
function cloudTexture(color){
  const c=document.createElement('canvas');c.width=c.height=256;
  const x=c.getContext('2d');
  const hex='#'+color.toString(16).padStart(6,'0');
  for(let i=0;i<14;i++){
    const cx=128+(Math.random()-0.5)*150, cy=128+(Math.random()-0.5)*150, r=40+Math.random()*70;
    const g=x.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,hex+'40');g.addColorStop(1,hex+'00');
    x.fillStyle=g;x.beginPath();x.arc(cx,cy,r,0,7);x.fill();
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
// ---------------- 채집용 입자 폭발 ----------------
const activeParticles = [];
function burstParticles(scene, pos, colorHex){
  const n=60;
  const geo=new THREE.BufferGeometry();
  const p=new Float32Array(n*3), v=[];
  for(let i=0;i<n;i++){
    p[i*3]=pos.x;p[i*3+1]=pos.y;p[i*3+2]=pos.z;
    const d=new THREE.Vector3(Math.random()-0.5,Math.random()-0.5,Math.random()-0.5).normalize().multiplyScalar(8+Math.random()*16);
    v.push(d);
  }
  geo.setAttribute('position',new THREE.BufferAttribute(p,3));
  const mat=new THREE.PointsMaterial({size:2.6,color:new THREE.Color(colorHex),transparent:true,opacity:1,
    blending:THREE.AdditiveBlending,depthWrite:false,map:dotTexture()});
  const pts=new THREE.Points(geo,mat);scene.add(pts);
  activeParticles.push({pts,v,geo,mat,scene,life:0,max:0.9});
}
function updateParticles(dt){
  for(let i=activeParticles.length-1;i>=0;i--){
    const P=activeParticles[i];P.life+=dt;
    const arr=P.geo.attributes.position.array;
    for(let j=0;j<P.v.length;j++){
      arr[j*3]+=P.v[j].x*dt;arr[j*3+1]+=P.v[j].y*dt;arr[j*3+2]+=P.v[j].z*dt;
      P.v[j].multiplyScalar(0.92);
    }
    P.geo.attributes.position.needsUpdate=true;
    P.mat.opacity=1-P.life/P.max;
    if(P.life>=P.max){P.scene.remove(P.pts);P.geo.dispose();P.mat.dispose();activeParticles.splice(i,1);}
  }
}

const easeIn = t=>t*t;
const easeInOut = t=> t<0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
