// Solid wrapper around MapLibre GL. The library is imported dynamically in
// onMount so SSR never touches WebGL/window. Pins come from the server's
// already-serialized data; this component never computes visibility.

import type { Point } from "@trespass/shared/geo/types";
import type { LocationStatus } from "@trespass/shared/locations/types";
import { createEffect, createSignal, type JSX, onCleanup, onMount } from "solid-js";
import { statusColor } from "~/lib/locations/status";
import "maplibre-gl/dist/maplibre-gl.css";

export type MapPoint = {
  id: string;
  name: string;
  status: LocationStatus;
  categoryIcon: string;
  exact: boolean;
  lat: number;
  lon: number;
};

export type MapBbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

type MapLibre = typeof import("maplibre-gl");
type MapInstance = import("maplibre-gl").Map;
type MarkerInstance = import("maplibre-gl").Marker;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** An approximate circle ring in degrees, for the fuzz-radius display only. */
function circleRing(center: Point, radiusM: number): number[][] {
  const ring: number[][] = [];
  const latDelta = radiusM / 111_320;
  const lonDelta = radiusM / (111_320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    ring.push([
      clamp(center.lon + lonDelta * Math.cos(a), -180, 180),
      clamp(center.lat + latDelta * Math.sin(a), -90, 90),
    ]);
  }
  return ring;
}

const feature = (p: MapPoint) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
  properties: { id: p.id, name: p.name, status: p.status, icon: p.categoryIcon },
});

