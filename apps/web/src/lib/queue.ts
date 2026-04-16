import { Queue } from "bullmq";
import IORedis from "ioredis";

let _queue: Queue | null = null;
let _redisOk: boolean | null = null;

function getConnection() {
  return new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

/**
 * Check if Redis is available and version >= 6.2 (required by BullMQ 5.x).
 * Caches the result so we only check once.
 */
export async function isQueueAvailable(): Promise<boolean> {
  if (_redisOk !== null) return _redisOk;
  try {
    const conn = getConnection();
    await conn.connect();
    const info = await conn.info("server");
    const match = info.match(/redis_version:(\d+)\.(\d+)/);
    await conn.disconnect();
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      _redisOk = major > 6 || (major === 6 && minor >= 2);
      if (!_redisOk) {
        console.warn(`[queue] Redis ${match[1]}.${match[2]} detected — BullMQ requires 6.2+. Using local render.`);
      }
    } else {
      _redisOk = false;
    }
  } catch {
    _redisOk = false;
  }
  return _redisOk;
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
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 5 },
      },
    });
  }
  return _queue;
}
