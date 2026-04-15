"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  TemplateManifest,
  FieldDefinition,
  FieldType,
  OutputVariant,
} from "@dco/shared";

interface ManifestBuilderProps {
  onChange: (manifest: TemplateManifest) => void;
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string; description: string }[] = [
  { value: "text", label: "Text", description: "Editable text layer" },
  { value: "image", label: "Image", description: "Replaceable image" },
  { value: "video", label: "Video", description: "Replaceable video clip" },
  { value: "audio", label: "Audio", description: "Replaceable audio track" },
  { value: "color", label: "Color", description: "Editable color value" },
];

const PRESET_OUTPUT_VARIANTS: OutputVariant[] = [
  { id: "landscape", width: 1920, height: 1080, label: "16:9 Landscape" },
  { id: "square", width: 1080, height: 1080, label: "1:1 Square" },
  { id: "vertical", width: 1080, height: 1920, label: "9:16 Vertical" },
];

function nexrenderAssetForType(type: FieldType): { type: "data" | "image" | "footage" | "audio"; property?: string } {
  switch (type) {
    case "text":
      return { type: "data", property: "Source Text" };
    case "color":
      return { type: "data", property: "Effects.Fill.Color" };
    case "slider":
    case "point":
    case "checkbox":
    case "dropdown":
    case "font":
      return { type: "data", property: "" };
    case "image":
      return { type: "image" };
    case "video":
      return { type: "footage" };
    case "audio":
      return { type: "audio" };
  }
}

function defaultValidationForType(type: FieldType) {
  switch (type) {
    case "text":
      return { maxLength: 50 };
    case "image":
      return { formats: ["jpg", "png", "webp"] };
    case "video":
      return { formats: ["mp4", "mov"], maxDuration: 30 };
    case "audio":
      return { formats: ["mp3", "wav", "aac"] };
    default:
      return null;
  }
}

function makeFieldId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface EditableField {
  key: number; // for React keys
  label: string;
  layerName: string;
  parameterName: string; // MOGRT Essential Graphics parameter name
  type: FieldType;
  defaultValue: string;
  maxLength: number;
}

