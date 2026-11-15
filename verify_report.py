"""Independently verify an exported report against this checkout's contracts.

Usage: py -3 verify_report.py TRACE-TR-XXXXXXXX-evidence.json
This does not authenticate a reporter or prove that a remote process ran.
"""
import json
import sys
from pathlib import Path

from engine import chain_valid, digest
from policies import RECIPES, evaluate, mutate


def verify(report):
    if report.get("format") != "trace-evidence/0.1":
        return {"format_valid": False}
    run = report["run"]
    recipe = RECIPES[run["scenario"]]
    return {
        "format_valid": True,
        "event_chain_valid": chain_valid(run["events"]),
        "contract_matches_checkout": report["contract"] == recipe and run["contract_hash"] == digest(recipe),
        "evaluations_reproduce": bool(run["evaluations"]) and all(result == evaluate(run["scenario"], result["candidate"]) for result in run["evaluations"]),
        "mutations_reproduce": run["mutation"] == mutate(run["scenario"]),
    }


if __name__ == "__main__":
    try:
        report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        checks = verify(report)
        print(json.dumps(checks, indent=2))
        print("Scope: record consistency and reproducible fixture results only; no external signature or source authentication.")
        sys.exit(0 if all(checks.values()) else 1)
    except Exception as exc:
        print("Report verification failed: " + type(exc).__name__)
        sys.exit(1)
