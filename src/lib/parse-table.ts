export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Parser heurístico de saída de CLI em colunas alinhadas por espaço (ex.
 * `docker compose ps`). Não é conhecimento específico de Docker — só
 * texto com colunas separadas por 2+ espaços e uma linha de cabeçalho.
 * Retorna `null` quando o texto não parece tabular, pra quem chama cair
 * de volta pra mostrar o texto cru sem quebrar nada.
 */
export function parseAlignedTable(text: string): ParsedTable | null {
  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length < 1) return null;

  const splitRow = (line: string) => line.trim().split(/\s{2,}/);

  const headers = splitRow(lines[0]);
  if (headers.length < 2) return null; // não parece ter colunas

  const rows = lines.slice(1).map((line) => {
    const cols = splitRow(line);
    if (cols.length === headers.length) return cols;
    if (cols.length > headers.length) {
      // valor com espaço colou colunas extras — funde o excesso na última
      return [...cols.slice(0, headers.length - 1), cols.slice(headers.length - 1).join("  ")];
    }
    // faltou coluna (ex. PORTS vazio no fim da linha) — completa com ""
    return [...cols, ...Array(headers.length - cols.length).fill("")];
  });

  return { headers, rows };
}

/** Índice da primeira coluna cujo cabeçalho (case-insensitive) bate com algum candidato. */
export function findColumn(headers: string[], ...candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (const candidate of candidates) {
    const i = lower.indexOf(candidate);
    if (i !== -1) return i;
  }
  return -1;
}

export type StatusTone = "up" | "down" | "warn";

/** Classifica um texto de status de container em ok/parado/atenção, pra colorir. */
export function containerStatusTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (/^up\b|running|healthy/.test(s)) return "up";
  if (/exited|dead|down|stopped/.test(s)) return "down";
  return "warn"; // restarting, created, paused, unknown
}
