import {generateTransfer} from './transfer-tool.mjs';
const target=document.getElementById('target'),file=document.getElementById('export'),status=document.getElementById('status'),summary=document.getElementById('summary'),copy=document.getElementById('copy'),download=document.getElementById('download');
target.value=new URLSearchParams(location.hash.slice(1)).get('target')||'';
let plan=null;
function clear(){plan=null;copy.disabled=true;download.disabled=true;summary.textContent='';status.textContent='';}
target.addEventListener('input',clear);file.addEventListener('change',clear);
document.getElementById('prepare').addEventListener('click',async()=>{clear();try{if(!file.files[0])throw Error('請先選擇 food-star-records.json');if(file.files[0].size>2000000)throw Error('檔案超過 2 MB，請先另行規劃');const data=JSON.parse(await file.files[0].text());plan=await generateTransfer(data,target.value.trim());const s=plan.summary;summary.textContent=`餐廳 ${s.restaurants} 間 · 評分 ${s.ratings} 筆 · 吃過 ${s.eaten} 間 · 待吃 ${s.wish} 間 · 最愛 ${s.best} 間`;copy.disabled=false;download.disabled=false;status.textContent='已核對檔案，尚未修改任何線上資料。';}catch(e){status.textContent=e instanceof SyntaxError?'檔案不是有效的 JSON，請重新選擇原始匯出檔。':e.message;}});
copy.addEventListener('click',async()=>{if(!plan)return;try{await navigator.clipboard.writeText(plan.sql);status.textContent='已複製。請回到 Cloudflare 試用資料庫的 Console，貼上後按一次 Execute。';}catch{status.textContent='瀏覽器無法複製，請改按「下載指令檔」，用記事本開啟後全選複製。';}});
download.addEventListener('click',()=>{if(!plan)return;const url=URL.createObjectURL(new Blob([plan.sql],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='food-star-import.sql';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='已下載指令檔，內容含私人紀錄，請保留在自己的電腦。';});
