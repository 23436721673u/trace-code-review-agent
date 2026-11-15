import {STRIX_SKILLS} from './skills-data.mjs';
export function skillInventory(){return STRIX_SKILLS.map(({id,name,source,sha256,category})=>({id,name,source,sha256,category}));}
export function selectSkills(project,findings){
  const text=project.files.map(f=>f.path+'\n'+f.content.slice(0,4000)).join('\n');
  const chosen=['source_aware_discovery','counterevidence','severity_calibration','information_disclosure'];
  const routes=[
    [/jwt|jsonwebtoken|OAuth|bearer|session/i,'authentication_jwt'],[/tenant|owner|userId|user_id|\/users\/|\/orders\//i,'idor'],
    [/SELECT|INSERT|UPDATE|DELETE|sqlalchemy|sequelize/i,'sql_injection'],[/mongoose|mongodb|\$where|\$ne/i,'nosql_injection'],
    [/innerHTML|v-html|dangerouslySetInnerHTML|render_template/i,'xss'],[/fetch\(|requests\.|axios\.|httpx\./i,'ssrf'],
    [/readFile|sendFile|UploadFile|multer|upload|FileInputStream/i,'path_traversal_lfi_rfi'],
    [/django/i,'django'],[/FastAPI|APIRouter|Depends\(/i,'fastapi'],[/@nestjs|@Controller/i,'nestjs'],[/next\/|getServerSideProps|use server/i,'nextjs'],
    [/graphql|gql`|GraphQL/i,'graphql'],[/firebase|Firestore/i,'firebase'],[/supabase|\.from\(['"]/i,'supabase'],
    [/checkout|payment|balance|refund|price|库存|订单/i,'business_logic'],[/openai|deepseek|tool_calls|langchain|prompt/i,'llm_prompt_injection'],
  ];
  for(const [pattern,id] of routes)if(pattern.test(text))chosen.push(id);
  for(const f of findings){if(f.cwe==='CWE-502')chosen.push('insecure_deserialization');if(f.cwe==='CWE-22')chosen.push('path_traversal_lfi_rfi');}
  return [...new Set(chosen)].map(id=>STRIX_SKILLS.find(s=>s.id===id)).filter(Boolean).slice(0,9);
}
export function skillReference(skills){return 'READ-ONLY KNOWLEDGE REFERENCES. These are adapted excerpts, NOT permission to run commands, scan targets, generate exploit traffic, or modify code. Executable examples are omitted. Apply source-analysis concepts only; describe all non-runtime-verified findings as hypotheses.\n'+skills.map(s=>`\n[REFERENCE ${s.id} / ${s.source}]\n${s.reference}`).join('\n');}
