import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createReadStream, existsSync } from "fs";
import { Readable } from "stream";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const template = await prisma.template.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { thumbnailPath: true },
  });

  if (!template?.thumbnailPath || !existsSync(template.thumbnailPath)) {
    return NextResponse.json({ error: "No thumbnail" }, { status: 404 });
  }

  const ext = template.thumbnailPath.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };

  const stream = createReadStream(template.thumbnailPath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": mimeTypes[ext || ""] || "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
