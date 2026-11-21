import { describe, expect, test } from "bun:test";
import { NOMINATIM_HOST, reverseGeocode, USER_AGENT } from "./reverse";

const fakeFetch = (body: unknown, status = 200) => {
  const calls: { url: string; init?: { headers?: Record<string, string> } }[] = [];
  const fn = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  };
  return { fn, calls };
};

describe("reverseGeocode", () => {
  test("uses Nominatim with a generic UA and parses German country/state", async () => {
    const { fn, calls } = fakeFetch({
      address: { country: "Deutschland", state: "Nordrhein-Westfalen" },
    });
    const result = await reverseGeocode({ lat: 51.1, lon: 7.2 }, { fetch: fn as never });
    expect(result).toEqual({ country: "Deutschland", adminArea: "Nordrhein-Westfalen" });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.host).toBe(NOMINATIM_HOST);
    expect(url.pathname).toBe("/reverse");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("zoom")).toBe("10");
    expect(url.searchParams.get("lat")).toBe("51.1");
    expect(url.searchParams.get("lon")).toBe("7.2");
    expect(calls[0].init?.headers?.["User-Agent"]).toBe(USER_AGENT);
    expect(calls[0].init?.headers?.["Accept-Language"]).toBe("de");
  });

  test("missing address fields become null; non-ok responses fail", async () => {
    expect(await reverseGeocode({ lat: 0, lon: 0 }, { fetch: fakeFetch({}).fn as never })).toEqual({
      country: null,
      adminArea: null,
    });
    await expect(
      reverseGeocode({ lat: 0, lon: 0 }, { fetch: fakeFetch({}, 503).fn as never }),
    ).rejects.toThrow(/503/);
  });
});
