/** Project-owned syntax fixture. Analysis must not execute this module. */
export function collectBatches(items: string[], limit: number): string[][] {
  // Накопитель 🧩: Unicode stays in the original bytes.
  const batches: string[][] = [];
  let pending: string[] = [];
  let batchNumber = 0;

  function flush(): void {
    if (pending.length > 0) {
      batches.push(pending);
      pending = [];
      batchNumber += 1;
    }
  }

  for (const item of items) {
    pending.push(item);
    if (pending.length >= limit) {
      flush();
    }
  }
  flush();
  return batches;
}
