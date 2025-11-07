import { RunListResponse, RunRecord, RunResultResponse, RunSubmitResponse } from "../types";

const JSON_HEADERS = {
  Accept: "application/json",
};

const DEFAULT_TIMEOUT = 10000;

async function fetchWithTimeout(url: string, options: RequestInit, timeout = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out - server may be slow or unavailable');
    }
    throw error;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function listRuns(refresh = false): Promise<RunRecord[]> {
  const params = refresh ? "?refresh=true" : "";
  const response = await fetchWithTimeout(`/runs${params}`, {
    method: "GET",
    headers: JSON_HEADERS,
  }, 20000);
  const payload = await handleResponse<RunListResponse>(response);
  return payload.runs ?? [];
}

export async function getRun(runId: string, refresh = true): Promise<RunRecord> {
  const params = refresh ? "?refresh=true" : "";
  const response = await fetchWithTimeout(`/runs/${runId}${params}`, {
    method: "GET",
    headers: JSON_HEADERS,
  });
  return handleResponse<RunRecord>(response);
}

export async function requestResultUrl(runId: string): Promise<RunResultResponse> {
  const response = await fetchWithTimeout(`/runs/${runId}/result`, {
    method: "GET",
    headers: JSON_HEADERS,
  }, 15000);
  return handleResponse<RunResultResponse>(response);
}

export async function fetchRunLogs(runId: string, tail = 200): Promise<string> {
  const response = await fetchWithTimeout(`/runs/${runId}/logs?tail=${tail}`, {
    method: "GET",
    headers: {
      Accept: "text/plain",
    },
  }, 15000);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to fetch logs (${response.status})`);
  }
  return response.text();
}

export interface CtganPayload {
  file: File;
  discrete_columns?: string;
  no_of_epochs?: number;
  no_of_samples?: number;
  cpu_limit?: string;
  memory_limit?: string;
}

export async function submitCtgan(data: CtganPayload): Promise<RunSubmitResponse> {
  const formData = new FormData();
  formData.append("file", data.file);
  formData.append("discrete_columns", data.discrete_columns ?? "");
  formData.append("no_of_epochs", String(data.no_of_epochs ?? 300));
  formData.append("no_of_samples", String(data.no_of_samples ?? 1000));
  if (data.cpu_limit) {
    formData.append("cpu_limit", data.cpu_limit);
  }
  if (data.memory_limit) {
    formData.append("memory_limit", data.memory_limit);
  }

  const response = await fetch("/runs/ctgan", {
    method: "POST",
    body: formData,
  });

  return handleResponse<RunSubmitResponse>(response);
}

export interface LlmPayload {
  file: File;
  labels: string;
  model: string;
  parallelism?: number;
  cpu_limit?: string;
  memory_limit?: string;
}

export async function submitLlm(data: LlmPayload): Promise<RunSubmitResponse> {
  const formData = new FormData();
  formData.append("file", data.file);
  formData.append("labels", data.labels);
  formData.append("model", data.model);
  formData.append("parallelism", String(data.parallelism ?? 1));
  if (data.cpu_limit) {
    formData.append("cpu_limit", data.cpu_limit);
  }
  if (data.memory_limit) {
    formData.append("memory_limit", data.memory_limit);
  }

  const response = await fetch("/runs/llm", {
    method: "POST",
    body: formData,
  });

  return handleResponse<RunSubmitResponse>(response);
}

export interface CustomPayload {
  data_file: File;
  python_file: File;
  function_name?: string;
  pip_packages?: string;
  cpu_limit?: string;
  memory_limit?: string;
}

export async function submitCustom(data: CustomPayload): Promise<RunSubmitResponse> {
  const formData = new FormData();
  formData.append("data_file", data.data_file);
  formData.append("python_file", data.python_file);
  formData.append("function_name", data.function_name ?? "process");
  formData.append("pip_packages", data.pip_packages ?? "");
  if (data.cpu_limit) {
    formData.append("cpu_limit", data.cpu_limit);
  }
  if (data.memory_limit) {
    formData.append("memory_limit", data.memory_limit);
  }

  const response = await fetch("/runs/custom", {
    method: "POST",
    body: formData,
  });

  return handleResponse<RunSubmitResponse>(response);
}
