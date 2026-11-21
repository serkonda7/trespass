import { describe, expect, test } from "bun:test";
import {
  cookieHeader,
  createTestAuth,
  createTestUser,
  signInRequest,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from "./test-helpers";

const WRONG = "wrong-password-123";

describe("sign-in lockout", () => {
  async function setup() {
    const t = createTestAuth();
    await createTestUser(t.db, "anna", "admin");
    return t;
  }
  const fail5 = async (h: Parameters<typeof signInRequest>[0], u: string, headers = {}) => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await signInRequest(h, u, WRONG, TEST_ORIGIN, headers)).status);
    return statuses;
  };

  // A single device's successful sign-in is remembered; a tailnet attacker
  // hammering the shared username bucket must not lock the owner out.
  test("a device that signed in before is not locked out by an attacker", async () => {
    const { handler, db } = await setup();
    await createTestUser(db, "ben");
    const ok = await signInRequest(handler, "anna");
    expect(ok.status).toBe(200);
    const device = cookieHeader(ok)
      .split("; ")
      .find((c) => c.startsWith("tr.device="))!;
    expect(device).toBeDefined();

    await fail5(handler, "anna");
    await fail5(handler, "anna");
    expect((await signInRequest(handler, "anna")).status).toBe(429);

    const mine = await signInRequest(handler, "anna", TEST_PASSWORD, TEST_ORIGIN, {
      cookie: device,
    });
    expect(mine.status).toBe(200);
    await fail5(handler, "ben");
    const ben = await signInRequest(handler, "ben", TEST_PASSWORD, TEST_ORIGIN, { cookie: device });
    expect(ben.status).toBe(429);
  });
});
