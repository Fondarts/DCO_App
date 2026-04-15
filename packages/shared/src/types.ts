// ============================================
// DCO Shared Types
// ============================================

// --- Template Manifest Types ---

export type TemplateFormat = "aep" | "mogrt";

export type FieldType =
  | "text"        // Source Text
  | "image"       // Replaceable image
  | "video"       // Replaceable video
  | "audio"       // Replaceable audio
  | "color"       // Any color property [r,g,b] 0-1
  | "slider"      // Any single number (opacity, rotation, slider controls, font size, etc.)
  | "point"       // 2D [x,y] or 3D [x,y,z] position/point
  | "checkbox"    // Boolean (layer visibility, effect enabled)
  | "dropdown"    // Select from options
  | "font";       // Font family name

export interface FieldValidation {
  maxLength?: number;
  minLength?: number;
  minWidth?: number;
  minHeight?: number;
  maxDuration?: number;
  formats?: string[];
  min?: number;           // slider min value
  max?: number;           // slider max value
  step?: number;          // slider step
  options?: string[];     // dropdown options
  dimensions?: number;    // point: 2 or 3
}

export interface NexrenderAssetConfig {
  type: "data" | "image" | "footage" | "audio" | "script";
  property?: string; // e.g. "Source Text", "Effects.Fill.Color"
}

export interface FieldDefinition {
  id: string;
  type: FieldType;
  label: string;
  default: string | number | number[] | boolean | null;
  validation: FieldValidation | null;
  // MOGRT: Essential Graphics parameter name
  parameterName?: string;
  // AEP: layer-based targeting (also used for MOGRT media replacement)
  layerName?: string;
  layerIndex?: number;
  composition?: string;
  nexrenderAsset?: NexrenderAssetConfig;
  // Dropdown: list of option labels (1-indexed, value is the index)
  choices?: string[];
  // Scene grouping: links field to a SceneDefinition (undefined = global)
  sceneId?: string;
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
  // AE composition name for this variant (falls back to manifest.composition if omitted)
  composition?: string;
}

export interface TemplateManifest {
  templateId: string;
  name: string;
  format?: TemplateFormat;
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
  templateFilePath: string;
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
