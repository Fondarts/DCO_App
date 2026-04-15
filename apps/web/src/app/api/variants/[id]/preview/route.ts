import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseManifest, parseFieldValues } from "@/lib/json";
import { renderPreview } from "@/lib/aerender";
import { getPreviewOutputPath } from "@/lib/storage";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

export async function POST(
  req: NextRequest,
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

  let fieldValues = parseFieldValues(variant.fieldValues);
  try {
    const body = await req.json();
    if (body.fieldValues) {
      fieldValues = { ...fieldValues, ...body.fieldValues };
    }
  } catch {
    // No body — use saved values
  }

  const manifest = parseManifest(variant.template.manifest);

  try {
    const previewPath = await renderPreview(
      {
        templateFilePath: variant.template.templateFilePath,
        manifest,
        fieldValues,
        outputVariantId: variant.outputVariantId ?? undefined,
        orgId: session.user.organizationId,
      },
      variantId
    );

    const pngBuffer = await readFile(previewPath);

    return new NextResponse(pngBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Preview failed";
    console.error("[Preview Error]", msg);
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
  const cachePath = getPreviewOutputPath(session.user.organizationId, variantId);

  if (!existsSync(cachePath)) {
    return NextResponse.json({ error: "No preview available" }, { status: 404 });
  }

  const pngBuffer = await readFile(cachePath);
  return new NextResponse(pngBuffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache",
    },
  });
}
