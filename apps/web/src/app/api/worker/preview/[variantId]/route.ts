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

  // Store in DB for cross-server access (Vercel reads from DB)
  try {
    await prisma.variant.update({
      where: { id: variantId },
      data: { previewData: imageBase64 },
    });
  } catch (dbErr) {
    console.error("[preview] DB save failed:", dbErr);
    // Retry once after a short delay (Neon cold start)
    try {
      await new Promise((r) => setTimeout(r, 1000));
      await prisma.variant.update({
        where: { id: variantId },
        data: { previewData: imageBase64 },
      });
    } catch (retryErr) {
      console.error("[preview] DB retry failed:", retryErr);
      return NextResponse.json({ error: "DB save failed" }, { status: 500 });
    }
  }

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
