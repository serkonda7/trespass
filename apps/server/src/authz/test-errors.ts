// Test-only: turns a thrown HttpError into { status, code } for compact asserts.
import { HttpError } from "../auth/context";

export function failure(fn: () => unknown): { status: number; code: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, code: e.message.split(":")[0]! };
    throw e;
  }
}
