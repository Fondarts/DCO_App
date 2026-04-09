import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.renderJob.findMany({
    where: {
      variant: {
        template: { organizationId: session.user.organizationId },
      },
    },
    include: {
      variant: {
        include: { template: { select: { name: true } } },
      },
      submittedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(jobs);
}
