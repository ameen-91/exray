import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ENTRIES_PATH = Path(Path.home(), "exray_data.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json() -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    if ENTRIES_PATH.exists():
        with open(ENTRIES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    return data


def save_json(data: Dict[str, Any]) -> None:
    with open(ENTRIES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _load_state() -> Dict[str, Any]:
    data = load_json()
    runs = data.get("runs")
    if not isinstance(runs, dict):
        runs = {}
    data["runs"] = _normalize_runs(runs)
    return data


def _normalize_runs(runs: Dict[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Dict[str, Any]] = {}
    for key, value in runs.items():
        if isinstance(value, dict):
            record = value.copy()
        else:
            record = {"value": value}

        run_id = record.get("run_id") or record.get("runID") or key
        record["run_id"] = str(run_id)
        record.pop("runID", None)

        normalized[record["run_id"]] = record
    return normalized


def list_runs() -> List[Dict[str, Any]]:
    state = _load_state()
    runs = list(state["runs"].values())
    dirty = False
    for run in runs:
        if _backfill_result_object(run):
            dirty = True
    if dirty:
        save_json(state)
    return runs


def get_run(run_id: str) -> Optional[Dict[str, Any]]:
    state = _load_state()
    run = state["runs"].get(run_id)
    if run:
        if _backfill_result_object(run):
            save_json(state)
    return run


def create_run_entry(run_id: str, record: Dict[str, Any]) -> Dict[str, Any]:
    state = _load_state()
    if run_id in state["runs"]:
        raise ValueError(f"Run {run_id} already exists")

    now = _now()
    stored = {
        **record,
        "run_id": run_id,
        "created_at": now,
        "updated_at": now,
    }
    state["runs"][run_id] = stored
    save_json(state)
    return stored


def update_run_entry(run_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    state = _load_state()
    if run_id not in state["runs"]:
        return None

    state["runs"][run_id].update(updates)
    state["runs"][run_id]["updated_at"] = _now()
    _backfill_result_object(state["runs"][run_id])
    save_json(state)
    return state["runs"][run_id]


def _backfill_result_object(run: Dict[str, Any]) -> bool:
    if run.get("result_object") or not run.get("parameters"):
        return False

    input_name = run.get("input_file_name")
    workflow = run.get("workflow")

    if workflow == "llm" and input_name:
        run["result_object"] = f"output/{input_name}"
        return True
    elif workflow == "ctgan" and input_name:
        run["result_object"] = f"output/{input_name}"
        return True
    return False


