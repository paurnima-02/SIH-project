import { createContext, useContext, useState, useRef, useCallback } from "react";
import { predictImage } from "./api";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        "#F7F9FA",
  card:      "#FFFFFF",
  border:    "#E1E7EA",
  borderMd:  "#C8D2D8",
  borderDk:  "#9AADB8",
  navy:      "#1B2226",
  navyMd:    "#2D3E47",
  muted:     "#5B6770",
  faint:     "#8FA0AA",
  blue:      "#4FB6E8",
  blueBg:    "#EDF7FD",
  blueDim:   "#BDE0F5",
  orange:    "#F4802B",
  orangeBg:  "#FEF3EC",
  orangeDim: "#F9C49A",
  green:     "#4C9A6B",
  greenBg:   "#ECF5F0",
  greenDim:  "#A8D4BC",
  redAlert:  "#D64545",
  amberWarn: "#B87B1A",
};

// ─── Types ─────────────────────────────────────────────────────────────────────
type Screen = "home"|"upload"|"viewer"|"map"|"queue"|"compare"|"report";
type DebrisType =
  | "ghost_net" | "shipwreck" | "pipe" | "unknown"
  | "bottle" | "can" | "chain" | "drink_carton" | "hook"
  | "propeller" | "shampoo_bottle" | "standing_bottle" | "tire" | "valve";
type ConfTier = "high"|"medium"|"low";

export interface Detection {
  id:string; type:DebrisType; label?:string; confidence:number;
  lat:number; lng:number; depth:number; dimensions:string;
  scanId:string; timestamp:string;
  x:number; y:number; w:number; h:number;
  mapX:number; mapY:number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<DebrisType,string> = {
  ghost_net:"Ghost Net", shipwreck:"Shipwreck", pipe:"Pipe/Cable", unknown:"Unknown",
  bottle:"Bottle", can:"Can", chain:"Chain", drink_carton:"Drink Carton", hook:"Hook",
  propeller:"Propeller", shampoo_bottle:"Shampoo Bottle", standing_bottle:"Standing Bottle", tire:"Tire", valve:"Valve",
};
const TYPE_CODE: Record<DebrisType,string> = {
  ghost_net:"GN", shipwreck:"SW", pipe:"PC", unknown:"UK", bottle:"BOT", can:"CAN", chain:"CHN",
  drink_carton:"CRT", hook:"HOK", propeller:"PRP", shampoo_bottle:"SHB", standing_bottle:"STB", tire:"TIR", valve:"VAL",
};

function tier(c:number): ConfTier { return c>=75?"high":c>=40?"medium":"low"; }
const TIER_COLOR: Record<ConfTier,string> = { high:C.orange, medium:C.amberWarn, low:C.green };
const TIER_BG:    Record<ConfTier,string> = { high:C.orangeBg, medium:"#FDF6E3", low:C.greenBg };
const TIER_LABEL: Record<ConfTier,string> = { high:"HIGH", medium:"REVIEW", low:"LOW" };

const DEMO_DETS: Detection[] = [
  { id:"D-0041", type:"ghost_net",  confidence:92, lat:36.8124, lng:-122.3891, depth:48,  dimensions:"18.4 × 5.9 m",  scanId:"SC-2024-041", timestamp:"2024-11-14T08:22:17Z", x:10,y:16,w:20,h:14, mapX:28,mapY:35 },
  { id:"D-0042", type:"shipwreck",  confidence:88, lat:36.7953, lng:-122.4102, depth:74,  dimensions:"31.2 × 8.7 m",  scanId:"SC-2024-041", timestamp:"2024-11-14T08:31:04Z", x:52,y:40,w:18,h:24, mapX:55,mapY:58 },
  { id:"D-0043", type:"pipe",       confidence:73, lat:36.8231, lng:-122.3612, depth:31,  dimensions:"1.8 × 39.6 m",  scanId:"SC-2024-041", timestamp:"2024-11-14T08:45:51Z", x:72,y:59,w:7, h:26, mapX:72,mapY:44 },
  { id:"D-0044", type:"unknown",    confidence:55, lat:36.7801, lng:-122.4387, depth:91,  dimensions:"~4.8 × 4.3 m",  scanId:"SC-2024-041", timestamp:"2024-11-14T08:52:33Z", x:33,y:70,w:11,h:10, mapX:38,mapY:72 },
  { id:"D-0045", type:"ghost_net",  confidence:61, lat:36.8047, lng:-122.3724, depth:55,  dimensions:"11.9 × 4.1 m",  scanId:"SC-2024-044", timestamp:"2024-11-15T10:17:08Z", x:61,y:24,w:14,h:11, mapX:62,mapY:28 },
  { id:"D-0046", type:"shipwreck",  confidence:95, lat:36.8312, lng:-122.4218, depth:88,  dimensions:"43.7 × 14.2 m", scanId:"SC-2024-044", timestamp:"2024-11-15T10:34:22Z", x:20,y:52,w:23,h:18, mapX:20,mapY:62 },
  { id:"D-0047", type:"unknown",    confidence:44, lat:36.8188, lng:-122.3510, depth:39,  dimensions:"~2.9 × 3.7 m",  scanId:"SC-2024-044", timestamp:"2024-11-15T10:48:09Z", x:42,y:30,w:9, h:10, mapX:48,mapY:38 },
  { id:"D-0048", type:"pipe",       confidence:67, lat:36.7912, lng:-122.4001, depth:62,  dimensions:"1.1 × 27.8 m",  scanId:"SC-2024-044", timestamp:"2024-11-15T11:02:44Z", x:65,y:44,w:6, h:22, mapX:65,mapY:50 },
];
const SHOW_DEMO = import.meta.env.VITE_USE_DEMO_DATA === "true";
const QUEUE_DETS = DEMO_DETS.filter(d => tier(d.confidence) === "medium");

// ─── Live detection state ──────────────────────────────────────────────────────
interface AquaScanContextValue {
  detections: Detection[];
  setDetections: React.Dispatch<React.SetStateAction<Detection[]>>;
  scanImageUrl: string | null;
  setScanImageUrl: React.Dispatch<React.SetStateAction<string | null>>;
}

const AquaScanContext = createContext<AquaScanContextValue | null>(null);

function useAquaScan() {
  const value = useContext(AquaScanContext);
  if (!value) throw new Error("useAquaScan must be used inside AquaScanContext");
  return value;
}

// ─── Micro-primitives ──────────────────────────────────────────────────────────
function Rule({ axis="h" }: { axis?:"h"|"v" }) {
  return axis==="v"
    ? <div style={{ width:1, background:C.border, alignSelf:"stretch" }} />
    : <div style={{ height:1, background:C.border, width:"100%" }} />;
}

function Mono({ children, color, size="11px" }: { children:React.ReactNode; color?:string; size?:string }) {
  return (
    <span className="font-mono" style={{ fontSize:size, color:color||C.navy, letterSpacing:"-0.01em" }}>
      {children}
    </span>
  );
}

function Label({ children, caps }: { children:React.ReactNode; caps?:boolean }) {
  return (
    <span style={{
      fontSize:10, fontWeight:500, color:C.muted, letterSpacing:caps?".08em":".02em",
      textTransform:caps?"uppercase":"none",
    }}>
      {children}
    </span>
  );
}

function TierTag({ v }: { v:number }) {
  const t = tier(v);
  return (
    <span className="font-mono inline-flex items-center"
      style={{
        fontSize:10, fontWeight:600, padding:"1px 5px",
        background:TIER_BG[t], color:TIER_COLOR[t],
        border:`1px solid ${TIER_COLOR[t]}44`,
        borderRadius:2, letterSpacing:".05em",
      }}>
      {v}%
    </span>
  );
}

function TypeTag({ type, label }: { type:DebrisType; label?:string }) {
  return (
    <span className="font-mono inline-flex items-center"
      style={{
        fontSize:10, fontWeight:500, padding:"1px 5px",
        background:C.bg, color:C.navyMd,
        border:`1px solid ${C.border}`, borderRadius:2,
        letterSpacing:".06em",
      }}>
      {TYPE_CODE[type]}
    </span>
  );
}

function StatusLED({ on, color }: { on:boolean; color:string }) {
  return (
    <span className={on?"led-blink":""} style={{
      display:"inline-block", width:6, height:6,
      borderRadius:"50%", background:on?color:C.borderMd, flexShrink:0,
    }} />
  );
}

function PanelBtn({ label, variant="primary", small, onClick, disabled, icon }:
  { label:string; variant?:"primary"|"ghost"|"orange"|"danger"; small?:boolean;
    onClick?:()=>void; disabled?:boolean; icon?:string }) {
  const s: Record<string,React.CSSProperties> = {
    primary: { background:C.blue,   color:"#fff",    border:`1px solid ${C.blue}` },
    ghost:   { background:"transparent", color:C.muted, border:`1px solid ${C.border}` },
    orange:  { background:C.orange, color:"#fff",    border:`1px solid ${C.orange}` },
    danger:  { background:"transparent", color:C.redAlert, border:`1px solid ${C.redAlert}44` },
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        ...s[variant],
        fontSize:small?10:12, fontWeight:500,
        padding:small?"2px 8px":"4px 12px",
        borderRadius:2, cursor:disabled?"not-allowed":"pointer",
        opacity:disabled?.45:1, display:"inline-flex", alignItems:"center", gap:4,
        transition:"opacity .1s",
      }}>
      {icon&&<span style={{ fontSize:11 }}>{icon}</span>}{label}
    </button>
  );
}

