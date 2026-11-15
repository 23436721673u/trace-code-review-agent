// Deterministic browser counterpart of policies.py. This runs real assertions;
// it never impersonates a remote LLM or a Python process.
export function policy(scenario, candidate, x) {
  if (scenario === 'booking') {
    const identity = !!x.actor && (x.actor === x.owner || x.role === 'admin');
    const valid = 0 <= x.start && x.start < x.end && x.end <= 24;
    const overlap = candidate === 'baseline' || candidate === 'boundary'
      ? x.start <= 12 && 10 <= x.end : x.start < 12 && 10 < x.end;
    return !overlap && (candidate === 'baseline' || candidate === 'no-validation' || valid)
      && (['baseline', 'partial', 'no-auth'].includes(candidate) || identity);
  }
  if (scenario === 'xueku') {
    const visibility = x.published || x.actor === x.owner || x.role === 'admin';
    const session = !!x.actor && x.active;
    const tenant = x.tenant === x.resource_tenant;
    if (candidate === 'baseline') return !!x.actor;
    return (candidate === 'boundary' || visibility)
      && (candidate === 'no-auth' || session)
      && (['partial', 'no-validation'].includes(candidate) || tenant);
  }
  if (scenario === 'leaderboard') {
    const score = Number.isInteger(x.score) && x.score >= 0 && x.score <= 100000;
    const identity = !!x.actor && x.signed && x.actor === x.owner;
    const rate = x.seconds > 0 && x.score / x.seconds <= 1000;
    if (candidate === 'baseline') return x.score <= 100000;
    return (candidate === 'boundary' || score)
      && (['partial', 'no-auth'].includes(candidate) || identity)
      && (candidate === 'no-validation' || rate);
  }
  throw new Error('Unknown recipe');
}
export function evaluate(recipes, scenario, candidate) {
  const tests = recipes[scenario].cases.map(t => {
    const actual = Boolean(policy(scenario, candidate, t.input));
    return {...t, actual, passed: actual === t.expected};
  });
  return {candidate, total: tests.length, passed: tests.filter(t => t.passed).length, tests};
}
export function mutations(recipes, scenario) {
  const original = evaluate(recipes, scenario, 'complete');
  return {original, mutants: recipes[scenario].mutations.map(m => {
    const result = evaluate(recipes, scenario, m.id);
    return {...m, killed: result.passed < result.total, caughtBy: result.tests.filter(t => !t.passed).map(t => t.id), result};
  })};
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function digest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyChain(events) {
  let previous = '0'.repeat(64);
  for (let i = 0; i < events.length; i++) {
    const {hash, ...event} = events[i];
    if (event.seq !== i + 1 || event.previous !== previous || await digest(event) !== hash) return false;
    previous = hash;
  }
  return true;
}

// Exact minimum set cover over known mutant signatures. State is a bitmask of
// detected mutants. This selects diagnostic witnesses, never replaces full tests.
export function minimumWitness(mutants) {
  if (mutants.length > 20) throw new Error('Witness solver supports at most 20 mutants');
  const ids=[...new Set(mutants.flatMap(m=>m.caughtBy))].sort();
  const dp=new Map([[0,[]]]);
  for(const id of ids) {
    const signature=mutants.reduce((mask,m,i)=>mask|(m.caughtBy.includes(id)?1<<i:0),0);
    for(const [mask,chosen] of [...dp]) {
      const combined=mask|signature,proposal=[...chosen,id];
      if(!dp.has(combined)||proposal.length<dp.get(combined).length) dp.set(combined,proposal);
    }
  }
  const target=(1<<mutants.length)-1;
  const covered=mutants.reduce((mask,m,i)=>mask|(m.caughtBy.length?1<<i:0),0);
  const tests=dp.get(target)||dp.get(covered)||[];
  return {tests,total:mutants.length,covered:mutants.filter(m=>m.caughtBy.some(t=>tests.includes(t))).length,complete:dp.has(target)};
}
