// Small GeoJSON shapes shared by the schema, the service and the serializers.
// Kept dependency-free so both client and server can import them.

/** A WGS84 point: latitude first, longitude second (as in the UI and inputs). */
export type Point = { lat: number; lon: number };

export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

/** A closed bounding box. Longitudes may cross the antimeridian (see distance.ts). */
export type Bbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};
