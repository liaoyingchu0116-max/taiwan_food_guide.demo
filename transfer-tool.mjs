// Browser-local SQL generator. No network, credentials, user file or target account is embedded.
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const idOK=id=>typeof id==='string'&&/^[a-z0-9-]{1,80}$/.test(id);
const mapKey=value=>{const u=new URL(value);requireValue(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['maps.app.goo.gl','goo.gl','google.com','www.google.com','maps.google.com'].includes(u.hostname),'餐廳的 Maps 連結不正確');if(u.hostname==='goo.gl')requireValue(u.pathname.startsWith('/maps/'),'Maps 連結不正確');if(['google.com','www.google.com'].includes(u.hostname))requireValue(u.pathname.startsWith('/maps'),'Maps 連結不正確');u.hash='';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_')||['g_st','g_ep','entry'].includes(k))u.searchParams.delete(k);return u.href;};
export const setupSQL='CREATE TABLE IF NOT EXISTS _food_transfer_jobs_v1 (id TEXT PRIMARY KEY NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, saved_auth TEXT, backup TEXT, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)));';
const emptyPerson=id=>['records','visits','menus','articles','wait_reports'].map(table=>`NOT EXISTS(SELECT 1 FROM ${table} WHERE person=${id})`).concat([`NOT EXISTS(SELECT 1 FROM votes WHERE voter=${id} OR author=${id})`,`NOT EXISTS(SELECT 1 FROM restaurants WHERE created_by=${id})`]).join(' AND ');
const ownerExtras=['visits','menus','articles','wait_reports'].map(t=>`NOT EXISTS(SELECT 1 FROM ${t} WHERE person='owner-collection')`).concat(["NOT EXISTS(SELECT 1 FROM votes WHERE voter='owner-collection' OR author='owner-collection')"]).join(' AND ');
const columns=['rating','eaten','wish','best','note','note_public','tags','comparison'];
export const triggerSQL=`CREATE TRIGGER IF NOT EXISTS _food_transfer_apply_v1 AFTER INSERT ON _food_transfer_jobs_v1 BEGIN
SELECT CASE WHEN NEW.target <> 'owner-collection' AND EXISTS(SELECT 1 FROM people WHERE id=NEW.target AND auth LIKE 'google:%') THEN 1 ELSE RAISE(ABORT,'TRANSFER_TARGET_ACCOUNT_CHANGED') END;
SELECT CASE WHEN ${emptyPerson('NEW.target')} THEN 1 ELSE RAISE(ABORT,'TRANSFER_TARGET_NOT_EMPTY') END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM people WHERE id='owner-collection' AND auth IS NULL) AND ${ownerExtras} THEN 1 ELSE RAISE(ABORT,'TRANSFER_ORIGINAL_OWNER_CHANGED') END;
SELECT CASE WHEN (SELECT COUNT(*) FROM records WHERE person='owner-collection')=(SELECT COUNT(*) FROM json_each(NEW.payload,'$.seed')) AND NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.seed') s LEFT JOIN records r ON r.restaurant=s.key AND r.person='owner-collection' WHERE r.person IS NULL OR r.rating IS NOT json_extract(s.value,'$.rating') OR r.eaten IS NOT json_extract(s.value,'$.eaten') OR r.wish IS NOT json_extract(s.value,'$.wish') OR r.best IS NOT json_extract(s.value,'$.best') OR r.note<>'' OR r.note_public<>0 OR r.tags<>'[]' OR r.comparison IS NOT NULL) THEN 1 ELSE RAISE(ABORT,'TRANSFER_SEED_RECORDS_CHANGED') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.restaurants') s JOIN restaurants r ON r.id=json_extract(s.value,'$.id') WHERE r.created_by<>'owner-collection') AND NOT EXISTS(SELECT 1 FROM restaurants r WHERE r.created_by='owner-collection' AND NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.restaurants') s WHERE json_extract(s.value,'$.id')=r.id)) THEN 1 ELSE RAISE(ABORT,'TRANSFER_CATALOG_CHANGED') END;
UPDATE _food_transfer_jobs_v1 SET saved_auth=(SELECT auth FROM people WHERE id=NEW.target),backup=json_object('people',(SELECT json_group_array(json_object('id',id,'auth',auth,'name',name)) FROM people WHERE id IN (NEW.target,'owner-collection')),'records',(SELECT json_group_array(json_object('person',person,'restaurant',restaurant,'rating',rating,'eaten',eaten,'wish',wish,'best',best,'note',note,'note_public',note_public,'tags',tags,'comparison',comparison,'updated',updated)) FROM records WHERE person IN (NEW.target,'owner-collection')),'restaurants',(SELECT json_group_array(json_object('id',id,'map_key',map_key,'identity_key',identity_key,'data',data,'created_by',created_by,'created',created)) FROM restaurants)) WHERE id=NEW.id;
UPDATE people SET auth=NULL WHERE id=NEW.target;
UPDATE people SET auth=(SELECT saved_auth FROM _food_transfer_jobs_v1 WHERE id=NEW.id),name=json_extract(NEW.payload,'$.name') WHERE id='owner-collection';
DELETE FROM people WHERE id=NEW.target;
INSERT INTO restaurants(id,map_key,identity_key,data,created_by,created) SELECT json_extract(s.value,'$.id'),json_extract(s.value,'$.mapKey'),json_extract(s.value,'$.identity'),json_extract(s.value,'$.data'),'owner-collection',json_extract(NEW.payload,'$.timestamp') FROM json_each(NEW.payload,'$.restaurants') s WHERE 1 ON CONFLICT(id) DO UPDATE SET map_key=excluded.map_key,identity_key=excluded.identity_key,data=excluded.data;
UPDATE records SET best=0 WHERE person='owner-collection';
INSERT INTO records(person,restaurant,rating,eaten,wish,best,note,note_public,tags,comparison,updated) SELECT 'owner-collection',s.key,json_extract(s.value,'$.rating'),json_extract(s.value,'$.eaten'),json_extract(s.value,'$.wish'),json_extract(s.value,'$.best'),json_extract(s.value,'$.note'),json_extract(s.value,'$.note_public'),json_extract(s.value,'$.tags'),json_extract(s.value,'$.comparison'),json_extract(NEW.payload,'$.timestamp') FROM json_each(NEW.payload,'$.records') s WHERE 1 ON CONFLICT(person,restaurant) DO UPDATE SET ${columns.map(c=>c+'=excluded.'+c).join(',')},updated=excluded.updated;
SELECT CASE WHEN (SELECT COUNT(*) FROM records WHERE person='owner-collection')=(SELECT COUNT(*) FROM json_each(NEW.payload,'$.records')) AND NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.records') s LEFT JOIN records r ON r.person='owner-collection' AND r.restaurant=s.key WHERE r.person IS NULL OR ${columns.map(c=>`r.${c} IS NOT json_extract(s.value,'$.${c}')`).join(' OR ')}) THEN 1 ELSE RAISE(ABORT,'TRANSFER_VERIFICATION_FAILED') END;
UPDATE _food_transfer_jobs_v1 SET completed=1 WHERE id=NEW.id;
END;`;
export async function generateTransfer(data,target){
 requireValue(idOK(target)&&target!=='owner-collection','請貼上 Console 查到的線上帳號 id');
 requireValue(data&&typeof data==='object'&&Array.isArray(data.restaurants)&&data.records&&typeof data.records==='object'&&!Array.isArray(data.records),'這不是食星匯出檔');
 requireValue(['menus','visits','articles'].every(k=>Array.isArray(data[k])&&data[k].length===0),'這個工具只處理餐廳與個人紀錄；檔案含菜單、食誌或專欄，請先另行規劃，不能略過');
 requireValue(data.restaurants.length>0&&data.restaurants.length<=1000,'餐廳數量不正確');
 requireValue(typeof data.profile?.name==='string'&&data.profile.name.trim()&&data.profile.name.length<=40,'暱稱格式不正確');
 const restaurants=[],seed={},records={},seen=new Set();
 for(const s of data.restaurants){
  requireValue(idOK(s.id)&&!seen.has(s.id),'餐廳 id 重複或格式不正確');seen.add(s.id);
  requireValue(!s.demo&&typeof s.name==='string'&&s.name.length>0&&s.name.length<=120&&typeof s.address==='string'&&s.address.length<=200&&typeof s.city==='string'&&s.city.length<=30,'餐廳資料格式不正確');
  requireValue(Array.isArray(s.types)&&s.types.length>0&&s.types.length<=5&&s.types.every(t=>typeof t==='string'&&t.length>0&&t.length<=20),'料理類型不正確');
  const c=s.coordinates;requireValue(c==null||Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&Math.abs(c.lat)<=90&&Math.abs(c.lng)<=180,'座標不正確');
  const r=data.records[s.id];requireValue(r&&[null,...Array.from({length:10},(_,i)=>(i+1)/2)].includes(r.rating)&&['eaten','wish','best','notePublic'].every(k=>typeof r[k]==='boolean'),'評分或狀態不正確');
  requireValue(!(r.eaten&&r.wish)&&(!r.best||r.eaten)&&(r.rating===null||r.eaten),'收藏狀態不一致');
  requireValue(typeof r.note==='string'&&r.note.length<=3000&&Array.isArray(r.tags)&&r.tags.length<=10&&r.tags.every(t=>typeof t==='string'&&t.length<=20),'短評或標籤格式不正確');
  if(r.comparison){const other=data.restaurants.find(s=>s.id===r.comparison.id);requireValue(other&&other.id!==s.id&&other.types?.some(t=>s.types.includes(t))&&data.records[other.id]?.eaten&&['better','also'].includes(r.comparison.kind),'推薦格式不正確');}
  records[s.id]={rating:r.rating,eaten:+r.eaten,wish:+r.wish,best:+r.best,note:r.note,note_public:+r.notePublic,tags:JSON.stringify(r.tags),comparison:r.comparison?JSON.stringify(r.comparison):null};
  const mapsUrl=mapKey(s.mapsUrl),clean={id:s.id,name:s.name,address:s.address,types:s.types,city:s.city,district:typeof s.district==='string'?s.district:'',mapsUrl,cid:typeof s.cid==='string'?s.cid:null,brand:typeof s.brand==='string'?s.brand:null,coordinates:c||null,coordinateSource:typeof s.coordinateSource==='string'?s.coordinateSource:'匯入的原餐廳座標',...(s.locationPending?{locationPending:true}: {})};
  restaurants.push({id:s.id,mapKey:mapsUrl,identity:(s.name+'|'+s.address).normalize('NFKC').replace(/\s/g,'').toLowerCase(),data:JSON.stringify(clean)});
  if(Object.hasOwn(s,'initialRating')){requireValue([null,...Array.from({length:10},(_,i)=>(i+1)/2)].includes(s.initialRating)&&['initialEaten','initialWish','initialBest'].every(k=>typeof s[k]==='boolean'),'初始紀錄格式不正確');seed[s.id]={rating:s.initialRating,eaten:+s.initialEaten,wish:+s.initialWish,best:+s.initialBest};}
 }
 requireValue(Object.keys(data.records).length===seen.size,'紀錄與餐廳筆數不一致');
 const rows=Object.values(records),summary={restaurants:restaurants.length,ratings:rows.filter(r=>r.rating!==null).length,eaten:rows.filter(r=>r.eaten).length,wish:rows.filter(r=>r.wish).length,best:rows.filter(r=>r.best).length};requireValue(summary.best<=5,'此生最愛超過五間');requireValue(Object.keys(seed).length>0,'缺少原始資料辨識，請先核對資料庫');
 const timestamp=Date.parse(data.exportedAt);requireValue(Number.isFinite(timestamp),'匯出時間不正確');
 const payload=JSON.stringify({name:data.profile.name,restaurants,records,seed,timestamp});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(target+'\n'+payload))),b=>b.toString(16).padStart(2,'0')).join('');
 const applySQL=`INSERT INTO _food_transfer_jobs_v1(id,target,payload) VALUES (${quote(hash)},${quote(target)},${quote(payload)}) ON CONFLICT(id) DO NOTHING;`;
 const verifySQL=`SELECT j.completed AS imported,COUNT(r.restaurant) AS restaurants,SUM(r.rating IS NOT NULL) AS ratings,SUM(r.eaten) AS eaten,SUM(r.wish) AS wish,SUM(r.best) AS favorites FROM _food_transfer_jobs_v1 j LEFT JOIN records r ON r.person='owner-collection' WHERE j.id=${quote(hash)} GROUP BY j.id;`;
 return {summary,job:hash,setupSQL,triggerSQL,applySQL,verifySQL,sql:[setupSQL,triggerSQL,applySQL,verifySQL].join('\n')};
}
