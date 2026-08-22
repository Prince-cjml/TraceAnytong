/** Service credential for external workers. Rotate through Convex environment configuration. */
export function requireWorker(workerToken: string): void {
  if (!process.env.WORKER_TOKEN || workerToken !== process.env.WORKER_TOKEN) throw new Error("UNAUTHORIZED_WORKER");
}
