import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: session.user.organizationId },
    include: {
      templates: { include: { template: { select: { name: true } } } },
      _count: { select: { variants: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(campaigns);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, templateIds } = await req.json();

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      organizationId: session.user.organizationId,
      templates: templateIds?.length
        ? {
            create: templateIds.map((templateId: string) => ({
              templateId,
            })),
          }
        : undefined,
    },
    include: { templates: true },
  });

  return NextResponse.json(campaign, { status: 201 });
}
