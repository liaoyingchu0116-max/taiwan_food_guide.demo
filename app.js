(() => {
  'use strict';
  const demo=window.FOOD_DEMO||null;
  const fetch=(...args)=>demo?demo.fetch(...args):globalThis.fetch(...args);
  const localStorage=demo?demo.storage:globalThis.localStorage;
  const stores = window.FOOD_STORES;
  const byId = new Map(stores.map(s => [s.id, s]));
  const typeGroups = [
    {id:'chinese',label:'中式／台式',tags:['中式','台式','港式','水餃','麵食','火雞肉飯','牛肉麵','客家菜','海鮮']},
    {id:'japanese-korean',label:'日式／韓式',tags:['日式','拉麵','壽司','燒肉','韓式']},
    {id:'south-asian',label:'南洋／印度',tags:['印度料理','泰式','越式','南洋']},
    {id:'cafe-sweets',label:'咖啡／甜點',tags:['咖啡','甜點','麵包','泡芙','手搖飲','茶飲']},
    {id:'western',label:'西式／輕食',tags:['西式','義式','法式','輕食','早午餐','漢堡','披薩','餐酒館']},
    {id:'specialties',label:'依料理找',tags:['咖哩','火鍋','素食']}
  ];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const LEGACY_STORAGE = 'food-star-map.personal.v1';
  let STORAGE='food-star-map.anonymous.v2', viewer=null, ready=false, community={}, syncPending=false, syncRunning=false, syncError='';
  let legacy=null;try{legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE)||'null')}catch{}
  const validRating = n => n === null || (typeof n === 'number' && n >= .5 && n <= 5 && Number.isInteger(n * 2));
  const blankRecord=()=>({rating:null,eaten:false,wish:false,best:false,note:'',notePublic:false,tags:[],comparison:null});
  const emptyRecords=()=>Object.fromEntries(stores.map(s=>[s.id,blankRecord()]));
  let records=emptyRecords(),syncedRecords={},syncedVisitIds=new Set(),visits=[],menus=[],profileTag='',bootstrapRunning=false;
  const recommendationReasons=['口味更合','咖啡更喜歡','麵包／甜點更好','同價位更划算','份量更適合','環境更舒服'];
  const app = document.getElementById('app');
  let page = 'explore', profileTab = 'eaten', query = '', city = '', status = 'all', sort = 'nearby', type = '', layout = 'list';
  const RESULTS_PER_PAGE=15,RESULTS_MAX_PAGES=10;
  let resultPage=1,resultScope='';
  let selectedId = stores[0].id, ratingId = null, draftRating = null, map = null, markers = [], mapMode = 'embed', sdkLoading = null, filteredBounds = null;
  let origin = stores[0].coordinates || null, originLabel = '中正區起點', mapNotice = '';
  let detailId=null,detailReturn='explore',detailScroll=0,detailTab='reviews',recommendationScope='all',recommendationExpanded=false;
  const restaurantCommunity=new Map();
  let reputation=null,articleFeed={loaded:false,loading:false,articles:[],critics:[],error:''},peopleFeed={loaded:false,loading:false,people:[],error:''},articleFilter='all',personTicket=0,articleTicket=0,peopleTicket=0,reputationTicket=0;
  const waitLabels={seat:{available:'有空位',full:'滿座',paused:'停止接客'},wait:{unknown:'等候時間未知',none:'不用等',under10:'10 分鐘內', '10to20':'10–20 分鐘','20to40':'20–40 分鐘',over40:'40 分鐘以上'},source:{observed:'現場觀察／已等候',staff:'店員告知'},turnover:{unknown:'不確定',fast:'翻桌快',normal:'翻桌普通',slow:'翻桌慢'},party:{'1':'1 人','2':'2 人','3to4':'3–4 人', '5plus':'5 人以上'},service:{dinein:'內用',takeout:'外帶'}};
  let addStoreMode='catalog';
  let pickerSlot = null, wheelMode = 'store', wheelTypes = new Set(['咖啡','拉麵','台式','甜點']), spinning = false, wheelRotation = 0, wheelTimer;
  let wheelStoreIds=[],wheelResult=null,wheelTicket=0,wheelReturn='explore',wheelScroll=0;
  let wheelArea='nearby',wheelCity='',wheelDistrict='',wheelStatus='all',wheelStoreType=new Set(),wheelRadius=1,wheelOrigin=null,wheelLocating=false,wheelLocationNote='';
  const mapPanel = document.createElement('section');
  mapPanel.className = 'map-column';
  mapPanel.setAttribute('aria-label', 'Google Maps 餐廳地圖');
  mapPanel.innerHTML = `<div class="map-top"><strong id="map-area">台北市中正區</strong><div class="row"><button type="button" data-action="locate">◎ 我的位置</button><button type="button" data-action="setup-key" id="multi-map-button">多店圖釘</button><button type="button" data-action="search-area" id="search-area-button" hidden>搜尋此區域</button></div></div><div class="map-canvas"><div class="map-loading" id="map-loading"><p>載入 Google 地圖…</p></div><iframe id="google-map-frame" title="Google Maps 餐廳位置" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="sdk-canvas" id="sdk-canvas" hidden></div></div><div id="map-card"></div><div class="map-foot" id="map-foot">Google 地圖顯示店家位置；星等與愛心來自你的收藏。</div>`;
  const iframe = mapPanel.querySelector('iframe');
  iframe.addEventListener('load', () => mapPanel.querySelector('#map-loading').hidden = true);
  let toastTimer;
  function toast(message) {
    const t = document.getElementById('toast'); t.textContent = message; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  let authProvider='ChatGPT';
  const signin=()=>'/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search+location.hash);
  function requireLogin(){if(!ready||!viewer){renderLogin();return false;}return true;}
  function renderLogin(){const d=document.getElementById('picker-dialog');d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">登入後記錄我的美食</h2><button type="button" data-close="picker-dialog">×</button></div><p>每位食友有自己的星等、待吃清單與五間此生最愛。大家的星等會彙整到餐廳頁。</p><a class="button-link primary" target="_top" href="${signin()}">使用 ${authProvider} 登入</a>`;showDialog('picker-dialog');}
  async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok){const error=new Error(data.error||'暫時無法儲存');error.code=data.code;throw error;}return data;}
  function installCatalog(items){
    for(const s of items){if(!s||!s.id||!Array.isArray(s.types))continue;const old=byId.get(s.id);if(old)Object.assign(old,s);else{stores.push(s);byId.set(s.id,s);records[s.id]=blankRecord();}}
  }
  const mergeItems=(base,extra)=>[...new Map([...base,...extra].map(item=>[item.id,item])).values()];
  function recordPatch(){return Object.fromEntries(Object.entries(records).filter(([id,r])=>JSON.stringify(r)!==JSON.stringify(syncedRecords[id]||blankRecord())));}
  function stash(pending){
    try{localStorage.setItem(STORAGE,JSON.stringify({patch:recordPatch(),visits:visits.filter(v=>!syncedVisitIds.has(v.id)),menus:menus.filter(m=>m.image.startsWith('data:')),pending}));return true;}
    catch{toast('暫存空間不足，請保持頁面開啟，按重試同步。');return false;}
  }
  function save(){
    if(!viewer)return false;
    syncPending=true;syncError='';stash(true);renderSyncStatus();void sync();return true;
  }
  function renderSyncStatus(){const el=document.getElementById('sync-status');el.hidden=!syncError;el.innerHTML=syncError?`${esc(syncError)} <button type="button" data-action="retry-sync">重試同步</button>`:'';}
  async function uploadMenu(item){
    const match=item.image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);if(!match)throw new Error('菜單圖片格式不正確');
    const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
    const params=new URLSearchParams({id:item.id,restaurant:item.store,date:item.date,public:item.public?'1':'0'});
    const response=await fetch('/api/menus?'+params,{method:'POST',headers:{'content-type':match[1]},body:bytes});const data=await response.json();
    if(!response.ok)throw new Error(data.error||'菜單尚未同步');return data.menu;
  }
  async function sync(){
    if(syncRunning||!viewer)return;
    syncRunning=true;
    try{while(syncPending){
      syncPending=false;const snapshot=structuredClone(records),data=await api('/api/records',{records:recordPatch(),visits:structuredClone(visits.filter(v=>!syncedVisitIds.has(v.id)))});community=data.community;if(data.reputation)reputation=data.reputation;
      if(data.records){for(const [id,r] of Object.entries(data.records))if(JSON.stringify(records[id])===JSON.stringify(snapshot[id]))records[id]=r;syncedRecords=structuredClone(data.records);}
      syncedVisitIds=new Set((data.visits||[]).map(v=>v.id));visits=mergeItems(data.visits||[],visits.filter(v=>!syncedVisitIds.has(v.id)));
      menus=mergeItems(data.menus||[],menus.filter(m=>m.image.startsWith('data:')));
      stash(true);
      for(const item of menus.filter(m=>m.image.startsWith('data:'))){const uploaded=await uploadMenu({...item,public:item.public===true});menus=menus.map(m=>m.id===uploaded.id?uploaded:m);stash(true);}
      stash(syncPending);
    }
      syncError='';if(page==='detail'){updateRestaurantCommunity(detailId);void loadRestaurantCommunity(detailId,true);}else render();toast(demo?'已儲存在這個瀏覽器。':'已同步你的美食紀錄。');
    }catch(e){syncPending=true;syncError=e.message;stash(true);toast('尚未同步：'+e.message+'；請保持頁面開啟並重試。');}
    finally{syncRunning=false;renderSyncStatus();}
  }
  async function bootstrap(){
    if(bootstrapRunning||syncRunning)return;bootstrapRunning=true;
    try{
      installCatalog(await api('/api/catalog'));
      const [stats,me]=await Promise.all([api('/api/community'),api('/api/me')]);community=stats;const oldViewer=viewer?.id;viewer=me.viewer;authProvider=me.authProvider==='Google'?'Google':'ChatGPT';reputation=me.reputation||null;
      if(oldViewer!==viewer?.id){articleTicket++;peopleTicket++;reputationTicket++;articleFeed={loaded:false,loading:false,articles:[],critics:[],error:''};peopleFeed={loaded:false,loading:false,people:[],error:''};restaurantCommunity.clear();}
      if(viewer){records=Object.fromEntries(stores.map(s=>[s.id,{...blankRecord(),...me.records[s.id]}]));syncedRecords=structuredClone(records);STORAGE='food-star-map.user.v2.'+viewer.id;
        let saved=null;try{saved=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch{}
        syncedVisitIds=new Set((me.visits||[]).map(v=>v.id));visits=mergeItems(me.visits||[],Array.isArray(saved?.visits)?saved.visits.filter(v=>byId.has(v.store)&&!syncedVisitIds.has(v.id)):[]);
        const localMenus=Array.isArray(saved?.menus)?saved.menus.filter(m=>byId.has(m.store)&&m.image.startsWith('data:')):[];
        menus=mergeItems(localMenus.map(m=>({...m,public:m.public===true})),me.menus||[]);
        if(saved?.pending&&(saved.patch||saved.draft)){for(const [id,r] of Object.entries(saved.patch||saved.draft))if(byId.has(id)&&validRating(r.rating))records[id]={...blankRecord(),...r};syncPending=true;}
        if(localMenus.length||visits.some(v=>!(me.visits||[]).some(x=>x.id===v.id)))syncPending=true;
        if(viewer.owner&&legacy?.records&&!localStorage.getItem(STORAGE+'.legacy-imported')){
          for(const st of stores){const r=legacy.records[st.id];if(r&&validRating(r.rating))records[st.id]={...records[st.id],...r};}
          for(const st of stores.filter(st=>records[st.id].best).slice(5))records[st.id].best=false;
          visits=mergeItems(visits,Array.isArray(legacy.visits)?legacy.visits.filter(v=>byId.has(v.store)):[]);menus=mergeItems(menus,Array.isArray(legacy.menus)?legacy.menus.filter(m=>byId.has(m.store)).map(m=>({...m,public:false})):[]);syncPending=true;stash(true);localStorage.setItem(STORAGE+'.legacy-imported','true');
        }
      }else{records=emptyRecords();syncedRecords={};syncedVisitIds=new Set();visits=[];menus=[];syncPending=false;}
      const route=detailHashId();if(route&&page!=='wheel'){detailId=route;page='detail';}
      ready=true;syncError='';render();if(syncPending)void sync();
    }catch(e){syncError=e.message;ready=false;render();toast('評分資料暫時未載入，請按重新載入。');}
    finally{bootstrapRunning=false;renderSyncStatus();}
  }
  function showDialog(id) { const d = document.getElementById(id); if (!d.open) d.showModal(); }
  function closeDialog(id) { document.getElementById(id).close(); }
  function sharesType(a,b) { return !!a && !!b && a.id !== b.id && a.types.some(t => b.types.includes(t)); }
  function reputationMarkup(value,compact=false){
    const r=value||{score:0,supporters:0,contributions:0,badge:'新食友',critic:false};
    if(compact)return `<span class="recognition-inline">${r.score} 食友認同${r.critic?' · Top Critics':''}</span>`;
    return `<section class="recognition-card"><div class="row spread"><div><span class="muted small">食友認同</span><strong class="recognition-number">${r.score}</strong></div><span class="recognition-badge${r.critic?' critic-badge':''}">${esc(r.badge)}</span></div><details class="recognition-rules"><summary>Top Critics 試行資格</summary><ul><li>${r.score>=30?'✓':'○'} 淨認同 30（目前 ${r.score}）</li><li>${r.supporters>=5?'✓':'○'} 至少 5 位不同食友贊同（目前 ${r.supporters}）</li><li>${r.contributions>=3?'✓':'○'} 至少 3 篇公開短評或專欄（目前 ${r.contributions}）</li></ul><p class="muted small">徽章代表社群認同，並非專業認證；資格隨有效投票更新。</p></details></section>`;
  }
  async function loadReputation(){
    if(!viewer)return;const id=viewer.id,ticket=++reputationTicket;
    try{const data=await api('/api/people/'+encodeURIComponent(id));if(viewer?.id!==id||ticket!==reputationTicket)return;reputation=data.person;if(page==='profile')document.getElementById('my-recognition').innerHTML=reputationMarkup(reputation);}catch(e){if(ticket===reputationTicket)toast('食友認同暫時無法更新：'+e.message)}
  }
  function voteMarkup(kind,item,author,v={},own=false){
    const vote=v.mine||0,disabled=own?' disabled':'';
    return `<div class="vote-controls" aria-label="這則分享的食友投票"><button type="button" data-action="vote" data-kind="${kind}" data-item="${esc(item)}" data-author="${esc(author)}" data-value="${vote===1?0:1}" aria-pressed="${vote===1}" aria-label="${vote===1?'取消':'表示'}贊同" title="${own?'不能替自己的分享投票':'贊同'}"${disabled}>▲ <span>${v.up||0}</span></button><button type="button" data-action="vote" data-kind="${kind}" data-item="${esc(item)}" data-author="${esc(author)}" data-value="${vote===-1?0:-1}" aria-pressed="${vote===-1}" aria-label="${vote===-1?'取消':'表示'}不贊同" title="${own?'不能替自己的分享投票':'不贊同'}"${disabled}>▼ <span>${v.down||0}</span></button>${own?'<span class="muted small">自己的分享</span>':''}</div>`;
  }
  async function castVote(button){
    if(!requireLogin()||button.disabled)return;button.disabled=true;
    try{
      const data=await api('/api/votes',{kind:button.dataset.kind,item:button.dataset.item,author:button.dataset.author,value:Number(button.dataset.value)});
      const author=button.dataset.author;if(viewer.id===author)reputation=data.reputation;
      for(const p of peopleFeed.people)if(p.id===author)Object.assign(p,data.reputation);
      if(button.dataset.kind==='review'){const c=restaurantCommunity.get(button.dataset.item);for(const r of c?.reviews||[])if(r.author===author){r.votes=data.votes;r.reputation=data.reputation}updateRestaurantCommunity(button.dataset.item);void loadRestaurantCommunity(button.dataset.item,true);}
      else{for(const a of articleFeed.articles)if(a.author===author){a.reputation=data.reputation;if(a.id===button.dataset.item)a.votes=data.votes}articleFeed.critics=articleFeed.critics.filter(p=>p.id!==author);if(data.reputation.critic)articleFeed.critics.push(data.reputation);if(page==='lists')renderLists();void loadArticles(true);}
    }catch(e){toast(e.message)}finally{button.disabled=false;}
  }
  async function loadArticles(force=false){
    if(articleFeed.loading&&!force)return;const ticket=++articleTicket;articleFeed.loading=true;articleFeed.error='';
    try{const data=await api('/api/articles');if(ticket!==articleTicket)return;articleFeed={...data,loaded:true,loading:false,error:''};}
    catch(e){if(ticket!==articleTicket)return;articleFeed.loading=false;articleFeed.loaded=true;articleFeed.error=e.message;}
    if(page==='lists')renderLists();
  }
  function foodIllustration(kind){
    const names={noodles:'牛肉麵、筷子與小菜鋼筆插畫',cafe:'咖啡與植物鋼筆插畫',breakfast:'燒餅油條鋼筆插畫',friends:'披薩、義大利麵、炸雞與酒杯的俯視共享餐桌線稿',dumplings:'小籠包鋼筆插畫'};
    return `<span class="food-ink ink-${kind}" data-food="${kind}" role="img" aria-label="${names[kind]}"></span>`;
  }
  function renderLists(){
    const articles=articleFeed.articles.filter(a=>articleFilter==='all'||a.reputation?.critic);
    app.innerHTML=`<main class="community-page columns-page"><section class="community-cover columns-cover" aria-labelledby="columns-title"><div class="community-cover-copy"><p class="eyebrow">食友的清單與文章</p><h1 id="columns-title">專欄<span aria-hidden="true">。</span></h1><p>整理會想推薦的店，<br>也說說為什麼。</p><button type="button" class="primary" data-action="write-article">＋ 寫一篇</button></div><div class="community-cover-art">${foodIllustration('cafe')}</div></section><div class="row spread"><div class="article-filters"><button type="button" data-article-filter="all" aria-pressed="${articleFilter==='all'}">食友分享</button><button type="button" data-article-filter="critics" aria-pressed="${articleFilter==='critics'}">Top Critics 專欄</button></div><button type="button" class="quiet" data-action="refresh-articles">更新</button></div><p class="muted small">認同來自公開分享的投票，不改變任何餐廳的星等權重。</p>${articleFeed.error?`<p class="form-feedback" role="status">${esc(articleFeed.error)}，可按更新重試。</p>`:''}<div class="article-feed">${articles.map(a=>`<article class="list-article"><div class="article-author"><button type="button" class="quiet" data-action="person" data-id="${a.author}">${esc(a.name)}</button>${reputationMarkup(a.reputation,true)}${a.reputation?.critic?'<span class="recognition-badge critic-badge">Top Critics</span>':''}</div><h2>${esc(a.title)}</h2><p class="article-text">${esc(a.body.slice(0,350))}</p>${a.body.length>350?`<details class="article-rest"><summary>閱讀全文</summary><p class="article-text">${esc(a.body.slice(350))}</p></details>`:''}${a.stores.length?`<div class="recommendation-strip article-stores">${a.stores.filter(id=>byId.has(id)).map(id=>`<button type="button" data-action="detail" data-id="${id}"><strong>${esc(byId.get(id).name)}</strong><span>${esc(byId.get(id).city)} · ${esc(byId.get(id).types.join('・'))}</span></button>`).join('')}</div>`:''}<div class="article-footer">${voteMarkup('article',a.id,a.author,a.votes,a.own)}${a.own?`<button type="button" class="quiet" data-action="edit-article" data-id="${a.id}">編輯</button>`:''}<span class="muted small">${esc(new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei'}).format(a.updated))}</span></div></article>`).join('')||`<p class="empty">${articleFeed.loading?'正在載入食友分享…':articleFilter==='critics'?'目前還沒有符合試行資格的 Top Critics。':'還沒有專欄，寫下第一份推薦吧。'}</p>`}</div></main>`;
    if(!articleFeed.loaded&&!articleFeed.loading)void loadArticles();
  }
  async function loadPeople(force=false){
    if(peopleFeed.loading&&!force)return;const ticket=++peopleTicket;peopleFeed.loading=true;peopleFeed.error='';
    try{const data=await api('/api/people');if(ticket!==peopleTicket)return;peopleFeed={...data,loaded:true,loading:false,error:''};}
    catch(e){if(ticket!==peopleTicket)return;peopleFeed.loading=false;peopleFeed.loaded=true;peopleFeed.error=e.message;}
    if(page==='people')renderPeople();
  }
  function renderPeople(){
    app.innerHTML=`<main class="community-page friends-page"><section class="community-cover friends-cover" aria-labelledby="friends-title"><div class="community-cover-copy"><p class="eyebrow">找到口味與觀點相近的人</p><h1 id="friends-title">食友<span aria-hidden="true">。</span></h1><p>從一份口袋名單，<br>認識另一個懂吃的人。</p><button type="button" data-action="refresh-people">更新食友</button></div><div class="community-cover-art">${foodIllustration('friends')}</div></section><p class="muted">點食友暱稱，可以看評分分布、食友認同與徽章。</p>${peopleFeed.error?`<p class="form-feedback" role="status">${esc(peopleFeed.error)}，可按更新重試。</p>`:''}<div class="people-list">${peopleFeed.people.map(p=>`<button type="button" class="person-row" data-action="person" data-id="${p.id}"><span><strong>${esc(p.name)}</strong><small>${p.contributions} 篇公開分享 · ${p.supporters} 位食友贊同</small></span><span><strong>${p.score}</strong><small>食友認同</small><span class="recognition-badge${p.critic?' critic-badge':''}">${esc(p.badge)}</span></span></button>`).join('')||'<p class="empty">正在載入食友…</p>'}</div><p class="muted small">Top Critics 是社群認同徽章，餐廳星等維持每人一票。追蹤好友功能仍在規劃中。</p></main>`;
    if(!peopleFeed.loaded&&!peopleFeed.loading)void loadPeople();
  }
  async function renderPerson(id){
    const d=document.getElementById('person-dialog'),ticket=++personTicket;
    d.innerHTML=`<div class="dialog-head"><h2 id="person-title">食友</h2><button type="button" data-close="person-dialog" aria-label="關閉">×</button></div><p class="muted">正在載入公開資料…</p>`;showDialog('person-dialog');
    try{const data=await api('/api/people/'+encodeURIComponent(id));if(ticket!==personTicket||!d.open)return;d.innerHTML=`<div class="dialog-head"><h2 id="person-title">${esc(data.person.name)}</h2><button type="button" data-close="person-dialog" aria-label="關閉">×</button></div>${reputationMarkup(data.person)}<h3>評分分布</h3><p class="muted small">${data.ratingCount} 筆評分</p>${histogram([],180,data.bins)}<p class="muted small">私人短評、待吃清單與食誌不會出現在這裡。</p>`;}catch(e){if(ticket===personTicket&&d.open)d.innerHTML=`<div class="dialog-head"><h2 id="person-title">食友資料</h2><button type="button" data-close="person-dialog" aria-label="關閉">×</button></div><p role="status">${esc(e.message)}</p>`;}
  }
  function renderArticleEditor(id){
    if(!requireLogin())return;const a=id?articleFeed.articles.find(a=>a.id===id&&a.own):null;if(id&&!a)return;
    const d=document.getElementById('article-dialog');d.innerHTML=`<div class="dialog-head"><h2 id="article-title">${a?'編輯專欄':'寫一篇專欄'}</h2><button type="button" data-close="article-dialog" aria-label="關閉">×</button></div><p class="muted small">發布後，所有食友都能閱讀與投票。</p><form id="article-form" data-id="${a?.id||crypto.randomUUID()}"><label>標題<input name="title" maxlength="100" required value="${esc(a?.title||'')}" placeholder="例如：台北會想再訪的咖啡店"></label><label>內容<textarea name="body" maxlength="10000" required placeholder="推薦哪些店、適合什麼場合、想點什麼…">${esc(a?.body||'')}</textarea></label><details><summary>加入餐廳（選填，最多 20 家）</summary><div class="article-store-picker">${stores.map(s=>`<label><input name="stores" type="checkbox" value="${s.id}"${a?.stores.includes(s.id)?' checked':''}>${esc(s.name)} <small>${esc(s.city)}</small></label>`).join('')}</div></details>${a?'<p class="muted small">修改文章內容會清除這篇原有的投票，讓食友重新判斷。</p>':''}<p id="article-feedback" class="form-feedback" role="alert"></p><div class="row spread"><button type="submit" class="primary">${a?'儲存修改':'發布專欄'}</button>${a?`<button type="button" class="quiet" data-action="remove-article" data-id="${a.id}">刪除文章</button>`:''}</div></form>`;showDialog('article-dialog');
  }
  function reportAge(reported,now){const minutes=Math.floor((now-reported)/60000);return minutes<1?'剛剛':minutes+' 分鐘前';}
  function currentWaiting(id){
    const data=restaurantCommunity.get(id),w=data?.waiting,now=(w?.serverNow||Date.now())+Math.max(0,Date.now()-(data?.receivedAt||Date.now()));
    const reports=(w?.reports||[]).filter(r=>r.reported<=now&&now-r.reported<=45*60000),latest=reports[0];
    return {data,now,reports,latest};
  }
  function waitingGlance(id){
    const {data,now,latest}=currentWaiting(id);
    return latest?`${waitLabels.seat[latest.seat]} · ${waitLabels.wait[latest.wait]} · ${reportAge(latest.reported,now)}`:data?.loading?'載入中…':data?.error?'暫時無法載入':'尚無近期回報';
  }
  function waitingMarkup(id){
    const {data,now,reports,latest}=currentWaiting(id);
    const same=latest?reports.filter(r=>r.party===latest.party&&r.service===latest.service):[],different=same.some(r=>r.seat!==latest.seat||(r.wait!=='unknown'&&latest.wait!=='unknown'&&r.wait!==latest.wait));
    const line=r=>`${waitLabels.seat[r.seat]} · ${waitLabels.party[r.party]}${waitLabels.service[r.service]} · ${waitLabels.wait[r.wait]}${r.turnover!=='unknown'?' · '+waitLabels.turnover[r.turnover]:''}`;
    return `<section class="waiting-summary" aria-label="現場候位"><div class="row spread"><h3>現場候位</h3><button type="button" data-action="report-wait" data-id="${id}" aria-haspopup="dialog">＋ 回報現況</button></div>${latest?`<p class="waiting-status">${esc(line(latest))}</p><p class="muted small">${reportAge(latest.reported,now)} · ${reports.length} 位食友近期回報 · ${waitLabels.source[latest.source]}</p>${different?'<p class="wait-difference">相同用餐條件的回報有差異，請參考時間。</p>':''}<details class="waiting-reports"><summary>查看近 45 分鐘的回報</summary>${reports.map(r=>`<div><p>${esc(line(r))}</p><span class="muted small">${reportAge(r.reported,now)} · ${waitLabels.source[r.source]}</span></div>`).join('')}</details>`:`<p class="muted small">${data?.loading?'正在載入近期回報…':data?.error?'回報暫時無法載入；請按更新重試。':'尚無近期回報，現場狀況未知。'}</p>`}<p class="wait-disclaimer">食友自行回報，45 分鐘後退出摘要；已等候時間不等於還要等多久。</p></section>`;
  }
  function renderWaitReport(id){
    if(!requireLogin()||!byId.has(id))return;const mine=restaurantCommunity.get(id)?.waiting?.mine||{},d=document.getElementById('wait-dialog');
    const select=(key,title,initial)=>`<label>${title}<select name="${key}" required>${key==='seat'?'<option value="">選擇現況</option>':''}${Object.entries(waitLabels[key]).map(([v,l])=>`<option value="${v}"${(mine[key]||initial)===v?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
    d.innerHTML=`<div class="dialog-head"><h2 id="wait-title">回報現場候位</h2><button type="button" data-close="wait-dialog" aria-label="關閉">×</button></div><p>${esc(byId.get(id).name)}</p><p class="muted small">請回報你現在看到的狀況，同一家店保留你最新的一筆。45 分鐘後不再列入摘要。</p><form id="wait-form" data-id="${id}">${select('seat','座位現況','')}<div class="wait-form-grid">${select('service','內用／外帶','dinein')}${select('party','用餐人數','2')}</div>${select('wait','等候時間','unknown')}${select('source','這個時間是…','observed')}<p class="muted small">現場回報請填實際已等候多久；尚未等待或無法判斷，選時間未知。店員預估請選「店員告知」。</p><details><summary>補充翻桌速度（選填）</summary>${select('turnover','你觀察到的流動速度','unknown')}</details><p id="wait-feedback" class="form-feedback" role="alert"></p><button type="submit" class="primary">送出現況</button></form>`;showDialog('wait-dialog');
  }
  function wheelPickerContents(){return `<p class="wheel-picker-count" aria-live="polite">已選 ${wheelTypes.size} / 8 種料理</p><div class="wheel-selected">${[...wheelTypes].map(t=>`<button type="button" data-wheel-type="${esc(t)}" aria-label="移除${esc(t)}" aria-pressed="true">${esc(t)} <span aria-hidden="true">×</span></button>`).join('')||'<p class="muted small">展開分類，點選想吃的料理。</p>'}</div>${groupedTypeMarkup(true)}`;}
  function renderWheelPicker(){
    if(spinning||page!=='wheel')return;const d=document.getElementById('wheel-picker-dialog');
    d.innerHTML=`<div class="dialog-head"><h2 id="wheel-picker-title">轉盤想放哪些料理？</h2><button type="button" data-close="wheel-picker-dialog" aria-label="關閉">×</button></div><div id="wheel-picker-choices">${wheelPickerContents()}</div><div class="wheel-picker-footer"><button type="button" class="quiet" data-action="clear-wheel-types">清空選擇</button><button type="button" class="primary" data-close="wheel-picker-dialog">完成選擇</button></div>`;showDialog('wheel-picker-dialog');
  }
  function updateWheelPicker(focusType){
    const d=document.getElementById('wheel-picker-dialog');if(!d.open)return;
    const open=new Map([...d.querySelectorAll('.type-group')].map(el=>[el.dataset.typeGroup,el.open]));
    document.getElementById('wheel-picker-choices').innerHTML=wheelPickerContents();
    d.querySelectorAll('.type-group').forEach(el=>{if(open.has(el.dataset.typeGroup))el.open=open.get(el.dataset.typeGroup)});
    if(focusType)d.querySelector(`.types [data-wheel-type="${CSS.escape(focusType)}"]`)?.focus({preventScroll:true});
  }
  function groupedTypes() {
    const available=typeOptions(),assigned=new Set(typeGroups.flatMap(g=>g.tags));
    return typeGroups.map(g=>({...g,tags:g.tags.filter(t=>available.includes(t)).concat(g.id==='specialties'?available.filter(t=>!assigned.has(t)):[])})).filter(g=>g.tags.length);
  }
  function matchesType(s, selected=type) {
    if(!selected)return true;
    if(selected.startsWith('group:'))return !!groupedTypes().find(g=>g.id===selected.slice(6))?.tags.some(t=>s.types.includes(t));
    return s.types.includes(selected);
  }
  function typeLabel(selected=type) {
    return selected.startsWith('group:') ? groupedTypes().find(g=>g.id===selected.slice(6))?.label || '所有類型' : selected;
  }
  function groupedTypeMarkup(forWheel=false,selectedType=type,selectionAttribute='type') {
    return `<div class="type-groups">${groupedTypes().map(g=>{
      const selected=forWheel?g.tags.filter(t=>wheelTypes.has(t)):g.tags.filter(t=>(selectedType instanceof Set?selectedType.has(t):selectedType===t));
      const groupSelected=!forWheel && (selectedType instanceof Set?selectedType.has('group:'+g.id):selectedType==='group:'+g.id);
      return `<details class="type-group" data-type-group="${g.id}"${selected.length||groupSelected?' open':''}><summary><strong>${esc(g.label)}</strong><span>${forWheel && selected.length?`已選 ${selected.length} 種`:selected.length?esc(selected[0]):groupSelected?'全部':`${g.tags.length} 種`}</span></summary><div class="types">${!forWheel?`<button type="button" data-${selectionAttribute}="group:${g.id}" class="${groupSelected?'active':''}" aria-pressed="${groupSelected}">全部${esc(g.label)}</button>`:''}${g.tags.map(t=>`<button type="button" data-${forWheel?'wheel-type':selectionAttribute}="${esc(t)}" class="${forWheel?wheelTypes.has(t)?'active':'':(selectedType instanceof Set?selectedType.has(t):selectedType===t)?'active':''}" aria-pressed="${forWheel?wheelTypes.has(t):(selectedType instanceof Set?selectedType.has(t):selectedType===t)}"${forWheel && (spinning||(!wheelTypes.has(t)&&wheelTypes.size>=8))?' disabled':''}>${esc(t)}</button>`).join('')}</div></details>`;
    }).join('')}</div>`;
  }
  function renderWheelStorePicker(){
    if(spinning||page!=='wheel'||wheelMode!=='store')return;
    const d=document.getElementById('picker-dialog');
    d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">選店料理類型</h2><button type="button" data-close="picker-dialog" aria-label="關閉">×</button></div><button type="button" class="all-types ${wheelStoreType.size?'':'active'}" data-action="clear-wheel-store-type" aria-pressed="${!wheelStoreType.size}">所有料理</button><p class="muted small">可複選，符合任一料理就會列入。</p>${groupedTypeMarkup(false,wheelStoreType,'wheel-store-type')}<button type="button" class="primary" data-close="picker-dialog">完成選擇</button>`;showDialog('picker-dialog');
  }
  function distanceMeters(a,b) {
    if (!a || !b) return null;
    const rad = x => x * Math.PI / 180;
    const lat = rad(b.lat-a.lat), lng = rad(b.lng-a.lng);
    const h = Math.sin(lat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(lng/2)**2;
    return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function distance(s) {
    const m = distanceMeters(origin,s.coordinates);
    if (m === null) return '';
    return formatDistance(m);
  }
  function formatDistance(m){
    return m===null?'':`${m < 1000 ? `${Math.round(m/50)*50} m` : `${(m/1000).toFixed(m<10000?1:0)} km`}`;
  }
  function filtered() {
    const q = query.trim().toLowerCase();
    const result = stores.filter(s => (!city || s.city === city) && matchesType(s) && (!q || `${s.name} ${s.types.join(' ')} ${s.address}`.toLowerCase().includes(q)) && (status === 'all' || records[s.id][status]) && (!filteredBounds || (s.coordinates && filteredBounds.contains(s.coordinates))));
    return result.sort((a,b) => {
      if (sort === 'highest') return (community[b.id]?.average ?? -1) - (community[a.id]?.average ?? -1) || near(a,b);
      return near(a,b);
    });
  }
  function near(a,b) {
    const da=distanceMeters(origin,a.coordinates), db=distanceMeters(origin,b.coordinates);
    if(da!==null && db!==null) return da-db || (records[b.id].rating??-1)-(records[a.id].rating??-1);
    if(da!==null || db!==null)return da===null?1:-1;
    return Number(b.district==='中正區')-Number(a.district==='中正區') || (records[b.id].rating??-1)-(records[a.id].rating??-1);
  }
  function resultWindow(result=filtered()) {
    const scope=JSON.stringify([query.trim().toLowerCase(),city,status,sort,type,origin,filteredBounds?.toJSON?.()||!!filteredBounds]);
    if(scope!==resultScope){resultScope=scope;resultPage=1;}
    const total=result.length,available=Math.min(total,RESULTS_PER_PAGE*RESULTS_MAX_PAGES),pages=Math.ceil(available/RESULTS_PER_PAGE);
    resultPage=Math.min(Math.max(1,resultPage),Math.max(1,pages));
    const start=(resultPage-1)*RESULTS_PER_PAGE,end=Math.min(start+RESULTS_PER_PAGE,available);
    return {items:result.slice(start,end),total,pages,page:resultPage,start:total?start+1:0,end};
  }
  function paginationMarkup(result) {
    if(!result.total)return '';
    return `<div class="results-footer"><p class="results-range muted small" role="status">顯示 ${result.start}–${result.end} 間</p>${result.pages>1?`<nav class="pagination" aria-label="餐廳列表分頁"><button type="button" data-result-page="${result.page-1}"${result.page===1?' disabled':''}>上一頁</button><label><span class="sr-only">選擇餐廳頁數</span><select id="results-page" aria-label="選擇餐廳頁數">${Array.from({length:result.pages},(_,i)=>`<option value="${i+1}"${i+1===result.page?' selected':''}>第 ${i+1} 頁 / ${result.pages}</option>`).join('')}</select></label><button type="button" data-result-page="${result.page+1}"${result.page===result.pages?' disabled':''}>下一頁</button></nav>`:''}${result.total>RESULTS_PER_PAGE*RESULTS_MAX_PAGES?'<p class="results-limit muted small">目前顯示前 150 間。搜尋店名，或選擇地區、料理，找更多符合的店。</p>':''}</div>`;
  }
  function changeResultPage(value) {
    if(page!=='explore')return;
    const number=Number(value),result=resultWindow();
    if(!Number.isInteger(number)||number<1||number>result.pages||number===result.page)return;
    resultPage=number;render();
    const heading=document.getElementById('results-heading');heading?.scrollIntoView?.({block:'start',behavior:'instant'});heading?.focus({preventScroll:true});
  }
  function revealExploreStore(id) {
    const result=filtered();resultWindow(result);
    const index=result.findIndex(s=>s.id===id);if(index<0)return;
    if(index>=RESULTS_PER_PAGE*RESULTS_MAX_PAGES){query=byId.get(id).name;resultWindow();}
    else resultPage=Math.floor(index/RESULTS_PER_PAGE)+1;
  }
  function ratingMarkup(s,personal=false) {
    const rating=personal?records[s.id].rating:community[s.id]?.average??null,count=community[s.id]?.count??0;
    return `<div class="store-rating"><strong${rating===null?' class="unrated"':''}>${rating===null?(ready?'尚未評分':'載入中'):rating.toFixed(1)+' ★'}</strong><span>${personal?'我的評分':count+' 則評分'}</span></div>`;
  }
  function card(s, profile=false) {
    const r=records[s.id];
    const cardDistance=page==='wheel'?(wheelArea==='nearby'?formatDistance(distanceMeters(wheelOrigin,s.coordinates)):''):distance(s);
    const onWheel=page==='wheel';
    const onMap=!profile && page==='explore' && layout==='map';
    return `<button type="button" class="store-row${onWheel?' wheel-restaurant-card':''}${onMap && s.id===selectedId?' selected':''}" data-action="${onMap?'select-store':'detail'}" data-id="${s.id}"${onMap?` aria-pressed="${s.id===selectedId}"`:''}><span class="store-copy"><span class="store-name">${esc(s.name)}</span><span class="store-meta"><span class="store-meta-description" title="${esc(s.types.join('・')+' · '+s.city+s.district)}">${esc(s.types.join('・'))} · ${esc(s.city+s.district)}</span>${cardDistance?`<span class="store-distance">· ${esc(cardDistance)}</span>`:''}</span><span class="store-status">${!s.coordinates?'<span class="location-pending">位置待補 · 暫無距離</span>':''}${r.best?'<span class="heart">♥ 此生最愛</span>':''}${r.eaten?'<span>✓ 吃過</span>':''}${r.wish?'<span>待訪</span>':''}</span>${profile&&r.tags?.length?`<span class="store-tags">${r.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</span>`:''}${onWheel?'<span class="wheel-card-link">查看餐廳 <span aria-hidden="true">↗</span></span>':''}</span>${ratingMarkup(s,profile)}</button>`;
  }
  function typeOptions() { return [...new Set(stores.flatMap(s=>s.types))]; }
  function navState() {
    const current=page==='detail'?detailReturn:page;
    document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===(current==='wheel'?'explore':current))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  }
  function render() {
    navState();
    const avatar=document.querySelector('.avatar');if(avatar){avatar.textContent=viewer?viewer.name.slice(0,1):'登入';avatar.setAttribute('aria-label',viewer?viewer.name+' 的美食':'登入記錄美食');}
    if (page==='profile') return renderProfile();
    if (page==='detail') return renderRestaurantPage(detailId);
    if (page==='wheel') return renderWheelPage();
    if (page==='lists') return renderLists();
    if (page==='people') return renderPeople();
    const result=filtered(),windowed=resultWindow(result);
    if(result.length && !result.some(s=>s.id===selectedId))selectedId=result[0].id;
    app.innerHTML=`<main class="explore ${layout==='map'?'map-view':'list-view'}"><section class="sidebar" aria-label="餐廳列表">
      <section class="food-hero" aria-labelledby="explore-title"><div class="food-hero-copy"><p class="eyebrow">食星 · 每一餐，都值得期待</p><h1 id="explore-title">把日常，<br>吃成<span>好時光。</span></h1><p class="hero-description">巷口的愛店，下次的口袋名單。<br>跟著食友的星星，找一餐喜歡的。</p><button type="button" class="add-store" data-action="add-store">＋ 收進一家好店</button></div><div class="hero-art">${foodIllustration('noodles')}</div></section>
      <div class="search-wrap"><span class="search-icon" aria-hidden="true">⌕</span><input id="search" type="search" aria-label="搜尋店名或料理" placeholder="搜尋店名或料理" value="${esc(query)}"></div>
      <div class="explore-filters" aria-label="篩選餐廳"><label class="filter-chip"><span>地區</span><select id="city-filter" aria-label="地區">${[['','所有地區'],...[...new Set(stores.map(s=>s.city))].map(c=>[c,c])].map(([v,l])=>`<option value="${esc(v)}"${city===v?' selected':''}>${esc(l)}</option>`).join('')}</select></label><div class="filter-chip type-chip"><button type="button" data-action="pick-type" aria-haspopup="dialog">${type?esc(typeLabel()):'料理類型'}</button>${type?`<button type="button" class="chip-clear" data-action="clear-type" aria-label="清除料理類型">×</button>`:''}</div><label class="filter-chip"><span>收藏</span><select id="status-filter" aria-label="收藏狀態">${[['all','全部餐廳'],['eaten','吃過'],['wish','待訪'],['best','此生最愛']].map(([v,l])=>`<option value="${v}"${status===v?' selected':''}>${l}</option>`).join('')}</select></label></div>
      <button type="button" class="wheel-entry" data-action="wheel"><span class="wheel-entry-copy"><strong>不知道要吃什麼？</strong><small>把選擇交給轉盤，發現下一餐的驚喜。</small></span><span class="wheel-entry-mark" aria-hidden="true">↗</span></button>
      <div class="result-toolbar" id="results-heading" tabindex="-1"><div class="result-caption"><strong>餐廳</strong><span id="result-count" class="muted">${result.length} 間</span></div><label class="sort-control filter-chip"><span class="sort-label">排序</span><select id="sort-filter" aria-label="餐廳排序"><option value="nearby"${sort==='nearby'?' selected':''}>距離最近</option><option value="highest"${sort==='highest'?' selected':''}>最高星等</option><option value="popular" disabled>熱門程度（準備中）</option></select></label><div class="view-switch compact" aria-label="顯示方式"><button type="button" data-layout="list" class="${layout==='list'?'active':''}" aria-pressed="${layout==='list'}">列表</button><button type="button" data-layout="map" class="${layout==='map'?'active':''}" aria-pressed="${layout==='map'}">地圖</button></div></div>
      <div class="origin-control"><button type="button" class="quiet" data-action="locate">◎ ${demo?'使用示範位置':'使用我的位置'}</button></div>
      <p class="list-note muted small">${sort==='highest'?'依食友平均星等排列':`起點：${esc(originLabel==='中正區起點'?'中正區・巧之味濟南店':originLabel)} · 直線距離`}${filteredBounds?' · 目前地圖範圍':''}${filteredBounds?' <button type="button" class="quiet small" data-action="clear-bounds">清除範圍</button>':''}</p>
      <div class="results" id="results">${result.length?windowed.items.map(s=>card(s)).join(''):'<p class="empty">這個範圍還沒有符合條件的收藏。<br>試試所有地區或其他料理類型。</p>'}</div><div id="results-pagination">${paginationMarkup(windowed)}</div><p class="muted small collection-note">${syncError?esc(syncError)+' <button type="button" data-action="retry-sync">重試</button>':ready?demo?'社群評分為示範資料，操作只存此瀏覽器。':'星等來自食友實際評分。<button type="button" data-action="refresh-community">更新評分</button>':'正在載入評分…'}</p>
      </section>${layout==='map'?'<div id="map-mount"></div>':''}</main>`;
    if(layout==='map'){
      app.querySelector('#map-mount').replaceWith(mapPanel);
      renderMapCard();updateMap();
    }
  }
  function refreshResults() {
    if(page!=='explore')return;
    const result=filtered(),windowed=resultWindow(result);
    app.querySelector('#results').innerHTML=result.length?windowed.items.map(s=>card(s)).join(''):'<p class="empty">沒有符合條件的收藏。</p>';
    app.querySelector('#results-pagination').innerHTML=paginationMarkup(windowed);
    const n=app.querySelector('#result-count');if(n)n.textContent=`${result.length} 間`;
    if(layout==='map' && mapMode==='sdk') updateMarkers();
  }
  function refreshMapRegion() {
    const center=map?.getCenter().toJSON(),zoom=map?.getZoom();
    render();
    if(center && map){map.setCenter(center);map.setZoom(zoom);}
    mapPanel.querySelector('#map-area').textContent='目前地圖範圍';
  }
  function renderMapCard() {
    const s=byId.get(selectedId),r=records[s.id];
    mapPanel.querySelector('#map-card').innerHTML=`<article class="map-card"><div><h2>${esc(s.name)}</h2><p class="muted">${esc(s.address)}</p><p class="store-status">${r.best?'<span class="heart">♥ 此生最愛</span>':''}${r.eaten?'<span>✓ 吃過</span>':''}${r.wish?'<span>待訪</span>':''}</p></div><div><div class="score-big">${r.rating===null?'—':`${r.rating.toFixed(1)} ★`}</div><div class="muted small">我的評分</div></div><div class="actions"><button type="button" class="primary" data-action="detail" data-id="${s.id}">餐廳詳情</button><button type="button" data-action="rate" data-id="${s.id}">${r.rating===null?'給星等':'修改星等'}</button><a class="button-link" href="${esc(s.mapsUrl)}" target="_blank" rel="noopener noreferrer">Google Maps</a></div></article>`;
    mapPanel.querySelector('#map-area').textContent=`${s.city}市${s.district}`;
    mapPanel.querySelector('#map-foot').textContent=mapNotice || 'Google 地圖顯示店家位置；星等與愛心來自你的收藏。';
  }
  let embedId='';
  function updateMap() {
    const s=byId.get(selectedId);
    if(demo){iframe.hidden=true;mapPanel.querySelector('#map-loading').hidden=true;let panel=mapPanel.querySelector('.demo-map-preview');if(!panel){panel=document.createElement('div');panel.className='demo-map-preview';iframe.parentElement.append(panel);}panel.innerHTML=`<strong>⌖ ${esc(s.name)}</strong><p>示範地圖 · 位置與距離為體驗資料</p><p>${esc(s.address)}</p>`;return;}
    if(mapMode==='embed' && embedId!==s.id){
      embedId=s.id;mapPanel.querySelector('#map-loading').hidden=false;
      iframe.src=`https://www.google.com/maps?${s.cid?'cid='+encodeURIComponent(s.cid)+'&':''}q=${encodeURIComponent(s.name+' '+(s.locationPending?s.city+(s.district||''):s.address))}&output=embed&hl=zh-TW`;
    }
    if(mapMode==='sdk' && map){updateMarkers();if(s.coordinates){map.panTo(s.coordinates);if(map.getZoom()<13)map.setZoom(15);}}
  }
  function selectStore(id, detail=false) {
    if(!byId.has(id))return;
    selectedId=id;
    if(detail){renderDetail(id);return;}
    if(page==='explore' && layout==='map'){renderMapCard();updateMap();}
    refreshResults();
  }
  function histogram(values,barHeight=160,counts=null) {
    const bins=counts||Array.from({length:10},(_,i)=>values.filter(n=>n===(i+1)/2).length),max=Math.max(1,...bins);
    return `<div class="histogram" role="group" aria-label="星等分布">${bins.map((n,i)=>`<button type="button" class="bin" data-action="histogram-bin" aria-label="${((i+1)/2).toFixed(1)} 星，${n} 筆評分" aria-pressed="false"><span class="count" aria-hidden="true">${n} 筆</span><span class="bar-area" style="height:${barHeight+6}px" aria-hidden="true"><span class="bar" style="height:${n/max*barHeight}px"></span></span><span class="bin-label" aria-hidden="true">${((i+1)/2).toFixed(1)}</span></button>`).join('')}</div>`;
  }
  function favorites() {return stores.filter(s=>records[s.id].best);}
  const parseTags=value=>[...new Set(String(value).split(/[,，、\n]/).map(t=>t.trim()).filter(Boolean))];
  function newStoreDraft(){try{return JSON.parse(localStorage.getItem(STORAGE+'.new-store')||'null')||{};}catch{return {};}}
  function rememberNewStoreDraft(form){const values=new FormData(form),draft=Object.fromEntries(['shareText','mapsUrl','name','city','district','address','type','extraTypes'].map(k=>[k,String(values.get(k)||'')]));draft.wish=values.get('wish')==='on';try{localStorage.setItem(STORAGE+'.new-store',JSON.stringify(draft));}catch{}return draft;}
  function clearExploreFilters(){query='';city='';type='';status='all';filteredBounds=null;layout='list';}
  function parseRestaurantShare(text){
    const result={};
    const counties=['台北市','臺北市','新北市','桃園市','台中市','臺中市','台南市','臺南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','台東縣','臺東縣','澎湖縣','金門縣','連江縣'];
    const lines=String(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    const urls=String(text).match(/https:\/\/[^\s<>"']+/g)||[];
    for(const raw of urls){
      try{const url=new URL(raw.replace(/[。。，,；;）)]*$/u,''));
        if(url.username||url.password||url.port||!['maps.app.goo.gl','goo.gl','google.com','www.google.com','maps.google.com'].includes(url.hostname))continue;
        if(url.hostname==='goo.gl'&&!url.pathname.startsWith('/maps/'))continue;
        if(['google.com','www.google.com'].includes(url.hostname)&&!url.pathname.startsWith('/maps'))continue;
        result.mapsUrl=url.href;
        const place=url.pathname.match(/\/maps\/place\/([^/]+)/);
        if(place){try{result.name=decodeURIComponent(place[1]).replace(/\+/g,' ');}catch{}}
        break;
      }catch{}
    }
    for(const line of lines){
      if(line.includes('https://'))continue;
      const county=counties.find(c=>line.includes(c));
      if(county&&!result.address){const address=line.slice(line.indexOf(county));result.address=address;result.city=county.replace(/^臺/,'台').replace(/市$/,'');const match=address.slice(county.length).match(/^([^\d\s路街巷弄]{1,4}?(?:區|鄉|鎮|市))/u);if(match)result.district=match[1];}
    }
    if(!result.name){const line=lines.find(line=>!line.includes('https://')&&!counties.some(c=>line.includes(c))&&!/^(?:Google Maps|Google 地圖|地址|電話|營業時間|https?:)/i.test(line));if(line)result.name=line.replace(/^(?:店名|餐廳名稱)[：:]\s*/,'');}
    return result;
  }
  function fillRestaurantShare(form){
    const feedback=document.getElementById('add-store-feedback'),parsed=parseRestaurantShare(form.elements.shareText.value);
    if(!parsed.mapsUrl){feedback.textContent='請貼上 Google Maps 連結；也可以把店名、地址一起貼上。';return;}
    const canonical=value=>{try{const url=new URL(value);url.hash='';for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_')||['g_st','g_ep','entry'].includes(key))url.searchParams.delete(key);return url.href;}catch{return '';}};
    const existing=stores.find(store=>canonical(store.mapsUrl)===canonical(parsed.mapsUrl));
    const info=existing?{...existing,type:existing.types[0]}:parsed;
    if(form.elements.mapsUrl.value&&canonical(form.elements.mapsUrl.value)!==canonical(parsed.mapsUrl))for(const key of ['name','address','city','district','type','extraTypes'])form.elements[key].value='';
    form.elements.mapsUrl.value=parsed.mapsUrl;
    for(const key of ['name','address','city','district','type'])if(info[key])form.elements[key].value=info[key];
    feedback.textContent=existing?'已找到現有店家並帶入資料，確認後會開啟原店家，不重複新增。':parsed.name&&parsed.address?'已帶入分享內容，請確認店名、地址和料理類型。':'已帶入連結。短連結不包含完整店家資料，請補上店名與地址；縣市和行政區會從地址辨識。';
    rememberNewStoreDraft(form);
  }
  function renderDemoStoreResults(){
    const q=document.getElementById('store-search').value.trim();
    const found=q?[...stores.filter(s=>s.name.includes(q)),...demo.search(q)]:stores.slice(0,4);
    document.getElementById('store-search-results').innerHTML='<p class="muted small">以下店家、分店地址與位置皆為模擬，不是真實搜尋結果。</p>'+found.map(s=>`<button type="button" class="store-search-result" data-action="demo-select-place" data-id="${esc(s.id)}"><strong>${esc(s.name)}</strong><span>${esc(s.address)}</span><span>${esc(distance(s))} · 確認這家分店 →</span></button>`).join('');
  }
  function renderDemoAddStore(){
    const d=document.getElementById('picker-dialog');
    d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">找店，加入我的美食</h2><button type="button" data-close="picker-dialog" aria-label="關閉">×</button></div><p>搜尋 → 選分店 → 加入待吃。不需要貼網址或填地址。</p><label>店名或分店名稱<input id="store-search" maxlength="60" placeholder="試試輸入你想找的餐廳"></label><div id="store-search-results" aria-live="polite"></div>`;
    renderDemoStoreResults();showDialog('picker-dialog');
  }
  function renderAddStore(){
    if(demo){renderDemoAddStore();return;}
    addStoreMode='catalog';
    const d=document.getElementById('picker-dialog'),draft=newStoreDraft();
    d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">新增餐廳</h2><button type="button" data-close="picker-dialog" aria-label="關閉">×</button></div><p class="muted small">一次貼上 Google Maps 分享內容，再確認資料。地址可自動帶出縣市和行政區。</p><form id="add-store-form" autocomplete="off"><label>貼上連結或分享內容<textarea name="shareText" maxlength="4000" placeholder="店名、完整地址與 https://maps.app.goo.gl/… 可一起貼上">${esc(draft.shareText||draft.mapsUrl||'')}</textarea></label><button type="button" data-action="fill-store-share">帶入資料</button><input name="mapsUrl" type="hidden" value="${esc(draft.mapsUrl||'')}"><label>確認店名<input name="name" value="${esc(draft.name||'')}" required maxlength="120" placeholder="請包含分店名稱"></label><label>地址<input name="address" value="${esc(draft.address||'')}" required maxlength="200" placeholder="例如：台北市中正區濟南路二段6號"></label><label>料理類型<select name="type" required><option value="">選擇主要類型</option>${typeGroups.map(g=>`<optgroup label="${esc(g.label)}">${g.tags.map(t=>`<option value="${esc(t)}"${draft.type===t?' selected':''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')}</select></label><details class="add-store-extra"><summary>其他資料（選填／修改自動辨識結果）</summary><div class="add-store-location"><label>城市／縣市<input name="city" value="${esc(draft.city||'')}" maxlength="30" placeholder="地址沒有縣市時，請補填" list="store-cities"></label><label>行政區<input name="district" value="${esc(draft.district||'')}" maxlength="30" placeholder="例如：中正區"></label></div><datalist id="store-cities">${[...new Set(stores.map(s=>s.city))].map(c=>`<option value="${esc(c)}"></option>`).join('')}</datalist><label>其他料理類型<input name="extraTypes" value="${esc(draft.extraTypes||'')}" maxlength="100" placeholder="例如：麵包、甜點，以頓號分隔"></label></details><label class="note-public"><input name="wish" type="checkbox"${draft.wish!==false?' checked':''}>同時加入我的待吃清單</label><p class="muted small">沒有串接 Google Places，短連結無法自動取得地址。只有連結含店家座標時，才會列入附近轉盤。</p><p id="add-store-feedback" class="form-feedback" role="alert" tabindex="-1"></p><button type="submit" class="primary">確認新增</button></form>`;
    const manual=d.innerHTML.slice(d.innerHTML.indexOf('<form id="add-store-form"'));
    const cities=['台北','新北','桃園','台中','台南','高雄','基隆','新竹','嘉義','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣','金門縣','連江縣'];
    d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">找店，加入我的美食</h2><button type="button" data-close="picker-dialog" aria-label="關閉">×</button></div><p class="muted small">搜尋店名，確認分店，直接加入待吃。</p><div class="store-search-modes" role="group" aria-label="搜尋來源"><button type="button" data-action="store-search-mode" data-mode="catalog" aria-pressed="true">食星餐廳</button><button type="button" data-action="store-search-mode" data-mode="prototype" aria-pressed="false">Google 搜尋・流程預覽</button></div><div id="store-search-source" class="muted small">搜尋食星已收錄的餐廳，可直接收藏。</div><form id="quick-store-form" novalidate><label>店名或分店名稱<input id="store-search" name="name" maxlength="120" autocomplete="off" placeholder="例如：興波咖啡 華山旗艦店"></label><div id="store-search-results" aria-live="polite"></div><div id="quick-store-fields" hidden><p class="quick-add-note">快速新增會標示「詳細地址待補」，確認位置前不列入附近轉盤。</p><label>縣市<select name="city"><option value="">選擇縣市</option>${cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label><label>行政區（選填）<input name="district" maxlength="30" placeholder="例如：大安區"></label><label>料理類型（選填）<select name="type"><option value="其他">之後再分類</option>${typeGroups.map(g=>`<optgroup label="${esc(g.label)}">${g.tags.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</optgroup>`).join('')}</select></label><button type="submit" class="primary">新增並加入待吃</button></div><p id="quick-store-feedback" class="form-feedback" role="status"></p></form><details class="manual-add"><summary>其他新增方式：貼上分享內容或填完整地址</summary>${manual}</details><p class="muted small">目前搜尋食星餐廳；Google 店家搜尋尚未啟用。</p>`;
    renderStoreSearchResults();
    showDialog('picker-dialog');
  }
  const isRestaurantLink=value=>/^(?:[a-z][a-z0-9+.-]*:\/\/|(?:www\.)?(?:maps\.app\.goo\.gl|google\.com)\/)/i.test(String(value).trim());
  function renderLocationPicker(id){
    if(!requireLogin())return;const s=byId.get(id);if(!s||s.coordinates)return;
    const d=document.getElementById('picker-dialog');d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">補上餐廳位置</h2><button type="button" data-close="picker-dialog" aria-label="關閉">×</button></div><p><strong>${esc(s.name)}</strong></p><p class="muted small">選取 Google Maps 上的正確店家，再貼上電腦瀏覽器的完整網址。分享短連結目前無法辨識。</p><a class="button-link" href="${esc(s.mapsUrl)}" target="_blank" rel="noopener noreferrer">開啟 Google Maps 找這家店 ↗</a><form id="store-location-form" data-id="${id}"><label>店家的完整 Google Maps 網址<input type="url" name="mapsUrl" maxlength="4000" required placeholder="https://www.google.com/maps/place/…"></label><label class="note-public"><input type="checkbox" name="confirmed" required>已確認是「${esc(s.name)}」及正確分店</label><p class="muted small">只補上位置，原本的評分、收藏與食誌都會保留。</p><p id="store-location-feedback" role="alert"></p><button type="submit" class="primary">儲存餐廳位置</button></form>`;showDialog('picker-dialog');
  }
  const prototypeBranches=[{id:'demo-daan',name:'示範食堂・大安店',address:'台北市大安區示範路 100 號（虛構地址）'},{id:'demo-zhongzheng',name:'示範食堂・中正店',address:'台北市中正區示範路 200 號（虛構地址）'}];
  function renderStoreSearchResults(){
    if(demo){renderDemoStoreResults();return;}
    const input=document.getElementById('store-search'),query=input.value.trim().toLowerCase(),resultsNode=document.getElementById('store-search-results');
    document.getElementById('quick-store-fields').hidden=true;
    if(isRestaurantLink(query)){resultsNode.textContent='這是地圖連結，請在這裡輸入店名；若要貼連結，請展開下方「其他新增方式」。';return;}
    if(addStoreMode==='prototype'){
      resultsNode.innerHTML=`<div class="store-prototype-note"><strong>操作原型・未串接 Google</strong><p>以下為虛構示範分店，不是你輸入店名的真實搜尋結果。操作不會新增餐廳或變更收藏。</p></div>`+(query?`<p class="muted small">選擇分店</p>${prototypeBranches.map(store=>`<button type="button" class="store-search-result" data-action="preview-google-branch" data-id="${store.id}"><strong>${store.name}</strong><span>${store.address}</span><span>示意資料 · 選取這家分店 →</span></button>`).join('')}`:'<p class="muted small">先輸入店名，體驗選分店的流程。</p>');return;
    }
    const results=query?stores.filter(store=>`${store.name} ${store.city} ${store.district||''}`.toLowerCase().includes(query)).slice(0,8):[];
    resultsNode.innerHTML=query?(results.length?`<p class="muted small">食星已收錄，選對分店即可加入</p>${results.map(store=>`<button type="button" class="store-search-result" data-action="choose-existing-store" data-id="${store.id}"><strong>${esc(store.name)}</strong><span>${esc(store.address||store.city+(store.district||''))}</span><span>${store.coordinates?esc(distance(store))+' · ':''}${records[store.id].wish?'已在待吃清單':records[store.id].eaten?'已吃過 · 查看店家':'加入待吃 →'}</span></button>`).join('')}`:'<p class="muted small">食星尚未收錄這家店。Google 店家搜尋尚未啟用，目前不會自動帶入地址與位置。</p>')+`<button type="button" class="quiet" data-action="show-quick-store">找不到？改用手動新增</button>`:'<p class="muted small">輸入店名或分店名稱。</p>';
  }
  function previewGoogleBranch(id){
    if(addStoreMode!=='prototype')return;const store=prototypeBranches.find(s=>s.id===id);if(!store)return;
    document.getElementById('store-search-results').innerHTML=`<div class="store-prototype-note"><strong>操作原型・未串接 Google</strong><p>所有店家資料均為示意，不會儲存至食星。</p></div><section class="store-selection-preview"><p class="eyebrow">確認分店</p><h3>${store.name}</h3><p>${store.address}</p><dl><div><dt>距離</dt><dd>正式串接後依店家座標計算</dd></div><div><dt>營業時間</dt><dd>示意：11:00–21:00</dd></div></dl><button type="button" class="primary" data-action="finish-google-preview">示範加入待吃</button><button type="button" class="quiet" data-action="back-google-preview">重選分店</button></section>`;
  }
  function restaurantMenus(id){return mergeItems(restaurantCommunity.get(id)?.menus||[],menus.filter(m=>m.store===id)).sort((a,b)=>b.date.localeCompare(a.date)||(b.uploaded||0)-(a.uploaded||0));}
  function menuGalleryMarkup(id){
    const items=restaurantMenus(id),s=byId.get(id),authors=[...new Set(items.map(m=>m.uploadedBy||viewer?.name||'我'))];
    return items.length?`<div class="menu-gallery-head"><p class="muted small">拍攝日期：新 → 舊</p><div class="uploader-stack" aria-label="${authors.length} 位上傳者">${authors.slice(0,3).map(name=>`<span title="${esc(name)}">${esc(name.slice(0,1))}</span>`).join('')}${authors.length>3?`<span>+${authors.length-3}</span>`:''}<small>${authors.length} 位上傳者</small></div></div><div class="menu-row">${items.map(m=>`<button type="button" class="menu-item" data-menu-image="${esc(m.id)}"><img src="${esc(m.image)}" alt="${esc(s.name)} ${esc(m.date)} 菜單" loading="lazy"><strong>${esc(m.date)}</strong><span>${esc(m.uploadedBy||viewer?.name||'我')} · ${m.image.startsWith('data:')?'待同步':m.public?'公開':'私人'}</span></button>`).join('')}</div>`:`<p class="muted">${restaurantCommunity.get(id)?.loading?'正在載入菜單…':'尚未上傳菜單。'}</p>`;
  }
  function renderProfile() {
    if(!viewer){app.innerHTML=`<main class="profile"><div class="page-food food-dumplings">${foodIllustration('dumplings')}</div><h1>我的美食</h1><p>登入後建立自己的評分與收藏。</p><a class="button-link primary" target="_top" href="${signin()}">使用 ${authProvider} 登入</a>${syncError?'<p>'+esc(syncError)+'</p><button data-action="refresh-community">重新載入</button>':''}</main>`;return;}
    const eaten=stores.filter(s=>records[s.id].eaten),wish=stores.filter(s=>records[s.id].wish),best=favorites(),values=stores.map(s=>records[s.id].rating).filter(n=>n!==null);
    const results=stores.filter(s=>(profileTab==='eaten'?records[s.id].eaten:profileTab==='wish'?records[s.id].wish:false)&&(!profileTag||records[s.id].tags?.includes(profileTag))).sort((a,b)=>(records[b.id].rating??-1)-(records[a.id].rating??-1));
    const myTags=[...new Set(Object.values(records).flatMap(r=>r.tags||[]))].sort();
    app.innerHTML=`<main class="profile"><div class="profile-head"><div><p class="eyebrow">我的美食</p><h1>${esc(viewer.name)}</h1><button type="button" data-action="edit-name">修改暱稱</button> <span class="muted small">免登入體驗</span><p class="muted">把會想再吃的店留下來。</p></div><div class="profile-food food-dumplings">${foodIllustration('dumplings')}</div></div><div class="stats"><span><strong>${eaten.length}</strong>吃過</span><span><strong>${wish.length}</strong>待訪</span><span><strong>${values.length}</strong>評分</span></div><div id="my-recognition">${reputationMarkup(reputation)}</div><div class="best-top"><h2>此生最愛</h2><span class="muted small">${best.length} / 5</span></div><div class="best-row">${Array.from({length:5},(_,i)=>best[i]?`<button type="button" class="best-slot" data-action="detail" data-id="${best[i].id}"><strong>${esc(best[i].name)}</strong><span>${esc(best[i].city)} · ${records[best[i].id].rating!==null?records[best[i].id].rating.toFixed(1)+' ★':'吃過'}</span></button>`:`<button type="button" class="best-slot empty-slot" data-action="pick-favorite" data-slot="${i}" aria-label="加入第 ${i+1} 間此生最愛"><span>＋</span><strong>加入最愛</strong></button>`).join('')}</div><section class="chart"><h3>我的評分分布</h3><p class="muted small">${values.length} 筆評分</p>${histogram(values)}</section><div class="profile-tabs">${[['eaten','吃過'],['wish','待吃清單'],['diary','食誌']].map(([v,l])=>`<button type="button" data-profile-tab="${v}" class="${profileTab===v?'active':''}">${l}</button>`).join('')}</div>${profileTab==='diary'?`<div>${visits.length?visits.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(v=>`<article class="visit-card"><p class="muted small">${esc(v.date)}</p><h3><button type="button" class="quiet" data-action="detail" data-id="${v.store}">${esc(byId.get(v.store)?.name||'餐廳')}</button></h3><p>${esc(v.dishes||'')}</p><p>${esc(v.text)}</p></article>`).join(''):'<p class="empty">還沒有食誌。<br>在餐廳頁面記錄日期、菜色和感想。</p>'}</div>`:`<div class="profile-list-tools">${profileTab==='wish'?'<button type="button" data-action="pick-wish">＋ 搜尋店家</button>':''}<label>我的標籤<select id="profile-tag" aria-label="篩選我的標籤"><option value="">全部標籤</option>${myTags.map(t=>`<option value="${esc(t)}"${profileTag===t?' selected':''}>${esc(t)}</option>`).join('')}</select></label></div><div class="profile-list">${results.length?results.map(s=>card(s,true)).join(''):'<p class="empty">這個清單目前是空的。</p>'}</div>`}<div class="profile-sync"><button type="button" data-action="refresh-community">更新我的紀錄</button><a class="button-link" href="/api/export" download="food-star-records.json">匯出我的紀錄</a></div><p class="profile-note">星等、收藏、標籤、食誌與菜單會只存此瀏覽器。食誌與標籤只有自己看得到；菜單可選擇公開。匯出含紀錄與菜單連結，不含圖片檔案。專欄與公開短評可接受食友投票；認同數不影響餐廳星等。追蹤好友仍在規劃中。</p>${syncError?`<p class="form-feedback" role="status">${esc(syncError)} <button type="button" data-action="retry-sync">重試同步</button></p>`:''}</main>`;
  }
  function detailRefresh() { render(); }
  function detailHashId() {
    const match=window.location.hash.match(/^#restaurant\/([a-z0-9-]+)$/);
    return match && byId.has(match[1]) ? match[1] : null;
  }
  function renderDetail(id) {
    if(!byId.has(id))return;
    if(page!=='detail'){detailReturn=page;detailScroll=window.scrollY || 0;detailTab='reviews';}
    if(detailId!==id){recommendationExpanded=false;recommendationScope='all';}
    if(page!=='detail' || detailId!==id)window.history.pushState({foodView:'detail',id},'',`#restaurant/${id}`);
    detailId=id;page='detail';render();window.scrollTo({top:0,behavior:'instant'});
    document.getElementById('detail-title')?.focus({preventScroll:true});
    if(restaurantCommunity.has(id))void loadRestaurantCommunity(id);
  }
  function leaveDetail() {
    if(window.history.state?.foodView==='detail'){window.history.back();return;}
    window.history.replaceState(null,'',window.location.pathname+window.location.search);
    page=detailReturn;render();window.scrollTo({top:detailScroll,behavior:'instant'});
  }
  async function loadRestaurantCommunity(id,force=false){
    const previous=restaurantCommunity.get(id);if(previous?.loading&&!force)return;
    const ticket=(previous?.ticket||0)+1;
    restaurantCommunity.set(id,{...previous,loading:true,error:'',ticket});
    updateRestaurantCommunity(id);
    try{const data=await api('/api/restaurants/'+id+'/community');if(restaurantCommunity.get(id)?.ticket!==ticket)return;restaurantCommunity.set(id,{...data,receivedAt:Date.now(),loading:false,error:'',ticket});}
    catch(e){if(restaurantCommunity.get(id)?.ticket!==ticket)return;restaurantCommunity.set(id,{...previous,loading:false,error:e.message,ticket});}
    updateRestaurantCommunity(id);
  }
  function updateRestaurantCommunity(id){
    if(page!=='detail'||detailId!==id)return;
    const container=document.getElementById('community-content');if(container)container.innerHTML=restaurantCommunityMarkup(id);
    const wait=document.getElementById('waiting-content');if(wait)wait.innerHTML=waitingMarkup(id);
    const glance=document.getElementById('waiting-glance');if(glance)glance.textContent=waitingGlance(id);
    const gallery=document.getElementById('menu-gallery');if(gallery)gallery.innerHTML=menuGalleryMarkup(id);
    const score=document.getElementById('detail-community-score');if(score)score.innerHTML=`<strong>${community[id]?.average==null?'—':community[id].average.toFixed(1)+' ★'}</strong><span>${community[id]?.count||0} 則評分</span>`;
    const chart=document.getElementById('detail-community-chart');if(chart)chart.innerHTML=histogram([],224,community[id]?.bins);
    document.querySelectorAll('[data-community-count]').forEach(el=>el.textContent=(community[id]?.count||0)+' 筆評分');
  }
  function restaurantReviewsMarkup(id){
    const publicReviews=restaurantCommunity.get(id)?.reviews||[],record=records[id];
    const isOwn=review=>review.own||viewer&&review.author===viewer.id;
    const remoteOwn=publicReviews.find(isOwn),others=publicReviews.filter(review=>!isOwn(review));
    const own=viewer&&record.note.trim()?{author:viewer.id,name:viewer.name,rating:record.rating,note:record.note,own:true,private:!record.notePublic,reputation:remoteOwn?.reputation||reputation,votes:record.notePublic&&remoteOwn?.note===record.note?remoteOwn.votes:{}}:null;
    const reviews=own?[own,...others]:others;
    if(!reviews.length)return '<p class="muted small">還沒有公開短評。</p>';
    return `<div class="community-reviews">${reviews.map(review=>`<article class="personal-review${review.own?' pinned-review':''}"${review.own?' data-own-review="true"':''}><div class="article-author"><button type="button" class="quiet" data-action="person" data-id="${esc(review.author)}">${esc(review.name)}</button>${reputationMarkup(review.reputation,true)}${review.rating!==null?`<span class="muted small">${Number(review.rating).toFixed(1)} ★</span>`:''}${review.own?'<span class="review-pin">置頂</span>':''}</div>${review.own?`<p class="review-visibility muted small">我的短評 · ${review.private?'私人，僅自己可見':'公開'}</p>`:''}<p>${esc(review.note)}</p>${review.private?'':voteMarkup('review',id,review.author,review.votes,review.own)}</article>`).join('')}</div>`;
  }
  function restaurantCommunityMarkup(id){
    const data=restaurantCommunity.get(id),source=byId.get(id);
    const recommendations=(data?.recommendations||[]).filter(item=>{if(!byId.has(item.id))return false;const d=distanceMeters(source.coordinates,byId.get(item.id).coordinates);return recommendationScope!=='nearby'||(d!==null&&d<=3000);});
    const shown=recommendationExpanded?recommendations:recommendations.slice(0,6);
    return `<div class="community-toolbar"><h3>大家的短評與推薦</h3><button type="button" class="quiet" data-action="refresh-recommendations" data-id="${id}"${data?.loading?' disabled':''}>${data?.loading?'更新中…':'更新'}</button></div><div class="recommendation-filters" aria-label="推薦範圍"><button type="button" data-recommendation-scope="all" class="${recommendationScope==='all'?'active':''}" aria-pressed="${recommendationScope==='all'}">不限地區</button><button type="button" data-recommendation-scope="nearby" class="${recommendationScope==='nearby'?'active':''}" aria-pressed="${recommendationScope==='nearby'}">這家附近 · 3 km</button></div>${data?.error?`<p class="community-error" role="status">${esc(data.error)} <button type="button" data-action="refresh-recommendations" data-id="${id}">重試</button></p>`:''}${shown.length?`<div class="recommendation-strip community-recommendations" aria-label="食友推薦餐廳">${shown.map(item=>{const st=byId.get(item.id);return `<button type="button" data-action="detail" data-id="${st.id}"><strong>${esc(st.name)}</strong><span>${esc(st.city)} · ${esc(st.types.join('・'))}</span>${item.reasons?.length?`<span class="recommendation-reasons">${item.reasons.slice(0,2).map(r=>esc(r.reason)+' · '+r.count+' 人').join('<br>')}</span>`:''}<span class="recommendation-counts">${item.better?`${item.better} 人更推薦`:''}${item.better&&item.also?' · ':''}${item.also?`${item.also} 人也推薦`:''}</span></button>`}).join('')}</div>${recommendations.length>6?`<button type="button" class="quiet" data-action="expand-recommendations">${recommendationExpanded?'收起':'查看全部 '+recommendations.length+' 間推薦'}</button>`:''}`:`<p class="muted small">${data?.loading&&!data?.recommendations?'正在載入食友推薦…':recommendationScope==='nearby'?'附近還沒有推薦，試試不限地區。':'還沒有食友推薦其他店家。'}</p>`}${restaurantReviewsMarkup(id)}`;
  }
  function renderRestaurantPage(id) {
    const s=byId.get(id);if(!s)return;
    const r=records[id],related=stores.filter(o=>records[o.id].eaten&&sharesType(s,o));
    const diary=visits.filter(v=>v.store===id).sort((a,b)=>b.date.localeCompare(a.date));
    const values={length:community[id]?.count||0},today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
    const recommended=r.comparison && byId.get(r.comparison.id);
    const noteEditor=`<details class="detail-editor review-editor"><summary>${r.note||r.comparison?'編輯':'寫'}我的短評與推薦</summary><div class="editor-content"><form id="review-form" data-id="${id}"><section class="review-editor-section" aria-labelledby="review-note-heading"><h3 id="review-note-heading">我的短評</h3><textarea name="note" aria-label="我的短評" maxlength="3000" placeholder="食物好吃在哪裡？下次會想點什麼？">${esc(r.note)}</textarea><label class="note-public"><input name="notePublic" type="checkbox"${r.notePublic?' checked':''}>公開這則短評，讓其他食友看見</label></section><section class="review-editor-section" aria-labelledby="review-comparison-heading"><h3 id="review-comparison-heading">同類型，我更／也推薦 <span class="optional-label">選填</span></h3><p class="muted small" id="comparison-help">推薦會公開彙整；每家店可選一間。選「不推薦其他店」並儲存即可清除。</p><select name="other" aria-label="推薦同類型餐廳" aria-describedby="comparison-help"><option value="">不推薦其他店</option>${related.map(o=>`<option value="${o.id}"${r.comparison?.id===o.id?' selected':''}>${esc(o.name)} · ${esc(o.city)}</option>`).join('')}</select><div class="comparison-fields"${r.comparison?'':' hidden'}><fieldset class="comparison-options"><legend class="small muted">和這家相比</legend><label><input type="radio" name="kind" value="better"${r.comparison?.kind!=='also'?' checked':''}> 更推薦</label><label><input type="radio" name="kind" value="also"${r.comparison?.kind==='also'?' checked':''}> 也推薦</label></fieldset><label>推薦原因（選填）<select name="reason"><option value="">不填原因</option>${recommendationReasons.map(reason=>`<option value="${esc(reason)}"${r.comparison?.reason===reason?' selected':''}>${esc(reason)}</option>`).join('')}</select></label></div>${related.length?'':'<p class="muted small">目前沒有其他已吃過的同類型店家。</p>'}</section><div class="review-editor-footer"><button type="submit" class="primary">儲存短評與推薦</button><span class="muted small">短評是否公開，依上方勾選設定。</span></div></form></div></details>`;
    const reviews=`<figure class="restaurant-chart"><div class="row spread"><h3>星等分布</h3><span class="muted small" data-community-count>${values.length} 筆評分</span></div><div id="detail-community-chart">${histogram([],224,community[id]?.bins)}</div><div class="chart-axis muted small">星等</div></figure>${noteEditor}<section class="detail-section"><div id="community-content">${restaurantCommunityMarkup(id)}</div>${recommended?`<p class="muted small">我${r.comparison.kind==='better'?'更':'也'}推薦</p><div class="recommendation-strip"><button type="button" data-action="detail" data-id="${recommended.id}"><strong>${esc(recommended.name)}</strong><span>${esc(recommended.city)} · ${esc(recommended.types.join('・'))}</span></button></div>`:''}<details class="detail-editor"><summary>我的收藏標籤${r.tags?.length?' · '+esc(r.tags.join('、')):''}</summary><div class="editor-content"><form id="tags-form" data-id="${id}"><label>只有自己看得到<input name="tags" value="${esc((r.tags||[]).join('、'))}" maxlength="210" placeholder="例如：台中回家吃、約會、想吃甜點"></label><p class="muted small">以頓號或逗號分隔，最多 10 個，每個 20 字。留空可清除。</p><button type="submit">儲存標籤</button></form></div></details></section>`;
    const menusSection=`<section class="detail-section menu-section"><h3>菜單</h3><div id="menu-gallery">${menuGalleryMarkup(id)}</div><details class="detail-editor"><summary>＋ 上傳菜單</summary><div class="editor-content"><form id="menu-form" data-id="${id}"><label>菜單拍攝日期<input name="date" type="date" value="${today}" required></label><label>上傳圖片<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required></label><label class="note-public"><input name="public" type="checkbox" checked>公開菜單，讓食友查看</label><p class="muted small">JPG、PNG、WebP，1.5 MB 以下。取消勾選可存為私人菜單。</p><button type="submit">上傳菜單</button></form></div></details>${syncError?`<p class="form-feedback" role="status">${esc(syncError)} <button type="button" data-action="retry-sync">重試同步</button></p>`:''}</section>`;
    app.innerHTML=`<main class="restaurant-page"><div class="restaurant-content"><button type="button" class="detail-back" data-action="back-detail">← ${detailReturn==='profile'?'我的美食':detailReturn==='wheel'?'轉盤結果':detailReturn==='lists'?'專欄':detailReturn==='people'?'食友':'探索餐廳'}</button><div class="restaurant-title-row"><h1 id="detail-title" tabindex="-1">${esc(s.name)}</h1><div class="restaurant-rating" id="detail-community-score"><strong>${community[id]?.average==null?'—':community[id].average.toFixed(1)+' ★'}</strong><span>${community[id]?.count||0} 則評分</span></div></div><p class="restaurant-meta muted">${esc(s.city+s.district)} · ${esc(s.types.join('・'))}</p><p class="restaurant-address muted">${esc(s.address)}</p>${!s.coordinates?`<div class="restaurant-location-notice"><p class="muted small">位置待補，目前無法計算距離，也不會加入附近轉盤。</p>${viewer&&(viewer.owner||s.canEditLocation)?`<button type="button" data-action="edit-store-location" data-id="${id}">補上餐廳位置</button>`:''}</div>`:''}<div class="detail-actions"><button type="button" class="${r.eaten?'active':''}" data-action="toggle-eaten" data-id="${id}" aria-pressed="${r.eaten}">${r.eaten?'✓ 吃過':'吃過'}</button><button type="button" class="${r.wish?'active':''}" data-action="toggle-wish" data-id="${id}" aria-pressed="${r.wish}">${r.wish?'✓ 待訪':'待訪'}</button><button type="button" class="favorite ${r.best?'active':''}" data-action="toggle-best" data-id="${id}" aria-pressed="${r.best}">${r.best?'♥ 此生最愛':'♡ 此生最愛'}</button></div><button type="button" class="primary restaurant-rate-button" data-action="rate" data-id="${id}">${r.rating===null?'給這家店打星':'我的 '+r.rating.toFixed(1)+' ★ · 修改星等'}</button><div class="restaurant-secondary-actions"><button type="button" data-action="edit-review">寫短評與推薦</button><div class="restaurant-map-actions"><button type="button" class="quiet" data-action="view-map" data-id="${id}">在地圖查看</button><a class="button-link" href="${esc(s.mapsUrl)}" target="_blank" rel="noopener noreferrer">${s.locationPending?'Google Maps 搜尋 ↗':'Google Maps / 導航 ↗'}</a></div></div><details class="restaurant-waiting detail-editor"><summary><span>現場候位</span><span id="waiting-glance" class="muted small">${esc(waitingGlance(id))}</span></summary><div id="waiting-content">${waitingMarkup(id)}</div></details><div class="restaurant-tabs" role="tablist" aria-label="餐廳資訊"><button type="button" role="tab" id="detail-reviews-tab" data-detail-tab="reviews" class="${detailTab==='reviews'?'active':''}" aria-selected="${detailTab==='reviews'}" aria-controls="restaurant-tab-panel">評價</button><button type="button" role="tab" id="detail-menu-tab" data-detail-tab="menu" class="${detailTab==='menu'?'active':''}" aria-selected="${detailTab==='menu'}" aria-controls="restaurant-tab-panel">菜單</button></div><div id="restaurant-tab-panel" role="tabpanel" aria-labelledby="${detailTab==='reviews'?'detail-reviews-tab':'detail-menu-tab'}">${detailTab==='reviews'?reviews:menusSection}</div><details class="detail-section restaurant-diary"><summary><span>我的食誌</span><span class="muted small">${diary.length} 次紀錄</span></summary><div class="diary-content">${diary.length?diary.slice(0,3).map(v=>`<article class="visit-card"><p class="muted small">${esc(v.date)}</p><p>${esc(v.dishes||'')}</p><p>${esc(v.text)}</p></article>`).join(''):'<p class="muted small">還沒有記錄用餐日期。食誌只存在此瀏覽器，清除網站資料後會消失。</p>'}<details class="detail-editor"><summary>＋ 記這次</summary><div class="editor-content"><form id="visit-form" data-id="${id}"><label>用餐日期<input name="date" type="date" value="${today}" required></label><label>吃了什麼<input name="dishes" maxlength="200" placeholder="菜色、飲品"></label><label>這次的感想<textarea name="text" maxlength="3000" placeholder="可以留空"></textarea></label><button type="submit">新增這次用餐紀錄</button></form></div></details></div></details></div></main>`;
    if(!restaurantCommunity.has(id))void loadRestaurantCommunity(id);
  }
  function setRating(id, value) {
    if(!viewer)throw new Error('請先登入，才能儲存自己的星等。');
    if(!byId.has(id) || !validRating(value))throw new Error('請選擇 0.5 到 5 星，或取消評分。');
    records[id].rating=value;if(value!==null){records[id].eaten=true;records[id].wish=false;}save();
  }
  function setBest(id, enabled) {
    if(!viewer)throw new Error('請先登入，才能儲存自己的收藏。');
    if(!byId.has(id))throw new Error('找不到餐廳。');
    if(enabled && !records[id].best && favorites().length>=5)return false;
    records[id].best=enabled;if(enabled){records[id].eaten=true;records[id].wish=false;}save();return true;
  }
  function updateRatingDraft(raw,snap=true){
    if(!Number.isFinite(raw))return;
    raw=Math.max(.5,Math.min(5,raw));const value=Math.round(raw*2)/2;
    draftRating=value;const slider=document.getElementById('rating-slider');if(snap)slider.value=String(value);slider.setAttribute('aria-valuetext',value.toFixed(1)+' 星');
    document.getElementById('rating-preview').textContent=value.toFixed(1)+' ★';
    document.getElementById('rating-track').style.setProperty('--rating-fill',(((snap?value:raw)-.5)/4.5*100)+'%');
    document.getElementById('rating-help').textContent=snap?'尚未儲存':'放手停在半星，按儲存才更新';
    document.querySelector('[data-action="save-rating"]').disabled=false;
    document.querySelector('[data-action="rating-minus"]').disabled=value<=.5;
    document.querySelector('[data-action="rating-plus"]').disabled=value>=5;
  }
  function renderRating(id) {
    const st=byId.get(id);if(!st)return;ratingId=id;draftRating=records[id].rating;
    const value=draftRating??3,d=document.getElementById('rating-dialog');
    d.innerHTML=`<div class="dialog-head"><h2 id="rating-title">${esc(st.name)}</h2><button type="button" data-close="rating-dialog" aria-label="關閉">×</button></div><p class="muted">我的星等</p><div class="rating-readout"><button type="button" data-action="rating-minus" aria-label="減少半顆星"${value<=.5?' disabled':''}>−</button><output id="rating-preview" class="rating-preview" for="rating-slider">${draftRating===null?'—':draftRating.toFixed(1)+' ★'}</output><button type="button" data-action="rating-plus" aria-label="增加半顆星"${value>=5?' disabled':''}>＋</button></div><div id="rating-track" class="rating-track" style="--rating-fill:${(value-.5)/4.5*100}%"><div class="rating-rail" aria-hidden="true"></div><input id="rating-slider" type="range" min="0.5" max="5" step="0.01" value="${value}" aria-label="我的星等，放手吸附半顆星" aria-valuetext="${value.toFixed(1)} 星" aria-describedby="rating-help"></div><div class="rating-scale" aria-hidden="true">${[.5,2.5,5].map(v=>`<span style="left:${(v-.5)/4.5*100}%">${v}</span>`).join('')}</div><p id="rating-help" class="muted small rating-hint">${draftRating===null?'滑動或按 ＋／− 選擇星等':'拖曳選擇，放手停在半星'}</p><button type="button" class="primary rating-save" data-action="save-rating"${draftRating===null?' disabled':''}>儲存星等</button>${records[id].rating!==null?'<button type="button" class="remove-rating" data-action="remove-rating">取消我的評分</button><p class="muted small">取消星等後，吃過、短評與食誌仍保留。</p>':''}`;
    showDialog('rating-dialog');
  }
  function renderPicker(kind) {
    pickerSlot=kind;
    const d=document.getElementById('picker-dialog');
    d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">${kind==='type'?'料理類型':kind==='wish'?'加入待吃清單':'加入此生最愛'}</h2><button type="button" data-close="picker-dialog" aria-label="關閉">×</button></div>${kind==='type'?`<button type="button" class="all-types ${type?'':'active'}" data-action="clear-type" aria-pressed="${!type}">所有類型</button>${groupedTypeMarkup()}`:'<input id="picker-search" type="search" placeholder="搜尋店名" aria-label="搜尋收藏店家"><div id="picker-results"></div>'}`;
    if(kind!=='type')pickerResults('');showDialog('picker-dialog');
  }
  function pickerResults(q) {
    const result=stores.filter(s=>s.name.toLowerCase().includes(q.toLowerCase()) && (pickerSlot==='wish'?!records[s.id].wish:!records[s.id].best));
    document.getElementById('picker-results').innerHTML=result.length?result.map(s=>`<button type="button" class="store-row" data-action="choose-picker" data-id="${s.id}"><span class="store-copy"><span class="store-name">${esc(s.name)}</span><span class="store-meta">${esc(s.city+s.district)}${records[s.id].eaten?' · 吃過':''}</span></span>${ratingMarkup(s)}</button>`).join(''):'<p class="empty">沒有符合的餐廳。</p>';
  }
  async function enableSdk(key) {
    if(!/^AIza[A-Za-z0-9_-]{25,}$/.test(key))throw new Error('請貼上完整的 Google Maps 金鑰。');
    if(sdkLoading)return sdkLoading;
    sdkLoading=new Promise((resolve,reject)=>{
      window.__foodMapsReady=resolve;
      window.gm_authFailure=()=>{mapMode='embed';mapPanel.querySelector('#sdk-canvas').hidden=true;iframe.hidden=false;mapPanel.querySelector('#search-area-button').hidden=true;mapPanel.querySelector('#multi-map-button').hidden=false;embedId='';updateMap();mapNotice='金鑰尚未通過 Google 驗證；目前顯示單店地圖。';renderMapCard();reject(new Error('Google 未接受此金鑰。請檢查測試額度、網站限制與 API 設定，重新整理後再試。'));toast('Google 未接受此金鑰，已回到單店地圖。');};
      const script=document.createElement('script');script.id='google-maps-sdk';script.async=true;script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__foodMapsReady&libraries=maps,marker,places&v=weekly&language=zh-TW`;script.onerror=()=>{script.remove();sdkLoading=null;reject(new Error('Google Maps 載入失敗，請檢查網路後重試。'));};document.head.append(script);
    });
    await sdkLoading;
    const missing=stores.filter(s=>!s.coordinates);
    if(missing.length){
      const result=await Promise.allSettled(missing.map(async s=>{
        const {places}=await google.maps.places.Place.searchByText({textQuery:s.name+' '+(s.locationPending?s.city+(s.district||''):s.address),fields:['id','displayName','location'],maxResultCount:1});
        const p=places[0];if(p?.location)s.coordinates=p.location.toJSON();
      }));
      const failed=result.filter(r=>r.status==='rejected').length;if(failed)mapNotice=`${failed} 間店的位置暫時未載入；收藏資料仍保留。`;
    }
    const center=byId.get(selectedId).coordinates||stores.find(s=>s.coordinates)?.coordinates;
    if(!center)throw new Error('店家位置尚未載入，請檢查 Google Maps 測試額度後重試。');
    mapMode='sdk';iframe.hidden=true;const canvas=mapPanel.querySelector('#sdk-canvas');canvas.hidden=false;
    map=new google.maps.Map(canvas,{center,zoom:15,mapId:'DEMO_MAP_ID',mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative'});
    mapPanel.querySelector('#map-loading').hidden=true;mapPanel.querySelector('#multi-map-button').hidden=true;mapPanel.querySelector('#search-area-button').hidden=false;
    origin=origin||stores[0].coordinates;updateMarkers();
    if(page==='explore')render();
  }
  function updateMarkers() {
    if(!map)return;
    markers.forEach(m=>m.map=null);markers=[];
    filtered().forEach(s=>{
      if(!s.coordinates)return;const r=records[s.id],pin=document.createElement('button');pin.type='button';pin.className=`map-pin${r.best?' best':''}${r.wish?' wish':''}${s.id===selectedId?' chosen':''}`;pin.textContent=`${r.best?'♥ ':''}${r.rating!==null?r.rating.toFixed(1)+' ★':r.wish?'待訪':'未評'}`;pin.setAttribute('aria-label',`${s.name}，${pin.textContent}`);
      pin.addEventListener('click',()=>selectStore(s.id));
      markers.push(new google.maps.marker.AdvancedMarkerElement({map,position:s.coordinates,content:pin,title:s.name,zIndex:s.id===selectedId?10:1}));
    });
  }
  function locate() {
    if(!navigator.geolocation){toast('這個瀏覽器尚未支援定位。');return;}
    toast('取得你的位置…');
    navigator.geolocation.getCurrentPosition(p=>{
      origin={lat:p.coords.latitude,lng:p.coords.longitude};originLabel='你的位置';filteredBounds=null;
      render();
      if(layout==='map'){
        if(mapMode==='embed'){embedId='location';iframe.src=`https://www.google.com/maps?q=${origin.lat},${origin.lng}&z=14&output=embed&hl=zh-TW`;}
        else{map.panTo(origin);map.setZoom(14);}
        mapPanel.querySelector('#map-area').textContent='你的位置';
      }
      toast('已依你的位置更新直線距離。');
    },err=>toast(err.code===1?'定位未開啟，你仍可依地區找店。':'暫時無法定位，請稍後再試。'),{timeout:10000,maximumAge:60000,enableHighAccuracy:false});
  }
  function cancelWheelSpin() {
    clearTimeout(wheelTimer);spinning=false;wheelTicket++;
  }
  function randomIndex(size) {
    const n=new Uint32Array(1),limit=4294967296-4294967296%size;
    do{crypto.getRandomValues(n);}while(n[0]>=limit);
    return n[0]%size;
  }
  function shuffleWheelStores() {
    const pool=wheelPool().map(s=>s.id);
    for(let i=pool.length-1;i>0;i--){const j=randomIndex(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
    const next=[],types=new Set(),brands=new Set();
    const add=id=>{const s=byId.get(id);next.push(id);types.add(s.types[0]);if(s.brand)brands.add(s.brand);};
    // First spread cuisines and brands, then fill remaining slots. Shuffle first
    // so the same cuisine does not always contribute the same restaurant.
    for(const id of pool){const s=byId.get(id);if(next.length<8&&!types.has(s.types[0])&&(!s.brand||!brands.has(s.brand)))add(id);}
    for(const id of pool){const s=byId.get(id);if(next.length<8&&!next.includes(id)&&(!s.brand||!brands.has(s.brand)))add(id);}
    for(const id of pool)if(next.length<8&&!next.includes(id))add(id);
    if(pool.length>8 && next.every(id=>wheelStoreIds.includes(id)))next[next.length-1]=pool.find(id=>!next.includes(id));
    if(next.length>1 && next.every((id,i)=>id===wheelStoreIds[i]))next.push(next.shift());
    wheelStoreIds=next;wheelResult=null;wheelRotation=0;
  }
  function wheelOptions() {
    if(wheelArea==='nearby'?!wheelOrigin:!wheelCity)return [];
    if(wheelMode==='type')return [...wheelTypes].filter(t=>wheelPool().some(s=>s.types.includes(t))).map(t=>({id:t,label:t}));
    const available=new Set(wheelPool().map(s=>s.id));
    return wheelStoreIds.filter(id=>available.has(id)).map(id=>({id,label:byId.get(id).name}));
  }
  function openWheel() {
    cancelWheelSpin();wheelReturn=page==='profile'?'profile':'explore';wheelScroll=window.scrollY||0;
    wheelResult=null;wheelRotation=0;
    if(wheelMode==='store')shuffleWheelStores();
    if(page!=='wheel')window.history.pushState({foodView:'wheel'},'','#wheel');
    page='wheel';render();window.scrollTo({top:0,behavior:'instant'});
    document.getElementById('wheel-title')?.focus({preventScroll:true});
  }
  function leaveWheel() {
    cancelWheelSpin();
    if(window.history.state?.foodView==='wheel'){window.history.back();return;}
    window.history.replaceState(null,'',window.location.pathname+window.location.search);
    page=wheelReturn;render();window.scrollTo({top:wheelScroll,behavior:'instant'});
  }
  function wheelLabelMarkup(label) {
    const match=label.match(/^(.*?)\s+([^\s]+(?:旗艦店|分店|門市|店|分館))$/u);
    return match?`<span class="wheel-name">${esc(match[1])}</span><span class="wheel-branch">${esc(match[2])}</span>`:esc(label);
  }
  function wheelDiscMarkup(options) {
    if(!options.length)return '<div class="wheel-empty"><p>先選一種料理，再轉一下。</p></div>';
    const sector=360/options.length;
    const point=angle=>[100+100*Math.sin(angle*Math.PI/180),100-100*Math.cos(angle*Math.PI/180)].map(n=>n.toFixed(6)).join(' ');
    const slices=options.map((o,i)=>{
      const warmth=Math.min(i,options.length-i)/Math.max(1,Math.floor(options.length/2));
      const fill=`hsl(${(54-22*warmth).toFixed(2)} 94% ${[64,48,61,46,62,49,63,47][i%8]}%)`;
      return options.length===1?`<circle cx="100" cy="100" r="100" fill="${fill}"/>`:`<path d="M 100 100 L ${point(i*sector)} A 100 100 0 ${sector>180?1:0} 1 ${point((i+1)*sector)} Z" fill="${fill}" stroke="#fff" stroke-width="0.7" stroke-linejoin="round"/>`;
    }).join('');
    return `<button type="button" class="wheel-stage" data-action="spin-wheel" aria-label="${wheelResult?'再轉一次':'點轉盤開始'}；候選項目：${esc(options.map(o=>o.label).join('、'))}" aria-busy="${spinning}"${spinning?' disabled':''}><span class="wheel-disc" id="wheel-disc" aria-hidden="true" style="transform:rotate(${wheelRotation}deg)"><svg class="wheel-sectors" viewBox="0 0 200 200" aria-hidden="true">${slices}</svg>${options.map((o,i)=>{
      const angle=(i+.5)*sector*Math.PI/180,left=50+34*Math.sin(angle),top=50-34*Math.cos(angle);
      return `<span class="wheel-label" style="left:${left}%;top:${top}%"><span class="wheel-label-text" style="transform:rotate(${-wheelRotation}deg)" title="${esc(o.label)}">${wheelLabelMarkup(o.label)}</span></span>`;
    }).join('')}</span><span class="wheel-hub" id="wheel-hub" aria-hidden="true">${spinning?'轉動中':wheelResult?'再轉一次':'點一下'}</span></button><p class="wheel-tap-hint muted small">點轉盤開始旋轉</p>`;
  }
  function wheelPool(){
    if(wheelArea==='nearby'?!wheelOrigin:!wheelCity)return [];
    const pool=stores.filter(st=>(wheelArea==='nearby'?(st.coordinates&&distanceMeters(wheelOrigin,st.coordinates)<=wheelRadius*1000):(st.city===wheelCity&&(!wheelDistrict||st.district===wheelDistrict)))&&(!wheelStoreType.size||[...wheelStoreType].some(t=>matchesType(st,t)))&&(wheelStatus==='all'||records[st.id][wheelStatus]));
    return pool.sort((a,b)=>(wheelArea==='nearby'?(distanceMeters(wheelOrigin,a.coordinates)-distanceMeters(wheelOrigin,b.coordinates)):0)||((community[b.id]?.average??-1)-(community[a.id]?.average??-1)));
  }
  function wheelScopeChanged(){cancelWheelSpin();wheelResult=null;wheelRotation=0;shuffleWheelStores();render();}
  function wheelLocate(){
    if(wheelLocating)return;
    if(!navigator.geolocation){wheelLocationNote='瀏覽器不支援定位，也可以使用中正區起點。';render();return;}
    wheelLocating=true;wheelLocationNote='正在取得位置…';render();
    navigator.geolocation.getCurrentPosition(p=>{wheelLocating=false;wheelOrigin={lat:p.coords.latitude,lng:p.coords.longitude};wheelLocationNote='以我的位置為起點';if(page==='wheel')wheelScopeChanged();},e=>{wheelLocating=false;wheelLocationNote=e.code===1?'定位未開啟；可改用中正區起點。':'暫時無法定位，可重試或使用中正區起點。';if(page==='wheel')render();},{timeout:10000,maximumAge:60000});
  }
  function wheelResultMarkup() {
    if(!wheelResult)return '';
    const {id,mode}=wheelResult,result=mode==='type'?wheelPool().filter(st=>st.types.includes(id)):[byId.get(id)];
    return `<section class="wheel-result"><p class="muted small">${wheelArea==='nearby'?'附近吃':esc(wheelCity+wheelDistrict)}</p><h2>${esc(mode==='type'?id:byId.get(id).name)}</h2>${mode==='type'?`<p class="muted small">${result.length} 間 · ${wheelArea==='nearby'?'距離近到遠，同距離按星等':'依食友星等排列'}</p>`:''}${result.map(st=>card(st)).join('')}</section>`;
  }
  function renderWheelPage() {
    const options=wheelOptions(),pool=wheelPool(),disabled=spinning?' disabled':'';
    const candidates=options.filter(o=>wheelResult?.mode!=='store'||o.id!==wheelResult.id);
    const cities=[...new Set(stores.map(s=>s.city))].sort((a,b)=>a.localeCompare(b,'zh-TW'));
    const districts=[...new Set(stores.filter(s=>s.city===wheelCity).map(s=>s.district).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-TW'));
    const destination=`<label>縣市<select id="wheel-city"${disabled}><option value="">選擇縣市</option>${cities.map(c=>`<option value="${esc(c)}"${c===wheelCity?' selected':''}>${esc(c)}</option>`).join('')}</select></label><label>行政區<select id="wheel-district"${!wheelCity||spinning?' disabled':''}><option value="">所有行政區</option>${districts.map(d=>`<option value="${esc(d)}"${d===wheelDistrict?' selected':''}>${esc(d)}</option>`).join('')}</select></label><p class="wheel-destination-note muted small">依目前餐廳列表選地區，不受你現在的位置或距離限制。</p>`;
    const scope=`<section class="wheel-scope" aria-label="轉盤選店範圍"><label class="wheel-area-field">在哪裡吃<select id="wheel-area"${disabled}><option value="nearby"${wheelArea==='nearby'?' selected':''}>我的附近</option><option value="district"${wheelArea==='district'?' selected':''}>指定地區</option></select></label>${wheelArea==='nearby'?`<div class="wheel-location"><button type="button" data-action="wheel-locate"${spinning||wheelLocating?' disabled':''}>◎ ${wheelLocating?'定位中…':demo?'使用示範位置':'使用我的位置'}</button><button type="button" class="quiet" data-action="wheel-use-start"${disabled}>使用中正區起點</button></div><p class="muted small" role="status">${esc(wheelLocationNote||'先設定位置，直接找附近的店；不會套用首頁的篩選。')}</p><label>距離範圍<select id="wheel-radius"${disabled}>${[1,3,5,10].map(n=>`<option value="${n}"${n===wheelRadius?' selected':''}>${n} km 內</option>`).join('')}</select></label>`:destination}<label>選店範圍<select id="wheel-status"${disabled}><option value="all"${wheelStatus==='all'?' selected':''}>全部餐廳</option><option value="wish"${wheelStatus==='wish'?' selected':''}>我的待吃清單</option></select></label>${wheelMode==='store'?`<div class="wheel-store-type-field"><span>料理篩選（可複選）</span><div class="wheel-type-filter"><button type="button" data-action="pick-wheel-store-type" aria-haspopup="dialog"${disabled}>${wheelStoreType.size?esc([...wheelStoreType].map(t=>typeLabel(t)).join('、')):'所有料理'}</button>${wheelStoreType.size?`<button type="button" class="quiet" data-action="clear-wheel-store-type" aria-label="清除選店料理類型"${disabled}>×</button>`:''}</div></div>`:`<div class="wheel-store-type-field"><span>料理候選（最多 8 種）</span><button type="button" data-action="pick-wheel-types" aria-haspopup="dialog"${disabled}>${wheelTypes.size?esc([...wheelTypes].join('、')):'選擇料理'}</button></div>`}<p class="wheel-scope-summary">${esc(wheelArea==='nearby'?(wheelOrigin?wheelLocationNote+' · '+wheelRadius+' km 內':'尚未設定位置'):(wheelCity?wheelCity+' · '+(wheelDistrict||'所有行政區'):'尚未選擇縣市'))} · ${pool.length} 間符合條件${wheelMode==='store'?' · 轉盤 '+options.length+' 間':''}${wheelArea==='nearby'?' · 直線距離':''}</p>${wheelArea==='nearby'&&wheelOrigin&&pool.length<8&&wheelRadius<3?`<button type="button" class="quiet" data-action="wheel-expand"${disabled}>選擇較少，擴大到 3 km</button>`:''}</section>`;
    const toolbar=wheelMode==='type'?`<p class="muted">已選 ${wheelTypes.size} / 8 種料理 · ${options.length} 種有符合的店</p>`:`<p class="muted">${pool.length} 間中，放入 ${options.length} 間候選</p><button type="button" data-action="shuffle-wheel"${spinning||pool.length<2?' disabled':''}>↻ 重新洗牌</button>`;
    const settings=wheelMode==='type'?'':`<h2>候選店家</h2><p class="muted small">${pool.length>8?'洗牌會換一批，最多八間。':'洗牌會更換排列順序。'}</p><div class="wheel-candidate-list">${candidates.map(o=>`<button type="button" class="wheel-candidate" data-action="detail" data-id="${o.id}"${disabled}><strong>${esc(o.label)}</strong><span class="muted">${esc(byId.get(o.id).city)} · ${community[o.id]?.average==null?'尚未評分':community[o.id].average.toFixed(1)+' ★'}</span><span class="wheel-card-link">查看餐廳 <span aria-hidden="true">↗</span></span></button>`).join('')||`<p class="empty">${wheelResult?.mode==='store'?'目前只有這間符合條件的店，已顯示在上方。':'目前沒有符合條件的候選店家。'}</p>`}</div>`;
    app.innerHTML=`<main class="wheel-page"><div class="wheel-content"><button type="button" class="detail-back" data-action="back-wheel">返回${wheelReturn==='profile'?'我的美食':'探索餐廳'}</button><h1 id="wheel-title" tabindex="-1">不知道要吃什麼？</h1><p class="muted">先選抽餐廳或抽料理，再選在哪裡吃。</p><div class="wheel-modes" aria-label="轉盤模式"><button type="button" data-wheel-mode="type" class="${wheelMode==='type'?'active':''}" aria-pressed="${wheelMode==='type'}"${disabled}>抽料理</button><button type="button" data-wheel-mode="store" class="${wheelMode==='store'?'active':''}" aria-pressed="${wheelMode==='store'}"${disabled}>抽餐廳</button></div>${scope}<div class="wheel-toolbar">${toolbar}</div><div class="wheel-grid${wheelMode==='type'?' wheel-type-grid':''}"><section class="wheel-play" aria-label="轉盤">${options.length?wheelDiscMarkup(options):`<div class="wheel-empty"><p>${(wheelArea==='nearby'?!wheelOrigin:!wheelCity)?(wheelArea==='nearby'?'設定位置後，就能抽附近的餐廳。':'選擇縣市與行政區，就能抽目的地的餐廳。'):wheelStatus==='wish'&&!viewer?'登入後，就能從自己的待吃清單抽選。':'沒有符合的候選項目，試試其他範圍或料理。'}</p></div>`}<div id="wheel-result" aria-live="polite">${wheelResultMarkup()}</div></section>${settings?`<section class="wheel-settings" aria-label="轉盤候選">${settings}</section>`:''}</div></div></main>`;
  }
  function spinWheel() {
    if(spinning || page!=='wheel')return;
    const options=wheelOptions();if(!options.length)return;
    const index=randomIndex(options.length),sector=360/options.length;
    const target=(360-(index+.5)*sector)%360,current=((wheelRotation%360)+360)%360;
    wheelRotation+=1440+(target-current+360)%360;
    spinning=true;wheelResult=null;const ticket=++wheelTicket,mode=wheelMode;
    document.getElementById('wheel-result').innerHTML='';
    const button=document.querySelector('[data-action="spin-wheel"]');button.disabled=true;button.setAttribute('aria-busy','true');
    document.getElementById('wheel-hub').textContent='轉動中';
    document.querySelectorAll('[data-wheel-mode],[data-wheel-type],.wheel-scope select,[data-action="shuffle-wheel"],[data-action="wheel-expand"],[data-action="wheel-locate"],[data-action="wheel-use-start"],[data-action="pick-wheel-types"],[data-action="pick-wheel-store-type"],[data-action="clear-wheel-store-type"]').forEach(b=>b.disabled=true);
    document.getElementById('wheel-disc').style.transform=`rotate(${wheelRotation}deg)`;
    document.querySelectorAll('.wheel-label-text').forEach(label=>label.style.transform=`rotate(${-wheelRotation}deg)`);
    clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{
      if(ticket!==wheelTicket || page!=='wheel')return;
      spinning=false;wheelResult={mode,id:options[index].id};render();
    },window.matchMedia('(prefers-reduced-motion:reduce)').matches?0:1200);
  }
  document.addEventListener('click',async event=>{
    const image=event.target.closest('[data-menu-image]');
    if(image){const item=restaurantMenus(detailId).find(m=>m.id===image.dataset.menuImage);if(item){const d=document.getElementById('picker-dialog');d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">菜單 · ${esc(item.date)}</h2><button type="button" data-close="picker-dialog" aria-label="關閉">×</button></div><img src="${esc(item.image)}" alt="菜單大圖" style="max-width:100%;height:auto">`;showDialog('picker-dialog');}return;}
    const b=event.target.closest('button,a[data-action]');if(!b)return;
    if(b.dataset.close){closeDialog(b.dataset.close);return;}
    if(b.dataset.page){if(b.dataset.page==='profile'&&!ready){renderLogin();return;}cancelWheelSpin();if(page==='detail'||page==='wheel')window.history.replaceState(null,'',window.location.pathname+window.location.search);page=b.dataset.page;if(page==='explore')layout='list';render();if(page==='profile')void loadReputation();if(page==='lists'&&articleFeed.loaded)void loadArticles(true);if(page==='people'&&peopleFeed.loaded)void loadPeople(true);window.scrollTo({top:0,behavior:'instant'});return;}
    if(b.dataset.layout){layout=b.dataset.layout;render();return;}
    if(b.dataset.resultPage){changeResultPage(b.dataset.resultPage);return;}
    if(b.dataset.sort){sort=b.dataset.sort;render();return;}
    if(b.dataset.detailTab){detailTab=b.dataset.detailTab;render();return;}
    if(b.dataset.profileTab){profileTab=b.dataset.profileTab;profileTag='';render();return;}
    if(b.dataset.type){if(!typeOptions().includes(b.dataset.type)&&!groupedTypes().some(g=>'group:'+g.id===b.dataset.type))return;type=b.dataset.type;closeDialog('picker-dialog');render();return;}
    if(b.dataset.recommendationScope){recommendationScope=b.dataset.recommendationScope;recommendationExpanded=false;updateRestaurantCommunity(detailId);return;}
    if(b.dataset.articleFilter){articleFilter=b.dataset.articleFilter;renderLists();return;}
    if(b.dataset.wheelMode){if(spinning||!['type','store'].includes(b.dataset.wheelMode))return;if(wheelMode!==b.dataset.wheelMode){wheelMode=b.dataset.wheelMode;wheelStoreType=new Set();wheelScopeChanged();}return;}
    if(b.dataset.wheelStoreType){if(spinning)return;const value=b.dataset.wheelStoreType;if(!typeOptions().includes(value)&&!groupedTypes().some(g=>'group:'+g.id===value))return;if(wheelStoreType.has(value))wheelStoreType.delete(value);else wheelStoreType.add(value);const open=new Set([...document.getElementById('picker-dialog').querySelectorAll('.type-group')].filter(el=>el.open).map(el=>el.dataset.typeGroup));wheelScopeChanged();renderWheelStorePicker();document.getElementById('picker-dialog').querySelectorAll('.type-group').forEach(el=>{if(open.has(el.dataset.typeGroup))el.open=true});return;}
    if(b.dataset.wheelType){if(spinning)return;const t=b.dataset.wheelType;if(!typeOptions().includes(t))return;if(wheelTypes.has(t))wheelTypes.delete(t);else if(wheelTypes.size<8)wheelTypes.add(t);else{toast('轉盤最多放八種料理。');return;}wheelRotation=0;wheelResult=null;render();updateWheelPicker(t);return;}
    const action=b.dataset.action,id=b.dataset.id,r=id?records[id]:null;
    if(action==='histogram-bin'){const active=b.getAttribute('aria-pressed')!=='true';b.closest('.histogram')?.querySelectorAll('[data-action="histogram-bin"]').forEach(bin=>bin.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed',String(active));return;}
    if(action==='pick-wheel-types'){renderWheelPicker();return;}
    if(action==='pick-wheel-store-type'){renderWheelStorePicker();return;}
    if(action==='clear-wheel-store-type'){if(spinning)return;wheelStoreType=new Set();if(document.getElementById('picker-dialog').open)closeDialog('picker-dialog');wheelScopeChanged();app.querySelector('[data-action="pick-wheel-store-type"]')?.focus();return;}
    if(action==='clear-wheel-types'){if(spinning)return;wheelTypes.clear();wheelRotation=0;wheelResult=null;render();updateWheelPicker();return;}
    if(action==='vote'){void castVote(b);return;}
    if(action==='person'){void renderPerson(id);return;}
    if(action==='report-wait'){renderWaitReport(id);return;}
    if(action==='edit-review'){
      if(!requireLogin()||page!=='detail')return;
      if(detailTab!=='reviews'){detailTab='reviews';render();}
      const editor=app.querySelector('.review-editor');if(editor){editor.open=true;editor.scrollIntoView?.({block:'start',behavior:'smooth'});editor.querySelector('textarea')?.focus({preventScroll:true});}return;
    }
    if(action==='write-article'){renderArticleEditor();return;}
    if(action==='edit-article'){renderArticleEditor(id);return;}
    if(action==='refresh-articles'){void loadArticles(true);return;}
    if(action==='refresh-people'){void loadPeople(true);return;}
    if(action==='remove-article'){if(!requireLogin()||!window.confirm('刪除這篇專欄？文章與收到的投票會一起刪除。'))return;void (async()=>{try{await api('/api/articles',{id,remove:true});closeDialog('article-dialog');await loadArticles(true);await loadReputation();toast('文章已刪除。')}catch(e){document.getElementById('article-feedback').textContent=e.message}})();return;}
    if(['rate','toggle-eaten','toggle-wish','toggle-best','save-rating','remove-rating','pick-favorite','pick-wish','choose-picker','add-store'].includes(action)&&!requireLogin())return;
    if(action==='store-search-mode'){
      if(!['catalog','prototype'].includes(b.dataset.mode))return;addStoreMode=b.dataset.mode;
      document.querySelectorAll('[data-action="store-search-mode"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===addStoreMode)));
      document.getElementById('store-search-source').textContent=addStoreMode==='prototype'?'流程預覽：搜尋 → 選分店 → 確認加入。':'搜尋食星已收錄的餐廳，可直接收藏。';
      const manual=document.querySelector('#picker-dialog .manual-add');if(manual){manual.hidden=addStoreMode==='prototype';manual.open=false;}
      document.getElementById('quick-store-feedback').textContent='';renderStoreSearchResults();return;
    }
    if(action==='preview-google-branch'){previewGoogleBranch(id);return;}
    if(action==='back-google-preview'){renderStoreSearchResults();return;}
    if(action==='finish-google-preview'){if(addStoreMode!=='prototype')return;document.getElementById('store-search-results').innerHTML='<div class="store-prototype-note" role="status"><strong>流程示意完成</strong><p>未新增餐廳，也沒有修改你的待吃清單。</p></div><button type="button" data-action="back-google-preview">再試一次</button>';return;}
    if(action==='show-quick-store'){document.getElementById('quick-store-fields').hidden=false;return;}
    if(action==='choose-existing-store'){if(!requireLogin())return;const store=byId.get(id);if(!store)return;if(!records[id].eaten){records[id].wish=true;save();}closeDialog('picker-dialog');renderDetail(id);toast('已開啟店家；未吃過的店已加入待吃。');return;}
    if(action==='fill-store-share'){fillRestaurantShare(document.getElementById('add-store-form'));return;}
    if(demo&&action==='demo-select-place'){const s=demo.place(id);if(!s)return;document.getElementById('store-search-results').innerHTML=`<section class="demo-branch-confirm"><h3>${esc(s.name)}</h3><p>${esc(s.address)}</p><p>${esc(distance(s))}（依示範座標計算）</p><p class="muted small">地址與位置會自動帶入；此處使用虛構體驗資料。</p><button type="button" class="primary" data-action="demo-add-place" data-id="${esc(id)}">加入待吃</button><button type="button" data-action="demo-back-search">重新選分店</button></section>`;return;}
    if(demo&&action==='demo-back-search'){renderDemoStoreResults();return;}
    if(demo&&action==='demo-add-place'){const button=event.target.closest('button');button.disabled=true;try{if(!byId.has(id)){const data=await api('/api/restaurants',{demoPlaceId:id});installCatalog([data.restaurant]);}if(!records[id].eaten){records[id].wish=true;save();}closeDialog('picker-dialog');clearExploreFilters();renderDetail(id);toast('已加入待吃，位置已帶入；只存此瀏覽器。');}catch(error){toast(error.message);button.disabled=false;}return;}
    if(action==='add-store'){renderAddStore();return;}
    if(action==='refresh-recommendations'){void loadRestaurantCommunity(id,true);return;}
    if(action==='expand-recommendations'){recommendationExpanded=!recommendationExpanded;updateRestaurantCommunity(detailId);return;}
    if(action==='rating-minus'||action==='rating-plus'){updateRatingDraft(Math.max(.5,Math.min(5,(draftRating??3)+(action==='rating-plus'?.5:-.5))));return;}
    if(action==='wheel-locate'){if(demo){wheelOrigin={lat:25.041,lng:121.527};wheelLocationNote='以示範位置為起點';wheelScopeChanged();}else wheelLocate();return;}
    if(action==='wheel-expand'){if(spinning)return;wheelRadius=3;wheelScopeChanged();return;}
    if(action==='wheel-use-start'){wheelOrigin=stores[0].coordinates;wheelLocationNote=demo?'以示範位置為起點':'以中正區巧之味濟南店為起點';wheelScopeChanged();return;}
    if(action==='retry-sync'){if(viewer&&syncPending)void sync();else void bootstrap();return;}
    if(action==='refresh-community'){void bootstrap();return;}
    if(action==='edit-name'){const d=document.getElementById('picker-dialog');d.innerHTML=`<div class="dialog-head"><h2 id="picker-title">修改暱稱</h2><button data-close="picker-dialog">×</button></div><form id="name-form"><input name="name" maxlength="40" required value="${esc(viewer.name)}" aria-label="暱稱"><button type="submit" class="primary">儲存</button></form>`;showDialog('picker-dialog');return;}

    if(action==='select-store'){selectStore(id);return;}
    if(action==='detail'){renderDetail(id);return;}
    if(action==='back-detail'){leaveDetail();return;}
    if(action==='rate'){renderRating(id);return;}
    if(action==='toggle-eaten' && r){if(r.eaten){if(r.rating!==null||r.best){toast('請先取消星等與此生最愛，再取消吃過。');return;}r.eaten=false;}else{r.eaten=true;r.wish=false;}save();detailRefresh(id);return;}
    if(action==='toggle-wish' && r){if(r.eaten){toast('這間已吃過；可在食誌記錄下次用餐。');return;}r.wish=!r.wish;save();detailRefresh(id);return;}
    if(action==='toggle-best' && r){if(!setBest(id,!r.best)){toast('五間此生最愛已滿，先移除一間再加入。');return;}detailRefresh(id);return;}
    if(action==='save-rating'){setRating(ratingId,draftRating);closeDialog('rating-dialog');detailRefresh(ratingId);toast('星等已保留，正在同步。');return;}
    if(action==='remove-rating'){setRating(ratingId,null);closeDialog('rating-dialog');detailRefresh(ratingId);toast('已取消評分；吃過與其他紀錄保留。');return;}
    if(action==='edit-store-location'){renderLocationPicker(id);return;}
    if(action==='view-map'){selectedId=id;city=byId.get(id).city;type='';status='all';query='';filteredBounds=null;window.history.replaceState(null,'',window.location.pathname+window.location.search);page='explore';layout='map';render();return;}
    if(action==='pick-type'){renderPicker('type');return;}
    if(action==='clear-type'){type='';if(document.getElementById('picker-dialog').open)closeDialog('picker-dialog');render();app.querySelector('[data-action="pick-type"]')?.focus();return;}
    if(action==='pick-favorite'){renderPicker('best');return;}
    if(action==='pick-wish'){renderPicker('wish');return;}
    if(action==='choose-picker'){if(pickerSlot==='best'){if(!setBest(id,true)){toast('此生最愛最多五間。');return;}}else{if(r.eaten){toast('這間已吃過，已在吃過清單。');return;}r.wish=true;save();}closeDialog('picker-dialog');render();return;}
    if(action==='popular-info'){toast('目前只有你的紀錄；熱門排序需累積食友評分、愛心與留言。');return;}
    if(action==='setup-key'&&demo){toast('體驗版使用示範位置，不需要 API 金鑰。');return;}
    if(action==='setup-key'){showDialog('key-dialog');return;}
    if(action==='locate'){if(demo){origin={lat:25.041,lng:121.527};originLabel='示範位置';render();}else locate();return;}
    if(action==='search-area' && map){filteredBounds=map.getBounds();origin=map.getCenter().toJSON();originLabel='地圖中心';city='';refreshMapRegion();return;}
    if(action==='clear-bounds'){filteredBounds=null;render();return;}
    if(action==='wheel'){openWheel();return;}
    if(action==='back-wheel'){leaveWheel();return;}
    if(action==='shuffle-wheel'){if(!spinning){shuffleWheelStores();render();}return;}
    if(action==='spin-wheel'){spinWheel();return;}

  });
  document.addEventListener('keydown',event=>{
    if(event.target.id!=='rating-slider')return;
    const deltas={ArrowLeft:-.5,ArrowDown:-.5,ArrowRight:.5,ArrowUp:.5};
    if(event.key in deltas){event.preventDefault();updateRatingDraft((draftRating??3)+deltas[event.key]);}
    if(event.key==='Home'||event.key==='End'){event.preventDefault();updateRatingDraft(event.key==='Home'?.5:5);}
  });
  const communityRefreshTimer=setInterval(()=>{if(!document.hidden)refreshVisibleCommunity();},30000);
  document.getElementById('wheel-picker-dialog').addEventListener('close',()=>app.querySelector('[data-wheel-mode="type"]')?.focus({preventScroll:true}));
  window.addEventListener('pagehide',()=>clearInterval(communityRefreshTimer),{once:true});
  function refreshVisibleCommunity(force=false){if(page==='detail')void loadRestaurantCommunity(detailId,force);if(page==='profile')void loadReputation();if(page==='lists')void loadArticles(force);if(page==='people')void loadPeople(force);}
  window.addEventListener('focus',()=>refreshVisibleCommunity(true));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshVisibleCommunity(true);});
  document.addEventListener('input',event=>{
    if(event.target.form?.id==='add-store-form'){const form=event.target.form;if(event.target.name==='address'){const parsed=parseRestaurantShare(form.elements.address.value);if(parsed.city)form.elements.city.value=parsed.city;form.elements.district.value=parsed.district||'';}rememberNewStoreDraft(form);}
    if(event.target.id==='rating-slider')updateRatingDraft(Number(event.target.value),false);
    if(event.target.id==='store-search'){renderStoreSearchResults();return;}
    if(event.target.id==='search'){query=event.target.value;refreshResults();}
    if(event.target.id==='picker-search')pickerResults(event.target.value);
  });
  document.addEventListener('change',event=>{
    if(event.target.form?.id==='add-store-form')rememberNewStoreDraft(event.target.form);
    if(event.target.form?.id==='review-form'&&event.target.name==='other'){event.target.form.querySelector('.comparison-fields').hidden=!event.target.value;return;}
    if(event.target.id==='rating-slider'){updateRatingDraft(Number(event.target.value));return;}
    if(event.target.id==='profile-tag'){profileTag=event.target.value;render();return;}
    if(event.target.id==='sort-filter'){sort=event.target.value;render();}
    if(event.target.id==='results-page'){changeResultPage(event.target.value);return;}
    if(event.target.id.startsWith('wheel-')){if(spinning)return;if(event.target.id==='wheel-area'){if(!['nearby','district'].includes(event.target.value))return;wheelArea=event.target.value;}if(event.target.id==='wheel-city'){if(!stores.some(s=>s.city===event.target.value)&&event.target.value!=='')return;wheelCity=event.target.value;wheelDistrict='';}if(event.target.id==='wheel-district'){if(!stores.some(s=>s.city===wheelCity&&s.district===event.target.value)&&event.target.value!=='')return;wheelDistrict=event.target.value;}if(event.target.id==='wheel-radius'){const radius=Number(event.target.value);if(![1,3,5,10].includes(radius))return;wheelRadius=radius;}if(event.target.id==='wheel-status'){if(event.target.value==='wish'&&!requireLogin()){event.target.value=wheelStatus;return;}wheelStatus=event.target.value;}wheelScopeChanged();return;}
    if(event.target.id==='city-filter'){city=event.target.value;filteredBounds=null;render();}
    if(event.target.id==='status-filter'){status=event.target.value;render();}
  });
  document.addEventListener('submit',async event=>{
    const f=event.target;const known=['name-form','review-form','visit-form','menu-form','key-form','add-store-form','tags-form','wait-form','article-form','quick-store-form','store-location-form'];if(!known.includes(f.id))return;event.preventDefault();const values=new FormData(f),id=f.dataset.id;
    if(f.id!=='key-form'&&!requireLogin())return;
    if(f.id==='store-location-form'){
      const button=f.querySelector('button[type="submit"]'),feedback=document.getElementById('store-location-feedback');button.disabled=true;feedback.textContent='正在確認位置…';
      try{const data=await api('/api/restaurants/'+id+'/location',{mapsUrl:String(values.get('mapsUrl')||''),confirmed:values.get('confirmed')==='on'});installCatalog([data.restaurant]);closeDialog('picker-dialog');render();toast('已補上餐廳位置，距離已更新。');}catch(error){feedback.textContent=error.message+'；輸入已保留。';}finally{button.disabled=false;}return;
    }
    if(f.id==='quick-store-form'){
      if(addStoreMode==='prototype'||document.getElementById('quick-store-fields').hidden)return;
      const feedback=document.getElementById('quick-store-feedback'),button=f.querySelector('button[type="submit"]');
      const name=String(values.get('name')||'').trim(),city=String(values.get('city')||'');
      if(isRestaurantLink(name)){feedback.textContent='請輸入店名，不要把地圖連結當作店名。';return;}
      if(!name||!city){feedback.textContent='請輸入店名並選擇縣市。';document.getElementById('quick-store-fields').hidden=false;return;}
      button.disabled=true;feedback.textContent='正在加入…';
      try{const data=await api('/api/restaurants',{quickAdd:true,name,city,district:String(values.get('district')||''),types:[String(values.get('type')||'其他')]});installCatalog([data.restaurant]);if(!records[data.restaurant.id].eaten){records[data.restaurant.id].wish=true;save();}closeDialog('picker-dialog');clearExploreFilters();renderDetail(data.restaurant.id);toast(data.duplicate?'已開啟現有店家。':'已加入待吃，詳細地址待補。');}
      catch(error){feedback.textContent=error.message+'；輸入已保留。';}finally{button.disabled=false;}return;
    }
    if(f.id==='wait-form'){
      const button=f.querySelector('button[type="submit"]'),feedback=document.getElementById('wait-feedback');button.disabled=true;feedback.textContent='正在送出…';
      try{const body={restaurant:id};for(const key of Object.keys(waitLabels))body[key]=String(values.get(key)||'');const data=await api('/api/wait-reports',body);restaurantCommunity.set(id,{...restaurantCommunity.get(id),waiting:data.waiting,receivedAt:Date.now()});updateRestaurantCommunity(id);closeDialog('wait-dialog');toast('現場回報已共享，45 分鐘後退出即時摘要。');}
      catch(e){feedback.textContent=e.message+'；輸入已保留，請重試。'}finally{button.disabled=false;}return;
    }
    if(f.id==='article-form'){
      const button=f.querySelector('button[type="submit"]'),feedback=document.getElementById('article-feedback');button.disabled=true;feedback.textContent='正在儲存…';
      try{await api('/api/articles',{id,title:String(values.get('title')||''),body:String(values.get('body')||''),stores:values.getAll('stores')});closeDialog('article-dialog');await loadArticles(true);await loadReputation();toast('已儲存體驗專欄，只在此瀏覽器顯示。');}
      catch(e){feedback.textContent=e.message+'；輸入已保留，請重試。'}finally{button.disabled=false;}return;
    }
    if(f.id==='add-store-form'){
      const button=f.querySelector('button[type="submit"]'),feedback=document.getElementById('add-store-feedback');rememberNewStoreDraft(f);
      if(!values.get('mapsUrl')){feedback.textContent='請先貼上 Google Maps 連結並按「帶入資料」。';return;}
      if(!values.get('city')){feedback.textContent='地址未能辨識縣市，請展開「其他資料」補上縣市。';f.querySelector('.add-store-extra').open=true;return;}
      const types=[...new Set([String(values.get('type')), ...parseTags(values.get('extraTypes')||'')])];
      if(types.length>5||types.some(t=>!t||t.length>20)){feedback.textContent='最多五個料理類型，每個 20 字。';return;}
      button.disabled=true;feedback.textContent='正在確認店家…';
      try{const data=await api('/api/restaurants',{mapsUrl:String(values.get('mapsUrl')),name:String(values.get('name')),city:String(values.get('city')),district:String(values.get('district')||''),address:String(values.get('address')),types});installCatalog([data.restaurant]);if(values.get('wish')==='on'&&!records[data.restaurant.id].eaten){records[data.restaurant.id].wish=true;save();}try{localStorage.setItem(STORAGE+'.new-store','null');}catch{}clearExploreFilters();revealExploreStore(data.restaurant.id);closeDialog('picker-dialog');renderDetail(data.restaurant.id);toast(data.duplicate?'這家已在餐廳列表，已開啟原店家。':'餐廳已新增，食友現在可以找到這家店。');}
      catch(e){feedback.textContent=e.message+(e.code==='maps_name_mismatch'?' 你填的資料已保留，修正連結後可再次新增。':'；資料仍保留，請再試一次。');feedback.focus();}
      finally{button.disabled=false;}
      return;
    }
    if(f.id==='tags-form'){const tags=parseTags(values.get('tags')||'');if(tags.length>10||tags.some(t=>t.length>20)){toast('最多 10 個標籤，每個 20 字。');return;}records[id].tags=tags;save();render();toast('標籤已保留，正在同步。');return;}
    if(f.id==='name-form'){try{const data=await api('/api/profile',{name:String(values.get('name'))});viewer.name=data.name;closeDialog('picker-dialog');render();}catch(e){toast(e.message)}return;}
    if(f.id==='review-form'){
      const other=String(values.get('other')||''),kind=String(values.get('kind')||'better');
      if(other&&(!records[other]?.eaten||!sharesType(byId.get(id),byId.get(other))||!['better','also'].includes(kind))){toast('請選擇吃過的同類型店家；短評與推薦尚未儲存。');return;}
      const reason=String(values.get('reason')||'');
      records[id].note=String(values.get('note')||'').slice(0,3000);
      records[id].notePublic=values.get('notePublic')==='on';
      records[id].comparison=other?{id:other,kind,...(recommendationReasons.includes(reason)?{reason}:{})}:null;
      save();render();toast('短評與推薦已保留，正在同步。');return;
    }
    if(f.id==='visit-form'){const date=String(values.get('date'));if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast('請選擇用餐日期。');return;}visits.push({id:crypto.randomUUID(),store:id,date,dishes:String(values.get('dishes')).slice(0,200),text:String(values.get('text')).slice(0,3000)});records[id].eaten=true;records[id].wish=false;save();detailRefresh(id);toast('已加入食誌。');return;}
    if(f.id==='menu-form'){const file=values.get('image'),date=String(values.get('date'));if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>1500000){toast('請選擇 1.5 MB 以下的 JPG、PNG 或 WebP 圖片。');return;}const button=f.querySelector('button[type="submit"]');button.disabled=true;const reader=new FileReader();reader.onload=()=>{menus.push({id:crypto.randomUUID(),store:id,date,image:String(reader.result),public:values.get('public')==='on'});if(!save()){menus.pop();return;}renderDetail(id);toast('菜單已暫存，正在上傳；完成後會顯示拍攝日期。');};reader.onerror=()=>{button.disabled=false;toast('圖片讀取失敗，請再試一次。');};reader.readAsDataURL(file);return;}
    if(f.id==='key-form'){const button=f.querySelector('button[type="submit"]'),feedback=document.getElementById('key-feedback');button.disabled=true;feedback.textContent='正在載入 Google Maps…';try{await enableSdk(String(values.get('key')).trim());document.getElementById('maps-key').value='';feedback.textContent='';closeDialog('key-dialog');toast('多店地圖已啟用。');}catch(error){feedback.textContent=error.message;}finally{button.disabled=false;}return;}
  });
  // Tools use the same state transitions as the visible interface.
  const context=document.modelContext,lifecycle=new AbortController();
  if(context?.registerTool){
    const tools=[
      {name:'read_food_collection',title:'讀取餐廳收藏',description:'讀取這個瀏覽器內的餐廳、個人星等與收藏狀態。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||Object.keys(input).length)throw new Error('不接受參數。');return stores.map(s=>({id:s.id,name:s.name,city:s.city,rating:records[s.id].rating,eaten:records[s.id].eaten,wish:records[s.id].wish,best:records[s.id].best}));}},
      {name:'set_personal_food_ratings',title:'修改個人星等',description:'批次設定個人星等，0.5 到 5 星；null 取消評分並保留吃過與其他紀錄。',inputSchema:{type:'object',properties:{ratings:{type:'array',minItems:1,maxItems:10,items:{type:'object',properties:{id:{type:'string'},rating:{type:['number','null']}},required:['id','rating'],additionalProperties:false}}},required:['ratings'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){if(!viewer)throw new Error('請先登入');if(!input||Object.keys(input).some(k=>k!=='ratings')||!Array.isArray(input.ratings)||!input.ratings.length||input.ratings.length>10||input.ratings.some(r=>!r||Object.keys(r).some(k=>!['id','rating'].includes(k))||!byId.has(r.id)||!validRating(r.rating)))throw new Error('餐廳或星等格式不正確。');input.ratings.forEach(r=>setRating(r.id,r.rating));await sync();if(syncError)throw new Error(syncError);render();return input.ratings.map(r=>({id:r.id,rating:records[r.id].rating}));}}
    ];
    tools.forEach(t=>{try{Promise.resolve(context.registerTool(t,{signal:lifecycle.signal})).catch(()=>{});}catch{}});
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
  window.addEventListener('popstate',()=>{
    cancelWheelSpin();
    const id=detailHashId();
    if(id){detailId=id;page='detail';render();window.scrollTo({top:0,behavior:'instant'});}
    else if(window.location.hash==='#wheel'){page='wheel';if(wheelMode==='store'&&!wheelStoreIds.length)shuffleWheelStores();render();window.scrollTo({top:0,behavior:'instant'});}
    else{const fromWheel=page==='wheel'||detailReturn==='wheel';page=fromWheel?wheelReturn:detailReturn;render();window.scrollTo({top:fromWheel?wheelScroll:detailScroll,behavior:'instant'});}
  });
  const initialDetail=detailHashId();
  if(initialDetail){detailId=initialDetail;page='detail';}
  else if(window.location.hash==='#wheel')page='wheel';
  render();
  void bootstrap();
})();
