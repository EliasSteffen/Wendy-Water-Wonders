// Demo mode for Wendy's dashboard on the project website: no Azure needed.
// scripts/build-dashboard.mjs loads this before the dashboard's own script (cloud/static/map.html):
//  1. window.atlas: the few Azure Maps calls the dashboard makes, on MapLibre with free satellite tiles
//  2. window.fetch: answers /api/* from data recorded with the real risk logic (demo-data.json),
//     so the buttons work; nothing leaves the browser
(function () {
  "use strict";

  // ------------------------------------------------------------ Azure Maps -> MapLibre
  let uid = 0;
  const pick = (o, k, d) => (o && o[k] !== undefined ? o[k] : d);

  class DataSource {
    constructor() {
      this.id = `source${++uid}`;
      this.map = null;
      this.fc = { type: "FeatureCollection", features: [] };
    }
    setShapes(features) {
      this.fc = { type: "FeatureCollection", features };
      if (this.map) {
        this.map._ml.getSource(this.id).setData(this.fc);
        this.map._drawLabels(this);
      }
    }
  }

  class Layer {
    constructor(source, id, options) {
      this.source = source;
      this.id = id || `layer${++uid}`;
      this.options = options || {};
      this.map = null;
    }
    setOptions(o) {
      Object.assign(this.options, o);
      if (this.map && o.filter) this.map._ml.setFilter(this.id, o.filter);
    }
  }
  class BubbleLayer extends Layer {
    spec() {
      const o = this.options;
      return {
        type: "circle",
        paint: {
          "circle-color": pick(o, "color", "#ffffff"),
          "circle-radius": pick(o, "radius", 8),
          "circle-stroke-color": pick(o, "strokeColor", "#ffffff"),
          "circle-stroke-width": pick(o, "strokeWidth", 0),
          "circle-opacity": pick(o, "opacity", 1),
          "circle-stroke-opacity": pick(o, "strokeOpacity", 1),
        },
      };
    }
  }
  class LineLayer extends Layer {
    spec() {
      const o = this.options;
      const paint = { "line-color": pick(o, "strokeColor", "#ffffff"), "line-width": pick(o, "strokeWidth", 1) };
      if (o.strokeDashArray) paint["line-dasharray"] = o.strokeDashArray;
      return { type: "line", paint };
    }
  }
  // Text labels become HTML markers, so no font server is needed.
  class SymbolLayer extends Layer {
    spec() {
      return null;
    }
  }

  class AtlasMap {
    constructor(container, o) {
      this._ml = new maplibregl.Map({
        container,
        center: o.center,
        zoom: o.zoom,
        style: {
          version: 8,
          sources: {
            imagery: {
              type: "raster",
              tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              tileSize: 256,
              maxzoom: 18,
              attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
            },
          },
          layers: [{ id: "imagery", type: "raster", source: "imagery" }],
        },
      });
      this._symbols = [];
      this._markers = [];
      this.events = {
        add: (name, a, b) => {
          if (name === "ready") return this._ml.loaded() ? a() : this._ml.on("load", a);
          if (!b) return this._ml.on(name, a);
          this._ml.on(name, a.id, (e) => b({ shapes: e.features.map((f) => ({ getProperties: () => f.properties })) }));
          this._ml.on("mouseenter", a.id, () => (this._ml.getCanvas().style.cursor = "pointer"));
          this._ml.on("mouseleave", a.id, () => (this._ml.getCanvas().style.cursor = ""));
        },
      };
      this.sources = {
        add: (s) => {
          s.map = this;
          this._ml.addSource(s.id, { type: "geojson", data: s.fc });
        },
      };
      this.layers = {
        add: (l) => {
          l.map = this;
          const spec = l.spec();
          if (!spec) return this._symbols.push(l);
          this._ml.addLayer({ id: l.id, source: l.source.id, ...spec, ...(l.options.filter ? { filter: l.options.filter } : {}) });
        },
      };
    }
    _drawLabels(source) {
      this._markers.forEach((m) => m.remove());
      this._markers = [];
      for (const l of this._symbols) {
        if (l.source !== source) continue;
        const t = l.options.textOptions || {};
        const size = t.size || 13;
        const key = Array.isArray(t.textField) ? t.textField[1] : null;
        const off = t.offset || [0, 0];
        for (const f of source.fc.features) {
          if (!f.geometry || f.geometry.type !== "Point" || !key) continue;
          const el = document.createElement("div");
          el.textContent = f.properties[key] ?? "";
          el.style.cssText = `color:${t.color || "#fff"};font:600 ${size}px system-ui,sans-serif;white-space:nowrap;pointer-events:none;` +
            `text-shadow:0 0 3px ${t.haloColor || "#000"},0 0 2px ${t.haloColor || "#000"}`;
          this._markers.push(
            new maplibregl.Marker({ element: el, anchor: "center", offset: [off[0] * size, off[1] * size] })
              .setLngLat(f.geometry.coordinates)
              .addTo(this._ml),
          );
        }
      }
    }
  }

  window.atlas = {
    Map: AtlasMap,
    source: { DataSource },
    layer: { BubbleLayer, LineLayer, SymbolLayer },
    data: {
      Feature: function (geometry, properties) {
        return { type: "Feature", geometry, properties: properties || {} };
      },
      Point: function (coordinates) {
        return { type: "Point", coordinates };
      },
      LineString: function (coordinates) {
        return { type: "LineString", coordinates };
      },
    },
  };

  // ------------------------------------------------------------ the cloud API, from recorded data
  const realFetch = window.fetch.bind(window);
  const loaded = realFetch("demo-data.json").then((r) => r.json());
  let scenario = new URLSearchParams(location.search).get("scenario") || "salt";
  const manual = {}; // colour set by hand: id -> level
  const cleared = new Set(); // points reset to their normal readings
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const find = (d, id) => d.scenarios.find((s) => s.id === id) || d.scenarios[0];

  function state(d) {
    const cur = find(d, scenario);
    const normal = find(d, "normal");
    const st = clone(cur.state);
    st.points = st.points.map((p) => {
      const q = cleared.has(p.id) ? clone(normal.state.points.find((x) => x.id === p.id)) : p;
      if (manual[p.id]) {
        q.level = manual[p.id];
        q.manual = true;
        q.reasons = ["set by hand on the dashboard", ...q.reasons];
      }
      return q;
    });
    st.generated = new Date().toISOString();
    return st;
  }

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const m = url.pathname.match(/\/api\/(\w+)$/);
    if (!m) return realFetch(input, init);
    const d = await loaded;
    const body = init && init.body ? JSON.parse(init.body) : {};
    switch (m[1]) {
      case "state":
        return json(state(d));
      case "history": {
        const id = url.searchParams.get("id");
        const rows = find(d, cleared.has(id) ? "normal" : scenario).history[id];
        if (!rows) return json({ error: "unknown id" }, 400);
        const n = Number(url.searchParams.get("n")) || 150;
        const p = find(d, "normal").state.points.find((x) => x.id === id);
        return json({ id, name: p ? p.name : id, points: rows.slice(-n), limits: d.limits });
      }
      case "override":
        manual[body.point_id] = body.level;
        return json(state(d));
      case "clear":
        if (body.point_id === "all") {
          Object.keys(manual).forEach((k) => delete manual[k]);
          cleared.clear();
          setScenario("normal");
        } else {
          delete manual[body.point_id];
          cleared.add(body.point_id);
        }
        return json(state(d));
      case "reset":
        return json({ ok: true, point_id: body.point_id, by: body.by || "someone" });
      default:
        return json({ error: "not available in the demo" }, 404);
    }
  };

  // ------------------------------------------------------------ demo bar
  let select = null;
  function setScenario(id) {
    scenario = id;
    Object.keys(manual).forEach((k) => delete manual[k]);
    cleared.clear();
    if (select) select.value = id;
    if (typeof window.refresh === "function") window.refresh();
  }

  window.addEventListener("DOMContentLoaded", async () => {
    const d = await loaded;
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:1000;display:flex;align-items:center;gap:10px;padding:8px 12px;" +
      "border-radius:12px;background:rgba(7,11,20,0.9);border:1px solid rgba(148,163,184,0.4);color:#e2e8f0;" +
      "font:600 13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.4)";
    bar.innerHTML = '<span style="color:#facc15">DEMO</span><span>recorded data, nothing is sent</span>';
    select = document.createElement("select");
    select.setAttribute("aria-label", "Demo situation");
    select.style.cssText = "font:inherit;padding:4px 6px;border-radius:8px;background:#0f172a;color:#f8fafc;border:1px solid #475569";
    d.scenarios.forEach((s) => select.add(new Option(s.title, s.id)));
    select.value = scenario;
    select.addEventListener("change", () => setScenario(select.value));
    bar.appendChild(select);
    document.body.appendChild(bar);
  });
})();
