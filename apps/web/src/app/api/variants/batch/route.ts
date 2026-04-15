import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface BatchVariantInput {
  id?: string;
  name: string;
  fieldValues: Record<string, unknown>;
  outputVariantId?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { campaignId, templateId, variants } = body as {
    campaignId: string;
    templateId: string;
    variants: BatchVariantInput[];
  };

  if (!campaignId || !templateId || !Array.isArray(variants) || variants.length === 0) {
    return NextResponse.json(
      { error: "campaignId, templateId, and variants array are required" },
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

  const results: unknown[] = [];
  const errors: Array<{ index: number; message: string }> = [];

  // Process each variant in a transaction
  const operations = variants.map((v, index) =>
    prisma.variant.upsert({
      where: { id: v.id || "" },
      create: {
        name: v.name,
        templateId,
        campaignId,
        fieldValues: JSON.stringify(v.fieldValues || {}),
        outputVariantId: v.outputVariantId || null,
      },
      update: {
        name: v.name,
        fieldValues: JSON.stringify(v.fieldValues || {}),
        outputVariantId: v.outputVariantId || null,
      },
    }).then((result) => {
      results[index] = result;
    }).catch((err: Error) => {
      errors.push({ index, message: err.message });
    })
  );

  await Promise.all(operations);

  return NextResponse.json({ variants: results.filter(Boolean), errors }, { status: 200 });
}
