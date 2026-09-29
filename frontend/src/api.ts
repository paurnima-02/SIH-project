import type { Detection } from "./App";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8001"
).replace(/\/$/, "");

const PREDICT_ENDPOINT =
  import.meta.env.VITE_PREDICT_ENDPOINT || "/predict";

export interface BackendDetection {
  class?: string;
  label?: string;
  type?: string;
  confidence?: number;
  score?: number;
  bbox?: number[];
  box?: number[];
  id?: string | number;
}

export interface BackendPredictResponse {
  success?: boolean;
  detections?: BackendDetection[];
  results?: BackendDetection[];
  objects?: BackendDetection[];
  geotag?: { lat?: number; lng?: number };
  latitude?: number;
  longitude?: number;
  image_width?: number;
  image_height?: number;
  original_image?: string;
  annotated_image?: string;
  waterfall_file?: string;
  navigation_file?: string;
  xtf_file?: string;
  navigation_points?: number;
  survey_latitude?: number | null;
  survey_longitude?: number | null;
  detection_count?: number;
  saved_detection_ids?: number[];
  status?: string;
  message?: string;
  detail?: string;
}

function normaliseType(value: string): Detection["type"] {
  const v = value.toLowerCase().trim().replace(/[\s-]+/g, "_");

  const known: Record<string, Detection["type"]> = {
    bottle: "bottle",
    can: "can",
    chain: "chain",
    drink_carton: "drink_carton",
    hook: "hook",
    propeller: "propeller",
    shampoo_bottle: "shampoo_bottle",
    standing_bottle: "standing_bottle",
    tire: "tire",
    valve: "valve",
    ghost_net: "ghost_net",
    shipwreck: "shipwreck",
    pipe: "pipe",
    cable: "pipe",
    mine: "mine",
    mine_cylinder: "mine",
    crab_pot: "unknown",
    submarine_pipeline: "pipe",
  };

  return known[v] || "unknown";
}

function normaliseConfidence(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round((value <= 1 ? value * 100 : value) * 10) / 10;
}

// FastAPI returns YOLO's box.xyxy: [x1, y1, x2, y2] in pixels.
function normaliseBox(
  box: number[] | undefined,
  imageWidth?: number,
  imageHeight?: number
) {
  if (!box || box.length < 4) {
    return { x: 0, y: 0, w: 10, h: 10 };
  }

  const [x1, y1, x2, y2] = box;
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);

  if (!imageWidth || !imageHeight) {
    return { x: x1, y: y1, w: width, h: height };
  }

  return {
    x: Math.max(0, Math.min(100, (x1 / imageWidth) * 100)),
    y: Math.max(0, Math.min(100, (y1 / imageHeight) * 100)),
    w: Math.max(0.5, Math.min(100, (width / imageWidth) * 100)),
    h: Math.max(0.5, Math.min(100, (height / imageHeight) * 100)),
  };
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
    throw new Error(
      `Backend returned invalid JSON (${response.status}).`
    );
  }

  if (!response.ok) {
    const message = !Array.isArray(data)
      ? data.detail || data.message
      : undefined;

    throw new Error(
      message || `Request failed with HTTP ${response.status}.`
    );
  }

  const payload: BackendPredictResponse = Array.isArray(data)
    ? { detections: data }
    : data;

  const items =
    payload.detections || payload.results || payload.objects || [];

  return items.map((item, index) => {
    const label =
      item.class || item.label || item.type || "Unknown";

    const confidence = normaliseConfidence(
      item.confidence ?? item.score
    );

    const box = normaliseBox(
      item.bbox || item.box,
      payload.image_width,
      payload.image_height
    );

    const type = normaliseType(label);

    const latitude =
      payload.geotag?.lat ?? payload.latitude;

    const longitude =
      payload.geotag?.lng ?? payload.longitude;

    return {
      id:
        item.id ||
        `D-${String(index + 1).padStart(4, "0")}`,
      type,
      label,
      confidence,
      scanId: file.name,
      timestamp: new Date().toISOString(),
      latitude: latitude ?? undefined,
      longitude: longitude ?? undefined,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    } satisfies Detection;
  });
}

// XTF upload → FastAPI /predict-xtf
export async function predictXTF(
  file: File
): Promise<BackendPredictResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(
    `${API_BASE_URL}/predict-xtf`,
    {
      method: "POST",
      body: formData,
    }
  );

  const raw = await response.text();

  let data: BackendPredictResponse;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `Backend returned invalid JSON (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.detail ||
        data.message ||
        `XTF request failed with HTTP ${response.status}.`
    );
  }

  return data;
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export interface SpatialDetection {
  detection_id: number;
  class: string;
  confidence: number;
  latitude?: number | null;
  longitude?: number | null;
  dimensions?: string | null;
  survey_id?: string | number | null;
  status?: string | null;
  missed_cycles?: number | null;
  last_seen?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function getSpatialDetections(): Promise<
  SpatialDetection[]
> {
  const response = await fetch(
    `${API_BASE_URL}/detections/report`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to load detections (${response.status})`
    );
  }

  const data = await response.json();
  return data.detections || [];
}
