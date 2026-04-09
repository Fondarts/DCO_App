import { Queue } from "bullmq";
import IORedis from "ioredis";

let _queue: Queue | null = null;

function getConnection() {
  return new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

export function getRenderQueue(): Queue {
  if (!_queue) {
    _queue = new Queue("render", {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return _queue;
}
