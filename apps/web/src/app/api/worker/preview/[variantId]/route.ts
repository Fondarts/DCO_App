import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// In-memory preview cache (serverless-friendly for short-lived previews)
// In production with multiple instances, use Redis or DB blob storage
const previewCache = new Map<string, Buffer>();

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "");
  if (apiKey !== (process.env.WORKER_API_KEY || "worker-secret")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { variantId } = await params;
  const { imageBase64 } = await req.json();

  if (!imageBase64) {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }

  const buffer = Buffer.from(imageBase64, "base64");
  previewCache.set(variantId, buffer);

  // Also store in variant record for persistence
  await prisma.variant.update({
    where: { id: variantId },
    data: { previewData: imageBase64 },
  }).catch(() => {});

  return NextResponse.json({ ok: true, size: buffer.length });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const { variantId } = await params;

  // Check in-memory cache first
  let buffer = previewCache.get(variantId);

  // Fall back to DB
  if (!buffer) {
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: { previewData: true },
    });
    if (variant?.previewData) {
      buffer = Buffer.from(variant.previewData, "base64");
      previewCache.set(variantId, buffer); // Re-cache
    }
  }

  if (!buffer) {
    return NextResponse.json({ error: "No preview" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache",
    },
  });
}
