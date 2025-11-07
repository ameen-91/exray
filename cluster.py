import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Sequence

import yaml
import os

BASE_DIR = Path(__file__).resolve().parent
ANSIBLE_DIR = BASE_DIR / "_ansible"
INVENTORY_PATH = ANSIBLE_DIR / "inventory.yaml"
CLUSTER_STATE_PATH = BASE_DIR / "cluster.json"
KUBECONFIG_PATH = ANSIBLE_DIR / "kubeconfig"


def load_cluster_state() -> List[Dict[str, str]]:
    if not CLUSTER_STATE_PATH.exists():
        return []
    with CLUSTER_STATE_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    nodes = data.get("nodes", []) if isinstance(data, dict) else []
    parsed: List[Dict[str, str]] = []
    for entry in nodes:
        if isinstance(entry, str):
            ip = entry.strip()
            if ip:
                parsed.append({"ip": ip, "role": "worker"})
        elif isinstance(entry, dict):
            ip_value = str(entry.get("ip", "")).strip()
            if ip_value:
                role_value = str(entry.get("role", "worker")).strip().lower()
                parsed.append({"ip": ip_value, "role": role_value})
    return ensure_roles(parsed)


def ensure_roles(nodes: List[Dict[str, str]]) -> List[Dict[str, str]]:
    filtered: List[Dict[str, str]] = []
    seen: set[str] = set()
    for node in nodes:
        ip = node.get("ip", "").strip()
        if not ip or ip in seen:
            continue
        seen.add(ip)
        role = node.get("role", "worker").strip().lower()
        filtered.append({"ip": ip, "role": role if role in {"master", "worker"} else "worker"})
    if filtered:
        filtered[0]["role"] = "master"
        for entry in filtered[1:]:
            entry["role"] = "worker"
    return filtered


def save_cluster_state(nodes: List[Dict[str, str]]) -> None:
    ordered = ensure_roles(nodes)
    CLUSTER_STATE_PATH.write_text(
        json.dumps({"nodes": ordered}, indent=2) + "\n",
        encoding="utf-8",
    )


def cluster_from_ips(ips: Sequence[str]) -> List[Dict[str, str]]:
    nodes = [{"ip": ip.strip(), "role": "worker"} for ip in ips if ip.strip()]
    return ensure_roles(nodes)


def sync_inventory(nodes: List[Dict[str, str]]) -> None:
    default_vars = {"ansible_user": "ubuntu", "ansible_ssh_private_key_file": "~/.ssh/id_rsa"}
    inventory: Dict[str, Dict] = {"all": {"vars": default_vars.copy(), "children": {}}}
    if INVENTORY_PATH.exists():
        with INVENTORY_PATH.open("r", encoding="utf-8") as handle:
            existing = yaml.safe_load(handle) or {}
        vars_block = existing.get("all", {}).get("vars") if isinstance(existing, dict) else None
        if isinstance(vars_block, dict):
            inventory["all"]["vars"].update(vars_block)
    if nodes:
        master_ip = nodes[0]["ip"]
        master_hosts = {master_ip: None}
        worker_hosts = {node["ip"]: None for node in nodes[1:]}
        children: Dict[str, Dict] = {"master": {"hosts": master_hosts}}
        if worker_hosts:
            children["worker"] = {"hosts": worker_hosts}
        inventory["all"]["children"] = children
    with INVENTORY_PATH.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(inventory, handle, sort_keys=False)


def remove_kubeconfig() -> None:
    if KUBECONFIG_PATH.exists():
        KUBECONFIG_PATH.unlink()


