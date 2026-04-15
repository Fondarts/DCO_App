import { prisma } from "./db";

// Dev mode: skip login, auto-resolve to first admin user
export async function auth() {
  const user = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    include: { organization: true },
  });

  if (!user) return null;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "ADMIN" | "DESIGNER" | "CLIENT",
      organizationId: user.organizationId,
      organizationName: user.organization.name,
    },
  };
}

// Stubs for next-auth exports that may be referenced elsewhere
export const handlers = {};
export const signIn = async () => {};
export const signOut = async () => {};
