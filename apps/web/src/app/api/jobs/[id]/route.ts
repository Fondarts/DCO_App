import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createReadStream, existsSync } from "fs";
import { Readable } from "stream";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "true";

  const job = await prisma.renderJob.findFirst({
    where: {
      id,
      variant: {
        template: { organizationId: session.user.organizationId },
      },
    },
    include: {
      variant: { include: { template: { select: { name: true } } } },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If download requested, stream the file
  if (download && job.outputPath && existsSync(job.outputPath)) {
    const stream = createReadStream(job.outputPath);
    const webStream = Readable.toWeb(stream) as ReadableStream;
    const filename = `${job.variant.name}.mp4`;

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json(job);
}
