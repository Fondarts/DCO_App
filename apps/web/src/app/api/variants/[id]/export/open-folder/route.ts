import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { existsSync } from "fs";
import { exec } from "child_process";
import path from "path";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: variantId } = await params;

  const job = await prisma.renderJob.findFirst({
    where: {
      variantId,
      status: "COMPLETED",
      outputPath: { not: null },
      variant: { template: { organizationId: session.user.organizationId } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!job?.outputPath || !existsSync(job.outputPath)) {
    return NextResponse.json({ error: "No export available" }, { status: 404 });
  }

  const folder = path.dirname(path.resolve(job.outputPath));
  exec(`explorer.exe "${folder.replace(/\//g, "\\")}"`);

  return NextResponse.json({ success: true, folder });
}
