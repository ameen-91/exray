import json
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
import yaml
from minio import Minio

ARGO_SERVER_URL='https://localhost:2746/api/v1/workflows/argo'
MINIO_ENDPOINT = "127.0.0.1:9000"
MINIO_BUCKET = "inputs"
MINIO_ACCESS_KEY =  "admin"
MINIO_SECRET_KEY = "password"
KUBECONFIG_PATH = "_ansible/kubeconfig"

REQUEST_TIMEOUT = 5

def get_minio_client():
    return Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False
    )

HEADERS={"content-type": "application/json"}

def create_run(
    workflow_name: str,
    parameters: Optional[Dict[str, Any]] = None,
    input_file_path: Optional[str] = None,
    input_object_name: Optional[str] = None,
    cpu_limit: Optional[str] = None,
    memory_limit: Optional[str] = None,
) -> Dict[str, Any]:
    """Submit an Argo workflow and return metadata about the run."""

    workflow_path = Path(__file__).with_name(f"{workflow_name}.yaml")
    with open(workflow_path, "r", encoding="utf-8") as f:
        workflow_spec = yaml.load(f, Loader=yaml.FullLoader)

    parameters = parameters.copy() if parameters else {}

    if parameters:
        for template in workflow_spec["spec"]["templates"]:
            inputs = template.get("inputs", {})
            for param in inputs.get("parameters", []):
                name = param.get("name")
                if name in parameters and parameters[name] is not None:
                    param["value"] = str(parameters[name])

    dataset_name = parameters.get("input_file_name") if parameters else None
    object_name = input_object_name
    if input_file_path:
        resolved_path = Path(input_file_path)
        object_name = object_name or f"input/{dataset_name or resolved_path.name}"
        upload_file_to_minio(str(resolved_path), object_name)

    for template in workflow_spec["spec"]["templates"]:
        outputs = template.get("outputs", {})
        for artifact in outputs.get("artifacts", []):
            artifact.setdefault("s3", {})
            artifact["s3"]["bucket"] = MINIO_BUCKET

    if cpu_limit or memory_limit:
        for template in workflow_spec["spec"]["templates"]:
            container = template.get("container")
            if not container:
                continue
            resources = container.setdefault("resources", {"limits": {}, "requests": {}})
            limits = resources.setdefault("limits", {})
            requests_res = resources.setdefault("requests", {})
            if cpu_limit:
                limits["cpu"] = str(cpu_limit)
                requests_res["cpu"] = str(cpu_limit)
            if memory_limit:
                limits["memory"] = str(memory_limit)
                requests_res["memory"] = str(memory_limit)

    response = requests.post(
        ARGO_SERVER_URL,
        headers=HEADERS,
        data=json.dumps({"workflow": workflow_spec}),
        verify=False,
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()

    metadata = payload.get("metadata", {})
    argo_name = metadata.get("name")

    result_key = None
    if dataset_name:
        result_key = f"output/{dataset_name}"
    elif object_name:
        result_key = f"output/{Path(object_name).name}"

    return {
        "argo_name": argo_name,
        "namespace": metadata.get("namespace", "argo"),
        "submitted_at": metadata.get("creationTimestamp"),
        "input_object": object_name,
        "result_object": result_key,
        "raw_response": payload,
    }

def upload_file_to_minio(file_path, object_name: str):
    minio_client = get_minio_client()
    
    if not minio_client.bucket_exists(MINIO_BUCKET):
        minio_client.make_bucket(MINIO_BUCKET)
    minio_client.fput_object(
        MINIO_BUCKET,
        object_name,
        file_path,
    )
        
def generate_presigned_url(object_name: str) -> str:
    minio_client = get_minio_client()
    return minio_client.presigned_get_object(
        MINIO_BUCKET,
        object_name,
        expires=timedelta(hours=1)
    )


def get_workflow(argo_workflow_name: str) -> Optional[Dict[str, Any]]:
    """Retrieve a workflow from Argo by name."""
    response = requests.get(
        f"{ARGO_SERVER_URL}/{argo_workflow_name}",
        headers=HEADERS,
        verify=False,
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def get_workflow_status(argo_workflow_name: str) -> Optional[Dict[str, Any]]:
    """Return key status fields (phase, start/finish timestamps) for a workflow."""
    workflow = get_workflow(argo_workflow_name)
    if not workflow:
        return None
    status = workflow.get("status", {})
    return {
        "phase": status.get("phase"),
        "startedAt": status.get("startedAt"),
        "finishedAt": status.get("finishedAt"),
        "progress": status.get("progress"),
        "message": status.get("message"),
    }


def get_output_artifacts(argo_workflow_name: str) -> List[Dict[str, Any]]:
    """Return the list of output artifacts recorded for a workflow."""
    workflow = get_workflow(argo_workflow_name)
    if not workflow:
        return []
    outputs = workflow.get("status", {}).get("outputs", {})
    return outputs.get("artifacts", [])


def get_workflow_logs(argo_workflow_name: str, tail_lines: Optional[int] = None) -> str:
    """Fetch logs for all pods belonging to the workflow."""

    workflow = get_workflow(argo_workflow_name)
    if not workflow:
        raise ValueError(f"Workflow {argo_workflow_name} not found")

    pod_nodes = _extract_pod_nodes(workflow)
    if not pod_nodes:
        return _fetch_logs_from_argo(argo_workflow_name, tail_lines)

    sections: List[str] = []
    for display_name, pod_name, phase in pod_nodes:
        try:
            log_text = _fetch_logs_from_argo(
                argo_workflow_name,
                tail_lines,
                pod_name=pod_name,
            )
            if not log_text.strip():
                log_text = _fetch_logs_from_argo(
                    argo_workflow_name,
                    tail_lines,
                    pod_name=pod_name,
                    containers=["wait", "main"],
                )
            body = log_text.strip() or "(no log output yet)"
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response else "unknown"
            body = f"Failed to fetch logs for pod {pod_name} (HTTP {status})."
        except Exception as exc:
            body = f"Failed to fetch logs for pod {pod_name}: {exc}"

        header = f"=== {display_name} [{pod_name}] (phase: {phase}) ==="
        sections.append(f"{header}\n{body}")

    try:
        aggregated = _fetch_logs_from_argo(argo_workflow_name, tail_lines)
        if aggregated.strip():
            sections.append("=== Aggregated workflow logs ===\n" + aggregated.strip())
    except Exception:
        pass

    return "\n\n".join(sections)


def _extract_pod_nodes(workflow: Dict[str, Any]) -> List[Tuple[str, str, str]]:
    """Collect pod nodes from workflow status sorted by start time."""
    nodes = workflow.get("status", {}).get("nodes", {}) or {}
    pod_entries: List[Tuple[str, str, str, str]] = []

    for node in nodes.values():
        pod_name = node.get("podName")
        if not pod_name:
            continue
        display_name = node.get("displayName") or node.get("name") or pod_name
        phase = node.get("phase", "Unknown")
        start_time = node.get("startedAt") or ""
        pod_entries.append((start_time, display_name, pod_name, phase))

    pod_entries.sort(key=lambda item: item[0])
    return [(entry[1], entry[2], entry[3]) for entry in pod_entries]


def _fetch_logs_from_argo(
    argo_workflow_name: str,
    tail_lines: Optional[int] = None,
    pod_name: Optional[str] = None,
    containers: Optional[List[str]] = None,
) -> str:
    params: Dict[str, Any] = {}
    if tail_lines:
        params["logOptions.tailLines"] = str(tail_lines)
    if pod_name:
        params["podName"] = pod_name
    container_list = containers or ["main"]

    last_error: Optional[Exception] = None
    for container in container_list:
        params["logOptions.container"] = container
        try:
            response = requests.get(
                f"{ARGO_SERVER_URL}/{argo_workflow_name}/log",
                headers=HEADERS,
                params=params,
                verify=False,
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last_error = exc
            continue

    if last_error:
        raise last_error
    return ""


def get_cluster_info() -> Optional[Dict[str, Any]]:
    """Get Kubernetes cluster resource information."""
    try:
        from kubernetes import client, config
        
        config.load_kube_config(config_file=KUBECONFIG_PATH)
        v1 = client.CoreV1Api()
        
        nodes = v1.list_node()
        
        total_cpu = 0.0
        total_memory_gb = 0.0
        allocatable_cpu = 0.0
        allocatable_memory_gb = 0.0
        node_count = len(nodes.items)
        node_details: List[Dict[str, Any]] = []

        def parse_cpu(cpu_str: str) -> float:
            value = cpu_str or "0"
            if value.endswith("m"):
                try:
                    return float(value[:-1]) / 1000.0
                except ValueError:
                    return 0.0
            try:
                return float(value)
            except ValueError:
                return 0.0

        def parse_memory_to_gb(mem_str: str) -> float:
            value = mem_str or "0Ki"
            try:
                if value.endswith("Ki"):
                    return float(value[:-2]) / (1024 * 1024)
                if value.endswith("Mi"):
                    return float(value[:-2]) / 1024
                if value.endswith("Gi"):
                    return float(value[:-2])
                return 0.0
            except ValueError:
                return 0.0

        for node in nodes.items:
            capacity = node.status.capacity or {}
            allocatable = node.status.allocatable or {}

            cpu_cap = parse_cpu(str(capacity.get('cpu', '0')))
            cpu_alloc = parse_cpu(str(allocatable.get('cpu', '0')))
            mem_cap = parse_memory_to_gb(str(capacity.get('memory', '0Ki')))
            mem_alloc = parse_memory_to_gb(str(allocatable.get('memory', '0Ki')))

            total_cpu += cpu_cap
            allocatable_cpu += cpu_alloc
            total_memory_gb += mem_cap
            allocatable_memory_gb += mem_alloc

            conditions = node.status.conditions or []
            ready_condition = next((c for c in conditions if c.type == "Ready"), None)
            node_ready = ready_condition.status == "True" if ready_condition else False

            node_name = getattr(node.metadata, "name", None) or "unknown"

            node_details.append(
                {
                    "name": node_name,
                    "ready": node_ready,
                    "cpu_capacity": round(cpu_cap, 2),
                    "cpu_allocatable": round(cpu_alloc, 2),
                    "memory_capacity_gb": round(mem_cap, 2),
                    "memory_allocatable_gb": round(mem_alloc, 2),
                    "kubelet_version": getattr(node.status.node_info, "kubelet_version", None) if node.status.node_info else None,
                }
            )

        return {
            "nodes": node_count,
            "total_cpu": round(total_cpu, 1),
            "total_memory_gb": round(total_memory_gb, 1),
            "allocatable_cpu": round(allocatable_cpu, 1),
            "allocatable_memory_gb": round(allocatable_memory_gb, 1),
            "node_details": node_details,
        }
    except Exception:
        return None


__all__ = [
    "create_run",
    "generate_presigned_url",
    "get_workflow",
    "get_workflow_status",
    "get_output_artifacts",
    "get_workflow_logs",
    "get_cluster_info",
]