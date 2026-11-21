// Per-request authorization context (built by getAuthCtx, server/auth/session.ts).
export type Role = "admin" | "member" | "guest";
export type AuthCtx = { userId: string; role: Role; groupIds: Set<string> };
