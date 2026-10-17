/* Isolated browser-only experience. No Google calls, backend, cookies or real accounts. */
(() => {
 'use strict';
 const KEY='food-star-experience-v1', blank=()=>({rating:null,eaten:false,wish:false,best:false,note:'',notePublic:false,tags:[],comparison:null});
 const seed=window.FOOD_STORES.map(s=>({...s}));
 const fresh=()=>({catalog:structuredClone(seed),records:{},visits:[],menus:[],articles:[],name:'體驗食友',reports:{}});
 let state;try{const saved=JSON.parse(localStorage.getItem(KEY));state=saved&&saved.version===1&&Array.isArray(saved.value?.catalog)&&saved.value?.records&&Array.isArray(saved.value?.visits)&&Array.isArray(saved.value?.menus)&&Array.isArray(saved.value?.articles)?saved.value:fresh();}catch{state=fresh();}
 window.FOOD_STORES=structuredClone(state.catalog);
 const candidates=new Map(),images=new Map(),reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 const reputation=()=>({id:'demo-guest',name:state.name,score:0,supporters:0,contributions:state.articles.length,badge:'體驗食友',critic:false});
 const personal=()=>Object.fromEntries(state.catalog.map(s=>[s.id,{...blank(),...state.records[s.id]}]));
 function persist(){localStorage.setItem(KEY,JSON.stringify({version:1,value:state}));}
 function community(){const records=personal();return Object.fromEntries(state.catalog.map((s,i)=>{const bins=Array(10).fill(0),rating=i%2?4:4.5;bins[rating*2-1]=6;const own=records[s.id];if(own.rating!==null)bins[own.rating*2-1]++;const count=bins.reduce((a,b)=>a+b,0);return [s.id,{count,bins,average:bins.reduce((a,n,j)=>a+n*(j+1)/2,0)/count,eaten:6+Number(own.eaten),best:Number(own.best)}];}));}
 function menuView(m){let image=images.get(m.id);if(!image){const [head,encoded]=m.bytes.split(',');const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));image=URL.createObjectURL(new Blob([bytes],{type:head.match(/data:(.*);base64/)[1]}));images.set(m.id,image);}const {bytes,...rest}=m;return {...rest,image,uploadedBy:state.name};}
 function search(query){
  const name=query.trim().slice(0,60);if(!name)return [];
  const slug=Array.from(name).map(c=>c.codePointAt(0).toString(16)).join('-').slice(0,60);
  return ['大安','中正','信義'].map((district,i)=>{const place={id:'demo-find-'+slug+'-'+i,name:name+'・'+district+'店（示範）',city:'台北',district:district+'區',address:'台北市'+district+'區體驗路 '+(100+i*20)+' 號（虛構地址）',types:['其他'],coordinates:{lat:25.039+i*.002,lng:121.535+i*.009},mapsUrl:'#',locationPending:false,canEditLocation:false,coordinateSource:'虛構體驗座標',demo:true};candidates.set(place.id,place);return structuredClone(place);});
 }
 async function fetchDemo(input,options={}){
  const pathname=new URL(typeof input==='string'?input:input.url,location.href).pathname;
  const method=options.method||'GET';let body={};
  if(typeof options.body==='string'){try{body=JSON.parse(options.body);}catch{return reply({error:'體驗資料格式不正確'},400);}}
  if(!pathname.startsWith('/api/'))return reply({error:'體驗版不會連接外部服務'},403);
  if(method==='GET'){
   if(pathname==='/api/catalog')return reply(state.catalog);
   if(pathname==='/api/me')return reply({viewer:{id:'demo-guest',name:state.name,owner:false},authProvider:'Demo',reputation:reputation(),records:personal(),visits:state.visits,menus:state.menus.map(menuView)});
   if(pathname==='/api/community')return reply(community());
   if(pathname==='/api/articles')return reply({articles:state.articles,critics:[]});
   if(pathname==='/api/people')return reply({people:[reputation(),{id:'demo-friend',name:'示範食友',score:0,supporters:0,contributions:0,badge:'示範帳號',critic:false}]});
   if(pathname.startsWith('/api/people/')){const own=pathname.endsWith('/demo-guest'),ratings=own?Object.values(personal()).map(r=>r.rating).filter(r=>r!==null):[];return reply({person:own?reputation():{...reputation(),id:'demo-friend',name:'示範食友',contributions:0},ratingCount:ratings.length,bins:Array.from({length:10},(_,i)=>ratings.filter(n=>n===(i+1)/2).length)});}
   const detail=pathname.match(/^\/api\/restaurants\/([^/]+)\/community$/);if(detail){const record=personal()[detail[1]]||blank();return reply({recommendations:[],reviews:record.notePublic&&record.note?[{author:'demo-guest',name:state.name,note:record.note,rating:record.rating,updated:Date.now(),own:true,reputation:reputation(),votes:{up:0,down:0,score:0,mine:0}}]:[],menus:state.menus.filter(m=>m.store===detail[1]&&m.public).map(menuView),waiting:{serverNow:Date.now(),windowMinutes:45,reports:state.reports[detail[1]]?[state.reports[detail[1]]]:[],mine:state.reports[detail[1]]||null}});}
  }
  if(method==='POST'){
   const previous=structuredClone(state);
   try{
    let result;
    if(pathname==='/api/restaurants'){
     const place=candidates.get(body.demoPlaceId);if(!place)return reply({error:'請先搜尋並選擇體驗分店，不需要填寫表單'},400);
     const exists=state.catalog.find(s=>s.id===place.id);if(!exists)state.catalog.push(structuredClone(place));result={restaurant:place,duplicate:!!exists};
    }else if(pathname==='/api/records'){
     for(const [id,record] of Object.entries(body.records||{}))if(state.catalog.some(s=>s.id===id))state.records[id]={...blank(),...record};
     if(Object.values(state.records).filter(r=>r.best).length>5){state=previous;return reply({error:'此生最愛最多五間'},400);}
     for(const visit of body.visits||[]){const i=state.visits.findIndex(v=>v.id===visit.id);if(i<0)state.visits.push(visit);else state.visits[i]=visit;}
     result={ok:true,reputation:reputation(),records:personal(),community:community(),visits:state.visits,menus:state.menus.map(menuView)};
    }else if(pathname==='/api/profile'){state.name=String(body.name||'體驗食友').slice(0,40);result={ok:true,name:state.name};
    }else if(pathname==='/api/menus'){
     const params=new URL(typeof input==='string'?input:input.url,location.href).searchParams,id=params.get('id');
     if(!state.menus.some(m=>m.id===id)){const bytes=new Uint8Array(options.body);if(bytes.length>1500000)return reply({error:'圖片請小於 1.5 MB'},400);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);state.menus.push({id,store:params.get('restaurant'),date:params.get('date'),public:params.get('public')==='1',uploaded:Date.now(),bytes:'data:'+options.headers['content-type']+';base64,'+btoa(binary)});}
     result={menu:menuView(state.menus.find(m=>m.id===id))};
    }else if(pathname==='/api/articles'){
     const index=state.articles.findIndex(a=>a.id===body.id);if(body.remove){if(index>=0)state.articles.splice(index,1);}else{const article={id:body.id,author:'demo-guest',name:state.name,title:body.title,body:body.body,stores:body.stores||[],own:true,created:Date.now(),updated:Date.now(),votes:{up:0,down:0,score:0,mine:0},reputation:reputation()};if(index<0)state.articles.push(article);else state.articles[index]=article;}result={ok:true};
    }else if(pathname==='/api/wait-reports'){state.reports[body.restaurant]={...body,reported:Date.now()};result={waiting:{serverNow:Date.now(),reports:[state.reports[body.restaurant]],mine:state.reports[body.restaurant],windowMinutes:45}};
    }else return reply({error:'此項多人互動尚未納入單機體驗，資料不會送往伺服器'},501);
    persist();return reply(result);
   }catch{state=previous;return reply({error:'瀏覽器儲存空間不足，請減少圖片或重置體驗。原紀錄已保留。'},507);}
  }
  return reply({error:'此功能尚未提供體驗'},501);
 }
 const storage={getItem:key=>localStorage.getItem('demo-app:'+key),setItem:(key,value)=>localStorage.setItem('demo-app:'+key,value),removeItem:key=>localStorage.removeItem('demo-app:'+key)};
 function status(message){document.getElementById('demo-status').textContent=message;}
 document.addEventListener('click',event=>{
  const reset=event.target.closest('[data-demo-reset]');if(reset){if(confirm('只清除這個瀏覽器的體驗紀錄，重新開始？')){localStorage.removeItem(KEY);for(const key of Object.keys(localStorage))if(key.startsWith('demo-app:'))localStorage.removeItem(key);location.hash='';location.reload();}return;}
  const a=event.target.closest('a[href]');if(!a)return;const href=a.getAttribute('href');
  if(href.includes('/api/export')){event.preventDefault();const url=URL.createObjectURL(new Blob([JSON.stringify({demo:true,...state},null,2)],{type:'application/json'})),download=document.createElement('a');download.href=url;download.download='food-star-demo.json';download.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
  if(href.startsWith('http')||href.includes('signout')||href.includes('signin')){event.preventDefault();status('這是免登入體驗版，不會開啟 Google 或連接正式網站。');}
 },true);
 window.FOOD_DEMO={fetch:fetchDemo,storage,search,place:id=>structuredClone(candidates.get(id)||state.catalog.find(s=>s.id===id)),status};
})();
