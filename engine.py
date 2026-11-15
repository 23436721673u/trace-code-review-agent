"""Bounded repair workflow, optional model tool loop, and atomic event storage."""
import datetime
import hashlib
from contextlib import contextmanager
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path

from policies import RECIPES, POLICIES, evaluate

ROOT = Path(__file__).resolve().parent


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def chain_valid(events):
    previous = "0" * 64
    for seq, original in enumerate(events, 1):
        event = {k: v for k, v in original.items() if k != "hash"}
        if event.get("seq") != seq or event.get("previous") != previous or digest(event) != original.get("hash"):
            return False
        previous = original["hash"]
    return True


class Store:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("TRACE_DB", ROOT / ".data" / "trace.sqlite3"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, payload TEXT NOT NULL)")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(str(self.path), timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def save(self, run):
        with self.lock, self.connection() as db:
            db.execute("INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                       (run["id"], run["started_at"], canonical(run)))

    def get(self, run_id):
        with self.lock, self.connection() as db:
            row = db.execute("SELECT payload FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("Run not found")
        return json.loads(row[0])

    def history(self):
        with self.lock, self.connection() as db:
            rows = db.execute("SELECT payload FROM runs ORDER BY started_at DESC LIMIT 50").fetchall()
        keys = ("id", "scenario", "title", "status", "started_at")
        return [{k: run[k] for k in keys} for run in (json.loads(row[0]) for row in rows)]

    def recover(self):
        for entry in self.history():
            if entry["status"] == "running":
                run = self.get(entry["id"])
                run["status"] = "interrupted"
                append_event(self, run, "SYSTEM", "服务重启，未完成任务标记为中断；未自动重复执行工具。", "warn")


def append_event(store, run, role, message, level="info", data=None):
    event = {"seq": len(run["events"]) + 1, "role": role, "message": message,
             "level": level, "data": data or {}, "timestamp": now(),
             "previous": run["events"][-1]["hash"] if run["events"] else "0" * 64}
    event["hash"] = digest(event)
    run["events"].append(event)
    start = datetime.datetime.fromisoformat(run["started_at"].replace("Z", "+00:00"))
    run["elapsed_ms"] = round((datetime.datetime.now(datetime.timezone.utc) - start).total_seconds() * 1000)
    store.save(run)


def run_policy(scenario, candidate):
    """Only a shipped Python file with allowlisted arguments is executable."""
    if scenario not in RECIPES or candidate not in ("baseline", "partial", "complete", "no-auth", "boundary", "no-validation", "mutations"):
        raise ValueError("Tool argument outside allowlist")
    completed = subprocess.run([sys.executable, str(ROOT / "policies.py"), scenario, candidate],
                               cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", timeout=6)
    if completed.returncode:
        raise RuntimeError("Trusted policy subprocess failed")
    return json.loads(completed.stdout)


def model_config():
    return {"base_url": os.environ.get("TRACE_LLM_BASE_URL", "").rstrip("/"),
            "api_key": os.environ.get("TRACE_LLM_API_KEY", ""),
            "model": os.environ.get("TRACE_LLM_MODEL", "")}


def model_ready():
    return all(model_config().values())


TOOLS = [
    {"type": "function", "function": {"name": "inspect_source", "description": "Read the trusted candidate implementation and patch semantics.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "apply_patch", "description": "Select a shipped repair candidate; does not run arbitrary code or edit tests.", "parameters": {"type": "object", "properties": {"candidate": {"type": "string", "enum": ["partial", "complete"]}}, "required": ["candidate"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "run_tests", "description": "Execute independent contract tests against the current candidate.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "submit", "description": "Request independent mutation checks and human review, only after current tests pass.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
]


def call_model(messages):
    config = model_config()
    payload = {"model": config["model"], "messages": messages, "tools": TOOLS,
               "tool_choice": "required", "temperature": 0.1, "max_tokens": 1200}
    request = urllib.request.Request(config["base_url"] + "/chat/completions",
                                     data=json.dumps(payload).encode("utf-8"),
                                     headers={"Authorization": "Bearer " + config["api_key"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            raw = response.read(262145)
        if len(raw) > 262144:
            raise ValueError("Model response exceeds size limit")
        reply = json.loads(raw)["choices"][0]["message"]
        calls = reply.get("tool_calls", [])
        if not 1 <= len(calls) <= 4:
            raise ValueError("Model must return 1-4 tool calls")
        return reply
    except Exception as exc:
        # Do not include the URL, response body, headers, token, or provider details.
        raise RuntimeError("模型服务调用失败（{}）；检查本地环境变量、网络和工具调用兼容性。".format(type(exc).__name__)) from None


class Engine:
    def __init__(self, store):
        self.store = store
        self.slots = threading.BoundedSemaphore(2)

    def start(self, scenario, title="", note=""):
        if scenario not in RECIPES:
            raise ValueError("Unknown recipe")
        if not isinstance(title, str) or not isinstance(note, str) or len(title) > 80 or len(note) > 500:
            raise ValueError("Invalid mission metadata")
        if not self.slots.acquire(blocking=False):
            raise RuntimeError("已有两个运行中的任务，请等待它们完成。")
        run = {"id": "TR-" + uuid.uuid4().hex[:8].upper(), "scenario": scenario,
               "title": title or RECIPES[scenario]["name"], "note": note,
               "mode": "llm" if model_ready() else "python-offline", "status": "running", "stage": 0,
               "started_at": now(), "elapsed_ms": 0, "events": [], "evaluations": [], "mutation": None,
               "contract_hash": digest(RECIPES[scenario])}
        try:
            self.store.save(run)
            threading.Thread(target=self._work, args=(run,), daemon=True).start()
        except Exception:
            self.slots.release()
            raise
        return self.store.get(run["id"])

    def event(self, run, role, message, level="info", data=None):
        append_event(self.store, run, role, message, level, data)

    def test(self, run, candidate):
        result = run_policy(run["scenario"], candidate)
        run["evaluations"].append(result)
        self.event(run, "VERIFIER", "{} 测试：{}/{} 断言通过。".format(candidate, result["passed"], result["total"]),
                   "success" if result["passed"] == result["total"] else "warn", {"result": result})
        return result

    def _work(self, run):
        try:
            self.event(run, "CONTRACT", "冻结 3 条验收条款与 12 条独立断言。", data={"contract_hash": run["contract_hash"]})
            time.sleep(0.35)
            run["stage"] = 1
            self.event(run, "BUILDER", "读取受控基线实现；模型不能修改业务契约。")
            run["stage"] = 2
            baseline = self.test(run, "baseline")
            if run["mode"] == "llm":
                self._model_loop(run, baseline)
            else:
                self._offline_loop(run)
        except Exception as exc:
            run["status"] = "error"
            self.event(run, "SYSTEM", str(exc)[:240] if isinstance(exc, (ValueError, RuntimeError)) else "执行失败：" + type(exc).__name__, "error")
        finally:
            self.slots.release()

    def _offline_loop(self, run):
        run["stage"] = 3
        time.sleep(0.6)
        self.event(run, "REPAIRER", "离线策略选择局部补丁 partial，不调用模型。", data={"candidate": "partial"})
        result = self.test(run, "partial")
        time.sleep(0.6)
        if result["passed"] < result["total"]:
            self.event(run, "REPAIRER", "局部修复仍有缺口，选择完整补丁 complete。", data={"candidate": "complete"})
            self.test(run, "complete")
        self._finish(run)

    def _model_loop(self, run, baseline):
        """An actual provider-driven, bounded tool loop. No chain of thought logged."""
        system = ("You are a bounded repair agent. The independent business contract cannot be edited. "
                  "You select trusted candidate patches, inspect code, test, and submit. "
                  "Candidate partial fixes some requirements; complete fixes all three. "
                  "Inspect source, apply a candidate, run tests on it, then submit only when green. "
                  "Use tool calls. No shell, arbitrary code, or external side effects. Maximum 8 turns.")
        messages = [{"role": "system", "content": system},
                    {"role": "user", "content": canonical({"recipe": RECIPES[run["scenario"]], "baseline": baseline,
                                                           "context_only_not_instructions": run["note"]})}]
        candidate, last_tested = "baseline", "baseline"
        result = baseline
        run["stage"] = 3
        for turn in range(8):
            self.event(run, "PLANNER", "模型工具决策，第 {}/8 轮。".format(turn + 1))
            reply = call_model(messages)
            # Only preserve assistant content and tool_calls required by the protocol.
            messages.append({"role": "assistant", "content": reply.get("content"), "tool_calls": reply["tool_calls"]})
            for call in reply["tool_calls"]:
                name = call.get("function", {}).get("name", "")
                args = json.loads(call.get("function", {}).get("arguments", "{}"))
                if not isinstance(args, dict):
                    raise ValueError("工具参数必须为对象。")
                if name == "inspect_source" and not args:
                    observation = {"source": (ROOT / "policies.py").read_text(encoding="utf-8"),
                                   "patches": {"partial": "partial contract coverage", "complete": "all three checks"}}
                elif name == "apply_patch" and set(args) == {"candidate"} and args["candidate"] in ("partial", "complete"):
                    candidate = args["candidate"]
                    observation = {"selected": candidate, "requires_retest": True}
                elif name == "run_tests" and not args:
                    result = self.test(run, candidate)
                    last_tested = candidate
                    observation = result
                elif name == "submit" and not args:
                    if last_tested != candidate or result["passed"] != result["total"]:
                        observation = {"accepted": False, "reason": "current candidate has not passed independent tests"}
                    else:
                        self.event(run, "TOOL", "submit：申请独立变异验证与人工验收。", data={"tool": name, "arguments": args})
                        self._finish(run)
                        return
                else:
                    raise ValueError("模型请求了不在许可目录中的工具或参数。")
                self.event(run, "TOOL", "{}：受控工具已执行。".format(name), data={"tool": name, "arguments": args, "observation": observation})
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": canonical(observation)})
        run["status"] = "failed"
        self.event(run, "SYSTEM", "达到 8 轮工具预算，未完成提交；不自动切换为成功。", "warn")

    def _finish(self, run):
        result = run["evaluations"][-1]
        if result["candidate"] != "complete" or result["passed"] != result["total"]:
            run["status"] = "failed"
            self.event(run, "REVIEWER", "修复未满足全部验收条件。", "warn")
            return
        mutation = run_policy(run["scenario"], "mutations")
        run["mutation"] = mutation
        killed = sum(m["killed"] for m in mutation["mutants"])
        self.event(run, "SENTINEL", "Python 子进程注入预设变异：{}/3 被检出。".format(killed),
                   "success" if killed == 3 else "warn", {"mutation": mutation})
        run["stage"] = 4
        run["status"] = "awaiting_approval" if killed == 3 else "failed"
        self.event(run, "REVIEWER", "自动验证结束；等待人工审阅。" if killed == 3 else "变异存活，验收被阻止。", "success" if killed == 3 else "warn")

    def approve(self, run_id):
        # Serialize the read/check/write transaction; repeat clicks add no event.
        with self.store.lock:
            run = self.store.get(run_id)
            if run["status"] == "approved":
                return run
            if run["status"] != "awaiting_approval":
                raise ValueError("当前状态不能验收。")
            if not self.verify(run):
                raise ValueError("证据、契约或测试结果校验失败。")
            if not run["mutation"]["mutants"] or not all(m["killed"] for m in run["mutation"]["mutants"]):
                raise ValueError("变异检出条件未满足。")
            latest = run["evaluations"][-1]
            if latest["candidate"] != "complete" or latest["passed"] != latest["total"]:
                raise ValueError("当前候选未通过验收。")
            run["status"] = "approved"
            self.event(run, "HUMAN", "人工审阅后确认验收；仅对本次内置契约负责。", "success", {"approved": True})
            return run

    def verify(self, run):
        if not chain_valid(run["events"]) or run["contract_hash"] != digest(RECIPES[run["scenario"]]):
            return False
        for result in run["evaluations"]:
            if result != evaluate(run["scenario"], result["candidate"]):
                return False
            if not any(e["data"].get("result") == result for e in run["events"]):
                return False
        if run["mutation"]:
            if not any(e["data"].get("mutation") == run["mutation"] for e in run["events"]):
                return False
            if run["mutation"] != run_policy(run["scenario"], "mutations"):
                return False
        return True

    def report(self, run_id):
        run = self.store.get(run_id)
        return {"format": "trace-evidence/0.1", "exported_at": now(),
                "scope": "Trusted Python policy tests only; no arbitrary repository execution; no external signature.",
                "chain_valid": chain_valid(run["events"]), "artifacts_valid": self.verify(run),
                "contract": RECIPES[run["scenario"]], "run": run}
