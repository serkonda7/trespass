import { describe, expect, test } from "bun:test";
import { allInOrder } from "./all-in-order";

const later = <T>(ms: number, fn: () => T) =>
  new Promise<T>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    }, ms),
  );

describe("allInOrder", () => {
  test("resolves values in order", async () => {
    expect(
      await allInOrder(
        later(5, () => 1),
        Promise.resolve("b"),
      ),
    ).toEqual([1, "b"]);
  });

  test("rethrows the first rejection by position, not by time", async () => {
    const first = later(10, () => {
      throw new Error("not found");
    });
    const second = Promise.reject(new Error("forbidden"));
    await expect(allInOrder(first, second)).rejects.toThrow("not found");
  });

  test("a later rejection still fails when earlier ones succeed", async () => {
    await expect(allInOrder(Promise.resolve(1), Promise.reject(new Error("x")))).rejects.toThrow(
      "x",
    );
  });
});
