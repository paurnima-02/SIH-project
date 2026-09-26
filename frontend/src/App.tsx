import { createContext, useContext, useState, useRef, useCallback } from "react";
import { predictImage } from "./api";
import DebrisHeatmap from "./components/DebrisHeatmap";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  // AquaScan — Light Coastal / Glass Theme

  // Main surfaces
  bg: "#EAF6F8",
  card: "#F7FCFD",

  // Borders
  border: "#B9D8DF",
  borderMd: "#8FC1CC",
  borderDk: "#5E9EAD",

  // Typography
  navy: "#123F4B",
  navyMd: "#286878",
  muted: "#5F8995",
  faint: "#8BAAB3",

  // Primary interactive colour
  blue: "#287E91",
  blueBg: "#D7EDF2",
  blueDim: "#73B4C1",

  // High confidence / important
  orange: "#F28A4B",
  orangeBg: "#FFF0E6",
  orangeDim: "#F6B17E",

  // Success
  green: "#2EA66D",
  greenBg: "#E3F6EC",
  greenDim: "#73C69A",

  // Alerts
  redAlert: "#DF6670",
  amberWarn: "#D99A32",
};


// ─── Types ─────────────────────────────────────────────────────────────────────
type Screen = "home" | "survey" | "upload" | "viewer" | "heatmap" | "spatial" | "report";
// NOTE: "mine" added so the backend's "mine" class (from the Forward-Looking Sonar
// dataset) maps to a real type instead of falling back to "unknown" / "UK".
type DebrisType =
  | "ghost_net" | "shipwreck" | "pipe" | "unknown"
  | "bottle" | "can" | "chain" | "drink_carton" | "hook"
  | "propeller" | "shampoo_bottle" | "standing_bottle" | "tire" | "valve" | "mine";
type ConfTier = "high" | "medium" | "low";

export interface Detection {
  id: string; type: DebrisType; label?: string; confidence: number;
  scanId: string; timestamp: string;
  latitude?: number; longitude?: number;
  x: number; y: number; w: number; h: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<DebrisType, string> = {
  ghost_net: "Ghost Net", shipwreck: "Shipwreck", pipe: "Pipe/Cable", unknown: "Unknown",
  bottle: "Bottle", can: "Can", chain: "Chain", drink_carton: "Drink Carton", hook: "Hook",
  propeller: "Propeller", shampoo_bottle: "Shampoo Bottle", standing_bottle: "Standing Bottle", tire: "Tire", valve: "Valve",
  mine: "Mine",
};
const TYPE_CODE: Record<DebrisType, string> = {
  ghost_net: "GN", shipwreck: "SW", pipe: "PC", unknown: "UK", bottle: "BOT", can: "CAN", chain: "CHN",
  drink_carton: "CRT", hook: "HOK", propeller: "PRP", shampoo_bottle: "SHB", standing_bottle: "STB", tire: "TIR", valve: "VAL",
  mine: "MIN",
};

function tier(c: number): ConfTier { return c >= 75 ? "high" : c >= 40 ? "medium" : "low"; }
const TIER_COLOR: Record<ConfTier, string> = { high: C.orange, medium: C.amberWarn, low: C.green };
const TIER_BG: Record<ConfTier, string> = { high: C.orangeBg, medium: "#FDF6E3", low: C.greenBg };
const TIER_LABEL: Record<ConfTier, string> = { high: "HIGH", medium: "REVIEW", low: "LOW" };

// ─── Live detection state ──────────────────────────────────────────────────────
interface AquaScanContextValue {
  detections: Detection[];
  setDetections: React.Dispatch<React.SetStateAction<Detection[]>>;
  scanImageUrl: string | null;
  setScanImageUrl: React.Dispatch<React.SetStateAction<string | null>>;
  isProcessing: boolean;
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
}

const AquaScanContext = createContext<AquaScanContextValue | null>(null);

function useAquaScan() {
  const value = useContext(AquaScanContext);
  if (!value) throw new Error("useAquaScan must be used inside AquaScanContext");
  return value;
}

// ─── Micro-primitives ──────────────────────────────────────────────────────────
function Rule({ axis = "h" }: { axis?: "h" | "v" }) {
  return axis === "v"
    ? <div style={{ width: 1, background: C.border, alignSelf: "stretch" }} />
    : <div style={{ height: 1, background: C.border, width: "100%" }} />;
}

function Mono({ children, color, size = "11px" }: { children: React.ReactNode; color?: string; size?: string }) {
  return (
    <span className="font-mono" style={{ fontSize: size, color: color || C.navy, letterSpacing: "-0.01em" }}>
      {children}
    </span>
  );
}

function Label({ children, caps }: { children: React.ReactNode; caps?: boolean }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, color: C.muted, letterSpacing: caps ? ".08em" : ".02em",
      textTransform: caps ? "uppercase" : "none",
    }}>
      {children}
    </span>
  );
}

function TierTag({ v }: { v: number }) {
  const t = tier(v);
  return (
    <span className="font-mono inline-flex items-center"
      style={{
        fontSize: 10, fontWeight: 600, padding: "1px 5px",
        background: TIER_BG[t], color: TIER_COLOR[t],
        border: `1px solid ${TIER_COLOR[t]}44`,
        borderRadius: 2, letterSpacing: ".05em",
      }}>
      {v}%
    </span>
  );
}

function TypeTag({ type, label }: { type: DebrisType; label?: string }) {
  return (
    <span className="font-mono inline-flex items-center"
      style={{
        fontSize: 10, fontWeight: 500, padding: "1px 5px",
        background: C.bg, color: C.navyMd,
        border: `1px solid ${C.border}`, borderRadius: 2,
        letterSpacing: ".02em", whiteSpace: "nowrap",
      }}>
      {label || TYPE_LABEL[type]}
    </span>
  );
}

function StatusLED({ on, color }: { on: boolean; color: string }) {
  return (
    <span className={on ? "led-blink" : ""} style={{
      display: "inline-block", width: 6, height: 6,
      borderRadius: "50%", background: on ? color : C.borderMd, flexShrink: 0,
    }} />
  );
}

