import { useEffect, useMemo, useState } from "react";
import {
  getSpatialDetections,
  type SpatialDetection,
} from "../api";

/*
  P4 - Desktop AR Spatial Preview

  Backend flow:
  SQLite -> FastAPI -> GPS detections -> React -> AR-style visualization

  This is a desktop AR preview.
  Detection data comes from the backend.
  Screen placement is calculated from GPS coordinates.

  It does NOT claim to be live camera AR.
*/

interface ScreenPosition {
  left: number;
  top: number;
}

/* =====================================================
   GPS -> DESKTOP AR SCREEN POSITION
===================================================== */

function calculateScreenPositions(
  detections: SpatialDetection[]
): Map<number, ScreenPosition> {
  const positions = new Map<number, ScreenPosition>();

  if (detections.length === 0) {
    return positions;
  }

  const latitudes = detections.map((d) => Number(d.latitude));
  const longitudes = detections.map((d) => Number(d.longitude));

  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);

  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);

  const latRange = Math.max(maxLat - minLat, 0.000001);
  const lonRange = Math.max(maxLon - minLon, 0.000001);

  detections.forEach((d) => {
    const latitude = Number(d.latitude);
    const longitude = Number(d.longitude);

    /*
      Longitude controls horizontal placement.
      Latitude controls vertical placement.

      We keep objects inside the middle 60% of the screen
      so labels do not touch the edges.
    */

    const xRatio = (longitude - minLon) / lonRange;
    const yRatio = (latitude - minLat) / latRange;

    const left = 15 + xRatio * 70;

    // Higher latitude = visually farther/upward.
    const top = 72 - yRatio * 28;

    positions.set(d.detection_id, {
      left,
      top,
    });
  });

  return positions;
}

/* =====================================================
   OBJECT ICON
===================================================== */

function DetectionObject({ label }: { label: string }) {
  const name = label.toLowerCase();

  /* ---------------- BOTTLE ---------------- */

  if (name.includes("bottle")) {
    return (
      <div
        style={{
          width: 28,
          height: 60,
          position: "relative",
          transform: "rotate(58deg)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 7,
            top: 8,
            width: 18,
            height: 45,
            borderRadius: "7px 7px 10px 10px",
            background:
              "linear-gradient(90deg,#0284c7,#38bdf8,#0369a1)",
            border: "1px solid rgba(186,230,253,.8)",
            boxShadow: "0 0 14px rgba(56,189,248,.45)",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 11,
            top: 0,
            width: 10,
            height: 13,
            borderRadius: "3px 3px 0 0",
            background: "#f59e0b",
          }}
        />
      </div>
    );
  }

  /* ---------------- TIRE ---------------- */

  if (name.includes("tire") || name.includes("tyre")) {
    return (
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, transparent 0 28%, #111827 30% 58%, #020617 60% 100%)",
          border: "2px solid #334155",
          boxShadow:
            "0 10px 20px rgba(0,0,0,.35), 0 0 12px rgba(125,211,252,.15)",
          transform: "rotateX(55deg)",
        }}
      />
    );
  }

  /* ---------------- GHOST NET ---------------- */

  if (name.includes("ghost") || name.includes("net")) {
    return (
      <div
        style={{
          width: 70,
          height: 70,
          borderRadius: "50%",
          border: "3px solid #d6c89c",
          backgroundImage:
            "linear-gradient(45deg, transparent 43%, rgba(214,200,156,.75) 44%, rgba(214,200,156,.75) 48%, transparent 49%), linear-gradient(-45deg, transparent 43%, rgba(214,200,156,.75) 44%, rgba(214,200,156,.75) 48%, transparent 49%)",
          backgroundSize: "18px 18px",
          boxShadow: "0 0 15px rgba(214,200,156,.3)",
          transform: "rotate(15deg)",
        }}
      />
    );
  }

  /* ---------------- SHIPWRECK ---------------- */

  if (name.includes("shipwreck") || name.includes("wreck")) {
    return (
      <div
        style={{
          width: 92,
          height: 32,
          position: "relative",
          transform: "rotate(-8deg)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg,#92400e,#451a03)",
            clipPath:
              "polygon(0 25%, 92% 0, 100% 55%, 84% 100%, 12% 88%)",
            borderRadius: 4,
            boxShadow: "0 8px 18px rgba(0,0,0,.35)",
          }}
        />

        <div
          style={{
            position: "absolute",
            width: 28,
            height: 20,
            left: 38,
            top: -15,
            background: "#78350f",
            borderRadius: 3,
          }}
        />
      </div>
    );
  }

  /* ---------------- UNKNOWN ---------------- */

  return (
    <div
      style={{
        width: 45,
        height: 45,
        border: "2px solid #38bdf8",
        transform: "rotate(45deg)",
        background: "rgba(14,116,144,.25)",
        boxShadow: "0 0 15px rgba(56,189,248,.4)",
      }}
    />
  );
}