export function MapView(props: {
  points?: readonly MapPoint[];
  onMoveEnd?: (bbox: MapBbox) => void;
  /** When set, a click/long-press on the map picks a coordinate. */
  onPick?: (point: Point) => void;
  marker?: Point | null;
  circle?: { point: Point; radiusM: number } | null;
  /** Straight lines between consecutive points (trip route preview). */
  route?: readonly Point[] | null;
  /** Outlines such as research search areas; rings in GeoJSON [lon, lat] order. */
  polygons?: readonly (readonly (readonly [number, number])[])[] | null;
  /** Link target of a pin's popup (default: the location page). */
  pinHref?: (id: string) => string;
  /** Fit to this box whenever it changes (e.g. after the first data load). */
  fit?: MapBbox | null;
  class?: string;
  /** Accessible name for the map region. */
  label: string;
}): JSX.Element {
  let container: HTMLDivElement | undefined;
  let map: MapInstance | undefined;
  let marker: MarkerInstance | undefined;
  let lib: MapLibre | undefined;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  const [ready, setReady] = createSignal(false);

  const bboxOf = (m: MapInstance): MapBbox => {
    const b = m.getBounds();
    return {
      minLat: clamp(b.getSouth(), -90, 90),
      maxLat: clamp(b.getNorth(), -90, 90),
      minLon: clamp(b.getWest(), -180, 180),
      maxLon: clamp(b.getEast(), -180, 180),
    };
  };

  onMount(async () => {
    // Everything below is browser-only. Vite replaces import.meta.env.SSR with
    // a constant, so in the SSR build the early return makes Rollup drop the
    // dynamic imports — and with them maplibre-gl and @protomaps/basemaps —
    // from the server bundle. The CSS import at module scope is just an asset.
    if (import.meta.env.SSR) return;
    // CSP: MapLibre's default worker is a blob URL. Serve the package's own
    // standalone worker from our origin instead (see scripts/fetch-map-assets.ts).
    const [maplibre, style] = await Promise.all([import("maplibre-gl"), import("~/lib/map/style")]);
    lib = maplibre;
    const { buildMapStyle } = style;
    if (!container || !lib) return;
    lib.setWorkerUrl("/map/maplibre-gl-worker.mjs");

    const m = new lib.Map({
      container,
      style: buildMapStyle(window.location.origin),
      center: [10.5, 51],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map = m;
    m.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");

    m.on("load", () => {
      m.addSource("locations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: (props.points ?? []).map(feature) },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 55,
      });
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "locations",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#334155",
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 30],
        },
      });
      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "locations",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
        },
      });
      m.addLayer({
        id: "location-pins",
        type: "circle",
        source: "locations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "status"],
            ...(
              ["idea", "researched", "planned", "sealed", "redeveloped", "demolished"] as const
            ).flatMap((s) => [s, statusColor(s)]),
            "#94a3b8",
          ] as never,
          "circle-radius": 8,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0f1216",
        },
      });
      m.addLayer({
        id: "location-icons",
        type: "symbol",
        source: "locations",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "icon"],
          "text-size": 10,
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });
      m.addSource("fuzz", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "fuzz-fill",
        type: "fill",
        source: "fuzz",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 },
      });
      m.addLayer({
        id: "fuzz-line",
        type: "line",
        source: "fuzz",
        paint: { "line-color": "#38bdf8", "line-dasharray": [2, 2], "line-width": 2 },
      });
      m.addSource("areas", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer(
        {
          id: "areas-fill",
          type: "fill",
          source: "areas",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#a855f7", "fill-opacity": 0.12 },
        },
        "clusters",
      );
      m.addLayer(
        {
          id: "areas-line",
          type: "line",
          source: "areas",
          paint: { "line-color": "#a855f7", "line-width": 2 },
        },
        "clusters",
      );
      m.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer(
        {
          id: "route-line",
          type: "line",
          source: "route",
          paint: { "line-color": "#f97316", "line-width": 3, "line-dasharray": [3, 1.5] },
        },
        "clusters",
      );
      setReady(true);
      const fit = props.fit;
      if (fit) fitBounds(fit);
    });

    m.on("moveend", () => props.onMoveEnd?.(bboxOf(m)));

    m.on("click", "clusters", async (e) => {
      const f = e.features?.[0];
      const id = f?.properties?.cluster_id as number | undefined;
      const source = m.getSource("locations") as import("maplibre-gl").GeoJSONSource | undefined;
      if (!f || id === undefined || !source) return;
      const zoom = await source.getClusterExpansionZoom(id);
      m.easeTo({
        center: (f.geometry as { coordinates: unknown }).coordinates as [number, number],
        zoom,
      });
    });

    m.on("click", "location-pins", (e) => {
      const f = e.features?.[0];
      if (!f || !lib) return;
      longPressed = true; // a pin click is not a coordinate pick
      const coords = (f.geometry as { coordinates: unknown }).coordinates as [number, number];
      const content = document.createElement("div");
      const a = document.createElement("a");
      const pinId = String(f.properties?.id ?? "");
      a.href = props.pinHref ? props.pinHref(pinId) : `/locations/${pinId}`;
      a.className = "font-semibold text-primary underline underline-offset-4";
      a.textContent = String(f.properties?.name ?? "");
      content.append(a);
      new lib.Popup({ closeButton: false, maxWidth: "240px" })
        .setLngLat(coords)
        .setDOMContent(content)
        .addTo(m);
    });

    if (props.onPick) {
      m.on("click", (e) => {
        if (longPressed || m.queryRenderedFeatures(e.point, { layers: ["location-pins"] }).length) {
          longPressed = false;
          return;
        }
        props.onPick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      });
      const canvas = m.getCanvas();
      canvas.addEventListener("pointerdown", (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        longPressed = false;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          const ll = m.unproject([x, y]);
          longPressed = true;
          props.onPick?.({ lat: ll.lat, lon: ll.lng });
        }, 500);
      });
      const cancel = () => clearTimeout(longPressTimer);
      canvas.addEventListener("pointerup", cancel);
      canvas.addEventListener("pointermove", cancel);
      canvas.addEventListener("pointercancel", cancel);
      onCleanup(() => {
        clearTimeout(longPressTimer);
        canvas.removeEventListener("pointerup", cancel);
        canvas.removeEventListener("pointermove", cancel);
        canvas.removeEventListener("pointercancel", cancel);
      });
    }
  });

  const fitBounds = (bbox: MapBbox) => {
    if (!map) return;
    map.fitBounds(
      [
        [bbox.minLon, bbox.minLat],
        [bbox.maxLon, bbox.maxLat],
      ],
      { padding: 32, maxZoom: 13, duration: 0 },
    );
  };

  createEffect(() => {
    const points = props.points ?? [];
    if (!ready() || !map) return;
    const source = map.getSource("locations") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: points.map(feature) });
  });

  createEffect(() => {
    const circle = props.circle;
    if (!ready() || !map) return;
    const source = map.getSource("fuzz") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: circle
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [circleRing(circle.point, circle.radiusM)],
              },
              properties: {},
            },
          ]
        : [],
    });
  });

  createEffect(() => {
    const route = props.route ?? [];
    if (!ready() || !map) return;
    const source = map.getSource("route") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features:
        route.length > 1
          ? [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: route.map((p) => [p.lon, p.lat]) },
                properties: {},
              },
            ]
          : [],
    });
  });

  createEffect(() => {
    const polygons = props.polygons ?? [];
    if (!ready() || !map) return;
    const source = map.getSource("areas") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: polygons
        .filter((ring) => ring.length >= 2)
        .map((ring) => {
          const coords = ring.map(([lon, lat]) => [lon, lat]);
          const first = coords[0]!;
          const last = coords[coords.length - 1]!;
          const closed = coords.length >= 4 && first[0] === last[0] && first[1] === last[1];
          return {
            type: "Feature" as const,
            geometry: closed
              ? { type: "Polygon" as const, coordinates: [coords] }
              : { type: "LineString" as const, coordinates: coords },
            properties: {},
          };
        }),
    });
  });

  createEffect(() => {
    const point = props.marker;
    if (!ready() || !map || !lib) return;
    if (!point) {
      marker?.remove();
      marker = undefined;
      return;
    }
    if (!marker)
      marker = new lib.Marker({ color: "#38bdf8" }).setLngLat([point.lon, point.lat]).addTo(map);
    else marker.setLngLat([point.lon, point.lat]);
  });

  createEffect(() => {
    const fit = props.fit;
    if (!ready() || !fit) return;
    fitBounds(fit);
  });

  onCleanup(() => {
    clearTimeout(longPressTimer);
    marker?.remove();
    map?.remove();
    map = undefined;
  });

  return <section ref={container} class={props.class ?? "size-full"} aria-label={props.label} />;
}
