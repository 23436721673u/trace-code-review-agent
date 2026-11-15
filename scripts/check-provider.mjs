import {spawnSync} from 'node:child_process';
import {callReviewer} from '../review/core.mjs';
const r=spawnSync('py',['-3','-c','from secret_store import get_review_key;print(get_review_key())'],{encoding:'utf8',windowsHide:true});
const key=r.stdout.trim();if(!key)throw new Error('No local backend credential');
try{const result=await callReviewer([{role:'system',content:'Return JSON only: {"findings":[],"summary":"API connection verified","checks":[],"limitations":[]}. This is a minimal API connectivity check.'},{role:'user',content:'Return the requested JSON. No source code is being uploaded.'}],{key,model:'deepseek-flash'});console.log(JSON.stringify({connected:true,actual_model:result.model,usage:result.usage}));}catch(error){console.log(JSON.stringify({connected:false,error:error.message}));process.exitCode=1;}
