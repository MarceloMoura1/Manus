export function createBootstrapCleanupGate(cleanup: () => Promise<void>) {
  let bootstrapComplete = false;

  return {
    async run(bootstrap: () => Promise<void>): Promise<void> {
      await bootstrap();
      bootstrapComplete = true;
    },
    async clean(): Promise<void> {
      if (!bootstrapComplete) return;
      await cleanup();
    },
  };
}
