// 영속 상태: 컬렉션 · 도감 · 발사 횟수.  localStorage 기반.
const KEY = 'stellaria.save.v1';

const defaultState = () => ({
  collection: {},   // { emojiId: count }
  archive: {},      // { recipeKey: {name,rarity,emojis,count,first,recipe} }
  launches: 0,      // 누적 발사 수 → 우주 진화 지표
});

let state = load();

function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw) return Object.assign(defaultState(), JSON.parse(raw));
  }catch(e){ /* ignore */ }
  return defaultState();
}
function persist(){
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
}

export const store = {
  get(){ return state; },

  // ---- 컬렉션 ----
  addEmoji(id){
    state.collection[id] = (state.collection[id]||0) + 1;
    persist();
    return state.collection[id];
  },
  collectionTotal(){ return Object.values(state.collection).reduce((a,b)=>a+b,0); },
  ownedIds(){ return Object.keys(state.collection).filter(k=>state.collection[k]>0); },
  count(id){ return state.collection[id]||0; },

  // ---- 도감 ----
  recordFirework(recipe){
    const key = recipe.key;
    const existing = state.archive[key];
    if(existing){
      existing.count++;
    }else{
      state.archive[key] = {
        name: recipe.name, rarity: recipe.rarity,
        emojis: recipe.emojis, count:1,
        first: new Date().toISOString().slice(0,10),
        recipe,
      };
    }
    persist();
    return state.archive[key];
  },
  isNewFirework(key){ return !state.archive[key]; },
  archiveList(){ return Object.entries(state.archive).map(([k,v])=>({key:k,...v})); },
  archiveCount(){ return Object.keys(state.archive).length; },

  // ---- 발사 ----
  addLaunch(){ state.launches++; persist(); return state.launches; },
  launches(){ return state.launches; },

  reset(){ state = defaultState(); persist(); },
};
