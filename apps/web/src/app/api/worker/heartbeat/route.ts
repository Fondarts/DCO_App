import { NextRequest, NextResponse } from "next/server";

// In-memory worker registry (resets on server restart)
interface WorkerInfo {
  workerId: string;
  hostname: string;
  status: "idle" | "rendering";
  currentJobId: string | null;
  lastSeen: Date;
  aerenderPath?: string;
}

const workers = new Map<string, WorkerInfo>();

export async function PUT(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "");
  if (apiKey !== (process.env.WORKER_API_KEY || "worker-secret")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { workerId, hostname, status, currentJobId, aerenderPath } = body;

  if (!workerId) {
    return NextResponse.json({ error: "workerId required" }, { status: 400 });
  }

  workers.set(workerId, {
    workerId,
    hostname: hostname || "unknown",
    status: status || "idle",
    currentJobId: currentJobId || null,
    lastSeen: new Date(),
    aerenderPath,
  });

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "");
  const session = req.headers.get("cookie"); // Allow both API key and session
  if (!apiKey && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Clean stale workers (not seen in 2 minutes)
  const cutoff = Date.now() - 120_000;
  for (const [id, info] of workers) {
    if (info.lastSeen.getTime() < cutoff) workers.delete(id);
  }

  return NextResponse.json(Array.from(workers.values()));
}
