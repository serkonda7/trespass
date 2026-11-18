// The basemap style is built in code from @protomaps/basemaps (DESIGN §7.1).
// Every URL is same-origin: tiles, glyphs and sprites are served by this app.
// No third-party URL ever enters the runtime style.
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

export const MAP_ATTRIBUTION = "© OpenStreetMap contributors, © Protomaps";

export function buildMapStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    name: "Trespass",
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/v4/light`,
    sources: {
      protomaps: {
        type: "vector",
        tiles: [`${origin}/tiles/{z}/{x}/{y}.mvt`],
        maxzoom: 15,
        attribution: MAP_ATTRIBUTION,
      },
    },
    layers: layers("protomaps", namedFlavor("light"), { lang: "de" }),
  } as unknown as StyleSpecification;
}
