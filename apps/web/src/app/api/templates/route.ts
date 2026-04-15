import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTemplateFilePath } from "@/lib/storage";
import { writeFile, copyFile } from "fs/promises";
import { existsSync } from "fs";
import { parseMogrtFile } from "@/lib/mogrt-parser";
import type { TemplateManifest } from "@dco/shared";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.template.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const isCepPanel = req.headers.get("x-dco-panel") === "true";
  const session = await auth();

  let orgId: string;
  if (isCepPanel && !session?.user) {
    const org = await prisma.organization.findFirst();
    if (!org) {
      return NextResponse.json({ error: "No organization found. Seed the database first." }, { status: 400 });
    }
    orgId = org.id;
  } else if (session?.user) {
    if (session.user.role === "CLIENT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    orgId = session.user.organizationId;
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const name = formData.get("name") as string;
  const description = formData.get("description") as string | null;
  const templateFile = (formData.get("templateFile") || formData.get("aepFile")) as File | null;
  const thumbnail = formData.get("thumbnail") as File | null;
  // Optional: client can send a manifest (for AEP or manual override)
  const manifestJson = formData.get("manifest") as string | null;
  // Optional: local file path (on-premise, server reads directly from disk)
  const localFilePath = formData.get("localFilePath") as string | null;

  const hasFile = templateFile || localFilePath;
  if (!name || !hasFile) {
    return NextResponse.json(
      { error: "name and template file (or localFilePath) are required" },
      { status: 400 }
    );
  }

  let fileName: string;
  if (localFilePath) {
    fileName = localFilePath.replace(/\\/g, "/").split("/").pop() || "template.mogrt";
  } else {
    fileName = templateFile!.name;
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  const templateFormat = ext === "mogrt" ? "mogrt" : "aep";

  // Create template record first to get ID for file path
  let template;
  try {
    template = await prisma.template.create({
      data: {
        name,
        description,
        organizationId: orgId,
        templateFilePath: "",
        templateFormat,
        manifest: "{}",
        status: "PUBLISHED",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Save template file to disk
  const filePath = getTemplateFilePath(orgId, template.id, fileName);
  try {
    if (localFilePath) {
      // On-premise: copy file directly from local path (avoids upload corruption)
      const { statSync, readdirSync } = await import("fs");
      let resolvedPath = localFilePath;

      // If the path is a directory (AE sometimes creates a folder with .mogrt name),
      // find the actual .mogrt file inside it
      if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
        const files = readdirSync(resolvedPath);
        const mogrtFile = files.find((f: string) => f.endsWith(".mogrt"));
        if (mogrtFile) {
          resolvedPath = require("path").join(resolvedPath, mogrtFile);
        }
      }

      if (!existsSync(resolvedPath) || statSync(resolvedPath).isDirectory()) {
        await prisma.template.delete({ where: { id: template.id } }).catch(() => {});
        return NextResponse.json({ error: `Local file not found: ${resolvedPath}` }, { status: 400 });
      }
      await copyFile(resolvedPath, filePath);
    } else {
      const fileBuffer = Buffer.from(await templateFile!.arrayBuffer());
      await writeFile(filePath, fileBuffer);
    }
  } catch (err) {
    await prisma.template.delete({ where: { id: template.id } }).catch(() => {});
    const msg = err instanceof Error ? err.message : "File save error";
    return NextResponse.json({ error: `Failed to save template file: ${msg}` }, { status: 500 });
  }

  // Build manifest
  let manifest: TemplateManifest;

  if (manifestJson) {
    // Use client-provided manifest (from AE panel or manual upload)
    try {
      manifest = JSON.parse(manifestJson);
      manifest.templateId = template.id;
      if (!manifest.format) manifest.format = templateFormat;
    } catch {
      await prisma.template.delete({ where: { id: template.id } }).catch(() => {});
      return NextResponse.json({ error: "Invalid manifest JSON" }, { status: 400 });
    }
  } else if (templateFormat === "mogrt") {
    // No manifest provided — auto-parse MOGRT file to extract EG parameters
    try {
      const parsed = await parseMogrtFile(filePath);
      manifest = {
        templateId: template.id,
        name,
        format: "mogrt",
        composition: parsed.compName,
        outputModule: "H.264 - Match Render Settings",
        outputExt: "mp4",
        duration: parsed.duration,
        fps: parsed.fps,
        width: parsed.width,
        height: parsed.height,
        fields: parsed.fields,
        scenes: parsed.scenes,
        outputVariants: [
          { id: "landscape", width: 1920, height: 1080, label: "16:9 Landscape" },
        ],
      };
    } catch (err) {
      // Cleanup on failure
      await prisma.template.delete({ where: { id: template.id } }).catch(() => {});
      const msg = err instanceof Error ? err.message : "Failed to parse MOGRT";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } else {
    await prisma.template.delete({ where: { id: template.id } }).catch(() => {});
    return NextResponse.json({ error: "A manifest is required (send from AE panel or provide manually)" }, { status: 400 });
  }

  // Save thumbnail if provided
  let thumbnailPath: string | null = null;
  if (thumbnail) {
    thumbnailPath = getTemplateFilePath(
      orgId,
      template.id,
      `thumbnail${thumbnail.name.substring(thumbnail.name.lastIndexOf("."))}`
    );
    const thumbBuffer = Buffer.from(await thumbnail.arrayBuffer());
    await writeFile(thumbnailPath, thumbBuffer);
  }

  // Copy variant MOGRT files and update manifest outputVariants with paths
  const variantMogrtPathsJson = formData.get("variantMogrtPaths") as string | null;
  if (variantMogrtPathsJson) {
    try {
      const { statSync, readdirSync } = await import("fs");
      const variantPaths = JSON.parse(variantMogrtPathsJson) as Record<string, string>;
      for (const [variantId, localPath] of Object.entries(variantPaths)) {
        if (!localPath || !existsSync(localPath)) continue;

        // AE sometimes exports .mogrt as a folder containing the actual file
        let resolvedPath = localPath;
        if (statSync(resolvedPath).isDirectory()) {
          const files = readdirSync(resolvedPath);
          const mogrtFile = files.find((f: string) => f.endsWith(".mogrt"));
          if (mogrtFile) {
            resolvedPath = require("path").join(resolvedPath, mogrtFile);
          }
        }
        if (!existsSync(resolvedPath) || statSync(resolvedPath).isDirectory()) continue;

        const variantFileName = `variant-${variantId}.mogrt`;
        const destPath = getTemplateFilePath(orgId, template.id, variantFileName);
        await copyFile(resolvedPath, destPath);
        console.log(`[templates] Stored variant MOGRT: ${variantId} -> ${destPath}`);

        // Update the matching outputVariant in manifest with the MOGRT path
        const ov = manifest.outputVariants.find((v) => v.id === variantId);
        if (ov) {
          (ov as unknown as Record<string, unknown>).mogrtPath = destPath;
        }
      }
    } catch (err) {
      console.warn("[templates] Warning: variant MOGRT copy error:", err);
    }
  }

  // Update with file paths and manifest
  const updated = await prisma.template.update({
    where: { id: template.id },
    data: {
      templateFilePath: filePath,
      thumbnailPath,
      manifest: JSON.stringify(manifest),
    },
  });

  // Auto-associate with first active campaign (for CEP panel convenience)
  if (isCepPanel) {
    const campaign = await prisma.campaign.findFirst({
      where: { organizationId: orgId, status: "ACTIVE" },
    });
    if (campaign) {
      await prisma.campaignTemplate.create({
        data: { campaignId: campaign.id, templateId: template.id },
      }).catch(() => {});
    }
  }

  return NextResponse.json(updated, { status: 201 });
}
