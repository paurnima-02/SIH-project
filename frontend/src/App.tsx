import { useState, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Screen = "home" | "upload" | "viewer" | "map" | "report";
type DebrisType = "ghost_net" | "shipwreck" | "pipe" | "unknown";

interface Detection {
  id: string;
  type: DebrisType;
  confidence: number;
  lat: number;
  lng: number;
  depth: number;
  dimensions: string;
  scanId: string;
  timestamp: string;
  x: number; y: number; w: number; h: number; // bbox % in viewer
  mapX: number; mapY: number; // % position on map
}

// ─── Mock data ────────────────────────────────────────────────────────────────
const DETECTIONS: Detection[] = [
  { id:"D-0041", type:"ghost_net",  confidence:92, lat:36.8124, lng:-122.3891, depth:48,  dimensions:"18×6 m",  scanId:"SC-2024-0041", timestamp:"2024-11-14 08:22 UTC", x:12, y:18, w:22, h:14, mapX:28, mapY:35 },
  { id:"D-0042", type:"shipwreck",  confidence:87, lat:36.7953, lng:-122.4102, depth:74,  dimensions:"31×9 m",  scanId:"SC-2024-0041", timestamp:"2024-11-14 08:31 UTC", x:52, y:42, w:18, h:24, mapX:55, mapY:58 },
  { id:"D-0043", type:"pipe",       confidence:74, lat:36.8231, lng:-122.3612, depth:31,  dimensions:"2×40 m",  scanId:"SC-2024-0041", timestamp:"2024-11-14 08:45 UTC", x:72, y:61, w:8,  h:28, mapX:72, mapY:45 },
  { id:"D-0044", type:"unknown",    confidence:58, lat:36.7801, lng:-122.4387, depth:91,  dimensions:"~5×5 m",  scanId:"SC-2024-0041", timestamp:"2024-11-14 08:52 UTC", x:34, y:72, w:12, h:10, mapX:38, mapY:72 },
  { id:"D-0045", type:"ghost_net",  confidence:81, lat:36.8047, lng:-122.3724, depth:55,  dimensions:"12×4 m",  scanId:"SC-2024-0044", timestamp:"2024-11-15 10:17 UTC", x:61, y:25, w:16, h:12, mapX:62, mapY:28 },
  { id:"D-0046", type:"shipwreck",  confidence:95, lat:36.8312, lng:-122.4218, depth:88,  dimensions:"44×14 m", scanId:"SC-2024-0044", timestamp:"2024-11-15 10:34 UTC", x:22, y:54, w:24, h:18, mapX:20, mapY:62 },
];

const TYPE_LABELS: Record<DebrisType, string> = {
  ghost_net: "Ghost Net", shipwreck: "Shipwreck", pipe: "Pipe/Cable", unknown: "Unknown",
};

const TYPE_COLORS: Record<DebrisType, string> = {
  ghost_net: "#2DD4BF", shipwreck: "#F97316", pipe: "#818CF8", unknown: "#94A3B8",
};

const ACTIVITY = [
  { time:"09:41 UTC", msg:"Scan SC-2024-0046 completed — 2 objects flagged" },
  { time:"08:55 UTC", msg:"High-confidence shipwreck confirmed at 36.831°N" },
  { time:"07:30 UTC", msg:"Scan SC-2024-0045 uploaded — processing" },
  { time:"06:14 UTC", msg:"Ghost net D-0041 exported to GeoJSON" },
  { time:"Yesterday", msg:"Sonar log SC-2024-0041 ingested — 4 detections" },
];

// ─── Shared primitives ────────────────────────────────────────────────────────
function ConfBadge({ v }: { v: number }) {
  const hi = v >= 80;
  return (
    <span
      className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{
        background: hi ? "rgba(45,212,191,0.18)" : "rgba(90,112,144,0.25)",
        color: hi ? "#2DD4BF" : "#94A3B8",
        border: `1px solid ${hi ? "rgba(45,212,191,0.35)" : "rgba(90,112,144,0.3)"}`,
      }}
    >
      {v}%
    </span>
  );
}

function TypePill({ type }: { type: DebrisType }) {
  return (
    <span
      className="text-[10px] font-mono font-medium px-2 py-0.5 rounded uppercase tracking-widest"
      style={{
        color: TYPE_COLORS[type],
        background: TYPE_COLORS[type] + "18",
        border: `1px solid ${TYPE_COLORS[type]}30`,
      }}
    >
      {TYPE_LABELS[type]}
    </span>
  );
}

