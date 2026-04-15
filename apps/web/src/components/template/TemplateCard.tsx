"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TemplateCardProps {
  id: string;
  name: string;
  description?: string | null;
  thumbnailPath?: string | null;
  status: string;
  variantCount: number;
  isAdmin: boolean;
}

export function TemplateCard({
  id,
  name,
  description,
  thumbnailPath,
  status,
  variantCount,
  isAdmin,
}: TemplateCardProps) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete template");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to delete template");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 relative group">
      <div className="aspect-video bg-gray-800 rounded mb-3 flex items-center justify-center text-gray-600 text-sm overflow-hidden">
        {thumbnailPath ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/templates/${id}/thumbnail`}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          "No preview"
        )}
      </div>
      <h3 className="font-semibold">{name}</h3>
      {description && (
        <p className="text-sm text-gray-400 mt-1">{description}</p>
      )}
      <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
        <span>{variantCount} variants</span>
        <span
          className={`px-2 py-1 rounded ${
            status === "PUBLISHED"
              ? "bg-green-900/50 text-green-400"
              : "bg-gray-700 text-gray-400"
          }`}
        >
          {status}
        </span>
      </div>

      {isAdmin && !confirmDelete && (
        <button
          onClick={() => setConfirmDelete(true)}
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded bg-gray-800 hover:bg-red-900/80 text-gray-400 hover:text-red-400"
          title="Delete template"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      )}

      {confirmDelete && (
        <div className="absolute inset-0 bg-gray-900/95 rounded-lg flex flex-col items-center justify-center gap-3 p-5">
          <p className="text-sm text-gray-300 text-center">
            Delete <strong>{name}</strong>?
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-800 rounded text-sm font-medium transition-colors"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
