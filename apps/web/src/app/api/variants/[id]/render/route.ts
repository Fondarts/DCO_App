import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRenderQueue } from "@/lib/queue";
import { parseManifest, parseFieldValues } from "@/lib/json";
import type { RenderJobPayload } from "@dco/shared";

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

  // Create render job record
  const renderJob = await prisma.renderJob.create({
    data: {
      variantId: variant.id,
      submittedById: session.user.id,
      status: "PENDING",
    },
  });

  // Build job payload
  const manifest = parseManifest(variant.template.manifest);
  const payload: RenderJobPayload = {
    jobId: renderJob.id,
    variantId: variant.id,
    templateId: variant.template.id,
    aepFilePath: variant.template.aepFilePath,
    manifest,
    fieldValues: parseFieldValues(variant.fieldValues),
    outputVariantId: variant.outputVariantId ?? undefined,
  };

  // Try to add to queue (Redis may not be available)
  try {
    await getRenderQueue().add("render-variant", payload, {
      jobId: renderJob.id,
    });
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "QUEUED" },
    });
  } catch {
    // Redis not available - job stays as PENDING
    console.warn("Redis not available, render job saved as PENDING");
  }

  return NextResponse.json(renderJob, { status: 201 });
}
