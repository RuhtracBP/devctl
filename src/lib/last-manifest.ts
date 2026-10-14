const STORAGE_KEY = "devctl-last-manifest-path";

/** Última pasta/arquivo de `dev-app.toml` aberto com sucesso — só uma
 * preferência de UI, fica salva no localStorage do próprio app (não
 * precisa ir pro backend). */
export function readLastManifestPath(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastManifestPath(path: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, path);
  } catch {
    // localStorage indisponível (ex. modo privado) — não é crítico, só
    // significa que o próximo start não vai lembrar o caminho.
  }
}
