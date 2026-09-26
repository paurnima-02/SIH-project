// src/detectionsReport.ts
//
// Thin fetch wrapper around GET /detections/report. Lives next to api.ts
// (same folder, same level) rather than folded into it, so it doesn't
// touch predictImage or anything else already working there.
//
// Field mapping below is taken directly from main.py's
// get_detection_report(): it returns
//   { success, total_detections, detections: [ {...}, ... ] }
// where each entry has detection_id / class / confidence / latitude /
// longitude / dimensions / survey_id / status / missed_cycles /
// last_seen / created_at / updated_at — NOT id/type/scanId/timestamp.
// This module translates that into the shape the rest of the frontend
// (DebrisHeatmap, and later the report screen if it's wired to live
// data) actually wants to consume.

import { getApiBaseUrl } from "./api";

export interface ReportDetection {
  id: string;
  type: string;               // raw YOLO class name, e.g. "ghost_net"
  label: string;               // same value, for display
  confidence: number;          // always normalized to 0–100, see normaliseConfidence below
  scanId: string;               // maps from survey_id
  timestamp: string;             // maps from created_at
  latitude: number | null;
  longitude: number | null;
  status?: string;                // NEW | CONFIRMED | STATIONARY | DRIFTING | MISSING | RESOLVED
  missedCycles?: number;
  lastSeen?: string | null;
  dimensions?: string;             // raw "W x H px" string from the backend, not usable as x/y/w/h %
}

// Raw shape exactly as main.py's get_detection_report() serializes it.
interface RawDetectionEntry {
  detection_id?: number | string;
  class?: string;
  confidence?: number; // 0–1, straight from YOLO's box.conf[0]
  latitude?: number | null;
  longitude?: number | null;
  dimensions?: string;
  survey_id?: string;
  status?: string;
  missed_cycles?: number;
  last_seen?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface RawReportResponse {
  success?: boolean;
  total_detections?: number;
  detections?: RawDetectionEntry[];
}

const API_BASE_URL = getApiBaseUrl();

/**
 * Mirrors api.ts's normaliseConfidence exactly, so a detection looks the
 * same (0–100, one decimal place) whether it came from POST /predict or
 * GET /detections/report. Duplicated rather than imported because the
 * original isn't exported from api.ts — export it there and swap this
 * for an import if you'd rather have one copy. Backend confidence here
 * is always 0–1 (round(box.conf[0], 4) in main.py), so this always takes
 * the *100 branch in practice, but the guard is kept for parity with api.ts.
 */
function normaliseConfidence(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round((value <= 1 ? value * 100 : value) * 10) / 10;
}

function normalize(payload: unknown): ReportDetection[] {
  const raw: RawDetectionEntry[] = Array.isArray(payload)
    ? (payload as RawDetectionEntry[])
    : (payload as RawReportResponse)?.detections ?? [];

  return raw.map(d => ({
    id: d.detection_id != null ? String(d.detection_id) : "",
    type: (d.class || "unknown").toLowerCase(),
    label: d.class || "Unknown",
    confidence: normaliseConfidence(d.confidence),
    scanId: d.survey_id || "",
    timestamp: d.created_at || d.last_seen || new Date().toISOString(),
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    status: d.status,
    missedCycles: d.missed_cycles,
    lastSeen: d.last_seen ?? null,
    dimensions: d.dimensions,
  }));
}

export async function fetchDetectionsReport(signal?: AbortSignal): Promise<ReportDetection[]> {
  const res = await fetch(`${API_BASE_URL}/detections/report`, { signal });
  if (!res.ok) {
    throw new Error(`GET /detections/report failed: ${res.status} ${res.statusText}`);
  }
  const payload = await res.json();
  return normalize(payload);
}

/** Only detections with a usable lat/lon — everything the heatmap and GeoJSON export need. */
export function withValidCoords(dets: ReportDetection[]): (ReportDetection & { latitude: number; longitude: number })[] {
  return dets.filter(
    (d): d is ReportDetection & { latitude: number; longitude: number } =>
      typeof d.latitude === "number" &&
      typeof d.longitude === "number" &&
      !Number.isNaN(d.latitude) &&
      !Number.isNaN(d.longitude)
  );
}