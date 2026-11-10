import { jsonForScript, type StandalonePayload } from "./standalone-payload";

/**
 * Visor HTML de un solo fichero: datos, estilos y script van incrustados. Se abre con doble clic en cualquier
 * navegador (`file://`); no habla con A-Link ni con ZoomCharts.
 */
export function buildStandaloneHtml(payload: StandalonePayload): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="referrer" content="no-referrer"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"/>
  <title>${escapeHtml(payload.title)} · A-Link</title>
  <style>${CSS}</style>
</head>
<body>
  <div id="frame"${payload.letterhead ? ' class="has-bg"' : ""}>
    ${payload.letterhead ? `<img class="bg" src="${escapeAttr(payload.letterhead)}" alt=""/>` : ""}
    <div id="stage">
      <main id="canvas-wrap"><svg id="canvas" role="img" aria-label="Grafo"></svg></main>
      <aside id="filters" aria-label="Filtros del grafo"></aside>
      <aside id="card" hidden></aside>
      <footer>
        <div>
          <h1 id="title"></h1>
          <p id="meta"></p>
        </div>
        <button type="button" id="fit">Ajustar a la vista</button>
      </footer>
    </div>
  </div>
  <script>
${RUNTIME}
boot(${jsonForScript(payload)});
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const CSS = `
:root { color-scheme: light; --ink:#0f172a; --muted:#64748b; --line:#cbd5e1; --card:#fff; --accent:#1d4ed8; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; color: var(--ink); background:#fff; }
#frame { position:relative; height:100dvh; overflow:hidden; background:#fff; }
.bg { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; pointer-events:none; user-select:none; }
#stage { position:absolute; display:flex; flex-direction:column; min-height:0; z-index:1;
  left: 4.8%; right: 3%; top: 5%; bottom: 9.2%; }
#frame:not(.has-bg) #stage { inset:0; }
#canvas-wrap { position:relative; flex:1; min-height:0; }
#canvas { width:100%; height:100%; display:block; cursor:grab; }
#canvas.drag { cursor:grabbing; }
#filters { position:absolute; left:12px; bottom:12px; z-index:2; max-width:min(22rem, 70%);
  border:1px solid var(--line); border-radius:12px; background:var(--card); padding:10px 12px; box-shadow:0 8px 24px rgb(15 23 42 / .12); }
#filters h2 { margin:0 0 6px; font-size:12px; }
#filters .chips { display:flex; flex-wrap:wrap; gap:6px; }
#filters button { border:1px solid var(--line); background:#fff; border-radius:999px; padding:3px 10px; font-size:12px; cursor:pointer; }
#filters button[aria-pressed="false"] { opacity:.45; }
#filters .hint, #meta { color:var(--muted); font-size:12px; margin:8px 0 0; }
#card { position:absolute; right:12px; bottom:12px; z-index:2; max-width:18rem;
  border:1px solid var(--line); border-radius:12px; background:var(--card); padding:12px; box-shadow:0 8px 24px rgb(15 23 42 / .12); }
#card h2 { margin:0; font-size:14px; }
#card .type { display:inline-block; margin-top:4px; font-size:11px; background:#e2e8f0; border-radius:6px; padding:1px 6px; }
#card dl { margin:8px 0 0; display:grid; gap:4px; }
#card dt { color:var(--muted); font-size:12px; }
#card dd { margin:0; word-break:break-word; }
#card .actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
#card .actions button, #fit { border:1px solid var(--line); background:#fff; border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer; }
#card .actions button[disabled] { opacity:.5; cursor:default; }
footer { display:flex; align-items:center; gap:12px; padding:6px 8px 2px; }
footer h1 { margin:0; font-size:16px; }
#fit { margin-left:auto; }
`.replace(/\n/g, "");

