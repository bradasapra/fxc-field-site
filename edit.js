/* ============================================================
   FXC Field — edit.js
   Role-gated write actions + the in-drawer edit UI.
   Owns window.FXC.edit = { augmentDrawer(job), commit(...) }.

   Depends on:
     FXC.data      (toggleGate, setStatus, appendReading/Product/Note, setField, writeJob, readJob, parseJobMarkdown, TRANSITIONS, STAGE_LABELS, phaseOf)
     FXC.identity  (= window.FXCAuth: getRole/canEdit/actorName)
     FXC.app       (toast/replaceJob)  [app-glue.js]
     v1 globals    (openJob, JOBS, #drawer .dbody)

   Write discipline: every action is a PURE transform that touches only the
   target line(s). On HTTP 409 (stale sha) we refetch the file, RE-LOCATE the
   target by content (gate boxes by text, not stale index), re-run the same
   transform, and retry ONCE. Role is re-checked at write time (defense in depth).
   ============================================================ */
(function (root) {
  "use strict";

  var FXC = (root.FXC = root.FXC || {});
  var edit = (FXC.edit = FXC.edit || {});
  function data() { return FXC.data; }
  function auth() { return root.FXCAuth || FXC.identity; }
  function app() { return FXC.app || {}; }

  /* phase folder -> gate group name used in job.gates / gateIndex.phase */
  var PHASE_GROUP = {
    "1-planning": "Planning", "2-active": "Active",
    "3-closeout": "Closeout", "4-archive": "Closeout"
  };

  function currentPhaseName(job) {
    var ph = job.phase || (data().phaseOf ? data().phaseOf(job.status) : "1-planning");
    return PHASE_GROUP[ph] || "Planning";
  }

  /* Which gate reveals are expanded, keyed by job id. Every gate toggle re-renders
     the drawer (openJob), so this persists the open state across that rebuild —
     otherwise checking an item collapses the gate you're working. */
  var openReveals = Object.create(null);
  function revealState(jobId) { return openReveals[jobId] || (openReveals[jobId] = Object.create(null)); }

  /* Is the work-order drawer currently open? After a commit we re-render the drawer
     only when it's already showing (a gate toggle / advance from inside it). A board
     drag-move commits with the drawer CLOSED — don't pop it open then (Brad 2026-07-02);
     the board card refreshes via app.replaceJob regardless. */
  function drawerOpen() {
    var d = document.getElementById("drawer");
    return !!(d && d.classList.contains("show"));
  }

  /* ---------- one-time style injection ---------- */
  function injectStyle() {
    if (document.getElementById("fxc-edit-style")) return;
    var css =
      ".fxc-edit{margin-top:22px;border-top:1px solid var(--line);padding-top:18px}" +
      ".fxc-edit h4{margin:18px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:var(--accent)}" +
      ".fxc-edit h4:first-child{margin-top:0}" +
      ".fxc-note-banner{padding:10px 12px;border-radius:8px;font-size:13px;border:1px solid var(--line);background:var(--panel2);color:var(--ink-dim)}" +
      ".fxc-gaterow{display:flex;align-items:flex-start;gap:10px;padding:11px 10px;border:1px solid var(--line);border-radius:9px;background:var(--panel2);margin-bottom:7px;min-height:46px;cursor:pointer}" +
      ".fxc-gaterow.ro{cursor:default;opacity:.85}" +
      ".fxc-gaterow .box{flex:none;width:24px;height:24px;border-radius:6px;border:2px solid var(--ink-faint);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#10140f}" +
      ".fxc-gaterow.on .box{background:var(--green);border-color:var(--green)}" +
      ".fxc-gaterow .lbl{font-size:13.5px;color:var(--ink);line-height:1.35;padding-top:1px}" +
      ".fxc-gaterow.on .lbl{color:var(--ink-dim)}" +
      ".fxc-gatehead{font-size:12px;font-weight:700;color:var(--ink-dim);margin:14px 0 7px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--panel2)}" +
      ".fxc-gatehead .gname{display:flex;align-items:center;min-width:0}" +
      ".fxc-gatehead .pct{flex:none;color:var(--ink-faint);font-variant-numeric:tabular-nums}" +
      ".fxc-gatehead.more{cursor:pointer;user-select:none}" +
      ".fxc-gatehead.more:hover{border-color:var(--accent)}" +
      ".fxc-gatehead.more .gname::before{content:'\\25B8';display:inline-block;flex:none;color:var(--accent);font-weight:800;margin-right:8px;transition:transform .12s}" +
      ".fxc-gatehead.more.exp .gname::before{transform:rotate(90deg)}" +
      ".fxc-reveal{display:none}" +
      ".fxc-reveal.open{display:block}" +
      ".fxc-btn{width:100%;padding:13px 14px;border:none;border-radius:10px;background:var(--accent);color:#10140f;font-weight:800;font-size:15px;cursor:pointer;margin-top:6px}" +
      ".fxc-btn:disabled{background:var(--panel2);color:var(--ink-faint);border:1px solid var(--line);cursor:not-allowed}" +
      ".fxc-btn.sec{background:var(--panel2);color:var(--ink);border:1px solid var(--line)}" +
      ".fxc-mrow.back{color:var(--amber)}" +
      ".fxc-btnrow{display:flex;gap:8px;margin-top:10px}" +
      ".fxc-btnrow .fxc-btn{margin-top:0;padding:12px 8px;font-size:13.5px}" +
      ".fxc-bklbl{display:block;font-size:12px;font-weight:700;color:var(--ink-dim);margin:10px 2px 5px}" +
      ".fxc-bkin{width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--line);border-radius:9px;background:var(--panel2);color:var(--ink);box-sizing:border-box}" +
      ".fxc-bkin.bkerr{border-color:var(--amber)}" +
      ".fxc-hint{font-size:11.5px;color:var(--ink-faint);margin-top:5px;text-align:center}" +
      ".fxc-collapse{margin-top:8px}" +
      ".fxc-form{display:none;border:1px solid var(--line);border-radius:10px;background:var(--panel2);padding:12px;margin-top:8px}" +
      ".fxc-form.open{display:block}" +
      ".fxc-form .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}" +
      ".fxc-form label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-faint);font-weight:700;margin:8px 0 3px}" +
      ".fxc-form input,.fxc-form textarea{width:100%;padding:11px 10px;font-size:16px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink)}" +
      ".fxc-form textarea{min-height:64px;resize:vertical}" +
      ".fxc-form select{width:100%;padding:11px 10px;font-size:16px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink)}" +
      ".fxc-nocoat{margin-top:6px;width:100%;padding:8px;font-size:12px;font-weight:700;border:1px solid var(--line);border-radius:8px;background:var(--panel2);color:var(--ink-dim);cursor:pointer}" +
      ".fxc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:90;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;box-shadow:var(--shadow);max-width:90%;text-align:center}" +
      ".fxc-toast.ok{background:var(--green);color:#08210d}" +
      ".fxc-toast.err{background:var(--red);color:#2a0a08}" +
      ".fxc-toast.info{background:var(--panel);border:1px solid var(--line);color:var(--ink)}" +
      /* bottom sheet (move picker + advance confirm) */
      ".fxc-sheet-scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:80;opacity:0;transition:opacity .15s}" +
      ".fxc-sheet-scrim.show{opacity:1}" +
      ".fxc-sheet{position:fixed;left:50%;bottom:0;transform:translate(-50%,105%);width:min(480px,100%);background:var(--panel);border:1px solid var(--line);border-bottom:none;border-radius:16px 16px 0 0;z-index:85;padding:18px 18px 22px;transition:transform .2s ease;max-height:82vh;overflow-y:auto;box-shadow:var(--shadow)}" +
      ".fxc-sheet.show{transform:translate(-50%,0)}" +
      ".fxc-sheet h3{margin:0 0 3px;font-size:15.5px}" +
      ".fxc-sub{font-size:12px;color:var(--ink-faint);margin:0 0 12px;line-height:1.5}" +
      ".fxc-mrow{display:block;width:100%;text-align:left;padding:13px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);color:var(--ink);font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px}" +
      ".fxc-mrow:hover{border-color:var(--accent)}" +
      ".fxc-mrow .sub{display:block;font-size:11px;color:var(--amber);font-weight:500;margin-top:3px}" +
      ".fxc-will{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;background:var(--panel2);padding:11px 13px;font-size:12.5px;color:var(--ink-dim);line-height:1.8;margin:10px 0 12px}" +
      ".fxc-will .soon{color:var(--ink-faint);font-style:italic}" +
      ".fxc-will .miss{color:var(--amber);font-weight:700}" +
      ".fxc-gateline{font-size:12.5px;margin:0 0 10px;padding:8px 11px;border-radius:8px;border:1px solid var(--line);background:var(--panel2)}" +
      ".fxc-gateline.ok{color:var(--green);border-color:rgba(63,185,80,.4)}" +
      ".fxc-gateline.no{color:var(--amber);border-color:rgba(227,160,8,.4)}" +
      ".fxc-trig{border:1px solid var(--line);border-left:3px solid var(--fx-purple,#7A5896);border-radius:8px;background:var(--panel2);padding:11px 13px;font-size:12.5px;color:var(--ink-dim);line-height:1.7;margin:0 0 12px}" +
      ".fxc-trig-h{font-weight:800;color:var(--ink);font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px}" +
      ".fxc-tg-row{display:flex;gap:8px;align-items:flex-start;padding:3px 0;flex-wrap:wrap}" +
      ".fxc-tg-row .tg-main{display:flex;gap:9px;align-items:flex-start;flex:1;min-width:0;cursor:pointer}" +
      ".fxc-tg-row input[type=checkbox]{width:auto;margin-top:3px;accent-color:var(--fx-purple,#7A5896)}" +
      ".fxc-tg-when{flex:none;background:var(--panel);border:1px solid var(--line);color:var(--ink-dim);border-radius:7px;font-size:11px;padding:3px 6px;margin-top:1px}" +
      ".fxc-tg-at{width:100%;margin:2px 0 4px;padding:8px 10px;font-size:14px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)}" +
      ".fxc-gateline.click{cursor:pointer}" +
      ".fxc-gateline.click:hover{border-color:var(--accent)}" +
      ".fxc-gateline .go{float:right;color:var(--ink-faint);font-weight:800}" +
      ".fxc-gatehead.flash{background:rgba(171,84,145,.35);transition:background 1.4s}" +
      ".fxc-cap-badge{display:inline-block;min-width:20px;text-align:center;background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:11px;color:var(--ink-dim);margin-left:6px;vertical-align:1px}" +
      ".fxc-cap{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:0 0 8px}" +
      ".fxc-cap table{width:100%;border-collapse:collapse;font-size:12.5px}" +
      ".fxc-cap th{text-align:left;padding:8px 11px;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-faint);border-bottom:1px solid var(--line);background:var(--panel2)}" +
      ".fxc-cap td{padding:8px 11px;border-bottom:1px solid var(--line);color:var(--ink)}" +
      ".fxc-cap tr:last-child td{border-bottom:0}" +
      ".fxc-cap-empty{color:var(--ink-faint);font-style:italic}" +
      ".fxc-logbar{display:flex;gap:7px;align-items:stretch;border:1px dashed var(--line);border-radius:12px;padding:9px;margin:0 0 6px;flex-wrap:wrap}" +
      ".fxc-logbar input{flex:1;min-width:70px;margin:0;padding:9px 10px;font-size:13px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink)}" +
      ".fxc-logbar input#pr-qty{flex:0 0 72px}" +
      ".fxc-logbar .fxc-btn{flex:0 0 auto;width:auto;margin:0;padding:9px 16px;font-size:13px}";
    var s = document.createElement("style");
    s.id = "fxc-edit-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function findBoxAbsLine(job, gateName, boxText) {
    var found = -1, want = String(boxText).trim();
    (job._meta.gateIndex || []).forEach(function (g) {
      if (g.gateName === gateName) {
        g.boxes.forEach(function (b) { if (String(b.text).trim() === want) found = b.absLine; });
      }
    });
    return found;
  }
  function gateByMatch(job, re) {
    var hit = null;
    (job._meta.gateIndex || []).forEach(function (g) {
      if (re.test(g.gateName) && !hit) hit = g;
    });
    return hit;
  }
  function gateProgress(g) {
    var d = 0; g.boxes.forEach(function (b) { if (b.checked) d++; });
    return { done: d, total: g.boxes.length };
  }
  function nextStatusOf(job) {
    var T = data().TRANSITIONS || {};
    var from = job.status;
    for (var to in T) { if (T[to] && T[to].from === from) return to; }
    return null;
  }

  /* ============================================================
     COMMIT — write + 409 refetch/retry-once + optimistic re-render
     transformFn(job) -> {newText, message, move?}  (pure)
     ============================================================ */
  edit.commit = function (job, transformFn, field, opts) {
    opts = opts || {};
    if (FXC.state && FXC.state.mode === "demo") return demoCommit(job, transformFn);
    if (!auth().canEdit(job, field, opts)) {
      app().toast && app().toast("Your role can't make that change.", "err");
      return Promise.resolve(false);
    }
    var res;
    try { res = transformFn(job); }
    catch (e) { app().toast && app().toast((e && e.message) || "Edit failed.", "err"); return Promise.resolve(false); }

    return writeOnce(job._meta.path, job._meta.sha, res, transformFn)
      .then(function (applied) { return applied; })
      ["catch"](function (e) {
        app().toast && app().toast(friendlyErr(e), "err");
        return false;
      });
  };

  function writeOnce(path, sha, res, transformFn) {
    var wopts = res.move ? { move: res.move } : {};
    return data().writeJob(path, res.newText, sha, res.message, wopts)
      .then(function (r) { return applyWritten(res, r); })
      ["catch"](function (e) {
        if (e && e.status === 409 && transformFn) {
          // stale sha — refetch, re-locate by content, re-run, retry once
          return data().readJob(path).then(function (fresh) {
            var res2 = transformFn(fresh);
            var wopts2 = res2.move ? { move: res2.move } : {};
            return data().writeJob(path, res2.newText, fresh._meta.sha, res2.message, wopts2)
              .then(function (r2) { return applyWritten(res2, r2); });
          });
        }
        throw e;
      });
  }

  function applyWritten(res, writeResult) {
    var newPath = res.move ? res.move.toPath : null;
    var path = newPath || (res._path || null);
    // parse the text we just committed into a fresh Job (path may have moved)
    var sha = writeResult && writeResult.sha;
    var finalPath = newPath || res._origPath;
    var fresh = data().parseJobMarkdown(res.newText, finalPath, sha);
    if (app().replaceJob) app().replaceJob(fresh);
    if (drawerOpen() && typeof root.openJob === "function") root.openJob(fresh.id);
    app().toast && app().toast("Saved · committed as " + auth().actorName(), "ok");
    if (writeResult && writeResult.warning) app().toast && app().toast(writeResult.warning, "info");
    return true;
  }

  /* demo: run the same pure transform, re-parse, re-render — nothing leaves the
     browser. Gives the full gated experience on the real 2813 preview record. */
  function demoCommit(job, transformFn) {
    var res;
    try { res = transformFn(job); }
    catch (e) { app().toast && app().toast((e && e.message) || "Edit failed.", "err"); return Promise.resolve(false); }
    var finalPath = (res.move && res.move.toPath) || (job._meta && job._meta.path) || "";
    var fresh = data().parseJobMarkdown(res.newText, finalPath, "demo");
    if (fresh.photoUrls === undefined && job.photoUrls) { fresh.photoUrls = job.photoUrls; fresh.cover = job.cover; fresh.photos = job.photos; }
    if (app().replaceJob) app().replaceJob(fresh);
    if (drawerOpen() && typeof root.openJob === "function") root.openJob(fresh.id);
    app().toast && app().toast("Preview — change applied here only, nothing saved.", "info");
    return Promise.resolve(true);
  }

  function friendlyErr(e) {
    var m = (e && e.message) || "Write failed.";
    if (e && e.status === 401) return "Token rejected (401). Reconnect this device.";
    if (e && (e.status === 403 || e.status === 429)) {
      // GitHub sends rate-limit refusals as 403 (or 429) with "rate limit" in
      // the body — mkErr embeds that body, so tell them apart from a real
      // permission problem instead of blaming the token.
      if (/rate limit/i.test(m)) return "GitHub rate limit hit — wait a minute and retry. Your change was NOT saved.";
      return "GitHub refused the write (403) — token may lack write access.";
    }
    if (e && e.status === 404) return "File not found (404). Pull latest and retry.";
    if (e && e.status === 409) return "Someone edited this job at the same time — refresh and retry.";
    return m;
  }
  edit._friendlyErr = friendlyErr; // node test hook (precedent: data._today)

  /* ============================================================
     augmentDrawer — append the edit UI to the open drawer
     ============================================================ */
  edit.augmentDrawer = function (job) {
    injectStyle();
    var dbody = document.querySelector("#drawer .dbody");
    if (!dbody || !job) return;
    if (dbody.querySelector(".fxc-edit")) return; // already augmented
    // only the live fxc-pm jobs are editable; Trello/demo history is read-only
    var wrap = document.createElement("div");
    wrap.className = "fxc-edit";

    var mode = (FXC.state && FXC.state.mode) || null;
    var demoRich = mode === "demo" && isVaultJob(job); // real parsed record in preview → full UI, sandbox writes
    if (mode === "demo" && !demoRich) {
      wrap.innerHTML = '<div class="fxc-note-banner">Preview — connect your repo to edit real jobs.</div>';
      dbody.appendChild(wrap); return;
    }
    if (mode === "offline") {
      wrap.innerHTML = '<div class="fxc-note-banner">Offline — showing last synced data. Editing is disabled until you reconnect.</div>';
      dbody.appendChild(wrap); return;
    }
    if (job.source !== "fxc-pm" || !job.rich) {
      wrap.innerHTML = '<div class="fxc-note-banner">History card — read-only. New jobs flow through the live vault and are fully editable.</div>';
      dbody.appendChild(wrap); return;
    }
    if (!demoRich && !auth().getRole()) {
      wrap.innerHTML = '<div class="fxc-note-banner">Pick who you are (top-right) to make changes.</div>';
      dbody.appendChild(wrap); return;
    }
    var can = demoRich
      ? function () { return true; } // preview: show everything; writes are sandboxed anyway
      : function (f, o) { return auth().canEdit(job, f, o); };

    var html = "";
    if (demoRich) html += '<div class="fxc-note-banner" style="margin-bottom:12px">Preview of the real #' + esc(job.jobNumber) + ' record — tap anything; changes apply here only, nothing is saved.</div>';

    /* ---- current-phase gate checklist ---- */
    var phaseName = currentPhaseName(job);
    var phaseGates = (job._meta.gateIndex || []).filter(function (g) { return g.phase === phaseName; });
    if (phaseGates.length) {
      html += "<h4>" + esc(phaseName) + " checklist</h4>";
      phaseGates.forEach(function (g, gi) {
        var pr = gateProgress(g);
        var canGate = can("gate", { gatePhase: g.phase });
        var row = function (b) {
          return '<div class="fxc-gaterow ' + (b.checked ? "on" : "") + (canGate ? "" : " ro") + '"' +
            (canGate ? ' data-toggle="1" data-gate="' + esc(g.gateName) + '" data-text="' + esc(b.text) + '"' : "") + ">" +
            '<span class="box">' + (b.checked ? "✓" : "") + "</span>" +
            '<span class="lbl">' + esc(b.text) + "</span></div>";
        };
        /* Brad 2026-07-03: the WHOLE checklist (checked and open alike) collapses
           behind the count — tap "3/4" to reveal. Boxes render in vault order and
           stay put when checked; no regrouping. (Supersedes 2026-07-02 checked-
           boxes-visible layout, which made items jump to the top on check.) */
        var hasBoxes = g.boxes.length > 0;
        var isOpen = hasBoxes && !!revealState(job.id)[g.gateName];
        html += '<div class="fxc-gatehead' + (hasBoxes ? " more" : "") + (isOpen ? " exp" : "") + '"' +
          (hasBoxes ? ' data-reveal="fxc-gopen-' + gi + '" data-gate="' + esc(g.gateName) + '"' : "") + ">" +
          '<span class="gname">' + esc(g.gateName) + "</span>" +
          '<span class="pct">' + pr.done + "/" + pr.total + "</span></div>";
        if (hasBoxes) {
          html += '<div class="fxc-reveal' + (isOpen ? " open" : "") + '" id="fxc-gopen-' + gi + '">';
          g.boxes.forEach(function (b) { html += row(b); });
          html += "</div>";
        }
      });
    }

    /* ---- advance status ---- */
    var next = nextStatusOf(job);
    if (next) {
      var T = data().TRANSITIONS[next];
      var g = T ? gateByMatch(job, T.gate) : null;
      var ready = g ? (function () { var p = gateProgress(g); return p.total > 0 && p.done === p.total; })() : true;
      var canStat = can("status", { toStatus: next });
      var label = "Advance to " + (data().STAGE_LABELS[next] || next) + " →";
      if (canStat) {
        html += '<h4>Status</h4>';
        /* blocked + full scope → offer the check-all bypass side by side (same
           rules as the move popup: canEdit "gate-bulk", never crew; the open
           items are ticked in the advance commit, recorded as a bulk-confirm) */
        var openN = (!ready && g) ? (function () { var p = gateProgress(g); return p.total - p.done; })() : 0;
        if (!ready && g && can("gate-bulk")) {
          html += '<div class="fxc-btnrow">' +
            '<button class="fxc-btn" id="fxc-advance" disabled data-next="' + esc(next) + '">' + esc(label) + "</button>" +
            '<button class="fxc-btn" id="fxc-advance-bulk" data-next="' + esc(next) + '">✓ Check all (' + openN + ") &amp; advance</button></div>";
          html += '<div class="fxc-hint">Finish “' + esc(g.gateName) + '” — or Check all ticks the ' + openN +
            " open item" + (openN === 1 ? "" : "s") + " in the advance commit, recorded as a bulk-confirm.</div>";
        } else {
          html += '<button class="fxc-btn" id="fxc-advance" ' + (ready ? "" : "disabled") +
            ' data-next="' + esc(next) + '">' + esc(label) + "</button>";
          if (!ready && g) html += '<div class="fxc-hint">Finish “' + esc(g.gateName) + '” first.</div>';
        }
      }
    }

    /* ---- field logs (reading / product / note) — readings are on-site captures,
       so they wait for the ACTIVE phase (Brad 2026-07-03), same gate as product
       usage below; notes stay available any phase ---- */
    var phaseNum = parseInt(String(job.phase || ""), 10);
    var canReading = can("reading") && phaseNum >= 2;
    var canNote = can("note");
    if (canReading || canNote) {
      html += "<h4>Log</h4>";
      if (canReading) {
        html += logButton("reading", "+ Log a reading");
        html += '<div class="fxc-form" id="fxc-form-reading">' +
          '<div class="grid">' +
            field("rd-area", "Area", "text") +
            '<div><label>Batch # (one or more)</label><input id="rd-batch" type="text" placeholder="e.g. 288-A-2207, 248-C-1130"></div>' +
            field("rd-moist", "Moisture %", "decimal") + field("rd-temp", "Temp °C", "decimal") +
            field("rd-rh", "RH %", "decimal") +
            '<div><label>CSP</label><select id="rd-csp"><option value=""></option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option><option>9</option></select></div>' +
            '<div><label>WFT / DFT</label><input id="rd-dft" type="text"><button type="button" class="fxc-nocoat" id="rd-nocoat">no coating applied</button></div>' +
            field("rd-date", "Date", "date") +
          "</div>" +
          '<label>Notes</label><textarea id="rd-notes"></textarea>' +
          '<button class="fxc-btn" id="fxc-save-reading">Save reading</button></div>';
      }
      if (canNote) {
        html += logButton("note", "+ Add a note");
        html += '<div class="fxc-form" id="fxc-form-note">' +
          '<label>Note</label><textarea id="nt-text" placeholder="What happened on site…"></textarea>' +
          '<button class="fxc-btn" id="fxc-save-note">Add note</button></div>';
      }
    }

    /* ---- product usage — PJA capture (Brad 06-12: log-style; only once the
       job is ACTIVE or later — planning work orders stay clean). canReading now
       already carries the phaseNum >= 2 gate. ---- */
    if (canReading) {
      var u = job.usage;
      var uRows = (u && u.rows) ? u.rows : [];
      html += '<h4>Product usage — PJA capture <span class="fxc-cap-badge">' + uRows.length + "</span></h4>";
      html += '<div class="fxc-cap"><table><thead><tr><th>Product</th><th>Qty used</th><th>Notes</th></tr></thead><tbody>' +
        (uRows.length
          ? uRows.map(function (r) { return "<tr><td>" + esc(r[0] || "") + "</td><td>" + esc(r[1] || "") + "</td><td>" + esc(r[2] || "") + "</td></tr>"; }).join("")
          : '<tr><td colspan="3" class="fxc-cap-empty">Nothing logged yet — first mix goes here.</td></tr>') +
        "</tbody></table></div>";
      html += '<div class="fxc-logbar">' +
        '<input id="pr-name" type="text" placeholder="product">' +
        '<input id="pr-qty" type="number" inputmode="decimal" placeholder="qty">' +
        '<input id="pr-notes" type="text" placeholder="notes (units, partial pails…)">' +
        '<button class="fxc-btn" id="fxc-save-product">Log usage</button></div>';
    }

    /* ---- schedule & money (full scope only) ---- */
    if (can("date")) {
      html += "<h4>Schedule &amp; money</h4>";
      html += logButton("sched", "Edit dates / crew / hold");
      html += '<div class="fxc-form" id="fxc-form-sched">' +
        '<div class="grid">' +
          field("sc-start", "Start date", "date", job.dates && job.dates.start) +
          field("sc-end", "End date", "date", job.dates && job.dates.end) +
          field("sc-deadline", "Deadline", "date", job.dates && job.dates.deadline) +
          field("sc-crew", "Crew (comma-sep)", "text", (job.crew || []).join(", ")) +
        "</div>" +
        '<label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:14px;color:var(--ink)">' +
          '<input type="checkbox" id="sc-hold" style="width:auto" ' + (job.on_hold ? "checked" : "") + "> On hold</label>" +
        '<button class="fxc-btn" id="fxc-save-sched">Save schedule</button></div>';
    }

    wrap.innerHTML = html;
    wrap._job = job;
    dbody.appendChild(wrap);
    wire(job, wrap);
  };

  function logButton(key, label) {
    return '<button class="fxc-btn sec fxc-collapse" data-collapse="fxc-form-' + key + '">' + esc(label) + "</button>";
  }
  function field(id, label, mode, val) {
    var type = mode === "date" ? "date" : "text";
    var im = (mode === "decimal") ? ' inputmode="decimal"' : (mode === "tel" ? ' inputmode="tel"' : "");
    return '<div><label>' + esc(label) + '</label><input id="' + id + '" type="' + type + '"' + im +
      ' value="' + esc(val || "") + '"></div>';
  }

  /* ---------- wire events ---------- */
  function wire(job, wrap) {
    // collapsibles
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-collapse]"), function (btn) {
      btn.onclick = function () {
        var f = wrap.querySelector("#" + btn.getAttribute("data-collapse"));
        if (f) f.classList.toggle("open");
      };
    });

    // gate toggles
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-toggle="1"]'), function (rowEl) {
      rowEl.onclick = function () {
        var gateName = rowEl.getAttribute("data-gate");
        var text = rowEl.getAttribute("data-text");
        var fn = function (j) {
          var abs = findBoxAbsLine(j, gateName, text);
          if (abs < 0) throw new Error("Checkbox not found after refresh.");
          var r = data().toggleGate(j, abs); r._origPath = j._meta.path; return r;
        };
        edit.commit(job, fn, "gate", { gatePhase: phaseFromGate(job, gateName) });
      };
    });

    // gate reveal — tap anywhere on the gate bar to show/hide its open items; remember
    // the state per gate so the re-render after checking an item doesn't collapse it
    Array.prototype.forEach.call(wrap.querySelectorAll(".fxc-gatehead.more"), function (headEl) {
      headEl.onclick = function () {
        var rv = wrap.querySelector("#" + headEl.getAttribute("data-reveal"));
        var gname = headEl.getAttribute("data-gate");
        var nowOpen = !(rv && rv.classList.contains("open"));
        if (rv) rv.classList.toggle("open", nowOpen);
        headEl.classList.toggle("exp", nowOpen);
        var st = revealState(job.id);
        if (nowOpen) st[gname] = true; else delete st[gname];
      };
    });

    // advance status
    var adv = wrap.querySelector("#fxc-advance");
    if (adv && !adv.disabled) {
      adv.onclick = function () {
        var next = adv.getAttribute("data-next");
        var fn = function (j) { var r = data().setStatus(j, next); r._origPath = j._meta.path; return r; };
        edit.commit(job, fn, "status", { toStatus: next });
      };
    }
    // check all & advance (bulk-confirm; full scope only — see canEdit "gate-bulk")
    var advBulk = wrap.querySelector("#fxc-advance-bulk");
    if (advBulk) {
      advBulk.onclick = function () {
        var nextB = advBulk.getAttribute("data-next");
        var fnB = function (j) { var r = data().setStatus(j, nextB, { bulk: true }); r._origPath = j._meta.path; return r; };
        edit.commit(job, fnB, "gate-bulk", { toStatus: nextB });
      };
    }

    // reading
    bindSave(wrap, "#fxc-save-reading", "reading", function () {
      return {
        date: val(wrap, "#rd-date"), area: val(wrap, "#rd-area"), moisture: val(wrap, "#rd-moist"),
        temp: val(wrap, "#rd-temp"), RH: val(wrap, "#rd-rh"), CSP: val(wrap, "#rd-csp"),
        batch: val(wrap, "#rd-batch"), dft: val(wrap, "#rd-dft"), notes: val(wrap, "#rd-notes")
      };
    }, function (j, row) { var r = data().appendReading(j, row); r._origPath = j._meta.path; return r; });
    var noc = wrap.querySelector("#rd-nocoat");
    if (noc) noc.onclick = function () { var el = wrap.querySelector("#rd-dft"); if (el) el.value = "no coating applied"; };

    // product
    bindSave(wrap, "#fxc-save-product", "product", function () {
      return { product: val(wrap, "#pr-name"), qty: val(wrap, "#pr-qty"), notes: val(wrap, "#pr-notes") };
    }, function (j, row) { var r = data().appendProduct(j, row); r._origPath = j._meta.path; return r; });

    // note
    var nb = wrap.querySelector("#fxc-save-note");
    if (nb) nb.onclick = function () {
      var text = val(wrap, "#nt-text");
      if (!text) { app().toast && app().toast("Type a note first.", "err"); return; }
      var fn = function (j) { var r = data().appendNote(j, text); r._origPath = j._meta.path; return r; };
      edit.commit(job, fn, "note");
    };

    // schedule (one commit per changed field — keeps each write a single-line edit)
    var sb = wrap.querySelector("#fxc-save-sched");
    if (sb) sb.onclick = function () {
      var updates = [
        ["start_date", val(wrap, "#sc-start"), "date"],
        ["end_date", val(wrap, "#sc-end"), "date"],
        ["deadline", val(wrap, "#sc-deadline"), "date"],
        ["crew", splitCrew(val(wrap, "#sc-crew")), "crew"],
        ["on_hold", wrap.querySelector("#sc-hold").checked, "on_hold"]
      ];
      runSequential(job, updates, 0);
    };
  }

  function runSequential(job, updates, i) {
    if (i >= updates.length) { app().toast && app().toast("Schedule saved.", "ok"); return; }
    var u = updates[i], key = u[0], value = u[1], field = u[2];
    // skip no-op crew/on_hold/dates that didn't change
    var cur = currentFieldValue(job, key);
    if (sameVal(cur, value)) { runSequential(job, updates, i + 1); return; }
    var fn = function (j) { var r = data().setField(j, key, value); r._origPath = j._meta.path; return r; };
    edit.commit(job, fn, field).then(function () {
      // after a commit the drawer re-opens with fresh job; re-read it for the next field
      var fresh = (root.JOBS || []).filter(function (x) { return x.id === job.id; })[0] || job;
      runSequential(fresh, updates, i + 1);
    });
  }

  function currentFieldValue(job, key) {
    if (key === "crew") return (job.crew || []).join(", ");
    if (key === "on_hold") return !!job.on_hold;
    if (key === "start_date") return job.dates.start || "";
    if (key === "end_date") return job.dates.end || "";
    if (key === "deadline") return job.dates.deadline || "";
    return "";
  }
  function sameVal(a, b) {
    if (Array.isArray(b)) b = b.join(", ");
    return String(a == null ? "" : a) === String(b == null ? "" : b);
  }
  function splitCrew(s) {
    return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function phaseFromGate(job, gateName) {
    var p = "Active";
    (job._meta.gateIndex || []).forEach(function (g) { if (g.gateName === gateName) p = g.phase; });
    return p;
  }
  function bindSave(wrap, sel, field, getRow, transform) {
    var b = wrap.querySelector(sel);
    if (!b) return;
    b.onclick = function () {
      var row = getRow();
      var fn = function (j) { return transform(j, row); };
      edit.commit(wrap._job || jobOf(wrap), fn, field);
    };
  }
  function jobOf(wrap) {
    // resolve the current job from the drawer header job number
    var id = (document.querySelector("#drawer") && document.querySelector("#drawer").getAttribute("data-job")) || null;
    return (root.JOBS || []).filter(function (x) { return x.id === id; })[0];
  }
  function val(wrap, sel) { var n = wrap.querySelector(sel); return n ? String(n.value || "").trim() : ""; }

  /* ============================================================
     MOVE PICKER + GATED ADVANCE CONFIRM
     Card-level moves. Vault rule: a job advances ONE gated step at
     a time (never skip a gate); on-hold is an orthogonal toggle.
     Live mode commits through edit.commit (canEdit re-checked at
     write); demo mode falls back to v1's sandbox applyMove().
     ============================================================ */
  var PHASE_BUCKET = { "1-planning": "upcoming", "2-active": "active", "3-closeout": "closeout", "4-archive": "closed" };
  function bucketOfStatus(st) { return PHASE_BUCKET[data().phaseOf ? data().phaseOf(st) : "1-planning"] || "upcoming"; }
  function stageLabel(st) { return (data().STAGE_LABELS && data().STAGE_LABELS[st]) || st; }

  function statusAfter(st) {
    var T = data().TRANSITIONS || {};
    for (var to in T) { if (T[to] && T[to].from === st) return to; }
    return null;
  }
  /* the status one step back (the `from` of the transition INTO st); null at the start */
  function statusBefore(st) {
    var T = data().TRANSITIONS || {};
    return T[st] ? T[st].from : null;
  }
  /* ordered hops from job.status to targetStatus (forward only); null if unreachable */
  function chainTo(job, targetStatus) {
    var hops = [], cur = job.status, guard = 0;
    while (cur !== targetStatus && guard++ < 20) {
      var next = statusAfter(cur);
      if (!next) return null;
      hops.push(next); cur = next;
    }
    return cur === targetStatus ? hops : null;
  }
  /* gate state for the transition INTO status `to` */
  function hopGate(job, to) {
    var T = data().TRANSITIONS[to];
    var g = T ? gateByMatch(job, T.gate) : null;
    var p = g ? gateProgress(g) : null;
    var ready = p ? (p.total > 0 && p.done === p.total) : true;
    return { gate: g, progress: p, ready: ready };
  }
  /* what entering `st` ACTIVATES: the checklist gating the step OUT of `st` */
  function activatesOf(job, st) {
    var after = statusAfter(st);
    if (!after) return null;
    var h = hopGate(job, after);
    if (!h.gate) return null;
    var open = h.gate.boxes.filter(function (b) { return !b.checked; });
    return { gateName: h.gate.gateName, open: open, total: h.gate.boxes.length };
  }
  /* Planned per-transition triggers (Brad, 2026-06-10) — the popup shows these so
     every move explains its downstream effects BEFORE they're wired. As each
     integration goes live, its line moves from "planned" to an executed action.
     Eventually this manifest belongs in the vault (single source for the popup
     AND the executor — likely a GitHub Action on the private repo), not here. */
  var TRIGGER_PLANS = {
    "package-building": ["create the job's Discord thread", "set the Google Calendar placeholder", "create the Exaktime location"],
    "scheduled": ["firm up the Calendar event", "draft the client confirmation message (start date) for your approval"],
    "cleared-to-deploy": ["post the loading checklist to the Discord thread", "set day-before + 7-day reminders"],
    "deployed": ["set start_date to today + move the Calendar event to match (deploying = the job starts)", "post 'job starting' in the Discord thread and tag the assigned crew", "text the client: job is active, crew arriving today/tomorrow, start time to follow"],
    "invoicing": ["send the invoice details to the bookkeeper to invoice out", "prompt the crew for the product-usage sheet"],
    "pja-pending": ["kick off the PJA — hand actuals (hours, product, diesel) to Airtable"],
    "warranty-issued": ["generate the warranty PDF draft (~Day 15)"],
    "closed": ["archive the Discord thread", "queue the review-request message (Day 3–7)"]
  };

  /* the "This will:" block — used by single advances and chain jumps */
  function willDoHTML(job, hops) {
    var lines = [];
    var cur = job.status;
    var moves = [];
    hops.forEach(function (to) {
      var fp = data().phaseOf(cur), tp = data().phaseOf(to);
      if (fp !== tp) moves.push(tp);
      cur = to;
    });
    var target = hops[hops.length - 1];
    lines.push("• set <b>status: " + esc(target) + "</b>" +
      (hops.length > 1 ? " (" + hops.length + " gated steps, one commit each)" : "") +
      " — and bump updated: to today");
    moves.forEach(function (tp) { lines.push("• move the file to <b>10-jobs/" + esc(tp) + "/</b>"); });
    lines.push("• commit as <b>" + esc(auth().actorName()) + "</b>");
    var act = activatesOf(job, target);
    if (act) {
      var items = act.open.slice(0, 8).map(function (b) { return "&nbsp;&nbsp;&nbsp;☐ " + esc(b.text); });
      if (act.open.length > 8) items.push("&nbsp;&nbsp;&nbsp;… +" + (act.open.length - 8) + " more");
      lines.push("• <b>activates “" + esc(act.gateName) + "”</b> — " + act.open.length + " of " + act.total +
        " item" + (act.total === 1 ? "" : "s") + " to complete:" + (items.length ? "<br>" + items.join("<br>") : ""));
    } else if (target === "closed") {
      lines.push("• <b>job complete</b> — nothing further activates");
    }
    return '<div class="fxc-will">This will:<br>' + lines.join("<br>") + "</div>";
  }

  function closeSheet() {
    ["fxc-sheet-scrim", "fxc-sheet"].forEach(function (id) {
      var n = document.getElementById(id); if (n) n.parentNode.removeChild(n);
    });
  }
  edit.closeSheet = closeSheet;

  function sheet(html) {
    injectStyle();
    closeSheet();
    var scrim = document.createElement("div");
    scrim.className = "fxc-sheet-scrim"; scrim.id = "fxc-sheet-scrim";
    scrim.onclick = closeSheet;
    var sh = document.createElement("div");
    sh.className = "fxc-sheet"; sh.id = "fxc-sheet";
    sh.innerHTML = html;
    document.body.appendChild(scrim); document.body.appendChild(sh);
    requestAnimationFrame(function () { scrim.classList.add("show"); sh.classList.add("show"); });
    return sh;
  }

  function jobHead(job) {
    return "<h3>" + esc(job.jobNumber ? "#" + job.jobNumber + " · " : "") + esc(job.customer || job.title) + "</h3>";
  }

  /* a job parsed from a REAL vault record (has _meta) gets the full gated
     experience even in demo mode — writes just stay sandboxed (demoCommit) */
  function isVaultJob(job) { return !!(job && job.source === "fxc-pm" && job.rich && job._meta); }

  edit.movePicker = function (job) {
    if (!job) return;
    injectStyle();
    var mode = (FXC.state && FXC.state.mode) || null;
    var live = (mode === "live" || mode === "demo") && isVaultJob(job);

    if (!live) {
      /* sandbox: free moves between board buckets, preview-only */
      var BUCKETS = [["upcoming", "Upcoming"], ["active", "Active"], ["onhold", "On Hold"], ["closeout", "Closeout · Invoicing"], ["closed", "Closed"]];
      var rows = BUCKETS.filter(function (b) { return b[0] !== job.bucket; }).map(function (b) {
        return '<button class="fxc-mrow" data-bucket="' + b[0] + '">Move to ' + b[1] + "</button>";
      }).join("");
      var sh = sheet(jobHead(job) +
        '<p class="fxc-sub">Preview — moves here are sandbox-only, nothing is written to the vault.</p>' +
        rows + '<button class="fxc-btn sec" id="fxc-mv-cancel">Cancel</button>');
      Array.prototype.forEach.call(sh.querySelectorAll("[data-bucket]"), function (btn) {
        btn.onclick = function () {
          closeSheet();
          var b = btn.getAttribute("data-bucket");
          var ds = { bucket: b };
          if (b === "closeout") ds.stage = "Invoicing";
          if (root.applyMove) root.applyMove(job, ds);
          app().toast && app().toast("Moved (preview — not saved).", "info");
        };
      });
      sh.querySelector("#fxc-mv-cancel").onclick = closeSheet;
      return;
    }

    /* live vault job: the single next gated step + the hold toggle */
    var demoSandbox = mode === "demo";
    var next = nextStatusOf(job);
    var rows2 = "";
    if (next) {
      var T = data().TRANSITIONS[next];
      var g = T ? gateByMatch(job, T.gate) : null;
      var p = g ? gateProgress(g) : null;
      var ready = p ? (p.total > 0 && p.done === p.total) : true;
      if (demoSandbox || auth().canEdit(job, "status", { toStatus: next })) {
        rows2 += '<button class="fxc-mrow" id="fxc-mv-adv">Advance to ' + esc(stageLabel(next)) + " →" +
          (g && !ready ? '<span class="sub">' + (p.total - p.done) + " item" + (p.total - p.done === 1 ? "" : "s") +
            " left on “" + esc(g.gateName) + "”</span>" : "") + "</button>";
      }
    } else {
      rows2 += '<div class="fxc-sub">This job is at the end of the line — no further stage.</div>';
    }
    /* jump further down the pipeline — every gate still checks along the way */
    var fwd = [];
    var curSt = next ? statusAfter(next) : null;
    while (curSt) { fwd.push(curSt); curSt = statusAfter(curSt); }
    if (!demoSandbox) fwd = fwd.filter(function (t) { return auth().canEdit(job, "status", { toStatus: t }); });
    if (fwd.length) {
      rows2 += '<select class="fxc-mrow" id="fxc-mv-jump">' +
        '<option value="">Jump further — every gate is checked along the way…</option>' +
        fwd.map(function (t) { return '<option value="' + esc(t) + '">' + esc(stageLabel(t)) + "</option>"; }).join("") +
        "</select>";
    }
    if (demoSandbox || auth().canEdit(job, "on_hold")) {
      rows2 += '<button class="fxc-mrow" id="fxc-mv-hold">' + (job.on_hold ? "Resume (take off hold)" : "Put on hold") + "</button>";
    }
    /* backward correction — reason recorded in the commit (un-gated by role for
       now; identity.js canEdit "status-back" is where to re-gate) */
    var prevSt = statusBefore(job.status);
    if (prevSt && (demoSandbox || auth().canEdit(job, "status-back"))) {
      rows2 += '<button class="fxc-mrow back" id="fxc-mv-back">← Move back to ' + esc(stageLabel(prevSt)) +
        '<span class="sub">correction · reason required</span></button>';
    }
    var sh2 = sheet(jobHead(job) +
      '<p class="fxc-sub">Jobs move one gated step at a time — the gate is verified before anything is written.' +
      (demoSandbox ? " (Preview: changes apply here only.)" : "") + "</p>" +
      rows2 + '<button class="fxc-btn sec" id="fxc-mv-cancel">Cancel</button>');
    var advBtn = sh2.querySelector("#fxc-mv-adv");
    if (advBtn) advBtn.onclick = function () { edit.confirmAdvance(job); };
    var jump = sh2.querySelector("#fxc-mv-jump");
    if (jump) jump.onchange = function () { if (jump.value) edit.confirmMove(job, jump.value); };
    var holdBtn = sh2.querySelector("#fxc-mv-hold");
    if (holdBtn) holdBtn.onclick = function () { edit.confirmHold(job, !job.on_hold); };
    var backBtn = sh2.querySelector("#fxc-mv-back");
    if (backBtn) backBtn.onclick = function () { edit.confirmBack(job, statusBefore(job.status)); };
    sh2.querySelector("#fxc-mv-cancel").onclick = closeSheet;
  };

  /* the dedicated TRIGGERS box — always shown, ready or blocked, so every move
     states its downstream effects up front */
  function triggersHTML(job, hops) {
    var blocks = [];
    hops.forEach(function (to) {
      var plans = TRIGGER_PLANS[to] || [];
      if (plans.length) blocks.push({ to: to, plans: plans });
    });
    var inner;
    if (!blocks.length) {
      inner = '<span class="soon">No external triggers defined for this step yet — only the vault changes.</span>';
    } else {
      inner = blocks.map(function (b) {
        return (hops.length > 1 ? "<b>" + esc(stageLabel(b.to)) + "</b>" : "") +
          b.plans.map(function (t) {
            return '<div class="fxc-tg-row">' +
              '<label class="tg-main"><input type="checkbox" checked data-trig> <span>' + esc(t) + "</span></label>" +
              '<select class="fxc-tg-when" title="When should this fire?">' +
                '<option value="now">now</option><option value="30">+30 min</option>' +
                '<option value="60">+1 hr</option><option value="180">+3 hrs</option>' +
                '<option value="custom">at time…</option></select>' +
              '<input type="datetime-local" class="fxc-tg-at" style="display:none">' +
            "</div>";
          }).join("");
      }).join("");
      inner += '<div class="soon" style="margin-top:5px">Untick anything you don\'t want to fire this time; pick a time to delay it. None are wired yet — today only the vault changes; each line goes live as its integration is connected.</div>';
    }
    return '<div class="fxc-trig"><div class="fxc-trig-h">⚡ Triggers on this move</div>' + inner + "</div>";
  }

  var PHASE_LABELS = { "1-planning": "Planning", "2-active": "Active", "3-closeout": "Closeout", "4-archive": "Closed" };

  /* The preflight popup: shows every gate on the way to `target` and EXACTLY
     what the move will trigger/activate, before anything is committed.
     Works for a single step or a multi-hop jump (each hop stays gated — a jump
     is just several gated steps in a row, never a skipped gate).
     opts.droppedOn = label of an invalid drag target (explains the rule). */
  edit.confirmMove = function (job, target, opts) {
    opts = opts || {};
    injectStyle();
    var hops = chainTo(job, target);
    if (!hops || !hops.length) { closeSheet(); return; }
    var states = hops.map(function (to) { var h = hopGate(job, to); h.to = to; return h; });
    var allReady = states.every(function (h) { return h.ready; });
    var firstBlocked = states.filter(function (h) { return !h.ready; })[0] || null;

    /* lead with the board/vault stage names (Planning/Active/Closeout); the
       status names are the steps WITHIN those stages */
    var fromPh = data().phaseOf(job.status), toPh = data().phaseOf(target);
    var phasePart = fromPh === toPh
      ? esc(PHASE_LABELS[fromPh] || "") + " · "
      : '<span style="color:var(--accent)">' + esc(PHASE_LABELS[fromPh] || "") + " → " + esc(PHASE_LABELS[toPh] || "") + "</span> · ";
    var head = "<h3>" + esc("#" + job.jobNumber) + " · " + phasePart +
      '<span style="font-weight:600">' + esc(stageLabel(job.status)) + " → " + esc(stageLabel(target)) + "</span>" +
      (hops.length > 1 ? ' <span style="color:var(--ink-faint);font-weight:600">· ' + hops.length + " steps</span>" : "") + "</h3>";
    var dropped = opts.droppedOn
      ? '<p class="fxc-sub">You dropped it on “' + esc(opts.droppedOn) + "” — jobs advance through their gates in order, so this becomes: " +
        hops.map(stageLabel).map(esc).join(" → ") + ".</p>"
      : "";

    var gateLines = states.map(function (h) {
      if (!h.gate) return '<div class="fxc-gateline ok">✓ ' + esc(stageLabel(h.to)) + " — no checklist gates this step (mobilization day)</div>";
      return '<div class="fxc-gateline click ' + (h.ready ? "ok" : "no") + '" data-gate="' + esc(h.gate.gateName) + '" title="Open this checklist">' +
        (h.ready ? "✓ " : "✗ ") + esc(h.gate.gateName) + " → " + esc(stageLabel(h.to)) + " — " + h.progress.done + "/" + h.progress.total +
        (h.ready ? " complete" : " checked") + ' <span class="go">›</span></div>';
    }).join("");

    var body;
    if (allReady) {
      body = willDoHTML(job, hops);
    } else {
      var left = firstBlocked.gate.boxes.filter(function (b) { return !b.checked; });
      /* "Check all & advance" bypass (Brad 2026-07-02): full scope only (never
         crew — canEdit "gate-bulk"); every open item on the way is flipped in the
         advance commit itself, recorded as a bulk-confirm so the audit trail
         shows the items weren't verified one-by-one. */
      var canBulk = ((FXC.state && FXC.state.mode) || null) === "demo" || auth().canEdit(job, "gate-bulk");
      var openCount = states.reduce(function (a, h) {
        return a + (h.gate ? h.gate.boxes.filter(function (b) { return !b.checked; }).length : 0);
      }, 0);
      body = '<div class="fxc-will"><span class="miss">Blocked at “' + esc(firstBlocked.gate.gateName) + '” — still to do:</span><br>' +
        left.slice(0, 5).map(function (b) { return "• " + esc(b.text); }).join("<br>") +
        (left.length > 5 ? "<br>…" : "") +
        '<br><span class="soon">Tick these off, then move it' +
        (hops.length > 1 ? " — later steps stay locked until this gate clears" : "") + ".</span>" +
        '<div class="fxc-btnrow">' +
        '<button class="fxc-btn sec" id="fxc-cf-open">Open the checklist →</button>' +
        (canBulk ? '<button class="fxc-btn" id="fxc-cf-bulk">✓ Check all &amp; advance to ' + esc(stageLabel(target)) + "</button>" : "") +
        "</div>" +
        (canBulk ? '<span class="soon">Check all = the ' + openCount + " open item" + (openCount === 1 ? "" : "s") +
          " get ticked in the advance commit itself, recorded as a bulk-confirm (not verified item-by-item).</span>" : "") +
        "</div>";
    }
    var goLabel = (hops.length > 1 ? "Advance " + hops.length + " steps to " : "Advance to ") + esc(stageLabel(target)) + " →";
    var sh = sheet(head + dropped + gateLines + body + triggersHTML(job, hops) +
      '<button class="fxc-btn" id="fxc-cf-go"' + (allReady ? "" : " disabled") + ">" + goLabel + "</button>" +
      '<button class="fxc-btn sec" id="fxc-cf-cancel">Cancel</button>');
    var go = sh.querySelector("#fxc-cf-go");
    if (go && allReady) go.onclick = function () {
      closeSheet();
      runChain(job, hops, 0);
    };
    sh.querySelector("#fxc-cf-cancel").onclick = closeSheet;
    /* gate lines + "Open the checklist" deep-link into the job's actual checkboxes */
    Array.prototype.forEach.call(sh.querySelectorAll(".fxc-gateline.click"), function (el) {
      el.onclick = function () { jumpToGate(job, el.getAttribute("data-gate")); };
    });
    /* per-trigger timing: "at time…" reveals a datetime picker (intent recorded;
       fires at that time once the executor is wired) */
    Array.prototype.forEach.call(sh.querySelectorAll(".fxc-tg-when"), function (sel) {
      sel.onchange = function () {
        var at = sel.parentNode.querySelector(".fxc-tg-at");
        if (!at) return;
        at.style.display = sel.value === "custom" ? "block" : "none";
        if (sel.value === "custom" && !at.value) {
          var d = new Date(Date.now() + 30 * 60000);
          d.setSeconds(0, 0);
          at.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        }
      };
    });
    var openBtn = sh.querySelector("#fxc-cf-open");
    if (openBtn && firstBlocked) openBtn.onclick = function () { jumpToGate(job, firstBlocked.gate.gateName); };
    var bulkBtn = sh.querySelector("#fxc-cf-bulk");
    if (bulkBtn) bulkBtn.onclick = function () {
      closeSheet();
      runChain(job, hops, 0, { bulk: true });
    };
  };

  /* close the popup, open the work order, scroll to the named gate and flash it */
  function jumpToGate(job, gateName) {
    closeSheet();
    if (typeof root.openJob === "function") root.openJob(job.id);
    setTimeout(function () {
      var hit = null;
      Array.prototype.forEach.call(document.querySelectorAll("#drawer .fxc-gatehead"), function (h) {
        var s = h.querySelector("span");
        if (!hit && s && s.textContent.trim() === gateName) hit = h;
      });
      var target = hit || document.querySelector("#drawer .fxc-edit") || document.querySelector("#drawer");
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (hit) {
        hit.classList.add("flash"); setTimeout(function () { hit.classList.remove("flash"); }, 1600);
        // reveal the open items so the jumped-to gate is actionable, and remember it
        if (hit.classList.contains("more")) {
          var rv = document.querySelector("#" + hit.getAttribute("data-reveal"));
          if (rv) rv.classList.add("open");
          hit.classList.add("exp");
          revealState(job.id)[hit.getAttribute("data-gate")] = true;
        }
      }
    }, 250);
  }

  /* back-compat single-step entry (drawer button + drag handoff) */
  edit.confirmAdvance = function (job, opts) {
    var next = nextStatusOf(job);
    if (next) edit.confirmMove(job, next, opts);
  };

  /* execute a multi-hop jump as a sequence of individual gated commits —
     every hop is its own role-stamped, revertable commit. o.bulk = "check all &
     advance": each hop's open gate items are flipped in that hop's commit and
     recorded as a bulk-confirm (canEdit "gate-bulk": full scope only). */
  function runChain(job, hops, i, o) {
    if (i >= hops.length) return;
    var to = hops[i];
    var bulk = !!(o && o.bulk);
    var fn = function (j) { var r = data().setStatus(j, to, bulk ? { bulk: true } : undefined); r._origPath = j._meta.path; return r; };
    edit.commit(job, fn, bulk ? "gate-bulk" : "status", { toStatus: to }).then(function (ok) {
      if (!ok) { app().toast && app().toast("Stopped before " + stageLabel(to) + " — fix and retry.", "err"); return; }
      if (i + 1 < hops.length) {
        var fresh = (root.JOBS || []).filter(function (x) { return x.id === job.id; })[0] || job;
        runChain(fresh, hops, i + 1, o);
      }
    });
  }

  edit.confirmHold = function (job, hold) {
    injectStyle();
    var head = "<h3>" + esc("#" + job.jobNumber) + " · " + (hold ? "Put on hold" : "Resume") + "</h3>";
    var will = '<div class="fxc-will">This will:' +
      "<br>• set <b>on_hold: " + (hold ? "true" : "false") + "</b> (status stays " + esc(stageLabel(job.status)) + ")" +
      "<br>• commit as <b>" + esc(auth().actorName()) + "</b></div>";
    var sh = sheet(head + will +
      '<button class="fxc-btn" id="fxc-hd-go">' + (hold ? "Put on hold" : "Resume job") + "</button>" +
      '<button class="fxc-btn sec" id="fxc-hd-cancel">Cancel</button>');
    sh.querySelector("#fxc-hd-go").onclick = function () {
      closeSheet();
      var fn = function (j) { var r = data().setField(j, "on_hold", hold); r._origPath = j._meta.path; return r; };
      edit.commit(job, fn, "on_hold");
    };
    sh.querySelector("#fxc-hd-cancel").onclick = closeSheet;
  };

  /* Backward correction — move a job to an EARLIER status. Reason required, NOT
     gate-checked, recorded in the commit ("revert … — <reason>"); crossing a
     phase boundary moves the file back to the earlier folder. Currently UN-gated
     by role (Brad 2026-07-02) — see the status-back carve-out in identity.js
     canEdit, which is the single place to re-gate. */
  edit.confirmBack = function (job, toStatus, droppedOn) {
    if (!job || !toStatus) return;
    injectStyle();
    var demoSandbox = ((FXC.state && FXC.state.mode) || null) === "demo" && isVaultJob(job);
    if (!demoSandbox && !auth().canEdit(job, "status-back")) {
      app().toast && app().toast("Connect this device and pick who you are first — backward moves are committed with your name.", "err");
      return;
    }
    var fromPh = data().phaseOf(job.status), toPh = data().phaseOf(toStatus);
    var head = "<h3>" + esc("#" + job.jobNumber) + " · ← Move back</h3>";
    var dropped = droppedOn ? '<p class="fxc-sub">You dropped it on “' + esc(droppedOn) + "” — that's a backward move.</p>" : "";
    var will = '<div class="fxc-will"><span class="miss">Backward correction</span> — gates are NOT re-checked.<br>' +
      "• set <b>" + esc(stageLabel(job.status)) + " → " + esc(stageLabel(toStatus)) + "</b>" +
      (fromPh !== toPh ? "<br>• move the file back to <b>10-jobs/" + esc(toPh) + "/</b>" : "") +
      "<br>• commit as <b>" + esc(auth().actorName()) + "</b> with your reason (kept in the git history)" +
      (demoSandbox ? '<br><span class="soon">Preview: applies here only.</span>' : "") + "</div>" +
      '<label class="fxc-bklbl" for="fxc-bk-reason">Reason (required)</label>' +
      '<input id="fxc-bk-reason" class="fxc-bkin" type="text" placeholder="e.g. deposit reversed · mis-advanced · client paused">';
    var sh = sheet(head + dropped + will +
      '<button class="fxc-btn" id="fxc-bk-go">Move back to ' + esc(stageLabel(toStatus)) + "</button>" +
      '<button class="fxc-btn sec" id="fxc-bk-cancel">Cancel</button>');
    var reason = sh.querySelector("#fxc-bk-reason");
    sh.querySelector("#fxc-bk-go").onclick = function () {
      var r = String(reason.value || "").trim();
      if (!r) { reason.classList.add("bkerr"); reason.focus(); app().toast && app().toast("A reason is required to move a job back.", "err"); return; }
      closeSheet();
      var fn = function (j) { var res = data().setStatus(j, toStatus, { back: true, reason: r }); res._origPath = j._meta.path; return res; };
      edit.commit(job, fn, "status-back", { toStatus: toStatus, back: true });
    };
    sh.querySelector("#fxc-bk-cancel").onclick = closeSheet;
  };

  /* Grip-drag handoff from index.html endDrag(). Returns true when the drop is
     handled here (live vault jobs — gated, via popup); false lets v1's sandbox
     applyMove() run (demo / history cards). */
  edit.handleDrop = function (job, ds) {
    var mode = (FXC.state && FXC.state.mode) || null;
    if ((mode !== "live" && mode !== "demo") || !isVaultJob(job)) return false;
    if (!ds || !ds.bucket) return true;
    if (ds.bucket === "onhold") {
      if (!job.on_hold) edit.confirmHold(job, true);
      return true;
    }
    if (job.on_hold && ds.bucket === bucketOfStatus(job.status)) {
      edit.confirmHold(job, false);
      return true;
    }
    if (ds.bucket === job.bucket && (!ds.stage || ds.stage === stageLabel(job.status))) return true; /* no-op */
    /* dropping on a column = "take me there": chain to that phase/stage's entry
       status, every gate checked along the way. Checked BEFORE the closed dead-end
       so a finished job can still be moved BACK (Brad 2026-07-02: closeout/closed
       jobs were undraggable backwards — the "nowhere further" return fired first). */
    var entry = statusEntryForDrop(ds);
    if (entry) {
      if (entry === job.status) return true;
      var hops = chainTo(job, entry);
      if (hops && hops.length) { edit.confirmMove(job, entry, { droppedOn: ds.stage || ds.bucket }); return true; }
      backwardSheet(job, entry, ds.stage || ds.bucket); /* unreachable forward = a backward move */
      return true;
    }
    var next = nextStatusOf(job);
    if (!next) {
      app().toast && app().toast("This job is closed — drag it onto an earlier column to move it back.", "info");
      return true;
    }
    edit.confirmMove(job, next, { droppedOn: ds.stage || ds.bucket });
    return true;
  };

  /* which status a dropped-on column means: a phase column = its entry status;
     a closeout stage column = that exact status */
  function statusEntryForDrop(ds) {
    if (ds.stage) {
      var SL = data().STAGE_LABELS || {};
      for (var st in SL) { if (SL[st] === ds.stage) return st; }
      return null;
    }
    return { upcoming: "won", active: "deployed", closeout: "invoicing", closed: "closed" }[ds.bucket] || null;
  }

  function backwardSheet(job, targetStatus, droppedOn) {
    var demoSandbox = ((FXC.state && FXC.state.mode) || null) === "demo" && isVaultJob(job);
    /* offer the reason-stamped backward correction (canEdit gates it — currently
       un-gated for any signed-in role; see identity.js) */
    if (targetStatus && (demoSandbox || auth().canEdit(job, "status-back"))) {
      edit.confirmBack(job, targetStatus, droppedOn);
      return;
    }
    var sh = sheet(jobHead(job) +
      '<p class="fxc-sub">You dropped it on “' + esc(droppedOn) + '” — that\'s <b>backwards</b>. Moving a job ' +
      "back is a reason-stamped correction; connect this device and pick who you are first.</p>" +
      '<button class="fxc-btn sec" id="fxc-bk-cancel">Got it</button>');
    sh.querySelector("#fxc-bk-cancel").onclick = closeSheet;
  }

})(typeof window !== "undefined" ? window : this);
