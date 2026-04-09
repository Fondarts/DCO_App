import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseManifest, parseFieldValues } from "@/lib/json";
import { renderVideo } from "@/lib/aerender";
import { createReadStream, existsSync } from "fs";
import { Readable } from "stream";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: variantId } = await params;

  const variant = await prisma.variant.findFirst({
    where: {
      id: variantId,
      template: { organizationId: session.user.organizationId },
    },
    include: { template: true },
  });

  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  const manifest = parseManifest(variant.template.manifest);
  const fieldValues = parseFieldValues(variant.fieldValues);

  // Create render job
  const renderJob = await prisma.renderJob.create({
    data: {
      variantId: variant.id,
      submittedById: session.user.id,
      status: "RENDERING",
      startedAt: new Date(),
    },
  });

  try {
    const outputPath = await renderVideo(
      {
        aepFilePath: variant.template.aepFilePath,
        manifest,
        fieldValues,
        outputVariantId: variant.outputVariantId ?? undefined,
        orgId: session.user.organizationId,
      },
      renderJob.id
    );

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: {
        status: "COMPLETED",
        progress: 100,
        outputPath,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, jobId: renderJob.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Export failed";
    console.error("[Export Error]", msg);

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "FAILED", errorMessage: msg },
    });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(
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
    include: { variant: true },
  });

  if (!job?.outputPath || !existsSync(job.outputPath)) {
    return NextResponse.json({ error: "No export available" }, { status: 404 });
  }

  const stream = createReadStream(job.outputPath);
  const webStream = Readable.toWeb(stream) as ReadableStream;
  const filename = `${job.variant.name.replace(/[^a-zA-Z0-9-_ ]/g, "")}.mp4`;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
