import type { FieldDefinition, SceneDefinition } from "@dco/shared";

// MOGRT capPropType constants
const PROP_TYPE_TEXT = 0;
const PROP_TYPE_SLIDER = 1;
// const PROP_TYPE_BOOLEAN = 2;
const PROP_TYPE_COLOR = 3;
// const PROP_TYPE_POINT_2D = 4;
// const PROP_TYPE_POINT_3D = 5;
const PROP_TYPE_SCALE = 7;
const PROP_TYPE_GROUP = 8;

interface MogrtCapParam {
  capPropType: number;
  capPropUIName: string;
  capPropMatchName: string;
  capPropDefault: unknown;
  capPropMin?: number;
  capPropMax?: number;
  capPropDecimals?: number;
  capPropDimensions?: number;
  capPropFontEditInfo?: {
    fontEditValue?: string;
    fontSizeEditValue?: number;
  };
}

interface MogrtManifest {
  authorApp: string;
  sourceInfoLocalized: {
    en_US: {
      name: string;
    };
  };
}

/**
 * Parse a .mogrt file and extract Essential Graphics parameters as FieldDefinitions.
 * Groups related params (X/Y Position -> point, etc).
 * When 2+ top-level groups exist, they are treated as scenes.
 */
export async function parseMogrtFile(filePath: string): Promise<{
  fields: FieldDefinition[];
  scenes: SceneDefinition[];
  compName: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
}> {
  const { Mogrt } = await import("mogrt");
  const mogrt = new Mogrt(filePath);
  await mogrt.init();

  if (!mogrt.isAfterEffects()) {
    throw new Error("Only After Effects MOGRTs are supported");
  }

  const manifest = await mogrt.getManifest(false) as unknown as MogrtManifest;
  const flatManifest = await mogrt.getManifest(true) as Record<string, unknown>;

  const sourceInfoLoc = flatManifest.sourceInfoLocalized as Record<string, Record<string, unknown>> | undefined;
  const sourceInfo = sourceInfoLoc?.en_US || {};
  const compName = (sourceInfo.name as string) || "Comp 1";

  const width = (sourceInfo.width as number) || 1920;
  const height = (sourceInfo.height as number) || 1080;
  const framerate = sourceInfo.framerate as { ticksperframe?: number } | undefined;
  const fps = framerate?.ticksperframe
    ? Math.round(254016000000 / framerate.ticksperframe)
    : 30;
  const durationInfo = sourceInfo.duration as { seconds?: number } | undefined;
  const duration = durationInfo?.seconds || 10;

  const capsuleParams = (manifest.sourceInfoLocalized?.en_US as Record<string, unknown>)
    ?.capsuleparams as { capParams?: MogrtCapParam[] } | undefined;
  const rawParams: MogrtCapParam[] = capsuleParams?.capParams || [];

  // Pre-scan: count top-level groups to decide if we treat them as scenes
  let topLevelGroupCount = 0;
  for (const param of rawParams) {
    if (param.capPropType === PROP_TYPE_GROUP) {
      topLevelGroupCount++;
    }
  }
  const treatGroupsAsScenes = topLevelGroupCount >= 2;

  // Group params: groups (type 8) contain child params that share a prefix
  const fields: FieldDefinition[] = [];
  const scenes: SceneDefinition[] = [];
  const usedIds = new Set<string>();
  const usedSceneIds = new Set<string>();
  const consumed = new Set<number>(); // indices already consumed

  for (let i = 0; i < rawParams.length; i++) {
    if (consumed.has(i)) continue;
    const param = rawParams[i];

    if (param.capPropType === PROP_TYPE_GROUP) {
      // This is a group - consume its children (listed as the next N non-group params with matching prefix)
      const groupName = param.capPropUIName;
      const children: MogrtCapParam[] = [];
      consumed.add(i);

      // Children follow immediately after the group and share its name as prefix
      for (let j = i + 1; j < rawParams.length; j++) {
        const child = rawParams[j];
        if (child.capPropType === PROP_TYPE_GROUP) break; // next group
        // Check if child belongs to this group
        if (child.capPropUIName === groupName || child.capPropUIName.startsWith(groupName + "_") || child.capPropUIName.startsWith(groupName + " ")) {
          children.push(child);
          consumed.add(j);
        } else {
          break;
        }
      }

      if (treatGroupsAsScenes) {
        // Create a scene for this group
        const sceneId = uniqueId(groupName, usedSceneIds);
        scenes.push({
          id: sceneId,
          name: groupName,
          startFrame: 0,
          endFrame: 0,
        });
        // Produce fields tagged with this sceneId
        compressGroup(groupName, children, fields, usedIds, sceneId);
      } else {
        // Not enough groups for scenes — treat as regular group (existing behavior)
        compressGroup(groupName, children, fields, usedIds);
      }
    } else {
      // Standalone param (not inside a group) — global field, no sceneId
      consumed.add(i);
      const field = paramToField(param, usedIds);
      if (field) fields.push(field);
    }
  }

  return { fields, scenes, compName, width, height, fps, duration };
}