function Divider() {
  return <div className="h-px w-full" style={{ background: "rgba(45,212,191,0.08)" }} />;
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
const NAV: { id: Screen; label: string; icon: string }[] = [
  { id:"home",   label:"Overview",  icon:"⬡" },
  { id:"upload", label:"New Scan",  icon:"↑" },
  { id:"viewer", label:"Viewer",    icon:"◫" },
  { id:"map",    label:"Map",       icon:"⊕" },
  { id:"report", label:"Report",    icon:"≡" },
];

function Sidebar({ active, onNav }: { active: Screen; onNav: (s: Screen) => void }) {
  return (
    <aside
      className="flex flex-col h-full w-[220px] shrink-0 border-r"
      style={{ background:"#0A0E14", borderColor:"rgba(45,212,191,0.1)" }}
    >
      {/* Logo */}
      <div className="px-6 pt-7 pb-6">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded flex items-center justify-center"
            style={{ background:"rgba(45,212,191,0.12)", border:"1px solid rgba(45,212,191,0.3)" }}
          >
            <SonarIcon />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-widest text-white font-mono">AQUASCAN</div>
            <div className="text-[9px] tracking-widest font-mono" style={{ color:"#5A7090" }}>MARINE AI v2.4</div>
          </div>
        </div>
      </div>
      <Divider />
      {/* Nav items */}
      <nav className="flex-1 px-3 pt-4 flex flex-col gap-0.5">
        {NAV.map(n => {
          const isActive = n.id === active;
          return (
            <button
              key={n.id}
              onClick={() => onNav(n.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150"
              style={{
                background: isActive ? "rgba(45,212,191,0.1)" : "transparent",
                color: isActive ? "#2DD4BF" : "#5A7090",
                border: isActive ? "1px solid rgba(45,212,191,0.2)" : "1px solid transparent",
              }}
            >
              <span className="font-mono text-sm w-4 text-center">{n.icon}</span>
              <span className="text-sm font-medium">{n.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background:"#2DD4BF" }} />
              )}
            </button>
          );
        })}
      </nav>
      {/* Status */}
      <Divider />
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full animate-blink" style={{ background:"#2DD4BF" }} />
          <span className="text-[10px] font-mono" style={{ color:"#5A7090" }}>SYSTEM ONLINE</span>
        </div>
        <div className="font-mono text-[9px]" style={{ color:"#2A3A50" }}>
          MODEL: DEEPSCAN-7B<br />
          GPU: RTX 4090 ×2<br />
          UPTIME: 14d 6h 22m
        </div>
      </div>
    </aside>
  );
}

function SonarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="#2DD4BF" strokeWidth="0.8" strokeOpacity="0.5" />
      <circle cx="8" cy="8" r="3.5" stroke="#2DD4BF" strokeWidth="0.8" strokeOpacity="0.7" />
      <circle cx="8" cy="8" r="1" fill="#2DD4BF" />
      <line x1="8" y1="8" x2="8" y2="2" stroke="#2DD4BF" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// ─── Home screen ──────────────────────────────────────────────────────────────
function HomeScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const highConf = DETECTIONS.filter(d => d.confidence >= 80).length;
  const stats = [
    { label:"Total Scans",     value:"47",     unit:"files",   dim:"last 30 days" },
    { label:"Debris Found",    value:"138",    unit:"objects", dim:"all time" },
    { label:"High-Conf Hazards", value: String(highConf), unit:"critical",dim:"this week", accent:true },
    { label:"Area Covered",    value:"2,841",  unit:"km²",     dim:"surveyed" },
  ];
  return (
    <div className="flex flex-col gap-6 p-8 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color:"#5A7090" }}>
            {/* date */}
            2024-11-15 · SURVEY AREA: MONTEREY BAY, CA
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Mission Overview</h1>
        </div>
        <button
          onClick={() => onNav("upload")}
          className="flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 teal-glow"
          style={{
            background:"rgba(45,212,191,0.15)",
            color:"#2DD4BF",
            border:"1px solid rgba(45,212,191,0.35)",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(45,212,191,0.22)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(45,212,191,0.15)")}
        >
          <span className="text-base font-mono">+</span>
          New Scan
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <div
            key={s.label}
            className="rounded-xl p-5 flex flex-col gap-1"
            style={{
              background:"#0F1520",
              border: s.accent ? "1px solid rgba(45,212,191,0.25)" : "1px solid rgba(255,255,255,0.05)",
              boxShadow: s.accent ? "0 0 24px rgba(45,212,191,0.08)" : "none",
            }}
          >
            <span className="text-xs font-medium" style={{ color:"#5A7090" }}>{s.label}</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span
                className="text-3xl font-semibold font-mono tracking-tight"
                style={{ color: s.accent ? "#2DD4BF" : "#E2EAF4" }}
              >
                {s.value}
              </span>
              <span className="text-xs font-mono" style={{ color:"#2A3A50" }}>{s.unit}</span>
            </div>
            <span className="text-[10px] font-mono mt-0.5" style={{ color:"#2A3A50" }}>{s.dim}</span>
          </div>
        ))}
      </div>

      {/* Main area: recent detections + activity */}
      <div className="grid grid-cols-3 gap-4 flex-1">
        {/* Recent detections */}
        <div
          className="col-span-2 rounded-xl flex flex-col overflow-hidden"
          style={{ background:"#0F1520", border:"1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-sm font-semibold text-white">Recent Detections</span>
            <button onClick={() => onNav("viewer")} className="text-xs font-mono transition-colors" style={{ color:"#2DD4BF" }}>
              Open Viewer →
            </button>
          </div>
          <Divider />
          <div className="flex-1 overflow-y-auto">
            {DETECTIONS.map((d, i) => (
              <div key={d.id}>
                <div className="flex items-center gap-4 px-5 py-3 transition-all duration-150 hover:bg-white/[0.02]">
                  <SonarThumbnail type={d.type} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono font-medium text-white">{d.id}</span>
                      <TypePill type={d.type} />
                    </div>
                    <div className="font-mono text-[10px]" style={{ color:"#5A7090" }}>
                      {d.lat.toFixed(4)}°N, {Math.abs(d.lng).toFixed(4)}°W · {d.depth}m depth
                    </div>
                  </div>
                  <ConfBadge v={d.confidence} />
                  <div className="font-mono text-[10px] text-right" style={{ color:"#2A3A50" }}>
                    {d.timestamp.split(" ")[1]}
                  </div>
                </div>
                {i < DETECTIONS.length - 1 && <Divider />}
              </div>
            ))}
          </div>
        </div>

        {/* Activity feed */}
        <div
          className="rounded-xl flex flex-col overflow-hidden"
          style={{ background:"#0F1520", border:"1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="px-5 py-4">
            <span className="text-sm font-semibold text-white">Activity Log</span>
          </div>
          <Divider />
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-0">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="flex gap-3 py-3">
                <div className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background:"rgba(45,212,191,0.4)" }} />
                <div>
                  <div className="font-mono text-[9px] mb-1" style={{ color:"#5A7090" }}>{a.time}</div>
                  <div className="text-xs leading-relaxed" style={{ color:"#8A9BB0" }}>{a.msg}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SonarThumbnail({ type, size = 48 }: { type: DebrisType; size?: number }) {
  const color = TYPE_COLORS[type];
  return (
    <div
      className="rounded shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background:"#0A0E14", border:`1px solid ${color}25` }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        {type === "ghost_net" && (
          <>
            <path d="M3 6 L21 6 M3 10 L21 10 M3 14 L21 14 M3 18 L21 18" stroke={color} strokeWidth="0.8" strokeOpacity="0.5" />
            <path d="M6 3 L6 21 M10 3 L10 21 M14 3 L14 21 M18 3 L18 21" stroke={color} strokeWidth="0.8" strokeOpacity="0.5" />
            <rect x="8" y="8" width="8" height="8" rx="1" stroke={color} strokeWidth="1.5" fill="none" strokeOpacity="0.8" />
          </>
        )}
        {type === "shipwreck" && (
          <>
            <rect x="4" y="10" width="16" height="7" rx="1" stroke={color} strokeWidth="1.2" fill="none" strokeOpacity="0.8" />
            <path d="M7 10 L7 7 L17 7 L17 10" stroke={color} strokeWidth="1" strokeOpacity="0.6" />
            <line x1="12" y1="7" x2="12" y2="4" stroke={color} strokeWidth="0.8" strokeOpacity="0.5" />
            <line x1="4" y1="17" x2="2" y2="20" stroke={color} strokeWidth="0.8" strokeOpacity="0.4" />
            <line x1="20" y1="17" x2="22" y2="20" stroke={color} strokeWidth="0.8" strokeOpacity="0.4" />
          </>
        )}
        {type === "pipe" && (
          <>
            <rect x="3" y="9" width="18" height="6" rx="3" stroke={color} strokeWidth="1.2" fill="none" strokeOpacity="0.8" />
            <line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth="0.5" strokeOpacity="0.3" strokeDasharray="2 2" />
          </>
        )}
        {type === "unknown" && (
          <>
            <circle cx="12" cy="12" r="7" stroke={color} strokeWidth="1.2" fill="none" strokeOpacity="0.6" strokeDasharray="3 2" />
            <text x="12" y="16" textAnchor="middle" fill={color} fontSize="9" fontFamily="monospace" fillOpacity="0.8">?</text>
          </>
        )}
      </svg>
    </div>
  );
}

