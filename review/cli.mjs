import {reviewProject} from './core.mjs';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>2500000){process.stdout.write(JSON.stringify({type:'error',message:'请求体过大。'})+'\n');process.exit(1);}}
try{const {payload,key,model}=JSON.parse(input);await reviewProject(payload,{key,model:model||'deepseek-flash'},event=>process.stdout.write(JSON.stringify(event)+'\n'));}catch(error){process.stdout.write(JSON.stringify({type:'error',message:'审查失败：'+String(error.message).slice(0,180)})+'\n');process.exitCode=1;}
