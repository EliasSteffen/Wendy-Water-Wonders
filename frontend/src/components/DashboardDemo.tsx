import { useState } from "react";
import demo from "../data/dashboard-demo.json";

type Scenario = (typeof demo.scenarios)[number];
type Point = Scenario["points"][number];

const FILL = { none: "#f8fafc", yellow: "#facc15", red: "#ef4444" } as const;
const LEVEL_TEXT = { none: "no anomaly measured", yellow: "watch", red: "not drinkable" } as const;
const SOURCE = { borehole: "borehole", shallow_well: "shallow well", open_pan: "open pan" } as Record<string, string>;
const W = 400;
const H = 300;

// The 14 demo points (placeholder positions near Lodwar), stretched to fill the little map.
const lats = demo.scenarios[0].points.map((p) => p.lat);
const lons = demo.scenarios[0].points.map((p) => p.lon);
const xy = (p: Point) => ({
  x: 36 + ((p.lon - Math.min(...lons)) / (Math.max(...lons) - Math.min(...lons))) * (W - 72),
  y: 30 + ((Math.max(...lats) - p.lat) / (Math.max(...lats) - Math.min(...lats))) * (H - 60),
});

const level = (p: Point) => p.level as keyof typeof FILL;

export default function DashboardDemo() {
  const [sid, setSid] = useState("salt");
  const [sel, setSel] = useState("wp07");
  const s = demo.scenarios.find((x) => x.id === sid)!;
  const p = s.points.find((x) => x.id === sel)!;
  const alerts = s.points.filter((x) => x.level !== "none");

  return (
    <div className="dash">
      <div className="dash-tabs" role="tablist" aria-label="Demo situations">
        {demo.scenarios.map((sc) => (
          <button key={sc.id} type="button" role="tab" aria-selected={sc.id === sid} onClick={() => setSid(sc.id)}>
            {sc.title}
          </button>
        ))}
      </div>
      <p className="dash-note">{s.note}</p>
      <div className="dash-grid">
        <svg className="dash-map" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Water points on the dashboard map">
          {s.points.map((x) => {
            const { x: cx, y: cy } = xy(x);
            const lv = level(x);
            return (
              <g key={x.id}>
                {x.outlook_level !== "none" && <circle cx={cx} cy={cy} r={17} fill="none" stroke={FILL[x.outlook_level as keyof typeof FILL]} strokeWidth={2} opacity={0.7} />}
                <circle
                  cx={cx}
                  cy={cy}
                  r={x.live ? 11 : 8}
                  fill={FILL[lv]}
                  stroke={x.worsening ? "#ef4444" : x.id === sel ? "#60a5fa" : "#0f172a"}
                  strokeWidth={x.id === sel || x.worsening ? 3.5 : 2}
                  tabIndex={0}
                  role="button"
                  aria-label={`${x.label} ${x.name}: ${LEVEL_TEXT[lv]}`}
                  aria-pressed={x.id === sel}
                  onClick={() => setSel(x.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(x.id)}
                />
                <text x={cx} y={cy - 15} textAnchor="middle">
                  {x.label}
                  {x.live ? " · live" : ""}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="dash-side">
          <div className="dash-box">
            <h3>Warnings</h3>
            {alerts.length === 0 ? (
              <p style={{ margin: 0 }}>None. White means "no anomaly measured", never "safe".</p>
            ) : (
              <ul>
                {alerts.map((x) => (
                  <li key={x.id}>
                    <span className={`badge ${level(x)}`}>{x.label}</span> {x.reasons[0]}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="dash-box">
            <h3>Test today</h3>
            <ul>
              {s.priorities.map((t) => (
                <li key={t.id}>
                  {t.label} {t.name}: {t.why}
                </li>
              ))}
            </ul>
          </div>
          <div className="dash-box" aria-live="polite">
            <h3>
              {p.label} · {p.name}
            </h3>
            <p style={{ margin: "0 0 6px" }}>
              <span className={`badge ${level(p)}`}>{LEVEL_TEXT[level(p)]}</span> {SOURCE[p.source] ?? p.source} · {p.people} people
              {p.tds !== null && <> · salt ~{p.tds} mg/L</>}
            </p>
            {p.reasons.length > 0 && <p style={{ margin: "0 0 6px" }}>{p.reasons.join(" · ")}</p>}
            {p.advice.length > 0 && (
              <ul>
                {p.advice.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            {p.alternative && (
              <p style={{ margin: "6px 0 0" }}>
                Nearest alternative: <b>{p.alternative.label}</b> {p.alternative.name}, {p.alternative.km} km
              </p>
            )}
            {p.outlook.map((o) => (
              <p key={o.title} style={{ margin: "6px 0 0" }}>
                Outlook: <b>{o.title}</b>. {o.message}
              </p>
            ))}
          </div>
          {s.sms.map((text) => (
            <div key={text} className="dash-box">
              <h3>SMS that goes out</h3>
              <div className="sms">{text}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="fine" style={{ marginBottom: 0 }}>
        Computed with the project's own risk logic (<code>cloud/export_demo_state.py</code> runs <code>cloud/logic.py</code>). Click a point
        for details. Positions near Lodwar and all limits are placeholders; only well07 was a real station.
      </p>
    </div>
  );
}
