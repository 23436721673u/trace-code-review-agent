// Portable Worker entry. Build embeds assets and the shared review engine.
import {handleReview} from '../review/http.mjs';
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/review')){const handled=await handleReview(request,env);if(handled instanceof Response)return handled;ctx?.waitUntil?.(handled.work);return handled.response;}
    if(url.pathname==='/api/health')return new Response(JSON.stringify({service:'trace-worker',llm_configured:false,version:'0.2.0'}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(url.pathname.startsWith('/api/'))return new Response(JSON.stringify({error:'该接口仅由本地 Python 验证引擎提供。'}),{status:404,headers:{'Content-Type':'application/json'}});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return new Response('Bad request',{status:400});}
    const asset=ASSETS[pathname==='/'?'/index.html':pathname];
    if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':pathname.endsWith('.html')?'no-store':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'"}});
  }
};
