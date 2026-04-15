import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { CreateCampaignButton } from "./create-campaign-button";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: session.user.organizationId },
    include: {
      templates: { include: { template: { select: { name: true } } } },
      _count: { select: { variants: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Campaigns</h2>
        <CreateCampaignButton />
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No campaigns yet.</p>
          <p className="text-sm mt-1">Create your first campaign to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.id}`}
              className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors"
            >
              <h3 className="font-semibold text-lg">{campaign.name}</h3>
              <div className="mt-3 flex gap-4 text-sm text-gray-400">
                <span>{campaign._count.variants} variants</span>
                <span>
                  {campaign.templates.map((ct) => ct.template.name).join(", ") || "No templates"}
                </span>
              </div>
              <div className="mt-2">
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    campaign.status === "ACTIVE"
                      ? "bg-green-900/50 text-green-400"
                      : "bg-gray-700 text-gray-400"
                  }`}
                >
                  {campaign.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
