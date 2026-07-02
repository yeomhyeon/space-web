import { EMOJI_BY_ID, NAME_ADJ, NAME_NOUN } from './data.js';

// 시드 기반 의사난수 — 같은 조합이라도 약간씩 다른 결과(발견의 재미)를 위해
function hashSeed(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h>>>0);
}
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 선택된 이모지 id 배열 → 폭죽 레시피
export function forge(ids){
  const sorted = [...ids].sort();
  const key = sorted.join('+');
  // 약간의 랜덤 변주: 시드에 작은 변이 추가
  const variant = Math.floor(Math.random()*4);
  const rnd = mulberry32(hashSeed(key) + variant*7919);

  const emojis = ids.map(id => EMOJI_BY_ID[id]);

  // 속성 집계
  const attrs = {};
  for(const em of emojis){ attrs[em.attr] = (attrs[em.attr]||0) + 1; }

  // 색 팔레트: 선택 이모지 색을 기반으로
  const palette = emojis.map(e => e.color);

  // 파생 파라미터 (속성 → 수치)
  const has = a => !!attrs[a];
  const params = {
    particleCount: 160 + (attrs.size?120:0) + (attrs.shape?60:0) + Math.floor(rnd()*80),
    spread: 1 + (attrs.size?0.7:0) + (attrs.shape?0.4:0) + rnd()*0.4,
    speed: 1 + (attrs.speed?0.9:0) + (attrs.streak?0.5:0) + rnd()*0.3,
    gravity: 0.45 - (attrs.drift?0.25:0) - (attrs.wave?0.1:0),
    trail: has('trail') ? 0.94 : (has('tail')?0.9:0.82),
    sparkle: (attrs.sparkle||0)*0.4 + (attrs.shimmer?0.3:0) + (attrs.glow?0.2:0),
    hueShift: has('hueshift') ? 1 : 0,
    petal: has('petal') || has('drift'),
    spiral: has('spiral'),
    wave: has('wave'),
    streak: has('streak'),
    shape: pickShape(attrs, rnd),
    palette,
    glow: 0.6 + (attrs.glow?0.5:0) + (attrs.sparkle?0.2:0),
  };

  // 이름
  const name = makeName(emojis, attrs, rnd);

  // 희귀도: 다양성 + 개수 + 약간의 랜덤
  const diversity = new Set(emojis.map(e=>e.attr)).size;
  let stars = Math.min(5, 1 + Math.round(diversity*0.7) + (ids.length>=5?1:0));
  if(rnd() > 0.82) stars = Math.min(5, stars+1);
  const rarity = '★'.repeat(stars) + '☆'.repeat(5-stars);

  return {
    key, name, rarity, stars,
    emojis: emojis.map(e=>e.e),
    ids,
    params,
    desc: describe(emojis, attrs),
  };
}

function pickShape(attrs, rnd){
  if(attrs.petal) return 'petal';
  if(attrs.spiral) return 'spiral';
  if(attrs.wave) return 'ring';
  if(attrs.streak) return 'streak';
  if(attrs.shape && rnd()>0.5) return 'star';
  return 'sphere';
}

function makeName(emojis, attrs, rnd){
  // 가장 많은 속성을 대표로
  const domAttr = Object.entries(attrs).sort((a,b)=>b[1]-a[1])[0][0];
  const adjPool = NAME_ADJ[domAttr] || NAME_ADJ.shape;
  const adj = adjPool[Math.floor(rnd()*adjPool.length)];
  const noun = NAME_NOUN[Math.floor(rnd()*NAME_NOUN.length)];
  return `${adj} ${noun}`;
}

function describe(emojis, attrs){
  const bits = [];
  if(attrs.petal) bits.push('꽃잎처럼 흩날리며');
  if(attrs.color) bits.push('붉은 색감으로 물들고');
  if(attrs.hueshift) bits.push('무지갯빛으로 변하며');
  if(attrs.trail) bits.push('긴 잔상을 남기는');
  if(attrs.sparkle) bits.push('강하게 반짝이는');
  if(attrs.size) bits.push('거대하게 퍼지는');
  if(attrs.spiral) bits.push('나선을 그리는');
  if(attrs.tail) bits.push('타오르는 꼬리를 가진');
  if(attrs.speed) bits.push('빠르게 솟구치는');
  if(attrs.streak) bits.push('유성처럼 직선으로 내달리는');
  if(bits.length===0) bits.push('은은하게 퍼지는');
  return bits.slice(0,3).join(' ') + ' 폭죽';
}
