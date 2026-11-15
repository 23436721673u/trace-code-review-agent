import {createReviewUI} from './review-ui.js';
import {evaluate, mutations, digest, verifyChain, minimumWitness} from './domain.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = n => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const names = {review:'代码审查',overview:'验证演示',orchestration:'Agent 编排',evidence:'交付证据',lab:'反事实实验室',blueprint:'技能与说明'};
const roles = [{name:'契约分析',en:'CONTRACT',icon:'file',detail:'冻结验收条款与预期结果。契约哈希绑定每次运行；修复执行器不能改动测试。',tool:'inspect_spec'},{name:'候选实现',en:'BUILDER',icon:'code',detail:'读取内置场景的缺陷基线与受控候选补丁。',tool:'inspect_source'},{name:'独立验证',en:'VERIFIER',icon:'flask',detail:'按独立业务预期运行 12 条断言，记录实际值、预期值与对应需求编号。',tool:'run_tests'},{name:'反馈修复',en:'REPAIRER',icon:'bolt',detail:'根据失败测试选择补丁并重新执行。离线使用固定策略；配置模型后由模型在工具约束内决策。',tool:'apply_patch'},{name:'人工验收',en:'REVIEWER',icon:'shield',detail:'测试通过且三个预设变异全部被发现后，暂停并等待人工审阅。通过测试不等于证明无缺陷。',tool:'submit → human_gate'}];
let recipes, scenario = 'booking', run = null, backend = false, health = {}, busy = false, labResult = null, logCollapsed = false, currentView = 'review', missionTitle = '', missionNote = '', toastTimer, pollTimer;
let history = [], labScenario = '';
const storage = {
  get(k, fallback) {try {return JSON.parse(localStorage.getItem('trace.'+k)) ?? fallback;} catch {return fallback;}},
  set(k,v) {try {localStorage.setItem('trace.'+k,JSON.stringify(v));} catch {toast('浏览器存储已满；请及时导出证据。',true);}}
};
function toast(message,error=false) {const t=$('#toast');t.textContent=message;t.classList.toggle('toast-error',error);t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3800);}
function modal(title,html,eyebrow='TRACE / INSPECTOR') {$('#modalEyebrow').textContent=eyebrow;$('#modalContent').innerHTML=`<h2>${esc(title)}</h2>${html}`;if(!$('#modal').open)$('#modal').showModal();}
const reviewUI=createReviewUI({toast,modal,onNavigate:name=>{location.hash=name;}});
function saveLocal() {if(!run || backend)return; storage.set('run',run);history=[{id:run.id,scenario:run.scenario,title:run.title,status:run.status,started_at:run.started_at},...history.filter(h=>h.id!==run.id)].slice(0,15);storage.set('history',history);}
function activeRecipe(){return recipes[scenario];}
function latestEvaluation(){return run?.evaluations?.at(-1);}
function statusName(s){return ({running:'执行中',awaiting_approval:'等待人工验收',approved:'已确认验收',failed:'验证未通过',error:'执行中断',interrupted:'运行中断'}[s] || '尚未运行');}
function intro(kicker,title,description){return `<div class="view-heading"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>`;}
function renderMetrics() {
  const result=latestEvaluation(), passed=result?.passed??0,total=activeRecipe().cases.length;
  const specs=run?activeRecipe().requirements.filter(r=>result?.tests.filter(t=>t.req===r.id).every(t=>t.passed)).length:0;
  const killed=run?.mutation?.mutants.filter(m=>m.killed).length??0;
  const bars=[13,18,11,23,18,27,24,31].map(n=>`<i style="height:${n}px"></i>`).join('');
  $('#metrics').innerHTML=`
    <div class="metric"><div class="metric-label">验收契约 ${icon('file')}</div><div class="metric-value">03<small>条独立需求</small></div><div class="metric-foot"><span class="good">${specs}/3</span> 已验证满足</div><div class="spark-bars">${bars}</div></div>
    <div class="metric"><div class="metric-label">测试通过 ${icon('check')}</div><div class="metric-value">${String(passed).padStart(2,'0')}<small>/ ${total} 个断言</small></div><div class="metric-foot">${result?'基于实际执行结果':'等待首次执行'}</div><div class="mini-ring" style="--progress:${passed/total*100}%"></div></div>
    <div class="metric"><div class="metric-label">变异检出 ${icon('flask')}</div><div class="metric-value">${String(killed).padStart(2,'0')}<small>/ 03 种故障</small></div><div class="metric-foot">${run?.mutation?'<span class="good">已执行</span> 预设故障注入':'检验测试能否发现回归'}</div><div class="spark-bars">${[11,15,21,17,25,28].map(n=>`<i style="height:${n}px;background:#6f5b85"></i>`).join('')}</div></div>
    <div class="metric"><div class="metric-label">可追溯事件 ${icon('shield')}</div><div class="metric-value">${String(run?.events.length??0).padStart(2,'0')}<small>条链式记录</small></div><div class="metric-foot">SHA-256 · 本地完整性校验</div><span style="position:absolute;right:17px;bottom:31px;color:#5873a3">${icon('flow')}</span></div>`;
}
function renderWorkflow() {
  $('#workflow').innerHTML=roles.map((r,i)=>`${i?'<span class="flow-connector"></span>':''}<button class="flow-node ${run && (run.stage>i || run.status==='approved')?'done':''} ${run?.stage===i?'running':''} ${i===4?'gate':''}" data-role="${i}" aria-label="查看${r.name}"><div class="node-box">${icon(r.icon)}${run && (run.stage>i || run.status==='approved')?'<span class="node-tick">✓</span>':''}</div><strong>${r.name}</strong><small>${r.en}</small></button>`).join('');
  $('#runId').textContent=run?.id ?? 'NO RUN YET';
  $('#executionTime').textContent=run?`${(run.elapsed_ms/1000).toFixed(1)}s / ${run.mode==='llm'?'LLM TOOL LOOP':backend?'PYTHON ENGINE':'BROWSER ENGINE'}`:'READY TO RUN';
  $('#runStatus').innerHTML=`<i></i>${run?statusName(run.status):'准备就绪'}`;
}
function renderTerminal(){
  $('#terminal').style.height=logCollapsed?'74px':'';
  if(!run?.events.length){$('#terminal').innerHTML=`<div class="terminal-empty"><b>$ trace run --recipe ${esc(scenario)}</b><br>准备好验证一份 AI 交付了吗？<span class="cursor"></span><br><span>启动任务后，这里将显示实际验证结果与决策事件。</span></div>`;}
  else {$('#terminal').innerHTML=run.events.map(ev=>`<div class="log-line ${esc(ev.level)}"><span class="log-time">${esc(new Date(ev.timestamp).toLocaleTimeString('zh-CN',{hour12:false}))}</span><span class="log-role">${esc(ev.role)}</span><span class="log-message">${esc(ev.message)}</span></div>`).join('');$('#terminal').scrollTop=$('#terminal').scrollHeight;}
  $('#eventCount').textContent=`${run?.events.length??0} EVENTS`;
  $('#terminalMode').textContent=run?`${run.mode==='llm'?'模型工具决策':backend?'Python 子进程测试':'浏览器真实断言'} · ${statusName(run.status)}`:'等待启动验证任务';
  $('#clearLogBtn').textContent=logCollapsed?'展开日志':'折叠日志';
}
function renderContract(){
  const recipe=activeRecipe(),result=latestEvaluation();
  $('#scenarioSelect').value=scenario;$('#scenarioSelect').disabled=busy;
  $('#scenarioDescription').textContent=missionNote||recipe.description;
  $('#scenarioTags').innerHTML=recipe.tags.map(t=>`<span>${esc(t)}</span>`).join('');
  $('#requirements').innerHTML=recipe.requirements.map((r,i)=>{const passed=result?.tests.filter(t=>t.req===r.id).every(t=>t.passed);return `<button class="requirement ${passed?'passed':''}" data-requirement="${i}"><span class="check-square">${passed?'✓':''}</span><span>${esc(r.name)}</span><span>${r.id}</span></button>`;}).join('');
  $('#acceptanceTable').innerHTML=recipe.requirements.map((r,i)=>{const tests=result?.tests.filter(t=>t.req===r.id),passed=tests?.every(t=>t.passed);return `<tr><td><span class="mono">REQ-${r.id.slice(1).padStart(3,'0')}</span><strong>${esc(r.name)}</strong></td><td>${esc(r.method)}</td><td><code>${esc(r.function)}()</code></td><td><span class="status-badge ${tests?(passed?'passed':'failed'):''}">${tests?(passed?'验证通过':`${tests.filter(t=>!t.passed).length} 条失败`):'等待验证'}</span></td><td><button data-requirement="${i}" aria-label="查看${esc(r.name)}的证据">↗</button></td></tr>`;}).join('');
  $('#runBtn').disabled=busy;$('#heroRunBtn').disabled=busy;$('#newMissionBtn').disabled=busy;
  $('#runBtn').innerHTML=busy?`${icon('clock')}正在执行验证闭环…`:`${icon('play')}${run?'重新运行验证':'运行验证闭环'}<span>↗</span>`;
  $('#approveBtn').hidden=run?.status!=='awaiting_approval';
}
function renderAll(){renderMetrics();renderWorkflow();renderTerminal();renderContract();if(currentView!=='review')renderCurrentView();}
function setView(name){currentView=names[name]?name:'review';$$('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${currentView}`));$$('a[data-view]').forEach(a=>a.classList.toggle('active',a.dataset.view===currentView));$('#breadcrumbTitle').textContent=names[currentView];renderCurrentView();window.scrollTo({top:0,behavior:'instant'});}
function renderCurrentView(){if(currentView==='review'){reviewUI.render();$('#modeTag').innerHTML='<i></i> READ-ONLY CODE REVIEW';}else{$('#modeTag').innerHTML='<i></i> 演示 · '+(backend?'Python 实测':'浏览器验证');}if(currentView==='orchestration')renderOrchestration();if(currentView==='evidence')renderEvidence();if(currentView==='lab')renderLab();if(currentView==='blueprint')renderBlueprint();}
function renderOrchestration(){
  $('#view-orchestration').innerHTML=intro('02 / AGENT ORCHESTRATION','显式编排，让自主有边界。','契约、实现、测试、反馈与人工验收。查看各阶段的状态与工具边界。')+`<div class="split-layout"><div class="panel">${roles.map((r,i)=>`<article class="agent-card"><span class="agent-avatar">${icon(r.icon)}</span><div><h3>${String(i+1).padStart(2,'0')} / ${r.name} <span class="muted mono">${r.en}</span></h3><p>${r.detail}</p><small>TOOL → ${esc(r.tool)}</small></div><span class="chip">${run && (run.stage>i||run.status==='approved')?'COMPLETE':run?.stage===i?'ACTIVE':'STANDBY'}</span></article>`).join('')}</div><div><div class="panel content-panel"><span class="feature-number">THE CONTROL LOOP</span><h2>让模型决策，让程序裁决。</h2><p>模型只能查看契约、读取候选实现、选择受控补丁、运行测试并申请验收。每一步工具输入与结果都进入事件链。</p><div class="code-window" style="margin-top:20px"><div>bounded_agent_loop.py / architecture</div><pre>observe(spec, source, test_feedback)
  ↓
model.choose_tool(allowlist)
  ↓
validate_tool_arguments()
  ↓
execute_trusted_policy_candidate()
  ↓
append_event(previous_hash)
  ↓
tests_green AND mutations_caught?
  ├─ no  → feedback → retry (≤ 8)
  └─ yes → HUMAN_REVIEW</pre></div><div class="callout">${health.llm_configured?'已检测到模型配置。新运行将进入真实模型工具循环。':'当前没有模型配置，使用明确标注的离线修复策略。测试、故障注入和证据校验仍然真实执行。'}</div></div><div class="panel content-panel" style="margin-top:18px"><h2>可恢复的数据，不等于可重放的副作用。</h2><p>Python 版将事件和状态一起写入 SQLite 事务。服务重启时把未完成运行标记为中断，保留证据，不自动重复执行模型调用。验收操作具有幂等性。</p><p>当前模型仅选择预定义补丁，不执行任意生成代码。通用仓库接入需要额外的隔离工作器与资源配额。</p></div></div></div>`;
}
function renderEvidence(){
  const root=$('#view-evidence');
  if(!run){root.innerHTML=intro('03 / DELIVERY EVIDENCE','交付的依据，不只是一句「完成」。','需求、测试结果、故障检出与人工决定，组成一份可导出的交付记录。')+`<div class="panel empty-state">${icon('shield')}还没有交付证据<p>先启动一次验证任务，再检查每一步发生了什么。</p><button class="button lime" data-action="start">启动验证实验 ↗</button></div>`;return;}
  const result=latestEvaluation();
  root.innerHTML=intro('03 / DELIVERY EVIDENCE','每一个结论，都能追到依据。','沿需求、断言与链式执行事件，查看每次交付的依据。')+`<div class="evidence-banner"><div><strong>${esc(run.title || activeRecipe().name)}</strong><p>${esc(run.id)} · ${esc(statusName(run.status))} · ${backend?'Python 本地引擎':'浏览器验证引擎'}</p></div><div style="display:flex;gap:10px"><button class="button ghost" data-action="verify-chain">${icon('shield')}校验证据链</button><button class="button lime" data-action="export">${icon('down')}导出 JSON</button></div></div><div class="split-layout"><div class="panel"><div class="panel-top"><strong>执行溯源</strong><span class="chip mono">${run.events.length} LINKED EVENTS</span></div><div class="timeline-list">${run.events.map(ev=>`<article class="timeline-item"><span class="timeline-circle">${String(ev.seq).padStart(2,'0')}</span><div><h3>${esc(ev.role)} / ${esc(ev.message)}</h3><p>sha256: ${esc(ev.hash.slice(0,32))}…</p></div><span>${esc(new Date(ev.timestamp).toLocaleTimeString('zh-CN',{hour12:false}))}</span></article>`).join('')}</div></div><div><div class="panel content-panel"><span class="feature-number">DELIVERY MANIFEST</span><h2>一份绑定业务契约的交付物</h2><div class="code-window"><div>manifest.json</div><pre>${esc(JSON.stringify({run_id:run.id,recipe:run.scenario,mode:run.mode,status:run.status,contract_hash:run.contract_hash,test_assertions:result?`${result.passed}/${result.total}`:'pending',mutations_detected:run.mutation?`${run.mutation.mutants.filter(m=>m.killed).length}/3`:'pending',human_approved:run.status==='approved',external_signature:false},null,2))}</pre></div>${run.status==='awaiting_approval'?`<div class="callout purple-callout">自动验证已经完成。交付仍在等待你的审阅；系统不会自行把测试通过标记为人工验收完成。</div><button class="button purple full" data-action="approve">审阅通过 · 确认验收</button>`:''}</div><div class="panel content-panel" style="margin-top:18px"><h2>每条测试都有具体的预期。</h2><p>本次 ${result?.total??0} 条断言中的失败项与通过项均可逐条查看。验收不是一个没有依据的绿色进度条。</p><div style="margin-top:15px;display:flex;gap:8px;flex-wrap:wrap">${activeRecipe().requirements.map((r,i)=>`<button class="button ghost" data-requirement="${i}">${esc(r.id)} / 查看 4 条断言</button>`).join('')}</div></div></div></div><div class="section-header lower"><div class="section-title"><span class="section-index">↶</span><h2>运行记录</h2></div></div><div class="panel history-list">${history.length?history.map(h=>`<div class="history-row"><span class="mono">${esc(h.id)}</span><strong>${esc(h.title||recipes[h.scenario]?.short||h.scenario)}</strong><span class="status-badge ${h.status==='approved'?'passed':''}">${esc(statusName(h.status))}</span><button data-history="${esc(h.id)}">查看 ↗</button></div>`).join(''):'<div class="empty-state">本次运行将在完成后保留。</div>'}</div>`;
}
function renderLab(){
  const target=labScenario||scenario;
  $('#view-lab').innerHTML=intro('04 / COUNTERFACTUAL LAB','如果代码错了，测试能发现吗？','对通过版本注入预设故障，检查测试能否发现回归。')+`<div class="panel lab-intro"><div><div class="eyebrow">TEST THE TESTS / MUTATION ANALYSIS</div><h2>主动注入故障，<br>验证测试的区分能力。</h2><p>对已通过的版本注入三个预设逻辑变异，用相同的业务契约重测。变异被检出，说明对应测试对这类回归有区分能力；这不是对所有未知缺陷的覆盖率。</p></div><div class="lab-form"><label for="labScenario">实验对象 / VERIFICATION TARGET</label><select id="labScenario">${Object.entries(recipes).map(([k,v])=>`<option value="${k}" ${k===target?'selected':''}>${esc(v.short)}</option>`).join('')}</select><button class="button purple full" data-action="experiment">${icon('flask')}注入故障 · 检验契约</button></div></div><div class="experiment-grid">${recipes[target].mutations.map((m,i)=>`<article class="panel experiment-card">${icon(i===0?'shield':i===1?'code':'bolt')}<h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><span class="mono">TARGET → ${m.requirement} / MUTANT ${String(i+1).padStart(2,'0')}</span></article>`).join('')}</div><div class="lab-results" id="labResults">${labResult?labResultsHTML(labResult):`<div class="panel empty-state">${icon('flask')}等待一次反事实实验<p>运行后查看实际断言结果与故障指纹。</p></div>`}</div>`;
}
function labResultsHTML(r){
  const witness=minimumWitness(r.mutants),key=r.scenario||scenario;
  return `<div class="panel"><div class="result-summary"><strong>${r.mutants.filter(m=>m.killed).length}/${r.mutants.length}</strong><div><p>预设变异被测试检出 · ${esc(recipes[key].short)}</p><small>${esc(r.engine||'浏览器断言引擎')} · 原始修复版 ${r.original.passed}/${r.original.total} 通过 · 该数值仅针对本次三个变异</small></div></div>${r.mutants.map(m=>`<div class="mutant-result"><span>${m.killed?'KILLED':'SURVIVED'}</span><div><strong>${esc(m.name)}</strong><p>${esc(m.requirement)} 被破坏 → ${m.caughtBy.map(esc).join(', ')||'没有测试发现'}</p></div><span>${m.result.total-m.result.passed} ASSERTIONS FAILED</span></div>`).join('')}</div><div class="panel fingerprint-panel"><div class="panel-top"><div><strong>故障指纹矩阵</strong><span class="muted">MUTANT × ASSERTION</span></div><span class="chip">点击测试编号查看证据</span></div><div class="fingerprint-scroll"><table class="fingerprint-table"><thead><tr><th>故障注入</th>${r.original.tests.map(t=>`<th class="${witness.tests.includes(t.id)?'selected-witness':''}"><button data-witness-test="${t.id}">${t.id}</button></th>`).join('')}</tr></thead><tbody>${r.mutants.map(m=>`<tr><td>${esc(m.name)}</td>${r.original.tests.map(t=>`<td class="${witness.tests.includes(t.id)?'selected-witness':''}"><span class="fingerprint-cell ${m.caughtBy.includes(t.id)?'detected':''}" title="${esc(t.id)} / ${m.caughtBy.includes(t.id)?'成功检出此回归':'未区分此变异'}">${m.caughtBy.includes(t.id)?'×':'·'}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="witness-summary"><span class="witness-symbol">∑</span><div><strong>最小诊断见证集 <span>${witness.tests.map(esc).join(' + ')}</span></strong><p>动态规划求得 ${witness.tests.length} 条断言，可检出 ${witness.covered}/${witness.total} 个已知变异。用于解释与定位，完整验收仍运行全部 ${r.original.total} 条断言。</p></div><span class="chip mono">EXACT SET COVER</span></div></div>`;
}
function renderBlueprint(){
  const skills=reviewUI.getSkills();
  $('#view-blueprint').innerHTML=intro('SKILLS & GUIDE','审查能力，有清楚的来源。','只读源码分析、模型上下文审查与独立验证演示，工作方式与覆盖范围均可检查。')+`<div class="research-grid"><div><div class="panel content-panel"><span class="feature-number">STRIX KNOWLEDGE ADAPTER</span><h2>${skills.length||29} 个源码审查知识技能</h2><p>从你提供的 Strix 压缩包导入，根据项目技术栈和风险线索自动选用。包括源码数据流、认证与对象权限、信息泄露、反证与风险校准，以及常见框架。</p><div class="skill-library">${skills.map(s=>`<article><span>${esc(s.category)}</span><h3>${esc(s.name)}</h3><small>${esc(s.source)}</small></article>`).join('')||'<p>连接后端后显示完整技能清单。</p>'}</div><div class="callout">当前接入的是只读知识技能。没有运行 Strix 的渗透、漏洞利用或自动修复引擎。</div></div></div><div><div class="panel content-panel"><span class="feature-number">HOW IT WORKS</span><h2>代码审查</h2><p>导入源码文件、文件夹或 ZIP，选择项目类型，开始分析。报告提供文件行号、代码依据、风险影响、成立前提、修改建议和验证方法。</p><p>支持网站、小程序以及 Java、Kotlin、Swift、Dart 等移动端源码。二进制安装包、依赖目录和构建产物不在源码审查范围内。</p><p>原始源码只在本次请求中处理，不在服务端保存；报告保存在当前浏览器，可导出 Markdown、JSON 和独立 HTML。敏感值在模型调用前脱敏。</p></div><div class="panel content-panel" style="margin-top:20px"><span class="feature-number">VERIFICATION DEMO</span><h2>保留完整验证闭环</h2><p>校园预约、课程权限、游戏排行榜三个内置场景：观察基线失败、反馈修复、独立复测、故障注入和人工验收。</p><p>反事实实验室展示故障指纹，并用动态规划求出已知变异的最小诊断见证集。完整验收仍运行全部断言。</p><button class="button ghost" data-action="demo-guide">查看演示步骤 ↗</button></div><div class="panel content-panel" style="margin-top:20px"><h2>审查边界</h2><p>源码规则与模型推断需要人工复核。工具不会执行上传代码，也不进行动态渗透、生产环境验证或自动修复。没有发现线索不代表没有漏洞。</p><p>DeepSeek 服务使用官方 Flash 接口；实际模型名称、Token 用量、未覆盖文件和运行异常会写入报告。</p></div></div></div>`;
}
async function addEvent(role,message,level='info',data={}) {
  const event={seq:run.events.length+1,role,message,level,data,timestamp:new Date().toISOString(),previous:run.events.at(-1)?.hash||'0'.repeat(64)};
  event.hash=await digest(event);run.events.push(event);run.elapsed_ms=Math.round(performance.now()-run._start);saveLocal();renderAll();
}
async function startRun(){
  if(busy)return;
  if(run?.status==='awaiting_approval'){modal('上一份交付尚未验收',`<p>重新运行会保留已有的执行记录。建议先查看交付证据并决定是否验收。</p><div class="dialog-actions"><button class="button ghost" data-action="restart">保留记录并重新运行</button><button class="button lime" data-action="review">先审阅证据</button></div>`);return;}
  return executeRun();
}
async function executeRun(){
  $('#modal').close();busy=true;location.hash='overview';
  if(backend){
    try {const response=await fetch('/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario,title:missionTitle,note:missionNote})});const data=await response.json();if(!response.ok)throw new Error(data.error||'启动失败');run=data;renderAll();pollRun();}catch(e){busy=false;toast(e.message,true);renderAll();}return;
  }
  run={id:'TR-'+crypto.randomUUID().slice(0,8).toUpperCase(),scenario,title:missionTitle||activeRecipe().name,note:missionNote,mode:'browser-offline',status:'running',stage:0,started_at:new Date().toISOString(),elapsed_ms:0,events:[],evaluations:[],mutation:null,contract_hash:await digest(activeRecipe()),_start:performance.now()};
  try {
    await addEvent('CONTRACT','冻结 3 条业务契约与 12 条独立断言。','info',{contract_hash:run.contract_hash});await sleep(650);
    run.stage=1;await addEvent('BUILDER','载入已知缺陷基线；浏览器执行，不调用模型。');await sleep(650);
    run.stage=2;let result=evaluate(recipes,scenario,'baseline');run.evaluations.push(result);await addEvent('VERIFIER',`基线测试 ${result.passed}/${result.total} 通过；捕获 ${result.total-result.passed} 个失败断言。`,'warn',{candidate:'baseline',passed:result.passed,total:result.total});await sleep(900);
    run.stage=3;await addEvent('REPAIRER','离线策略选择局部补丁 partial，保留测试不变。','info',{patch:'partial'});await sleep(600);
    result=evaluate(recipes,scenario,'partial');run.evaluations.push(result);await addEvent('VERIFIER',`局部修复 ${result.passed}/${result.total} 通过，仍有验收缺口，继续修复。`,'warn',{candidate:'partial',passed:result.passed,total:result.total});await sleep(850);
    await addEvent('REPAIRER','根据剩余失败项，选择完整补丁 complete。','info',{patch:'complete'});await sleep(650);
    result=evaluate(recipes,scenario,'complete');run.evaluations.push(result);await addEvent('VERIFIER',`修复后 ${result.passed}/${result.total} 条断言通过。`,'success',{candidate:'complete',passed:result.passed,total:result.total});await sleep(650);
    run.mutation=mutations(recipes,scenario);await addEvent('SENTINEL',`注入 3 个预设逻辑变异，${run.mutation.mutants.filter(m=>m.killed).length}/3 被检出。`,'success',{mutants:run.mutation.mutants.map(m=>({id:m.id,caughtBy:m.caughtBy}))});await sleep(550);
    run.stage=4;run.status='awaiting_approval';await addEvent('REVIEWER','自动验证结束；交付暂停，等待人工审阅。','success');delete run._start;saveLocal();busy=false;renderAll();toast('验证完成。请审阅测试与故障检出证据，再确认验收。');
  }catch(e){run.status='error';busy=false;saveLocal();renderAll();toast(`验证中断：${e.message}`,true);}
}
async function pollRun(){
  clearTimeout(pollTimer);
  try {const r=await fetch(`/api/runs/${encodeURIComponent(run.id)}`);if(!r.ok)throw new Error('读取运行记录失败');run=await r.json();scenario=run.scenario;busy=run.status==='running';renderAll();if(busy)pollTimer=setTimeout(pollRun,500);else{await loadHistory();renderCurrentView();if(run.status==='awaiting_approval')toast('Python 实测完成，等待人工验收。');if(['error','failed','interrupted'].includes(run.status))toast('任务未完成，请在日志中查看原因。',true);}}
  catch(e){busy=false;renderAll();toast(`与本地引擎失去连接。记录保存在服务端，恢复后刷新。${e.message}`,true);}
}
async function approve(){
  if(run?.status!=='awaiting_approval')return;
  const currentId=run.id;
  try {
    if(backend){const r=await fetch(`/api/runs/${encodeURIComponent(run.id)}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok)throw new Error(data.error);run=data;await loadHistory();}
    else {if(run.evaluations.at(-1)?.passed!==activeRecipe().cases.length || !run.mutation?.mutants.every(m=>m.killed))throw new Error('验收条件未满足');const valid=await verifyChain(run.events);if(!valid)throw new Error('证据链校验失败');if(run?.id!==currentId||run.status!=='awaiting_approval')return;run.status='approved';const event={seq:run.events.length+1,role:'HUMAN',message:'人工审阅后确认验收；仅对本次内置契约负责。',level:'success',data:{approved:true},timestamp:new Date().toISOString(),previous:run.events.at(-1).hash};event.hash=await digest(event);run.events.push(event);saveLocal();}
    $('#modal').close();renderAll();toast('已记录人工验收决定，可导出完整证据。');
  }catch(e){toast(e.message,true);}
}
function showRequirement(index){
  const r=activeRecipe().requirements[index],results=latestEvaluation()?.tests.filter(t=>t.req===r.id)||activeRecipe().cases.filter(t=>t.req===r.id);
  modal(`${r.id} / ${r.name}`,`<p>实现位置：${esc(activeRecipe().file)} → <code>${esc(r.function)}()</code>。下面的预期值来自冻结的业务契约。</p>${results.map(t=>`<div style="margin-top:17px;border-top:1px solid var(--line);padding-top:13px"><h3 style="margin:0 0 6px">${esc(t.id)} · ${esc(t.name)} <span style="float:right;color:${t.passed===undefined?'var(--muted)':t.passed?'var(--lime)':'var(--red)'}">${t.passed===undefined?'待执行':t.passed?'PASS':'FAIL'}</span></h3><p>预期 ${t.expected} ${t.actual===undefined?'':`/ 实际 ${t.actual}`}</p><pre style="margin:8px 0 0">${esc(JSON.stringify(t.input,null,2))}</pre></div>`).join('')}`,'CONTRACT → ASSERTIONS → EVIDENCE');
}
async function exportReport(){
  if(!run){toast('请先运行一次验证，生成真实证据。');return;}
  try{
    let report;
    if(backend){const r=await fetch(`/api/runs/${encodeURIComponent(run.id)}/report`);if(!r.ok)throw new Error('报告读取失败');report=await r.json();}
    else report={format:'trace-evidence/0.1',exported_at:new Date().toISOString(),scope:'Browser JavaScript assertions; no LLM, no Python execution, no external signature.',chain_valid:await verifyChain(run.events),contract:activeRecipe(),run};
    const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TRACE-${run.id}-evidence.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('完整证据已导出，包含断言输入、预期值与事件哈希。');
  }catch(e){toast(e.message,true);}
}
async function experiment(){
  const key=$('#labScenario')?.value||scenario;const button=$('[data-action="experiment"]');if(button){button.disabled=true;button.textContent='正在注入并重测…';}
  try {await sleep(350);if(backend){const r=await fetch('/api/experiment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:key})});const data=await r.json();if(!r.ok)throw new Error(data.error);labResult={...data,scenario:key,engine:'Python 子进程验证'};}else labResult={...mutations(recipes,key),scenario:key,engine:'浏览器 JavaScript 断言'};renderLab();toast('反事实实验完成：查看每个变异触发的失败断言。');}
  catch(e){toast(e.message,true);if(button){button.disabled=false;button.textContent='重新运行实验';}}
}
function showTour(){modal('验证演示怎么使用',`<ol class="tour-list"><li><strong>选择场景并运行。</strong><br>在验证演示中观察基线失败、局部修复与完整复测。</li><li><strong>查看具体依据。</strong><br>点击验收条款，检查断言输入、预期值与实际值。</li><li><strong>主动注入故障。</strong><br>在反事实实验室检查测试能否发现回归，查看故障指纹与诊断见证。</li><li><strong>审阅并导出。</strong><br>检查事件链，人工验收后导出证据记录。</li></ol><button class="button lime" data-action="start">启动演示 ${icon('arrow')}</button>`,'GUIDE / VERIFICATION DEMO');}
function showGuide(){modal('欢迎使用 TRACE',`<p>一个用于上线前只读代码审查和交付验证的 Agent 工作空间。</p><div class="onboarding-grid"><article><span>01</span><h3>导入你的代码</h3><p>支持源码文件、项目文件夹和 ZIP。也可加载内置缺陷样例，先体验审查过程。</p></article><article><span>02</span><h3>查看问题与依据</h3><p>DeepSeek 与静态规则分析后，逐项查看文件行号、影响、成立前提和修改建议。</p></article><article><span>03</span><h3>导出并人工复核</h3><p>报告可导出为 Markdown、JSON 或 HTML。工具始终只读，任何源码修改由你决定。</p></article></div><div class="guide-notice">敏感值会在提交模型前脱敏。未覆盖的文件、分析片段及模型异常会明确列出；审查结果需要人工复核。</div><div class="dialog-actions"><button class="button ghost" data-action="demo-guide">体验验证演示</button><button class="button lime" data-action="go-review">开始代码审查 ↗</button></div>`,'GETTING STARTED / 使用说明');}
function newMission(){modal('创建一个可验证的任务',`<p>当前版本支持三个内置验证配方。自定义标题和背景用于记录任务上下文，不会自动把任意描述转换为可执行项目。</p><label class="form-label" for="missionName">任务名称</label><input id="missionName" maxlength="80" placeholder="例如：学库课程发布前权限验收" value="${esc(missionTitle)}"><label class="form-label" for="missionRecipe">验证配方</label><select id="missionRecipe">${Object.entries(recipes).map(([k,v])=>`<option value="${k}" ${k===scenario?'selected':''}>${esc(v.name)}</option>`).join('')}</select><label class="form-label" for="missionNote">任务背景（选填）</label><textarea id="missionNote" maxlength="500" placeholder="记录本次希望重点审阅的业务风险。">${esc(missionNote)}</textarea><div class="dialog-actions"><button class="button ghost" data-action="close">取消</button><button class="button lime" data-action="create">创建任务 ${icon('arrow')}</button></div>`,'NEW MISSION / SCOPED VERIFICATION');}
async function loadHistory(){if(backend){try {const r=await fetch('/api/runs');if(r.ok)history=await r.json();}catch{}}else history=storage.get('history',[]);}
function wire(){
  window.addEventListener('hashchange',()=>setView(location.hash.slice(1)));
  $('#heroRunBtn').onclick=startRun;$('#runBtn').onclick=startRun;$('#approveBtn').onclick=approve;$('#exportBtn').onclick=exportReport;$('#newMissionBtn').onclick=newMission;$('#tourBtn').onclick=showGuide;$('#helpBtn').onclick=showGuide;
  $('#conceptBtn').onclick=()=>location.hash='blueprint';$('#closeModalBtn').onclick=()=>$('#modal').close();$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const rect=$('#modal').getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)$('#modal').close();}});
  $('#clearLogBtn').onclick=()=>{logCollapsed=!logCollapsed;renderTerminal();};
  $('#scenarioSelect').onchange=e=>{scenario=e.target.value;run=null;missionTitle='';missionNote='';labResult=null;renderAll();};
  $('#workspaceBtn').onclick=()=>modal('TRACE 工作空间',`<p>代码审查只读分析你选择的源码。报告保存在当前浏览器，源码不会写入服务端项目目录。</p><p>验证演示与真实代码审查分别运行，演示数据不会混入审查报告。</p><button class="button lime" data-action="go-review">打开代码审查 ↗</button>`);
  $('#aboutBtn').onclick=()=>modal('TRACE · Read-only Agent',`<p>源码审查、隐私风险分析和交付验证。模型辅助发现线索，代码依据支撑判断，最终决定由人完成。</p><p>集成 Strix 源码知识技能，按只读策略运行。</p><button class="button ghost" data-action="blueprint">技能与说明 ↗</button>`);
  $('#searchBtn').onclick=()=>modal('快速导航',`<input id="quickSearch" placeholder="搜索：审查 / 演示 / 编排 / 证据 / 技能" autocomplete="off"><div class="search-links">${Object.entries(names).map(([k,v])=>`<a href="#${k}" data-search-link>${esc(v)}<span>↗</span></a>`).join('')}</div>`);
  document.addEventListener('input',e=>{if(e.target.id==='quickSearch')$$('[data-search-link]').forEach(a=>a.hidden=!a.textContent.includes(e.target.value));});
  document.addEventListener('change',e=>{if(e.target.id==='labScenario'){labScenario=e.target.value;labResult=null;renderLab();}});
  document.addEventListener('click',async e=>{
    const witnessTest=e.target.closest('[data-witness-test]');if(witnessTest&&labResult){const id=witnessTest.dataset.witnessTest,t=labResult.original.tests.find(t=>t.id===id);modal(`${t.id} / ${t.name}`,`<p>业务预期 ${t.expected}。完整版本返回 ${t.actual}。下面对照各次故障注入后的结果：</p><pre>${esc(JSON.stringify({input:t.input,expected:t.expected,original:t.actual,mutations:labResult.mutants.map(m=>({name:m.name,actual:m.result.tests.find(x=>x.id===id).actual,detected:m.caughtBy.includes(id)}))},null,2))}</pre>`,'COUNTERFACTUAL / DIAGNOSTIC WITNESS');}
    const role=e.target.closest('[data-role]');if(role){const r=roles[Number(role.dataset.role)];modal(r.name,`<p>${esc(r.detail)}</p><pre>ROLE: ${esc(r.en)}\nTOOL: ${esc(r.tool)}\nEXECUTION: ${backend?'Python engine':'Browser engine'}\nMODEL: ${health.llm_configured?'Configured':'None / deterministic policy'}</pre>`);}
    const req=e.target.closest('[data-requirement]');if(req)showRequirement(Number(req.dataset.requirement));
    if(e.target.closest('[data-search-link]'))$('#modal').close();
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action==='go-review'){$('#modal').close();location.hash='review';}
    if(action==='demo-guide'){showTour();}
    if(action==='start'){$('#modal').close();await startRun();}
    if(action==='restart'){await executeRun();}
    if(action==='export')await exportReport();if(action==='approve')await approve();if(action==='experiment')await experiment();
    if(action==='verify-chain'){const valid=await verifyChain(run.events);toast(valid?'事件链完整性校验通过。注意：没有外部签名锚点。':'校验失败：事件内容或链接不一致。',!valid);}
    if(action==='close')$('#modal').close();
    if(action==='review'){$('#modal').close();location.hash='evidence';}
    if(action==='blueprint'){$('#modal').close();location.hash='blueprint';}
    if(action==='create'){scenario=$('#missionRecipe').value;missionTitle=$('#missionName').value.trim();missionNote=$('#missionNote').value.trim();run=null;labResult=null;$('#modal').close();location.hash='overview';renderAll();toast('验证任务已创建，点击运行开始生成证据。');}
    const h=e.target.closest('[data-history]');if(h){if(backend){try{const r=await fetch(`/api/runs/${encodeURIComponent(h.dataset.history)}`);if(!r.ok)throw new Error('读取失败');run=await r.json();scenario=run.scenario;busy=run.status==='running';renderAll();if(busy)pollRun();}catch(err){toast(err.message,true);}}else if(h.dataset.history===run?.id)toast('当前已显示该次运行。');else toast('浏览器版保留历史摘要；完整旧记录请使用先前导出的 JSON。本地服务保留全部记录。');}
  });
  let key='';document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key==='Escape')$('#modal').close();if(e.key.toLowerCase()==='o'&&key==='g'){location.hash='overview';key='';}else key=e.key.toLowerCase();if(e.key.toLowerCase()==='f'&&!e.ctrlKey&&!e.metaKey){document.body.classList.toggle('presenting');toast(document.body.classList.contains('presenting')?'演示模式已开启，按 F 退出。':'已退出演示模式。');}});
}
function orb(){
  const canvas=$('#orbCanvas'),ctx=canvas.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let w=0,h=0,t=0;
  const observer=new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();w=r.width;h=r.height;canvas.width=w*Math.min(devicePixelRatio,2);canvas.height=h*Math.min(devicePixelRatio,2);ctx.setTransform(Math.min(devicePixelRatio,2),0,0,Math.min(devicePixelRatio,2),0,0);});observer.observe(canvas);
  function project(x,y,z){const a=t*.0012,ca=Math.cos(a),sa=Math.sin(a),xx=x*ca+z*sa,zz=z*ca-x*sa;const tilt=.35,yy=y*Math.cos(tilt)-zz*Math.sin(tilt),depth=y*Math.sin(tilt)+zz*Math.cos(tilt);const scale=1+depth*.10;return [w*.51+xx*Math.min(w*.30,h*.35)*scale,h*.47+yy*Math.min(w*.30,h*.35)*scale,depth];}
  function draw(){if(w&&h&&currentView==='overview'&&!document.hidden){ctx.clearRect(0,0,w,h);const cx=w*.51,cy=h*.47,r=Math.min(w*.30,h*.35);let glow=ctx.createRadialGradient(cx,cy,0,cx,cy,r*1.5);glow.addColorStop(0,'#426cb322');glow.addColorStop(.65,'#3c5a8d0a');glow.addColorStop(1,'#3c5a8d00');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    for(let lat=-7;lat<=7;lat++){const phi=lat*Math.PI/16;ctx.beginPath();for(let n=0;n<=96;n++){const a=n*Math.PI/48,p=project(Math.cos(phi)*Math.cos(a),Math.sin(phi),Math.cos(phi)*Math.sin(a));if(n===0)ctx.moveTo(p[0],p[1]);else ctx.lineTo(p[0],p[1]);}ctx.strokeStyle=`rgba(119,192,255,${.1+(7-Math.abs(lat))*.006})`;ctx.lineWidth=.6;ctx.stroke();}
    for(let mer=0;mer<22;mer++){ctx.beginPath();const a=mer*Math.PI/11;for(let n=0;n<=48;n++){const p=n*Math.PI/48;const q=project(Math.sin(p)*Math.cos(a),Math.cos(p),Math.sin(p)*Math.sin(a));if(!n)ctx.moveTo(q[0],q[1]);else ctx.lineTo(q[0],q[1]);}ctx.strokeStyle='#80a0d51f';ctx.lineWidth=.6;ctx.stroke();}
    for(let i=0;i<310;i++){const y=1-2*(i+.5)/310,a=i*2.399963,p=project(Math.sqrt(1-y*y)*Math.cos(a),y,Math.sqrt(1-y*y)*Math.sin(a));ctx.beginPath();ctx.arc(p[0],p[1],p[2]>.15?1.15:.65,0,Math.PI*2);ctx.fillStyle=`rgba(154,213,255,${.2+(p[2]+1)*.3})`;ctx.fill();}
    for(let orbit=0;orbit<3;orbit++){ctx.save();ctx.translate(cx,cy);ctx.rotate(-.5+orbit*.8);ctx.beginPath();ctx.ellipse(0,0,r*1.31,r*(.35+orbit*.06),0,0,Math.PI*2);ctx.strokeStyle='#7791be33';ctx.lineWidth=.7;ctx.stroke();const angle=t*.007+orbit*2.1;const x=r*1.31*Math.cos(angle),y=r*(.35+orbit*.06)*Math.sin(angle);ctx.beginPath();ctx.arc(x,y,2.3,0,Math.PI*2);ctx.fillStyle='#89aae3';ctx.shadowColor='#afc6ec';ctx.shadowBlur=9;ctx.fill();ctx.restore();}
    ctx.strokeStyle='#748cb418';ctx.lineWidth=.5;for(let k=-2;k<=2;k++){ctx.beginPath();ctx.moveTo(cx-r*1.7,cy+k*r*.4);ctx.lineTo(cx+r*1.7,cy+k*r*.4);ctx.stroke();}t++;}
    if(!reduced)requestAnimationFrame(draw);
  }requestAnimationFrame(draw);if(reduced)setTimeout(draw,150);
}
async function init(){
  try {const r=await fetch('recipes.json');if(!r.ok)throw new Error('验证契约加载失败');recipes=await r.json();}
  catch(e){$('#terminal').textContent=e.message;toast('请通过 HTTP 服务访问，不要直接双击 HTML 文件。',true);return;}
  $('#scenarioSelect').innerHTML=Object.entries(recipes).map(([k,v])=>`<option value="${k}">${esc(v.name)}</option>`).join('');
  try {const r=await fetch('/api/health',{signal:AbortSignal.timeout(1800)});if(r.ok&&r.headers.get('content-type')?.includes('application/json')){health=await r.json();backend=health.service==='trace-python';}}catch{}
  if(backend){$('#modeTag').innerHTML=`<i></i>${health.llm_configured?'Python + LLM · 工具循环':'Python 实测 · 离线策略'}`;$('#engineLabel').textContent='Python engine connected';await loadHistory();if(history.length){const r=await fetch(`/api/runs/${encodeURIComponent(history[0].id)}`);if(r.ok){run=await r.json();scenario=run.scenario;busy=run.status==='running';if(busy)pollRun();}}}
  else {$('#engineLabel').textContent='Browser assertion engine';run=storage.get('run',null);history=storage.get('history',[]);if(run&&recipes[run.scenario]){scenario=run.scenario;if(run.status==='running'){run.status='interrupted';saveLocal();}}else run=null;}
  wire();setView(location.hash.slice(1));renderAll();orb();reviewUI.init();if(!storage.get('guide.v2',false)){setTimeout(showGuide,400);storage.set('guide.v2',true);}
}
init();
