"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ManifestBuilder } from "./ManifestBuilder";
import type { TemplateManifest } from "@dco/shared";

export function TemplateUploader() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [aepFile, setAepFile] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !aepFile || !manifest) {
      setError("Name, AEP file, and at least one editable field are required");
      return;
    }
    if (manifest.fields.length === 0) {
      setError("Add at least one editable field");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const finalManifest: TemplateManifest = { ...manifest, name };

      const formData = new FormData();
      formData.append("name", name);
      formData.append("description", description);
      formData.append("manifest", JSON.stringify(finalManifest));
      formData.append("aepFile", aepFile);
      if (thumbnail) formData.append("thumbnail", thumbnail);

      const res = await fetch("/api/templates", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      setOpen(false);
      setName("");
      setDescription("");
      setAepFile(null);
      setThumbnail(null);
      setManifest(null);
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
            placeholder="Brief description of the template"
          />
        </div>
      </div>

      {/* Files */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            AEP File (.aep)
          </label>
          <input
            type="file"
            accept=".aep,.aepx"
            onChange={(e) => setAepFile(e.target.files?.[0] || null)}
            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700"
            required
          />
        </div>
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
      </div>

      <hr className="border-gray-800" />

      {/* Manifest builder */}
      <ManifestBuilder onChange={setManifest} />

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
