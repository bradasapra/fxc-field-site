/* ============================================================
   FXC Field — app-glue.js
   Boot + identity routing + demo data + toast/banner + job replace.
   Owns window.FXC.boot and window.FXC.app.

   Boot sequence:
     register ./sw.js
     wrap v1 openJob() so the drawer gets FXC.edit.augmentDrawer()
     load team.json (override crew roster), then route():
       ?demo=1            -> demo (synthetic sample data, read-only)
       has token + role   -> live (FXC.data.listJobs)
       has token, no role -> demo behind + role picker -> live
       no token           -> demo behind + device-setup (-> role -> live)
     live load failure     -> offline snapshot if present, else demo
   ============================================================ */
(function (root) {
  "use strict";

  var FXC = (root.FXC = root.FXC || {});
  FXC.state = FXC.state || { mode: null, role: null };
  var app = (FXC.app = FXC.app || {});
  function auth() { return root.FXCAuth || FXC.identity; }

  /* ============================================================
     DEMO DATA — synthetic only. The public shell ships NO real
     customer data; real jobs appear only after a token connects.
     Shapes match the v1 job object so all four views render.
     ============================================================ */
  var DEMO_JOBS = [
    {
      id: "D-101", jobNumber: "D-101", title: "Demo Dairy Co. — robot room", subtitle: "sample data",
      bucket: "upcoming", stage: "Won", rich: true, source: "demo",
      customer: "Demo Dairy Co.",
      contact: { name: "Sample Contact", phone: "555-0100", email: "sample@example.com" },
      address: "1 Example Rd, Sampletown, ON",
      maps: "https://www.google.com/maps/search/?api=1&query=Sampletown+ON",
      segment: "AG — Agricultural", system: "FX Urethane", systemDesc: "~250 mil urethane mortar",
      sqft: 1200, prep: "Shot-blast to CSP 5",
      dates: { won: "2026-05-30", requested: "2026-06-20", start: null, end: null, deadline: null },
      money: { quote: 18400, deposit: 9200, depositDate: "2026-05-30", invoiced: false },
      scope: "Sample scope text. 1,200 sqft robot room urethane mortar system. This is demo data — connect your repo to see real jobs.",
      buildup: [
        { layer: "Body", product: "FX Urethane Mortar", dft: "250 mil" },
        { layer: "Top", product: "FX Urethane Topcoat", dft: "12 mil" }
      ],
      conditions: "Sample conditions. Substrate above 10 °C.",
      watchouts: ["This is sample data for preview only.", "Connect a repo to manage real jobs."],
      photos: 0, photosNote: "", quoteDoc: "DEMO.pdf", jobFolder: "DEMO/Demo-Dairy",
      gates: [
        { name: "Planning", items: [
          { name: "Gate 1 · Contract Binding", done: 4, total: 4 },
          { name: "Gate 2 · Package Ready", done: 2, total: 7 },
          { name: "Gate 3 · Scope Locked", done: 0, total: 4 },
          { name: "Scheduling", done: 0, total: 4 } ] },
        { name: "Active", items: [] }, { name: "Closeout", items: [] }
      ]
    },
    {
      id: "D-102", jobNumber: "D-102", title: "Northline Co-op — grain elevator floor", subtitle: "sample data",
      bucket: "active", stage: "Applying", rich: true, source: "demo",
      customer: "Northline Co-op",
      contact: { name: "Sample Contact", phone: "555-0123", email: "sample@example.com" },
      address: "42 Example Line, Sampleville, ON",
      maps: "https://www.google.com/maps/search/?api=1&query=Sampleville+ON",
      segment: "GE — Grain Elevators", system: "FX Quartz", systemDesc: "double quartz broadcast",
      sqft: 2600, prep: "Grind to CSP 3",
      dates: { won: "2026-04-10", requested: "2026-05-15", start: "2026-06-05", end: "2026-06-09", deadline: null },
      money: { quote: 31250, deposit: 15625, depositDate: "2026-04-10", invoiced: false },
      scope: "Sample scope — 2,600 sqft elevator floor, double quartz broadcast. Demo data only.",
      buildup: [
        { layer: "Primer", product: "FX Epoxy Primer", dft: "8 mil" },
        { layer: "Broadcast", product: "Quartz, double", dft: "—" },
        { layer: "Top", product: "FX Urethane", dft: "10 mil" }
      ],
      conditions: "Sample conditions.",
      watchouts: ["Sample data for preview only."],
      photos: 0, photosNote: "", quoteDoc: "DEMO.pdf", jobFolder: "DEMO/Northline",
      gates: [
        { name: "Planning", items: [{ name: "Planning complete", done: 16, total: 16 }] },
        { name: "Active", items: [
          { name: "Cleared to Prep", done: 4, total: 4 },
          { name: "Cleared to Apply", done: 5, total: 5 },
          { name: "Cleared to De-stage", done: 1, total: 4 },
          { name: "Cleared for Walkthrough", done: 0, total: 2 } ] },
        { name: "Closeout", items: [] }
      ]
    },
    { id: "D-201", jobNumber: "D-201", title: "Sample Foods Inc. — cooler floor", bucket: "closeout", stage: "Invoicing", source: "demo",
      customer: "Sample Foods Inc.", system: "FX Urethane", sqft: 900, dates: {}, photos: 3,
      money: { quote: 14200 }, checklists: { postjob: { done: 1, total: 4 } } },
    { id: "D-202", jobNumber: "D-202", title: "Riverside Barns — milkhouse", bucket: "closeout", stage: "PJA Pending", source: "demo",
      customer: "Riverside Barns", system: "FX Flakes", sqft: 540, dates: {}, photos: 5,
      money: { quote: 8600 }, checklists: { postjob: { done: 2, total: 4 } } },
    { id: "D-301", jobNumber: "D-301", title: "Maple Ridge Arena — entry", bucket: "closed", stage: "Finished", period: "2026 Q1", source: "demo",
      customer: "Maple Ridge Arena", system: "FX Quartz", sqft: 1100, dates: {}, photos: 8,
      checklists: { postjob: { done: 4, total: 4 } } },
    { id: "D-302", jobNumber: "D-302", title: "Example Logistics — dock", bucket: "closed", stage: "Finished", period: "2026 Q1", source: "demo",
      customer: "Example Logistics", system: "FX Urethane", sqft: 3200, dates: {}, photos: 2,
      checklists: { postjob: { done: 3, total: 4 } } }
  ];
  app.DEMO_JOBS = DEMO_JOBS;

  /* ============================================================
     TOAST + BANNER
     ============================================================ */
  app.toast = function (msg, kind) {
    var t = document.createElement("div");
    t.className = "fxc-toast " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "info");
    t.textContent = msg;
    document.body.appendChild(t);
    root.setTimeout(function () {
      t.style.transition = "opacity .3s"; t.style.opacity = "0";
      root.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, kind === "err" ? 4200 : 2400);
  };

  function banner(text, kind) {
    var host = document.getElementById("fxc-banner");
    if (!host) {
      host = document.createElement("div");
      host.id = "fxc-banner";
      var main = document.getElementById("main");
      if (main && main.parentNode) main.parentNode.insertBefore(host, main);
      else document.body.appendChild(host);
    }
    var bg = kind === "warn" ? "#3a2a16" : kind === "info" ? "var(--panel)" : "#12181d";
    var bd = kind === "warn" ? "var(--amber)" : "var(--blue)";
    host.setAttribute("style",
      "max-width:1320px;margin:0 auto;padding:9px 18px;font-size:13px;color:var(--ink-dim);" +
      "background:" + bg + ";border-bottom:1px solid var(--line);border-left:3px solid " + bd + ";");
    host.textContent = text;
  }
  function clearBanner() {
    var host = document.getElementById("fxc-banner");
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }
  app.banner = banner; app.clearBanner = clearBanner;

  /* ============================================================
     RENDER + JOB REPLACE
     ============================================================ */
  function reRender() {
    if (typeof root.renderKpis === "function") root.renderKpis();
    if (typeof root.render === "function") root.render();
    setFooter();
  }
  app.reRender = reRender;

  app.replaceJob = function (fresh) {
    if (!fresh) return;
    var arr = root.JOBS || (root.JOBS = []);
    var i = -1;
    for (var k = 0; k < arr.length; k++) { if (arr[k].id === fresh.id) { i = k; break; } }
    if (i >= 0) arr[i] = fresh; else arr.push(fresh);
    if (FXC.data && FXC.data.putCached) FXC.data.putCached(fresh);
    reRender();
  };

  function setFooter() {
    var f = document.getElementById("footer");
    if (!f) return;
    var mode = FXC.state.mode;
    var n = (root.JOBS || []).length;
    var who = (auth().getRole && auth().getRole()) ? auth().getRole().name : null;
    var line;
    if (mode === "demo") line = "FXC Field — preview (sample data). Connect your private repo to manage real jobs.";
    else if (mode === "offline") line = "FXC Field — offline. Showing last synced data" + (who ? " for " + who : "") + ". Capture still saves — it queues until signal returns.";
    else line = "FXC Field — live · " + n + " job" + (n === 1 ? "" : "s") + " from your vault" + (who ? " · signed in as " + who : "") + ".";
    f.textContent = line;
    /* pending offline saves: amber badge + the manual "Sync now" trigger */
    var qn = (FXC.queue && FXC.queue.count) ? FXC.queue.count() : 0;
    if (qn && mode !== "demo") {
      var b = document.createElement("button");
      b.id = "fxc-syncnow";
      b.textContent = "⏳ " + qn + " queued" + (lastFlushError ? " — sync failed" : "") + " · Sync now";
      b.setAttribute("style", "margin-left:10px;padding:2px 10px;border-radius:999px;border:1px solid var(--amber);" +
        "background:transparent;color:var(--amber);font:inherit;font-size:11px;cursor:pointer;vertical-align:middle");
      b.onclick = function () { flushQueue("manual"); };
      f.appendChild(document.createTextNode(" "));
      f.appendChild(b);
    }
  }

  /* ============================================================
     OFFLINE QUEUE — flush triggers + result surfacing
     (queue.js owns the store + flush engine; this is the wiring:
     "online" event, post-boot, manual Sync now — see FXC.boot)
     ============================================================ */
  var lastFlushError = null;

  /* a corrupt store was dropped at load — say so LOUDLY, once */
  function surfaceRecovery() {
    var q = FXC.queue;
    var rec = q && q.lastRecovery;
    if (!rec || !rec.dropped) return;
    q.lastRecovery = null;
    var n = rec.dropped;
    app.toast && app.toast(n + " queued offline save" + (n === 1 ? "" : "s") +
      " couldn't be read and " + (n === 1 ? "was" : "were") + " dropped — re-enter " + (n === 1 ? "it" : "them") + ".", "err");
  }

  function flushQueue(trigger) {
    var q = FXC.queue;
    if (!q || !q.flush) return Promise.resolve(null);
    surfaceRecovery();
    if (!q.count()) { setFooter(); return Promise.resolve(null); }
    return q.flush().then(function (r) {
      if (!r) return r;
      lastFlushError = (r.error && !r.locked) ? r.error : null;
      if (r.synced) {
        app.toast && app.toast("✓ " + r.synced + " offline save" + (r.synced === 1 ? "" : "s") + " synced to the vault.", "ok");
        // re-render an open field card: fresh Site Wire, pending badge cleared
        if (typeof root.refreshOpenFieldCard === "function") { try { root.refreshOpenFieldCard(); } catch (e) {} }
      }
      /* failures: always loud on a manual tap or a token/scope problem;
         a quiet "still no signal" on auto triggers just keeps the badge */
      if (r.error && !r.locked && (trigger === "manual" || r.authError || r.blocked)) {
        app.toast && app.toast(r.error, (r.authError || r.blocked) ? "err" : "info");
      }
      setFooter();
      /* the queue drained while we were on the snapshot — signal is back, go live */
      if (FXC.state.mode === "offline" && r.synced && !r.remaining) loadLive();
      return r;
    });
  }
  app.flushQueue = flushQueue; // manual Sync now + console access

  /* ============================================================
     MODES
     ============================================================ */
  /* demo job list = REAL vault records (full work order, gates, photos) from the
     FXC_DEMO registry, headlining the synthetic samples in the preview */
  function buildDemoJobs() {
    var jobs = DEMO_JOBS.slice();
    var reg = root.FXC_DEMO || (root.FXC_DEMO_2813 ? [{ path: "10-jobs/1-planning/2813.md", md: root.FXC_DEMO_2813, photos: root.FXC_DEMO_PHOTOS || [] }] : []);
    if (reg.length && FXC.data && FXC.data.parseJobMarkdown) {
      reg.slice().reverse().forEach(function (entry) {  // reverse so registry order is preserved at the front
        try {
          // demo-only: 2813 becomes an ACTIVE mid-application job so the Ghost-Row
          // capture loop (active-phase only) is walkable in ?demo=1. Built with the
          // REAL engine (appendReading/appendProduct) — no hand-written table rows.
          var j = /job_number:\s*2813\b/.test(entry.md)
            ? demoActiveJob(entry.md)
            : FXC.data.parseJobMarkdown(entry.md, entry.path, "demo");
          if (entry.photos && entry.photos.length) {
            j.photoUrls = entry.photos;
            j.cover = entry.photos[0];
            j.photos = entry.photos.length;
          }
          jobs.unshift(j);
        } catch (e) { /* a bad entry shouldn't break the whole preview */ }
      });
    }
    return jobs;
  }

  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function daysAgo(n) { var t = new Date(); t.setDate(t.getDate() - n); return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate()); }
  function clearDemoGates(md) {
    var lines = md.split("\n"), phase = null, ag = 0;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t === "### PLANNING") { phase = "P"; continue; }
      if (t === "### ACTIVE") { phase = "A"; ag = 0; continue; }
      if (t === "### CLOSEOUT") { phase = "C"; continue; }
      if (phase === "A" && /^\*\*/.test(t)) ag++;
      // planning gates + active gate 1 only — gate 2 ("Cleared to Apply") stays
      // open so demoActiveJob's bulk-override advance has items to flip/record
      if (/^(\s*)- \[ \]/.test(lines[i]) && (phase === "P" || (phase === "A" && ag <= 1))) {
        lines[i] = lines[i].replace("- [ ]", "- [x]");
      }
    }
    return lines.join("\n");
  }
  /* transform the 2813 record into an ACTIVE Day-2 job by walking the REAL
     gated chain won → applying (plus the same seeded readings/usage as before)
     entirely through the engine. Every commit line it emits, parsed back
     through data.parseCommitLine, becomes the Site Wire's dated who/when
     (job.history) — the demo wire cannot drift from the live parser. One
     bulk-override and one revert-with-reason are included so both audit
     shapes are walkable in ?demo=1. */
  function demoActiveJob(md) {
    var text = md
      .replace(/^start_date:.*$/m, "start_date: " + daysAgo(2))
      .replace(/^crew:.*$/m, "crew: [Mike, Tomas, Dylan]");
    text = clearDemoGates(text);
    var path = "10-jobs/1-planning/2813-PF-JD Renovations.md";
    var job = FXC.data.parseJobMarkdown(text, path, "demo");
    var trail = [];
    var wasRole = FXC.state.role;
    var as = function (name) { FXC.state.role = { name: name, scope: "full" }; };
    var apply = function (res, date) {
      if (res.move) path = res.move.toPath; // deployed crosses 1-planning → 2-active
      trail.push({ msg: res.message, date: date });
      job = FXC.data.parseJobMarkdown(res.newText, path, "demo");
    };
    try {
      as("Brad");
      [["package-building", 9], ["scope-locked", 8], ["scheduled", 6], ["cleared-to-deploy", 3], ["deployed", 2]]
        .forEach(function (s) { apply(FXC.data.setStatus(job, s[0]), daysAgo(s[1])); });
      as("Dan");
      apply(FXC.data.setStatus(job, "prepping"), daysAgo(2));
      // "Cleared to Apply" was left open by clearDemoGates → the bulk-override records its count
      apply(FXC.data.setStatus(job, "applying", { bulk: true }), daysAgo(1));
      apply(FXC.data.setStatus(job, "prepping", { back: true, reason: "flash rust on the east bay — re-prep" }), daysAgo(1));
      apply(FXC.data.setStatus(job, "applying"), daysAgo(0));
      as("Mike");
      [
        { date: daysAgo(2), area: "Slab A - floor", moisture: "3.8", temp: "17", RH: "74", CSP: "3", notes: "prep verified, CSP 3 confirmed" },
        { date: daysAgo(1), area: "Slab A - floor", moisture: "3.5", temp: "18", RH: "70", CSP: "3", batch: "288-A-2207", dft: "12.0 mils", notes: "base coat + flake broadcast" }
      ].forEach(function (r) { apply(FXC.data.appendReading(job, r), r.date); });
      apply(FXC.data.appendProduct(job, { product: "Series 288 Enviro-Pox (Aluminum Gray)", qty: "9 kits (27 gal)", notes: "primer + base to date" }), daysAgo(1));
    } finally { FXC.state.role = wasRole; }
    job.history = trail.map(function (t) {
      var e = FXC.data.parseCommitLine(t.msg);
      if (e) e.date = t.date;
      return e;
    }).filter(Boolean).reverse(); // newest first, like the live commits page
    return job;
  }

  /* #card=<job#> deep link (written by the card's "⧉ Copy link" button): open that
     job's field card once jobs are in. One-shot per page load so a demo→live mode
     hop doesn't reopen a card the user already closed. */
  var deepLinked = false;
  function openDeepLink() {
    if (deepLinked) return;
    var m = /[#&]card=([^&]+)/.exec(root.location.hash || "");
    if (!m) return;
    var v = decodeURIComponent(m[1]);
    var j = (root.JOBS || []).filter(function (x) {
      return String(x.jobNumber) === v || String(x.id) === v;
    })[0];
    if (j && typeof root.openFieldCard === "function") { deepLinked = true; root.openFieldCard(j.id); }
  }

  function enterDemo() {
    FXC.state.mode = "demo"; // set BEFORE building jobs so vault-record parsing sees demo mode
    root.JOBS = buildDemoJobs();
    if (typeof root.initMoves === "function") root.initMoves(); // snapshot positions so preview moves can be undone safely
    reRender();
    banner("Preview — sample data. Tap the chip (top-right) to connect your repo and edit real jobs.", "info");
    auth().renderChip(chipTap);
    openDeepLink();
  }

  function loadLive() {
    FXC.state.mode = "live";
    FXC.data.configure(assign({}, auth().getConfig(), { token: auth().getToken() }));
    banner("Loading jobs from your vault…", "info");
    return FXC.data.listJobs().then(function (jobs) {
      root.JOBS = jobs || [];
      FXC.state.mode = "live";
      clearBanner();
      if (!root.JOBS.length) banner("Connected — no jobs in the vault yet. Won deals will appear here.", "info");
      tornBanner();
      reRender();
      auth().renderChip(chipTap);
      openDeepLink();
      flushQueue("boot"); // captures queued on dead signal replay now
    })["catch"](function () {
      var snap = FXC.data.loadSnapshot && FXC.data.loadSnapshot();
      if (snap && snap.length) {
        root.JOBS = snap; FXC.state.mode = "offline"; reRender();
        banner("Offline — showing last synced data. Readings, batches and notes still save; they'll sync when signal returns.", "warn");
        surfaceRecovery();
        openDeepLink();
      } else {
        enterDemo();
        banner("Couldn't reach GitHub — showing sample data. Check your connection and reload.", "warn");
      }
      auth().renderChip(chipTap);
    });
  }

  /* torn phase-move banner: listJobs found the same job in two folders (an
     interrupted move). Full scope gets a one-tap cleanup; crew is told who to
     call. Handles one dup per load — a second one surfaces on the reload. */
  function tornBanner() {
    var torn = (FXC.data.lastListMeta && FXC.data.lastListMeta.torn) || [];
    if (!torn.length) return;
    var dup = torn[0];
    banner("#" + dup.jobNumber + " exists in two folders — an interrupted move left a stale copy at " +
      dup.stalePath + ".", "warn");
    var host = document.getElementById("fxc-banner");
    var role = auth().getRole();
    if (!host || !role || role.scope !== "full") {
      if (host) host.textContent += " Tell Brad or Dan — cleanup needs full scope.";
      return;
    }
    var btn = document.createElement("button");
    btn.textContent = "Clean up";
    btn.setAttribute("style", "margin-left:12px;padding:3px 12px;border-radius:8px;border:1px solid var(--amber);" +
      "background:transparent;color:var(--amber);font:inherit;font-size:12px;cursor:pointer");
    btn.onclick = function () {
      btn.disabled = true; btn.textContent = "Cleaning…";
      FXC.data.removeStaleDuplicate(dup).then(function () {
        app.toast && app.toast("Stale copy removed · committed as " + auth().actorName(), "ok");
        loadLive();
      })["catch"](function (e) {
        btn.disabled = false; btn.textContent = "Clean up";
        app.toast && app.toast((e && e.message) || "Cleanup failed.", "err");
      });
    };
    host.appendChild(btn);
  }

  function afterConnect() {
    if (auth().getRole()) loadLive();
    else auth().showRolePicker({ crewList: FXC.crew, onPick: function () { loadLive(); } });
  }

  function chipTap() {
    if (FXC.state.mode === "demo") openSetup();
    else openRolePicker();
  }
  function openSetup() {
    auth().showDeviceSetup({
      onDone: afterConnect,
      onPreview: function () { FXC.state.mode = "demo"; auth().renderChip(chipTap); }
    });
  }
  function openRolePicker() {
    auth().showRolePicker({ crewList: FXC.crew, onPick: function () {
      auth().renderChip(chipTap);
      if (FXC.state.mode === "live") reRender();
    } });
  }

  /* ============================================================
     ROUTE + BOOT
     ============================================================ */
  function route() {
    /* worker card-link (#card=…&crew=1): flag this device crew-only BEFORE any
       role picker renders — unless it already holds a full-scope session
       (Brad testing his own worker link must not downgrade his phone). */
    if (/[#&]crew(=1)?(&|$)/.test(root.location.hash || "")) {
      var existing = auth().getRole && auth().getRole();
      if (!(existing && existing.scope === "full") && auth().setCrewDevice) auth().setCrewDevice(true);
    }
    var demo = /[?&]demo=1\b/.test(root.location.search) || /[?&]demo(\b|=)/.test(root.location.search);
    if (demo) { enterDemo(); return; }

    if (auth().hasToken()) {
      FXC.data.configure(assign({}, auth().getConfig(), { token: auth().getToken() }));
      if (auth().getRole()) { enterDemoBackdrop(); loadLive(); }
      else { enterDemoBackdrop(); auth().showRolePicker({ crewList: FXC.crew, onPick: function () { loadLive(); } }); }
    } else {
      enterDemoBackdrop();
      auth().showDeviceSetup({ onDone: afterConnect, onPreview: function () { FXC.state.mode = "demo"; auth().renderChip(chipTap); } });
    }
  }
  /* render demo data behind any startup overlay so the screen is never blank */
  function enterDemoBackdrop() {
    FXC.state.mode = "demo";
    root.JOBS = buildDemoJobs();
    if (typeof root.initMoves === "function") root.initMoves();
    reRender();
    auth().renderChip(chipTap);
  }

  function wrapOpenJob() {
    var orig = root.openJob;
    if (typeof orig !== "function") return;
    root.openJob = function (id) {
      orig(id);
      var drawer = document.getElementById("drawer");
      if (drawer) drawer.setAttribute("data-job", id);
      var job = (root.JOBS || []).filter(function (x) { return x.id === id; })[0];
      if (job && FXC.edit && FXC.edit.augmentDrawer) {
        try { FXC.edit.augmentDrawer(job); } catch (e) { if (root.console) console.warn("augmentDrawer", e); }
      }
    };
  }

  function loadTeam() {
    try {
      return fetch("./team.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t) {
          if (t && t.roster && t.roster.length) {
            var crew = t.roster.filter(function (p) { return String(p.role || "").toLowerCase() === "crew"; })
              .map(function (p) { return p.name; }).filter(Boolean);
            if (crew.length) FXC.crew = crew;
            // owner/pm rows get FULL edit — honors team.json's documented contract
            var full = t.roster.filter(function (p) { return /^(owner|pm)$/i.test(String(p.role || "")); });
            if (full.length && auth().setFullRoles) auth().setFullRoles(full);
          }
        })["catch"](function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i]; if (!s) continue;
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
    }
    return t;
  }

  FXC.boot = function () {
    if ("serviceWorker" in navigator) {
      try { navigator.serviceWorker.register("./sw.js")["catch"](function () {}); } catch (e) {}
    }
    /* offline-queue triggers: flush when the signal returns (navigator.onLine
       is only a hint — the flush itself proves connectivity by fetching);
       repaint the footer badge on every queue change */
    try {
      root.addEventListener("online", function () { if (FXC.state.mode !== "demo") flushQueue("online"); });
      if (FXC.queue && FXC.queue.onChange) FXC.queue.onChange(function () { setFooter(); });
    } catch (e) {}
    wrapOpenJob();
    loadTeam().then(route, route);
  };

  /* auto-run once the DOM + all module scripts are parsed */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { FXC.boot(); });
  } else {
    FXC.boot();
  }
})(typeof window !== "undefined" ? window : this);
