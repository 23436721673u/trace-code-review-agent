// Source is treated as data. No eval, imports, builds, tests, or package installs.
export const LIMITS=Object.freeze({files:160,totalBytes:1500000,fileBytes:200000,bodyBytes:2100000,modelChars:160000,batchChars:48000,batches:4});
const encoder=new TextEncoder();
export const bytes=s=>encoder.encode(s).byteLength;
const placeholder=v=>/^(?:<.*>|\[.*\]|your[_ -]|example|placeholder|dummy|test[_-]|demo[_-]|changeme|x{4,}|\*{4,}|REDACTED)/i.test(v);
const secretPatterns=[
  {id:'SECRET-TOKEN',re:/\b(?:sk-[a-zA-Z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,})\b/g},
  {id:'SECRET-ASSIGNMENT',re:/(?:["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd|appsecret|private[_-]?key)["']?\s*[:=]\s*)(["'])([^\r\n"']{4,})\1/gi,group:2},
  {id:'SECRET-BEARER',re:/\bBearer\s+([a-zA-Z0-9._-]{20,})/g,group:1},
  {id:'SECRET-PRIVATE-KEY',re:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/g},
  {id:'SECRET-DSN',re:/:\/\/[^\s/:@]+:([^\s@]+)@/g,group:1},
];
export function secretSpans(text){
  const result=[];
  for(const p of secretPatterns){p.re.lastIndex=0;for(const m of text.matchAll(p.re)){const value=p.group?m[p.group]:m[0];if(placeholder(value))continue;const offset=p.group?m[0].lastIndexOf(value):0;result.push({start:m.index+offset,end:m.index+offset+value.length,value,rule:p.id,line:text.slice(0,m.index+offset).split('\n').length});}}
  return result.sort((a,b)=>a.start-b.start||b.end-a.end).filter((s,i,a)=>!a.slice(0,i).some(p=>p.start<=s.start&&p.end>=s.end));
}
export function redact(text){
  const spans=secretSpans(String(text));let result=String(text);
  for(const s of [...spans].sort((a,b)=>b.start-a.start)){const lines=s.value.split('\n');const masked=lines.map((_,i)=>i===0?'[REDACTED_SECRET]':'[REDACTED]').join('\n');result=result.slice(0,s.start)+masked+result.slice(s.end);}
  result=result.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,'[REDACTED_EMAIL]');
  result=result.replace(/(["'](?:phone|mobile|id_card|identity_number|身份证|手机号)["']\s*:\s*["'])([^"'\n]+)(["'])/gi,'$1[REDACTED_PII]$3');
  return result;
}
export function safePath(value){
  if(typeof value!=='string'||!value||value.length>280||/[\x00-\x1f]/.test(value))return null;
  const path=value.replace(/\\/g,'/').replace(/^\.\//,'');
  if(path.startsWith('/')||/^[a-z]:/i.test(path)||path.split('/').some(p=>p==='..'||p===''))return null;
  return path;
}
export function excludedPath(path){return /(^|\/)(?:\.git|node_modules|vendor|\.venv|venv|__pycache__|dist|build|\.next|coverage|Pods|\.gradle)(\/|$)/i.test(path)||/(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.[cm]?js|\.map)$/i.test(path);}
export function supportedPath(path){return /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|scss|less|wxml|wxss|wxs|py|php|java|kt|kts|swift|m|mm|h|c|cc|cpp|cs|go|rs|rb|dart|sql|sh|bash|ps1|json|ya?ml|toml|ini|cfg|conf|xml|properties|gradle|env|pem|key)$/i.test(path)||/(?:^|\/)(?:Dockerfile|\.env(?:\.[\w.-]+)?|\.htaccess|nginx\.conf)$/i.test(path);}
export function validateProject(payload){
  if(!payload||typeof payload!=='object'||!Array.isArray(payload.files)||!payload.files.length)throw new Error('请先选择代码文件。');
  if(payload.files.length>LIMITS.files)throw new Error(`每次最多审查 ${LIMITS.files} 个文件，请按模块分批。`);
  const files=[],skipped=[],seen=new Set();let size=0;
  for(const f of payload.files){const path=safePath(f?.path);if(!path)throw new Error('文件路径无效或包含目录穿越。');if(seen.has(path))throw new Error('存在重复文件路径。');seen.add(path);
    if(typeof f.content!=='string'||f.content.includes('\0'))throw new Error('仅支持文本代码文件。');
    if(excludedPath(path)||!supportedPath(path)){skipped.push({path,reason:'依赖、构建产物或不支持的文件类型'});continue;}
    const length=bytes(f.content);if(length>LIMITS.fileBytes)throw new Error(`${path} 超过单文件 200 KB 限制，请拆分。`);size+=length;if(size>LIMITS.totalBytes)throw new Error('文本总量超过 1.5 MB，请分批提交。');
    files.push({path,content:f.content.replace(/\r\n?/g,'\n')});}
  if(!files.length)throw new Error('没有可审查的源代码文件。');
  return {name:redact(String(payload.name||'未命名项目')).slice(0,80),target:['web','miniapp','app','mixed'].includes(payload.target)?payload.target:'mixed',mode:payload.mode==='static'?'static':'hybrid',files,skipped,size};
}
const R=(id,title,severity,category,cwe,match,impact,recommendation,preconditions='需结合调用路径与运行配置确认。',confidence='medium')=>({id,title,severity,category,cwe,match,impact,recommendation,preconditions,confidence});
export const RULES=[
 R('SQL-INJECTION','SQL 拼接使用外部输入','high','security','CWE-89',line=>/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(line)&&/(?:\+|\$\{|\{[\w.\[\]"']+\}|\s%\s|\.format\()/i.test(line)&&!/^\s*(?:\/\/|#|\*)/.test(line),'外部输入可能改变查询语义，造成越权读取或数据修改。','使用参数化查询；表名等不可参数化标识符使用固定白名单。','拼接值来自可控输入，且下游没有正确参数化或白名单。'),
 R('COMMAND-EXECUTION','命令执行调用接收动态参数','high','security','CWE-78',(l,c)=>/(?:\bexec(?:Sync)?\s*\(|os\.system\s*\(|shell\s*=\s*True|Runtime\.getRuntime\(\)\.exec)/.test(l)&&/(?:req\.|request\.|input\(|\$\{|\+|shell\s*=\s*True)/.test(c),'可控参数进入 shell 时可能触发命令注入。','改用无 shell 的参数数组接口，并对白名单命令及参数分别验证。'),
 R('DYNAMIC-EVAL','动态代码执行','high','security','CWE-95',l=>/\b(?:eval|new\s+Function)\s*\(/.test(l)&&!/^\s*(?:\/\/|#|\*)/.test(l),'动态输入可能被解释为代码，扩大代码执行风险。','使用数据解析和显式映射，避免执行不可信字符串。'),
 R('DOM-XSS','不可信内容可能进入 HTML 渲染','medium','security','CWE-79',l=>/(?:\.innerHTML\s*=|dangerouslySetInnerHTML|v-html\s*=|document\.write\s*\()/i.test(l),'未经转义的内容进入 HTML 上下文时可能执行脚本。','普通文本使用 textContent；必要的富文本使用经过配置的消毒器，并设置 CSP。','渲染值可被外部用户控制且未经过上下文正确的消毒。'),
 R('SENSITIVE-LOG','日志可能记录敏感数据','medium','privacy','CWE-532',l=>/(?:console\.(?:log|info|debug)|logger\.(?:info|debug|warn)|logging\.(?:info|debug)|print\s*\(|Log\.[diwe]\s*\()/i.test(l)&&/(?:password|passwd|token|secret|authorization|idcard|phone|mobile|身份证|手机号|req\.body|request\.body)/i.test(l),'日志可能进入第三方平台、设备日志或长期存储，扩大敏感信息暴露范围。','只记录业务所需字段；掩码处理身份、令牌和联系方式，限制留存及访问。'),
 R('TOKEN-STORAGE','浏览器持久存储认证凭据','medium','privacy','CWE-922',l=>/localStorage\.setItem\s*\(/.test(l)&&/(?:token|jwt|session|auth)/i.test(l),'同源脚本或 XSS 可以读取持久化令牌。','评估 HttpOnly、Secure、SameSite Cookie；缩短令牌有效期并避免存放高权限凭据。'),
 R('CLEARTEXT-HTTP','明文网络通信地址','medium','privacy','CWE-319',l=>/http:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\]|www\.w3\.org)/i.test(l),'请求可能暴露用户信息或被中间人修改。','业务接口和敏感资源使用 HTTPS；区分文档示例、命名空间与实际请求。','该地址用于真实网络请求，而非文档或测试样例。'),
 R('TLS-DISABLED','关闭 TLS 证书验证','high','security','CWE-295',l=>/(?:rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|onReceivedSslError[\s\S]*|handler\.proceed\s*\()/i.test(l),'连接失去可靠的服务端身份校验，可能受到中间人攻击。','恢复证书链和主机名验证，修复证书部署问题。'),
 R('ANDROID-CLEARTEXT','Android 允许明文流量','medium','privacy','CWE-319',l=>/usesCleartextTraffic\s*=\s*["']true/.test(l),'应用可能通过明文传输用户数据。','默认禁止明文流量；如确有必要，将例外限制到明确的非敏感域名。'),
 R('ANDROID-EXPORTED','Android 组件对外暴露','medium','security','CWE-926',(l,c)=>/android:exported\s*=\s*["']true/.test(l)&&!/(?:permission\s*=|MAIN|LAUNCHER)/.test(c),'其他应用可能调用暴露组件，需检查权限与输入处理。','为敏感组件设置 signature 级权限；非外部入口设 exported=false。','该组件可触发敏感操作，且没有相应权限或运行时检查。'),
 R('IOS-ATS','iOS 允许任意网络加载','medium','privacy','CWE-319',l=>/NSAllowsArbitraryLoads/.test(l),'ATS 例外可能允许应用使用不安全连接。','检查后续值；若为 true，移除全局放行并只保留必要的域级例外。','该键的有效配置值为 true。'),
 R('WEBVIEW-BRIDGE','WebView 启用 JavaScript 桥接','medium','security','CWE-749',l=>/addJavascriptInterface\s*\(/.test(l),'不可信页面可能调用本地桥接方法。','限制可加载来源与导航，缩小桥接接口并验证每次调用的权限。','WebView 可以加载攻击者控制的内容，且接口暴露敏感能力。'),
 R('MINIAPP-DOMAIN','小程序开发配置关闭域名校验','low','config','CWE-16',l=>/["']urlCheck["']\s*:\s*false/.test(l),'开发环境可能无法暴露合法域名配置问题，需与生产配置区分。','在发布前核对平台后台的合法域名与隐私配置；开发开关不等同于线上漏洞。'),
 R('MINIAPP-USERDATA','小程序采集敏感用户数据','medium','privacy','CWE-359',l=>/wx\.(?:getLocation|startLocationUpdate|getUserProfile|getPhoneNumber|chooseAddress)\s*\(/.test(l),'位置、身份或联系方式处理需要明确目的、权限说明与最小化采集。','核对用户触发时机、隐私指引、授权拒绝路径、服务端留存和第三方传输。','实际采集范围、授权时机或留存策略与声明不一致时构成风险。'),
 R('FILE-PATH','外部输入参与文件路径','high','security','CWE-22',(l,c)=>/(?:readFile|writeFile|sendFile|open\s*\(|FileInputStream|path\.join)/.test(l)&&/(?:req\.(?:query|params|body)|request\.(?:args|GET|POST)|getParameter)/.test(c),'用户可控路径可能越过预期目录边界。','解析并规范化绝对路径，验证路径仍位于允许目录；优先使用服务端资源 ID。'),
 R('UNSAFE-DESERIALIZE','不可信数据反序列化调用','high','security','CWE-502',l=>/\b(?:pickle\.loads?|yaml\.load|unserialize|ObjectInputStream)\s*\(/.test(l)&&!/SafeLoader|safe_load/.test(l),'可控序列化对象可能触发危险行为或构造异常对象。','使用安全的数据格式和显式字段校验；拒绝不可信对象反序列化。'),
 R('DEBUG-ENABLED','调试模式可能进入发布配置','medium','config','CWE-489',l=>/(?:DEBUG\s*=\s*True|debug\s*=\s*True|["']debug["']\s*:\s*true|android:debuggable\s*=\s*["']true)/.test(l),'调试信息、错误页或调试入口可能暴露内部信息。','用独立生产配置关闭调试，并验证部署环境实际值。'),
 R('WEAK-HASH','弱摘要算法用于敏感处理','medium','security','CWE-328',(l,c)=>/\b(?:md5|sha1)\s*\(|createHash\s*\(\s*["'](?:md5|sha1)/i.test(l)&&/password|passwd|token|signature|secret/i.test(c),'弱摘要不适合密码存储或要求抗碰撞的安全用途。','密码使用 Argon2id、scrypt 或 bcrypt；签名校验采用合适的认证机制。'),
 R('CORS-WILDCARD','跨域策略允许任意来源','low','config','CWE-942',l=>/(?:Access-Control-Allow-Origin["']?\s*[:=]\s*["']\*|origin\s*:\s*["']\*)/i.test(l),'若接口包含非公开数据，应核对来源策略和认证方式。','按数据敏感度配置来源白名单，结合认证评估；公开静态资源允许 * 可以是合理设计。'),
 R('OPEN-REDIRECT','重定向地址来自请求输入','medium','security','CWE-601',l=>/redirect\s*\(\s*(?:req\.|request\.)/.test(l),'外部输入可能引导用户跳转到攻击者域名。','只允许同源相对路径，或使用固定目的地白名单。'),
];
function finding(file,line,rule,evidence){return {id:`${rule.id}:${file.path}:${line}`,rule:rule.id,title:rule.title,severity:rule.severity,category:rule.category,cwe:rule.cwe,file:file.path,line,end_line:line,confidence:rule.confidence||'high',origin:'static',status:'needs_review',evidence:redact(evidence).slice(0,1000),impact:rule.impact,recommendation:rule.recommendation,preconditions:rule.preconditions,verification:'复核完整调用链、输入来源和生产配置，并添加针对该风险的回归用例。'};}
export function staticScan(files){
  const findings=[];let redactions=0,omitted=0;const add=f=>{if(findings.length<400)findings.push(f);else omitted++;};
  for(const file of files){const lines=file.content.split('\n');const spans=secretSpans(file.content);redactions+=spans.length;
    const seenSecrets=new Set();for(const s of spans){if(seenSecrets.has(s.line))continue;seenSecrets.add(s.line);add(finding(file,s.line,{id:s.rule,title:'代码中包含疑似硬编码凭据',severity:'high',category:'privacy',cwe:'CWE-798',confidence:'high',impact:'凭据若真实有效且被提交或发布，可能导致服务或数据被未授权访问。',recommendation:'撤销并轮换已暴露凭据；改用服务端环境变量或密钥管理。检查版本历史与构建产物。',preconditions:'该内容为真实有效凭据，而非明确的占位示例。'},lines[s.line-1]));}
    for(let i=0;i<lines.length;i++){const line=lines[i];if(/^\s*(?:\/\/|#|\*)/.test(line))continue;const context=lines.slice(Math.max(0,i-2),i+3).join('\n');for(const rule of RULES){if(rule.match(line,context))add(finding(file,i+1,rule,line));}}
  }
  return {findings,redactions,omitted,sanitized:files.map(f=>({...f,content:redact(f.content)}))};
}
