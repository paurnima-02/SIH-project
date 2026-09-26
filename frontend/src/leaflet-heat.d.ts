// src/leaflet-heat.d.ts
// leaflet.heat has no official @types package. This is enough to satisfy
// TS for the usage in components/DebrisHeatmap.tsx (L.heatLayer(...)).
import "leaflet";

declare module "leaflet" {
  type HeatLatLngTuple = [number, number, number?]; // lat, lng, intensity

  interface HeatMapOptions {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: Record<number, string>;
  }

  interface HeatLayer extends L.Layer {
    setLatLngs(latlngs: HeatLatLngTuple[]): this;
    addLatLng(latlng: HeatLatLngTuple): this;
    setOptions(options: HeatMapOptions): this;
    redraw(): this;
  }

  function heatLayer(latlngs: HeatLatLngTuple[], options?: HeatMapOptions): HeatLayer;
}