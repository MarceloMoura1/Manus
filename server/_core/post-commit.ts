export async function runPostCommitBestEffort(tasks: ReadonlyArray<() => void | Promise<void>>, log: (message: string) => void = console.warn): Promise<void> {
  for (const task of tasks) {
    try {
      await task();
    } catch {
      log("[MegaDesk] Efeito auxiliar pós-commit falhou; o resultado persistido permanece confirmado.");
    }
  }
}
