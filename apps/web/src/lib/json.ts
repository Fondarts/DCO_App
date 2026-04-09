import type { TemplateManifest } from "@dco/shared";

/** Parse manifest from DB (stored as JSON string in SQLite) */
export function parseManifest(raw: string | unknown): TemplateManifest {
  if (typeof raw === "string") return JSON.parse(raw);
  return raw as TemplateManifest;
}

/** Parse fieldValues from DB */
export function parseFieldValues(raw: string | unknown): Record<string, unknown> {
  if (typeof raw === "string") return JSON.parse(raw);
  return (raw as Record<string, unknown>) || {};
}
