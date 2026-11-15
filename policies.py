"""Trusted, deliberately small business policies. No generated code is executed.

The fixtures are independent expected outcomes in dist/recipes.json.
Run `py -3 policies.py booking complete` to inspect an actual test result.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RECIPES = json.loads((ROOT / "public" / "recipes.json").read_text(encoding="utf-8"))
CANDIDATES = ("baseline", "partial", "complete", "no-auth", "boundary", "no-validation")


def check_overlap(x, inclusive=False):
    # A fixed existing reservation [10, 12), using half-open intervals.
    return (x["start"] <= 12 and 10 <= x["end"]) if inclusive else (x["start"] < 12 and 10 < x["end"])


def check_identity(x):
    return bool(x["actor"]) and (x["actor"] == x["owner"] or x["role"] == "admin")


def validate_slot(x):
    return 0 <= x["start"] < x["end"] <= 24


def booking(candidate, x):
    identity = check_identity(x)
    valid = validate_slot(x)
    overlap = check_overlap(x, inclusive=candidate in ("baseline", "boundary"))
    return (not overlap
            and (candidate in ("baseline", "no-validation") or valid)
            and (candidate in ("baseline", "partial", "no-auth") or identity))


def check_visibility(x):
    return x["published"] or x["actor"] == x["owner"] or x["role"] == "admin"


def check_session(x):
    return bool(x["actor"]) and x["active"]


def check_tenant(x):
    return x["tenant"] == x["resource_tenant"]


def xueku(candidate, x):
    visibility = check_visibility(x)
    session = check_session(x)
    tenant = check_tenant(x)
    if candidate == "baseline":
        return bool(x["actor"])
    return ((candidate == "boundary" or visibility)
            and (candidate == "no-auth" or session)
            and (candidate in ("partial", "no-validation") or tenant))


def validate_score(x):
    return type(x["score"]) is int and 0 <= x["score"] <= 100000


def check_signature(x):
    return bool(x["actor"]) and x["signed"] and x["actor"] == x["owner"]


def check_rate(x):
    return x["seconds"] > 0 and x["score"] / x["seconds"] <= 1000


def leaderboard(candidate, x):
    score = validate_score(x)
    identity = check_signature(x)
    rate = check_rate(x)
    if candidate == "baseline":
        return x["score"] <= 100000
    return ((candidate == "boundary" or score)
            and (candidate in ("partial", "no-auth") or identity)
            and (candidate == "no-validation" or rate))


POLICIES = {"booking": booking, "xueku": xueku, "leaderboard": leaderboard}


def evaluate(scenario, candidate):
    if scenario not in POLICIES or candidate not in CANDIDATES:
        raise ValueError("Unknown recipe or candidate")
    tests = []
    for case in RECIPES[scenario]["cases"]:
        actual = bool(POLICIES[scenario](candidate, case["input"]))
        tests.append(dict(case, actual=actual, passed=actual == case["expected"]))
    return {"candidate": candidate, "total": len(tests),
            "passed": sum(t["passed"] for t in tests), "tests": tests}


def mutate(scenario):
    original = evaluate(scenario, "complete")
    mutants = []
    for mutation in RECIPES[scenario]["mutations"]:
        result = evaluate(scenario, mutation["id"])
        mutants.append(dict(mutation, killed=result["passed"] < result["total"],
                            caughtBy=[t["id"] for t in result["tests"] if not t["passed"]],
                            result=result))
    return {"original": original, "mutants": mutants}


if __name__ == "__main__":
    scenario = sys.argv[1]
    candidate = sys.argv[2]
    result = mutate(scenario) if candidate == "mutations" else evaluate(scenario, candidate)
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
