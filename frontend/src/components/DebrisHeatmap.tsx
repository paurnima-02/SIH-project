// src/components/DebrisHeatmap.tsx

import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

import {
  fetchDetectionsReport,
  withValidCoords,
  type ReportDetection,
} from "../detectionsReport";

// Match the app's existing design tokens
const C = {
  bg: "#E9E7E2",
  card: "#F7F5F1",
  border: "#C7D0D3",
  borderMd: "#9AABB7",
  navy: "#1D3539",
  navyMd: "#2D5056",
  muted: "#4D6D76",
  faint: "#7E929A",
  blue: "#4D6D76",
  blueBg: "#DDE5E5",
  orange: "#F4802B",
  green: "#4C9A6B",
  redAlert: "#D64545",
};

const REFRESH_MS = 30_000;

// Default starting location
const DEFAULT_CENTER: [number, number] = [45.05, -83.25];
const DEFAULT_ZOOM = 9;

function tier(c: number): "high" | "medium" | "low" {
  return c >= 75 ? "high" : c >= 40 ? "medium" : "low";
}

// ─────────────────────────────────────────────────────────────
// HEATMAP LAYER
// ─────────────────────────────────────────────────────────────

function HeatLayer({
  points,
}: {
  points: [number, number, number][];
}) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (!layerRef.current) {
      layerRef.current = L.heatLayer(points, {
        radius: 38,
        blur: 28,
        maxZoom: 12,
        max: 1.0,
        minOpacity: 0.45,

        gradient: {
          0.0: "#2E7DFF",
          0.25: "#39C6FF",
          0.5: "#FFD43B",
          0.7: "#FF9F1C",
          0.85: "#FF4D00",
          1.0: "#D90000",
        },
      }).addTo(map);
    } else {
      layerRef.current.setLatLngs(points);
    }
  }, [points, map]);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

// ─────────────────────────────────────────────────────────────
// AUTO FIT
// ─────────────────────────────────────────────────────────────

function AutoFit({
  points,
}: {
  points: [number, number, number][];
}) {
  const map = useMap();
  const didFit = useRef(false);

  useEffect(() => {
    if (didFit.current || points.length === 0) return;

    const bounds = L.latLngBounds(
      points.map(([lat, lng]) => [lat, lng] as [number, number])
    );

    map.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 10,
    });

    didFit.current = true;
  }, [points, map]);

  return null;
}

// ─────────────────────────────────────────────────────────────
// HEATMAP LEGEND
// ─────────────────────────────────────────────────────────────

