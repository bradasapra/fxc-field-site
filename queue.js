/* ============================================================
   FXC Field — queue.js
   Persistent offline write queue (v1: field capture survives dead signal).
   Owns window.FXC.queue. Store + flush engine; NO UI code (badges/banners
   are rendered by the callers via onChange).

   V1 scope (Brad ruling 2026-07-07): append-only capture writes ONLY —
   readings, product/batch usage, notes. Gate toggles, status moves and
   field edits are never queued (replaying them from stale state is how
   the vault gets corrupted).

   Entry schema ("fxc.queue.v1", JSON array, FIFO — index 0 is the head):
     { id, jobPath, jobNum, kind, row, message, author, capturedAt }
   kind ∈ {reading, product, note}; row is the transform input
   ({...cells} for reading/product, {text} for note). message + author are
   snapshotted at CAPTURE time — a flush hours later (or by whoever holds
   the phone then) must not re-stamp the commit with the live role.
   ============================================================ */
(function (root) {
  "use strict";

  var FXC = (root.FXC = root.FXC || {});
  var queue = (FXC.queue = FXC.queue || {});

  var KEY = "fxc.queue.v1";
  queue.KEY = KEY;

  /* lazy module handles — load order must not matter */
  function dataMod() { return FXC.data; }
  function auth() { return root.FXCAuth || FXC.identity; }

  var KINDS = { reading: 1, product: 1, note: 1 };
  queue.KINDS = KINDS;

  /* ---- change listeners (badges re-render off these) ---- */
  var listeners = [];
  queue.onChange = function (fn) { if (typeof fn === "function") listeners.push(fn); };
  function notify() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* ---- store ----
     A corrupt store must never brick boot: parse failures drop the store
     LOUDLY — queue.lastRecovery carries the (estimated) loss count for the
     boot banner — but always return a usable empty queue. */
  queue.lastRecovery = null;

  function validEntry(e) {
    // jobPath may be EMPTY: an offline-boot capture runs against the
    // localStorage snapshot, which strips _meta — flush re-locates those
    // by job number. One of the two locators must be present.
    return !!(e && typeof e === "object" &&
      typeof e.id === "string" && e.id &&
      typeof e.jobPath === "string" &&
      typeof e.jobNum === "string" && (e.jobPath || e.jobNum) &&
      KINDS[e.kind] &&
      e.row && typeof e.row === "object" &&
      typeof e.message === "string" && e.message &&
      e.author && typeof e.author.name === "string" && e.author.name &&
      typeof e.capturedAt === "string" && e.capturedAt);
  }

  function load() {
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return [];
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    if (!Array.isArray(arr)) {
      // whole store unreadable — estimate how many saves are being lost
      // (one "kind" key per entry) so the recovery banner can say so.
      var est = (String(raw).match(/"kind"/g) || []).length;
      queue.lastRecovery = { dropped: est, at: today() };
      try { root.localStorage.removeItem(KEY); } catch (e) {}
      notify();
      return [];
    }
    var good = arr.filter(validEntry);
    if (good.length !== arr.length) {
      queue.lastRecovery = { dropped: arr.length - good.length, at: today() };
      persist(good);
      notify();
    }
    return good;
  }

  function persist(entries) {
    try { root.localStorage.setItem(KEY, JSON.stringify(entries)); return true; }
    catch (e) { return false; } // storage full/unavailable — caller decides
  }

  function today() {
    var d = dataMod();
    if (d && d._today) return d._today();
    return new Date().toISOString().slice(0, 10);
  }

  queue.list = function () { return load().slice(); };

  queue.count = function (jobNum) {
    var entries = load();
    if (jobNum == null) return entries.length;
    var n = String(jobNum);
    return entries.filter(function (e) { return e.jobNum === n; }).length;
  };

  var seq = 0;

  /* add({job, kind, row, message}) -> entry | null
     job: the snapshot Job the capture ran against (path/number source).
     message: the transform's own commit line, built at capture time —
     the capture-time role stamp rides here. Author snapshotted the same
     moment. Returns null (nothing stored) on bad input or full storage. */
  queue.add = function (spec) {
    spec = spec || {};
    var job = spec.job;
    if (!job || !KINDS[spec.kind]) return null;
    var jobPath = (job._meta && job._meta.path) || ""; // snapshot jobs have no _meta
    if (!jobPath && !job.jobNumber) return null;       // flush needs SOME locator
    if (!spec.message || !spec.row || typeof spec.row !== "object") return null;

    var a = auth();
    var author = (a && a.commitAuthor) ? a.commitAuthor()
      : { name: (FXC.state && FXC.state.role && FXC.state.role.name) || "Field", email: "field@fxcoating.ca" };

    var capturedAt = today();
    var row;
    try { row = JSON.parse(JSON.stringify(spec.row)); } catch (e) { return null; }
    // a queued reading must carry its capture date IN the row — the capture
    // bar leaves row.date blank and appendReading defaults it to today(),
    // which at flush time would be the flush day, not the capture day.
    if (spec.kind === "reading" && !row.date) row.date = capturedAt;

    var entry = {
      id: "q" + Date.now() + "-" + (++seq),
      jobPath: jobPath,
      jobNum: String(job.jobNumber || ""),
      kind: spec.kind,
      row: row,
      message: String(spec.message),
      author: { name: author.name, email: author.email || "field@fxcoating.ca" },
      capturedAt: capturedAt
    };
    if (!validEntry(entry)) return null;

    var entries = load();
    entries.push(entry);
    if (!persist(entries)) return null;
    notify();
    return entry;
  };

  /* messageFor(kind, job, row) — the capture-time commit line for a job
     that CAN'T run its transform (offline-boot snapshot jobs have no
     _meta.rawLines). Mirrors data.js's message grammar byte-for-byte;
     the harness locks the two together (grammar-lock test) — if data.js's
     detail wording changes, that test goes red before the wire drifts. */
  queue.messageFor = function (kind, job, row) {
    if (!KINDS[kind] || !job || !job.jobNumber) return null;
    row = row || {};
    var who = (FXC.state && FXC.state.role && FXC.state.role.name) || "FXC";
    var detail;
    if (kind === "reading") {
      var bits = [];
      if (row.area) bits.push(row.area);
      var spec = [];
      if (row.moisture != null && row.moisture !== "") spec.push(row.moisture + "%");
      if (row.temp != null && row.temp !== "") spec.push(row.temp + "C");
      if (row.RH != null && row.RH !== "") spec.push(row.RH + "%RH");
      detail = (bits.length ? bits.join(" ") + " " : "") + spec.join(" / ");
      if (!detail) detail = row.date || today();
    } else if (kind === "product") {
      detail = ((row.product || "") + (row.qty != null && row.qty !== "" ? " — " + row.qty : "")).trim() || "row";
    } else {
      detail = String(row.text || "").trim();
      if (!detail) return null; // appendNote refuses empty notes — so do we
      if (detail.length > 50) detail = detail.slice(0, 47) + "...";
    }
    return "[" + who + "] " + kind + " " + job.jobNumber + " — " + detail;
  };

  queue.remove = function (id) {
    var entries = load();
    var kept = entries.filter(function (e) { return e.id !== id; });
    if (kept.length === entries.length) return false;
    persist(kept);
    notify();
    return true;
  };

  queue.clear = function () {
    try { root.localStorage.removeItem(KEY); } catch (e) {}
    notify();
  };

  /* ============================================================
     FLUSH ENGINE — serial FIFO replay of the queue as individual,
     capture-stamped git commits. Deliberately bypasses edit.commit
     (drawer-centric, needs a live job object, swallows error types);
     the small writeOnce-shaped duplication below is intentional —
     do not refactor into a shared helper.
     ============================================================ */

  var LOCK_KEY = "fxc.queue.lock";
  var LOCK_STALE_MS = 45000;

  /* multi-tab double-flush guard: a fresh lock in another tab wins;
     a stale one (tab killed mid-flush) is stolen. */
  function takeLock() {
    try {
      var raw = root.localStorage.getItem(LOCK_KEY);
      if (raw) {
        var t = Number((JSON.parse(raw) || {}).t);
        if (isFinite(t) && Date.now() - t < LOCK_STALE_MS) return false;
      }
      root.localStorage.setItem(LOCK_KEY, JSON.stringify({ t: Date.now() }));
      return true;
    } catch (e) { return true; } // storage broken → single-tab reality, proceed
  }
  function releaseLock() {
    try { root.localStorage.removeItem(LOCK_KEY); } catch (e) {}
  }

  var TRANSFORMS = {
    reading: function (job, row) { return dataMod().appendReading(job, row); },
    product: function (job, row) { return dataMod().appendProduct(job, row); },
    note: function (job, row) { return dataMod().appendNote(job, row.text); }
  };

  /* Re-run the pure transform AS THE CAPTURE MOMENT: role + TODAY are
     swapped to the stored stamps for the duration of the (synchronous)
     transform, then restored. Notes embed role+date in the bullet line
     itself and readings' updated-bump should not drift to the flush day —
     the stored message/author alone can't fix text the transform builds.
     (Same save/restore pattern as app-glue's demoActiveJob.) */
  function runAsCaptured(entry, job) {
    var prevRole = FXC.state.role;
    var hadToday = Object.prototype.hasOwnProperty.call(root, "TODAY");
    var prevToday = root.TODAY;
    FXC.state.role = { name: entry.author.name, scope: (prevRole && prevRole.scope) || "field" };
    root.TODAY = entry.capturedAt;
    try { return TRANSFORMS[entry.kind](job, entry.row); }
    finally {
      FXC.state.role = prevRole;
      if (hadToday) root.TODAY = prevToday; else delete root.TODAY;
    }
  }

  /* moved-while-queued (a phase advance on another device relocated the
     .md): ONE git-tree GET, re-find by job number — filenames start with
     it. Never data.getCached (same stale snapshot that produced the 404)
     and never a full listJobs (N+1 reads per entry). */
  function relocate(entry) {
    var cfg = dataMod()._cfg;
    var url = "https://api.github.com/repos/" + encodeURIComponent(cfg.owner) +
      "/" + encodeURIComponent(cfg.repo) + "/git/trees/" + encodeURIComponent(cfg.branch) + "?recursive=1";
    var headers = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (cfg.token) headers["Authorization"] = "Bearer " + cfg.token;
    return fetch(url, { headers: headers })
      .then(function (res) {
        if (!res.ok) { var err = new Error("queue relocate tree " + res.status); err.status = res.status; throw err; }
        return res.json();
      })
      .then(function (tree) {
        var re = new RegExp("^10-jobs/[^/]+/" + entry.jobNum + "[^/]*\\.md$", "i");
        var hit = (tree.tree || []).filter(function (n) { return n.type === "blob" && re.test(n.path); })[0];
        return hit ? hit.path : null;
      });
  }

  function updateEntryPath(id, path) {
    var entries = load();
    entries.forEach(function (e) { if (e.id === id) e.jobPath = path; });
    persist(entries);
  }

  function readEntryJob(entry) {
    var d = dataMod();
    // a pathless entry (offline-boot snapshot capture) locates by number first
    var read = entry.jobPath
      ? d.readJob(entry.jobPath)
      : Promise.reject(Object.assign(new Error("queued without a path"), { status: 404 }));
    return read["catch"](function (e) {
      if (!e || e.status !== 404) throw e;
      return relocate(entry).then(function (path) {
        if (!path) {
          var err = new Error("job #" + entry.jobNum + " not found anywhere in the vault");
          err.status = 404;
          throw err;
        }
        updateEntryPath(entry.id, path); // a later failure retries the corrected path
        entry.jobPath = path;
        return d.readJob(path);
      });
    });
  }

  /* one entry = one commit: refetch → flush-time role re-check →
     re-run transform → PUT with the STORED message/author; single 409
     refetch-re-run-retry mirroring edit.js writeOnce. */
  function flushOne(entry) {
    var d = dataMod();
    return readEntryJob(entry)
      .then(function (job) {
        var a = auth();
        if (a && a.canEdit && !a.canEdit(job, entry.kind)) {
          return {
            ok: false, blocked: true,
            error: "a queued save for #" + entry.jobNum + " is blocked — the job left this role's edit scope. Show this phone to Brad or Dan."
          };
        }
        var res = runAsCaptured(entry, job);
        return d.writeJob(job._meta.path, res.newText, job._meta.sha, entry.message, { author: entry.author })
          .then(function () { return { ok: true, newText: res.newText, path: job._meta.path }; })
          ["catch"](function (e) {
            if (e && e.status === 409) {
              return d.readJob(job._meta.path).then(function (fresh) {
                var res2 = runAsCaptured(entry, fresh);
                return d.writeJob(fresh._meta.path, res2.newText, fresh._meta.sha, entry.message, { author: entry.author })
                  .then(function () { return { ok: true, newText: res2.newText, path: fresh._meta.path }; });
              });
            }
            throw e;
          });
      })
      ["catch"](function (e) {
        if (e && (e.status === 401 || e.status === 403)) {
          return { ok: false, authError: true, error: "GitHub refused the sync (" + e.status + ") — a token problem, not signal. Reconnect this device." };
        }
        if (e && e.status) {
          return { ok: false, error: "sync failed (" + e.status + " on #" + entry.jobNum + ") — your saves are still queued." };
        }
        return { ok: false, network: true, error: "still no signal — your saves are kept queued." };
      });
  }

  /* flush() -> Promise<{synced, remaining, error, authError?, blocked?, locked?}>
     Strict FIFO, serialized (concurrent calls chain, never interleave).
     Any failure stops at the FIFO head — the entry is retained and the
     whole queue waits for the next trigger. Never rejects. */
  var _flushChain = Promise.resolve();
  queue.flush = function () {
    var run = _flushChain.then(function () { return doFlush(); });
    _flushChain = run["catch"](function () {}); // a defect must not wedge the chain
    return run;
  };

  function doFlush() {
    if (!load().length) return Promise.resolve({ synced: 0, remaining: 0, error: null });
    if (!takeLock()) {
      return Promise.resolve({ synced: 0, remaining: load().length, error: "sync is already running in another tab.", locked: true });
    }
    var synced = 0;
    function step() {
      var entries = load(); // reload each step — captures added mid-flush ride along
      if (!entries.length) return Promise.resolve({ synced: synced, remaining: 0, error: null });
      var entry = entries[0];
      return flushOne(entry).then(function (r) {
        if (r.ok) {
          queue.remove(entry.id);
          synced++;
          // let the app repaint the job the commit just changed
          try {
            if (FXC.app && FXC.app.replaceJob && dataMod().parseJobMarkdown) {
              FXC.app.replaceJob(dataMod().parseJobMarkdown(r.newText, r.path, null));
            }
          } catch (e) {}
          return step();
        }
        return {
          synced: synced, remaining: load().length, error: r.error,
          authError: !!r.authError, blocked: !!r.blocked, network: !!r.network
        };
      });
    }
    return step().then(
      function (r) { releaseLock(); notify(); return r; },
      function (e) {
        releaseLock(); notify();
        return { synced: synced, remaining: load().length, error: (e && e.message) || "sync failed." };
      }
    );
  }

  /* CommonJS export guard for node unit tests (same pattern as data.js) */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = queue;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
