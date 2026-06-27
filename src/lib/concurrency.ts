export async function processBoundedQueue<T, R>(
  items: T[],
  workerCount: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const safeWorkerCount = Math.max(1, Math.min(Math.floor(workerCount || 1), items.length || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: safeWorkerCount }, runWorker));
  return results;
}
