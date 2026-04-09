import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;

  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      templates: { include: { template: true } },
      variants: {
        include: {
          template: { select: { name: true } },
          renderJobs: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!campaign) notFound();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/campaigns" className="text-sm text-gray-500 hover:text-gray-300">
            &larr; Campaigns
          </Link>
          <h2 className="text-2xl font-bold mt-1">{campaign.name}</h2>
        </div>
      </div>

      {/* Templates in this campaign */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3">Templates</h3>
        <div className="flex gap-3 flex-wrap">
          {campaign.templates.map((ct) => (
            <div
              key={ct.id}
              className="bg-gray-900 border border-gray-800 rounded px-4 py-3"
            >
              <p className="font-medium">{ct.template.name}</p>
              <Link
                href={`/campaigns/${campaign.id}/variants/new?templateId=${ct.templateId}`}
                className="text-sm text-blue-400 hover:text-blue-300 mt-1 inline-block"
              >
                + New Variant
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Variants grid */}
      <h3 className="text-lg font-semibold mb-3">
        Variants ({campaign.variants.length})
      </h3>
      {campaign.variants.length === 0 ? (
        <p className="text-gray-500">
          No variants yet. Create one from a template above.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaign.variants.map((variant) => {
            const lastJob = variant.renderJobs[0];
            return (
              <Link
                key={variant.id}
                href={`/campaigns/${campaign.id}/variants/${variant.id}`}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
              >
                <h4 className="font-medium">{variant.name}</h4>
                <p className="text-sm text-gray-500 mt-1">
                  {variant.template.name}
                </p>
                {lastJob && (
                  <div className="mt-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        lastJob.status === "COMPLETED"
                          ? "bg-green-900/50 text-green-400"
                          : lastJob.status === "FAILED"
                            ? "bg-red-900/50 text-red-400"
                            : lastJob.status === "RENDERING" || lastJob.status === "ENCODING"
                              ? "bg-blue-900/50 text-blue-400"
                              : "bg-gray-700 text-gray-400"
                      }`}
                    >
                      {lastJob.status}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
