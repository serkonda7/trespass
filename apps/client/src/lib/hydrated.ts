// Forms before hydration (slow links): a native submit would lose input, and
// Solid overwrites controlled inputs. Rules:
// - submit buttons: `useHydrated()`, disabled with "Lädt …" (also blocks Enter);
// - controlled inputs: `adoptTypedValue` keeps early typing;
// - otherwise wrap in `<fieldset disabled={!hydrated()}>`.
// <html data-hydrated> marks the moment.
import { createSignal, onMount } from "solid-js";

const G = globalThis as unknown as { __trespassHydrated?: boolean };

/** Marks the document as hydrated (called once from the root document). */
export function markHydrated() {
  G.__trespassHydrated = true;
  document.documentElement.setAttribute("data-hydrated", "");
}

/**
 * False during SSR and the hydration render (so markup matches), true once
 * mounted. On client-side navigations after the first hydration it starts true.
 */
export function useHydrated(): () => boolean {
  const [hydrated, setHydrated] = createSignal(
    typeof window !== "undefined" && G.__trespassHydrated === true,
  );
  onMount(() => setHydrated(true));
  return hydrated;
}

/**
 * A ref for a controlled text input: when hydration claims the server-rendered
 * element and the user already typed into it, hand that text to `set` before
 * Solid writes the (empty) signal value back into the field.
 */
export function adoptTypedValue(
  current: () => string,
  set: (v: string) => void,
): (el: HTMLInputElement | HTMLTextAreaElement) => void {
  return (el) => {
    if (el.value && el.value !== current()) set(el.value);
  };
}
