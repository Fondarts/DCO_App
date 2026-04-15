"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TemplateUploader() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const isMogrt = templateFile?.name.toLowerCase().endsWith(".mogrt");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !templateFile) {
      setError("Name and template file are required");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      formData.append("templateFile", templateFile);
      if (thumbnail) formData.append("thumbnail", thumbnail);

      const res = await fetch("/api/templates", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let msg = `Upload failed (${res.status})`;
        try {
          const data = await res.json();
          msg = data.error || msg;
        } catch {
          // Response wasn't JSON
        }
        throw new Error(msg);
      }

      setOpen(false);
      setName("");
      setDescription("");
      setTemplateFile(null);
      setThumbnail(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
      >
        + Upload Template
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Upload Template</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-gray-500 hover:text-gray-300"
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* Template file */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Template File
        </label>
        <input
          type="file"
          accept=".mogrt,.aep,.aepx"
          onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
          className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700"
          required
        />
        {templateFile && (
          <p className="text-xs mt-1 text-gray-500">
            {isMogrt ? (
              <span className="text-blue-400">MOGRT - fields will be auto-detected from Essential Graphics</span>
            ) : (
              <span className="text-yellow-400">AEP - use the CEP panel in After Effects to configure fields</span>
            )}
          </p>
        )}
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Product Ad 15s"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Brief description"
          />
        </div>
      </div>

      {/* Thumbnail */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Thumbnail (optional)
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setThumbnail(e.target.files?.[0] || null)}
          className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700"
        />
      </div>

      <button
        type="submit"
        disabled={uploading}
        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 rounded font-medium text-sm transition-colors"
      >
        {uploading ? "Uploading..." : "Upload Template"}
      </button>
    </form>
  );
}
