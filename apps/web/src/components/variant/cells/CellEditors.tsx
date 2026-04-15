"use client";

import { useState, useRef, useEffect } from "react";
import type { FieldDefinition } from "@dco/shared";

interface CellProps {
  value: unknown;
  onChange: (val: unknown) => void;
  field: FieldDefinition;
}

// --- Helpers ---

function rgbToHex(rgb: number[]): string {
  const r = Math.round((rgb[0] ?? 0) * 255);
  const g = Math.round((rgb[1] ?? 0) * 255);
  const b = Math.round((rgb[2] ?? 0) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToRgb(hex: string): number[] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function resolveTextDefault(field: FieldDefinition): string {
  const raw = field.default;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && "text" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).text as string;
  }
  return typeof raw === "string" ? raw : "";
}

// --- Cell Components ---

function TextCell({ value, onChange, field }: CellProps) {
  const textVal = (value as string) ?? resolveTextDefault(field);
  return (
    <input
      type="text"
      value={textVal}
      onChange={(e) => onChange(e.target.value)}
      maxLength={field.validation?.maxLength}
      className="w-full bg-transparent px-1.5 py-1 text-sm text-white focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
      title={textVal}
    />
  );
}

function ColorCell({ value, onChange, field }: CellProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const colorVal = value ?? field.default;
  let hexColor = "#3366CC";
  if (Array.isArray(colorVal)) {
    hexColor = rgbToHex(colorVal as number[]);
  } else if (typeof colorVal === "string") {
    hexColor = colorVal;
  }

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="w-7 h-7 rounded border border-gray-600 cursor-pointer shrink-0"
        style={{ backgroundColor: hexColor }}
        title={hexColor}
      />
      {open && (
        <div
          ref={popoverRef}
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 flex flex-col gap-2"
          style={{ top: pos.top, left: pos.left }}
        >
          <input
            type="color"
            value={hexColor}
            onChange={(e) => onChange(hexToRgb(e.target.value))}
            className="w-32 h-24 bg-transparent cursor-pointer"
          />
          <input
            type="text"
            value={hexColor}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(hexToRgb(v));
            }}
            className="w-32 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white text-center"
          />
        </div>
      )}
    </>
  );
}

function SliderCell({ value, onChange, field }: CellProps) {
  const numVal = (value as number) ?? (field.default as number) ?? 0;
  const min = field.validation?.min ?? -10000;
  const max = field.validation?.max ?? 10000;
  const step = field.validation?.step ?? 0.1;
  return (
    <input
      type="number"
      value={numVal}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-20 bg-transparent px-1.5 py-1 text-sm text-white focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
    />
  );
}

function MediaCell({ value, onChange, field }: CellProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const storagePath = typeof value === "string" ? value : "";
  const fileName = storagePath ? storagePath.split("/").pop() || storagePath.split("\\").pop() : "";
  const isImage = field.type === "image";

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/assets", { method: "POST", body: formData });
      if (res.ok) {
        const asset = await res.json();
        onChange(asset.storagePath);
      }
    } finally {
      setUploading(false);
    }
  }

  const accept = field.type === "image" ? "image/*"
    : field.type === "video" ? "video/*"
    : "audio/*";

  return (
    <div className="flex items-center gap-1.5 min-w-[100px]">
      {storagePath && isImage ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-8 h-8 rounded border border-gray-600 overflow-hidden shrink-0 cursor-pointer"
          title={fileName}
        >
          <img
            src={`/api/assets/thumbnail?path=${encodeURIComponent(storagePath)}`}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </button>
      ) : storagePath ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-gray-300 bg-gray-800 rounded border border-gray-700 cursor-pointer hover:bg-gray-700 truncate max-w-[120px]"
          title={fileName}
        >
          <span className="text-gray-500">{field.type === "video" ? "\u25B6" : "\u266B"}</span>
          <span className="truncate">{fileName}</span>
        </button>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-2 py-1 text-xs text-gray-400 bg-gray-800/50 border border-dashed border-gray-600 rounded cursor-pointer hover:bg-gray-800 hover:text-gray-300 transition-colors"
        >
          {uploading ? "..." : `+ ${field.type}`}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}

function CheckboxCell({ value, onChange, field }: CellProps) {
  const boolVal = (value as boolean) ?? (field.default as boolean) ?? false;
  return (
    <input
      type="checkbox"
      checked={boolVal}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-blue-500 cursor-pointer"
    />
  );
}

function DropdownCell({ value, onChange, field }: CellProps) {
  const choices = field.choices ?? field.validation?.options ?? [];
  const dropVal = (value as number) ?? (field.default as number) ?? 1;
  return (
    <select
      value={dropVal}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-transparent px-1 py-1 text-sm text-white focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
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
  );
}

function PointCell({ value, onChange, field }: CellProps) {
  const dims = field.validation?.dimensions ?? 2;
  const ptVal = (value as number[]) ?? (field.default as number[]) ?? (dims === 3 ? [0, 0, 0] : [0, 0]);
  const labels = ["X", "Y", "Z"];
  return (
    <div className="flex gap-1 items-center">
      {Array.from({ length: dims }, (_, i) => (
        <div key={i} className="flex items-center gap-0.5">
          <span className="text-[10px] text-gray-500">{labels[i]}</span>
          <input
            type="number"
            value={ptVal[i] ?? 0}
            step={0.1}
            onChange={(e) => {
              const newVal = [...ptVal];
              newVal[i] = Number(e.target.value);
              onChange(newVal);
            }}
            className="w-14 bg-transparent px-1 py-1 text-sm text-white focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
          />
        </div>
      ))}
    </div>
  );
}

function FontCell({ value, onChange, field }: CellProps) {
  const fontVal = (value as string) ?? (field.default as string) ?? "";
  return (
    <input
      type="text"
      value={fontVal}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Font..."
      className="w-full bg-transparent px-1.5 py-1 text-sm text-white placeholder-gray-600 focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
    />
  );
}

// --- Main Cell Editor ---

export function CellEditor({ value, onChange, field }: CellProps) {
  switch (field.type) {
    case "text": return <TextCell value={value} onChange={onChange} field={field} />;
    case "color": return <ColorCell value={value} onChange={onChange} field={field} />;
    case "slider": return <SliderCell value={value} onChange={onChange} field={field} />;
    case "image":
    case "video":
    case "audio": return <MediaCell value={value} onChange={onChange} field={field} />;
    case "checkbox": return <CheckboxCell value={value} onChange={onChange} field={field} />;
    case "dropdown": return <DropdownCell value={value} onChange={onChange} field={field} />;
    case "point": return <PointCell value={value} onChange={onChange} field={field} />;
    case "font": return <FontCell value={value} onChange={onChange} field={field} />;
    default: return null;
  }
}