function HeatLegend() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        zIndex: 1000,
        background: "rgba(255,255,255,0.95)",
        border: `1px solid ${C.border}`,
        padding: "9px 11px",
        borderRadius: 3,
        boxShadow: "0 1px 5px rgba(0,0,0,0.15)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: C.navy,
          letterSpacing: ".05em",
          marginBottom: 6,
        }}
      >
        DEBRIS DENSITY
      </div>

      <div
        style={{
          width: 170,
          height: 11,
          background:
            "linear-gradient(to right, #2E7DFF, #39C6FF, #FFD43B, #FF9F1C, #FF4D00, #D90000)",
          borderRadius: 2,
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 8,
          color: C.muted,
          marginTop: 4,
        }}
      >
        <span>LOW</span>
        <span>HIGH</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export default function DebrisHeatmap() {
  const [detections, setDetections] = useState<ReportDetection[]>([]);
  const [status, setStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const [error, setError] = useState<string | null>(null);

  const [lastUpdated, setLastUpdated] =
    useState<Date | null>(null);

  // ─────────────────────────────────────────────────────────
  // LOAD DETECTIONS
  // ─────────────────────────────────────────────────────────

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await fetchDetectionsReport(signal);

        setDetections(data);
        setStatus("ready");
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if ((err as any)?.name === "AbortError") {
          return;
        }

        setStatus("error");

        setError(
          err instanceof Error
            ? err.message
            : "Unable to reach /detections/report"
        );
      }
    },
    []
  );

  // ─────────────────────────────────────────────────────────
  // AUTO REFRESH
  // ─────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();

    load(controller.signal);

    const interval = setInterval(() => {
      load();
    }, REFRESH_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);

  // ─────────────────────────────────────────────────────────
  // VALID GEOTAGGED DETECTIONS
  // ─────────────────────────────────────────────────────────

  const geo = withValidCoords(detections);

  // ─────────────────────────────────────────────────────────
  // HEATMAP POINTS
  //
  // IMPORTANT:
  // Heatmap represents DENSITY, not confidence.
  //
  // Every detection contributes intensity = 1.
  // Multiple detections close together automatically
  // create a hotter area.
  // ─────────────────────────────────────────────────────────

  const points: [number, number, number][] = geo.map((d) => [
    d.latitude,
    d.longitude,
    1,
  ]);

  // ─────────────────────────────────────────────────────────
  // COUNTS
  // ─────────────────────────────────────────────────────────

  const counts = {
    total: geo.length,

    high: geo.filter(
      (d) => tier(d.confidence) === "high"
    ).length,

    medium: geo.filter(
      (d) => tier(d.confidence) === "medium"
    ).length,

    low: geo.filter(
      (d) => tier(d.confidence) === "low"
    ).length,

    skipped: detections.length - geo.length,
  };

  // ─────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: C.bg,
      }}
    >
      {/* ───────────────────────────────────────────────
          TOOLBAR
      ─────────────────────────────────────────────── */}

      <div
        style={{
          height: 36,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 10px",
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: C.navy,
          }}
        >
          Debris Heatmap
        </span>

        <span
          className="font-mono"
          style={{
            fontSize: 9,
            color: C.faint,
          }}
        >
          GET /detections/report · refresh 30s
        </span>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {/* Loading */}
          {status === "loading" && (
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                color: C.blue,
              }}
            >
              Loading…
            </span>
          )}

          {/* Error */}
          {status === "error" && (
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                color: C.redAlert,
              }}
            >
              {error}
            </span>
          )}

          {/* Updated */}
          {status === "ready" && lastUpdated && (
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                color: C.faint,
              }}
            >
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}

          {/* Refresh */}
          <button
            onClick={() => load()}
            style={{
              fontSize: 10,
              fontWeight: 500,
              padding: "3px 8px",
              borderRadius: 2,
              background: "transparent",
              color: C.blue,
              border: `1px solid ${C.blue}55`,
              cursor: "pointer",
            }}
          >
            Refresh now
          </button>
        </div>
      </div>

      {/* ───────────────────────────────────────────────
          MAIN CONTENT
      ─────────────────────────────────────────────── */}

      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
        }}
      >
        {/* ─────────────────────────────────────────────
            MAP
        ───────────────────────────────────────────── */}

        <div
          style={{
            flex: 1,
            position: "relative",
          }}
        >
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            style={{
              height: "100%",
              width: "100%",
              background: "#dfe9ee",
            }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* ACTUAL HEATMAP */}
            <HeatLayer points={points} />

            {/* AUTO FIT TO DETECTIONS */}
            <AutoFit points={points} />
          </MapContainer>

          {/* ─────────────────────────────────────────
              HEATMAP LEGEND
          ───────────────────────────────────────── */}

          {geo.length > 0 && <HeatLegend />}

          {/* ─────────────────────────────────────────
              NO DATA MESSAGE
          ───────────────────────────────────────── */}

          {status === "ready" && geo.length === 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  background: "rgba(255,255,255,.94)",
                  border: `1px solid ${C.border}`,
                  textAlign: "center",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: C.navyMd,
                    fontWeight: 600,
                  }}
                >
                  No geotagged detections yet
                </div>

                <div
                  className="font-mono"
                  style={{
                    fontSize: 9,
                    color: C.faint,
                    marginTop: 3,
                  }}
                >
                  Detections without a valid lat/lon are
                  excluded from the heatmap.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─────────────────────────────────────────────
            SIDE STATS PANEL
        ───────────────────────────────────────────── */}

        <div
          style={{
            width: 200,
            flexShrink: 0,
            borderLeft: `1px solid ${C.border}`,
            background: C.card,
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* Total */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: C.muted,
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              Mapped detections
            </div>

            <div
              className="font-mono"
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: C.navy,
                marginTop: 4,
              }}
            >
              {counts.total}
            </div>
          </div>

          {/* Confidence categories */}
          {[
            ["High (≥75%)", counts.high, C.orange],
            ["Review (40–74%)", counts.medium, "#B87B1A"],
            ["Low (<40%)", counts.low, C.green],
          ].map(([label, val, color]) => (
            <div
              key={label as string}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: C.muted,
                }}
              >
                {label as string}
              </span>

              <span
                className="font-mono"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: color as string,
                }}
              >
                {val as number}
              </span>
            </div>
          ))}

          {/* No coordinates */}
          <div
            style={{
              borderTop: `1px solid ${C.border}`,
              paddingTop: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: C.faint,
                }}
              >
                No coords
              </span>

              <span
                className="font-mono"
                style={{
                  fontSize: 10,
                  color: C.faint,
                }}
              >
                {counts.skipped}
              </span>
            </div>
          </div>

          {/* Explanation */}
          <div
            style={{
              marginTop: "auto",
              paddingTop: 10,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                lineHeight: 1.5,
                color: C.faint,
              }}
            >
              Heat intensity represents the concentration
              of debris detections. Areas with more nearby
              detections appear hotter.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}