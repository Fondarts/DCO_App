import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAssetPath } from "@/lib/storage";
import { writeFile } from "fs/promises";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  // Create asset record first to get ID
  const asset = await prisma.asset.create({
    data: {
      originalName: file.name,
      storagePath: "", // will update
      mimeType: file.type,
      size: file.size,
      uploadedById: session.user.id,
    },
  });

  // Save file
  const ext = file.name.substring(file.name.lastIndexOf("."));
  const storagePath = getAssetPath(
    session.user.organizationId,
    asset.id,
    `${asset.id}${ext}`
  );
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(storagePath, buffer);

  // Update with path
  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: { storagePath },
  });

  return NextResponse.json(updated, { status: 201 });
}
