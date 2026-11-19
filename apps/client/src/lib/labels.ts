// German labels for enum values. Keys stay English; text comes from the catalog.

import type { Role } from "@trespass/shared/authz/ctx";
import { m } from "@trespass/shared/paraglide/messages";

export const roleLabel = (role: Role): string =>
  ({ admin: m.role_admin, member: m.role_member, guest: m.role_guest })[role]();