function PanelBtn({ label, variant = "primary", small, onClick, disabled, icon }:
  {
    label: string; variant?: "primary" | "ghost" | "orange" | "danger"; small?: boolean;
    onClick?: () => void; disabled?: boolean; icon?: string
  }) {
  const s: Record<string, React.CSSProperties> = {
    primary: { background: C.blue, color: "#fff", border: `1px solid ${C.blue}` },
    ghost: { background: "transparent", color: C.muted, border: `1px solid ${C.border}` },
    orange: { background: C.orange, color: "#fff", border: `1px solid ${C.orange}` },
    danger: { background: "transparent", color: C.redAlert, border: `1px solid ${C.redAlert}44` },
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        ...s[variant],
        fontSize: small ? 10 : 12, fontWeight: 500,
        padding: small ? "2px 8px" : "4px 12px",
        borderRadius: 2, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? .45 : 1, display: "inline-flex", alignItems: "center", gap: 4,
        transition: "opacity .1s",
      }}>
      {icon && <span style={{ fontSize: 11 }}>{icon}</span>}{label}
    </button>
  );
}

function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "4px 0", borderBottom: `1px solid ${C.border}`
    }}>
      <Label>{label}</Label>
      {mono
        ? <Mono color={C.navyMd}>{value}</Mono>
        : <span style={{ fontSize: 12, color: C.navy }}>{value}</span>}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: Screen; label: string; code: string; badge?: number }[] = [
  { id: "home", label: "Dashboard", code: "00" },
  { id: "survey", label: "Survey", code: "01" },
  { id: "upload", label: "Ingest", code: "02" },
  { id: "viewer", label: "Det. Viewer", code: "03" },
  { id: "heatmap", label: "Heatmap", code: "04" },
  { id: "spatial", label: "Spatial View", code: "05" },
  { id: "report", label: "Export", code: "06" },
];

