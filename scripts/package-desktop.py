"""Package source/desktop entrypoints, explicitly excluding local runtime data."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT.parent / 'TRACE-完整项目.zip'
OMIT = {'.git', '.data', '.env', '.venv', '.local', '.openai', '.worker-starter', 'dist', 'qa', '__pycache__', 'node_modules'}

files = [p for p in ROOT.rglob('*') if p.is_file()
         and not any(part in OMIT for part in p.relative_to(ROOT).parts)
         and p.suffix not in {'.pyc', '.zip', '.log', '.tmp'}]
# Compare the actual configured credential in memory without printing it.
import sys
sys.path.insert(0, str(ROOT))
from secret_store import get_review_key
secret = get_review_key()
if secret:
    for file in files:
        if secret.encode() in file.read_bytes():
            raise RuntimeError('Credential found in distributable file: ' + str(file.relative_to(ROOT)))

with zipfile.ZipFile(DESTINATION, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for file in sorted(files):
        package.write(file, 'TRACE/' + file.relative_to(ROOT).as_posix())
    for source, name in [
        ('qa/desktop-single-html.png', '界面预览.png'),
        ('qa/live-review-result.json', '本地真实审查示例.json'),
        ('qa/hosted-review-result.json', '在线真实审查示例.json'),
    ]:
        file = ROOT / source
        if file.is_file():
            if secret and secret.encode() in file.read_bytes():
                raise RuntimeError('Credential found in example artifact.')
            package.write(file, 'TRACE/示例/' + name)
with zipfile.ZipFile(DESTINATION) as package:
    assert package.testzip() is None
    assert 'TRACE/index.html' in package.namelist()
    assert 'TRACE/desktop_launcher.pyw' in package.namelist()
print(f'Packaged {len(files)} source files; no runtime credentials: {DESTINATION}')