const RUNTIME = `
function boot(P) {
  var R = 28, PAD = 80;
  var hiddenTypes = {};
  var focus = null;
  var selected = null;
  var pan = { x: 0, y: 0, k: 1 };
  var dragging = null;
  var panning = null;
  var svg = document.getElementById("canvas");
  var filters = document.getElementById("filters");
  var card = document.getElementById("card");
  document.getElementById("title").textContent = P.title;
  var gen = new Date(P.generatedAt);
  document.getElementById("meta").textContent =
    (P.note ? P.note + " · " : "") + "Vista interactiva de solo lectura · " +
    gen.toLocaleString("es", { dateStyle: "long", timeStyle: "short" });

  var byId = {};
  P.nodes.forEach(function (n) { byId[n.id] = n; });
  var typeName = {};
  P.types.forEach(function (t) { typeName[t.id] = t.name; });

  function adj() {
    var m = {};
    P.edges.forEach(function (e) {
      if (hiddenTypes[byId[e.sourceId] && byId[e.sourceId].type] || hiddenTypes[byId[e.targetId] && byId[e.targetId].type]) return;
      (m[e.sourceId] || (m[e.sourceId] = [])).push(e.targetId);
      (m[e.targetId] || (m[e.targetId] = [])).push(e.sourceId);
    });
    return m;
  }
  function visibleIds() {
    var ids = {};
    if (!focus) {
      P.nodes.forEach(function (n) { if (!hiddenTypes[n.type]) ids[n.id] = 1; });
      return ids;
    }
    var a = adj();
    var hubs = focus.open ? focus.roots.concat(focus.expanded) : focus.expanded.slice();
    focus.roots.forEach(function (id) { ids[id] = 1; });
    focus.expanded.forEach(function (id) { ids[id] = 1; });
    hubs.forEach(function (id) { (a[id] || []).forEach(function (n) { ids[n] = 1; }); });
    Object.keys(ids).forEach(function (id) { if (byId[id] && hiddenTypes[byId[id].type]) delete ids[id]; });
    return ids;
  }
  function neighborsOf(id, vis) {
    var a = adj()[id] || [];
    var hidden = [], seen = {};
    a.forEach(function (n) {
      if (seen[n]) return;
      seen[n] = 1;
      if (!vis[n]) hidden.push(n);
    });
    return hidden;
  }
  function isRoot(id) { return !!(focus && focus.roots.indexOf(id) >= 0); }
  function canCollapse(id) {
    if (!focus) return false;
    if (focus.expanded.indexOf(id) >= 0) return true;
    return isRoot(id) && (focus.open || focus.expanded.length > 0);
  }
  function setPrincipal(id) { focus = { roots: [id], expanded: [], open: true }; selected = id; draw(); }
  function expand(id) {
    if (!focus) { setPrincipal(id); return; }
    if (isRoot(id)) { focus.open = true; draw(); return; }
    if (focus.expanded.indexOf(id) < 0) focus.expanded.push(id);
    draw();
  }
  function collapse(id) {
    if (!focus) return;
    var i = focus.expanded.indexOf(id);
    if (i >= 0) focus.expanded.splice(i, 1);
    else if (isRoot(id)) { focus.expanded = []; focus.open = false; }
    draw();
  }
  function showAll() { focus = null; draw(); }
  function explore(id) {
    var vis = visibleIds();
    if (!focus) { setPrincipal(id); return; }
    if (neighborsOf(id, vis).length) { expand(id); return; }
    if (canCollapse(id)) collapse(id);
  }

  function bounds(vis) {
    var xs = [], ys = [];
    P.nodes.forEach(function (n) { if (vis[n.id]) { xs.push(n.x); ys.push(n.y); } });
    if (!xs.length) return { x: -100, y: -100, w: 200, h: 200 };
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    return { x: minX - PAD, y: minY - PAD, w: Math.max(200, maxX - minX + PAD * 2), h: Math.max(200, maxY - minY + PAD * 2) };
  }
  function fit() {
    pan = { x: 0, y: 0, k: 1 };
    var vis = visibleIds();
    var b = bounds(vis);
    svg.setAttribute("viewBox", b.x + " " + b.y + " " + b.w + " " + b.h);
  }
  function applyPan() {
    var vis = visibleIds();
    var b = bounds(vis);
    var w = b.w / pan.k, h = b.h / pan.k;
    svg.setAttribute("viewBox", (b.x + pan.x) + " " + (b.y + pan.y) + " " + w + " " + h);
  }
  function pt(ev) {
    var ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return { x: (ev.clientX - ctm.e) / ctm.a, y: (ev.clientY - ctm.f) / ctm.d };
  }

  function el(name, attrs, parent) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function draw() {
    var vis = visibleIds();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    el("defs", {}, svg);
    var defs = svg.firstChild;
    el("marker", { id: "arr", viewBox: "0 0 10 10", refX: "18", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" }, defs);
    el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#64748b" }, defs.lastChild);

    P.edges.forEach(function (e) {
      if (!vis[e.sourceId] || !vis[e.targetId]) return;
      var a = byId[e.sourceId], b = byId[e.targetId];
      var dash = e.evidence === "hypothesis" ? "8 6" : e.evidence === "observation" ? "2 6" : "";
      var line = el("line", {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: "#64748b", "stroke-width": "2",
        "stroke-dasharray": dash,
        "marker-end": e.direction === "none" ? "" : "url(#arr)",
        "marker-start": e.direction === "both" ? "url(#arr)" : ""
      }, svg);
      if (e.label) {
        el("text", {
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6,
          "text-anchor": "middle", fill: "#334155", "font-size": "11"
        }, svg).textContent = e.label;
      }
      void line;
    });

    P.nodes.forEach(function (n) {
      if (!vis[n.id]) return;
      var g = el("g", { "data-id": n.id, style: "cursor:pointer" }, svg);
      el("circle", {
        cx: n.x, cy: n.y, r: R,
        fill: n.color, stroke: selected === n.id ? "#0f172a" : "#fff",
        "stroke-width": selected === n.id ? "3" : "2"
      }, g);
      if (n.image) {
        var clipId = "c" + n.id.replace(/[^a-z0-9]/gi, "");
        var cp = el("clipPath", { id: clipId }, defs);
        el("circle", { cx: n.x, cy: n.y, r: R - 2 }, cp);
        el("image", {
          href: n.image, x: n.x - R + 2, y: n.y - R + 2, width: (R - 2) * 2, height: (R - 2) * 2,
          preserveAspectRatio: "xMidYMid slice", "clip-path": "url(#" + clipId + ")"
        }, g);
      }
      el("text", {
        x: n.x, y: n.y + R + 14, "text-anchor": "middle", fill: "#0f172a", "font-size": "12", "font-weight": "600"
      }, g).textContent = n.label;
      g.addEventListener("pointerdown", function (ev) {
        ev.stopPropagation();
        dragging = { id: n.id, dx: pt(ev).x - n.x, dy: pt(ev).y - n.y };
        selected = n.id;
        try { g.setPointerCapture(ev.pointerId); } catch (err) { void err; }
        drawCard();
      });
      g.addEventListener("dblclick", function (ev) { ev.preventDefault(); explore(n.id); });
    });
    applyPan();
    drawFilters(vis);
    drawCard();
  }

  function drawFilters(vis) {
    filters.innerHTML = "";
    var h = document.createElement("h2");
    h.textContent = "Categorías";
    filters.appendChild(h);
    var chips = document.createElement("div");
    chips.className = "chips";
    P.types.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = t.name;
      b.style.borderColor = t.color;
      b.setAttribute("aria-pressed", hiddenTypes[t.id] ? "false" : "true");
      b.addEventListener("click", function () {
        if (hiddenTypes[t.id]) delete hiddenTypes[t.id];
        else hiddenTypes[t.id] = true;
        draw();
      });
      chips.appendChild(b);
    });
    filters.appendChild(chips);
    var shown = P.nodes.filter(function (n) { return vis[n.id]; }).length;
    var hint = document.createElement("p");
    hint.className = "hint";
    if (focus || Object.keys(hiddenTypes).length) {
      hint.textContent = (focus ? "Principal" : "Filtrado") + ": " + shown + " de " + P.nodes.length + " entidades.";
      var all = document.createElement("button");
      all.type = "button";
      all.textContent = "Mostrar todo";
      all.addEventListener("click", showAll);
      filters.appendChild(hint);
      filters.appendChild(all);
    } else {
      hint.textContent = "Arrastra las entidades. Doble clic o «Marcar como principal» centra el grafo; «Retraer» oculta a todos los vecinos. No hace falta conexión ni A-Link.";
      filters.appendChild(hint);
    }
  }

  function drawCard() {
    if (!selected || !byId[selected]) { card.hidden = true; return; }
    var n = byId[selected];
    var vis = visibleIds();
    if (!vis[n.id]) { card.hidden = true; return; }
    card.hidden = false;
    card.innerHTML = "";
    var h = document.createElement("h2");
    h.textContent = n.label;
    card.appendChild(h);
    var badge = document.createElement("span");
    badge.className = "type";
    badge.textContent = typeName[n.type] || n.type;
    card.appendChild(badge);
    if (isRoot(n.id)) {
      var p = document.createElement("span");
      p.className = "type";
      p.textContent = "Principal";
      card.appendChild(p);
    }
    if (n.fields.length) {
      var dl = document.createElement("dl");
      n.fields.forEach(function (f) {
        var dt = document.createElement("dt"); dt.textContent = f.label;
        var dd = document.createElement("dd"); dd.textContent = f.value;
        dl.appendChild(dt); dl.appendChild(dd);
      });
      card.appendChild(dl);
    }
    var actions = document.createElement("div");
    actions.className = "actions";
    var principal = document.createElement("button");
    principal.type = "button";
    principal.textContent = isRoot(n.id) ? "Nodo principal" : "Marcar como principal";
    principal.disabled = isRoot(n.id);
    principal.addEventListener("click", function () { setPrincipal(n.id); });
    actions.appendChild(principal);
    var hid = neighborsOf(n.id, vis);
    if (focus && hid.length) {
      var ex = document.createElement("button");
      ex.type = "button";
      ex.textContent = "Extender (" + hid.length + ")";
      ex.addEventListener("click", function () { expand(n.id); });
      actions.appendChild(ex);
    }
    if (canCollapse(n.id)) {
      var col = document.createElement("button");
      col.type = "button";
      col.textContent = "Retraer";
      col.addEventListener("click", function () { collapse(n.id); });
      actions.appendChild(col);
    }
    card.appendChild(actions);
  }

  svg.addEventListener("pointerdown", function (ev) {
    if (ev.target !== svg) return;
    panning = { x: ev.clientX, y: ev.clientY, px: pan.x, py: pan.y };
    svg.classList.add("drag");
    try { svg.setPointerCapture(ev.pointerId); } catch (err) { void err; }
  });
  svg.addEventListener("pointermove", function (ev) {
    if (dragging) {
      var n = byId[dragging.id];
      var p = pt(ev);
      n.x = p.x - dragging.dx;
      n.y = p.y - dragging.dy;
      draw();
      return;
    }
    if (panning) {
      var vis = visibleIds();
      var b = bounds(vis);
      var rect = svg.getBoundingClientRect();
      pan.x = panning.px - (ev.clientX - panning.x) * (b.w / pan.k) / rect.width;
      pan.y = panning.py - (ev.clientY - panning.y) * (b.h / pan.k) / rect.height;
      applyPan();
    }
  });
  function endDrag() { dragging = null; panning = null; svg.classList.remove("drag"); }
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    pan.k = Math.min(4, Math.max(0.4, pan.k * (ev.deltaY > 0 ? 0.9 : 1.1)));
    applyPan();
  }, { passive: false });
  document.getElementById("fit").addEventListener("click", fit);

  fit();
  draw();
}
`.trim();
