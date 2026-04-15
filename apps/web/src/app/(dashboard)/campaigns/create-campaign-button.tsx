"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateCampaignButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        const campaign = await res.json();
        setName("");
        setOpen(false);
        router.push(`/campaigns/${campaign.id}`);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded"
      >
        + New Campaign
      </button>
    );
  }

  return (
    <form onSubmit={handleCreate} className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Campaign name..."
        className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
      />
      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
      >
        {loading ? "Creating..." : "Create"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setName(""); }}
        className="text-gray-500 hover:text-gray-300 text-sm px-2 py-2"
      >
        Cancel
      </button>
    </form>
  );
}
