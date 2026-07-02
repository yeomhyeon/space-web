// 이모지 = 폭죽의 속성. 각 이모지는 발사 연출의 한 특성을 담당한다.
// attr: 어떤 특성을 제어하는가  ·  color: 기본 색  ·  name: 한글 라벨
export const EMOJIS = [
  { id:'star',    e:'⭐', name:'별',     attr:'shape',    sub:'퍼짐 형태', color:'#ffe27a' },
  { id:'heart',   e:'❤️', name:'심장',   attr:'color',    sub:'색감',     color:'#ff5b7f' },
  { id:'spark',   e:'✨', name:'반짝',   attr:'sparkle',  sub:'반짝임',   color:'#fff4c2' },
  { id:'moon',    e:'🌙', name:'달',     attr:'trail',    sub:'잔상',     color:'#bfd0ff' },
  { id:'bolt',    e:'⚡', name:'번개',   attr:'speed',    sub:'속도',     color:'#ffe066' },
  { id:'blossom', e:'🌸', name:'벚꽃',   attr:'petal',    sub:'꽃잎 형태', color:'#ff9ed2' },
  { id:'gem',     e:'💎', name:'보석',   attr:'texture',  sub:'입자 질감', color:'#7be0ff' },
  { id:'fire',    e:'🔥', name:'불꽃',   attr:'tail',     sub:'꼬리 효과', color:'#ff7a3c' },
  { id:'rainbow', e:'🌈', name:'무지개', attr:'hueshift', sub:'색 변화',   color:'#9affc0' },
  { id:'balloon', e:'🎈', name:'풍선',   attr:'size',     sub:'폭발 크기', color:'#ff6b8b' },
  { id:'comet',   e:'☄️', name:'혜성',   attr:'streak',   sub:'직선 궤적', color:'#ffcaa0' },
  { id:'snow',    e:'❄️', name:'눈',     attr:'shimmer',  sub:'결정 산란', color:'#cfeeff' },
  { id:'sun',     e:'🌞', name:'태양',   attr:'glow',     sub:'중심 광휘', color:'#ffd24a' },
  { id:'music',   e:'🎵', name:'음표',   attr:'wave',     sub:'파동 퍼짐', color:'#c79bff' },
  { id:'leaf',    e:'🍃', name:'잎',     attr:'drift',    sub:'흩날림',   color:'#a8f0a0' },
  { id:'crystal', e:'🔮', name:'수정',   attr:'spiral',   sub:'나선 회전', color:'#b59bff' },
];

export const EMOJI_BY_ID = Object.fromEntries(EMOJIS.map(x => [x.id, x]));

// 이름 생성용 사전 — 속성에 따라 가중
export const NAME_ADJ = {
  shape:['Astral','Prism','Halo','Orbit','Vortex'],
  color:['Crimson','Rose','Scarlet','Velvet','Ruby'],
  sparkle:['Glitter','Lumen','Stellar','Twinkle','Radiant'],
  trail:['Lunar','Phantom','Echo','Drift','Mirage'],
  speed:['Volt','Rapid','Pulse','Surge','Bolt'],
  petal:['Sakura','Bloom','Petal','Blossom','Garden'],
  texture:['Crystal','Prism','Facet','Glass','Diamond'],
  tail:['Ember','Inferno','Phoenix','Blaze','Cinder'],
  hueshift:['Iris','Spectrum','Chroma','Aurora','Opal'],
  size:['Titan','Grand','Mega','Colossal','Giant'],
  streak:['Comet','Meteor','Streak','Trace','Arrow'],
  shimmer:['Frost','Crystal','Snow','Glacier','Hoar'],
  glow:['Solar','Corona','Helio','Radiant','Dawn'],
  wave:['Sonic','Wave','Echo','Harmonic','Pulse'],
  drift:['Zephyr','Drift','Float','Gossamer','Breeze'],
  spiral:['Spiral','Helix','Twist','Coil','Whirl'],
};
export const NAME_NOUN = ['Bloom','Cascade','Nova','Bouquet','Veil','Symphony','Garden','Halo','Dream','Rain','Burst','Crown','Aurora','Pulse','Mirage','Storm'];

// 도감 목표치
export const ARCHIVE_GOAL = 250;
