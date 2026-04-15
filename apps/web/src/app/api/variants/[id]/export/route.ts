import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseManifest, parseFieldValues } from "@/lib/json";
import { dispatchRender } from "@/lib/render-mode";
import type { RenderJobPayload } from "@dco/shared";
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

  // Create render job record
  const renderJob = await prisma.renderJob.create({
    data: {
      variantId: variant.id,
      submittedById: session.user.id,
      status: "PENDING",
    },
  });

  const payload: RenderJobPayload = {
    jobId: renderJob.id,
    variantId: variant.id,
    templateId: variant.template.id,
    templateFilePath: variant.template.templateFilePath,
    manifest,
    fieldValues,
    outputVariantId: variant.outputVariantId ?? undefined,
  };

  const renderOptions = {
    templateFilePath: variant.template.templateFilePath,
    manifest,
    fieldValues,
    outputVariantId: variant.outputVariantId ?? undefined,
    orgId: session.user.organizationId,
  };

  try {
    const result = await dispatchRender(renderJob.id, payload, renderOptions);

    if (result.mode === "queued") {
      // Async: client should poll for status
      return NextResponse.json({ jobId: renderJob.id, status: "QUEUED" }, { status: 202 });
    }

    // Synchronous local render completed
    return NextResponse.json({ jobId: renderJob.id, status: "COMPLETED", success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Export failed";
    console.error("[Export Error]", msg);
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
