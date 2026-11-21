// MapView that loads nothing until the page is idle and the map is near the
// viewport. Pages where the map is secondary (the location form) use this so
// MapLibre (~300 kB + style + worker) never competes with the route chunk,
// hydration or the first interaction. The type import keeps map-view out of
// the importing chunk.

import { createSignal, type JSX, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import type { MapView as MapViewComponent } from "./map-view";

type Props = Parameters<typeof MapViewComponent>[0];

const MapView = lazy(() => import("./map-view").then((mod) => ({ default: mod.MapView })));

const whenIdle = (fn: () => void): (() => void) => {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
};

export function LazyMapView(props: Props): JSX.Element {
  let host: HTMLDivElement | undefined;
  const [show, setShow] = createSignal(false);

  // onMount runs only in the browser, after hydration: SSR and the hydration
  // pass always render the placeholder.
  onMount(() => {
    let cancelIdle: (() => void) | undefined;
    // After the window `load` event (all route chunks, fonts and images are
    // in), then on idle.
    const start = () => {
      if (document.readyState === "complete") {
        cancelIdle = whenIdle(() => setShow(true));
        return;
      }
      const onLoad = () => {
        cancelIdle = whenIdle(() => setShow(true));
      };
      window.addEventListener("load", onLoad, { once: true });
      cancelIdle = () => window.removeEventListener("load", onLoad);
    };
    if (!("IntersectionObserver" in window) || !host) {
      start();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          start();
        },
        { rootMargin: "200px" },
      );
      io.observe(host);
      onCleanup(() => io.disconnect());
    }
    onCleanup(() => cancelIdle?.());
  });

  const placeholder = () => (
    <div class="size-full animate-pulse bg-muted/40 grid-paper" aria-hidden="true" />
  );

  return (
    <div ref={host} class={props.class ?? "size-full"}>
      <Show when={show()} fallback={placeholder()}>
        <Suspense fallback={placeholder()}>
          <MapView {...props} class="size-full" />
        </Suspense>
      </Show>
    </div>
  );
}
