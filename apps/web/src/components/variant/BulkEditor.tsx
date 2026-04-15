"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { TemplateManifest, FieldDefinition } from "@dco/shared";
import { CellEditor } from "./cells/CellEditors";
import Link from "next/link";

// --- Types ---

interface RowState {
  _key: string;
  id?: string;
  name: string;
  fieldValues: Record<string, unknown>;
  outputVariantId: string;
  renderJobId?: string;
  renderJobStatus?: string;
  isDirty: boolean;
}

interface ColumnGroup {
  id: string;
  label: string;
  fields: FieldDefinition[];
}

interface InitialVariant {
  id: string;
  name: string;
  fieldValues: Record<string, unknown>;
  outputVariantId?: string | null;
  renderJobStatus?: string;
  renderJobId?: string;
}

interface BulkEditorProps {
  manifest: TemplateManifest;
  initialVariants: InitialVariant[];
  campaignId: string;
  campaignName: string;
  templateId: string;
  templateName: string;
}

// --- Helpers ---

let keyCounter = 0;
function nextKey(): string {
  return `row_${++keyCounter}_${Date.now()}`;
}

function buildDefaultFieldValues(fields: FieldDefinition[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== null && f.default !== undefined) {
      values[f.id] = f.default;
    }
  }
  return values;
}

// --- Status Badge ---

function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-gray-600">--</span>;
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
    QUEUED: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
    RENDERING: "bg-blue-900/50 text-blue-400 border-blue-700",
    ENCODING: "bg-blue-900/50 text-blue-400 border-blue-700",
    COMPLETED: "bg-green-900/50 text-green-400 border-green-700",
    FAILED: "bg-red-900/50 text-red-400 border-red-700",
  };
  const cls = colors[status] || "bg-gray-800 text-gray-400 border-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded border ${cls}`}>
      {status}
    </span>
  );
}

// --- Main Component ---

