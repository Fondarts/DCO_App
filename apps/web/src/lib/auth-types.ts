import type { UserRole } from "@dco/shared";
import "next-auth";

declare module "next-auth" {
  interface User {
    role: UserRole;
    organizationId: string;
    organizationName: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      organizationId: string;
    };
  }
}
