import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TemplateUploader } from "@/components/template/TemplateUploader";

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
            <div
              key={template.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-5"
            >
              <div className="aspect-video bg-gray-800 rounded mb-3 flex items-center justify-center text-gray-600 text-sm">
                {template.thumbnailPath ? "Thumbnail" : "No preview"}
              </div>
              <h3 className="font-semibold">{template.name}</h3>
              {template.description && (
                <p className="text-sm text-gray-400 mt-1">{template.description}</p>
              )}
              <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                <span>{template._count.variants} variants</span>
                <span
                  className={`px-2 py-1 rounded ${
                    template.status === "PUBLISHED"
                      ? "bg-green-900/50 text-green-400"
                      : "bg-gray-700 text-gray-400"
                  }`}
                >
                  {template.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
