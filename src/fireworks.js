import * as THREE from 'three';

/* =========================================================================
   대형 이모지 폭죽 시스템
   - 입자 = 실제 이모지(아틀라스 텍스처) · 단일 Points + GLSL 셰이더로 수천 개
   - 위치는 셰이더에서 uTime으로 계산 (GPU 시뮬레이션, CPU 부하 거의 없음)
   - 중심에서 목표 "형상"(하트·별·꽃·초승달·나선…)으로 퍼져 모양을 완성
   - 단계: 상승(꼬리) → 섬광 → 방사 빛줄기 → 형상 폭발 → 2차 폭발 → 잔상
   ========================================================================= */

// ---------------- 텍스처 ----------------
let _spark;
function sparkTex(){
  if(_spark) return _spark;
  const c=document.createElement('canvas');c.width=c.height=64;
  const x=c.getContext('2d');const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.3,'rgba(255,255,255,0.85)');
  g.addColorStop(0.6,'rgba(255,255,255,0.25)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.beginPath();x.arc(32,32,32,0,7);x.fill();
  _spark=new THREE.CanvasTexture(c);return _spark;
}

// 조합 이모지로 텍스처 아틀라스 생성 (캐시)
const atlasCache = new Map();
function buildAtlas(emojiList){
  const key = emojiList.join('');
  if(atlasCache.has(key)) return atlasCache.get(key);
  const n = emojiList.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n/cols);
  const tile = 88;
  const cv = document.createElement('canvas');
  cv.width = cols*tile; cv.height = rows*tile;
  const ctx = cv.getContext('2d');
  ctx.font = `${tile*0.74}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  emojiList.forEach((e,i)=>{
    const cx=(i%cols)*tile + tile/2, cy=Math.floor(i/cols)*tile + tile/2;
    ctx.fillText(e, cx, cy*1.0+tile*0.04);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const atlas = { tex, cols, rows, count:n, indexOf:(e)=>emojiList.indexOf(e) };
  atlasCache.set(key, atlas);
  return atlas;
}

// ---------------- 셰이더 ----------------
// 타일 인덱스(aTile)만 넘기고, fragment에서 cols/rows로 아틀라스 좌표를 계산
const VERT_FIX = `
uniform float uTime, uExpand, uGravity, uLife, uSizeScale, uDrift;
attribute vec3 aTarget;
attribute float aTile;
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
attribute float aDelay;
varying float vTile;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
float easeOut(float t){ return 1.0 - pow(1.0 - t, 3.0); }
void main(){
  float t = max(0.0, uTime - aDelay);
  float e = easeOut(clamp(t / uExpand, 0.0, 1.0));
  vec3 off = aTarget * e;
  float g = max(0.0, t - uExpand*0.35);
  off.y -= uGravity * g * g;
  off += normalize(aTarget + vec3(0.0001)) * (t * uDrift);
  vec4 mv = modelViewMatrix * vec4(off, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uSizeScale / max(1.0, -mv.z), 0.8, 64.0);
  float life = clamp(1.0 - (t - uExpand) / uLife, 0.0, 1.0);
  float fin  = clamp(t / 0.06, 0.0, 1.0);
  vAlpha = life * life * fin;
  vColor = aColor;
  vSeed  = aSeed;
  vTile  = aTile;
}
`;
const FRAG = `
precision highp float;
uniform sampler2D uAtlas;
uniform float uCols, uRows, uTime, uSparkle, uHueShift;
varying float vTile;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
vec3 hueShift(vec3 col, float a){
  const vec3 k = vec3(0.57735);
  float c = cos(a);
  return col*c + cross(k,col)*sin(a) + k*dot(k,col)*(1.0-c);
}
void main(){
  float col = mod(vTile, uCols);
  float row = floor(vTile / uCols);
  vec2 tile = vec2(1.0/uCols, 1.0/uRows);
  vec2 uv = (vec2(col, row) + gl_PointCoord) * tile;
  vec4 tex = texture2D(uAtlas, uv);
  if(tex.a < 0.06) discard;
  vec3 c = vColor;
  if(uHueShift > 0.5) c = hueShift(c, uTime*1.6 + vSeed*6.2831);
  float a = vAlpha;
  if(uSparkle > 0.0) a *= (1.0 - 0.5*uSparkle) + 0.5*uSparkle*sin(uTime*20.0 + vSeed*40.0);
  gl_FragColor = vec4(tex.rgb * c * 1.35, tex.a * a);
}
`;

// ---------------- 형상(목표 위치) 생성 ----------------
function rand(){ return Math.random(); }
function shapePoint(figure, i, n){
  let x=0,y=0,z=0;
  const jz = ()=> (rand()-0.5)*0.18;
  switch(figure){
    case 'heart': {
      const t = (i/n)*Math.PI*2 + (rand()-0.5)*0.04;
      // 외곽선 위주(70%) + 내부 채움(30%) → 하트 실루엣이 또렷
      const fill = rand()<0.7 ? (0.86 + 0.14*rand()) : (0.3 + 0.5*rand());
      x = 16*Math.pow(Math.sin(t),3);
      y = 13*Math.cos(t) - 5*Math.cos(2*t) - 2*Math.cos(3*t) - Math.cos(4*t);
      x = x/16*fill; y = y/16*fill; z = jz();
      break;
    }
    case 'star': {
      const spike = Math.floor(rand()*5);
      const a = spike*(Math.PI*2/5) + (rand()-0.5)*0.16;
      // 뾰족하게 뻗는 빛줄기 — 외곽 밀집
      const len = 0.45 + 0.55*Math.pow(rand(),0.5);
      x = Math.cos(a)*len; y = Math.sin(a)*len; z = jz()*0.6;
      break;
    }
    case 'flower': {
      const th = (i/n)*Math.PI*2*5 + (rand()-0.5)*0.05;
      const r = Math.abs(Math.cos(2.5*th)) * (rand()<0.7 ? (0.85+0.15*rand()) : (0.35+0.4*rand()));
      x = Math.cos(th)*r; y = Math.sin(th)*r; z = jz();
      break;
    }
    case 'crescent': {
      // 큰 원 - 오프셋 작은 원 (초승달)
      let tx, ty, ok=false, guard=0;
      do{
        const a = rand()*Math.PI*2, r = Math.sqrt(rand());
        tx = Math.cos(a)*r; ty = Math.sin(a)*r;
        const dx = tx-0.42, dy = ty-0.04;
        ok = (dx*dx+dy*dy) > 0.62;          // 작은 원 안쪽 제거
        guard++;
      }while(!ok && guard<8);
      x = tx; y = ty; z = jz();
      break;
    }
    case 'butterfly': {
      const t = (i/n)*Math.PI*12;
      const r = Math.exp(Math.cos(t)) - 2*Math.cos(4*t) - Math.pow(Math.sin(t/12),5);
      x = Math.sin(t)*r/3.2; y = Math.cos(t)*r/3.2 - 0.2; z = jz();
      break;
    }
    case 'ring': {
      const a = rand()*Math.PI*2;
      const r = 0.85 + (rand()-0.5)*0.18;
      x = Math.cos(a)*r; y = Math.sin(a)*r; z = (rand()-0.5)*0.4;
      break;
    }
    case 'galaxy': {
      const arm = Math.floor(rand()*3)*(Math.PI*2/3);
      const tt = Math.pow(rand(),0.5);
      const a = arm + tt*Math.PI*3.2;
      const r = tt;
      x = Math.cos(a)*r + (rand()-0.5)*0.12;
      y = Math.sin(a)*r + (rand()-0.5)*0.12; z = (rand()-0.5)*0.3*r;
      break;
    }
    case 'starburst': {
      const a = rand()*Math.PI*2, ph=Math.acos(2*rand()-1);
      const r = Math.pow(rand(),0.35);    // 외곽 밀집(긴 빛줄기 느낌)
      x = Math.sin(ph)*Math.cos(a)*r; y=Math.sin(ph)*Math.sin(a)*r; z=Math.cos(ph)*r;
      break;
    }
    default: { // sphere — 가운데가 밝은 구형 폭죽
      const a = rand()*Math.PI*2, ph=Math.acos(2*rand()-1);
      const r = 0.55 + 0.45*Math.pow(rand(),0.5);
      x = Math.sin(ph)*Math.cos(a)*r; y=Math.sin(ph)*Math.sin(a)*r; z=Math.cos(ph)*r;
    }
  }
  return [x,y,z];
}

// 조합 → 형상
function pickFigure(ids){
  if(ids.includes('heart'))   return 'heart';
  if(ids.includes('star'))    return 'star';
  if(ids.includes('blossom')) return 'flower';
  if(ids.includes('moon'))    return 'crescent';
  if(ids.includes('crystal')||ids.includes('gem')) return 'galaxy';
  if(ids.includes('music'))   return 'ring';
  if(ids.includes('bolt'))    return 'starburst';
  if(ids.includes('leaf'))    return 'butterfly';
  return 'sphere';
}
// 조합 → 색 보강
function figureColors(ids, palette){
  const c = [...palette];
  if(ids.includes('heart'))   c.unshift('#ff4f7e','#ff8ad1','#ff6f9d');
  if(ids.includes('star'))    c.unshift('#ffe27a','#fff4c2','#ffd24a');
  if(ids.includes('blossom')) c.unshift('#ff9ed2','#ffc6e6','#ffb3da');
  if(ids.includes('moon'))    c.unshift('#bfd0ff','#9ec5ff','#dfe9ff');
  if(ids.includes('bolt'))    c.unshift('#fff7c0','#ffffff');
  if(ids.includes('gem'))     c.unshift('#7be0ff','#bdf3ff');
  if(ids.includes('fire'))    c.unshift('#ff7a3c','#ffb14a');
  return c;
}

// ---------------- 시스템 ----------------
export class FireworkSystem {
  constructor(universe){
    this.u = universe;
    this.scene = universe.scene;
    this.camera = universe.camera;
    this.shells = [];
    this.bursts = [];
    this.rays = [];
    this.flashes = [];
    this.queued = [];
    this._sizeScale = this._calcSizeScale();
    addEventListener('resize', ()=>{ this._sizeScale = this._calcSizeScale(); });
  }

  _calcSizeScale(){
    const fov = this.camera.fov * Math.PI/180;
    return innerHeight / (2*Math.tan(fov/2));
  }

  // recipe → 폭죽 발사
  launch(recipe){
    const cam = this.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const up = cam.up.clone().normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    // 화면 중앙 상단에 크게 터지도록: 정면 거리 + 약간 위
    const apex = cam.position.clone()
      .add(fwd.clone().multiplyScalar(150))
      .add(up.clone().multiplyScalar(18 + Math.random()*12))
      .add(right.clone().multiplyScalar((Math.random()-0.5)*40));
    const base = apex.clone().add(up.clone().multiplyScalar(-(125 + Math.random()*20)));

    // 발사 순간 카메라를 향하도록 형상 방향 고정 (정면이 보이게)
    // 형상의 로컬 +Z(법선)를 카메라 쪽으로, 로컬 +Y를 카메라 위쪽으로
    const toCam = cam.position.clone().sub(apex).normalize();
    let xAxis = new THREE.Vector3().crossVectors(up, toCam);
    if(xAxis.lengthSq() < 1e-6) xAxis.set(1,0,0);
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(toCam, xAxis).normalize();
    const orient = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(xAxis, yAxis, toCam));

    const p = recipe.params;
    const tailCol = new THREE.Color(figureColors(recipe.ids, p.palette)[0]);
    // 상승 셸 (밝은 머리 + 꼬리 스파크)
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map:sparkTex(), color:tailCol,
      transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false }));
    head.scale.setScalar(7 + (p.tail?4:0));
    head.position.copy(base);
    this.scene.add(head);

    this.shells.push({
      head, base, apex, t:0,
      dur: (1.5/Math.max(0.6,p.speed)),
      recipe, tailCol, lastEmit:0, orient,
    });
    return apex;
  }

  // 형상 폭발 생성 (orient: 발사 시점 카메라를 향한 회전)
  _explode(center, recipe, scale, particleCount, isPrimary, orient){
    const p = recipe.params;
    const ids = recipe.ids;
    const q = orient || new THREE.Quaternion();
    const v = new THREE.Vector3();
    const figure = isPrimary ? pickFigure(ids) : (Math.random()<0.5?'sphere':'starburst');
    const atlas = buildAtlas(recipe.emojis);
    const colors = figureColors(ids, p.palette).map(c=>new THREE.Color(c));

    const n = particleCount;
    const aTarget = new Float32Array(n*3);
    const aTile   = new Float32Array(n);
    const aColor  = new Float32Array(n*3);
    const aSize   = new Float32Array(n);
    const aSeed   = new Float32Array(n);
    const aDelay  = new Float32Array(n);
    const position= new Float32Array(n*3); // 모두 0 (오브젝트를 center로 이동)

    for(let i=0;i<n;i++){
      const sp = shapePoint(figure, i, n);
      const rr = Math.hypot(sp[0],sp[1],sp[2]) || 0.0001;
      // 형상을 카메라 쪽으로 회전 후 스케일 (정면이 보이도록)
      v.set(sp[0], sp[1], sp[2]).applyQuaternion(q).multiplyScalar(scale);
      aTarget[i*3]   = v.x;
      aTarget[i*3+1] = v.y;
      aTarget[i*3+2] = v.z;
      aTile[i] = atlas.indexOf(recipe.emojis[i % recipe.emojis.length]);
      const c = colors[i % colors.length];
      aColor[i*3]=c.r; aColor[i*3+1]=c.g; aColor[i*3+2]=c.b;
      // 이모지가 이모지로 보이도록 입자를 키움 (중심 크고 밝게, 외곽 작게)
      aSize[i] = (1.18 - rr*0.42) * (0.85+Math.random()*0.4) + (p.glow*0.14);
      aSeed[i] = Math.random();
      aDelay[i]= rr*0.12*Math.random();        // 외곽이 살짝 늦게 → 퍼지는 형성감
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position,3));
    geo.setAttribute('aTarget',  new THREE.BufferAttribute(aTarget,3));
    geo.setAttribute('aTile',    new THREE.BufferAttribute(aTile,1));
    geo.setAttribute('aColor',   new THREE.BufferAttribute(aColor,3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(aSize,1));
    geo.setAttribute('aSeed',    new THREE.BufferAttribute(aSeed,1));
    geo.setAttribute('aDelay',   new THREE.BufferAttribute(aDelay,1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), scale*2.5);

    const speedF = p.speed;
    const mat = new THREE.ShaderMaterial({
      uniforms:{
        uTime:{value:0}, uExpand:{value: (figure==='starburst'?0.5:0.8)/Math.max(0.7,speedF)},
        uGravity:{value: 4 + p.gravity*10}, uLife:{value: 1.6 + p.trail*2.2},
        uSizeScale:{value:this._sizeScale}, uDrift:{value: 2 + speedF*3 + (p.streak?6:0)},
        uAtlas:{value:atlas.tex}, uCols:{value:atlas.cols}, uRows:{value:atlas.rows},
        uSparkle:{value: p.sparkle>0?Math.min(1,p.sparkle):0.0},
        uHueShift:{value: p.hueShift?1:0},
      },
      vertexShader:VERT_FIX, fragmentShader:FRAG,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(center);
    this.scene.add(pts);
    this.bursts.push({ pts, mat, geo, t:0, max: mat.uniforms.uLife.value + mat.uniforms.uExpand.value + 1.0 });

    // 부수 연출
    this._flash(center, colors[0], scale*(isPrimary?0.5:0.32));
    if(isPrimary || Math.random()<0.5)
      this._rayBurst(center, colors, scale, ids);
    this.u.pulseBloom(isPrimary?0.5:0.25);
    // 터진 자리에 불꽃 잔상을 남기지 않는다 (모든 입자는 완전히 사라짐)
  }

  // 중심 섬광 (짧고 강렬하게 번쩍 — 입자 형상을 가리지 않도록)
  _flash(pos, color, size){
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:sparkTex(), color,
      transparent:true, opacity:0.95, blending:THREE.AdditiveBlending, depthWrite:false }));
    sp.position.copy(pos); sp.scale.setScalar(size*0.5);
    this.scene.add(sp);
    this.flashes.push({ sp, t:0, max:0.4, size });
  }

  // 방사형 긴 빛줄기 (LineSegments)
  _rayBurst(center, colors, scale, ids){
    const sharp = ids.includes('bolt') || ids.includes('star');
    const count = sharp ? 16 : 9;
    const positions = new Float32Array(count*2*3);
    const cols = new Float32Array(count*2*3);
    for(let i=0;i<count;i++){
      const a = rand()*Math.PI*2, ph=Math.acos(2*rand()-1);
      const dir = new THREE.Vector3(Math.sin(ph)*Math.cos(a), Math.sin(ph)*Math.sin(a), Math.cos(ph));
      const len = scale*(sharp?0.62:0.45)*(0.75+rand()*0.4);
      const c = colors[i%colors.length];
      // 시작(중심)
      positions[i*6]=0;positions[i*6+1]=0;positions[i*6+2]=0;
      cols[i*6]=c.r;cols[i*6+1]=c.g;cols[i*6+2]=c.b;
      // 끝
      positions[i*6+3]=dir.x*len;positions[i*6+4]=dir.y*len;positions[i*6+5]=dir.z*len;
      cols[i*6+3]=c.r*0.2;cols[i*6+4]=c.g*0.2;cols[i*6+5]=c.b*0.2;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geo.setAttribute('color',new THREE.BufferAttribute(cols,3));
    const mat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.9,
      blending:THREE.AdditiveBlending,depthWrite:false});
    const lines=new THREE.LineSegments(geo,mat);
    lines.position.copy(center);
    this.scene.add(lines);
    this.rays.push({lines,mat,geo,t:0,max:0.7});
  }

  update(dt){
    dt = Math.min(0.05, dt);
    // 예약된 2차 폭발
    for(let i=this.queued.length-1;i>=0;i--){
      const q=this.queued[i]; q.t-=dt;
      if(q.t<=0){ this._explode(q.center, q.recipe, q.scale, q.count, false, q.orient); this.queued.splice(i,1); }
    }
    // 상승 셸
    for(let i=this.shells.length-1;i>=0;i--){
      const s=this.shells[i]; s.t+=dt;
      const k=Math.min(1,s.t/s.dur);
      const cur=new THREE.Vector3().lerpVectors(s.base,s.apex,easeOut(k));
      s.head.position.copy(cur);
      s.head.material.opacity=0.7+Math.sin(s.t*40)*0.3;
      // 꼬리 스파크 (짧은 혜성 꼬리)
      s.lastEmit+=dt;
      if(s.lastEmit>0.022){
        s.lastEmit=0;
        emitSpark(this.scene, cur, s.tailCol, s.recipe.params.tail);
      }
      if(k>=1){
        this.scene.remove(s.head); s.head.material.dispose();
        // === 1차 폭발 ===
        const p=s.recipe.params;
        // 발사 거리(≈150)에서 화면을 크게 채우되 형상 전체가 보이도록 (각반경 ~24°)
        const scale = 44 + p.spread*13 + (s.recipe.ids.includes('balloon')?22:0);
        const count = Math.min(7000, Math.floor(2600 + p.particleCount*9 + p.spread*700));
        this._explode(s.apex, s.recipe, scale, count, true, s.orient);
        // === 2차 폭발 예약 ===
        const sec = Math.min(6, 1 + s.recipe.ids.length + (s.recipe.ids.includes('balloon')?1:0));
        for(let j=0;j<sec;j++){
          const off = new THREE.Vector3((Math.random()-0.5),(Math.random()-0.3),(Math.random()-0.5))
            .multiplyScalar(scale*0.95);
          this.queued.push({
            center: s.apex.clone().add(off),
            recipe: s.recipe,
            scale: scale*(0.3+Math.random()*0.22),
            count: Math.floor(450+Math.random()*550),
            t: 0.3 + Math.random()*0.7,
            orient: s.orient,
          });
        }
        this.shells.splice(i,1);
      }
    }
    // 폭발 입자 (셰이더 uTime만 갱신)
    for(let i=this.bursts.length-1;i>=0;i--){
      const b=this.bursts[i]; b.t+=dt;
      b.mat.uniforms.uTime.value=b.t;
      if(b.t>=b.max){ this.scene.remove(b.pts); b.geo.dispose(); b.mat.dispose(); this.bursts.splice(i,1); }
    }
    // 섬광
    for(let i=this.flashes.length-1;i>=0;i--){
      const f=this.flashes[i]; f.t+=dt; const k=f.t/f.max;
      f.sp.scale.setScalar(f.size*(0.5+k*0.9));
      f.sp.material.opacity=Math.max(0,0.95*(1-k)*(1-k));
      if(k>=1){ this.scene.remove(f.sp); f.sp.material.dispose(); this.flashes.splice(i,1); }
    }
    // 빛줄기
    for(let i=this.rays.length-1;i>=0;i--){
      const r=this.rays[i]; r.t+=dt; const k=r.t/r.max;
      r.mat.opacity=Math.max(0, (k<0.15? k/0.15 : 1-(k-0.15)/0.85)) * 0.6;
      r.lines.scale.setScalar(0.85+k*0.25);
      if(k>=1){ this.scene.remove(r.lines); r.geo.dispose(); r.mat.dispose(); this.rays.splice(i,1); }
    }
    updateSparks(dt);
  }
}

// ---------------- 상승 꼬리 스파크 (CPU 소형 풀) ----------------
const sparkPool=[]; let sparkPoints=null, sparkGeo=null, sparkScene=null;
const SPARK_CAP=900;
function ensureSparks(scene){
  if(sparkPoints) return;
  sparkScene=scene;
  sparkGeo=new THREE.BufferGeometry();
  sparkGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(SPARK_CAP*3),3));
  sparkGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(SPARK_CAP*3),3));
  sparkGeo.setDrawRange(0,0);
  const mat=new THREE.PointsMaterial({size:3.2,vertexColors:true,map:sparkTex(),transparent:true,
    opacity:1,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true});
  sparkPoints=new THREE.Points(sparkGeo,mat); scene.add(sparkPoints);
}
function emitSpark(scene, pos, color, strong){
  ensureSparks(scene);
  const cnt = strong?2:1;
  for(let i=0;i<cnt;i++){
    sparkPool.push({
      pos: pos.clone().add(new THREE.Vector3((Math.random()-0.5)*3,(Math.random()-0.5)*3,(Math.random()-0.5)*3)),
      vel: new THREE.Vector3((Math.random()-0.5)*4,-5-Math.random()*4,(Math.random()-0.5)*4),
      color, life:0, max:0.22+Math.random()*0.16,
    });
    if(sparkPool.length>SPARK_CAP) sparkPool.shift();
  }
}
function updateSparks(dt){
  if(!sparkPoints) return;
  const p=sparkGeo.attributes.position.array, c=sparkGeo.attributes.color.array;
  let w=0;
  for(let i=sparkPool.length-1;i>=0;i--){
    const s=sparkPool[i]; s.life+=dt;
    if(s.life>=s.max){ sparkPool.splice(i,1); continue; }
    s.pos.addScaledVector(s.vel,dt); s.vel.multiplyScalar(0.94);
  }
  for(const s of sparkPool){
    if(w>=SPARK_CAP) break;
    p[w*3]=s.pos.x;p[w*3+1]=s.pos.y;p[w*3+2]=s.pos.z;
    const a=1-s.life/s.max;
    c[w*3]=s.color.r*a;c[w*3+1]=s.color.g*a;c[w*3+2]=s.color.b*a;
    w++;
  }
  sparkGeo.attributes.position.needsUpdate=true;
  sparkGeo.attributes.color.needsUpdate=true;
  sparkGeo.setDrawRange(0,w);
}

const easeOut=t=>1-Math.pow(1-t,2);
