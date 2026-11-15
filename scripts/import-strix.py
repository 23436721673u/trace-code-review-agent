"""Import selected knowledge files from the user supplied archive; execute none."""
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
SELECTED={
 'analysis/source_aware_discovery.md':'源码入口与数据流',
 'analysis/counterevidence.md':'反证与缓解措施',
 'analysis/severity_calibration.md':'风险等级校准',
 'custom/source_aware_sast.md':'源码静态审查方法',
 'vulnerabilities/authentication_jwt.md':'认证与 JWT',
 'vulnerabilities/idor.md':'对象权限与租户隔离',
 'vulnerabilities/broken_function_level_authorization.md':'功能级访问控制',
 'vulnerabilities/information_disclosure.md':'信息泄露',
 'vulnerabilities/business_logic.md':'业务逻辑',
 'vulnerabilities/race_conditions.md':'并发与竞态',
 'vulnerabilities/sql_injection.md':'SQL 注入',
 'vulnerabilities/nosql_injection.md':'NoSQL 注入',
 'vulnerabilities/ssrf.md':'服务端请求风险',
 'vulnerabilities/xss.md':'脚本注入',
 'vulnerabilities/csrf.md':'跨站请求',
 'vulnerabilities/path_traversal_lfi_rfi.md':'文件路径边界',
 'vulnerabilities/insecure_deserialization.md':'反序列化',
 'vulnerabilities/insecure_file_uploads.md':'文件上传',
 'vulnerabilities/mass_assignment.md':'批量赋值',
 'vulnerabilities/prototype_pollution.md':'原型污染',
 'vulnerabilities/llm_prompt_injection.md':'模型输入与工具权限',
 'frameworks/django.md':'Django 审查',
 'frameworks/fastapi.md':'FastAPI 审查',
 'frameworks/nestjs.md':'NestJS 审查',
 'frameworks/nextjs.md':'Next.js 审查',
 'protocols/graphql.md':'GraphQL 审查',
 'protocols/oauth.md':'OAuth 审查',
 'technologies/firebase.md':'Firebase 审查',
 'technologies/supabase.md':'Supabase 审查',
}


def main():
    archive=Path(sys.argv[1])
    target=ROOT/'third_party'/'strix'
    target.mkdir(parents=True,exist_ok=True)
    entries=[]
    with zipfile.ZipFile(archive) as z:
        for path,title in SELECTED.items():
            name='strix-main/strix/skills/'+path
            info=z.getinfo(name)
            if info.file_size>100000:
                raise ValueError('Unexpected knowledge file size')
            raw=z.read(info)
            output=target/'skills'/path
            output.parent.mkdir(parents=True,exist_ok=True)
            output.write_bytes(raw)
            text=raw.decode('utf-8')
            # Runtime excerpts are adapted separately. Originals are unchanged.
            text=re.sub(r'\A---\s*\n.*?\n---\s*\n','',text,flags=re.S)
            text=re.sub(r'```.*?```','[Executable examples omitted in read-only mode.]',text,flags=re.S)
            text=re.sub(r'<[^>]+>','',text)
            entries.append({'id':Path(path).stem,'name':title,'category':path.split('/')[0],
                            'source':'strix/skills/'+path,'sha256':hashlib.sha256(raw).hexdigest(),
                            'reference':text[:6000]})
        (target/'LICENSE').write_bytes(z.read('strix-main/LICENSE'))
    manifest={'source':'user-supplied strix-main.zip','upstream':'https://github.com/usestrix/strix',
              'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
              'license':'Apache-2.0','mode':'read-only knowledge adaptation',
              'execution_engine_installed':False,'skills':[dict(e,reference=None) for e in entries]}
    (target/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'review'/'skills-data.mjs').write_text('// Derived read-only excerpts; original files and Apache-2.0 license: third_party/strix.\nexport const STRIX_SKILLS = '+json.dumps(entries,ensure_ascii=False)+';\n',encoding='utf-8')
    print(json.dumps({'installed_knowledge_skills':len(entries),'execution_engine_installed':False,'archive_sha256':manifest['archive_sha256']}))


if __name__=='__main__':
    main()
