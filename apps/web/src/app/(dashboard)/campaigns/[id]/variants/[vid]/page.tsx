import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { parseManifest, parseFieldValues } from "@/lib/json";
import { VariantEditor } from "@/components/variant/VariantEditor";

export default async function EditVariantPage({
  params,
}: {
  params: Promise<{ id: string; vid: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { id: campaignId, vid: variantId } = await params;

  const variant = await prisma.variant.findFirst({
    where: {
      id: variantId,
      campaignId,
      template: { organizationId: session.user.organizationId },
    },
    include: {
      template: true,
      campaign: true,
      renderJobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  if (!variant) notFound();

  const manifest = parseManifest(variant.template.manifest);

  return (
    <VariantEditor
      mode="edit"
      variantId={variant.id}
      variantName={variant.name}
      campaignId={campaignId}
      campaignName={variant.campaign.name}
      templateId={variant.templateId}
      templateName={variant.template.name}
      manifest={manifest}
      initialFieldValues={parseFieldValues(variant.fieldValues)}
      outputVariantId={variant.outputVariantId}
      renderJobs={variant.renderJobs.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      }))}
    />
  );
}
