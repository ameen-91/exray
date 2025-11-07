import subprocess
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Dict, List, Optional
from uuid import uuid4

import requests
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from minio.error import S3Error

from state import entries
from workflows import argo

port_forward_commands = [
    [
        "kubectl",
        "--kubeconfig",
        "_ansible/kubeconfig",
        "port-forward",
        "svc/argo-server",
        "2746:2746",
        "--namespace",
        "argo",
    ],
    [
        "kubectl",
        "--kubeconfig",
        "_ansible/kubeconfig",
        "port-forward",
        "svc/minio",
        "9000:9000",
        "--namespace",
        "argo",
    ],
]

port_forward_processes: List[subprocess.Popen] = []

app = FastAPI(title="ExRay Workflows API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def start_port_forwarding():
    for command in port_forward_commands:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        port_forward_processes.append(process)


@app.on_event("shutdown")
async def stop_port_forwarding():
    for process in port_forward_processes:
        if process.poll() is None:
            process.terminate()
    for process in port_forward_processes:
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


@app.get("/")
async def home():
    return {"service": "exray-workflows", "runs": entries.list_runs()}


@app.get("/health")
async def health_check():
    """Check connectivity to Argo and MinIO services, and get cluster info"""
    services = {}
    
    try:
        response = requests.get(
            f"{argo.ARGO_SERVER_URL}",
            headers=argo.HEADERS,
            verify=False,
            timeout=3
        )
        services["argo"] = {
            "status": "connected" if response.status_code in [200, 401, 403] else "error",
            "message": "Argo Workflows server accessible"
        }
    except Exception as e:
        services["argo"] = {
            "status": "error",
            "message": f"Argo connection failed: {str(e)}"
        }
    
    try:
        minio_client = argo.get_minio_client()
        minio_client.list_buckets()
        bucket_exists = minio_client.bucket_exists(argo.MINIO_BUCKET)
        services["minio"] = {
            "status": "connected",
            "message": f"MinIO accessible, bucket '{argo.MINIO_BUCKET}' {'exists' if bucket_exists else 'missing'}"
        }
    except Exception as e:
        services["minio"] = {
            "status": "error",
            "message": f"MinIO connection failed: {str(e)}"
        }
    
    cluster_info = argo.get_cluster_info()
    
    all_connected = all(s["status"] == "connected" for s in services.values())
    overall = "healthy" if all_connected else "unhealthy"
    
    return {
        "overall_status": overall,
        "services": services,
        "cluster": cluster_info
    }


def _sanitize_filename(filename: Optional[str]) -> str:
    safe_name = Path(filename or "dataset.csv").name
    safe_name = safe_name.replace(" ", "_")
    return safe_name or "dataset.csv"


async def _save_upload_to_temp(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "dataset.csv").suffix or ".csv"
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            tmp.write(chunk)
        temp_path = Path(tmp.name)
    await upload.close()
    return temp_path


def _initial_status(argo_name: Optional[str]) -> Dict[str, Optional[str]]:
    if not argo_name:
        return {"phase": "Pending"}
    try:
        status = argo.get_workflow_status(argo_name)
        if status:
            return status
    except Exception:
        return {"phase": "Submitted"}
    return {"phase": "Submitted"}


@app.post("/runs/ctgan")
async def submit_ctgan_run(
    file: UploadFile = File(...),
    discrete_columns: str = Form(""),
    no_of_epochs: int = Form(300),
    no_of_samples: int = Form(1000),
    cpu_limit: Optional[str] = Form(None),
    memory_limit: Optional[str] = Form(None),
):
    run_id = str(uuid4())
    original_filename = file.filename or "dataset.csv"
    input_file_name = f"{run_id}_{_sanitize_filename(original_filename)}"

    temp_path = await _save_upload_to_temp(file)
    try:
        parameters = {
            "discrete_columns": discrete_columns,
            "no_of_epochs": str(no_of_epochs),
            "no_of_samples": str(no_of_samples),
            "input_file_name": input_file_name,
        }
        argo_response = argo.create_run(
            "ctgan",
            parameters=parameters,
            input_file_path=str(temp_path),
            input_object_name=f"input/{input_file_name}",
            cpu_limit=cpu_limit,
            memory_limit=memory_limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to submit CTGAN workflow") from exc
    finally:
        if temp_path.exists():
            temp_path.unlink()

    status = _initial_status(argo_response.get("argo_name"))

    record = entries.create_run_entry(
        run_id,
        {
            "workflow": "ctgan",
            "parameters": {
                "discrete_columns": discrete_columns,
                "no_of_epochs": no_of_epochs,
                "no_of_samples": no_of_samples,
                "cpu_limit": cpu_limit,
                "memory_limit": memory_limit,
            },
            "argo_name": argo_response.get("argo_name"),
            "namespace": argo_response.get("namespace"),
            "submitted_at": argo_response.get("submitted_at"),
            "status": status,
            "input_object": argo_response.get("input_object"),
            "result_object": argo_response.get("result_object"),
            "input_file_name": input_file_name,
            "original_filename": original_filename,
        },
    )
    return record


@app.post("/runs/llm")
async def submit_llm_run(
    file: UploadFile = File(...),
    labels: str = Form(...),
    model: str = Form(...),
    parallelism: int = Form(1),
    cpu_limit: Optional[str] = Form(None),
    memory_limit: Optional[str] = Form(None),
):
    if parallelism < 1:
        raise HTTPException(status_code=400, detail="parallelism must be at least 1")

    run_id = str(uuid4())
    original_filename = file.filename or "dataset.csv"
    input_file_name = f"{run_id}_{_sanitize_filename(original_filename)}"

    temp_path = await _save_upload_to_temp(file)
    try:
        parameters = {
            "labels": labels,
            "model": model,
            "input_file_name": input_file_name,
            "parallelism": str(parallelism),
        }
        argo_response = argo.create_run(
            "llm",
            parameters=parameters,
            input_file_path=str(temp_path),
            input_object_name=f"input/{input_file_name}",
            cpu_limit=cpu_limit,
            memory_limit=memory_limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to submit LLM workflow") from exc
    finally:
        if temp_path.exists():
            temp_path.unlink()

    status = _initial_status(argo_response.get("argo_name"))

    record = entries.create_run_entry(
        run_id,
        {
            "workflow": "llm",
            "parameters": {
                "labels": labels,
                "model": model,
                "parallelism": parallelism,
                "cpu_limit": cpu_limit,
                "memory_limit": memory_limit,
            },
            "argo_name": argo_response.get("argo_name"),
            "namespace": argo_response.get("namespace"),
            "submitted_at": argo_response.get("submitted_at"),
            "status": status,
            "input_object": argo_response.get("input_object"),
            "result_object": argo_response.get("result_object"),
            "input_file_name": input_file_name,
            "original_filename": original_filename,
        },
    )
    return record


@app.post("/runs/custom")
async def submit_custom_run(
    data_file: UploadFile = File(...),
    python_file: UploadFile = File(...),
    function_name: str = Form("process"),
    pip_packages: str = Form(""),
    cpu_limit: Optional[str] = Form(None),
    memory_limit: Optional[str] = Form(None),
):
    if python_file.filename and not python_file.filename.endswith('.py'):
        raise HTTPException(status_code=400, detail="Python file must have .py extension")
    
    run_id = str(uuid4())
    original_data_filename = data_file.filename or "dataset.csv"
    original_python_filename = python_file.filename or "script.py"
    
    input_file_name = f"{run_id}_{_sanitize_filename(original_data_filename)}"
    python_file_name = f"{run_id}_{_sanitize_filename(original_python_filename)}"

    temp_data_path = await _save_upload_to_temp(data_file)
    temp_python_path = await _save_upload_to_temp(python_file)
    
    try:
        argo.upload_file_to_minio(str(temp_data_path), f"input/{input_file_name}")
        argo.upload_file_to_minio(str(temp_python_path), f"python/{python_file_name}")
        
        parameters = {
            "input_file_name": input_file_name,
            "python_file_name": python_file_name,
            "function_name": function_name,
            "pip_packages": pip_packages,
        }
        
        argo_response = argo.create_run(
            "custom",
            parameters=parameters,
            input_file_path=None,
            input_object_name=None,
            cpu_limit=cpu_limit,
            memory_limit=memory_limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to submit custom workflow: {str(exc)}") from exc
    finally:
        if temp_data_path.exists():
            temp_data_path.unlink()
        if temp_python_path.exists():
            temp_python_path.unlink()

    status = _initial_status(argo_response.get("argo_name"))

    record = entries.create_run_entry(
        run_id,
        {
            "workflow": "custom",
            "parameters": {
                "function_name": function_name,
                "pip_packages": pip_packages,
                "cpu_limit": cpu_limit,
                "memory_limit": memory_limit,
            },
            "argo_name": argo_response.get("argo_name"),
            "namespace": argo_response.get("namespace"),
            "submitted_at": argo_response.get("submitted_at"),
            "status": status,
            "input_object": f"input/{input_file_name}",
            "result_object": argo_response.get("result_object") or f"output/{input_file_name}",
            "input_file_name": input_file_name,
            "original_filename": original_data_filename,
            "python_file_name": python_file_name,
            "original_python_filename": original_python_filename,
        },
    )
    return record


@app.get("/runs")
async def list_runs(refresh: bool = True):
    runs = entries.list_runs()
    if not refresh:
        return {"runs": runs}

    terminal_phases = {"succeeded", "failed", "error", "skipped"}
    refreshed = []
    for run in runs:
        argo_name = run.get("argo_name")
        if not argo_name:
            refreshed.append(run)
            continue
        
        current_phase = (run.get("status", {}).get("phase") or "").lower()
        if current_phase in terminal_phases:
            refreshed.append(run)
            continue
        
        try:
            status = argo.get_workflow_status(argo_name)
        except Exception:
            refreshed.append(run)
            continue
        if not status:
            refreshed.append(run)
            continue
        updated = entries.update_run_entry(run["run_id"], {"status": status}) or run
        refreshed.append(updated)
    return {"runs": refreshed}


@app.get("/runs/{run_id}")
async def get_run(run_id: str, refresh: bool = True):
    run = entries.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if not refresh:
        return run

    argo_name = run.get("argo_name")
    if not argo_name:
        return run

    try:
        status = argo.get_workflow_status(argo_name)
    except Exception:
        return run

    if not status:
        return run

    updated = entries.update_run_entry(run_id, {"status": status})
    return updated or run


@app.get("/runs/{run_id}/result")
async def get_run_result(run_id: str):
    run = entries.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    argo_name = run.get("argo_name")
    if argo_name:
        try:
            status = argo.get_workflow_status(argo_name)
            if status:
                entries.update_run_entry(run_id, {"status": status})
                phase = (status.get("phase") or "").lower()
                if phase and phase not in {"succeeded", "skipped", "completed"}:
                    raise HTTPException(status_code=409, detail="Run is not complete yet")
        except HTTPException:
            raise
        except Exception:
            pass

    object_name = run.get("result_object")
    if not object_name and argo_name:
        artifacts = argo.get_output_artifacts(argo_name)
        object_name = _extract_result_key_from_artifacts(artifacts)
        if object_name:
            entries.update_run_entry(run_id, {"result_object": object_name})

    if not object_name:
        raise HTTPException(status_code=404, detail="Result location unknown")

    try:
        url = argo.generate_presigned_url(object_name)
    except S3Error as exc:
        if argo_name:
            artifacts = argo.get_output_artifacts(argo_name)
            fallback_key = _extract_result_key_from_artifacts(artifacts)
            if fallback_key and fallback_key != object_name:
                entries.update_run_entry(run_id, {"result_object": fallback_key})
                try:
                    url = argo.generate_presigned_url(fallback_key)
                except S3Error as second_exc:
                    raise HTTPException(status_code=404, detail="Result not available") from second_exc
                return {"run_id": run_id, "download_url": url}
        raise HTTPException(status_code=404, detail="Result not available") from exc

    return {"run_id": run_id, "download_url": url}


def _extract_result_key_from_artifacts(artifacts: List[Dict[str, Any]]) -> Optional[str]:
    for artifact in artifacts:
        s3_meta = artifact.get("s3")
        if isinstance(s3_meta, dict):
            key = s3_meta.get("key")
            if key:
                return key
    return None


@app.get("/runs/{run_id}/logs", response_class=PlainTextResponse)
async def get_run_logs(run_id: str, tail: int = 200):
    if tail <= 0:
        tail = 200

    run = entries.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    argo_name = run.get("argo_name")
    if not argo_name:
        raise HTTPException(status_code=404, detail="Argo workflow not recorded for this run")

    try:
        logs = argo.get_workflow_logs(argo_name, tail_lines=tail)
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response else 502
        raise HTTPException(status_code=status_code, detail="Failed to fetch logs") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch logs") from exc

    return logs


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)