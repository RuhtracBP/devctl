// Espelho em TypeScript de `src-tauri/src/manifest.rs`. Mantenha em sincronia
// manualmente por enquanto — gerar isso automaticamente (ts-rs / specta) é
// um próximo passo natural quando o schema estabilizar.

export type Mode = "instant" | "stream" | "interactive" | "toggle";
export type ParamKind = "string" | "enum";

export interface Toggle {
  run_arg: string;
  start_arg: string;
  stop_arg: string;
  status_arg: string;
}

export interface Param {
  name: string;
  label: string;
  // serde renomeia `kind` (Rust) -> `type` (JSON), ver manifest.rs
  type: ParamKind;
  options: string[];
  required: boolean;
  default?: string | null;
  split_shell_words: boolean;
}

export interface Action {
  id: string;
  label: string;
  category: string;
  script: string;
  mode: Mode;
  params: Param[];
  confirm: boolean;
  confirm_message?: string | null;
  long_running: boolean;
  status_check: boolean;
  toggle?: Toggle | null;
  notes?: string | null;
}

export interface AppMeta {
  name: string;
  description?: string | null;
  scripts_root?: string | null;
}

export interface Manifest {
  app: AppMeta;
  actions: Action[];
}

// Espelho de `src-tauri/src/runner.rs` — runner de execução das actions.

export type ToggleMode = "run" | "start" | "stop" | "status";

export interface RunActionInput {
  project_root: string;
  action: Action;
  param_values: Record<string, string>;
  toggle_mode?: ToggleMode | null;
}

export interface OutputEvent {
  run_id: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface ExitEvent {
  run_id: string;
  code: number | null;
  success: boolean;
}

// Espelho de `src-tauri/src/pty.rs` — terminal embutido (mode="interactive").

export interface StartInteractiveInput {
  project_root: string;
  action: Action;
  param_values: Record<string, string>;
}

export interface PtyOutputEvent {
  run_id: string;
  data_base64: string;
}

export interface PtyExitEvent {
  run_id: string;
}
