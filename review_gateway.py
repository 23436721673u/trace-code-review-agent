"""Stream a shared Node review engine; never save uploaded source to disk."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import urllib.request
from secret_store import get_review_key
ROOT=Path(__file__).resolve().parent
SLOTS=threading.BoundedSemaphore(2)

def node_path():
    found=shutil.which('node')
    if found:
        return found
    bundled=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    return str(bundled) if bundled.exists() else None

def health():
    manifest=json.loads((ROOT/'third_party/strix/manifest.json').read_text(encoding='utf-8'))
    skills=[{k:v for k,v in s.items() if k!='reference'} for s in manifest['skills']]
    return {'available':bool(node_path()),'configured':bool(get_review_key()),'model':os.environ.get('DEEPSEEK_MODEL','deepseek-flash'),'read_only':True,'skills':skills}

def stream_review(handler,payload):
    executable=node_path()
    if not executable:
        return handler.send_json({'error':'本地源码审查需要 Node.js 20+。'},503)
    if not SLOTS.acquire(blocking=False):
        return handler.send_json({'error':'已有两个审查在运行，请稍后重试。'},409)
    process=None
    try:
        environment=dict(os.environ,PYTHONUTF8='1')
        proxies=urllib.request.getproxies()
        if proxies.get('https') and 'HTTPS_PROXY' not in environment:
            environment['HTTPS_PROXY']=proxies['https']
            environment['HTTP_PROXY']=proxies.get('http',proxies['https'])
            environment['NODE_USE_ENV_PROXY']='1'
        process=subprocess.Popen([executable,str(ROOT/'review/cli.mjs')],cwd=str(ROOT),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        data={'payload':payload,'key':get_review_key(),'model':os.environ.get('DEEPSEEK_MODEL','deepseek-flash')}
        process.stdin.write(json.dumps(data,ensure_ascii=False).encode('utf-8'))
        process.stdin.close()
        handler.send_response(200)
        handler.send_header('Content-Type','application/x-ndjson; charset=utf-8')
        handler.send_header('Cache-Control','no-store, no-transform')
        handler.send_header('X-Content-Type-Options','nosniff')
        handler.end_headers()
        for line in process.stdout:
            handler.wfile.write(line)
            handler.wfile.flush()
        process.wait(timeout=5)
    except (BrokenPipeError,ConnectionResetError):
        pass
    except Exception:
        if process is None:
            handler.send_json({'error':'无法启动本地审查引擎。'},500)
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            if process.stdout:
                process.stdout.close()
        SLOTS.release()
