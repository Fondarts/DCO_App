import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, templateId, campaignId, fieldValues, outputVariantId } = body;

  if (!name || !templateId || !campaignId) {
    return NextResponse.json(
      { error: "name, templateId, and campaignId are required" },
      { status: 400 }
    );
  }

  // Verify template and campaign belong to user's org
  const [template, campaign] = await Promise.all([
    prisma.template.findFirst({
      where: { id: templateId, organizationId: session.user.organizationId },
    }),
    prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: session.user.organizationId },
    }),
  ]);

  if (!template || !campaign) {
    return NextResponse.json(
      { error: "Template or campaign not found" },
      { status: 404 }
    );
  }

  const variant = await prisma.variant.create({
    data: {
      name,
      templateId,
      campaignId,
      fieldValues: JSON.stringify(fieldValues || {}),
      outputVariantId,
    },
  });

  return NextResponse.json(variant, { status: 201 });
}