def update_kubeconfig(master_ip: str) -> None:
    if not KUBECONFIG_PATH.exists():
        return
    with KUBECONFIG_PATH.open("r", encoding="utf-8") as handle:
        try:
            config = yaml.safe_load(handle)
        except yaml.YAMLError:
            return
    if not isinstance(config, dict):
        return
    clusters = config.get("clusters")
    if not isinstance(clusters, list):
        return
    updated = False
    for entry in clusters:
        if not isinstance(entry, dict):
            continue
        cluster = entry.get("cluster")
        if not isinstance(cluster, dict):
            continue
        cluster["server"] = f"https://{master_ip}:6443"
        updated = True
    if updated:
        with KUBECONFIG_PATH.open("w", encoding="utf-8") as handle:
            yaml.safe_dump(config, handle, sort_keys=False, default_flow_style=False)


def run_playbook(playbook: str) -> None:
    command = ["ansible-playbook", "-i", str(INVENTORY_PATH), playbook]
    env = os.environ.copy()
    env.update(load_secrets_env())
    subprocess.run(command, cwd=str(ANSIBLE_DIR), check=True, env=env)


def load_secrets_env() -> Dict[str, str]:
    if not (ANSIBLE_DIR / "secrets.yaml").exists():
        return {}
    with (ANSIBLE_DIR / "secrets.yaml").open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    env: Dict[str, str] = {}
    token = data.get("k3s_token") if isinstance(data, dict) else None
    if isinstance(token, str) and token.strip():
        env["K3S_TOKEN"] = token.strip()
    return env


def apply_cluster(nodes: List[Dict[str, str]]) -> None:
    run_playbook("destroy_cluster.yaml")
    if nodes:
        run_playbook("configure_nodes.yaml")
        update_kubeconfig(nodes[0]["ip"])
    else:
        remove_kubeconfig()


def add_nodes(ips: Sequence[str]) -> None:
    current = load_cluster_state()
    existing_ips = {node["ip"] for node in current}
    new_entries = [ip for ip in ips if ip.strip() and ip.strip() not in existing_ips]
    if not new_entries:
        print("No new nodes to add.")
        return
    updated = current + [{"ip": ip.strip(), "role": "worker"} for ip in new_entries]
    save_cluster_state(updated)
    sync_inventory(updated)
    apply_cluster(updated)
    print("Added nodes:", ", ".join(new_entries))


def remove_nodes(ips: Sequence[str]) -> None:
    target = {ip.strip() for ip in ips if ip.strip()}
    if not target:
        print("No nodes specified for removal.")
        return
    current = load_cluster_state()
    remaining = [node for node in current if node["ip"] not in target]
    if len(remaining) == len(current):
        print("No matching nodes found.")
        return
    save_cluster_state(remaining)
    sync_inventory(remaining)
    apply_cluster(remaining)
    removed = sorted(target.intersection({node["ip"] for node in current}))
    print("Removed nodes:", ", ".join(removed))


def refresh_cluster(ips: Sequence[str]) -> None:
    if ips:
        nodes = cluster_from_ips(ips)
    else:
        nodes = load_cluster_state()
    save_cluster_state(nodes)
    sync_inventory(nodes)
    apply_cluster(nodes)
    if nodes:
        print("Refreshed cluster with nodes:", ", ".join(node["ip"] for node in nodes))
    else:
        print("Refreshed cluster with no nodes configured.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cluster management helper.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    add_parser = subparsers.add_parser("add", help="Add nodes and refresh the cluster.")
    add_parser.add_argument("ips", nargs="+", help="IP addresses to add.")
    remove_parser = subparsers.add_parser("remove", help="Remove nodes and refresh the cluster.")
    remove_parser.add_argument("ips", nargs="+", help="IP addresses to remove.")
    refresh_parser = subparsers.add_parser("refresh", help="Refresh the cluster state.")
    refresh_parser.add_argument("ips", nargs="*", help="Optional IP addresses to set before refresh.")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "add":
            add_nodes(args.ips)
        elif args.command == "remove":
            remove_nodes(args.ips)
        elif args.command == "refresh":
            refresh_cluster(args.ips)
        else:
            parser.print_help()
    except subprocess.CalledProcessError as exc:
        print(f"Ansible playbook failed with exit code {exc.returncode}.", file=sys.stderr)
        sys.exit(exc.returncode)


if __name__ == "__main__":
    main()
