import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { TemplateManifest } from "@dco/shared";

const DEMO_MANIFEST: TemplateManifest = {
  templateId: "demo-template-001",
  name: "Product Ad 15s",
  format: "aep",
  composition: "main_comp",
  outputModule: "H.264 - Match Render Settings",
  outputExt: "mp4",
  duration: 15,
  fps: 30,
  width: 1920,
  height: 1080,
  fields: [
    {
      id: "headline",
      layerName: "headline_text",
      layerIndex: 1,
      type: "text",
      label: "Headline",
      default: "Your Product Here",
      validation: { maxLength: 40 },
      nexrenderAsset: { type: "data", property: "Source Text" },
    },
    {
      id: "subtitle",
      layerName: "subtitle_text",
      layerIndex: 2,
      type: "text",
      label: "Subtitle",
      default: "The best product ever",
      validation: { maxLength: 60 },
      nexrenderAsset: { type: "data", property: "Source Text" },
    },
    {
      id: "background",
      layerName: "background.jpg",
      layerIndex: 5,
      type: "image",
      label: "Background Image",
      default: null,
      validation: { minWidth: 1920, formats: ["jpg", "png"] },
      nexrenderAsset: { type: "image" },
    },
    {
      id: "brand_color",
      layerName: "color_overlay",
      layerIndex: 3,
      type: "color",
      label: "Brand Color",
      default: [0.2, 0.4, 0.9],
      validation: null,
      nexrenderAsset: { type: "data", property: "Effects.Fill.Color" },
    },
  ],
  scenes: [
    { id: "intro", name: "Intro", startFrame: 0, endFrame: 90 },
    { id: "product", name: "Product Shot", startFrame: 90, endFrame: 360 },
    { id: "outro", name: "Outro/CTA", startFrame: 360, endFrame: 450 },
  ],
  outputVariants: [
    { id: "landscape", width: 1920, height: 1080, label: "16:9 Landscape" },
    { id: "square", width: 1080, height: 1080, label: "1:1 Square" },
    { id: "vertical", width: 1080, height: 1920, label: "9:16 Vertical" },
  ],
};

export async function POST() {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  // Create org
  const org = await prisma.organization.upsert({
    where: { slug: "demo-agency" },
    update: {},
    create: {
      name: "Demo Agency",
      slug: "demo-agency",
    },
  });

  // Create admin user
  const passwordHash = await hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@demo.com" },
    update: {},
    create: {
      email: "admin@demo.com",
      passwordHash,
      name: "Admin User",
      role: "ADMIN",
      organizationId: org.id,
    },
  });

  // Create client user
  await prisma.user.upsert({
    where: { email: "client@demo.com" },
    update: {},
    create: {
      email: "client@demo.com",
      passwordHash: await hash("client123", 12),
      name: "Client User",
      role: "CLIENT",
      organizationId: org.id,
    },
  });

  // Create template
  const template = await prisma.template.upsert({
    where: { id: "demo-template-001" },
    update: { manifest: JSON.stringify(DEMO_MANIFEST) },
    create: {
      id: "demo-template-001",
      name: "Product Ad 15s",
      description: "15 second product advertisement template",
      organizationId: org.id,
      templateFilePath: "storage/demo/template.aep",
      templateFormat: "aep",
      manifest: JSON.stringify(DEMO_MANIFEST),
      status: "PUBLISHED",
    },
  });

  // Create campaign
  const campaign = await prisma.campaign.upsert({
    where: { id: "demo-campaign-001" },
    update: {},
    create: {
      id: "demo-campaign-001",
      name: "Summer 2026",
      organizationId: org.id,
    },
  });

  // Link template to campaign
  await prisma.campaignTemplate.upsert({
    where: {
      campaignId_templateId: {
        campaignId: campaign.id,
        templateId: template.id,
      },
    },
    update: {},
    create: { campaignId: campaign.id, templateId: template.id },
  });

  return NextResponse.json({
    message: "Seed completed",
    admin: { email: "admin@demo.com", password: "admin123" },
    client: { email: "client@demo.com", password: "client123" },
    template: template.id,
    campaign: campaign.id,
  });
}