// ─── Upload screen ────────────────────────────────────────────────────────────
function UploadScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).map(f => f.name);
    setFiles(prev => [...prev, ...dropped]);
  }, []);

  const startScan = () => {
    setScanning(true);
    setProgress(0);
    const iv = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(iv); setTimeout(() => onNav("viewer"), 600); return 100; }
        return p + Math.random() * 8;
      });
    }, 200);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="font-mono text-[10px] tracking-widest mb-2" style={{ color:"#5A7090" }}>
            INITIATE SCAN · DEEPSCAN-7B INFERENCE
          </div>
          <h1 className="text-2xl font-semibold text-white">Upload Sonar Data</h1>
          <p className="text-sm mt-2 max-w-md mx-auto" style={{ color:"#5A7090" }}>
            Accepts side-scan sonar imagery (.xtf, .jsf, .png, .tif) and raw log files
          </p>
        </div>

        {/* Drop zone */}
        {!scanning && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className="rounded-xl cursor-pointer transition-all duration-300 relative overflow-hidden"
            style={{
              border: dragging ? "1.5px solid rgba(45,212,191,0.6)" : "1.5px dashed rgba(45,212,191,0.2)",
              background: dragging ? "rgba(45,212,191,0.06)" : "#0F1520",
              boxShadow: dragging ? "0 0 40px rgba(45,212,191,0.1)" : "none",
              minHeight: 280,
            }}
          >
            <input ref={inputRef} type="file" multiple className="hidden" onChange={e => {
              const names = Array.from(e.target.files || []).map(f => f.name);
              setFiles(prev => [...prev, ...names]);
            }} />
            <div className="flex flex-col items-center justify-center py-16 gap-5">
              {/* Animated sonar */}
              <SonarAnimation />
              <div className="text-center">
                <div className="text-sm font-medium mb-1" style={{ color: dragging ? "#2DD4BF" : "#8A9BB0" }}>
                  {dragging ? "Release to upload" : "Drag & drop sonar files here"}
                </div>
                <div className="text-xs font-mono" style={{ color:"#2A3A50" }}>or click to browse</div>
              </div>
            </div>
          </div>
        )}

        {/* Scanning progress */}
        {scanning && (
          <div
            className="rounded-xl p-8 flex flex-col items-center gap-5"
            style={{ background:"#0F1520", border:"1px solid rgba(45,212,191,0.2)" }}
          >
            <ScanningAnimation progress={progress} />
            <div className="text-center">
              <div className="font-mono text-xs text-white mb-1">
                {progress < 30 ? "Loading model weights…" : progress < 60 ? "Running inference…" : progress < 85 ? "Post-processing detections…" : "Finalizing results…"}
              </div>
              <div className="font-mono text-[10px]" style={{ color:"#5A7090" }}>
                {Math.floor(Math.min(progress, 100))}% complete
              </div>
            </div>
            <div className="w-full h-1 rounded-full overflow-hidden" style={{ background:"rgba(45,212,191,0.1)" }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width:`${Math.min(progress, 100)}%`, background:"#2DD4BF", boxShadow:"0 0 8px rgba(45,212,191,0.5)" }}
              />
            </div>
          </div>
        )}

        {/* File list */}
        {files.length > 0 && !scanning && (
          <div className="mt-4 rounded-xl overflow-hidden" style={{ background:"#0F1520", border:"1px solid rgba(255,255,255,0.05)" }}>
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: i < files.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background:"rgba(45,212,191,0.1)", color:"#2DD4BF" }}>XTF</span>
                <span className="text-xs text-white font-mono flex-1">{f}</span>
                <span className="text-[10px] font-mono" style={{ color:"#5A7090" }}>Ready</span>
              </div>
            ))}
          </div>
        )}

        {/* Sample file if none */}
        {files.length === 0 && !scanning && (
          <div className="mt-3 flex items-center gap-2 justify-center">
            <span className="text-[10px] font-mono" style={{ color:"#2A3A50" }}>Try sample file:</span>
            <button
              onClick={() => setFiles(["monterey_bay_20241114_sector7.xtf"])}
              className="text-[10px] font-mono transition-colors"
              style={{ color:"#2DD4BF" }}
            >
              monterey_bay_20241114_sector7.xtf
            </button>
          </div>
        )}

        {/* Run scan CTA */}
        {files.length > 0 && !scanning && (
          <button
            onClick={startScan}
            className="mt-5 w-full py-3 rounded-xl font-semibold text-sm transition-all duration-150 teal-glow"
            style={{
              background:"rgba(45,212,191,0.15)",
              color:"#2DD4BF",
              border:"1px solid rgba(45,212,191,0.4)",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(45,212,191,0.22)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(45,212,191,0.15)")}
          >
            Run AI Scan · {files.length} file{files.length > 1 ? "s" : ""}
          </button>
        )}
      </div>
    </div>
  );
}

function SonarAnimation() {
  return (
    <div className="relative w-24 h-24">
      <svg width="96" height="96" viewBox="0 0 96 96" className="absolute inset-0">
        {[6, 16, 26, 36, 44].map((r, i) => (
          <circle key={r} cx="48" cy="48" r={r} fill="none"
            stroke="#2DD4BF" strokeWidth="0.8"
            strokeOpacity={0.08 + i * 0.04}
          />
        ))}
        {/* Sweep */}
        <g className="animate-sonar" style={{ transformOrigin:"48px 48px" }}>
          <path
            d={`M 48 48 L 48 4`}
            stroke="#2DD4BF" strokeWidth="1.5" strokeOpacity="0.8"
          />
          <path
            d={`M 48 48 L 48 4 A 44 44 0 0 1 ${48 + 44 * Math.sin(Math.PI / 6)} ${48 - 44 * Math.cos(Math.PI / 6)}`}
            fill="rgba(45,212,191,0.06)" stroke="none"
          />
        </g>
        {/* Ping */}
        <circle cx="62" cy="30" r="2" fill="#2DD4BF" fillOpacity="0.9" />
        <circle cx="62" cy="30" r="2" fill="none" stroke="#2DD4BF" strokeWidth="1"
          style={{ animation:"ping-dot 2s ease-out infinite" }}
        />
      </svg>
    </div>
  );
}

function ScanningAnimation({ progress }: { progress: number }) {
  return (
    <div className="relative w-20 h-20">
      <svg width="80" height="80" viewBox="0 0 80 80">
        {[8, 16, 24, 32].map(r => (
          <circle key={r} cx="40" cy="40" r={r} fill="none" stroke="#2DD4BF" strokeWidth="0.8" strokeOpacity={0.1} />
        ))}
        <g style={{ transformOrigin:"40px 40px", animation:`sonar-sweep ${2 - progress / 80}s linear infinite` }}>
          <line x1="40" y1="40" x2="40" y2="8" stroke="#2DD4BF" strokeWidth="1.5" strokeOpacity="0.9" />
          <path d="M 40 40 L 40 8 A 32 32 0 0 1 56 13" fill="rgba(45,212,191,0.1)" stroke="none" />
        </g>
        <circle cx="40" cy="40" r="2" fill="#2DD4BF" />
      </svg>
    </div>
  );
}

