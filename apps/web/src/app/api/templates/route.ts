import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTemplateAepPath } from "@/lib/storage";
import { writeFile } from "fs/promises";
import type { TemplateManifest } from "@dco/shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.template.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const name = formData.get("name") as string;
  const description = formData.get("description") as string | null;
  const manifestJson = formData.get("manifest") as string;
  const aepFile = formData.get("aepFile") as File | null;
  const thumbnail = formData.get("thumbnail") as File | null;

  if (!name || !manifestJson || !aepFile) {
    return NextResponse.json(
      { error: "name, manifest, and aepFile are required" },
      { status: 400 }
    );
  }

  let manifest: TemplateManifest;
  try {
    manifest = JSON.parse(manifestJson);
  } catch {
    return NextResponse.json({ error: "Invalid manifest JSON" }, { status: 400 });
  }

  const template = await prisma.template.create({
    data: {
      name,
      description,
      organizationId: session.user.organizationId,
      aepFilePath: "", // will update after saving file
      manifest: JSON.stringify(manifest),
      status: "PUBLISHED",
    },
  });

  // Save AEP file
  const aepPath = getTemplateAepPath(
    session.user.organizationId,
    template.id,
    aepFile.name
  );
  const aepBuffer = Buffer.from(await aepFile.arrayBuffer());
  await writeFile(aepPath, aepBuffer);

  // Save thumbnail if provided
  let thumbnailPath: string | null = null;
  if (thumbnail) {
    thumbnailPath = getTemplateAepPath(
      session.user.organizationId,
      template.id,
      `thumbnail${thumbnail.name.substring(thumbnail.name.lastIndexOf("."))}`
    );
    const thumbBuffer = Buffer.from(await thumbnail.arrayBuffer());
    await writeFile(thumbnailPath, thumbBuffer);
  }

  // Update with file paths
  const updated = await prisma.template.update({
    where: { id: template.id },
    data: { aepFilePath: aepPath, thumbnailPath },
  });

  return NextResponse.json(updated, { status: 201 });
}
