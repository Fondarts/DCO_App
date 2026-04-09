"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { TemplateManifest, FieldDefinition } from "@dco/shared";
import Link from "next/link";

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  createdAt: string;
  completedAt: string | null;
  outputPath: string | null;
}

interface VariantEditorProps {
  mode: "create" | "edit";
  variantId?: string;
  variantName?: string;
  campaignId: string;
  campaignName: string;
  templateId: string;
  templateName: string;
  manifest: TemplateManifest;
  initialFieldValues: Record<string, unknown>;
  outputVariantId?: string | null;
  renderJobs?: RenderJob[];
}

export function VariantEditor({
  mode,
  variantId,
  variantName,
  campaignId,
  campaignName,
  templateId,
  templateName,
  manifest,
  initialFieldValues,
  outputVariantId: initialOutputVariant,
  renderJobs,
}: VariantEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(variantName || "");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(initialFieldValues);
  const [outputVariantId, setOutputVariantId] = useState(initialOutputVariant || "");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  // Try to load cached preview on mount
  useEffect(() => {
    if (mode === "edit" && variantId) {
      fetch(`/api/variants/${variantId}/preview`)
        .then((res) => {
          if (res.ok) return res.blob();
          return null;
        })
        .then((blob) => {
          if (blob) setPreviewUrl(URL.createObjectURL(blob));
        })
        .catch(() => {});
    }
  }, [mode, variantId]);

  // Determine preview aspect ratio
  const selectedVariant = manifest.outputVariants.find((v) => v.id === outputVariantId);
  const previewWidth = selectedVariant?.width || manifest.width;
  const previewHeight = selectedVariant?.height || manifest.height;
  const aspectRatio = `${previewWidth} / ${previewHeight}`;

  function updateField(fieldId: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Variant name is required");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const url = mode === "create" ? "/api/variants" : `/api/variants/${variantId}`;
      const method = mode === "create" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          templateId,
          campaignId,
          fieldValues,
          outputVariantId: outputVariantId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const variant = await res.json();

      if (mode === "create") {
        router.push(`/campaigns/${campaignId}/variants/${variant.id}`);
      } else {
        setSuccess("Saved!");
        setTimeout(() => setSuccess(""), 2000);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleGeneratePreview() {
    if (mode === "create" || !variantId) {
      setError("Save the variant first");
      return;
    }

    setPreviewLoading(true);
    setPreviewError("");

    try {
      // Save current values first
      await fetch(`/api/variants/${variantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues, outputVariantId: outputVariantId || null }),
      });

      // Request preview render from AE
      const res = await fetch(`/api/variants/${variantId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Preview failed");
      }

      const blob = await res.blob();
      // Revoke old URL to prevent memory leak
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleExport() {
    if (mode === "create" || !variantId) {
      setError("Save the variant first");
      return;
    }

    setExporting(true);
    setError("");
    setSuccess("");

    try {
      // Save current values first
      await fetch(`/api/variants/${variantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues, outputVariantId: outputVariantId || null }),
      });

      // Export video via AE
      const res = await fetch(`/api/variants/${variantId}/export`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Export failed");
      }

      setSuccess("Export complete!");
      router.refresh();

      // Auto-download
      window.open(`/api/variants/${variantId}/export`, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-sm text-gray-500 hover:text-gray-300"
        >
          &larr; {campaignName}
        </Link>
        <h2 className="text-2xl font-bold mt-1">
          {mode === "create" ? "New Variant" : `Edit: ${variantName}`}
        </h2>
        <p className="text-gray-500">Template: {templateName}</p>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/50 border border-green-700 text-green-300 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Preview panel */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 sticky top-8">
            <h3 className="font-semibold mb-3">Preview</h3>

            {/* Preview area */}
            <div
              className="rounded overflow-hidden relative bg-gray-800"
              style={{ aspectRatio, maxHeight: "500px" }}
            >
              {/* Real AE preview frame */}
              {previewUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="After Effects preview"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute bottom-1 left-1 bg-green-600/80 text-white text-[10px] px-1.5 py-0.5 rounded">
                    AE Render
                  </div>
                </>
              ) : (
                /* Fallback: text overlay placeholder */
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-gradient-to-b from-gray-800 to-gray-900">
                  {manifest.fields
                    .filter((f) => f.type === "text")
                    .map((field, idx) => {
                      const text = (fieldValues[field.id] as string) || (field.default as string) || field.label;
                      return (
                        <p
                          key={field.id}
                          className={`text-white mb-2 ${
                            idx === 0 ? "text-xl font-bold" : "text-sm text-gray-300"
                          }`}
                        >
                          {text}
                        </p>
                      );
                    })}
                  <p className="text-xs text-gray-600 mt-4">
                    Click &quot;Generate Preview&quot; to see real AE frame
                  </p>
                </div>
              )}

              {/* Loading overlay */}
              {previewLoading && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-20">
                  <div className="w-8 h-8 border-3 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mb-3" />
                  <p className="text-sm text-blue-300">Rendering in After Effects...</p>
                  <p className="text-xs text-gray-500 mt-1">This may take 10-30 seconds</p>
                </div>
              )}

              {/* Resolution badge */}
              <div className="absolute top-2 right-2 bg-black/60 text-gray-300 text-xs px-2 py-1 rounded z-10">
                {previewWidth}x{previewHeight}
              </div>
            </div>

            {/* Generate Preview button */}
            {mode === "edit" && (
              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={previewLoading}
                className="w-full mt-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 rounded text-sm font-medium transition-colors"
              >
                {previewLoading ? "Rendering..." : previewUrl ? "Refresh Preview" : "Generate Preview"}
              </button>
            )}

            {previewError && (
              <p className="text-xs text-red-400 mt-2">{previewError}</p>
            )}

            {/* Output format selector */}
            {manifest.outputVariants.length > 0 && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Output Format
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {manifest.outputVariants.map((ov) => (
                    <button
                      key={ov.id}
                      type="button"
                      onClick={() => setOutputVariantId(ov.id)}
                      className={`px-2 py-2 rounded text-xs font-medium transition-colors ${
                        outputVariantId === ov.id
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                    >
                      {ov.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Export buttons */}
            {mode === "edit" && (
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-800 rounded font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {exporting ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Rendering in AE...
                    </>
                  ) : (
                    "Render & Export MP4"
                  )}
                </button>

                {renderJobs?.some((j) => j.status === "COMPLETED") && (
                  <a
                    href={`/api/variants/${variantId}/export`}
                    className="block w-full py-2 bg-gray-800 hover:bg-gray-700 rounded font-medium text-sm text-center transition-colors text-gray-300"
                  >
                    Download Last Export
                  </a>
                )}
              </div>
            )}

            {/* Render history */}
            {renderJobs && renderJobs.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">History</h4>
                <div className="space-y-1.5">
                  {renderJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between text-xs bg-gray-800 rounded px-3 py-2"
                    >
                      <span
                        className={
                          job.status === "COMPLETED"
                            ? "text-green-400"
                            : job.status === "FAILED"
                              ? "text-red-400"
                              : "text-yellow-400"
                        }
                      >
                        {job.status}
                      </span>
                      <span className="text-gray-500">
                        {new Date(job.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Field editor */}
        <div className="lg:col-span-2">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            {/* Variant name */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Variant Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Spanish - Square - Version A"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <hr className="border-gray-800 mb-6" />

            {/* Dynamic fields from manifest */}
            <div className="space-y-5">
              {manifest.fields.map((field) => (
                <FieldInput
                  key={field.id}
                  field={field}
                  value={fieldValues[field.id]}
                  onChange={(val) => updateField(field.id, val)}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-8 pt-6 border-t border-gray-800">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 rounded font-medium text-sm transition-colors"
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>
              {mode === "edit" && (
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 rounded font-medium text-sm transition-colors"
                >
                  {exporting ? "Rendering..." : "Render & Export"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  switch (field.type) {
    case "text":
      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            {field.label}
          </label>
          <input
            type="text"
            value={(value as string) ?? (field.default as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            maxLength={field.validation?.maxLength}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {field.validation?.maxLength && (
            <p className="text-xs text-gray-500 mt-1">
              {((value as string) ?? (field.default as string) ?? "").length}/
              {field.validation.maxLength} characters
            </p>
          )}
        </div>
      );

    case "color": {
      const colorVal = value ?? field.default;
      let hexColor = "#3366CC";
      if (Array.isArray(colorVal)) {
        const r = Math.round((colorVal[0] as number) * 255);
        const g = Math.round((colorVal[1] as number) * 255);
        const b = Math.round((colorVal[2] as number) * 255);
        hexColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      } else if (typeof colorVal === "string") {
        hexColor = colorVal;
      }

      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            {field.label}
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={hexColor}
              onChange={(e) => {
                const hex = e.target.value;
                const r = parseInt(hex.slice(1, 3), 16) / 255;
                const g = parseInt(hex.slice(3, 5), 16) / 255;
                const b = parseInt(hex.slice(5, 7), 16) / 255;
                onChange([r, g, b]);
              }}
              className="w-12 h-10 bg-transparent cursor-pointer"
            />
            <span className="text-sm text-gray-400">{hexColor}</span>
          </div>
        </div>
      );
    }

    case "image":
    case "video":
    case "audio":
      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            {field.label}
          </label>
          <div className="flex items-center gap-3">
            <label className="px-4 py-2 bg-gray-800 border border-gray-700 rounded cursor-pointer hover:bg-gray-700 transition-colors text-sm">
              Upload {field.type}
              <input
                type="file"
                className="hidden"
                accept={
                  field.type === "image"
                    ? "image/*"
                    : field.type === "video"
                      ? "video/*"
                      : "audio/*"
                }
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const formData = new FormData();
                  formData.append("file", file);

                  const res = await fetch("/api/assets", {
                    method: "POST",
                    body: formData,
                  });

                  if (res.ok) {
                    const asset = await res.json();
                    onChange(asset.storagePath);
                  }
                }}
              />
            </label>
            {typeof value === "string" && value && (
              <span className="text-sm text-gray-400 truncate max-w-xs">
                {value.split("/").pop()}
              </span>
            )}
          </div>
          {field.validation?.formats && (
            <p className="text-xs text-gray-500 mt-1">
              Formats: {field.validation.formats.join(", ")}
            </p>
          )}
        </div>
      );

    default:
      return null;
  }
}
