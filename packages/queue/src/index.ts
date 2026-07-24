/** Lightweight in-memory fan-out helpers until Redis/BullMQ is wired. */

export type JobHandler<T> = (payload: T) => Promise<void>;

export function createMemoryQueue<T>(name: string) {
  const handlers: JobHandler<T>[] = [];
  let processing = Promise.resolve();

  return {
    name,
    subscribe(handler: JobHandler<T>) {
      handlers.push(handler);
    },
    async publish(payload: T) {
      processing = processing.then(async () => {
        for (const handler of handlers) {
          await handler(payload);
        }
      });
      await processing;
    },
  };
}
