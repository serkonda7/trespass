// The basemap style is built in code from @protomaps/basemaps (DESIGN §7.1).
// Every URL is same-origin: tiles, glyphs and sprites are served by this app.
// No third-party URL ever enters the runtime style.
import { type Flavor, layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

export const MAP_ATTRIBUTION = "© OpenStreetMap contributors, © Protomaps";

/** Protomaps' dark flavor, nudged towards the app's warm "field notebook" greys. */
const FLAVOR: Flavor = {
  ...namedFlavor("dark"),
  background: "#2b2926",
  earth: "#1d1c1a",
  water: "#252b31",
  park_a: "#1f231d",
  park_b: "#222720",
  wood_a: "#1f231d",
  wood_b: "#222720",
  buildings: "#141311",
};

export function buildMapStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    name: "Trespass",
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/v4/dark`,
    sources: {
      protomaps: {
        type: "vector",
        tiles: [`${origin}/tiles/{z}/{x}/{y}.mvt`],
        maxzoom: 15,
        attribution: MAP_ATTRIBUTION,
      },
    },
    layers: layers("protomaps", FLAVOR, { lang: "de" }),
  } as unknown as StyleSpecification;
}