function compressGroup(
  groupName: string,
  children: MogrtCapParam[],
  fields: FieldDefinition[],
  usedIds: Set<string>,
  sceneId?: string
) {
  // Find specific child types
  let textChild: MogrtCapParam | null = null;
  let colorChild: MogrtCapParam | null = null;
  let xPosChild: MogrtCapParam | null = null;
  let yPosChild: MogrtCapParam | null = null;
  let scaleChild: MogrtCapParam | null = null;
  let opacityChild: MogrtCapParam | null = null;
  const otherChildren: MogrtCapParam[] = [];

  for (const c of children) {
    const n = c.capPropUIName;
    if (c.capPropType === PROP_TYPE_TEXT) {
      textChild = c;
    } else if (c.capPropType === PROP_TYPE_COLOR) {
      colorChild = c;
    } else if (n.endsWith("X Position")) {
      xPosChild = c;
    } else if (n.endsWith("Y Position")) {
      yPosChild = c;
    } else if (c.capPropType === PROP_TYPE_SCALE) {
      scaleChild = c;
    } else if (n === "Opacity" || n.endsWith("_Opacity") || n.endsWith(" Opacity")) {
      opacityChild = c;
    } else {
      otherChildren.push(c);
    }
  }

  // Text field
  if (textChild) {
    fields.push(makeField(groupName, "text", textChild.capPropUIName, textChild.capPropDefault as string, { maxLength: 200 }, usedIds, sceneId));
  }

  // Color
  if (colorChild) {
    const def = colorChild.capPropDefault;
    const colorDef = Array.isArray(def) && def.length >= 3
      ? [def[0] as number, def[1] as number, def[2] as number]
      : null;
    fields.push(makeField(groupName + " Color", "color", colorChild.capPropUIName, colorDef, null, usedIds, sceneId));
  }

  // Position: merge X + Y into a single point field
  if (xPosChild && yPosChild) {
    const xDef = (xPosChild.capPropDefault as number) ?? 0;
    const yDef = (yPosChild.capPropDefault as number) ?? 0;
    // Store as point but keep both parameterNames so render can split them
    fields.push({
      id: uniqueId(groupName + " Position", usedIds),
      type: "point",
      label: groupName + " Position",
      // Store both param names joined by "|" so the render pipeline can split
      parameterName: xPosChild.capPropUIName + "|" + yPosChild.capPropUIName,
      default: [xDef, yDef],
      validation: { dimensions: 2 },
      sceneId,
    });
  } else {
    // Standalone X or Y
    if (xPosChild) {
      const f = paramToField(xPosChild, usedIds, sceneId);
      if (f) fields.push(f);
    }
    if (yPosChild) {
      const f = paramToField(yPosChild, usedIds, sceneId);
      if (f) fields.push(f);
    }
  }

  // Scale
  if (scaleChild) {
    const def = scaleChild.capPropDefault;
    const scaleDef = Array.isArray(def) ? def.slice(0, 2) as number[] : null;
    fields.push(makeField(groupName + " Scale", "point", scaleChild.capPropUIName, scaleDef, { dimensions: 2 }, usedIds, sceneId));
  }

  // Opacity
  if (opacityChild) {
    fields.push(makeField(groupName + " Opacity", "slider", opacityChild.capPropUIName,
      (opacityChild.capPropDefault as number) ?? 100,
      { min: 0, max: 100, step: 1 }, usedIds, sceneId));
  }

  // Remaining
  for (const c of otherChildren) {
    const f = paramToField(c, usedIds, sceneId);
    if (f) fields.push(f);
  }
}

function paramToField(param: MogrtCapParam, usedIds: Set<string>, sceneId?: string): FieldDefinition | null {
  const type = mapType(param.capPropType);
  if (!type) return null;

  const name = param.capPropUIName || `param`;
  return makeField(name, type, name, extractDefault(param), extractValidation(param), usedIds, sceneId);
}

function makeField(
  label: string,
  type: FieldDefinition["type"],
  parameterName: string,
  defaultVal: FieldDefinition["default"],
  validation: FieldDefinition["validation"],
  usedIds: Set<string>,
  sceneId?: string
): FieldDefinition {
  return {
    id: uniqueId(label, usedIds),
    type,
    label,
    parameterName,
    default: defaultVal,
    validation,
    ...(sceneId !== undefined ? { sceneId } : {}),
  };
}

function uniqueId(label: string, usedIds: Set<string>): string {
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
  if (usedIds.has(id)) {
    let c = 2;
    while (usedIds.has(`${id}_${c}`)) c++;
    id = `${id}_${c}`;
  }
  usedIds.add(id);
  return id;
}

function mapType(capPropType: number): FieldDefinition["type"] | null {
  switch (capPropType) {
    case PROP_TYPE_TEXT: return "text";
    case PROP_TYPE_SLIDER: return "slider";
    case 2: return "checkbox";
    case PROP_TYPE_COLOR: return "color";
    case 4: case 5: return "point";
    case PROP_TYPE_SCALE: return "point";
    case PROP_TYPE_GROUP: return null;
    default: return "slider";
  }
}

function extractDefault(param: MogrtCapParam): FieldDefinition["default"] {
  const def = param.capPropDefault;
  if (def === null || def === undefined) return null;
  if (typeof def === "string") return def;
  if (typeof def === "number") return def;
  if (typeof def === "boolean") return def;
  if (Array.isArray(def) && def.length >= 3) {
    return [def[0] as number, def[1] as number, def[2] as number];
  }
  if (Array.isArray(def) && def.length === 2) {
    return [def[0] as number, def[1] as number];
  }
  return null;
}

function extractValidation(param: MogrtCapParam) {
  if (param.capPropType === PROP_TYPE_TEXT) return { maxLength: 200 };
  if (param.capPropType === PROP_TYPE_SLIDER) {
    return {
      min: param.capPropMin ?? -10000,
      max: param.capPropMax ?? 10000,
      step: param.capPropDecimals === 0 ? 1 : 0.1,
    };
  }
  return null;
}
