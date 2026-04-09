import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { parseManifest } from "@/lib/json";
import { VariantEditor } from "@/components/variant/VariantEditor";

export default async function NewVariantPage({
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

  return (
    <VariantEditor
      mode="create"
      campaignId={campaignId}
      campaignName={campaign.name}
      templateId={templateId}
      templateName={template.name}
      manifest={manifest}
      initialFieldValues={{}}
    />
  );
}
