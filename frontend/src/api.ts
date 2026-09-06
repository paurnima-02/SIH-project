import type { Detection } from "./App";

const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const PREDICT_ENDPOINT = import.meta.env.VITE_PREDICT_ENDPOINT || "/predict";

export interface BackendDetection {
  class?: string;
  label?: string;
  type?: string;
  confidence?: number;
  score?: number;
  bbox?: number[];
  box?: number[];
  lat?: number;
  lng?: number;
  depth?: number;
  dimensions?: string;
  id?: string;
}

export interface BackendPredictResponse {
  detections?: BackendDetection[];
  results?: BackendDetection[];
  objects?: BackendDetection[];
  geotag?: { lat?: number; lng?: number };
  latitude?: number;
  longitude?: number;
  image_width?: number;
  image_height?: number;
  message?: string;
}

function normaliseType(value: string): Detection["type"] {
  const v = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  const known: Record<string, Detection["type"]> = {
    bottle:"bottle", can:"can", chain:"chain", drink_carton:"drink_carton", hook:"hook",
    propeller:"propeller", shampoo_bottle:"shampoo_bottle", standing_bottle:"standing_bottle",
    tire:"tire", valve:"valve", ghost_net:"ghost_net", shipwreck:"shipwreck", pipe:"pipe", cable:"pipe",
  };
  return known[v] || "unknown";
}

function normaliseConfidence(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round((value <= 1 ? value * 100 : value) * 10) / 10;
}

function normaliseBox(box: number[] | undefined, imageWidth?: number, imageHeight?: number) {
  if (!box || box.length < 4) return { x: 0, y: 0, w: 10, h: 10 };

  // Preferred backend contract: [x, y, width, height] in pixels.
  let [x, y, w, h] = box;

  // If four values look like xyxy, convert them to xywh.
  if (w > x && h > y && imageWidth && imageHeight && w <= imageWidth && h <= imageHeight) {
    const looksLikeXYXY = w > imageWidth * 0.55 || h > imageHeight * 0.55;
    if (looksLikeXYXY) {
      w -= x;
      h -= y;
    }
  }

  if (imageWidth && imageHeight) {
    return {
      x: Math.max(0, Math.min(100, (x / imageWidth) * 100)),
      y: Math.max(0, Math.min(100, (y / imageHeight) * 100)),
      w: Math.max(1, Math.min(100, (w / imageWidth) * 100)),
      h: Math.max(1, Math.min(100, (h / imageHeight) * 100)),
    };
  }

  // Also tolerate a backend that already sends percentages.
  return { x, y, w, h };
}

export async function predictImage(file: File): Promise<Detection[]> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(`${API_BASE_URL}${PREDICT_ENDPOINT}`, {
    method: "POST",
    body: formData,
  });

  const raw = await response.text();
  let data: BackendPredictResponse | BackendDetection[];
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Backend returned invalid JSON (${response.status}).`);
  }

  if (!response.ok) {
    const message = !Array.isArray(data) && data?.message ? data.message : `Request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const payload = Array.isArray(data) ? { detections: data } : data;
  const items = payload.detections || payload.results || payload.objects || [];
  const fallbackLat = payload.geotag?.lat ?? payload.latitude ?? 0;
  const fallbackLng = payload.geotag?.lng ?? payload.longitude ?? 0;

  return items.map((item, index) => {
    const label = item.class || item.label || item.type || "Unknown";
    const confidence = normaliseConfidence(item.confidence ?? item.score);
    const box = normaliseBox(item.bbox || item.box, payload.image_width, payload.image_height);
    const type = normaliseType(label);
    const mapX = Math.max(5, Math.min(95, box.x + box.w / 2));
    const mapY = Math.max(5, Math.min(95, box.y + box.h / 2));

    return {
      id: item.id || `D-${String(index + 1).padStart(4, "0")}`,
      type,
      label,
      confidence,
      lat: item.lat ?? fallbackLat,
      lng: item.lng ?? fallbackLng,
      depth: item.depth ?? 0,
      dimensions: item.dimensions || "—",
      scanId: file.name,
      timestamp: new Date().toISOString(),
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      mapX,
      mapY,
    } satisfies Detection;
  });
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}
