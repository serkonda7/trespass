// The Better Auth endpoints the app uses keep working behind the handler,
// and disabled accounts cannot sign in.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { passkeys } from "../db/schema";
import {
  cookieHeader,
  createTestAuth,
  createTestUser,
  signInRequest,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from "./test-helpers";
import { disableUser } from "./users";

const WRONG = "wrong-password-123";

async function signedIn(role: "admin" | "member" | "guest" = "guest") {
  const t = createTestAuth();
  const u = await createTestUser(t.db, "gustav", role);
  const res = await signInRequest(t.handler, "gustav");
  expect(res.status).toBe(200);
  return { ...t, user: u, cookie: cookieHeader(res) };
}

function call(
  h: (r: Request) => Promise<Response>,
  path: string,
  opts: { method?: string; cookie?: string; body?: unknown } = {},
) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  return h(
    new Request(`${TEST_ORIGIN}/api/auth${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
  );
}

describe("Better Auth endpoints", () => {
  test("the endpoints the app needs still work", async () => {
    const { db, handler, user, cookie } = await signedIn("member");

    const session = await call(handler, "/get-session", { cookie });
    expect(session.status).toBe(200);
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(user.id);

    expect((await call(handler, "/passkey/generate-register-options", { cookie })).status).toBe(
      200,
    );
    expect((await call(handler, "/passkey/generate-authenticate-options")).status).toBe(200);
    // Verification endpoints are reachable (a bogus credential is refused, not 404).
    for (const p of ["/passkey/verify-registration", "/passkey/verify-authentication"]) {
      const res = await call(handler, p, { cookie, body: { response: {} } });
      expect(res.status).not.toBe(404);
      expect(res.status).toBeLessThan(500);
    }

    const pk = db
      .insert(passkeys)
      .values({
        name: "Alt",
        publicKey: "pk",
        userId: user.id,
        credentialID: "cred",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      })
      .returning()
      .get();
    const renamed = await call(handler, "/passkey/update-passkey", {
      cookie,
      body: { id: pk.id, name: "Handy" },
    });
    expect(renamed.status).toBe(200);
    expect(db.select().from(passkeys).where(eq(passkeys.id, pk.id)).get()?.name).toBe("Handy");
    const deleted = await call(handler, "/passkey/delete-passkey", { cookie, body: { id: pk.id } });
    expect(deleted.status).toBe(200);
    expect(db.select().from(passkeys).where(eq(passkeys.id, pk.id)).get()).toBeUndefined();

    const changed = await call(handler, "/change-password", {
      cookie,
      body: { currentPassword: TEST_PASSWORD, newPassword: "another-long-password" },
    });
    expect(changed.status).toBe(200);
    expect((await signInRequest(handler, "gustav", "another-long-password")).status).toBe(200);

    const out = await call(handler, "/sign-out", { cookie, body: {} });
    expect(out.status).toBe(200);
    const after = await call(handler, "/get-session", { cookie });
    expect(await after.json()).toBeNull();
  });
});

describe("disabled accounts at sign-in", () => {
  test("a correct password for a disabled account answers like a wrong one", async () => {
    const { db, handler } = createTestAuth();
    const u = await createTestUser(db, "anna");
    await createTestUser(db, "ben");
    disableUser(db, u.id);
    const right = await signInRequest(handler, "anna", TEST_PASSWORD);
    const wrong = await signInRequest(handler, "ben", WRONG);
    expect(right.status).toBe(401);
    expect(right.status).toBe(wrong.status);
    expect(await right.json()).toEqual(await wrong.json());
    expect(right.headers.getSetCookie()).toEqual([]);
  });
});
