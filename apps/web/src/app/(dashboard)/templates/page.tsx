import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TemplateUploader } from "@/components/template/TemplateUploader";
import { TemplateCard } from "@/components/template/TemplateCard";

export default async function TemplatesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const isAdmin =
    (session.user as Record<string, unknown>).role === "ADMIN" ||
    (session.user as Record<string, unknown>).role === "DESIGNER";

  const templates = await prisma.template.findMany({
    where: {
      organizationId: session.user.organizationId,
      status: { not: "ARCHIVED" },
    },
    include: { _count: { select: { variants: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Templates</h2>
      </div>

      {isAdmin && <TemplateUploader />}

      {templates.length === 0 ? (
        <p className="text-gray-500 mt-4">No templates yet. Upload one above.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              id={template.id}
              name={template.name}
              description={template.description}
              thumbnailPath={template.thumbnailPath}
              status={template.status}
              variantCount={template._count.variants}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
