import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { parseManifest, parseFieldValues } from "@/lib/json";
import { BulkEditor } from "@/components/variant/BulkEditor";

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ templateId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { id: campaignId } = await params;
  const { templateId } = await searchParams;

  if (!templateId) notFound();

  const [campaign, template] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: session.user.organizationId },
    }),
    prisma.template.findFirst({
      where: { id: templateId, organizationId: session.user.organizationId },
    }),
  ]);

  if (!campaign || !template) notFound();

  const manifest = parseManifest(template.manifest);

  // Fetch existing variants for this campaign + template
  const variants = await prisma.variant.findMany({
    where: { campaignId, templateId },
    include: {
      renderJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const initialVariants = variants.map((v) => ({
    id: v.id,
    name: v.name,
    fieldValues: parseFieldValues(v.fieldValues),
    outputVariantId: v.outputVariantId,
    renderJobStatus: v.renderJobs[0]?.status,
    renderJobId: v.renderJobs[0]?.id,
  }));

  return (
    <BulkEditor
      manifest={manifest}
      initialVariants={initialVariants}
      campaignId={campaignId}
      campaignName={campaign.name}
      templateId={templateId}
      templateName={template.name}
    />
  );
}