/* =====================================================
   AR MARKER
===================================================== */

function ARMarker({
  detection,
  position,
}: {
  detection: SpatialDetection;
  position: ScreenPosition;
}) {
  const confidence =
    (detection.confidence || 0) <= 1
      ? Math.round((detection.confidence || 0) * 100)
      : Math.round(detection.confidence || 0);

  return (
    <div
      style={{
        position: "absolute",
        left: `${position.left}%`,
        top: `${position.top}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 5,
      }}
    >
      {/* Detection information */}

      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "calc(100% + 12px)",
          transform: "translateX(-50%)",
          background: "rgba(2,20,35,.92)",
          border: "1px solid rgba(56,189,248,.55)",
          borderRadius: 8,
          padding: "7px 10px",
          minWidth: 145,
          color: "white",
          fontSize: 11,
          boxShadow: "0 5px 18px rgba(0,0,0,.25)",
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            color: "#e0f2fe",
          }}
        >
          {detection.class || "Unknown"}
        </div>

        <div
          style={{
            color: "#7dd3fc",
            marginTop: 3,
          }}
        >
          Confidence: {confidence}%
        </div>

        <div
          style={{
            color: "#bae6fd",
            marginTop: 2,
          }}
        >
          Status: {detection.status || "UNKNOWN"}
        </div>

        <div
          style={{
            marginTop: 4,
            opacity: 0.7,
            fontSize: 9,
          }}
        >
          {Number(detection.latitude).toFixed(6)},{" "}
          {Number(detection.longitude).toFixed(6)}
        </div>
      </div>

      {/* AR target corners */}

      <div
        style={{
          width: 105,
          height: 82,
          display: "grid",
          placeItems: "center",
          border: "1px solid rgba(56,189,248,.5)",
          borderRadius: 8,
          background: "rgba(14,116,144,.07)",
          boxShadow:
            "0 0 22px rgba(56,189,248,.12), inset 0 0 18px rgba(56,189,248,.06)",
        }}
      >
        <DetectionObject label={detection.class || "Unknown"} />
      </div>

      {/* GPS point */}

      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#38bdf8",
          margin: "7px auto 0",
          boxShadow: "0 0 9px #38bdf8",
        }}
      />
    </div>
  );
}

/* =====================================================
   MAIN AR PREVIEW
===================================================== */

export default function ARPreview() {
  const [detections, setDetections] =
    useState<SpatialDetection[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getSpatialDetections()
      .then((data) => {
        console.log("AR detections from backend:", data);
        setDetections(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Could not load AR detections:", err);
        setError("Could not load detection data.");
        setLoading(false);
      });
  }, []);

  const validDetections = useMemo(
    () =>
      detections.filter(
        (d) =>
          d.latitude !== null &&
          d.latitude !== undefined &&
          d.longitude !== null &&
          d.longitude !== undefined
      ),
    [detections]
  );

  const screenPositions = useMemo(
    () => calculateScreenPositions(validDetections),
    [validDetections]
  );

  return (
    <div
      style={{
        width: "100%",
        height: "500px",
        position: "relative",
        overflow: "hidden",
        borderRadius: "16px",
        background:
          "linear-gradient(180deg,#06283d 0%,#075985 38%,#155e75 72%,#164e63 100%)",
        border: "1px solid rgba(80,180,220,.3)",
      }}
    >
      {/* ================= WATER LIGHT ================= */}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% -15%,rgba(125,211,252,.32),transparent 52%)",
        }}
      />

      {/* ================= WATER RAYS ================= */}

      <div
        style={{
          position: "absolute",
          left: "18%",
          top: "-20%",
          width: "14%",
          height: "85%",
          transform: "rotate(12deg)",
          background:
            "linear-gradient(180deg,rgba(186,230,253,.10),transparent)",
          filter: "blur(12px)",
        }}
      />

      <div
        style={{
          position: "absolute",
          right: "23%",
          top: "-15%",
          width: "12%",
          height: "80%",
          transform: "rotate(-12deg)",
          background:
            "linear-gradient(180deg,rgba(186,230,253,.08),transparent)",
          filter: "blur(14px)",
        }}
      />

      {/* ================= SEAFLOOR ================= */}

      <div
        style={{
          position: "absolute",
          left: "-10%",
          right: "-10%",
          bottom: "-15%",
          height: "46%",
          borderRadius: "50% 50% 0 0",
          background:
            "linear-gradient(180deg,#52796f,#355f5b)",
          opacity: 0.75,
        }}
      />

      {/* ================= SPATIAL GRID ================= */}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "38%",
          opacity: 0.25,
          backgroundImage:
            "linear-gradient(rgba(125,211,252,.3) 1px,transparent 1px),linear-gradient(90deg,rgba(125,211,252,.3) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
          transform: "perspective(350px) rotateX(55deg)",
          transformOrigin: "bottom",
        }}
      />

      {/* ================= TOP LEFT ================= */}

      <div
        style={{
          position: "absolute",
          top: 18,
          left: 20,
          zIndex: 20,
          background: "rgba(2,20,35,.82)",
          color: "#bae6fd",
          border: "1px solid rgba(56,189,248,.35)",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 12,
          letterSpacing: 1,
        }}
      >
        ◉ AR SPATIAL PREVIEW

        <div
          style={{
            color: "#7dd3fc",
            marginTop: 4,
            fontSize: 10,
          }}
        >
          BACKEND DETECTIONS: {validDetections.length}
        </div>
      </div>

      {/* ================= CONNECTION ================= */}

      <div
        style={{
          position: "absolute",
          top: 18,
          right: 20,
          zIndex: 20,
          background: "rgba(2,20,35,.82)",
          color: "#bae6fd",
          border: "1px solid rgba(56,189,248,.35)",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 11,
        }}
      >
        DESKTOP PREVIEW

        <div
          style={{
            marginTop: 3,
            color: error ? "#fca5a5" : "#38bdf8",
          }}
        >
          {error ? "● Backend Error" : "● Backend Connected"}
        </div>
      </div>

      {/* ================= CENTER RETICLE ================= */}

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          width: 52,
          height: 52,
          border: "1px solid rgba(125,211,252,.45)",
          borderRadius: "50%",
          opacity: 0.65,
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 72,
            left: -10,
            top: 25,
            borderTop: "1px solid #7dd3fc",
          }}
        />

        <div
          style={{
            position: "absolute",
            height: 72,
            top: -10,
            left: 25,
            borderLeft: "1px solid #7dd3fc",
          }}
        />
      </div>

      {/* ================= LOADING ================= */}

      {loading && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            color: "white",
            zIndex: 30,
          }}
        >
          Loading AR detections...
        </div>
      )}

      {/* ================= ERROR ================= */}

      {error && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "62%",
            transform: "translate(-50%,-50%)",
            color: "#fecaca",
            background: "rgba(127,29,29,.75)",
            padding: "10px 16px",
            borderRadius: 8,
            zIndex: 30,
          }}
        >
          {error}
        </div>
      )}

      {/* ================= BACKEND DETECTIONS ================= */}

      {!loading &&
        !error &&
        validDetections.map((d) => {
          const position = screenPositions.get(d.detection_id);

          if (!position) return null;

          return (
            <ARMarker
              key={d.detection_id}
              detection={d}
              position={position}
            />
          );
        })}

      {/* ================= BOTTOM STATUS ================= */}

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          background: "rgba(2,20,35,.82)",
          color: "#bae6fd",
          border: "1px solid rgba(56,189,248,.25)",
          padding: "7px 14px",
          borderRadius: 8,
          fontSize: 10,
          letterSpacing: 0.7,
          whiteSpace: "nowrap",
        }}
      >
        DESKTOP AR VISUALIZATION • GPS-REFERENCED BACKEND DETECTIONS
      </div>
    </div>
  );
}