export function BulkEditor({
  manifest,
  initialVariants,
  campaignId,
  campaignName,
  templateId,
  templateName,
}: BulkEditorProps) {
  const router = useRouter();

  // Build column groups from manifest scenes
  const columnGroups = useMemo<ColumnGroup[]>(() => {
    const globalFields = manifest.fields.filter((f) => !f.sceneId);
    const sceneGroups = manifest.scenes.map((s) => ({
      id: s.id,
      label: s.name,
      fields: manifest.fields.filter((f) => f.sceneId === s.id),
    }));
    const groups = [...sceneGroups];
    if (globalFields.length > 0) {
      groups.push({ id: "global", label: manifest.scenes.length > 0 ? "Global" : "Fields", fields: globalFields });
    }
    return groups;
  }, [manifest]);

  const allFields = useMemo(() => columnGroups.flatMap((g) => g.fields), [columnGroups]);

  // Initialize rows from existing variants or create one empty row
  const [rows, setRows] = useState<RowState[]>(() => {
    if (initialVariants.length > 0) {
      return initialVariants.map((v) => ({
        _key: nextKey(),
        id: v.id,
        name: v.name,
        fieldValues: v.fieldValues,
        outputVariantId: v.outputVariantId || "",
        renderJobStatus: v.renderJobStatus,
        renderJobId: v.renderJobId,
        isDirty: false,
      }));
    }
    return [{
      _key: nextKey(),
      name: "Variant 1",
      fieldValues: buildDefaultFieldValues(manifest.fields),
      outputVariantId: manifest.outputVariants[0]?.id || "",
      isDirty: true,
    }];
  });

  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Row operations ---

  const addRow = useCallback(() => {
    const rowNum = rows.length + 1;
    setRows((prev) => [
      ...prev,
      {
        _key: nextKey(),
        name: `Variant ${rowNum}`,
        fieldValues: buildDefaultFieldValues(manifest.fields),
        outputVariantId: manifest.outputVariants[0]?.id || "",
        isDirty: true,
      },
    ]);
  }, [rows.length, manifest]);

  const removeRow = useCallback(async (key: string) => {
    const row = rows.find((r) => r._key === key);
    if (row?.id) {
      try {
        await fetch(`/api/variants/${row.id}`, { method: "DELETE" });
      } catch {
        // Ignore errors on delete
      }
    }
    setRows((prev) => prev.filter((r) => r._key !== key));
  }, [rows]);

  const duplicateRow = useCallback((key: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r._key === key);
      if (idx === -1) return prev;
      const source = prev[idx];
      const newRow: RowState = {
        _key: nextKey(),
        name: source.name + " (copy)",
        fieldValues: { ...source.fieldValues },
        outputVariantId: source.outputVariantId,
        isDirty: true,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, newRow);
      return next;
    });
  }, []);

  const updateRowName = useCallback((key: string, name: string) => {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, name, isDirty: true } : r))
    );
  }, []);

  const updateRowField = useCallback((key: string, fieldId: string, value: unknown) => {
    setRows((prev) =>
      prev.map((r) =>
        r._key === key
          ? { ...r, fieldValues: { ...r.fieldValues, [fieldId]: value }, isDirty: true }
          : r
      )
    );
  }, []);

  const updateRowOutputVariant = useCallback((key: string, outputVariantId: string) => {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, outputVariantId, isDirty: true } : r))
    );
  }, []);

  // --- Save All ---

  const saveAll = useCallback(async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/variants/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          templateId,
          variants: rows.map((r) => ({
            id: r.id,
            name: r.name,
            fieldValues: r.fieldValues,
            outputVariantId: r.outputVariantId || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }
      // Update row IDs from response
      const savedVariants = data.variants as Array<{ id: string; name: string }>;
      setRows((prev) =>
        prev.map((r, i) => {
          const saved = savedVariants[i];
          if (saved) {
            return { ...r, id: saved.id, isDirty: false };
          }
          return r;
        })
      );
      setSuccess(`${savedVariants.length} variants saved`);
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }, [rows, campaignId, templateId]);

  // --- Render All ---

  const renderAll = useCallback(async () => {
    // Validate all rows are saved
    const unsaved = rows.filter((r) => !r.id || r.isDirty);
    if (unsaved.length > 0) {
      setError("Save all variants before rendering");
      return;
    }

    setRendering(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/variants/batch-render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantIds: rows.map((r) => r.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start renders");
        setRendering(false);
        return;
      }
      // Update render job IDs
      const resultMap = new Map(
        (data.results as Array<{ variantId: string; jobId: string; status: string }>)
          .map((r) => [r.variantId, r])
      );
      setRows((prev) =>
        prev.map((r) => {
          const result = r.id ? resultMap.get(r.id) : undefined;
          if (result) {
            return { ...r, renderJobId: result.jobId, renderJobStatus: result.status };
          }
          return r;
        })
      );
      setSuccess("Render jobs queued");
      // Start polling
      startPolling();
    } catch {
      setError("Network error");
      setRendering(false);
    }
  }, [rows]);

  // --- Polling ---

  function startPolling() {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      // Pause when tab is hidden
      if (document.hidden) return;

      setRows((prev) => {
        // Collect job IDs that need polling
        const activeJobs = prev.filter(
          (r) => r.renderJobId && r.renderJobStatus !== "COMPLETED" && r.renderJobStatus !== "FAILED"
        );
        if (activeJobs.length === 0) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setRendering(false);
          return prev;
        }
        // Fetch status updates (async inside setState is fine - we trigger re-fetch outside)
        return prev;
      });

      // Actually fetch updates
      const currentRows = rows;
      const activeJobs = currentRows.filter(
        (r) => r.renderJobId && r.renderJobStatus !== "COMPLETED" && r.renderJobStatus !== "FAILED"
      );
      if (activeJobs.length === 0) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setRendering(false);
        return;
      }

      try {
        const updates = await Promise.all(
          activeJobs.map(async (r) => {
            const res = await fetch(`/api/jobs/${r.renderJobId}`);
            if (res.ok) {
              const job = await res.json();
              return { variantId: r.id, status: job.status as string };
            }
            return null;
          })
        );

        const updateMap = new Map<string, string>();
        for (const u of updates) {
          if (u) updateMap.set(u.variantId!, u.status);
        }

        setRows((prev) =>
          prev.map((r) => {
            const newStatus = r.id ? updateMap.get(r.id) : undefined;
            if (newStatus) return { ...r, renderJobStatus: newStatus };
            return r;
          })
        );
      } catch {
        // Ignore polling errors
      }
    }, 3000);
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // --- Counts ---
  const dirtyCount = rows.filter((r) => r.isDirty).length;
  const totalFields = allFields.length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
                <Link href={`/campaigns/${campaignId}`} className="hover:text-gray-200">
                  {campaignName}
                </Link>
                <span>/</span>
                <span>{templateName}</span>
              </div>
              <h1 className="text-xl font-semibold">Bulk Editor</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {rows.length} variant{rows.length !== 1 ? "s" : ""} &middot; {totalFields} field{totalFields !== 1 ? "s" : ""}
                {manifest.scenes.length > 0 && ` \u00b7 ${manifest.scenes.length} scenes`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {error && (
                <span className="text-sm text-red-400">{error}</span>
              )}
              {success && (
                <span className="text-sm text-green-400">{success}</span>
              )}
              <button
                onClick={addRow}
                className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 transition-colors"
              >
                + Add Row
              </button>
              <button
                onClick={saveAll}
                disabled={saving || dirtyCount === 0}
                className="px-4 py-1.5 text-sm bg-blue-600 rounded hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Saving..." : `Save All${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
              </button>
              <button
                onClick={renderAll}
                disabled={rendering || rows.some((r) => !r.id || r.isDirty)}
                className="px-4 py-1.5 text-sm bg-purple-600 rounded hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rendering ? "Rendering..." : "Render All"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="border-collapse text-sm w-full" style={{ minWidth: "max-content" }}>
            <thead>
              {/* Row 1: Scene/group headers */}
              <tr className="bg-gray-900/80">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 bg-gray-900 border-b border-r border-gray-800 px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[40px]"
                >
                  #
                </th>
                <th
                  rowSpan={2}
                  className="sticky left-[40px] z-20 bg-gray-900 border-b border-r border-gray-800 px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[160px]"
                >
                  Name
                </th>
                {manifest.outputVariants.length > 1 && (
                  <th
                    rowSpan={2}
                    className="border-b border-r border-gray-800 px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[100px]"
                  >
                    Format
                  </th>
                )}
                {columnGroups.map((group) => (
                  <th
                    key={group.id}
                    colSpan={group.fields.length}
                    className="border-b border-r border-gray-800 px-3 py-1.5 text-center text-xs font-medium text-gray-400 uppercase tracking-wider"
                  >
                    <span className="text-purple-400">{group.label}</span>
                  </th>
                ))}
                <th
                  rowSpan={2}
                  className="border-b border-r border-gray-800 px-3 py-2 text-center text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[80px]"
                >
                  Status
                </th>
                <th
                  rowSpan={2}
                  className="sticky right-0 z-20 bg-gray-900 border-b border-gray-800 px-3 py-2 text-center text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[90px]"
                >
                  Actions
                </th>
              </tr>
              {/* Row 2: Field labels */}
              <tr className="bg-gray-900/60">
                {columnGroups.flatMap((group) =>
                  group.fields.map((field) => (
                    <th
                      key={field.id}
                      className="border-b border-r border-gray-800 px-2 py-1.5 text-left text-xs font-medium text-gray-300 whitespace-nowrap min-w-[100px]"
                      title={field.label}
                    >
                      {field.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr
                  key={row._key}
                  className={`border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors ${row.isDirty ? "bg-gray-900/20" : ""}`}
                >
                  {/* Row number */}
                  <td className="sticky left-0 z-10 bg-gray-950 border-r border-gray-800/50 px-3 py-1.5 text-center text-xs text-gray-500">
                    {rowIdx + 1}
                    {row.isDirty && <span className="ml-1 text-yellow-500">&bull;</span>}
                  </td>
                  {/* Name */}
                  <td className="sticky left-[40px] z-10 bg-gray-950 border-r border-gray-800/50 px-1.5 py-1">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRowName(row._key, e.target.value)}
                      className="w-full bg-transparent px-1.5 py-1 text-sm text-white focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                    />
                  </td>
                  {/* Format selector */}
                  {manifest.outputVariants.length > 1 && (
                    <td className="border-r border-gray-800/50 px-1.5 py-1">
                      <select
                        value={row.outputVariantId}
                        onChange={(e) => updateRowOutputVariant(row._key, e.target.value)}
                        className="w-full bg-transparent px-1 py-1 text-sm text-white focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                      >
                        {manifest.outputVariants.map((ov) => (
                          <option key={ov.id} value={ov.id}>
                            {ov.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {/* Field cells */}
                  {columnGroups.flatMap((group) =>
                    group.fields.map((field) => (
                      <td
                        key={field.id}
                        className="border-r border-gray-800/50 px-1.5 py-1"
                      >
                        <CellEditor
                          value={row.fieldValues[field.id]}
                          onChange={(val) => updateRowField(row._key, field.id, val)}
                          field={field}
                        />
                      </td>
                    ))
                  )}
                  {/* Status */}
                  <td className="border-r border-gray-800/50 px-2 py-1 text-center">
                    <StatusBadge status={row.renderJobStatus} />
                  </td>
                  {/* Actions */}
                  <td className="sticky right-0 z-10 bg-gray-950 px-2 py-1">
                    <div className="flex items-center justify-center gap-1">
                      {row.id && (
                        <Link
                          href={`/campaigns/${campaignId}/variants/${row.id}`}
                          className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                          title="Open in editor"
                        >
                          Edit
                        </Link>
                      )}
                      <button
                        onClick={() => duplicateRow(row._key)}
                        className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                        title="Duplicate row"
                      >
                        Dup
                      </button>
                      <button
                        onClick={() => removeRow(row._key)}
                        className="px-1.5 py-0.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                        title="Delete row"
                      >
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Empty state */}
        {rows.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p>No variants yet.</p>
            <button onClick={addRow} className="mt-2 text-blue-400 hover:text-blue-300">
              + Add your first variant
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
