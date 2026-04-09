// ============================================
// DCO Shared Types
// ============================================

// --- Template Manifest Types ---

export type FieldType = "text" | "image" | "video" | "audio" | "color";

export interface FieldValidation {
  maxLength?: number;
  minLength?: number;
  minWidth?: number;
  minHeight?: number;
  maxDuration?: number;
  formats?: string[];
}

export interface NexrenderAssetConfig {
  type: "data" | "image" | "footage" | "audio" | "script";
  property?: string; // e.g. "Source Text", "Effects.Fill.Color"
}

export interface FieldDefinition {
  id: string;
  layerName: string;
  layerIndex: number;
  type: FieldType;
  label: string;
  default: string | number[] | null;
  validation: FieldValidation | null;
  nexrenderAsset: NexrenderAssetConfig;
}

export interface SceneDefinition {
  id: string;
  name: string;
  startFrame: number;
  endFrame: number;
}

export interface OutputVariant {
  id: string;
  width: number;
  height: number;
  label: string;
}

export interface TemplateManifest {
  templateId: string;
  name: string;
  composition: string;
  outputModule: string;
  outputExt: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  fields: FieldDefinition[];
  scenes: SceneDefinition[];
  outputVariants: OutputVariant[];
}

// --- Job Types ---

export type JobStatus =
  | "PENDING"
  | "QUEUED"
  | "RENDERING"
  | "ENCODING"
  | "COMPLETED"
  | "FAILED";

export interface RenderJobPayload {
  jobId: string;
  variantId: string;
  templateId: string;
  aepFilePath: string;
  manifest: TemplateManifest;
  fieldValues: Record<string, unknown>;
  outputVariantId?: string;
}

// --- AE Rendering Types ---

export interface FieldPatch {
  layerName: string;
  property?: string; // e.g. "Source Text", "Effects.Fill.Color"
  value: unknown;
  type: "text" | "color" | "image" | "footage";
}

// --- API Types ---

export type UserRole = "ADMIN" | "DESIGNER" | "CLIENT";

export type TemplateStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type CampaignStatus = "ACTIVE" | "COMPLETED" | "ARCHIVED";
