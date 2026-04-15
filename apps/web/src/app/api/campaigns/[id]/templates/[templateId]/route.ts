import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, templateId } = await params;

  // Verify campaign belongs to user's org
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deleted = await prisma.campaignTemplate.deleteMany({
    where: { campaignId: id, templateId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Template not in campaign" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
