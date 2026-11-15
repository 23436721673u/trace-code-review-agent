import {spawn} from 'node:child_process';
process.stderr.write('Ready for secret JSON on stdin (input is hidden).\n');
const terminal=process.stdin.isTTY;if(terminal)process.stdin.setRawMode(true);
const line=await new Promise(resolve=>{let data='';process.stdin.setEncoding('utf8');const listener=chunk=>{data+=chunk;if(data.includes('\n')||data.includes('\r')){process.stdin.off('data',listener);process.stdin.pause();resolve(data.trim());}};process.stdin.on('data',listener);process.stdin.resume();});
if(terminal)process.stdin.setRawMode(false);
const input=JSON.parse(line);const child=spawn('py',['-3','secret_store.py','--set'],{stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONUTF8:'1'},windowsHide:true});child.stdin.end(JSON.stringify({key:input.key}));await new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve():reject(new Error('Credential setup failed')));child.on('error',reject);});
