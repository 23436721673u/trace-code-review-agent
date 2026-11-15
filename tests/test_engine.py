import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import Engine, Store, append_event, chain_valid, digest, now, run_policy
from policies import RECIPES, evaluate, mutate


def wait_terminal(store, run_id):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        run = store.get(run_id)
        if run["status"] != "running":
            return run
        time.sleep(0.025)
    raise AssertionError("workflow timeout")


class PolicyTests(unittest.TestCase):
    def test_real_subprocess_matches_independent_contract(self):
        for scenario in RECIPES:
            with self.subTest(scenario=scenario):
                baseline = run_policy(scenario, "baseline")
                partial = run_policy(scenario, "partial")
                complete = run_policy(scenario, "complete")
                self.assertLess(baseline["passed"], partial["passed"])
                self.assertLess(partial["passed"], complete["passed"])
                self.assertEqual(complete["passed"], 12)

    def test_mutations_only_break_their_target_requirements(self):
        for scenario in RECIPES:
            for mutant in mutate(scenario)["mutants"]:
                with self.subTest(scenario=scenario, mutant=mutant["id"]):
                    self.assertTrue(mutant["killed"])
                    failures = {t["req"] for t in mutant["result"]["tests"] if not t["passed"]}
                    self.assertEqual(failures, {mutant["requirement"]})

    def test_boundary_and_identity_examples(self):
        result = evaluate("booking", "complete")
        by_id = {t["id"]: t for t in result["tests"]}
        self.assertTrue(by_id["T01"]["actual"])
        self.assertTrue(by_id["T02"]["actual"])
        self.assertFalse(by_id["T06"]["actual"])
        self.assertFalse(by_id["T09"]["actual"])

    def test_untrusted_candidate_cannot_be_executed(self):
        for candidate in ("../../server.py", "complete; whoami", "__import__('os')"):
            with self.assertRaises(ValueError):
                run_policy("booking", candidate)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.directory.name) / "test.sqlite3")
        self.engine = Engine(self.store)

    def tearDown(self):
        self.directory.cleanup()

    def make_run(self, **overrides):
        run = {"id": "TR-TEST", "scenario": "booking", "title": "test", "note": "", "mode": "python-offline",
               "status": "running", "stage": 0, "started_at": now(), "elapsed_ms": 0,
               "events": [], "evaluations": [], "mutation": None, "contract_hash": digest(RECIPES["booking"])}
        run.update(overrides)
        self.store.save(run)
        return run

    def test_hash_chain_detects_changes_reordering_and_deletion(self):
        run = self.make_run()
        append_event(self.store, run, "TEST", "first")
        append_event(self.store, run, "TEST", "second")
        self.assertTrue(chain_valid(run["events"]))
        changed = copy.deepcopy(run["events"])
        changed[0]["message"] = "tampered"
        self.assertFalse(chain_valid(changed))
        self.assertFalse(chain_valid(list(reversed(run["events"]))))
        self.assertFalse(chain_valid(run["events"][1:]))
        # A self-contained hash chain cannot detect truncation at the tail.
        self.assertTrue(chain_valid(run["events"][:1]))

    def test_gate_rejects_running_state(self):
        run = self.make_run()
        with self.assertRaises(ValueError):
            self.engine.approve(run["id"])

    def test_workflow_approval_idempotent_and_persistent(self):
        with patch("engine.model_ready", return_value=False):
            start = self.engine.start("booking")
        run = wait_terminal(self.store, start["id"])
        self.assertEqual(run["status"], "awaiting_approval")
        self.assertTrue(self.engine.verify(run))
        self.assertEqual([r["passed"] for r in run["evaluations"]], [4, 10, 12])
        approved = self.engine.approve(run["id"])
        repeated = self.engine.approve(run["id"])
        self.assertEqual(approved, repeated)
        self.assertEqual(sum(e["role"] == "HUMAN" for e in approved["events"]), 1)
        reopened = Store(self.store.path).get(run["id"])
        self.assertEqual(reopened, approved)
        altered = copy.deepcopy(approved)
        altered["evaluations"][0]["passed"] = 12
        self.assertFalse(self.engine.verify(altered))

    def test_recovery_keeps_evidence_and_marks_interruption(self):
        run = self.make_run()
        append_event(self.store, run, "TEST", "checkpoint")
        self.store.recover()
        recovered = self.store.get(run["id"])
        self.assertEqual(recovered["status"], "interrupted")
        self.assertEqual(recovered["events"][0], run["events"][0])
        self.assertTrue(chain_valid(recovered["events"]))

    def test_model_loop_uses_real_tool_contract_with_mock_provider(self):
        run = self.make_run(mode="llm")
        baseline = self.engine.test(run, "baseline")
        def reply(name, args=None):
            return {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call-"+name, "type": "function", "function": {"name": name, "arguments": json.dumps(args or {})}}]}
        responses = [reply("inspect_source"), reply("submit"), reply("apply_patch", {"candidate": "complete"}), reply("run_tests"), reply("submit")]
        with patch("engine.call_model", side_effect=responses):
            self.engine._model_loop(run, baseline)
        self.assertEqual(run["status"], "awaiting_approval")
        self.assertTrue(self.engine.verify(run))
        denied = [e for e in run["events"] if e["data"].get("observation", {}).get("accepted") is False]
        self.assertEqual(len(denied), 1)

    def test_model_tool_budget_cannot_mark_task_successful(self):
        run = self.make_run(mode="llm")
        baseline = self.engine.test(run, "baseline")
        reply = {"content": None, "tool_calls": [{"id": "test", "function": {"name": "submit", "arguments": "{}"}}]}
        with patch("engine.call_model", return_value=reply):
            self.engine._model_loop(run, baseline)
        self.assertEqual(run["status"], "failed")
        self.assertIsNone(run["mutation"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
