import http from 'node:http';
import {spawnSync} from 'node:child_process';
import worker from '../dist/server/index.js';
const secret=spawnSync('py',['-3','-c','from secret_store import get_review_key;print(get_review_key())'],{encoding:'utf8',windowsHide:true});
const env={DEEPSEEK_API_KEY:secret.stdout.trim(),DEEPSEEK_MODEL:'deepseek-flash'};
const server=http.createServer(async(req,res)=>{try{const body=req.method==='POST'?await new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>2100000){reject(new Error('Request too large'));req.destroy();}else chunks.push(chunk);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);}):undefined;const request=new Request('http://127.0.0.1:8788'+req.url,{method:req.method,headers:req.headers,body});const response=await worker.fetch(request,env,{waitUntil:p=>p.catch(()=>{})});res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const chunk of response.body)res.write(Buffer.from(chunk));res.end();}catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Preview operation failed'}));}});
server.listen(8788,'127.0.0.1',()=>console.log('TRACE Worker preview: http://127.0.0.1:8788 / model configured: '+Boolean(env.DEEPSEEK_API_KEY)));
