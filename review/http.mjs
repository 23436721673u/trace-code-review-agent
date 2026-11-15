import {LIMITS,limitedText,reviewProject,validateProject} from './core.mjs';
import {skillInventory} from './skills.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const active=new Map(),starts=new Map();
export async function handleReview(request,env={}){
  const url=new URL(request.url),path=url.pathname,origin=request.headers.get('origin');
  if(origin&&origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'请求来源不匹配。'},403);
  if(path==='/api/review/health'&&request.method==='GET')return json({available:true,configured:Boolean(env.DEEPSEEK_API_KEY),model:env.DEEPSEEK_MODEL||'deepseek-flash',read_only:true,limits:LIMITS,skills:skillInventory()});
  if(path!=='/api/review'||request.method!=='POST')return json({error:'接口不存在。'},404);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'仅接受 JSON 代码文本。'},415);
  if(Number(request.headers.get('content-length')||0)>LIMITS.bodyBytes)return json({error:'请求体过大，请按模块分批。'},413);
  const identity=request.headers.get('oai-authenticated-user-id')||'private-site-owner';
  const time=Date.now(),recent=(starts.get(identity)||[]).filter(t=>time-t<60000);starts.set(identity,recent);
  if(recent.length>=5)return json({error:'一分钟最多启动 5 次审查，请稍后再试。'},429);
  if((active.get(identity)||0)>=2)return json({error:'已有两个审查在运行。'},409);
  let payload;try{payload=JSON.parse(await limitedText(request,LIMITS.bodyBytes));}catch{return json({error:'请求格式错误或超过大小限制。'},400);}
  // Validate before opening a success stream so invalid paths get a true 400.
  try{validateProject(payload);}catch(e){return json({error:e.message},400);}
  recent.push(time);active.set(identity,(active.get(identity)||0)+1);
  const stream=new TransformStream(),writer=stream.writable.getWriter(),encoder=new TextEncoder();let closed=false;
  const send=event=>{if(!closed)writer.write(encoder.encode(JSON.stringify(event)+'\n')).catch(()=>{closed=true;});};
  const heartbeat=setInterval(()=>send({type:'heartbeat'}),15000);
  const work=(async()=>{try{await reviewProject(payload,{key:env.DEEPSEEK_API_KEY||'',model:env.DEEPSEEK_MODEL||'deepseek-flash'},send);}catch(e){send({type:'error',message:'审查未完成：'+String(e.message).slice(0,200)});}finally{clearInterval(heartbeat);active.set(identity,Math.max(0,(active.get(identity)||1)-1));if(!closed)await writer.close().catch(()=>{});closed=true;}})();
  // Caller attaches work to ctx.waitUntil on Workers. On a local process the
  // promise itself remains live while its fetch/timers are pending.
  const response=new Response(stream.readable,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Content-Type-Options':'nosniff'}});
  return {response,work};
}
