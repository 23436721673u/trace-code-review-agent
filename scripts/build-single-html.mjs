// Reproducible single-file desktop/offline UI. No credentials are bundled.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const strip=source=>source
  .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm,'')
  .replace(/^export\s*\{[^}]+\};?\s*$/gm,'')
  .replace(/^export\s+(?=(?:const|function|async function|class))/gm,'');
const scope=(name,files,exports)=>`const ${name}=(()=>{\n${files.map(f=>strip(read(f))).join('\n')}\nreturn {${exports}};\n})();\n`;
let ui=strip(read('public/review-ui.js'))
  .replace(/import\('\.\/review-(?:rules|report)\.js'\)/g,'Promise.resolve(TRACE_REVIEW_ENGINE)')
  .replace("mode:'hybrid'","mode:location.protocol==='file:'?'static':'hybrid'")
  .replace("'静态检查可用 · 模型未配置'","state.health.desktop_required?'离线静态检查 · 桌面入口可连接模型':'静态检查可用 · 模型未配置'");
let app=strip(read('public/app.js'))
  .replace("fetch('recipes.json')","Promise.resolve(new Response(document.getElementById('trace-recipes').textContent,{headers:{'Content-Type':'application/json'}}))")
  .replace('请通过 HTTP 服务访问，不要直接双击 HTML 文件。','内置验证契约读取失败，请重新生成 index.html。')
  .replace('欢迎使用 TRACE\',`<p>','欢迎使用 TRACE\',`<p>${location.protocol===\'file:\'?\'单文件模式：演示与静态审查可离线使用。完整 DeepSeek 审查请双击桌面的「TRACE 代码审查」。</p><p>\':\'\'}');
const offline=`
// The file:// edition never sends source to an external service.
if(location.protocol==='file:'){
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  window.fetch=async(input,options={})=>{
    const route=typeof input==='string'?input:input.url;
    if(route==='/api/health')return json({service:'trace-standalone',llm_configured:false});
    if(route==='/api/review/health')return json({available:true,configured:false,desktop_required:true,skills:TRACE_REVIEW_ENGINE.skillInventory()});
    if(route==='/api/review'){
      let payload;try{payload=JSON.parse(options.body);TRACE_REVIEW_ENGINE.validateProject(payload);}catch(e){return json({error:e.message},400);}
      if(payload.mode!=='static')return json({error:'完整模型审查请双击桌面的「TRACE 代码审查」；单文件模式可选择「仅静态规则」。'},503);
      const encoder=new TextEncoder();
      return new Response(new ReadableStream({async start(controller){
        const emit=value=>controller.enqueue(encoder.encode(JSON.stringify(value)+'\\n'));
        try{await TRACE_REVIEW_ENGINE.reviewProject(payload,{},emit);}catch(e){emit({type:'error',message:e.message});}finally{controller.close();}
      }}),{headers:{'Content-Type':'application/x-ndjson'}});
    }
    return json({error:'此功能需要桌面后端。'},503);
  };
}
`;
const bundle=scope('TRACE_DOMAIN',['public/domain.js'],'evaluate,mutations,digest,verifyChain,minimumWitness')
  +scope('TRACE_REVIEW_ENGINE',['review/rules.mjs','review/skills-data.mjs','review/skills.mjs','review/core.mjs'],'reviewProject,skillInventory,supportedPath,excludedPath,safePath,LIMITS,validateProject,redact,reportMarkdown')
  +`const TRACE_REVIEW_UI=(()=>{\n${ui}\nreturn {createReviewUI};\n})();\n`
  +offline+'\nconst {evaluate,mutations,digest,verifyChain,minimumWitness}=TRACE_DOMAIN;\nconst {createReviewUI}=TRACE_REVIEW_UI;\n'+app;
// Parse the entire generated program before replacing any user-facing output.
new vm.Script(bundle,{filename:'TRACE-single-file.js'});
const safeScript=s=>s.replace(/<\/script/gi,'<\\/script');
const css=['public/styles.css','public/theme-v2.css'].map(read).join('\n')
  .replace(/@import\s+url\([^;]+;/g,'')
  +'\n:root{--font:"Segoe UI","Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;--mono:Consolas,"Cascadia Code",monospace}\n';
let html=read('public/index.html')
  .replace(/<link rel="icon"[^>]+>/,`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(read('public/favicon.svg'))}">`)
  .replace(/<link rel="stylesheet"[^>]+>\s*/g,'')
  .replace('</head>',()=>`<style>${css}</style>\n</head>`)
  .replace('  <script src="vendor/jszip.min.js"></script>','')
  .replace('  <script type="module" src="app.js"></script>',()=>
    `<script id="trace-recipes" type="application/json">${JSON.stringify(JSON.parse(read('public/recipes.json'))).replace(/</g,'\\u003c')}</script>\n`
    +`<script>${safeScript(read('public/vendor/jszip.min.js'))}</script>\n<script type="module">${safeScript(bundle)}</script>`);
html=html.replace('</body>',`<!--\nThird-party notices: JSZip (c) Stuart Knightley et al., MIT license;\nStrix knowledge excerpts (c) Strix contributors, Apache-2.0.\nFull license texts:\n${read('public/vendor/JSZIP-LICENSE.md')}\n${read('third_party/strix/LICENSE')}\n-->\n</body>`);
const destinations=[path.join(root,'index.html'),path.resolve(root,'..','index.html')];
for(const target of destinations)fs.writeFileSync(target,html,'utf8');
console.log(JSON.stringify({built:true,bytes:Buffer.byteLength(html),files:destinations}));
