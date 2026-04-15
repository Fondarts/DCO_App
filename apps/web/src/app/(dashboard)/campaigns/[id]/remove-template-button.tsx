"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RemoveTemplateButton({
  campaignId,
  templateId,
}: {
  campaignId: string;
  templateId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRemove() {
    if (!confirm("Remove this template from the campaign?")) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/templates/${templateId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleRemove}
      disabled={loading}
      className="absolute top-2 right-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
      title="Remove from campaign"
    >
      {loading ? "..." : "\u00d7"}
    </button>
  );
}
