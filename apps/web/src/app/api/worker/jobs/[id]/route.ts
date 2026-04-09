import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticate worker via API key
  const authHeader = req.headers.get("authorization");
  const expectedKey = process.env.WORKER_API_KEY || "worker-secret";

  if (authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.status) data.status = body.status;
  if (body.progress !== undefined) data.progress = body.progress;
  if (body.outputPath) data.outputPath = body.outputPath;
  if (body.errorMessage) data.errorMessage = body.errorMessage;
  if (body.startedAt) data.startedAt = new Date(body.startedAt);
  if (body.completedAt) data.completedAt = new Date(body.completedAt);

  const job = await prisma.renderJob.update({
    where: { id },
    data,
  });

  return NextResponse.json(job);
}