// ─── Detection Viewer ─────────────────────────────────────────────────────────
function ViewerScreen() {
  const [selected, setSelected] = useState<string | null>(DETECTIONS[0].id);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main sonar image area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3.5 border-b shrink-0" style={{ borderColor:"rgba(45,212,191,0.08)" }}>
          <div>
            <span className="text-sm font-semibold text-white">SC-2024-0041</span>
            <span className="mx-3 text-[10px] font-mono" style={{ color:"#2A3A50" }}>|</span>
            <span className="font-mono text-[10px]" style={{ color:"#5A7090" }}>monterey_bay_20241114_sector7.xtf · 2048×512 px · 450 kHz</span>
          </div>
          <div className="flex items-center gap-3">
            <ToggleChip label="Bboxes" active />
            <ToggleChip label="Masks" active={false} />
            <ToggleChip label="Labels" active />
          </div>
        </div>
        <div className="flex-1 relative overflow-hidden" style={{ background:"#050810" }}>
          {/* Sonar waterfall */}
          <SonarWaterfall detections={DETECTIONS.slice(0, 4)} selected={selected} onSelect={setSelected} />
        </div>
        {/* Depth ruler */}
        <div className="shrink-0 flex items-center gap-4 px-6 py-2 border-t" style={{ borderColor:"rgba(45,212,191,0.08)", background:"#0A0E14" }}>
          <span className="font-mono text-[9px]" style={{ color:"#2A3A50" }}>RANGE: 0 ← 75m | → 75m</span>
          <span className="font-mono text-[9px]" style={{ color:"#2A3A50" }}>FREQUENCY: 450 kHz</span>
          <span className="font-mono text-[9px]" style={{ color:"#2A3A50" }}>SPEED: 3.2 kn</span>
          <span className="font-mono text-[9px] ml-auto" style={{ color:"#5A7090" }}>
            PING RATE: 8/s · LINE: 42 / 204
          </span>
        </div>
      </div>

      {/* Side panel */}
      <div
        className="w-[280px] shrink-0 border-l flex flex-col overflow-hidden"
        style={{ borderColor:"rgba(45,212,191,0.08)", background:"#0A0E14" }}
      >
        <div className="px-5 py-4 border-b shrink-0" style={{ borderColor:"rgba(45,212,191,0.08)" }}>
          <span className="text-sm font-semibold text-white">{DETECTIONS.length} Detections</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {DETECTIONS.map((d, i) => {
            const isSelected = d.id === selected;
            return (
              <div key={d.id}>
                <button
                  onClick={() => setSelected(d.id)}
                  className="w-full text-left p-4 flex gap-3 transition-all duration-150"
                  style={{ background: isSelected ? "rgba(45,212,191,0.06)" : "transparent" }}
                >
                  <SonarThumbnail type={d.type} size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono font-semibold text-white">{d.id}</span>
                      <ConfBadge v={d.confidence} />
                    </div>
                    <TypePill type={d.type} />
                    <div className="mt-1.5 font-mono text-[9px]" style={{ color:"#5A7090" }}>
                      {d.lat.toFixed(4)}°N · {d.depth}m
                    </div>
                    <div className="font-mono text-[9px]" style={{ color:"#2A3A50" }}>{d.dimensions}</div>
                  </div>
                </button>
                {i < DETECTIONS.length - 1 && <Divider />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ToggleChip({ label, active }: { label: string; active: boolean }) {
  const [on, setOn] = useState(active);
  return (
    <button
      onClick={() => setOn(v => !v)}
      className="text-[10px] font-mono px-2.5 py-1 rounded transition-all"
      style={{
        background: on ? "rgba(45,212,191,0.12)" : "rgba(255,255,255,0.04)",
        color: on ? "#2DD4BF" : "#5A7090",
        border: `1px solid ${on ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      {label}
    </button>
  );
}

function SonarWaterfall({ detections, selected, onSelect }: {
  detections: Detection[]; selected: string | null; onSelect: (id: string) => void;
}) {
  return (
    <div className="relative w-full h-full" style={{ userSelect:"none" }}>
      {/* Sonar scan lines background */}
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="sonarGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#0A1628" />
            <stop offset="15%" stopColor="#0D1F35" />
            <stop offset="40%" stopColor="#061020" />
            <stop offset="60%" stopColor="#071525" />
            <stop offset="85%" stopColor="#0D1F35" />
            <stop offset="100%" stopColor="#0A1628" />
          </linearGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="0.3" /></filter>
        </defs>
        <rect width="100" height="100" fill="url(#sonarGrad)" />
        {/* Nadir line */}
        <line x1="50" y1="0" x2="50" y2="100" stroke="#2DD4BF" strokeWidth="0.2" strokeOpacity="0.3" />
        {/* Scan texture lines */}
        {Array.from({length:60}).map((_,i) => (
          <line key={i} x1="0" y1={i*1.7} x2="100" y2={i*1.7}
            stroke="#2DD4BF" strokeWidth="0.08"
            strokeOpacity={0.03 + Math.random() * 0.05}
          />
        ))}
        {/* Seabed return */}
        {Array.from({length:30}).map((_,i) => {
          const x = i / 30 * 100;
          const y = 70 + Math.sin(i * 0.7) * 8 + Math.random() * 4;
          return <rect key={i} x={x} y={y} width="3.5" height="1.5" fill="#2DD4BF" fillOpacity={0.05 + Math.random() * 0.1} rx="0.5" />;
        })}
        {/* Shadow zones */}
        <rect x="4" y="14" width="6" height="8" rx="1" fill="#2DD4BF" fillOpacity="0.12" />
        <rect x="48" y="38" width="10" height="18" rx="1" fill="#2DD4BF" fillOpacity="0.08" />
        <rect x="70" y="55" width="4" height="22" rx="1" fill="#2DD4BF" fillOpacity="0.06" />
      </svg>

      {/* Detection bounding boxes */}
      {detections.map(d => {
        const isSelected = d.id === selected;
        const color = TYPE_COLORS[d.type];
        return (
          <div
            key={d.id}
            className="absolute cursor-pointer transition-all duration-150"
            style={{
              left:`${d.x}%`, top:`${d.y}%`, width:`${d.w}%`, height:`${d.h}%`,
              border: `1.5px solid ${isSelected ? color : color + "88"}`,
              boxShadow: isSelected ? `0 0 12px ${color}40, inset 0 0 8px ${color}10` : `0 0 6px ${color}20`,
              background: isSelected ? `${color}08` : "transparent",
              borderRadius: 4,
            }}
            onClick={() => onSelect(d.id)}
          >
            {/* Confidence badge */}
            <div
              className="absolute -top-5 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded-sm"
              style={{ background:"#0A0E14", border:`1px solid ${color}40`, whiteSpace:"nowrap" }}
            >
              <span className="font-mono text-[9px] font-semibold" style={{ color }}>
                {d.confidence}%
              </span>
              <span className="font-mono text-[8px]" style={{ color: color + "88" }}>
                {TYPE_LABELS[d.type].split(" ")[0].substring(0,3).toUpperCase()}
              </span>
            </div>
            {/* Corner marks */}
            {isSelected && (
              <>
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l" style={{ borderColor: color }} />
                <div className="absolute top-0 right-0 w-2 h-2 border-t border-r" style={{ borderColor: color }} />
                <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l" style={{ borderColor: color }} />
                <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r" style={{ borderColor: color }} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Map screen ───────────────────────────────────────────────────────────────
function MapScreen() {
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [filter, setFilter] = useState<DebrisType | "all">("all");

  const filtered = filter === "all" ? DETECTIONS : DETECTIONS.filter(d => d.type === filter);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Map */}
      <div className="flex-1 relative overflow-hidden">
        <DarkMap />
        {/* Pins */}
        {filtered.map(d => {
          const color = TYPE_COLORS[d.type];
          const isHov = hoveredPin === d.id;
          const isSel = selectedPin === d.id;
          return (
            <div
              key={d.id}
              className="absolute"
              style={{ left:`${d.mapX}%`, top:`${d.mapY}%`, transform:"translate(-50%,-50%)", zIndex: isSel ? 20 : 10 }}
              onMouseEnter={() => setHoveredPin(d.id)}
              onMouseLeave={() => setHoveredPin(null)}
              onClick={() => setSelectedPin(isSel ? null : d.id)}
            >
              {/* Pulse ring */}
              {(isHov || isSel) && (
                <div
                  className="absolute rounded-full animate-ping-dot"
                  style={{
                    width: 24, height: 24,
                    top:"50%", left:"50%", transform:"translate(-50%,-50%)",
                    border:`1.5px solid ${color}`,
                    background:"transparent",
                  }}
                />
              )}
              {/* Pin */}
              <div
                className="cursor-pointer transition-all duration-150 rounded-full flex items-center justify-center"
                style={{
                  width: isSel ? 18 : 12,
                  height: isSel ? 18 : 12,
                  background: isSel ? color : color + "80",
                  border:`2px solid ${color}`,
                  boxShadow: `0 0 ${isSel ? 16 : 8}px ${color}60`,
                }}
              />
              {/* Card */}
              {isSel && (
                <div
                  className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 rounded-lg p-3 shadow-xl"
                  style={{
                    background:"#0F1520",
                    border:"1px solid rgba(45,212,191,0.2)",
                    minWidth:200,
                    boxShadow:"0 0 20px rgba(0,0,0,0.6)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <TypePill type={d.type} />
                    <ConfBadge v={d.confidence} />
                  </div>
                  <div className="font-mono text-[10px] mb-1" style={{ color:"#8A9BB0" }}>
                    {d.lat.toFixed(5)}°N, {Math.abs(d.lng).toFixed(5)}°W
                  </div>
                  <div className="font-mono text-[10px] mb-2" style={{ color:"#5A7090" }}>
                    Depth: {d.depth}m · {d.dimensions}
                  </div>
                  <div className="rounded overflow-hidden">
                    <SonarThumbnail type={d.type} size={52} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* Filter chips */}
        <div
          className="absolute top-4 left-4 flex gap-2 p-2 rounded-xl"
          style={{ background:"rgba(10,14,20,0.85)", border:"1px solid rgba(45,212,191,0.12)", backdropFilter:"blur(12px)" }}
        >
          {(["all","ghost_net","shipwreck","pipe","unknown"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-[10px] font-mono px-2.5 py-1.5 rounded-lg transition-all"
              style={{
                background: filter === f ? "rgba(45,212,191,0.15)" : "transparent",
                color: filter === f ? "#2DD4BF" : "#5A7090",
                border: filter === f ? "1px solid rgba(45,212,191,0.3)" : "1px solid transparent",
              }}
            >
              {f === "all" ? "All" : TYPE_LABELS[f as DebrisType]}
            </button>
          ))}
        </div>
        {/* Legend */}
        <div
          className="absolute bottom-4 right-4 rounded-xl p-3"
          style={{ background:"rgba(10,14,20,0.85)", border:"1px solid rgba(45,212,191,0.12)", backdropFilter:"blur(12px)" }}
        >
          {(["ghost_net","shipwreck","pipe","unknown"] as const).map(t => (
            <div key={t} className="flex items-center gap-2 py-0.5">
              <div className="w-2 h-2 rounded-full" style={{ background:TYPE_COLORS[t] }} />
              <span className="font-mono text-[9px]" style={{ color:"#8A9BB0" }}>{TYPE_LABELS[t]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DarkMap() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="oceanGrad" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#0D1E30" />
          <stop offset="100%" stopColor="#060C14" />
        </radialGradient>
        <filter id="mapBlur"><feGaussianBlur stdDeviation="0.5" /></filter>
      </defs>
      {/* Ocean background */}
      <rect width="800" height="600" fill="url(#oceanGrad)" />
      {/* Depth contours */}
      {[1,2,3,4,5].map(i => (
        <ellipse key={i} cx="400" cy="300" rx={80+i*60} ry={50+i*40}
          fill="none" stroke="#2DD4BF" strokeWidth="0.4" strokeOpacity={0.04 + i * 0.01}
        />
      ))}
      {/* Grid lines (lat/lon) */}
      {Array.from({length:8}).map((_,i) => (
        <line key={`v${i}`} x1={i*115} y1="0" x2={i*115} y2="600"
          stroke="#1A2A40" strokeWidth="0.8" />
      ))}
      {Array.from({length:6}).map((_,i) => (
        <line key={`h${i}`} x1="0" y1={i*120} x2="800" y2={i*120}
          stroke="#1A2A40" strokeWidth="0.8" />
      ))}
      {/* Coastline approximation */}
      <path
        d="M 680 0 L 720 40 L 740 100 L 720 160 L 760 200 L 800 220 L 800 0 Z"
        fill="#152030" stroke="#1E3045" strokeWidth="1"
      />
      <path
        d="M 680 0 L 700 50 L 680 80 L 710 120 L 730 160 L 760 200 L 800 210 L 800 0 Z"
        fill="#162234" stroke="none"
      />
      {/* Lat/lon labels */}
      {["36°48'N","36°47'N","36°46'N"].map((l,i) => (
        <text key={l} x="6" y={80 + i * 130} fill="#2DD4BF" fillOpacity="0.25" fontSize="8"
          fontFamily="'JetBrains Mono', monospace">{l}</text>
      ))}
      {["122°24'W","122°22'W","122°20'W"].map((l,i) => (
        <text key={l} x={90 + i*215} y="590" fill="#2DD4BF" fillOpacity="0.25" fontSize="8"
          fontFamily="'JetBrains Mono', monospace">{l}</text>
      ))}
      {/* Scale bar */}
      <line x1="20" y1="568" x2="120" y2="568" stroke="#2DD4BF" strokeWidth="0.8" strokeOpacity="0.3" />
      <text x="20" y="562" fill="#2DD4BF" fillOpacity="0.4" fontSize="7"
        fontFamily="'JetBrains Mono', monospace">0</text>
      <text x="105" y="562" fill="#2DD4BF" fillOpacity="0.4" fontSize="7"
        fontFamily="'JetBrains Mono', monospace">5 km</text>
      {/* Survey track */}
      <path
        d="M 80 80 Q 200 120 280 200 Q 360 280 420 340 Q 500 400 600 440"
        fill="none" stroke="#2DD4BF" strokeWidth="1" strokeOpacity="0.15" strokeDasharray="6 4"
      />
    </svg>
  );
}

// ─── Report screen ────────────────────────────────────────────────────────────
function ReportScreen() {
  const [sortCol, setSortCol] = useState<string>("confidence");
  const [sortDir, setSortDir] = useState<1|-1>(-1);
  const [downloading, setDownloading] = useState<string | null>(null);

  const sorted = [...DETECTIONS].sort((a, b) => {
    const aVal = (a as any)[sortCol];
    const bVal = (b as any)[sortCol];
    return typeof aVal === "number" ? (aVal - bVal) * sortDir : String(aVal).localeCompare(String(bVal)) * sortDir;
  });

  const handleSort = (col: string) => {
    if (col === sortCol) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortCol(col); setSortDir(-1); }
  };

  const simulateDownload = (fmt: string) => {
    setDownloading(fmt);
    setTimeout(() => setDownloading(null), 1400);
  };

  const COLS: { key: string; label: string; width?: string }[] = [
    { key:"id",         label:"ID",          width:"90px" },
    { key:"type",       label:"Type",        width:"130px" },
    { key:"confidence", label:"Conf.",        width:"80px" },
    { key:"lat",        label:"Latitude",    width:"110px" },
    { key:"lng",        label:"Longitude",   width:"110px" },
    { key:"depth",      label:"Depth",       width:"80px" },
    { key:"dimensions", label:"Dimensions",  width:"110px" },
    { key:"scanId",     label:"Scan ID",     width:"130px" },
    { key:"timestamp",  label:"Timestamp" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 gap-5">
      {/* Header */}
      <div className="flex items-end justify-between shrink-0">
        <div>
          <div className="font-mono text-[10px] tracking-widest mb-1.5" style={{ color:"#5A7090" }}>
            EXPORT · DETECTION REPORT
          </div>
          <h1 className="text-2xl font-semibold text-white">All Detections</h1>
          <p className="text-sm mt-1" style={{ color:"#5A7090" }}>
            {DETECTIONS.length} objects · Monterey Bay survey · Nov 14–15 2024
          </p>
        </div>
        <div className="flex gap-3">
          <DownloadButton label="JSON" loading={downloading === "JSON"} onClick={() => simulateDownload("JSON")} />
          <DownloadButton label="CSV" loading={downloading === "CSV"} onClick={() => simulateDownload("CSV")} />
          <DownloadButton label="GeoJSON" loading={downloading === "GeoJSON"} onClick={() => simulateDownload("GeoJSON")} />
        </div>
      </div>

      {/* Summary */}
      <div className="flex gap-3 shrink-0">
        {(["ghost_net","shipwreck","pipe","unknown"] as const).map(t => {
          const count = DETECTIONS.filter(d => d.type === t).length;
          return (
            <div key={t} className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg"
              style={{ background:"#0F1520", border:"1px solid rgba(255,255,255,0.05)" }}>
              <div className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[t] }} />
              <span className="text-xs" style={{ color:"#8A9BB0" }}>{TYPE_LABELS[t]}</span>
              <span className="font-mono text-sm font-semibold text-white">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden rounded-xl" style={{ background:"#0F1520", border:"1px solid rgba(255,255,255,0.05)" }}>
        {/* Table header */}
        <div
          className="grid border-b text-[10px] font-mono font-semibold uppercase tracking-widest shrink-0"
          style={{ borderColor:"rgba(45,212,191,0.1)", color:"#5A7090",
            gridTemplateColumns: COLS.map(c => c.width || "1fr").join(" ") }}
        >
          {COLS.map(c => (
            <button
              key={c.key}
              onClick={() => handleSort(c.key)}
              className="text-left px-4 py-3 flex items-center gap-1 transition-colors hover:text-teal-300"
              style={{ color: sortCol === c.key ? "#2DD4BF" : "#5A7090" }}
            >
              {c.label}
              {sortCol === c.key && <span style={{ color:"#2DD4BF" }}>{sortDir === -1 ? "↓" : "↑"}</span>}
            </button>
          ))}
        </div>
        {/* Rows */}
        <div className="overflow-y-auto" style={{ maxHeight:"calc(100% - 44px)" }}>
          {sorted.map((d, i) => (
            <div
              key={d.id}
              className="grid transition-colors hover:bg-white/[0.02]"
              style={{
                gridTemplateColumns: COLS.map(c => c.width || "1fr").join(" "),
                borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
              }}
            >
              <div className="px-4 py-3 font-mono text-[11px] font-semibold" style={{ color:"#2DD4BF" }}>{d.id}</div>
              <div className="px-4 py-3"><TypePill type={d.type} /></div>
              <div className="px-4 py-3"><ConfBadge v={d.confidence} /></div>
              <div className="px-4 py-3 font-mono text-[11px]" style={{ color:"#8A9BB0" }}>{d.lat.toFixed(5)}°N</div>
              <div className="px-4 py-3 font-mono text-[11px]" style={{ color:"#8A9BB0" }}>{Math.abs(d.lng).toFixed(5)}°W</div>
              <div className="px-4 py-3 font-mono text-[11px]" style={{ color:"#8A9BB0" }}>{d.depth} m</div>
              <div className="px-4 py-3 font-mono text-[11px]" style={{ color:"#8A9BB0" }}>{d.dimensions}</div>
              <div className="px-4 py-3 font-mono text-[11px]" style={{ color:"#5A7090" }}>{d.scanId}</div>
              <div className="px-4 py-3 font-mono text-[11px]" style={{ color:"#5A7090" }}>{d.timestamp}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DownloadButton({ label, loading, onClick }: { label: string; loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
      style={{
        background: loading ? "rgba(45,212,191,0.2)" : "rgba(45,212,191,0.1)",
        color: "#2DD4BF",
        border: "1px solid rgba(45,212,191,0.3)",
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={e => !loading && (e.currentTarget.style.background = "rgba(45,212,191,0.18)")}
      onMouseLeave={e => (e.currentTarget.style.background = loading ? "rgba(45,212,191,0.2)" : "rgba(45,212,191,0.1)")}
    >
      {loading ? (
        <span className="font-mono text-[10px] animate-blink">Preparing…</span>
      ) : (
        <>
          <span className="font-mono text-xs">↓</span>
          <span className="font-mono text-xs">{label}</span>
        </>
      )}
    </button>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>("home");

  const SCREENS: Record<Screen, React.ReactNode> = {
    home:   <HomeScreen onNav={setScreen} />,
    upload: <UploadScreen onNav={setScreen} />,
    viewer: <ViewerScreen />,
    map:    <MapScreen />,
    report: <ReportScreen />,
  };

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background:"#0A0E14" }}>
      <Sidebar active={screen} onNav={setScreen} />
      <main className="flex-1 overflow-hidden">
        {SCREENS[screen]}
      </main>
    </div>
  );
}
