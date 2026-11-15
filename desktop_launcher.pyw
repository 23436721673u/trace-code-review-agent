"""TRACE Windows desktop entry: managed loopback server + isolated app window."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
DATA = ROOT / '.data'
APP_ID = 'trace-desktop/1'
ROOT_ID = hashlib.sha256(str(ROOT).casefold().encode('utf-8')).hexdigest()[:24]
STATE = DATA / 'desktop-server.json'
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def status(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.07):
            pass
        with HTTP.open(f'http://127.0.0.1:{port}/api/desktop/status', timeout=0.5) as response:
            data = json.load(response)
        if data.get('app_id') == APP_ID and data.get('root_id') == ROOT_ID:
            return data
    except (OSError, ValueError, urllib.error.URLError):
        pass
    return None


@contextmanager
def startup_lock():
    import msvcrt
    DATA.mkdir(exist_ok=True)
    with (DATA / 'desktop.lock').open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0')
            lock.flush()
        deadline = time.monotonic() + 25
        while True:
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('启动超时，请稍后再打开 TRACE。')
                time.sleep(0.2)
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def ensure_server():
    with startup_lock():
        for port in range(8787, 8800):
            if status(port):
                return port
        python = Path(sys.executable).with_name('python.exe')
        if not python.is_file():
            python = Path(sys.executable)
        for port in range(8787, 8800):
            # Never replace another program listening on one of our ports.
            try:
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', port))
            except OSError:
                continue
            token = secrets.token_urlsafe(32)
            environment = dict(os.environ, PYTHONUTF8='1', TRACE_DESKTOP_TOKEN=token)
            with (DATA / 'desktop-server.log').open('ab') as log:
                process = subprocess.Popen(
                    [str(python), str(ROOT / 'server.py'), '--port', str(port)],
                    cwd=str(ROOT), env=environment, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=log,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                current = status(port)
                if current and current.get('pid') == process.pid:
                    temporary = STATE.with_suffix('.tmp')
                    temporary.write_text(json.dumps({'port': port, 'pid': process.pid, 'token': token}), encoding='utf-8')
                    temporary.replace(STATE)
                    return port
                if process.poll() is not None:
                    break
                time.sleep(0.15)
            if process.poll() is None:
                process.terminate()  # Only the child created above, never an unrelated PID.
                process.wait(timeout=5)
            raise RuntimeError('本地审查服务未能启动，请查看 .data/desktop-server.log。')
        raise RuntimeError('8787–8799 端口均被占用，请关闭不用的本地服务后重试。')


def stop_server():
    with startup_lock():
        if not STATE.exists():
            return
        state = json.loads(STATE.read_text(encoding='utf-8'))
        current = status(state['port'])
        if current and current.get('pid') == state['pid']:
            request = urllib.request.Request(
                f"http://127.0.0.1:{state['port']}/api/desktop/stop", data=b'{}',
                headers={'Content-Type': 'application/json', 'X-TRACE-Desktop-Token': state['token']})
            with HTTP.open(request, timeout=3) as response:
                if response.status != 200:
                    raise RuntimeError('停止请求未被服务接受。')
            deadline = time.monotonic() + 5
            while status(state['port']):
                if time.monotonic() > deadline:
                    raise RuntimeError('服务仍在停止中，请稍后重试。')
                time.sleep(0.1)
        STATE.unlink(missing_ok=True)


def open_window(port):
    candidates = [
        Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe',
        Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Microsoft/Edge/Application/msedge.exe',
        Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
        Path(os.environ.get('LOCALAPPDATA', '')) / 'Google/Chrome/Application/chrome.exe',
    ]
    browser = next((str(p) for p in candidates if p.is_file()), None)
    browser = browser or shutil.which('msedge') or shutil.which('chrome')
    url = f'http://127.0.0.1:{port}/index.html#review'
    if browser:
        subprocess.Popen([
            browser, '--app=' + url, '--window-size=1480,1000',
            '--user-data-dir=' + str(DATA / 'desktop-browser'), '--no-first-run',
            '--no-default-browser-check', '--disable-background-mode'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    else:
        os.startfile(url)


def main():
    parser = argparse.ArgumentParser(description='TRACE desktop launcher')
    parser.add_argument('--stop', action='store_true')
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    if args.stop:
        stop_server()
    else:
        if not (ROOT / 'index.html').is_file():
            raise RuntimeError('缺少 index.html，请先运行 scripts/build-single-html.mjs。')
        port = ensure_server()
        if not args.no_open:
            open_window(port)
        if sys.stdout:
            print(f'TRACE ready at http://127.0.0.1:{port}/index.html')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if sys.stderr:
            print(str(error), file=sys.stderr)
        else:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, str(error), 'TRACE 启动失败', 0x10)
        sys.exit(1)
