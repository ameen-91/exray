export type WorkflowKind = "ctgan" | "llm" | "custom";

export type RunPhase =
  | "Pending"
  | "Submitted"
  | "Running"
  | "Succeeded"
  | "Failed"
  | "Error"
  | "Skipped"
  | "Unknown";

export interface RunStatus {
  phase?: RunPhase | string;
  startedAt?: string;
  finishedAt?: string;
  progress?: string;
  message?: string;
}

export interface RunRecord {
  run_id: string;
  workflow?: WorkflowKind | string;
  parameters?: Record<string, unknown>;
  argo_name?: string;
  namespace?: string;
  submitted_at?: string;
  status?: RunStatus;
  input_object?: string;
  result_object?: string;
  input_file_name?: string;
  original_filename?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RunListResponse {
  runs: RunRecord[];
}

export interface RunSubmitResponse extends RunRecord {}

export interface RunResultResponse {
  run_id: string;
  download_url: string;
}
