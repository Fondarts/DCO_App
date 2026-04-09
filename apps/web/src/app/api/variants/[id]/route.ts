import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const variant = await prisma.variant.findFirst({
    where: {
      id,
      template: { organizationId: session.user.organizationId },
    },
    include: {
      template: true,
      campaign: true,
      renderJobs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!variant) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(variant);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  // Verify ownership
  const existing = await prisma.variant.findFirst({
    where: {
      id,
      template: { organizationId: session.user.organizationId },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const variant = await prisma.variant.update({
    where: { id },
    data: {
      name: body.name ?? existing.name,
      fieldValues: body.fieldValues ? JSON.stringify(body.fieldValues) : existing.fieldValues,
      outputVariantId: body.outputVariantId ?? existing.outputVariantId,
    },
  });

  return NextResponse.json(variant);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.variant.findFirst({
    where: {
      id,
      template: { organizationId: session.user.organizationId },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.variant.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