function FieldRow({ label, value, mono }: { label:string; value:string; mono?:boolean }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"4px 0", borderBottom:`1px solid ${C.border}` }}>
      <Label>{label}</Label>
      {mono
        ? <Mono color={C.navyMd}>{value}</Mono>
        : <span style={{ fontSize:12, color:C.navy }}>{value}</span>}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────
const NAV_ITEMS: { id:Screen; label:string; code:string; badge?:number }[] = [
  { id:"home",    label:"Dashboard",    code:"00" },
  { id:"upload",  label:"Ingest",       code:"01" },
  { id:"viewer",  label:"Det. Viewer",  code:"02" },
  { id:"map",     label:"Survey Chart", code:"03" },
  { id:"queue",   label:"Review Queue", code:"04" },
  { id:"compare", label:"Comparison",   code:"05" },
  { id:"report",  label:"Export",       code:"06" },
];

function Sidebar({ active, onNav }: { active:Screen; onNav:(s:Screen)=>void }) {
  const { detections } = useAquaScan();
  const queueCount = detections.filter(d => tier(d.confidence) === "medium").length;
  return (
    <aside style={{
      width:176, flexShrink:0, display:"flex", flexDirection:"column",
      background:C.card, borderRight:`1px solid ${C.border}`,
    }}>
      {/* Instrument header */}
      <div style={{ padding:"10px 12px 8px", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
          <SonarDial size={22} />
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:C.navy, letterSpacing:".04em" }}>AQUASCAN</div>
            <div className="font-mono" style={{ fontSize:9, color:C.muted, letterSpacing:".06em" }}>FIELD TERMINAL</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:6, paddingTop:6, borderTop:`1px solid ${C.border}` }}>
          <div style={{ flex:1 }}>
            <div className="font-mono" style={{ fontSize:9, color:C.faint }}>MODEL</div>
            <div className="font-mono" style={{ fontSize:10, color:C.muted }}>DeepScan-7B</div>
          </div>
          <div>
            <div className="font-mono" style={{ fontSize:9, color:C.faint }}>VER</div>
            <div className="font-mono" style={{ fontSize:10, color:C.muted }}>2.4.1</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex:1, padding:"4px 0" }}>
        {NAV_ITEMS.map(n => {
          const on = n.id === active;
          return (
            <button key={n.id} onClick={() => onNav(n.id)}
              style={{
                width:"100%", textAlign:"left", display:"flex", alignItems:"center",
                gap:8, padding:"6px 12px",
                background:on?C.blueBg:"transparent",
                borderLeft:`2px solid ${on?C.blue:"transparent"}`,
                borderBottom:"none", borderTop:"none", borderRight:"none",
                cursor:"pointer", transition:"background .1s",
              }}>
              <span className="font-mono" style={{ fontSize:9, color:on?C.blue:C.borderDk, width:16 }}>{n.code}</span>
              <span style={{ fontSize:12, fontWeight:on?500:400, color:on?C.blue:C.muted, flex:1 }}>{n.label}</span>
              {(n.id === "queue" ? queueCount : (n.badge || 0)) > 0 && (
                <span className="font-mono" style={{
                  fontSize:9, fontWeight:600, padding:"0px 4px",
                  background:C.orangeBg, color:C.orange, border:`1px solid ${C.orangeDim}`,
                  borderRadius:2,
                }}>{n.id === "queue" ? queueCount : n.badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Status strip */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"8px 12px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
          {[
            { label:"VESSEL", value:"R/V MBYII" },
            { label:"STATUS", value:"ACTIVE" },
            { label:"LAT",    value:"36°48.7N" },
            { label:"LON",    value:"122°24.1W" },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="font-mono" style={{ fontSize:8, color:C.faint, letterSpacing:".07em" }}>{label}</div>
              <div className="font-mono" style={{ fontSize:10, color:C.navyMd }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:6, paddingTop:6, borderTop:`1px solid ${C.border}` }}>
          <StatusLED on color={C.green} />
          <span className="font-mono" style={{ fontSize:9, color:C.muted }}>EDGE GPU · 38 ms</span>
        </div>
      </div>
    </aside>
  );
}

function SonarDial({ size=24 }: { size?:number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={C.blue} strokeWidth="1" fill="none" />
      <circle cx="12" cy="12" r="6"  stroke={C.blue} strokeWidth=".7" fill="none" strokeOpacity=".5" />
      <circle cx="12" cy="12" r="1.5" fill={C.blue} />
      <line x1="12" y1="12" x2="12" y2="2.5" stroke={C.blue} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="17" cy="8"  r="1.5" fill={C.orange} />
    </svg>
  );
}

// ─── Panel wrappers ───────────────────────────────────────────────────────────
function Panel({ children, style }: { children:React.ReactNode; style?:React.CSSProperties }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, ...style }}>
      {children}
    </div>
  );
}

function PanelHead({ title, sub, right }: { title:string; sub?:string; right?:React.ReactNode }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"6px 10px", borderBottom:`1px solid ${C.border}`,
      background:C.bg,
    }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:C.navy, letterSpacing:".01em" }}>{title}</span>
        {sub&&<span className="font-mono" style={{ fontSize:9, color:C.faint }}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

// ─── 0. HOME ──────────────────────────────────────────────────────────────────
function HomeScreen({ onNav }: { onNav:(s:Screen)=>void }) {
  const { detections: DETS } = useAquaScan();
  const high = DETS.filter(d=>tier(d.confidence)==="high");
  const med  = DETS.filter(d=>tier(d.confidence)==="medium");

  return (
    <div style={{ flex:1, overflow:"auto", padding:12 }}>
      {/* Page header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:600, color:C.navy }}>Mission Dashboard</div>
          <div className="font-mono" style={{ fontSize:10, color:C.muted, marginTop:1 }}>
            SC-2024-044 · R/V Monterey Bay II · Monterey Canyon, CA
          </div>
        </div>
        <PanelBtn label="New Scan" variant="orange" icon="+" onClick={() => onNav("upload")} />
      </div>

      {/* Top stat row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, marginBottom:8 }}>
        {[
          { label:"Active Scans",      value:"47",    unit:"missions",  note:"30-day window", color:C.navy },
          { label:"Total Detections",  value:"138",   unit:"objects",   note:"all surveys",   color:C.navy },
          { label:"High-Priority",     value:String(high.length), unit:"≥75% conf.", note:"requires action", color:C.orange },
          { label:"Pending Review",    value:String(med.length),  unit:"40–74% conf.",note:"in queue",        color:C.amberWarn },
          { label:"Survey Coverage",   value:"2,841", unit:"km²",       note:"cumulative",    color:C.navy },
        ].map(s => (
          <Panel key={s.label} style={{ padding:"8px 10px" }}>
            <Label caps>{s.label}</Label>
            <div style={{ marginTop:4 }}>
              <span className="font-mono" style={{ fontSize:22, fontWeight:600, color:s.color, lineHeight:1 }}>{s.value}</span>
              <span className="font-mono" style={{ fontSize:10, color:C.faint, marginLeft:4 }}>{s.unit}</span>
            </div>
            <div style={{ fontSize:10, color:C.faint, marginTop:2 }}>{s.note}</div>
          </Panel>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 280px 240px", gap:8 }}>

        {/* Detection table */}
        <Panel>
          <PanelHead title="Recent Detections" sub="SC-2024-041 · SC-2024-044"
            right={
              <button style={{ fontSize:11, color:C.blue, background:"none", border:"none", cursor:"pointer" }}
                onClick={() => onNav("viewer")}>Viewer →</button>
            } />
          <DetTable dets={DETS} compact />
        </Panel>

        {/* Ecological impact + inference */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <Panel>
            <PanelHead title="Ecological Impact Score" />
            <div style={{ padding:"8px 10px" }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:8 }}>
                <span className="font-mono" style={{ fontSize:28, fontWeight:700, color:C.orange }}>6.4</span>
                <span className="font-mono" style={{ fontSize:11, color:C.faint }}>/10.0</span>
                <span style={{ fontSize:10, fontWeight:500, padding:"2px 6px", borderRadius:2,
                  background:C.orangeBg, color:C.orange, border:`1px solid ${C.orangeDim}`, marginLeft:4 }}>
                  HIGH RISK
                </span>
              </div>
              {[
                { label:"Entanglement risk",  v:78, c:C.orange },
                { label:"Seabed disruption",  v:52, c:C.amberWarn },
                { label:"Habitat impact",     v:34, c:C.green },
              ].map(m => (
                <div key={m.label} style={{ marginBottom:6 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <Label>{m.label}</Label>
                    <Mono color={m.c}>{m.v}%</Mono>
                  </div>
                  <div style={{ height:3, background:C.border, borderRadius:1 }}>
                    <div style={{ height:3, width:`${m.v}%`, background:m.c, borderRadius:1 }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop:8, paddingTop:6, borderTop:`1px solid ${C.border}`,
                fontSize:10, color:C.faint, lineHeight:1.5 }}>
                Confidence-weighted debris-type index. 138 objects scored against IUCN entanglement taxonomy.
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Inference Engine" />
            <div style={{ padding:"6px 10px" }}>
              {[
                { name:"Edge GPU (vessel)", ms:"38", util:71, on:true, loc:"RTX 4090 ×2" },
                { name:"Cloud (GovCloud)",  ms:"212", util:14, on:true, loc:"us-gov-west-1" },
                { name:"Batch queue",       ms:"—",  util:0,  on:false, queued:4 },
              ].map((inf,i) => (
                <div key={inf.name} style={{ padding:"6px 0", borderTop:i?`1px solid ${C.border}`:"none" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                    <StatusLED on={inf.on} color={C.green} />
                    <span style={{ fontSize:11, color:C.navy, fontWeight:500, flex:1 }}>{inf.name}</span>
                    <Mono color={inf.on?C.blue:C.faint}>{inf.ms} ms</Mono>
                  </div>
                  {inf.on && (
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ flex:1, height:2, background:C.border }}>
                        <div style={{ height:2, width:`${inf.util}%`, background:C.blue }} />
                      </div>
                      <Mono color={C.faint}>{inf.util}% GPU</Mono>
                    </div>
                  )}
                  {!inf.on && inf.queued && (
                    <span className="font-mono" style={{ fontSize:9, color:C.orange }}>{inf.queued} tasks queued</span>
                  )}
                  {inf.on && <div className="font-mono" style={{ fontSize:9, color:C.faint, marginTop:2 }}>{inf.loc}</div>}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Activity log */}
        <Panel>
          <PanelHead title="System Activity" />
          <ActivityLog />
        </Panel>
      </div>
    </div>
  );
}

function DetTable({ dets, compact }: { dets:Detection[]; compact?:boolean }) {
  const py = compact ? 5 : 7;
  return (
    <table style={{ width:"100%", borderCollapse:"collapse" }}>
      <thead>
        <tr style={{ background:C.bg }}>
          {["ID","Type","Conf.","Depth","Dimensions","Scan","Time"].map(h => (
            <th key={h} style={{ padding:`4px ${compact?8:10}px`, textAlign:"left",
              fontSize:9, fontWeight:600, color:C.muted, letterSpacing:".07em",
              textTransform:"uppercase", borderBottom:`1px solid ${C.border}` }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dets.map((d,i) => (
          <tr key={d.id} style={{ borderBottom:`1px solid ${C.border}` }}
            onMouseEnter={e => (e.currentTarget.style.background=C.bg)}
            onMouseLeave={e => (e.currentTarget.style.background="transparent")}>
            <td style={{ padding:`${py}px ${compact?8:10}px` }}>
              <Mono color={C.blue}>{d.id}</Mono>
            </td>
            <td style={{ padding:`${py}px ${compact?8:10}px` }}>
              <TypeTag type={d.type} label={d.label} />
            </td>
            <td style={{ padding:`${py}px ${compact?8:10}px` }}>
              <TierTag v={d.confidence} />
            </td>
            <td style={{ padding:`${py}px ${compact?8:10}px` }}>
              <Mono>{d.depth} m</Mono>
            </td>
            <td style={{ padding:`${py}px ${compact?8:10}px` }}>
              <Mono color={C.muted}>{d.dimensions}</Mono>
            </td>
            <td style={{ padding:`${py}px ${compact?8:10}px` }}>
              <Mono color={C.faint}>{d.scanId}</Mono>
            </td>
            <td style={{ padding:`${py}px ${compact?8:10}px` }}>
              <Mono color={C.faint}>{d.timestamp.slice(11,19)}</Mono>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActivityLog() {
  const events = [
    { ts:"11:02:44", msg:"D-0048 pipe detected — conf. 67%",       flag:"REVIEW" },
    { ts:"10:48:09", msg:"D-0047 unknown object flagged",            flag:"REVIEW" },
    { ts:"10:34:22", msg:"D-0046 shipwreck confirmed — conf. 95%",  flag:"HIGH" },
    { ts:"10:17:08", msg:"SC-2024-044 ingest complete",              flag:null },
    { ts:"09:55:00", msg:"Edge GPU model loaded (DeepScan-7B)",     flag:null },
    { ts:"09:40:12", msg:"D-0041 ghost net — export queued",        flag:null },
    { ts:"Yesterday","msg":"SC-2024-041 archive: 4 detections",     flag:null },
  ];
  return (
    <div style={{ overflow:"auto", maxHeight:280 }}>
      {events.map((e,i) => (
        <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"6px 10px",
          borderBottom:`1px solid ${C.border}` }}>
          <Mono color={C.faint} size="9px">{e.ts}</Mono>
          <span style={{ flex:1, fontSize:11, color:C.navyMd, lineHeight:1.4 }}>{e.msg}</span>
          {e.flag&&(
            <span className="font-mono" style={{
              fontSize:8, fontWeight:600, padding:"1px 4px",
              background:e.flag==="HIGH"?C.orangeBg:"#FDF6E3",
              color:e.flag==="HIGH"?C.orange:C.amberWarn,
              border:`1px solid ${e.flag==="HIGH"?C.orangeDim:"#DFC97A"}`,
              borderRadius:2, letterSpacing:".06em", whiteSpace:"nowrap",
            }}>{e.flag}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 1. UPLOAD ────────────────────────────────────────────────────────────────
function UploadScreen({ onNav }: { onNav:(s:Screen)=>void }) {
  const { setDetections, setScanImageUrl } = useAquaScan();
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<{ file:File; name:string; size:string; format:string; towId:string; checksum:string; status:"queued"|"running"|"done"|"error" }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: File[]) => {
    const allowed = new Set(["png", "jpg", "jpeg", "tif", "tiff", "webp"]);
    const accepted = incoming.filter(file => allowed.has(file.name.split(".").pop()?.toLowerCase() || ""));
    if (!accepted.length) {
      setError("Please select a sonar image: PNG, JPG, JPEG, TIFF or WebP.");
      return;
    }
    setError(null);
    setFiles(prev => [...prev, ...accepted.map(file => ({
      file, name:file.name,
      size:`${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      format:(file.name.split(".").pop() || "IMG").toUpperCase(),
      towId:"AUTO", checksum:"PENDING", status:"queued" as const,
    }))]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const runAll = async () => {
    if (!files.length || files.some(f => f.status === "running")) return;
    setError(null);
    setFiles(prev => prev.map(f => ({ ...f, checksum:"API", status:"running" as const })));
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
      setFiles(prev => prev.map(f => ({ ...f, checksum:"API·OK", status:"done" as const })));
      onNav("viewer");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to connect to the prediction backend.";
      setError(`${message} Check VITE_API_URL and make sure FastAPI is running.`);
      setFiles(prev => prev.map(f => ({ ...f, status:"error" as const })));
    }
  };

  return (
    <div style={{ flex:1, overflow:"auto", padding:12 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:8, maxWidth:1100 }}>
        <div>
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:15, fontWeight:600, color:C.navy }}>Data Ingest</div>
            <div className="font-mono" style={{ fontSize:10, color:C.muted }}>Upload sonar images for YOLO inference</div>
          </div>
          <Panel>
            <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={handleDrop} onClick={() => inputRef.current?.click()}
              style={{ minHeight:180, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, cursor:"pointer",
                background:dragging?C.blueBg:"transparent", border:`1px dashed ${dragging?C.blue:C.borderMd}`, transition:"all .15s" }}>
              <input ref={inputRef} type="file" multiple className="hidden" accept=".png,.jpg,.jpeg,.tif,.tiff,.webp"
                onChange={e => addFiles(Array.from(e.target.files || []))} />
              <SonarDial size={36} />
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:13, fontWeight:500, color:dragging?C.blue:C.navyMd }}>{dragging ? "Release to add files" : "Drop sonar images here"}</div>
                <div className="font-mono" style={{ fontSize:10, color:C.faint, marginTop:3 }}>.png  .jpg  .jpeg  .tif  .tiff  .webp — or <span style={{ color:C.blue, textDecoration:"underline" }}>browse</span></div>
              </div>
            </div>
          </Panel>
          {error && <div style={{ marginTop:8, padding:"7px 9px", background:C.orangeBg, color:C.redAlert, border:`1px solid ${C.orangeDim}`, fontSize:11 }}>{error}</div>}
          {files.length > 0 && (
            <Panel style={{ marginTop:8 }}>
              <PanelHead title={`Inference Queue (${files.length})`} right={<PanelBtn label="Run YOLO Inference" variant="orange" small onClick={runAll} disabled={files.some(f => f.status === "running")} />} />
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.bg }}>{["Filename","Format","Size","Status"].map(h => <th key={h} style={{ padding:"4px 8px", textAlign:"left", fontSize:9, color:C.muted, fontWeight:600, letterSpacing:".07em", textTransform:"uppercase", borderBottom:`1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
                <tbody>{files.map((f,i) => <tr key={`${f.name}-${i}`} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:"6px 8px" }}><Mono color={C.navy} size="11px">{f.name}</Mono></td>
                  <td style={{ padding:"6px 8px" }}><Mono color={C.blue}>{f.format}</Mono></td>
                  <td style={{ padding:"6px 8px" }}><Mono color={C.muted}>{f.size}</Mono></td>
                  <td style={{ padding:"6px 8px" }}>{f.status === "running" ? <Mono color={C.blue}>Processing…</Mono> : f.status === "done" ? <Mono color={C.green}>Complete</Mono> : f.status === "error" ? <Mono color={C.redAlert}>Failed</Mono> : <Mono color={C.faint}>Ready</Mono>}</td>
                </tr>)}</tbody>
              </table>
            </Panel>
          )}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <Panel><PanelHead title="Backend Contract" /><div style={{ padding:"8px 10px" }}>
            <FieldRow label="Method" value="POST" mono /><FieldRow label="Route" value="/predict" mono /><FieldRow label="Payload" value="multipart/form-data" mono /><FieldRow label="Field" value="file" mono /><FieldRow label="Response" value="JSON detections" mono />
          </div></Panel>
          <Panel><PanelHead title="Inference Config" /><div style={{ padding:"8px 10px" }}>
            {[['Model','YOLOv8n'],['Input size','640 × 640'],['Training','30 epochs'],['Batch size','16'],['Threshold','Backend-defined']].map(([k,v]) => <FieldRow key={k} label={k} value={v} mono />)}
          </div></Panel>
        </div>
      </div>
    </div>
  );
}

// ─── 2. VIEWER ────────────────────────────────────────────────────────────────
function ViewerScreen() {
  const { detections: DETS, scanImageUrl } = useAquaScan();
  const [selId, setSelId]       = useState<string|null>(DETS[0]?.id ?? null);
  const [showBoxes, setBoxes]   = useState(true);
  const [showHeat, setHeat]     = useState(false);
  const [scrubPct, setScrubPct] = useState(20);
  const sel = DETS.find(d=>d.id===selId);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Toolbar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
        background:C.card, borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div>
            <span style={{ fontSize:12, fontWeight:600, color:C.navy }}>SC-2024-041</span>
            <span style={{ margin:"0 8px", color:C.border }}>|</span>
            <Mono color={C.muted}>MB_202411_SEC7_450kHz.xtf</Mono>
          </div>
          <div style={{ display:"flex", gap:12, marginLeft:8 }}>
            {[["Freq","450 kHz"],["Swath","150 m"],["Speed","3.2 kn"],["Ping","8/s"],["Line","42/204"]].map(([k,v])=>(
              <div key={k} style={{ display:"flex", gap:4 }}>
                <Label caps>{k}</Label>
                <Mono>{v}</Mono>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
          <ToolToggle label="Bounding Boxes" on={showBoxes} onChange={setBoxes} />
          <ToolToggle label="XAI Heatmap" on={showHeat} onChange={setHeat}
            disabled={!selId} color={C.orange} />
        </div>
      </div>

      <div style={{ flex:1, display:"flex", minHeight:0 }}>
        {/* Sonar + scrubber */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
          <div style={{ flex:1, position:"relative", background:"#040C14", overflow:"hidden" }}>
            <SonarCanvas dets={DETS.slice(0,5)} selId={selId} onSel={setSelId}
              showBoxes={showBoxes} showHeat={showHeat} selDet={sel} imageUrl={scanImageUrl || undefined} />
            {/* Nadir label */}
            <div style={{ position:"absolute", top:4, left:"50%", transform:"translateX(-50%)",
              background:"rgba(4,12,20,.75)", border:`1px solid rgba(79,182,232,.2)`,
              padding:"2px 8px", borderRadius:2 }}>
              <Mono color="rgba(79,182,232,.7)" size="9px">NADIR</Mono>
            </div>
          </div>
          <TowScrubber dets={DETS} pct={scrubPct} onChange={setScrubPct} />
        </div>

        {/* Side panel */}
        <div style={{ width:220, flexShrink:0, borderLeft:`1px solid ${C.border}`,
          display:"flex", flexDirection:"column", background:C.card }}>
          <PanelHead title={`${DETS.length} Detections`} sub="SC-2024-041" />
          <div style={{ flex:1, overflowY:"auto" }}>
            {DETS.map(d => {
              const on = d.id === selId;
              return (
                <button key={d.id} onClick={() => setSelId(on?null:d.id)}
                  style={{
                    width:"100%", textAlign:"left", display:"grid",
                    gridTemplateColumns:"28px 1fr auto", gap:6,
                    padding:"7px 10px", alignItems:"center",
                    background:on?C.blueBg:"transparent",
                    borderLeft:`2px solid ${on?C.blue:"transparent"}`,
                    borderBottom:`1px solid ${C.border}`,
                    cursor:"pointer",
                  }}>
                  <TypeTag type={d.type} label={d.label} />
                  <div>
                    <Mono color={on?C.blue:C.navy}>{d.id}</Mono>
                    <div style={{ display:"flex", gap:6, marginTop:2 }}>
                      <Mono color={C.faint} size="9px">{d.depth}m</Mono>
                      <Mono color={C.faint} size="9px">{d.dimensions}</Mono>
                    </div>
                  </div>
                  <TierTag v={d.confidence} />
                </button>
              );
            })}
          </div>
          {/* Detail panel */}
          {sel && (
            <div style={{ borderTop:`1px solid ${C.border}`, padding:"8px 10px" }}>
              <div style={{ marginBottom:6 }}>
                <Label caps>Selected: {sel.id}</Label>
              </div>
              {[
                ["Type",   sel.label || TYPE_LABEL[sel.type]],
                ["Conf.",  `${sel.confidence}%`],
                ["Depth",  `${sel.depth} m`],
                ["Dim.",   sel.dimensions],
                ["Lat",    `${sel.lat.toFixed(5)}°N`],
                ["Lon",    `${Math.abs(sel.lng).toFixed(5)}°W`],
              ].map(([k,v]) => <FieldRow key={k} label={k} value={v} mono />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolToggle({ label, on, onChange, disabled, color }:
  { label:string; on:boolean; onChange:(v:boolean)=>void; disabled?:boolean; color?:string }) {
  const a = color||C.blue;
  return (
    <label style={{ display:"flex", alignItems:"center", gap:6, cursor:disabled?"not-allowed":"pointer",
      opacity:disabled?.4:1 }}>
      <div onClick={() => !disabled&&onChange(!on)}
        style={{ width:28, height:14, borderRadius:7, background:on?a:C.borderMd,
          position:"relative", transition:"background .15s", flexShrink:0, cursor:disabled?"not-allowed":"pointer" }}>
        <div style={{ position:"absolute", top:2, left:on?14:2, width:10, height:10,
          borderRadius:"50%", background:"#fff", transition:"left .15s" }} />
      </div>
      <span style={{ fontSize:11, color:on?a:C.muted }}>{label}</span>
    </label>
  );
}

function SonarCanvas({ dets, selId, onSel, showBoxes, showHeat, selDet, imageUrl }:
  { dets:Detection[]; selId:string|null; onSel:(id:string|null)=>void;
    showBoxes:boolean; showHeat:boolean; selDet?:Detection; imageUrl?:string }) {
  const BOX_C: Record<ConfTier,string> = { high:C.orange, medium:C.amberWarn, low:C.green };

  return (
    <div style={{ position:"absolute", inset:0 }}>
      {imageUrl && <img src={imageUrl} alt="Uploaded sonar scan" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain", opacity:.9 }} />}
      <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wf" x1="0" x2="1">
            <stop offset="0%"   stopColor="#04111E" />
            <stop offset="42%"  stopColor="#0B1E36" />
            <stop offset="50%"  stopColor="#040C14" />
            <stop offset="58%"  stopColor="#0B1E36" />
            <stop offset="100%" stopColor="#04111E" />
          </linearGradient>
          {showHeat&&selDet&&(
            <radialGradient id="heat"
              cx={`${selDet.x+selDet.w/2}%`} cy={`${selDet.y+selDet.h/2}%`} r="20%">
              <stop offset="0%"   stopColor={C.orange} stopOpacity=".55" />
              <stop offset="60%"  stopColor="#F4A261"  stopOpacity=".2" />
              <stop offset="100%" stopColor="transparent" stopOpacity="0" />
            </radialGradient>
          )}
        </defs>
        <rect width="100" height="100" fill="url(#wf)" />
        {/* Scan line texture */}
        {Array.from({length:55}).map((_,i) => (
          <line key={i} x1="0" y1={i*1.84} x2="100" y2={i*1.84}
            stroke="#4FB6E8" strokeWidth=".055" strokeOpacity={.012+Math.random()*.022} />
        ))}
        {/* Nadir */}
        <line x1="50" y1="0" x2="50" y2="100" stroke="#4FB6E8" strokeWidth=".1" strokeOpacity=".3" />
        {/* Seabed return */}
        {Array.from({length:32}).map((_,i) => {
          const x=i*3.2, y=72+Math.sin(i*.85)*5+Math.random()*3;
          return <rect key={i} x={x} y={y} width="3.1" height="1.3" rx=".2"
            fill="#4FB6E8" fillOpacity={.04+Math.random()*.08} />;
        })}
        {/* Acoustic shadows */}
        <rect x="4"  y="13" width="4.5" height="8"  rx=".4" fill="#4FB6E8" fillOpacity=".08"/>
        <rect x="48" y="37" width="9"   height="17" rx=".4" fill="#4FB6E8" fillOpacity=".06"/>
        <rect x="70" y="56" width="3"   height="20" rx=".4" fill="#4FB6E8" fillOpacity=".05"/>
        {/* XAI heatmap */}
        {showHeat&&selDet&&<rect width="100" height="100" fill="url(#heat)" />}
      </svg>

      {/* Bounding boxes */}
      {showBoxes && dets.map(d => {
        const isSel = d.id===selId;
        const col = BOX_C[tier(d.confidence)];
        return (
          <div key={d.id} onClick={() => onSel(isSel?null:d.id)}
            style={{
              position:"absolute",
              left:`${d.x}%`, top:`${d.y}%`, width:`${d.w}%`, height:`${d.h}%`,
              border:`1.5px solid ${col}${isSel?"FF":"88"}`,
              background:isSel?`${col}14`:"transparent",
              cursor:"pointer", transition:"all .1s",
            }}>
            {/* Readout chip */}
            <div style={{ position:"absolute", top:-18, left:0, display:"flex", gap:4, alignItems:"center",
              background:"rgba(4,12,20,.88)", border:`1px solid ${col}55`,
              padding:"1px 6px", borderRadius:2, whiteSpace:"nowrap" }}>
              <span className="font-mono" style={{ fontSize:9, fontWeight:600, color:col }}>
                {d.confidence}% {TYPE_CODE[d.type]}
              </span>
            </div>
            {/* Corner marks */}
            {isSel && [
              { top:0,    left:0,    borderTop:"1.5px",  borderLeft:"1.5px" },
              { top:0,    right:0,   borderTop:"1.5px",  borderRight:"1.5px" },
              { bottom:0, left:0,    borderBottom:"1.5px",borderLeft:"1.5px" },
              { bottom:0, right:0,   borderBottom:"1.5px",borderRight:"1.5px" },
            ].map((c,ci) => (
              <div key={ci} style={{ position:"absolute", width:6, height:6,
                ...Object.fromEntries(Object.entries(c).map(([k,v])=>[k,typeof v==="string"&&v.endsWith("px")?`${v} solid ${col}`:v])) }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TowScrubber({ dets, pct, onChange }:
  { dets:Detection[]; pct:number; onChange:(v:number)=>void }) {
  const ref = useRef<HTMLDivElement>(null);
  const click = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    onChange(Math.round(((e.clientX-r.left)/r.width)*100));
  };

  return (
    <div style={{ borderTop:`1px solid ${C.border}`, background:C.card, flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 10px" }}>
        <span className="font-mono" style={{ fontSize:9, color:C.faint, letterSpacing:".08em",
          textTransform:"uppercase", whiteSpace:"nowrap" }}>TOW TRACK</span>
        {/* Track */}
        <div ref={ref} onClick={click} style={{ flex:1, height:28, position:"relative", cursor:"pointer" }}>
          {/* Track baseline */}
          <div style={{ position:"absolute", top:"50%", left:0, right:0, height:1,
            background:C.border, transform:"translateY(-50%)" }} />
          {/* Anomaly ticks */}
          {dets.map((d,i) => {
            const x = 6 + i*(88/(dets.length-1));
            const t = tier(d.confidence);
            return (
              <div key={d.id} style={{ position:"absolute", left:`${x}%`,
                top:"50%", transform:"translate(-50%,-50%)" }}>
                <div style={{ width:3, height:t==="high"?16:t==="medium"?12:8,
                  background:TIER_COLOR[t], borderRadius:1 }} />
              </div>
            );
          })}
          {/* Playhead */}
          <div style={{ position:"absolute", top:0, bottom:0, left:`${pct}%`,
            width:1, background:C.blue, pointerEvents:"none" }}>
            <div style={{ position:"absolute", top:-3, left:"50%", transform:"translateX(-50%)",
              width:7, height:7, borderRadius:"50%", background:C.blue,
              border:`1.5px solid ${C.card}` }} />
          </div>
        </div>
        <div style={{ display:"flex", gap:16, flexShrink:0 }}>
          <Mono color={C.faint} size="9px">08:00Z</Mono>
          <Mono color={C.faint} size="9px">12:00Z</Mono>
        </div>
        {/* Legend */}
        <div style={{ display:"flex", gap:8, borderLeft:`1px solid ${C.border}`, paddingLeft:8 }}>
          {(["high","medium","low"] as ConfTier[]).map(t=>(
            <div key={t} style={{ display:"flex", alignItems:"center", gap:3 }}>
              <div style={{ width:3, height:10, background:TIER_COLOR[t], borderRadius:1 }} />
              <span className="font-mono" style={{ fontSize:8, color:C.faint }}>
                {t==="high"?"≥75%":t==="medium"?"40–74%":"<40%"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 3. MAP ───────────────────────────────────────────────────────────────────
function MapScreen() {
  const { detections: DETS } = useAquaScan();
  const [sel, setSel]     = useState<string|null>(null);
  const [filt, setFilt]   = useState<ConfTier|"all">("all");
  const visible = filt==="all" ? DETS : DETS.filter(d=>tier(d.confidence)===filt);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Toolbar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 10px",
        background:C.card, borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <Label caps>Filter by tier</Label>
        {(["all","high","medium","low"] as const).map(f => (
          <button key={f} onClick={() => setFilt(f)}
            style={{
              fontSize:10, fontWeight:500, padding:"2px 10px", borderRadius:2, cursor:"pointer",
              background:filt===f?(f==="all"?C.blueBg:TIER_BG[f as ConfTier]):"transparent",
              color:filt===f?(f==="all"?C.blue:TIER_COLOR[f as ConfTier]):C.muted,
              border:`1px solid ${filt===f?(f==="all"?C.blueDim:TIER_COLOR[f as ConfTier]+"44"):C.border}`,
            }}>
            {f==="all"?"All detections":f==="high"?"High (≥75%)":f==="medium"?"Review (40–74%)":"Low (<40%)"}
          </button>
        ))}
        <div style={{ marginLeft:"auto" }}>
          <Mono color={C.faint} size="9px">
            36°45–50′N · 122°20–26′W · Monterey Bay Canyon
          </Mono>
        </div>
      </div>

      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <ChartBg />
        {/* Pins */}
        {visible.map(d => {
          const isSel = sel===d.id;
          const t = tier(d.confidence);
          const col = TIER_COLOR[t];
          const sz = t==="high"?14:t==="medium"?11:9;
          return (
            <div key={d.id} style={{ position:"absolute",
              left:`${d.mapX}%`, top:`${d.mapY}%`,
              transform:"translate(-50%,-50%)", zIndex:isSel?20:10 }}>
              {/* Popup */}
              {isSel && (
                <div className="slide-dn" style={{
                  position:"absolute", bottom:`calc(100% + 8px)`, left:"50%",
                  transform:"translateX(-50%)",
                  background:C.card, border:`1px solid ${C.border}`,
                  padding:"8px 10px", minWidth:196, zIndex:30,
                  boxShadow:"0 2px 8px rgba(0,0,0,.1)",
                }}>
                  {/* Caret */}
                  <div style={{ position:"absolute", bottom:-5, left:"50%", transform:"translateX(-50%)",
                    width:8, height:8, background:C.card, border:`1px solid ${C.border}`,
                    borderTop:"none", borderLeft:"none", rotate:"45deg" }} />
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                    <TypeTag type={d.type} label={d.label} /><TierTag v={d.confidence} />
                  </div>
                  {[
                    ["ID",    d.id],
                    ["Lat",   `${d.lat.toFixed(5)}°N`],
                    ["Lon",   `${Math.abs(d.lng).toFixed(5)}°W`],
                    ["Depth", `${d.depth} m`],
                    ["Dim",   d.dimensions],
                    ["Scan",  d.scanId],
                  ].map(([k,v]) => <FieldRow key={k} label={k} value={v} mono />)}
                </div>
              )}
              <button onClick={() => setSel(isSel?null:d.id)} style={{
                width:sz, height:sz, borderRadius:"50%",
                background:col, border:`2px solid ${C.card}`,
                boxShadow:`0 0 0 1.5px ${col}`, cursor:"pointer",
                transition:"all .1s",
              }} />
            </div>
          );
        })}

        {/* Legend */}
        <Panel style={{ position:"absolute", bottom:12, right:12, padding:"8px 10px", minWidth:160 }}>
          <div style={{ marginBottom:6 }}>
            <Label caps>Confidence tier</Label>
          </div>
          {(["high","medium","low"] as ConfTier[]).map(t => (
            <div key={t} style={{ display:"flex", alignItems:"center", gap:8, padding:"3px 0" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:TIER_COLOR[t] }} />
              <span style={{ fontSize:11, color:C.navyMd, flex:1 }}>
                {t==="high"?"High risk":t==="medium"?"Review required":"Low risk"}
              </span>
              <Mono color={C.faint} size="9px">
                {t==="high"?"≥75%":t==="medium"?"40–74%":"<40%"}
              </Mono>
            </div>
          ))}
          <div style={{ marginTop:6, paddingTop:6, borderTop:`1px solid ${C.border}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"3px 0" }}>
              <div style={{ width:40, height:1, borderTop:`1.5px dashed ${C.blue}` }} />
              <span style={{ fontSize:11, color:C.muted }}>Survey track</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ChartBg() {
  return (
    <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}
      viewBox="0 0 800 580" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="gr" width="52" height="52" patternUnits="userSpaceOnUse">
          <path d="M52 0H0V52" fill="none" stroke={C.border} strokeWidth=".5" />
        </pattern>
        <linearGradient id="sea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#EEF5FA" />
          <stop offset="100%" stopColor="#DDE9F2" />
        </linearGradient>
        <linearGradient id="land" x1="0" x2="1">
          <stop offset="0%" stopColor="#EDE9E0" />
          <stop offset="100%" stopColor="#E3DDD2" />
        </linearGradient>
      </defs>
      <rect width="800" height="580" fill="url(#sea)" />
      <rect width="800" height="580" fill="url(#gr)" />
      {/* Depth contours */}
      {[1,2,3,4,5].map(i=>(
        <ellipse key={i} cx="380" cy="295" rx={60+i*52} ry={38+i*36}
          fill="none" stroke={C.blue} strokeWidth=".4" strokeOpacity={.08+i*.03} />
      ))}
      {/* Depth soundings */}
      {[[120,75,"48"],[250,125,"61"],[400,170,"55"],[520,235,"88"],
        [295,395,"83"],[500,435,"37"],[175,295,"74"],[660,295,"52"]].map(([x,y,v])=>(
        <text key={`${x}`} x={x} y={y} fill={C.navyMd} fillOpacity=".35" fontSize="8"
          fontFamily="'JetBrains Mono',monospace" textAnchor="middle">{v}</text>
      ))}
      {/* Coastline */}
      <path d="M640 0 C655 28,672 65,685 115 C698 165,678 195,698 235 C718 275,758 285,800 290 L800 0Z"
        fill="url(#land)" stroke={C.borderMd} strokeWidth="1" />
      {Array.from({length:9}).map((_,i) => (
        <line key={i} x1={646+i*13} y1={0} x2={633+i*13} y2={32}
          stroke={C.borderMd} strokeWidth=".5" strokeOpacity=".5" />
      ))}
      {/* Survey track */}
      <path d="M75 75 Q195 128 275 208 Q355 288 415 345 Q495 405 595 445"
        fill="none" stroke={C.blue} strokeWidth="1" strokeOpacity=".3" strokeDasharray="6 4" />
      <text x="290" y="274" fill={C.blue} fillOpacity=".45" fontSize="7"
        fontFamily="'JetBrains Mono',monospace" transform="rotate(-25,290,274)">
        SC-2024-041 TOW TRACK
      </text>
      {/* Compass */}
      <g transform="translate(720,500)">
        <circle r="30" fill={C.card} stroke={C.border} strokeWidth=".8" />
        {[0,90,180,270].map(deg=>{
          const r=deg*Math.PI/180;
          return <line key={deg} x1={0} y1={0} x2={28*Math.sin(r)} y2={-28*Math.cos(r)}
            stroke={C.borderMd} strokeWidth=".8" />;
        })}
        <circle r="2.5" fill={C.blue} />
        {[["N",0],["E",90],["S",180],["W",270]].map(([l,d])=>{
          const r=Number(d)*Math.PI/180;
          return <text key={l} x={38*Math.sin(r)} y={-38*Math.cos(r)+3} textAnchor="middle"
            fill={C.muted} fontSize="8" fontFamily="'Inter',sans-serif" fontWeight="600">{l}</text>;
        })}
      </g>
      {/* Lat/lon labels */}
      {["36°48′N","36°47′N","36°46′N"].map((l,i) => (
        <text key={l} x="4" y={68+i*128} fill={C.muted} fillOpacity=".5" fontSize="7"
          fontFamily="'JetBrains Mono',monospace">{l}</text>
      ))}
      <line x1="18" y1="560" x2="98" y2="560" stroke={C.navyMd} strokeWidth=".8" strokeOpacity=".35" />
      <text x="18" y="554" fill={C.muted} fillOpacity=".55" fontSize="7" fontFamily="'JetBrains Mono',monospace">0</text>
      <text x="86" y="554" fill={C.muted} fillOpacity=".55" fontSize="7" fontFamily="'JetBrains Mono',monospace">4 km</text>
    </svg>
  );
}

// ─── 4. REVIEW QUEUE ─────────────────────────────────────────────────────────
function QueueScreen() {
  const { detections: DETS } = useAquaScan();
  const QUEUE_DETS = DETS.filter(d => tier(d.confidence) === "medium");
  const [items, setItems] = useState(
    QUEUE_DETS.map(d => ({ ...d, decision:undefined as "confirmed"|"rejected"|undefined, note:"" }))
  );
  const [idx, setIdx] = useState(0);
  const active = items[idx];
  const pending = items.filter(x=>!x.decision).length;

  const decide = (decision: "confirmed"|"rejected") => {
    setItems(prev => prev.map((x,i) => i===idx ? { ...x, decision } : x));
    if (idx < items.length-1) setIdx(i=>i+1);
  };

  return (
    <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
      {/* Queue list */}
      <div style={{ width:230, flexShrink:0, borderRight:`1px solid ${C.border}`,
        display:"flex", flexDirection:"column", background:C.card }}>
        <PanelHead title="Review Queue"
          sub={`${pending} pending · ${items.length-pending} done`} />
        <div style={{ flex:1, overflowY:"auto" }}>
          {items.map((d,i) => (
            <button key={d.id} onClick={() => setIdx(i)}
              style={{
                width:"100%", textAlign:"left", padding:"8px 10px",
                display:"grid", gridTemplateColumns:"1fr auto",
                alignItems:"center", gap:6,
                background:i===idx?C.bg:"transparent",
                borderLeft:`2px solid ${i===idx?C.blue:"transparent"}`,
                borderBottom:`1px solid ${C.border}`, cursor:"pointer",
              }}>
              <div>
                <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:2 }}>
                  <Mono color={i===idx?C.blue:C.navy}>{d.id}</Mono>
                  <TypeTag type={d.type} label={d.label} />
                </div>
                <Mono color={C.faint} size="9px">{d.lat.toFixed(4)}°N · {d.depth}m</Mono>
              </div>
              <div style={{ textAlign:"right" }}>
                <TierTag v={d.confidence} />
                {d.decision && (
                  <div className="font-mono" style={{ fontSize:9, marginTop:2,
                    color:d.decision==="confirmed"?C.orange:C.green }}>
                    {d.decision==="confirmed"?"✓ CONF":"✕ F/P"}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
        <div style={{ borderTop:`1px solid ${C.border}`, padding:"8px 10px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div>
              <Label caps>Confirmed</Label>
              <Mono color={C.orange}>{items.filter(x=>x.decision==="confirmed").length}</Mono>
            </div>
            <div>
              <Label caps>Rejected</Label>
              <Mono color={C.green}>{items.filter(x=>x.decision==="rejected").length}</Mono>
            </div>
          </div>
        </div>
      </div>

      {/* Review area */}
      {active && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 12px",
            background:C.card, borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
            <span style={{ fontSize:13, fontWeight:600, color:C.navy }}>
              {active.id} — Analyst Review
            </span>
            <TypeTag type={active.type} />
            <TierTag v={active.confidence} />
            <div style={{ marginLeft:"auto" }}>
              <Mono color={C.faint} size="9px">{active.timestamp}</Mono>
            </div>
          </div>

          <div style={{ flex:1, display:"flex", minHeight:0 }}>
            {/* Sonar crop */}
            <div style={{ flex:1, position:"relative", background:"#040C14", overflow:"hidden" }}>
              {/* Sonar backdrop */}
              <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}
                viewBox="0 0 100 100" preserveAspectRatio="none">
                <rect width="100" height="100" fill="#040C14" />
                {Array.from({length:50}).map((_,i) => (
                  <line key={i} x1="0" y1={i*2} x2="100" y2={i*2}
                    stroke="#4FB6E8" strokeWidth=".055" strokeOpacity={.015+Math.random()*.022} />
                ))}
                {/* Heatmap around object */}
                <radialGradient id="qheat" cx="50%" cy="50%" r="30%">
                  <stop offset="0%"   stopColor={TIER_COLOR[tier(active.confidence)]} stopOpacity=".4" />
                  <stop offset="100%" stopColor="transparent" stopOpacity="0" />
                </radialGradient>
                <rect width="100" height="100" fill="url(#qheat)" />
                <rect x="28" y="28" width="44" height="44" rx="1"
                  stroke={TIER_COLOR[tier(active.confidence)]} strokeWidth="1" fill="none" strokeDasharray="3 2" />
                <line x1="50" y1="0" x2="50" y2="100" stroke="#4FB6E8" strokeWidth=".1" strokeOpacity=".2" />
              </svg>
              {/* XAI feature readout */}
              <div style={{ position:"absolute", top:10, left:10, display:"flex", flexDirection:"column", gap:4 }}>
                {[
                  { k:"Acoustic return",    v:"87.3 dB" },
                  { k:"Shadow ratio",       v:"0.71" },
                  { k:"Spectral signature", v:"NET-like" },
                  { k:"Bottom type",        v:"Sand (est.)" },
                ].map(({ k,v }) => (
                  <div key={k} style={{ display:"flex", gap:8, padding:"3px 8px",
                    background:"rgba(4,12,20,.82)", border:"1px solid rgba(79,182,232,.2)",
                    borderRadius:2 }}>
                    <span className="font-mono" style={{ fontSize:9, color:"rgba(79,182,232,.7)" }}>{k}</span>
                    <span className="font-mono" style={{ fontSize:9, fontWeight:600, color:"#E8F4FA" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail + actions */}
            <div style={{ width:240, flexShrink:0, borderLeft:`1px solid ${C.border}`,
              display:"flex", flexDirection:"column", background:C.card, overflow:"auto" }}>
              <div style={{ padding:"8px 10px", borderBottom:`1px solid ${C.border}` }}>
                <Label caps>Object metadata</Label>
                <div style={{ marginTop:6 }}>
                  {[
                    ["Type",        active.label || TYPE_LABEL[active.type]],
                    ["Confidence",  `${active.confidence}%`],
                    ["Tier",        TIER_LABEL[tier(active.confidence)]],
                    ["Depth",       `${active.depth} m`],
                    ["Dimensions",  active.dimensions],
                    ["Latitude",    `${active.lat.toFixed(5)}°N`],
                    ["Longitude",   `${Math.abs(active.lng).toFixed(5)}°W`],
                    ["Scan ID",     active.scanId],
                    ["Timestamp",   active.timestamp.slice(0,19).replace("T"," ")],
                  ].map(([k,v]) => <FieldRow key={k} label={k} value={v} mono />)}
                </div>
              </div>
              <div style={{ padding:"8px 10px", flex:1 }}>
                <Label caps>Analyst decision</Label>
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
                  <PanelBtn label="Confirm Detection" variant="orange"
                    onClick={() => decide("confirmed")} disabled={!!active.decision} />
                  <PanelBtn label="Mark False Positive" variant="ghost"
                    onClick={() => decide("rejected")} disabled={!!active.decision} />
                </div>
                {active.decision && (
                  <div style={{ marginTop:8, padding:"6px 8px", borderRadius:2, textAlign:"center",
                    background:active.decision==="confirmed"?C.orangeBg:C.greenBg,
                    border:`1px solid ${active.decision==="confirmed"?C.orangeDim:C.greenDim}` }}>
                    <span className="font-mono" style={{ fontSize:10, fontWeight:600,
                      color:active.decision==="confirmed"?C.orange:C.green }}>
                      {active.decision==="confirmed"?"CONFIRMED":"FALSE POSITIVE"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 5. COMPARISON ───────────────────────────────────────────────────────────
const DETS_A: Detection[] = SHOW_DEMO ? [
  { ...DEMO_DETS[0], id:"D-0021", confidence:85, scanId:"SC-2024-021", timestamp:"2024-10-02T09:14:00Z", mapX:27,mapY:34 },
  { ...DEMO_DETS[2], id:"D-0022", type:"pipe",    confidence:70, scanId:"SC-2024-021", timestamp:"2024-10-02T09:28:00Z", mapX:70,mapY:43 },
  { ...DEMO_DETS[3], id:"D-0023", type:"unknown", confidence:49, scanId:"SC-2024-021", timestamp:"2024-10-02T09:41:00Z", mapX:37,mapY:71 },
] : [];
const newIds = SHOW_DEMO ? DEMO_DETS.slice(0,6).filter(d => !DETS_A.some(a=>a.mapX===d.mapX&&a.mapY===d.mapY)).map(d=>d.id) : [];

function CompareScreen() {
  const { detections: DETS } = useAquaScan();
  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Diff header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"6px 12px",
        background:C.card, borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div>
            <Label caps>Mission A (baseline)</Label>
            <div style={{ fontSize:12, fontWeight:500, color:C.navy }}>SC-2024-021 · 2 Oct 2024</div>
          </div>
          <span style={{ fontSize:18, color:C.borderMd }}>⇔</span>
          <div>
            <Label caps>Mission B (current)</Label>
            <div style={{ fontSize:12, fontWeight:500, color:C.navy }}>SC-2024-041 · 14 Nov 2024</div>
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:10, alignItems:"center" }}>
          {[
            { label:`${newIds.length} new objects`,  c:C.orange, bg:C.orangeBg, dim:C.orangeDim },
            { label:"0 resolved",                    c:C.green,  bg:C.greenBg,  dim:C.greenDim },
            { label:`${DETS_A.length} persistent`,   c:C.muted,  bg:C.bg,       dim:C.border },
          ].map(({ label,c,bg,dim }) => (
            <span key={label} className="font-mono" style={{
              fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:2,
              background:bg, color:c, border:`1px solid ${dim}`,
            }}>{label}</span>
          ))}
          <Mono color={C.faint} size="9px">Δ 43 days · same corridor</Mono>
        </div>
      </div>

      {/* Side-by-side */}
      <div style={{ flex:1, display:"flex", minHeight:0 }}>
        <ComparePanel label="SC-2024-021 · Oct 2024" dets={DETS_A} newIds={[]} />
        <div style={{ width:1, background:C.border, flexShrink:0 }} />
        <ComparePanel label="SC-2024-041 · Nov 2024" dets={DETS.slice(0,6)} newIds={newIds} />
      </div>

      {/* Diff summary table */}
      <div style={{ borderTop:`1px solid ${C.border}`, background:C.card, flexShrink:0 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", padding:"6px 12px", gap:16 }}>
          {[
            { label:"New detections",   value:String(newIds.length), color:C.orange },
            { label:"Resolved",         value:"0", color:C.green },
            { label:"Persistent",       value:String(DETS_A.length), color:C.muted },
            { label:"Confidence Δ avg", value:"+8.3%", color:C.navy },
            { label:"Survey Δ days",    value:"43 d", color:C.navy },
          ].map(s => (
            <div key={s.label} style={{ display:"flex", gap:10, alignItems:"baseline" }}>
              <Mono color={s.color} size="18px">{s.value}</Mono>
              <Label>{s.label}</Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComparePanel({ label, dets, newIds }:
  { label:string; dets:Detection[]; newIds:string[] }) {
  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
      <div style={{ padding:"4px 10px", background:C.bg, borderBottom:`1px solid ${C.border}` }}>
        <Mono color={C.muted} size="10px">{label}</Mono>
        <span style={{ marginLeft:8, fontSize:10, color:C.faint }}>
          {dets.length} objects · {newIds.length} new
        </span>
      </div>
      <div style={{ flex:1, position:"relative", background:"#040C14" }}>
        <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}
          viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect width="100" height="100" fill="#040C14" />
          {Array.from({length:52}).map((_,i) => (
            <line key={i} x1="0" y1={i*1.95} x2="100" y2={i*1.95}
              stroke="#4FB6E8" strokeWidth=".055" strokeOpacity={.012+Math.random()*.02} />
          ))}
          <line x1="50" y1="0" x2="50" y2="100" stroke="#4FB6E8" strokeWidth=".1" strokeOpacity=".2" />
          {Array.from({length:30}).map((_,i) => {
            const x=i*3.4, y=71+Math.sin(i*.9)*4+Math.random()*3;
            return <rect key={i} x={x} y={y} width="3.3" height="1.2" rx=".2"
              fill="#4FB6E8" fillOpacity={.04+Math.random()*.07} />;
          })}
        </svg>
        {dets.map(d => {
          const isNew = newIds.includes(d.id);
          const col = isNew ? C.orange : TIER_COLOR[tier(d.confidence)];
          return (
            <div key={d.id} style={{
              position:"absolute",
              left:`${d.x}%`, top:`${d.y}%`, width:`${d.w}%`, height:`${d.h}%`,
              border:`1.5px solid ${col}${isNew?"FF":"99"}`,
              background:isNew?`${col}18`:"transparent",
            }}>
              <div style={{ position:"absolute", top:-17, left:0,
                background:"rgba(4,12,20,.9)", border:`1px solid ${col}55`,
                padding:"1px 5px", borderRadius:2, whiteSpace:"nowrap" }}>
                <span className="font-mono" style={{ fontSize:9, fontWeight:600, color:col }}>
                  {isNew?"NEW · ":""}{d.confidence}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 6. REPORT ────────────────────────────────────────────────────────────────
function ReportScreen() {
  const { detections: DETS } = useAquaScan();
  const [fields, setFields] = useState<Record<string,boolean>>({
    id:true, type:true, confidence:true, lat:true, lng:true,
    depth:true, dimensions:true, scanId:true, timestamp:true,
  });
  const [fmt, setFmt]   = useState<"CSV"|"JSON"|"GeoJSON"|"PDF">("CSV");
  const [dl, setDl]     = useState(false);
  const [sortKey, setSort] = useState("confidence");
  const [sortDir, setSortDir] = useState<1|-1>(-1);

  const sorted = [...DETS].sort((a,b) => {
    const av=(a as any)[sortKey], bv=(b as any)[sortKey];
    return (typeof av==="number"?av-bv:String(av).localeCompare(String(bv)))*sortDir;
  });

  const doSort = (k:string) => { if(k===sortKey)setSortDir(d=>d===1?-1:1); else{setSort(k);setSortDir(-1);} };
  const download = () => { setDl(true); setTimeout(()=>setDl(false),1600); };

  const FIELD_LABELS: Record<string,string> = {
    id:"Object ID", type:"Classification", confidence:"Confidence",
    lat:"Latitude", lng:"Longitude", depth:"Depth",
    dimensions:"Dimensions", scanId:"Scan ID", timestamp:"Timestamp",
  };
  const COLS = Object.keys(fields).filter(k=>fields[k]);

  return (
    <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
      {/* Config sidebar */}
      <div style={{ width:220, flexShrink:0, borderRight:`1px solid ${C.border}`,
        display:"flex", flexDirection:"column", background:C.card }}>
        <PanelHead title="Export Config" />
        <div style={{ flex:1, overflow:"auto", padding:"8px 10px" }}>
          <div style={{ marginBottom:10 }}>
            <Label caps>Output format</Label>
            <div style={{ display:"flex", flexDirection:"column", gap:3, marginTop:6 }}>
              {(["CSV","JSON","GeoJSON","PDF"] as const).map(f => (
                <label key={f} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer",
                  padding:"4px 6px", borderRadius:2,
                  background:fmt===f?C.blueBg:"transparent",
                  border:`1px solid ${fmt===f?C.blueDim:C.border}` }}>
                  <input type="radio" checked={fmt===f} onChange={() => setFmt(f)}
                    style={{ accentColor:C.blue }} />
                  <span className="font-mono" style={{ fontSize:11, color:fmt===f?C.blue:C.muted }}>{f}</span>
                  <span style={{ fontSize:10, color:C.faint, marginLeft:"auto" }}>
                    {f==="CSV"?"tabular":f==="JSON"?"machine":f==="GeoJSON"?"spatial":"formatted"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom:10 }}>
            <Label caps>Include fields</Label>
            <div style={{ display:"flex", flexDirection:"column", gap:3, marginTop:6 }}>
              {Object.keys(fields).map(k => (
                <label key={k} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer",
                  padding:"3px 0" }}>
                  <input type="checkbox" checked={fields[k]}
                    onChange={e => setFields(prev => ({ ...prev, [k]:e.target.checked }))}
                    style={{ accentColor:C.blue }} />
                  <span style={{ fontSize:11, color:fields[k]?C.navy:C.faint }}>{FIELD_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom:10 }}>
            <Label caps>Filter scope</Label>
            <div style={{ display:"flex", flexDirection:"column", gap:3, marginTop:6 }}>
              {[
                ["all","All detections (8)"],
                ["high","High-confidence only (4)"],
                ["reviewed","Analyst-reviewed (0)"],
              ].map(([k,l]) => (
                <label key={k} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer",
                  padding:"3px 0" }}>
                  <input type="radio" name="scope" defaultChecked={k==="all"}
                    style={{ accentColor:C.blue }} />
                  <span style={{ fontSize:11, color:C.muted }}>{l}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label caps>Mission metadata</Label>
            <div style={{ marginTop:6 }}>
              {[
                ["Vessel",    "R/V Monterey Bay II"],
                ["Area",      "Monterey Bay Canyon"],
                ["Surveys",   "SC-2024-041, 044"],
                ["Generated", "2024-11-15 11:45Z"],
              ].map(([k,v]) => <FieldRow key={k} label={k} value={v} mono />)}
            </div>
          </div>
        </div>

        <div style={{ borderTop:`1px solid ${C.border}`, padding:"8px 10px" }}>
          <button onClick={download}
            style={{
              width:"100%", background:dl?C.blueBg:C.blue, color:dl?C.blue:"#fff",
              border:`1px solid ${C.blue}`, borderRadius:2, padding:"6px",
              fontSize:12, fontWeight:500, cursor:"pointer", transition:"all .15s",
              display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            }}>
            {dl ? (
              <>
                <div className="spin" style={{ width:10,height:10,border:`1.5px solid ${C.blue}`,
                  borderTopColor:"transparent",borderRadius:"50%" }} />
                <span className="font-mono" style={{ fontSize:10 }}>Preparing…</span>
              </>
            ) : `↓ Export ${fmt}`}
          </button>
        </div>
      </div>

      {/* Preview table */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <PanelHead title="Preview" sub={`${DETS.length} records · ${COLS.length} fields`}
          right={
            <span className="font-mono" style={{ fontSize:9, color:C.faint }}>
              {fmt} preview
            </span>
          } />
        <div style={{ flex:1, overflow:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead style={{ position:"sticky", top:0, zIndex:2 }}>
              <tr style={{ background:C.bg }}>
                {COLS.map(k => (
                  <th key={k} onClick={() => doSort(k)}
                    style={{ padding:"5px 10px", textAlign:"left", cursor:"pointer",
                      fontSize:9, fontWeight:600, color:sortKey===k?C.blue:C.muted,
                      letterSpacing:".07em", textTransform:"uppercase",
                      borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>
                    {FIELD_LABELS[k]} {sortKey===k?(sortDir===-1?"↓":"↑"):""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d,i) => (
                <tr key={d.id} style={{ borderBottom:`1px solid ${C.border}` }}
                  onMouseEnter={e=>(e.currentTarget.style.background=C.bg)}
                  onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                  {COLS.map(k => {
                    const raw = (d as any)[k];
                    let display = raw;
                    if(k==="type")   return <td key={k} style={{ padding:"5px 10px" }}><TypeTag type={d.type} label={d.label} /></td>;
                    if(k==="confidence") return <td key={k} style={{ padding:"5px 10px" }}><TierTag v={d.confidence} /></td>;
                    if(k==="lat")    display = `${d.lat.toFixed(5)}°N`;
                    if(k==="lng")    display = `${Math.abs(d.lng).toFixed(5)}°W`;
                    if(k==="depth")  display = `${d.depth} m`;
                    if(k==="timestamp") display = d.timestamp.slice(0,19).replace("T"," ");
                    const isBold = k==="id";
                    return (
                      <td key={k} style={{ padding:"5px 10px" }}>
                        <Mono color={isBold?C.blue:C.navyMd} size="11px">{display}</Mono>
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

// ─── Shell ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [detections, setDetections] = useState<Detection[]>(SHOW_DEMO ? DEMO_DETS : []);
  const [scanImageUrl, setScanImageUrl] = useState<string | null>(null);
  const contextValue = { detections, setDetections, scanImageUrl, setScanImageUrl };

  return (
    <AquaScanContext.Provider value={contextValue}>
      <div style={{ display:"flex", height:"100%", width:"100%", overflow:"hidden", background:C.bg }}>
        <Sidebar active={screen} onNav={setScreen} />
        <main style={{ flex:1, display:"flex", minWidth:0, overflow:"hidden" }}>
          {screen==="home"    && <HomeScreen    onNav={setScreen} />}
          {screen==="upload"  && <UploadScreen  onNav={setScreen} />}
          {screen==="viewer"  && <ViewerScreen />}
          {screen==="map"     && <MapScreen />}
          {screen==="queue"   && <QueueScreen />}
          {screen==="compare" && <CompareScreen />}
          {screen==="report"  && <ReportScreen />}
        </main>
      </div>
    </AquaScanContext.Provider>
  );
}
