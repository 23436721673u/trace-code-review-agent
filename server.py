"""Local-only Python API + static app. Start: py -3 server.py"""
import argparse
import functools
import hashlib
import hmac
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from engine import Engine, ROOT, Store, model_ready, run_policy
from policies import RECIPES
from review_gateway import health as review_health, stream_review

DESKTOP_ROOT_ID = hashlib.sha256(str(ROOT).casefold().encode('utf-8')).hexdigest()[:24]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, engine=None, **kwargs):
        self.engine = engine
        super().__init__(*args, directory=str(ROOT / "public"), **kwargs)

    def log_message(self, fmt, *args):
        # Suppress request content; model keys are never put in request URLs.
        if not self.path.startswith("/api/runs/"):
            super().log_message(fmt, *args)

    def translate_path(self, path):
        # Keep all other files inside public; never expose backend or .data.
        if urlsplit(path).path in ('/', '/index.html') and (ROOT / 'index.html').is_file():
            return str(ROOT / 'index.html')
        return super().translate_path(path)

    def send_json(self, value, code=200):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def valid_origin(self):
        host = self.headers.get("Host", "")
        if host not in ("127.0.0.1:{}".format(self.server.server_port), "localhost:{}".format(self.server.server_port)):
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin == "http://" + host

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/"):
            return super().do_GET()
        if not self.valid_origin():
            return self.send_json({"error": "Origin rejected"}, 403)
        try:
            if path == '/api/desktop/status':
                return self.send_json({'app_id': 'trace-desktop/1', 'root_id': DESKTOP_ROOT_ID, 'pid': os.getpid()})
            if path == "/api/review/health":
                return self.send_json(review_health())
            if path == "/api/health":
                return self.send_json({"service": "trace-python", "llm_configured": model_ready(), "version": "0.1.0"})
            if path == "/api/runs":
                return self.send_json(self.engine.store.history())
            parts = path.strip("/").split("/")
            if len(parts) in (3, 4) and parts[:2] == ["api", "runs"]:
                if len(parts) == 3:
                    return self.send_json(self.engine.store.get(parts[2]))
                if parts[3] == "report":
                    return self.send_json(self.engine.report(parts[2]))
            return self.send_json({"error": "Not found"}, 404)
        except KeyError:
            return self.send_json({"error": "Run not found"}, 404)
        except Exception:
            return self.send_json({"error": "Server operation failed"}, 500)

    def do_POST(self):
        if not self.valid_origin():
            return self.send_json({"error": "Origin rejected"}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            is_review = urlsplit(self.path).path == '/api/review'
            if not 0 < length <= (2100000 if is_review else 16384):
                raise ValueError("Request body exceeds allowed size")
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("Expected application/json")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Expected JSON object")
            if is_review:
                return stream_review(self, data)
            path = urlsplit(self.path).path
            if path == '/api/desktop/stop':
                token = os.environ.get('TRACE_DESKTOP_TOKEN', '')
                supplied = self.headers.get('X-TRACE-Desktop-Token', '')
                if not token or not hmac.compare_digest(token, supplied):
                    return self.send_json({'error': 'Desktop token rejected'}, 403)
                self.send_json({'stopping': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if path == "/api/runs":
                return self.send_json(self.engine.start(data.get("scenario"), data.get("title", ""), data.get("note", "")), 202)
            if path == "/api/experiment":
                if data.get("scenario") not in RECIPES:
                    raise ValueError("Unknown recipe")
                return self.send_json(run_policy(data["scenario"], "mutations"))
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[:2] == ["api", "runs"] and parts[3] == "approve":
                return self.send_json(self.engine.approve(parts[2]))
            return self.send_json({"error": "Not found"}, 404)
        except KeyError:
            return self.send_json({"error": "Run not found"}, 404)
        except (ValueError, TypeError) as exc:
            return self.send_json({"error": str(exc)[:180]}, 400)
        except RuntimeError as exc:
            return self.send_json({"error": str(exc)[:180]}, 409)
        except Exception:
            return self.send_json({"error": "Server operation failed"}, 500)


def main():
    parser = argparse.ArgumentParser(description="TRACE local delivery lab")
    parser.add_argument("--port", type=int, default=int(os.environ.get("TRACE_PORT", "8787")))
    args = parser.parse_args()
    store = Store()
    store.recover()
    engine = Engine(store)
    handler = functools.partial(Handler, engine=engine)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print("TRACE ready at http://127.0.0.1:{}/".format(args.port), flush=True)
    print("Engine: Python subprocess | Model: " + ("configured" if model_ready() else "offline policy (no LLM)"), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