function Sidebar({ active, onNav }: { active: Screen; onNav: (s: Screen) => void }) {
  const { isProcessing } = useAquaScan();
  return (
    <aside style={{
  width: 176,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",

  background: "rgba(240, 249, 251, 0.62)",
  borderRight: "1px solid rgba(255, 255, 255, 0.55)",

  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",

  boxShadow: "6px 0 24px rgba(18, 63, 80, 0.10)",
}}>
      {/* Instrument header */}
      <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <SonarDial size={22} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, letterSpacing: ".04em" }}>AQUASCAN</div>
            <div className="font-mono" style={{ fontSize: 9, color: C.muted, letterSpacing: ".06em" }}>FIELD TERMINAL</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
          <div style={{ flex: 1 }}>
            <div className="font-mono" style={{ fontSize: 9, color: C.faint }}>MODEL</div>
            <div className="font-mono" style={{ fontSize: 10, color: C.muted }}>YOLOv8n</div>
          </div>
          <div>
            <div className="font-mono" style={{ fontSize: 9, color: C.faint }}>UNIT</div>
            <div className="font-mono" style={{ fontSize: 10, color: C.muted }}>MARINE DRONE</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "4px 0" }}>
        {NAV_ITEMS.map(n => {
          const on = n.id === active;
          return (
            <button key={n.id} onClick={() => onNav(n.id)}
              style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center",
                gap: 8, padding: "6px 12px",
                background: on ? C.blueBg : "transparent",
                borderLeft: `2px solid ${on ? C.blue : "transparent"}`,
                borderBottom: "none", borderTop: "none", borderRight: "none",
                cursor: "pointer", transition: "background .1s",
              }}>
              <span className="font-mono" style={{ fontSize: 9, color: on ? C.blue : C.borderDk, width: 16 }}>{n.code}</span>
              <span style={{ fontSize: 12, fontWeight: on ? 500 : 400, color: on ? C.blue : C.muted, flex: 1 }}>{n.label}</span>
              {(n.badge || 0) > 0 && (
                <span className="font-mono" style={{
                  fontSize: 9, fontWeight: 600, padding: "0px 4px",
                  background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeDim}`,
                  borderRadius: 2,
                }}>{n.badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Status strip */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusLED on={isProcessing} color={C.green} />
          <div>
            <div className="font-mono" style={{ fontSize: 8, color: C.faint, letterSpacing: ".07em" }}>STATUS</div>
            <div className="font-mono" style={{ fontSize: 10, color: C.navyMd }}>
              {isProcessing ? "ACTIVE" : "IDLE"}
            </div>
          </div>
        </div>
        <div className="font-mono" style={{ fontSize: 9, color: C.faint, marginTop: 6 }}>
          MARINE DRONE / EDGE UNIT
        </div>
      </div>
    </aside>
  );
}

function SonarDial({ size = 24 }: { size?: number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={C.blue} strokeWidth="1" fill="none" />
      <circle cx="12" cy="12" r="6" stroke={C.blue} strokeWidth=".7" fill="none" strokeOpacity=".5" />
      <circle cx="12" cy="12" r="1.5" fill={C.blue} />
      <line x1="12" y1="12" x2="12" y2="2.5" stroke={C.blue} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="17" cy="8" r="1.5" fill={C.orange} />
    </svg>
  );
}

// ─── Panel wrappers ───────────────────────────────────────────────────────────
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "rgba(245, 252, 253, 0.68)",
        border: "1px solid rgba(255, 255, 255, 0.55)",
        borderRadius: 16,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 8px 28px rgba(18, 63, 80, 0.12)",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function PanelHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "6px 10px", borderBottom: `1px solid ${C.border}`,
      background: C.bg,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.navy, letterSpacing: ".01em" }}>{title}</span>
        {sub && <span className="font-mono" style={{ fontSize: 9, color: C.faint }}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

// ─── 0. HOME ──────────────────────────────────────────────────────────────────
function HomeScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const { detections: DETS } = useAquaScan();
  const high = DETS.filter(d => tier(d.confidence) === "high");
  const med = DETS.filter(d => tier(d.confidence) === "medium");

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.navy }}>Mission Dashboard</div>
          <div className="font-mono" style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
            Results from the current inference session
          </div>
        </div>
        <PanelBtn label="New Scan" variant="orange" icon="+" onClick={() => onNav("upload")} />
      </div>

      {/* Top stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 8 }}>
        {[
          { label: "Detections", value: String(DETS.length), unit: "objects", note: "current session", color: C.navy },
          { label: "High-Priority", value: String(high.length), unit: "≥75% conf.", note: "requires action", color: C.orange },
          { label: "Pending Review", value: String(med.length), unit: "40–74% conf.", note: "40–74% confidence", color: C.amberWarn },
        ].map(s => (
          <Panel key={s.label} style={{ padding: "8px 10px" }}>
            <Label caps>{s.label}</Label>
            <div style={{ marginTop: 4 }}>
              <span className="font-mono" style={{ fontSize: 22, fontWeight: 600, color: s.color, lineHeight: 1 }}>{s.value}</span>
              <span className="font-mono" style={{ fontSize: 10, color: C.faint, marginLeft: 4 }}>{s.unit}</span>
            </div>
            <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>{s.note}</div>
          </Panel>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px 240px", gap: 8 }}>

        {/* Detection table */}
        <Panel>
          <PanelHead title="Recent Detections" sub={DETS.length ? "Current session" : "No scan loaded"}
            right={
              <button style={{ fontSize: 11, color: C.blue, background: "none", border: "none", cursor: "pointer" }}
                onClick={() => onNav("viewer")}>Viewer →</button>
            } />
          <DetTable dets={DETS} compact />
        </Panel>

        {/* Current session summary */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Panel>
            <PanelHead title="Current Session" />
            <div style={{ padding: "8px 10px" }}>
              <FieldRow label="Detections" value={String(DETS.length)} mono />
              <FieldRow label="High confidence" value={String(high.length)} mono />
              <FieldRow label="Needs review" value={String(med.length)} mono />
              <FieldRow label="Source" value={DETS[0]?.scanId || "No scan loaded"} mono />
            </div>
          </Panel>
        </div>

        {/* Session status */}
        <Panel>
          <PanelHead title="Session Status" />
          <div style={{ padding: "10px" }}>
            {DETS.length === 0 ? (
              <div style={{ fontSize: 11, color: C.faint }}>Upload a sonar image and run inference to begin.</div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <StatusLED on color={C.green} />
                <span style={{ fontSize: 11, color: C.navyMd }}>Inference results available</span>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DetTable({ dets, compact }: { dets: Detection[]; compact?: boolean }) {
  const py = compact ? 5 : 7;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ background: C.bg }}>
          {["ID", "Type", "Conf.", "Scan", "Time"].map(h => (
            <th key={h} style={{
              padding: `4px ${compact ? 8 : 10}px`, textAlign: "left",
              fontSize: 9, fontWeight: 600, color: C.muted, letterSpacing: ".07em",
              textTransform: "uppercase", borderBottom: `1px solid ${C.border}`
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dets.map((d, i) => (
          <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}` }}
            onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <td style={{ padding: `${py}px ${compact ? 8 : 10}px` }}>
              <Mono color={C.blue}>{d.id}</Mono>
            </td>
            <td style={{ padding: `${py}px ${compact ? 8 : 10}px` }}>
              <TypeTag type={d.type} label={d.label} />
            </td>
            <td style={{ padding: `${py}px ${compact ? 8 : 10}px` }}>
              <TierTag v={d.confidence} />
            </td>
            <td style={{ padding: `${py}px ${compact ? 8 : 10}px` }}>
              <Mono color={C.faint}>{d.scanId}</Mono>
            </td>
            <td style={{ padding: `${py}px ${compact ? 8 : 10}px` }}>
              <Mono color={C.faint}>{d.timestamp.slice(11, 19)}</Mono>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── 1. UPLOAD ────────────────────────────────────────────────────────────────
function UploadScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const { setDetections, setScanImageUrl, setIsProcessing } = useAquaScan();
  const [dragging, setDragging] = useState(false);
  const [inputType, setInputType] = useState<"image" | "xtf">("image");
  const [files, setFiles] = useState<{ file: File; name: string; size: string; format: string; status: "queued" | "running" | "done" | "error" }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: File[]) => {
    const allowed =
  inputType === "image"
    ? new Set(["png", "jpg", "jpeg"])
    : new Set(["xtf"]);
    const accepted = incoming.filter(file => allowed.has(file.name.split(".").pop()?.toLowerCase() || ""));
    if (!accepted.length) {
      setError(
  inputType === "image"
    ? "Please select a sonar image: PNG, JPG or JPEG"
    : "Please select a raw sonar log: XTF"
);
     return;
}
    setError(null);
    setFiles(prev => [...prev, ...accepted.map(file => ({
      file, name: file.name,
      size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      format: (file.name.split(".").pop() || "IMG").toUpperCase(),
      status: "queued" as const,
    }))]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const runAll = async () => {
    if (!files.length || files.some(f => f.status === "running")) return;
    setError(null);
    setIsProcessing(true);
    setFiles(prev => prev.map(f => ({ ...f, status: "running" as const })));
    const allDetections: Detection[] = [];
    try {
      for (const item of files) allDetections.push(...await predictImage(item.file));
      setDetections(allDetections);
      const firstImage = files[0]?.file;
      if (firstImage) {
        setScanImageUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(firstImage);
        });
      }
      setFiles(prev => prev.map(f => ({ ...f, status: "done" as const })));
      setIsProcessing(false);
      onNav("viewer");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to connect to the prediction backend.";
      setError(`${message} Check VITE_API_URL and make sure FastAPI is running.`);
      setIsProcessing(false);
      setFiles(prev => prev.map(f => ({ ...f, status: "error" as const })));
    }
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 8, maxWidth: 1100 }}>
        <div>
          <div style={{ marginBottom: 8 }}>
  <div style={{ fontSize: 15, fontWeight: 600, color: C.navy }}>
    Data Ingest
  </div>

  <div className="font-mono" style={{ fontSize: 10, color: C.muted }}>
    Upload sonar data for processing
  </div>

  <div
    style={{
      display: "flex",
      gap: 8,
      marginTop: 10,
    }}
  >
    <button
      type="button"
      onClick={() => {
        setInputType("image");
        setFiles([]);
        setError(null);
      }}
      style={{
        flex: 1,
        padding: "10px 12px",
        borderRadius: 10,
        cursor: "pointer",
        border: `1px solid ${inputType === "image" ? C.blue : C.borderMd}`,
        background: inputType === "image" ? C.blueBg : C.card,
        color: inputType === "image" ? C.blue : C.muted,
        fontWeight: 600,
      }}
    >
      🖼 Sonar Image
      <div className="font-mono" style={{ fontSize: 9, marginTop: 3, fontWeight: 400 }}>
        PNG / JPG / JPEG
      </div>
    </button>

    <button
      type="button"
      onClick={() => {
        setInputType("xtf");
        setFiles([]);
        setError(null);
      }}
      style={{
        flex: 1,
        padding: "10px 12px",
        borderRadius: 10,
        cursor: "pointer",
        border: `1px solid ${inputType === "xtf" ? C.blue : C.borderMd}`,
        background: inputType === "xtf" ? C.blueBg : C.card,
        color: inputType === "xtf" ? C.blue : C.muted,
        fontWeight: 600,
      }}
    >
      📡 XTF Log
      <div className="font-mono" style={{ fontSize: 9, marginTop: 3, fontWeight: 400 }}>
        .XTF sonar log
      </div>
    </button>
  </div>
</div>

<Panel>
            <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={handleDrop} onClick={() => inputRef.current?.click()}
              style={{
                minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer",
                background: dragging ? C.blueBg : "transparent", border: `1px dashed ${dragging ? C.blue : C.borderMd}`, transition: "all .15s"
              }}>
              <input
  ref={inputRef}
  type="file"
  multiple
  className="hidden"
  accept={inputType === "image" ? ".png,.jpg,.jpeg" : ".xtf"}
  onChange={e => addFiles(Array.from(e.target.files || []))}
/>

<SonarDial size={36} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: dragging ? C.blue : C.navyMd }}>{dragging ? "Release to add files" : "Drop sonar images here"}</div>
                <div className="font-mono" style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>.png  .jpg  .jpeg .XTF — or <span style={{ color: C.blue, textDecoration: "underline" }}>browse</span></div>
              </div>
            </div>
          </Panel>
          {error && <div style={{ marginTop: 8, padding: "7px 9px", background: C.orangeBg, color: C.redAlert, border: `1px solid ${C.orangeDim}`, fontSize: 11 }}>{error}</div>}
          {files.length > 0 && (
            <Panel style={{ marginTop: 8 }}>
              <PanelHead title={`Inference Queue (${files.length})`} right={<PanelBtn label="Run YOLO Inference" variant="orange" small onClick={runAll} disabled={files.some(f => f.status === "running")} />} />
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: C.bg }}>{["Filename", "Format", "Size", "Status"].map(h => <th key={h} style={{ padding: "4px 8px", textAlign: "left", fontSize: 9, color: C.muted, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
                <tbody>{files.map((f, i) => <tr key={`${f.name}-${i}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "6px 8px" }}><Mono color={C.navy} size="11px">{f.name}</Mono></td>
                  <td style={{ padding: "6px 8px" }}><Mono color={C.blue}>{f.format}</Mono></td>
                  <td style={{ padding: "6px 8px" }}><Mono color={C.muted}>{f.size}</Mono></td>
                  <td style={{ padding: "6px 8px" }}>{f.status === "running" ? <Mono color={C.blue}>Processing…</Mono> : f.status === "done" ? <Mono color={C.green}>Complete</Mono> : f.status === "error" ? <Mono color={C.redAlert}>Failed</Mono> : <Mono color={C.faint}>Ready</Mono>}</td>
                </tr>)}</tbody>
              </table>
            </Panel>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Panel><PanelHead title="Backend Contract" /><div style={{ padding: "8px 10px" }}>
            <FieldRow label="Method" value="POST" mono /><FieldRow label="Route" value="/predict" mono /><FieldRow label="Payload" value="multipart/form-data" mono /><FieldRow label="Field" value="file" mono /><FieldRow label="Response" value="JSON detections" mono />
          </div></Panel>
          <Panel><PanelHead title="Inference Config" /><div style={{ padding: "8px 10px" }}>
            {[['Model', 'YOLOv8n'], ['Confidence threshold', '0.25']].map(([k, v]) => <FieldRow key={k} label={k} value={v} mono />)}
          </div></Panel>
        </div>
      </div>
    </div>
  );
}

// ─── 2. VIEWER ────────────────────────────────────────────────────────────────
function ViewerScreen() {
  const { detections: DETS, scanImageUrl } = useAquaScan();
  const [selId, setSelId] = useState<string | null>(DETS[0]?.id ?? null);
  const [showBoxes, setBoxes] = useState(true);
  const sel = DETS.find(d => d.id === selId);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
        background: C.card, borderBottom: `1px solid ${C.border}`, flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>
              {DETS[0]?.scanId || "Current scan"}
            </span>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <ToolToggle label="Bounding Boxes" on={showBoxes} onChange={setBoxes} />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Sonar + scrubber */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ flex: 1, position: "relative", background: "#040C14", overflow: "hidden" }}>
            <SonarCanvas dets={DETS.slice(0, 5)} selId={selId} onSel={setSelId}
              showBoxes={showBoxes} imageUrl={scanImageUrl || undefined} />
          </div>
        </div>

        {/* Side panel */}
        <div style={{
          width: 220, flexShrink: 0, borderLeft: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column", background: C.card
        }}>
          <PanelHead title={`${DETS.length} Detections`} sub={DETS[0]?.scanId || "Current scan"} />
          <div style={{ flex: 1, overflowY: "auto" }}>
            {DETS.map(d => {
              const on = d.id === selId;
              return (
                <button key={d.id} onClick={() => setSelId(on ? null : d.id)}
                  style={{
                    width: "100%", textAlign: "left", display: "grid",
                    gridTemplateColumns: "28px 1fr auto", gap: 6,
                    padding: "7px 10px", alignItems: "center",
                    background: on ? C.blueBg : "transparent",
                    borderLeft: `2px solid ${on ? C.blue : "transparent"}`,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: "pointer",
                  }}>
                  <TypeTag type={d.type} label={d.label} />
                  <div>
                    <Mono color={on ? C.blue : C.navy}>{d.id}</Mono>
                  </div>
                  <TierTag v={d.confidence} />
                </button>
              );
            })}
          </div>
          {/* Detail panel */}
          {sel && (
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 10px" }}>
              <div style={{ marginBottom: 6 }}>
                <Label caps>Selected: {sel.id}</Label>
              </div>
              {[
                ["Type", sel.label || TYPE_LABEL[sel.type]],
                ["Conf.", `${sel.confidence}%`],
                ["Latitude", sel.latitude != null ? `${sel.latitude.toFixed(6)}°` : "Navigation data unavailable"],
                ["Longitude", sel.longitude != null ? `${sel.longitude.toFixed(6)}°` : "Navigation data unavailable"],
              ].map(([k, v]) => <FieldRow key={k} label={k} value={v} mono />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 3. SURVEY ────────────────────────────────────────────────────────────────
function SurveyScreen() {
  const { detections: DETS, isProcessing } = useAquaScan();
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const counts = {
    all: DETS.length,
    high: DETS.filter(d => tier(d.confidence) === "high").length,
    medium: DETS.filter(d => tier(d.confidence) === "medium").length,
    low: DETS.filter(d => tier(d.confidence) === "low").length,
  };

  const visible = DETS.filter(d => filter === "all" || tier(d.confidence) === filter);
  const location = DETS.find(d => d.latitude != null && d.longitude != null);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#EEF6FA" }}>
      {/* Survey toolbar */}
      <div style={{
        height: 36, flexShrink: 0, display: "flex", alignItems: "center", gap: 4,
        padding: "0 10px", background: C.card, borderBottom: `1px solid ${C.border}`
      }}>
        <Label caps>Filter by tier</Label>
        {([
          ["all", `All detections (${counts.all})`],
          ["high", `High (≥75%)`],
          ["medium", `Review (40–74%)`],
          ["low", `Low (<40%)`],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            border: `1px solid ${filter === key ? C.blueDim : C.border}`,
            background: filter === key ? C.blueBg : C.card,
            color: filter === key ? C.blue : C.muted,
            borderRadius: 2, padding: "3px 7px", fontSize: 9, cursor: "pointer"
          }}>{label}</button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 9, color: C.faint }} className="font-mono">
          {location ? `${location.latitude!.toFixed(6)}°, ${location.longitude!.toFixed(6)}°` : "NAVIGATION DATA UNAVAILABLE"}
        </div>
      </div>

      {/* Survey plot */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #F3F9FC 0%, #E8F3F8 100%)" }} />

        {/* Grid */}
        <div style={{ position: "absolute", inset: 0, opacity: .55,
          backgroundImage: `linear-gradient(${C.blueDim}55 1px, transparent 1px), linear-gradient(90deg, ${C.blueDim}55 1px, transparent 1px)`,
          backgroundSize: "96px 96px"
        }} />

        {/* Sonar-style range rings */}
        <div style={{ position: "absolute", width: "62vw", height: "78vh", minWidth: 520, minHeight: 420,
          left: "50%", top: "50%", transform: "translate(-50%, -50%)", borderRadius: "50%", border: `1px solid ${C.blueDim}88` }} />
        <div style={{ position: "absolute", width: "48vw", height: "60vh", minWidth: 420, minHeight: 330,
          left: "50%", top: "50%", transform: "translate(-50%, -50%)", borderRadius: "50%", border: `1px solid ${C.blueDim}88` }} />
        <div style={{ position: "absolute", width: "34vw", height: "42vh", minWidth: 320, minHeight: 240,
          left: "50%", top: "50%", transform: "translate(-50%, -50%)", borderRadius: "50%", border: `1px solid ${C.blueDim}88` }} />
        <div style={{ position: "absolute", width: "20vw", height: "25vh", minWidth: 220, minHeight: 150,
          left: "50%", top: "50%", transform: "translate(-50%, -50%)", borderRadius: "50%", border: `1px solid ${C.blueDim}99` }} />

        {/* Survey track */}
        <div style={{ position: "absolute", width: "76%", height: 1, left: "12%", top: "50%",
          transform: "rotate(31deg)", transformOrigin: "center", borderTop: `1px dashed ${C.blue}88` }} />

        <div style={{ position: "absolute", left: "50%", top: "50%", width: 8, height: 8,
          border: `1px solid ${C.blue}`, borderRadius: "50%", transform: "translate(-50%, -50%)", background: C.card }} />

        {/* Actual detection markers, placed from YOLO bounding-box centres */}
        {visible.map(d => {
          const x = d.x + d.w / 2;
          const y = d.y + d.h / 2;
          const col = TIER_COLOR[tier(d.confidence)];
          return (
            <button key={d.id} title={`${d.label || TYPE_LABEL[d.type]} — ${d.confidence}%`}
              onClick={() => undefined}
              style={{
                position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)",
                width: 12, height: 12, padding: 0, borderRadius: "50%", cursor: "default",
                border: `2px solid ${C.card}`, background: col, boxShadow: `0 0 0 1px ${col}88`,
              }}
            />
          );
        })}

        {/* Empty state */}
        {DETS.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ padding: "12px 16px", background: "rgba(255,255,255,.92)", border: `1px solid ${C.border}`, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: C.navyMd, fontWeight: 600 }}>No survey detections</div>
              <div className="font-mono" style={{ fontSize: 9, color: C.faint, marginTop: 3 }}>Run YOLO inference from Ingest to populate this survey.</div>
            </div>
          </div>
        )}

        {/* Axis labels */}
        <div className="font-mono" style={{ position: "absolute", left: 14, top: 12, fontSize: 9, color: C.faint }}>N ↑</div>
        <div className="font-mono" style={{ position: "absolute", right: 14, bottom: 12, fontSize: 9, color: C.faint }}>RELATIVE SCAN POSITION</div>

        {/* Bottom-left mission status */}
        <div style={{ position: "absolute", left: 10, bottom: 10, width: 180, background: "rgba(255,255,255,.94)", border: `1px solid ${C.border}` }}>
          <div style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 9, fontWeight: 600, color: C.navy }}>SURVEY STATUS</div>
          <div style={{ padding: "7px 8px" }}>
            <FieldRow label="UNIT" value="MARINE DRONE" mono />
            <FieldRow label="STATUS" value={isProcessing ? "PROCESSING" : DETS.length ? "COMPLETE" : "IDLE"} mono />
            <FieldRow label="DETECTIONS" value={String(DETS.length)} mono />
          </div>
        </div>

        {/* Bottom-right confidence legend */}
        <div style={{ position: "absolute", right: 10, bottom: 10, width: 155, background: "rgba(255,255,255,.94)", border: `1px solid ${C.border}` }}>
          <div style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 9, fontWeight: 600, color: C.navy }}>CONFIDENCE TIER</div>
          <div style={{ padding: "7px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
            {(["high", "medium", "low"] as ConfTier[]).map(t => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: TIER_COLOR[t] }} />
                <span style={{ fontSize: 9, color: C.muted, flex: 1 }}>{t === "high" ? "High risk" : t === "medium" ? "Review required" : "Low risk"}</span>
                <Mono color={C.faint} size="8px">{t === "high" ? "≥75%" : t === "medium" ? "40–74%" : "<40%"}</Mono>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
              <span style={{ width: 16, borderTop: `1px dashed ${C.blue}` }} />
              <span style={{ fontSize: 9, color: C.muted }}>Survey track</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolToggle({ label, on, onChange, disabled, color }:
  { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; color?: string }) {
  const a = color || C.blue;
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? .4 : 1
    }}>
      <div onClick={() => !disabled && onChange(!on)}
        style={{
          width: 28, height: 14, borderRadius: 7, background: on ? a : C.borderMd,
          position: "relative", transition: "background .15s", flexShrink: 0, cursor: disabled ? "not-allowed" : "pointer"
        }}>
        <div style={{
          position: "absolute", top: 2, left: on ? 14 : 2, width: 10, height: 10,
          borderRadius: "50%", background: "#fff", transition: "left .15s"
        }} />
      </div>
      <span style={{ fontSize: 11, color: on ? a : C.muted }}>{label}</span>
    </label>
  );
}

function SonarCanvas({ dets, selId, onSel, showBoxes, imageUrl }:
  {
    dets: Detection[]; selId: string | null; onSel: (id: string | null) => void;
    showBoxes: boolean; imageUrl?: string
  }) {
  const BOX_C: Record<ConfTier, string> = { high: C.orange, medium: C.amberWarn, low: C.green };
  const [imageLoaded, setImageLoaded] = useState(false);
  const isRealImage = !!imageUrl && imageLoaded;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {imageUrl && (
        <img
          src={imageUrl}
          alt="Uploaded sonar scan"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(false)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: imageLoaded ? 1 : 0 }}
        />
      )}
      {!isRealImage && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ padding: "8px 12px", background: "rgba(4,12,20,.92)", border: `1px solid ${C.borderDk}`, color: C.muted, fontSize: 11 }}>
            {imageUrl ? "Unable to preview this image. Upload JPG or PNG." : "No scan image loaded. Upload a JPG or PNG to begin."}
          </div>
        </div>
      )}

      {/* Bounding boxes */}
      {showBoxes && dets.map(d => {
        const isSel = d.id === selId;
        const col = BOX_C[tier(d.confidence)];
        return (
          <div key={d.id} onClick={() => onSel(isSel ? null : d.id)}
            style={{
              position: "absolute",
              left: `${d.x}%`, top: `${d.y}%`, width: `${d.w}%`, height: `${d.h}%`,
              border: `1.5px solid ${col}${isSel ? "FF" : "88"}`,
              background: isSel ? `${col}14` : "transparent",
              cursor: "pointer", transition: "all .1s",
            }}>
            {/* Readout chip */}
            <div style={{
              position: "absolute", top: -18, left: 0, display: "flex", gap: 4, alignItems: "center",
              background: "rgba(4,12,20,.88)", border: `1px solid ${col}55`,
              padding: "1px 6px", borderRadius: 2, whiteSpace: "nowrap"
            }}>
              <span className="font-mono" style={{ fontSize: 9, fontWeight: 600, color: col }}>
                {d.confidence}% {d.label || TYPE_LABEL[d.type]}
              </span>
            </div>
            {/* Corner marks */}
            {isSel && [
              { top: 0, left: 0, borderTop: "1.5px", borderLeft: "1.5px" },
              { top: 0, right: 0, borderTop: "1.5px", borderRight: "1.5px" },
              { bottom: 0, left: 0, borderBottom: "1.5px", borderLeft: "1.5px" },
              { bottom: 0, right: 0, borderBottom: "1.5px", borderRight: "1.5px" },
            ].map((c, ci) => (
              <div key={ci} style={{
                position: "absolute", width: 6, height: 6,
                ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === "string" && v.endsWith("px") ? `${v} solid ${col}` : v]))
              }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── 4. REPORT / EXPORT ────────────────────────────────────────────────────────
function ReportScreen() {
  const { detections: DETS } = useAquaScan();
  const [fields, setFields] = useState<Record<string, boolean>>({
    id: true, type: true, confidence: true,
    scanId: true, timestamp: true,
  });
  const [fmt, setFmt] = useState<"CSV" | "JSON" | "GeoJSON" | "PDF">("CSV");
  const [dl, setDl] = useState(false);
  const [sortKey, setSort] = useState("confidence");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [scope, setScope] = useState<"all" | "high" | "reviewed">("all");

  // Real counts, not hardcoded strings
  const highCount = DETS.filter(d => tier(d.confidence) === "high").length;
  const reviewedCount = 0; // wire this up once you have a review/confirm flow

  const scoped = DETS.filter(d => {
    if (scope === "high") return tier(d.confidence) === "high";
    if (scope === "reviewed") return false; // no review flow yet
    return true;
  });

  const sorted = [...scoped].sort((a, b) => {
    const av = (a as any)[sortKey], bv = (b as any)[sortKey];
    return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * sortDir;
  });

  const doSort = (k: string) => { if (k === sortKey) setSortDir(d => d === 1 ? -1 : 1); else { setSort(k); setSortDir(-1); } };

  const FIELD_LABELS: Record<string, string> = {
    id: "Object ID", type: "Classification", confidence: "Confidence",
    scanId: "Scan ID", timestamp: "Timestamp",
  };
  const COLS = Object.keys(fields).filter(k => fields[k]);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildGeoJSON = () => {
    return {
      type: "FeatureCollection",
      features: sorted.map(d => ({
        type: "Feature",
        geometry: d.latitude != null && d.longitude != null
          ? { type: "Point", coordinates: [d.longitude, d.latitude] }
          : null,
        properties: {
          id: d.id,
          type: d.label || TYPE_LABEL[d.type],
          confidence: d.confidence,
          scanId: d.scanId,
          timestamp: d.timestamp,
        },
      })),
    };
  };

  const buildPrintableReportHtml = () => {
    const rows = sorted.map(d => `
      <tr>
        <td>${d.id}</td>
        <td>${d.label || TYPE_LABEL[d.type]}</td>
        <td>${d.confidence}%</td>
        <td>${d.scanId}</td>
        <td>${d.latitude != null ? d.latitude.toFixed(6) : "N/A"}</td>
        <td>${d.longitude != null ? d.longitude.toFixed(6) : "N/A"}</td>
        <td>${d.timestamp.slice(0, 19).replace("T", " ")}</td>
      </tr>`).join("");

    return `
      <html>
        <head>
          <title>AquaScan Detection Report</title>
          <style>
            body { font-family: -apple-system, Arial, sans-serif; padding: 24px; color: #1B2226; }
            h1 { font-size: 18px; }
            .meta { color: #5B6770; font-size: 12px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #E1E7EA; padding: 6px 8px; text-align: left; }
            th { background: #F7F9FA; text-transform: uppercase; font-size: 9px; letter-spacing: .05em; }
          </style>
        </head>
        <body>
          <h1>AquaScan Marine Debris Detection Report</h1>
          <div class="meta">
            Generated ${new Date().toLocaleString()} &middot; ${sorted.length} detection(s) &middot; scope: ${scope}
          </div>
          <table>
            <thead>
              <tr><th>ID</th><th>Type</th><th>Confidence</th><th>Scan</th><th>Latitude</th><th>Longitude</th><th>Timestamp</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>`;
  };

  const download = () => {
    setDl(true);

    if (fmt === "CSV") {
      const headers = COLS.map(k => FIELD_LABELS[k]);
      const rows = sorted.map(d => COLS.map(k => (d as any)[k]));
      const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
      triggerDownload(new Blob([csv], { type: "text/csv" }), "detections.csv");

    } else if (fmt === "JSON") {
      const json = JSON.stringify(sorted, null, 2);
      triggerDownload(new Blob([json], { type: "application/json" }), "detections.json");

    } else if (fmt === "GeoJSON") {
      const geojson = JSON.stringify(buildGeoJSON(), null, 2);
      triggerDownload(new Blob([geojson], { type: "application/geo+json" }), "detections.geojson");

    } else if (fmt === "PDF") {
      // No PDF library dependency needed -- opens a print-styled window;
      // the user picks "Save as PDF" in their browser's print dialog.
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(buildPrintableReportHtml());
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
      }
    }

    setTimeout(() => setDl(false), 800);
  };

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Config sidebar */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", background: C.card
      }}>
        <PanelHead title="Export Config" />
        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          <div style={{ marginBottom: 10 }}>
            <Label caps>Output format</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
              {(["CSV", "JSON", "GeoJSON", "PDF"] as const).map(f => (
                <label key={f} style={{
                  display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "4px 6px", borderRadius: 2,
                  background: fmt === f ? C.blueBg : "transparent",
                  border: `1px solid ${fmt === f ? C.blueDim : C.border}`
                }}>
                  <input type="radio" checked={fmt === f} onChange={() => setFmt(f)}
                    style={{ accentColor: C.blue }} />
                  <span className="font-mono" style={{ fontSize: 11, color: fmt === f ? C.blue : C.muted }}>{f}</span>
                  <span style={{ fontSize: 10, color: C.faint, marginLeft: "auto" }}>
                    {f === "CSV" ? "tabular" : f === "JSON" ? "machine" : f === "GeoJSON" ? "spatial" : "formatted"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <Label caps>Include fields</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
              {Object.keys(fields).map(k => (
                <label key={k} style={{
                  display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "3px 0"
                }}>
                  <input type="checkbox" checked={fields[k]}
                    onChange={e => setFields(prev => ({ ...prev, [k]: e.target.checked }))}
                    style={{ accentColor: C.blue }} />
                  <span style={{ fontSize: 11, color: fields[k] ? C.navy : C.faint }}>{FIELD_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <Label caps>Filter scope</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
              {([
                ["all", `All detections (${DETS.length})`],
                ["high", `High-confidence only (${highCount})`],
                ["reviewed", `Analyst-reviewed (${reviewedCount})`],
              ] as const).map(([k, l]) => (
                <label key={k} style={{
                  display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "3px 0"
                }}>
                  <input type="radio" name="scope" checked={scope === k}
                    onChange={() => setScope(k as typeof scope)}
                    style={{ accentColor: C.blue }} />
                  <span style={{ fontSize: 11, color: C.muted }}>{l}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label caps>Session metadata</Label>
            <div style={{ marginTop: 6 }}>
              <FieldRow label="Detections" value={String(sorted.length)} mono />
              <FieldRow label="Source" value={DETS[0]?.scanId || "No scan loaded"} mono />
            </div>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 10px" }}>
          <button onClick={download} disabled={sorted.length === 0}
            style={{
              width: "100%", background: dl ? C.blueBg : C.blue, color: dl ? C.blue : "#fff",
              border: `1px solid ${C.blue}`, borderRadius: 2, padding: "6px",
              fontSize: 12, fontWeight: 500, cursor: sorted.length === 0 ? "not-allowed" : "pointer",
              opacity: sorted.length === 0 ? 0.5 : 1, transition: "all .15s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            {dl ? (
              <>
                <div className="spin" style={{
                  width: 10, height: 10, border: `1.5px solid ${C.blue}`,
                  borderTopColor: "transparent", borderRadius: "50%"
                }} />
                <span className="font-mono" style={{ fontSize: 10 }}>Preparing…</span>
              </>
            ) : `↓ Export ${fmt}`}
          </button>
        </div>
      </div>

      {/* Preview table */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <PanelHead title="Preview" sub={`${sorted.length} records · ${COLS.length} fields · scope: ${scope}`}
          right={
            <span className="font-mono" style={{ fontSize: 9, color: C.faint }}>
              {fmt} preview
            </span>
          } />
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
              <tr style={{ background: C.bg }}>
                {COLS.map(k => (
                  <th key={k} onClick={() => doSort(k)}
                    style={{
                      padding: "5px 10px", textAlign: "left", cursor: "pointer",
                      fontSize: 9, fontWeight: 600, color: sortKey === k ? C.blue : C.muted,
                      letterSpacing: ".07em", textTransform: "uppercase",
                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap"
                    }}>
                    {FIELD_LABELS[k]} {sortKey === k ? (sortDir === -1 ? "↓" : "↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={d.id} style={{ borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  {COLS.map(k => {
                    const raw = (d as any)[k];
                    let display = raw;
                    if (k === "type") return <td key={k} style={{ padding: "5px 10px" }}><TypeTag type={d.type} label={d.label} /></td>;
                    if (k === "confidence") return <td key={k} style={{ padding: "5px 10px" }}><TierTag v={d.confidence} /></td>;
                    if (k === "timestamp") display = d.timestamp.slice(0, 19).replace("T", " ");
                    const isBold = k === "id";
                    return (
                      <td key={k} style={{ padding: "5px 10px" }}>
                        <Mono color={isBold ? C.blue : C.navyMd} size="11px">{display}</Mono>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ─── Spatial View ──────────────────────────────────────────────────────────────
function SpatialViewScreen() {
  const [tab, setTab] = useState<"3d" | "ar">("3d");
  const tabStyle = (on: boolean): React.CSSProperties => ({
    border: `1px solid ${on ? C.navyMd : C.borderMd}`,
    background: on ? C.navyMd : C.card,
    color: on ? C.bg : C.muted,
    padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600,
  });
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 18, background: "transparent" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div className="font-mono" style={{ fontSize: 9, color: C.muted, letterSpacing: ".12em" }}>SPATIAL INTELLIGENCE</div>
        <h1 style={{ margin: "6px 0 4px", fontSize: 25, color: C.navy }}>Spatial View</h1>
        <p style={{ margin: 0, color: C.muted, fontSize: 12 }}>Explore mapped detections spatially. AR remains a preview until the camera/GPS module is connected.</p>
        <div style={{ display: "flex", gap: 6, margin: "16px 0 10px" }}>
          <button onClick={() => setTab("3d")} style={tabStyle(tab === "3d")}>3D View</button>
          <button onClick={() => setTab("ar")} style={tabStyle(tab === "ar")}>AR Preview</button>
        </div>
        <div style={{ minHeight: 560, position: "relative", overflow: "hidden", borderRadius: 14, border: `1px solid ${C.border}`, background: C.card }}>
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${C.card}, ${C.blueBg})` }} />
          {tab === "3d" ? <>
            <div style={{ position: "absolute", inset: "18% 8% 0", opacity: .5, transform: "perspective(620px) rotateX(58deg)", transformOrigin: "bottom", backgroundImage: `linear-gradient(${C.borderMd} 1px, transparent 1px),linear-gradient(90deg, ${C.borderMd} 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
            {[['31%','53%','Bottle','CONFIRMED'],['56%','66%','Ghost Net','DRIFTING'],['76%','58%','Tire','STATIONARY']].map(([x,y,name,status]) => <div key={name} style={{ position:'absolute', left:x, top:y, transform:'translate(-50%,-50%)' }}><div style={{ background:C.card, border:`1px solid ${C.borderMd}`, borderRadius:9, padding:'7px 10px', boxShadow:'0 5px 18px rgba(29,53,57,.10)' }}><b style={{fontSize:11,color:C.navy}}>{name}</b><div className="font-mono" style={{fontSize:8,color:C.muted,marginTop:2}}>{status}</div></div><div style={{width:12,height:12,borderRadius:'50%',background:C.navyMd,border:`3px solid ${C.card}`,margin:'5px auto 0'}} /></div>)}
            <div style={{ position:'absolute', left:'50%', top:38, transform:'translateX(-50%)', textAlign:'center', color:C.navyMd }}><SonarDial size={34}/><div className="font-mono" style={{fontSize:8,marginTop:5}}>SURVEY VESSEL</div></div>
          </> : <div style={{ position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)', width:'min(440px,80%)', textAlign:'center' }}><div style={{width:64,height:64,borderRadius:18,border:`1px solid ${C.borderMd}`,display:'grid',placeItems:'center',margin:'0 auto 14px',fontSize:25,color:C.navyMd}}>AR</div><h2 style={{color:C.navy,margin:'0 0 8px'}}>AR Preview</h2><p style={{color:C.muted,lineHeight:1.6,fontSize:12}}>Camera + GPS detection overlays will appear here when the AR module is connected. This is intentionally a frontend preview, not a simulated live feed.</p></div>}
          <div style={{position:'absolute',right:14,top:14,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',color:C.muted,fontSize:10}}><b style={{color:C.navy}}>Layers</b><div style={{marginTop:6}}>✓ Survey path</div><div>✓ Detections</div><div>✓ Labels</div><div>○ Depth grid</div></div>
        </div>
      </div>
    </div>
  );
}

// ─── Shell ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [scanImageUrl, setScanImageUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const contextValue = {
    detections, setDetections, scanImageUrl, setScanImageUrl,
    isProcessing, setIsProcessing,
  };

  return (
  <AquaScanContext.Provider value={contextValue}>
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden", background: "transparent" }}>
      <Sidebar active={screen} onNav={setScreen} />

      <main style={{ flex: 1, display: "flex", minWidth: 0, overflow: "hidden" }}>
        {screen === "home" && <HomeScreen onNav={setScreen} />}
        {screen === "survey" && <SurveyScreen />}
        {screen === "upload" && <UploadScreen onNav={setScreen} />}
        {screen === "viewer" && <ViewerScreen />}
        {screen === "heatmap" && <DebrisHeatmap />}
        {screen === "spatial" && <SpatialViewScreen />}
        {screen === "report" && <ReportScreen />}
      </main>
    </div>
  </AquaScanContext.Provider>
);
}