"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

type PreviewSource = "html" | "ae-rendering" | "ae-ready" | "ae-stale";

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

  // Preview state machine
  const [previewSource, setPreviewSource] = useState<PreviewSource>("html");
  const [aePreviewUrl, setAePreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldValuesRef = useRef(fieldValues);
  const renderGenRef = useRef(0);
  fieldValuesRef.current = fieldValues;

  // Load cached AE preview on mount
  useEffect(() => {
    if (mode === "edit" && variantId) {
      fetch(`/api/variants/${variantId}/preview`)
        .then((res) => {
          if (res.ok) return res.blob();
          return null;
        })
        .then((blob) => {
          if (blob) {
            setAePreviewUrl(URL.createObjectURL(blob));
            setPreviewSource("ae-ready");
          }
        })
        .catch(() => {});
    }
  }, [mode, variantId]);

  // Determine preview aspect ratio and thumbnail
  const selectedVariant = manifest.outputVariants.find((v) => v.id === outputVariantId);
  const previewWidth = selectedVariant?.width || manifest.width;
  const previewHeight = selectedVariant?.height || manifest.height;
  const aspectRatio = `${previewWidth} / ${previewHeight}`;

  // Get thumbnail for current output variant (stored as base64 in manifest)
  const variantThumb = (selectedVariant as Record<string, unknown> | undefined)?.thumbnailBase64 as string | undefined;
  const mainThumb = (manifest as unknown as Record<string, unknown>).thumbnailBase64 as string | undefined;
  const thumbnailSrc = variantThumb || mainThumb
    ? `data:image/png;base64,${variantThumb || mainThumb}`
    : null;

  function updateField(fieldId: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  // Auto-debounce AE preview
  const triggerAePreview = useCallback(async () => {
    if (mode !== "edit" || !variantId) return;

    const gen = ++renderGenRef.current;
    setPreviewSource("ae-rendering");
    setPreviewError("");

    try {
      // Auto-save
      await fetch(`/api/variants/${variantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: fieldValuesRef.current, outputVariantId: outputVariantId || null }),
      });

      // Render preview
      const res = await fetch(`/api/variants/${variantId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: fieldValuesRef.current }),
      });

      if (res.status === 202) {
        // Async: preview was queued, poll for result
        const { jobId } = await res.json();
        await pollPreviewJob(jobId, gen);
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Preview failed");
      }

      // Sync: preview returned directly as PNG
      if (gen !== renderGenRef.current) return;

      const blob = await res.blob();
      setAePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setPreviewSource("ae-ready");
    } catch (err) {
      if (gen !== renderGenRef.current) return;
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
      setPreviewSource("html");
    }
  }, [mode, variantId, outputVariantId]);

  // Poll for async preview completion
  async function pollPreviewJob(jobId: string, gen: number) {
    for (let i = 0; i < 120; i++) { // ~6 minutes max
      await new Promise((r) => setTimeout(r, 3000));
      if (gen !== renderGenRef.current) return; // stale

      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) continue;
        const job = await res.json();

        if (job.status === "COMPLETED") {
          // Fetch the preview image (try worker-uploaded preview first, then local)
          const previewRes = await fetch(`/api/worker/preview/${variantId}`);
          if (previewRes.ok) {
            const blob = await previewRes.blob();
            if (gen !== renderGenRef.current) return;
            setAePreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(blob);
            });
            setPreviewSource("ae-ready");
          }
          return;
        }

        if (job.status === "FAILED") {
          throw new Error(job.errorMessage || "Preview render failed");
        }
      } catch (err) {
        if (gen !== renderGenRef.current) return;
        setPreviewError(err instanceof Error ? err.message : "Preview poll failed");
        setPreviewSource("html");
        return;
      }
    }
  }

  // Debounce: restart timer on field changes
  useEffect(() => {
    if (mode !== "edit" || !variantId) return;

    // Mark AE preview as stale
    if (previewSource === "ae-ready") {
      setPreviewSource("ae-stale");
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      triggerAePreview();
    }, 3000);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldValues, outputVariantId]);

  function handleGeneratePreview() {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    triggerAePreview();
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

      const res = await fetch(`/api/variants/${variantId}/export`, { method: "POST" });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Export failed");
      }

      const data = await res.json();

      if (data.status === "QUEUED") {
        // Async: poll for completion
        setSuccess("Render queued...");
        await pollJobUntilDone(data.jobId);
      } else {
        // Sync: already completed
        setSuccess("Export complete!");
        router.refresh();
        window.open(`/api/variants/${variantId}/export`, "_blank");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function pollJobUntilDone(jobId: string) {
    const maxAttempts = 200; // ~10 minutes at 3s intervals
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) continue;
        const job = await res.json();

        if (job.status === "COMPLETED") {
          setSuccess("Export complete!");
          router.refresh();
          window.open(`/api/jobs/${jobId}?download=true`, "_blank");
          return;
        }

        if (job.status === "FAILED") {
          throw new Error(job.errorMessage || "Render failed");
        }

        // Still in progress
        const statusMsg = job.status === "ENCODING" ? "Encoding..." : "Rendering...";
        setSuccess(`${statusMsg} (${job.progress || 0}%)`);
      } catch (err) {
        if (err instanceof Error && err.message !== "Render failed") continue;
        throw err;
      }
    }
    throw new Error("Render timed out");
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/campaigns/${campaignId}`} className="text-sm text-gray-500 hover:text-gray-300">
            &larr; {campaignName}
          </Link>
          <Link
            href={`/campaigns/${campaignId}/batch?templateId=${templateId}`}
            className="text-sm text-purple-400 hover:text-purple-300"
          >
            Bulk Edit
          </Link>
        </div>
        <h2 className="text-2xl font-bold mt-1">
          {mode === "create" ? "New Variant" : `Edit: ${variantName}`}
        </h2>
        <p className="text-gray-500">Template: {templateName}</p>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded mb-4">{error}</div>
      )}
      {success && (
        <div className="bg-green-900/50 border border-green-700 text-green-300 px-4 py-3 rounded mb-4">{success}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Preview panel */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 sticky top-8">
            <h3 className="font-semibold mb-3">Preview</h3>

            {/* Layered preview area */}
            <div
              className="rounded overflow-hidden relative bg-gray-900"
              style={{ aspectRatio, maxHeight: "500px" }}
            >
              {/* Layer 0: Thumbnail from template (shows immediately, hides when AE preview exists) */}
              {thumbnailSrc && (
                <div className={`absolute inset-0 z-5 transition-opacity duration-500 ${
                  previewSource === "ae-ready" || (previewSource === "ae-rendering" && aePreviewUrl) ? "opacity-0" : "opacity-100"
                }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbnailSrc} alt="Template thumbnail" className="w-full h-full object-contain" />
                </div>
              )}

              {/* Layer 1: HTML Canvas (hidden when thumbnail is available) */}
              <div className={`absolute inset-0 z-10 transition-opacity duration-500 ${
                previewSource === "ae-ready" || thumbnailSrc ? "opacity-0" : "opacity-100"
              }`}>
                <HtmlPreviewCanvas
                  fields={manifest.fields}
                  fieldValues={fieldValues}
                  width={previewWidth}
                  height={previewHeight}
                />
              </div>

              {/* Layer 2: AE Render (stays visible while next preview renders) */}
              {aePreviewUrl && (
                <div className={`absolute inset-0 z-20 transition-opacity duration-500 ${
                  previewSource === "ae-ready" || previewSource === "ae-rendering" || previewSource === "ae-stale"
                    ? "opacity-100" : "opacity-0"
                }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={aePreviewUrl} alt="AE preview" className="w-full h-full object-contain" />
                </div>
              )}

              {/* Layer 3: Status badge */}
              <div className="absolute top-2 left-2 z-30">
                {previewSource === "ae-rendering" && (
                  <div className="flex items-center gap-1.5 bg-yellow-600/80 text-white text-[10px] px-2 py-0.5 rounded animate-pulse">
                    <span className="inline-block w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                    Rendering...
                  </div>
                )}
                {previewSource === "ae-ready" && (
                  <div className="bg-green-600/80 text-white text-[10px] px-2 py-0.5 rounded">AE Render</div>
                )}
                {(previewSource === "html" || previewSource === "ae-stale") && (
                  <div className="bg-blue-600/80 text-white text-[10px] px-2 py-0.5 rounded">Live Preview</div>
                )}
              </div>

              {/* Resolution badge */}
              <div className="absolute top-2 right-2 bg-black/60 text-gray-300 text-xs px-2 py-1 rounded z-30">
                {previewWidth}x{previewHeight}
              </div>
            </div>

            {/* Generate Preview button */}
            {mode === "edit" && (
              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={previewSource === "ae-rendering"}
                className="w-full mt-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 rounded text-sm font-medium transition-colors"
              >
                {previewSource === "ae-rendering" ? "Rendering..." : "Generate Preview"}
              </button>
            )}

            {previewError && <p className="text-xs text-red-400 mt-2">{previewError}</p>}

            {/* Output format selector */}
            {manifest.outputVariants.length > 0 && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">Output Format</label>
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
                  <div className="flex gap-2">
                    <a
                      href={`/api/variants/${variantId}/export`}
                      className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded font-medium text-sm text-center transition-colors text-gray-300"
                    >
                      Download Last Export
                    </a>
                    <button
                      type="button"
                      onClick={() => fetch(`/api/variants/${variantId}/export/open-folder`, { method: "POST" })}
                      className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors text-gray-300"
                      title="Open export folder"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Render history */}
            {renderJobs && renderJobs.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">History</h4>
                <div className="space-y-1.5">
                  {renderJobs.map((job) => (
                    <div key={job.id} className="flex items-center justify-between text-xs bg-gray-800 rounded px-3 py-2">
                      <span className={
                        job.status === "COMPLETED" ? "text-green-400"
                          : job.status === "FAILED" ? "text-red-400"
                          : "text-yellow-400"
                      }>
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
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-1">Variant Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Spanish - Square - Version A"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <hr className="border-gray-800 mb-6" />

            <div className="space-y-5">
              {manifest.fields.map((field, idx) => (
                <FieldInput
                  key={`${field.id}-${idx}`}
                  field={field}
                  value={fieldValues[field.id]}
                  onChange={(val) => updateField(field.id, val)}
                />
              ))}
            </div>

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

// ============================================
// HTML Preview Canvas
// ============================================

interface PreviewTextLayer {
  kind: "text";
  text: string;
  color: string;
  x: number; // percentage 0-100
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

interface PreviewBgLayer {
  kind: "background";
  color: string;
  opacity: number;
}

type PreviewLayer = PreviewTextLayer | PreviewBgLayer;

function rgbToCSS(val: unknown): string {
  if (Array.isArray(val) && val.length >= 3) {
    const r = Math.round((val[0] as number) * 255);
    const g = Math.round((val[1] as number) * 255);
    const b = Math.round((val[2] as number) * 255);
    return `rgb(${r},${g},${b})`;
  }
  return "white";
}

function getFieldValue<T>(fields: FieldDefinition[], fieldValues: Record<string, unknown>, id: string, fallbackField?: FieldDefinition): T | undefined {
  const val = fieldValues[id];
  if (val !== undefined) return val as T;
  const field = fallbackField || fields.find((f) => f.id === id);
  if (field?.default !== undefined && field.default !== null) return field.default as T;
  return undefined;
}

function buildPreviewLayers(
  fields: FieldDefinition[],
  fieldValues: Record<string, unknown>,
  compWidth: number,
  compHeight: number
): PreviewLayer[] {
  const layers: PreviewLayer[] = [];
  const consumed = new Set<string>();

  // Find text fields and group with siblings
  for (const field of fields) {
    if (field.type !== "text") continue;
    consumed.add(field.id);

    const base = field.id;
    const textVal = (fieldValues[base] as string) ??
      (typeof field.default === "string" ? field.default : "") ??
      field.label;

    // Find siblings
    const colorField = fields.find((f) => f.id === `${base}_color`);
    const posField = fields.find((f) => f.id === `${base}_position`);
    const scaleField = fields.find((f) => f.id === `${base}_scale`);
    const opacityField = fields.find((f) => f.id === `${base}_opacity`) ||
      (base === fields.find((f) => f.id === "opacity")?.id ? undefined : fields.find((f) => f.id === "opacity"));

    if (colorField) consumed.add(colorField.id);
    if (posField) consumed.add(posField.id);
    if (scaleField) consumed.add(scaleField.id);
    if (opacityField && opacityField.id !== "opacity") consumed.add(opacityField.id);

    const color = rgbToCSS(getFieldValue(fields, fieldValues, `${base}_color`, colorField));
    const pos = getFieldValue<number[]>(fields, fieldValues, `${base}_position`, posField) ?? [compWidth / 2, compHeight / 2];
    const scale = getFieldValue<number[]>(fields, fieldValues, `${base}_scale`, scaleField) ?? [100, 100];
    const opacity = (getFieldValue<number>(fields, fieldValues, opacityField?.id || `${base}_opacity`, opacityField) ?? 100) / 100;

    layers.push({
      kind: "text",
      text: textVal,
      color,
      x: (pos[0] / compWidth) * 100,
      y: (pos[1] / compHeight) * 100,
      scaleX: (scale[0] ?? 100) / 100,
      scaleY: (scale[1] ?? 100) / 100,
      opacity,
    });
  }

  // Find background color fields (not consumed by text groups)
  for (const field of fields) {
    if (consumed.has(field.id)) continue;
    if (field.type !== "color") continue;

    const base = field.id.replace(/_color$/, "");
    const opacityField = fields.find((f) => f.id === `${base}_opacity`);
    const opacity = (getFieldValue<number>(fields, fieldValues, opacityField?.id || `${base}_opacity`, opacityField) ?? 100) / 100;
    const color = rgbToCSS(getFieldValue(fields, fieldValues, field.id, field));

    consumed.add(field.id);
    if (opacityField) consumed.add(opacityField.id);

    layers.push({ kind: "background", color, opacity });
  }

  return layers;
}

function HtmlPreviewCanvas({
  fields,
  fieldValues,
  width,
  height,
}: {
  fields: FieldDefinition[];
  fieldValues: Record<string, unknown>;
  width: number;
  height: number;
}) {
  const layers = useMemo(
    () => buildPreviewLayers(fields, fieldValues, width, height),
    [fields, fieldValues, width, height]
  );

  const bgLayers = layers.filter((l): l is PreviewBgLayer => l.kind === "background");
  const textLayers = layers.filter((l): l is PreviewTextLayer => l.kind === "text");

  return (
    <div className="absolute inset-0" style={{ background: "#111" }}>
      {/* Background layers */}
      {bgLayers.map((bg, i) => (
        <div
          key={`bg-${i}`}
          className="absolute inset-0"
          style={{ backgroundColor: bg.color, opacity: bg.opacity }}
        />
      ))}

      {/* Text layers */}
      {textLayers.map((t, i) => (
        <div
          key={`text-${i}`}
          className="absolute whitespace-nowrap font-bold"
          style={{
            left: `${t.x}%`,
            top: `${t.y}%`,
            transform: `translate(-50%, -50%) scale(${t.scaleX}, ${t.scaleY})`,
            color: t.color,
            opacity: t.opacity,
            fontSize: `clamp(10px, ${3 + i * 0.5}vw, 24px)`,
            textShadow: "0 1px 4px rgba(0,0,0,0.5)",
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ============================================
// Field Input Component
// ============================================

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
    case "text": {
      const rawDefault = field.default;
      const textDefault = typeof rawDefault === "object" && rawDefault !== null && !Array.isArray(rawDefault) && "text" in (rawDefault as unknown as Record<string, unknown>)
        ? (rawDefault as unknown as Record<string, unknown>).text as string
        : typeof rawDefault === "string" ? rawDefault : "";
      const textValue = (value as string) ?? textDefault;
      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
          <input
            type="text"
            value={textValue}
            onChange={(e) => onChange(e.target.value)}
            maxLength={field.validation?.maxLength}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {field.validation?.maxLength && (
            <p className="text-xs text-gray-500 mt-1">{textValue.length}/{field.validation.maxLength} characters</p>
          )}
        </div>
      );
    }

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
          <label className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
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
          <label className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
          <div className="flex items-center gap-3">
            <label className="px-4 py-2 bg-gray-800 border border-gray-700 rounded cursor-pointer hover:bg-gray-700 transition-colors text-sm">
              Upload {field.type}
              <input
                type="file"
                className="hidden"
                accept={
                  field.type === "image" ? "image/*"
                    : field.type === "video" ? "video/*"
                    : "audio/*"
                }
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const formData = new FormData();
                  formData.append("file", file);
                  const res = await fetch("/api/assets", { method: "POST", body: formData });
                  if (res.ok) {
                    const asset = await res.json();
                    onChange(asset.storagePath);
                  }
                }}
              />
            </label>
            {typeof value === "string" && value && (
              <span className="text-sm text-gray-400 truncate max-w-xs">{value.split("/").pop()}</span>
            )}
          </div>
          {field.validation?.formats && (
            <p className="text-xs text-gray-500 mt-1">Formats: {field.validation.formats.join(", ")}</p>
          )}
        </div>
      );

    case "slider": {
      const numVal = (value as unknown as number) ?? (field.default as unknown as number) ?? 0;
      const min = field.validation?.min ?? -10000;
      const max = field.validation?.max ?? 10000;
      const step = field.validation?.step ?? 0.1;
      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={numVal}
              onChange={(e) => onChange(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <input
              type="number"
              value={numVal}
              step={step}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      );
    }

    case "dropdown": {
      const choices = field.choices ?? field.validation?.options ?? [];
      const dropVal = (value as number) ?? (field.default as number) ?? 1;
      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
          <select
            value={dropVal}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {choices.length > 0 ? (
              choices.map((choice, i) => (
                <option key={i + 1} value={i + 1}>{choice}</option>
              ))
            ) : (
              Array.from({ length: Math.max(dropVal, 5) }, (_, i) => (
                <option key={i + 1} value={i + 1}>Option {i + 1}</option>
              ))
            )}
          </select>
        </div>
      );
    }

    case "point": {
      const dims = field.validation?.dimensions ?? 2;
      const ptVal = (value as number[]) ?? (field.default as number[]) ?? (dims === 3 ? [0, 0, 0] : [0, 0]);
      const labels = ["X", "Y", "Z"];
      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
          <div className="flex gap-2">
            {Array.from({ length: dims }, (_, i) => (
              <div key={i} className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">{labels[i]}</label>
                <input
                  type="number"
                  value={ptVal[i] ?? 0}
                  step={0.1}
                  onChange={(e) => {
                    const newVal = [...ptVal];
                    newVal[i] = Number(e.target.value);
                    onChange(newVal);
                  }}
                  className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "checkbox": {
      const boolVal = (value as unknown as boolean) ?? (field.default as unknown as boolean) ?? false;
      return (
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={boolVal} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-blue-500" />
          <label className="text-sm font-medium text-gray-300">{field.label}</label>
        </div>
      );
    }

    /* dropdown handled above */

    case "font": {
      const fontVal = (value as string) ?? (field.default as string) ?? "";
      return (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{field.label}</label>
          <input
            type="text"
            value={fontVal}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Font name (e.g. Arial, Helvetica)"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      );
    }

    default:
      return null;
  }
}
