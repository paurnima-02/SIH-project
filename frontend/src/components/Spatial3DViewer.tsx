import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { useEffect, useState } from "react";
import { getSpatialDetections, type SpatialDetection } from "../api";

/*
  P4 - GPS-Based 3D Spatial Visualization

  Backend:
  SQLite -> FastAPI -> latitude/longitude -> React -> 3D position

  Latitude/longitude are converted into local X/Z coordinates
  relative to the first valid detection.
*/

interface Detection3DProps {
  label: string;
  confidence: number;
  status?: string | null;
  position: [number, number, number];
}

/* =====================================================
   GPS -> LOCAL 3D COORDINATES
===================================================== */

function gpsToLocalPosition(
  latitude: number,
  longitude: number,
  baseLatitude: number,
  baseLongitude: number
): [number, number, number] {
  /*
    Approximate conversion:

    1 degree latitude ≈ 111,320 metres
    Longitude distance changes with latitude.

    We then scale metres down slightly so nearby detections
    are easy to see inside the 3D scene.
  */

  const latDifference = latitude - baseLatitude;
  const lonDifference = longitude - baseLongitude;

  const metresNorth = latDifference * 111320;

  const metresEast =
    lonDifference *
    111320 *
    Math.cos((baseLatitude * Math.PI) / 180);

  const DISPLAY_SCALE = 0.35;

  const x = metresEast * DISPLAY_SCALE;
  const z = -metresNorth * DISPLAY_SCALE;

  return [x, 0.45, z];
}

/* =====================================================
   INDIVIDUAL 3D DETECTION
===================================================== */

function Detection3D({
  label,
  confidence,
  status,
  position,
}: Detection3DProps) {
  const name = label.toLowerCase();

  return (
    <group position={position}>
      {/* ================= BOTTLE ================= */}

      {name.includes("bottle") && (
        <group rotation={[0, 0, Math.PI / 2]}>
          <mesh>
            <cylinderGeometry args={[0.28, 0.32, 1.3, 20]} />
            <meshStandardMaterial color="#3b82a0" />
          </mesh>

          <mesh position={[0, 0.82, 0]}>
            <cylinderGeometry args={[0.13, 0.18, 0.35, 20]} />
            <meshStandardMaterial color="#3b82a0" />
          </mesh>

          <mesh position={[0, 1.03, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.12, 20]} />
            <meshStandardMaterial color="#d97706" />
          </mesh>
        </group>
      )}

      {/* ================= TIRE ================= */}

      {name.includes("tire") && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.55, 0.2, 16, 32]} />
          <meshStandardMaterial color="#202020" />
        </mesh>
      )}

      {/* ================= GHOST NET ================= */}

      {(name.includes("ghost") || name.includes("net")) && (
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.8, 0.04, 8, 24]} />
            <meshStandardMaterial color="#c2b280" />
          </mesh>

          {[-0.5, 0, 0.5].map((x) => (
            <mesh key={`vertical-${x}`} position={[x, 0, 0]}>
              <boxGeometry args={[0.025, 0.025, 1.5]} />
              <meshStandardMaterial color="#d6c89c" />
            </mesh>
          ))}

          {[-0.5, 0, 0.5].map((z) => (
            <mesh key={`horizontal-${z}`} position={[0, 0, z]}>
              <boxGeometry args={[1.5, 0.025, 0.025]} />
              <meshStandardMaterial color="#d6c89c" />
            </mesh>
          ))}
        </group>
      )}

      {/* ================= SHIPWRECK ================= */}

      {name.includes("shipwreck") && (
        <group>
          <mesh>
            <boxGeometry args={[2.4, 0.45, 1]} />
            <meshStandardMaterial color="#795548" />
          </mesh>

          <mesh position={[0.3, 0.5, 0]}>
            <boxGeometry args={[0.8, 0.6, 0.7]} />
            <meshStandardMaterial color="#5d4037" />
          </mesh>
        </group>
      )}

      {/* ================= UNKNOWN / OTHER ================= */}

      {!name.includes("bottle") &&
        !name.includes("tire") &&
        !name.includes("ghost") &&
        !name.includes("net") &&
        !name.includes("shipwreck") && (
          <mesh>
            <boxGeometry args={[1, 0.7, 1]} />
            <meshStandardMaterial color="#8b5e3c" />
          </mesh>
        )}

      {/* ================= INFORMATION LABEL ================= */}

      <Html
  position={name.includes("tire") ? [0, 1.2, 0] : [0, 2.5, 0]}
  center
  distanceFactor={10}
  occlude={false}
  zIndexRange={[1000, 0]}
  style={{
    pointerEvents: "none",
  }}
>

        <div
          style={{
            background: "rgba(0, 30, 50, 0.92)",
            color: "white",
            padding: "6px 10px",
            borderRadius: "8px",
            whiteSpace: "nowrap",
            fontSize: "12px",
            border: "1px solid rgba(80,180,220,0.35)",
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {label} • {Math.round(confidence <= 1 ? confidence * 100 : confidence)}%
          </div>

          {status && (
            <div
              style={{
                fontSize: "10px",
                marginTop: "2px",
                opacity: 0.75,
              }}
            >
              {status}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

/* =====================================================
   MAIN 3D VIEWER
===================================================== */

export default function ThreeDViewer() {
  const [detections, setDetections] = useState<SpatialDetection[]>([]);

  useEffect(() => {
    getSpatialDetections()
      .then((data) => {
        console.log("Spatial detections from backend:", data);
        setDetections(data);
      })
      .catch((error) => {
        console.error("Could not load spatial detections:", error);
      });
  }, []);

  /* Only detections containing valid GPS coordinates */
  const gpsDetections = detections.filter(
    (d) =>
      d.latitude !== null &&
      d.latitude !== undefined &&
      d.longitude !== null &&
      d.longitude !== undefined
  );

  /*
    First GPS detection becomes the local reference point.
    Other detections are positioned relative to it.
  */
  const baseLatitude = gpsDetections[0]?.latitude ?? 0;
  const baseLongitude = gpsDetections[0]?.longitude ?? 0;

  return (
    <div
      style={{
        width: "100%",
        height: "500px",
        borderRadius: "16px",
        overflow: "hidden",
        background: "#082f49",
      }}
    >
      <Canvas
        camera={{
          position: [8, 8, 10],
          fov: 50,
        }}
      >
        {/* ================= LIGHTING ================= */}

        <ambientLight intensity={1.3} />

        <directionalLight
          position={[5, 10, 5]}
          intensity={2}
        />

        {/* ================= SEAFLOOR ================= */}

        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
        >
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#52796f" />
        </mesh>

        {/* ================= SPATIAL GRID ================= */}

        <gridHelper
          args={[40, 40, "#315f67", "#315f67"]}
          position={[0, 0.01, 0]}
        />

        {/* ================= GPS DETECTIONS ================= */}

        {gpsDetections.map((d) => {
          const position = gpsToLocalPosition(
            d.latitude as number,
            d.longitude as number,
            baseLatitude as number,
            baseLongitude as number
          );

          return (
            <Detection3D
              key={d.detection_id}
              label={d.class || "Unknown"}
              confidence={d.confidence || 0}
              status={d.status}
              position={position}
            />
          );
        })}

        {/* ================= CAMERA CONTROLS ================= */}

        <OrbitControls
          enableZoom={true}
          enablePan={true}
          enableRotate={true}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}