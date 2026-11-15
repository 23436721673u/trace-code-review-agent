import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {evaluate,mutations,digest,verifyChain,minimumWitness} from '../public/domain.js';
const recipes=JSON.parse(fs.readFileSync(new URL('../public/recipes.json',import.meta.url),'utf8'));
let checks=0;
for(const scenario of Object.keys(recipes)) {
  for(const candidate of ['baseline','partial','complete','no-auth','boundary','no-validation','mutations']) {
    const r=spawnSync('py',['-3','policies.py',scenario,candidate],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const browser=candidate==='mutations'?mutations(recipes,scenario):evaluate(recipes,scenario,candidate);
    assert.deepEqual(browser,JSON.parse(r.stdout));checks++;
  }
}
for(const scenario of Object.keys(recipes)) {
  const suite=mutations(recipes,scenario),witness=minimumWitness(suite.mutants);
  assert.equal(witness.complete,true);assert.equal(witness.tests.length,3);
  for(const m of suite.mutants)assert.ok(m.caughtBy.some(t=>witness.tests.includes(t)));
}
assert.deepEqual(minimumWitness([{caughtBy:['T1','T2']},{caughtBy:['T2','T3']}]).tests,['T2']);
assert.equal(minimumWitness([{caughtBy:[]}]).complete,false);
const event={seq:1,role:'TEST',message:'中英哈希兼容 / parity',data:{boolean:true,integer:12},timestamp:'2026-10-24T00:00:00.000Z',previous:'0'.repeat(64),level:'info'};
const nodeHash=await digest(event);
const py=spawnSync('py',['-3','-c','import json,sys;from engine import digest;print(digest(json.load(sys.stdin)))'],{input:JSON.stringify(event),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
assert.equal(py.status,0,py.stderr);assert.equal(nodeHash,py.stdout.trim());
assert.equal(await verifyChain([{...event,hash:nodeHash}]),true);
assert.equal(await verifyChain([{...event,message:'changed',hash:nodeHash}]),false);
console.log(`PASS: ${checks} browser/Python result comparisons + cross-language SHA-256 + tamper detection + minimum diagnostic set cover`);
