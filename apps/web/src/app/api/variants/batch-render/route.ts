import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRenderQueue } from "@/lib/queue";
import { parseManifest, parseFieldValues } from "@/lib/json";
import type { RenderJobPayload } from "@dco/shared";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { variantIds } = body as { variantIds: string[] };

  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    return NextResponse.json(
      { error: "variantIds array is required" },
      { status: 400 }
    );
  }

  // Fetch all variants with their templates
  const variants = await prisma.variant.findMany({
    where: {
      id: { in: variantIds },
      template: { organizationId: session.user.organizationId },
    },
    include: { template: true },
  });

  if (variants.length === 0) {
    return NextResponse.json({ error: "No variants found" }, { status: 404 });
  }

  const results: Array<{ variantId: string; jobId: string; status: string }> = [];
  const errors: Array<{ variantId: string; message: string }> = [];

  for (const variant of variants) {
    try {
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
        templateFilePath: variant.template.templateFilePath,
        manifest,
        fieldValues: parseFieldValues(variant.fieldValues),
        outputVariantId: variant.outputVariantId ?? undefined,
      };

      // Try to add to queue
      try {
        await getRenderQueue().add("render-variant", payload, {
          jobId: renderJob.id,
        });
        await prisma.renderJob.update({
          where: { id: renderJob.id },
          data: { status: "QUEUED" },
        });
        results.push({ variantId: variant.id, jobId: renderJob.id, status: "QUEUED" });
      } catch {
        // Redis not available - job stays as PENDING
        results.push({ variantId: variant.id, jobId: renderJob.id, status: "PENDING" });
      }
    } catch (err) {
      errors.push({ variantId: variant.id, message: (err as Error).message });
    }
  }

  return NextResponse.json({ results, errors }, { status: 200 });
}