export function ManifestBuilder({ onChange }: ManifestBuilderProps) {
  // Composition settings
  const [composition, setComposition] = useState("main_comp");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(15);

  // Fields
  const [fields, setFields] = useState<EditableField[]>([]);
  const [nextKey, setNextKey] = useState(1);

  // Output variants
  const [enabledVariants, setEnabledVariants] = useState<Record<string, boolean>>({
    landscape: true,
    square: false,
    vertical: false,
  });
  const [variantCompositions, setVariantCompositions] = useState<Record<string, string>>({});

  // Build manifest whenever anything changes
  const buildManifest = useCallback((): TemplateManifest => {
    const manifestFields: FieldDefinition[] = fields.map((f, i) => ({
      id: makeFieldId(f.label) || `field_${i}`,
      layerName: f.layerName || f.label,
      layerIndex: i + 1,
      parameterName: f.parameterName || f.label,
      type: f.type,
      label: f.label,
      default: f.type === "color" ? [0.2, 0.4, 0.9] : f.defaultValue || null,
      validation:
        f.type === "text" && f.maxLength
          ? { maxLength: f.maxLength }
          : defaultValidationForType(f.type),
      nexrenderAsset: nexrenderAssetForType(f.type),
    }));

    const outputVariants = PRESET_OUTPUT_VARIANTS
      .filter((v) => enabledVariants[v.id])
      .map((v) => ({
        ...v,
        ...(variantCompositions[v.id] ? { composition: variantCompositions[v.id] } : {}),
      }));

    return {
      templateId: "",
      name: "",
      composition,
      outputModule: "H.264 - Match Render Settings",
      outputExt: "mp4",
      duration,
      fps,
      width,
      height,
      fields: manifestFields,
      scenes: [],
      outputVariants,
    };
  }, [fields, composition, width, height, fps, duration, enabledVariants, variantCompositions]);

  useEffect(() => {
    onChange(buildManifest());
  }, [buildManifest, onChange]);

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        key: nextKey,
        label: "",
        layerName: "",
        parameterName: "",
        type: "text",
        defaultValue: "",
        maxLength: 50,
      },
    ]);
    setNextKey((k) => k + 1);
  }

  function updateField(key: number, updates: Partial<EditableField>) {
    setFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, ...updates } : f))
    );
  }

  function removeField(key: number) {
    setFields((prev) => prev.filter((f) => f.key !== key));
  }

  function moveField(key: number, direction: "up" | "down") {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.key === key);
      if (idx < 0) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  }

  return (
    <div className="space-y-5">
      {/* Composition settings */}
      <div>
        <h4 className="text-sm font-semibold text-gray-200 mb-3">
          Composition Settings
        </h4>
        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Comp Name
            </label>
            <input
              type="text"
              value={composition}
              onChange={(e) => setComposition(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="main_comp"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Width</label>
            <input
              type="number"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Height</label>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">FPS</label>
            <input
              type="number"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Duration (s)
            </label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <hr className="border-gray-800" />

      {/* Editable fields */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-200">
            Editable Fields
          </h4>
          <button
            type="button"
            onClick={addField}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
          >
            + Add Field
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6 border border-dashed border-gray-700 rounded">
            No editable fields yet. Click &quot;+ Add Field&quot; to define what
            the client can modify.
          </p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, idx) => (
              <FieldRow
                key={field.key}
                field={field}
                index={idx}
                total={fields.length}
                onUpdate={(updates) => updateField(field.key, updates)}
                onRemove={() => removeField(field.key)}
                onMove={(dir) => moveField(field.key, dir)}
              />
            ))}
          </div>
        )}
      </div>

      <hr className="border-gray-800" />

      {/* Output variants */}
      <div>
        <h4 className="text-sm font-semibold text-gray-200 mb-3">
          Output Formats
        </h4>
        <div className="space-y-2">
          {PRESET_OUTPUT_VARIANTS.map((variant) => (
            <div key={variant.id} className="flex items-center gap-3">
              <label
                className={`flex items-center gap-2 px-4 py-2.5 rounded cursor-pointer transition-colors shrink-0 ${
                  enabledVariants[variant.id]
                    ? "bg-blue-600/20 border border-blue-500/50 text-blue-300"
                    : "bg-gray-800 border border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={enabledVariants[variant.id] || false}
                  onChange={(e) =>
                    setEnabledVariants((prev) => ({
                      ...prev,
                      [variant.id]: e.target.checked,
                    }))
                  }
                  className="accent-blue-500"
                />
                <span className="text-sm font-medium">{variant.label}</span>
                <span className="text-xs text-gray-500">
                  {variant.width}x{variant.height}
                </span>
              </label>
              {enabledVariants[variant.id] && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 shrink-0">Comp:</label>
                  <input
                    type="text"
                    value={variantCompositions[variant.id] || ""}
                    onChange={(e) =>
                      setVariantCompositions((prev) => ({
                        ...prev,
                        [variant.id]: e.target.value,
                      }))
                    }
                    placeholder={composition || "same as main"}
                    className="w-40 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-600"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  field: EditableField;
  index: number;
  total: number;
  onUpdate: (updates: Partial<EditableField>) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      <div className="flex items-start gap-3">
        {/* Reorder buttons */}
        <div className="flex flex-col gap-1 pt-1">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={index === 0}
            className="text-gray-500 hover:text-gray-300 disabled:text-gray-700 text-xs"
            title="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={index === total - 1}
            className="text-gray-500 hover:text-gray-300 disabled:text-gray-700 text-xs"
            title="Move down"
          >
            ▼
          </button>
        </div>

        {/* Field type */}
        <div className="w-32 shrink-0">
          <label className="block text-xs text-gray-400 mb-1">Type</label>
          <select
            value={field.type}
            onChange={(e) =>
              onUpdate({ type: e.target.value as FieldType })
            }
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {FIELD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Label */}
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">
            Label (what the client sees)
          </label>
          <input
            type="text"
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder="e.g. Main Headline"
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* EG Parameter Name (for MOGRT) */}
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">
            EG Parameter Name
          </label>
          <input
            type="text"
            value={field.parameterName}
            onChange={(e) => onUpdate({ parameterName: e.target.value })}
            placeholder="e.g. Title, Brand Color"
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Layer name (for media replacement) */}
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">
            AE Layer Name
          </label>
          <input
            type="text"
            value={field.layerName}
            onChange={(e) => onUpdate({ layerName: e.target.value })}
            placeholder="e.g. headline_text"
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Type-specific options */}
        {field.type === "text" && (
          <>
            <div className="w-36">
              <label className="block text-xs text-gray-400 mb-1">
                Default Text
              </label>
              <input
                type="text"
                value={field.defaultValue}
                onChange={(e) => onUpdate({ defaultValue: e.target.value })}
                placeholder="Default value"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="w-20">
              <label className="block text-xs text-gray-400 mb-1">
                Max Chars
              </label>
              <input
                type="number"
                value={field.maxLength}
                onChange={(e) =>
                  onUpdate({ maxLength: Number(e.target.value) })
                }
                min={1}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {/* Remove button */}
        <button
          type="button"
          onClick={onRemove}
          className="mt-5 p-1.5 text-gray-500 hover:text-red-400 transition-colors"
          title="Remove field"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
