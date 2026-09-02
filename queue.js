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

  /* day-close intake entries carry the FULL rendered file — content was
     determined at capture, so flush replays it verbatim (no refetch, no
     transform re-run; see data.writeIntake's 422 = already-landed rule). */
  var INTAKE_PATH_RE = /^proposals\/from-field\/day-close\/[A-Za-z0-9._-]+\.md$/;

  function validEntry(e) {
    if (e && e.kind === "dayclose") {
      return !!(typeof e.id === "string" && e.id &&
        typeof e.path === "string" && INTAKE_PATH_RE.test(e.path) &&
        typeof e.content === "string" && e.content &&
        typeof e.message === "string" && e.message &&
        e.author && typeof e.author.name === "string" && e.author.name &&
        typeof e.capturedAt === "string" && e.capturedAt);
    }
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

  /* addIntake({path, content, message, jobNum, intakeKind}) -> entry | null
     The day-close lane: stores the rendered intake file for verbatim replay.
     intakeKind "day-close-money" rides along so writeIntake's full-scope
     guard re-fires at FLUSH time (whoever holds the phone then), mirroring
     flushOne's canEdit re-check on job writes. */
  queue.addIntake = function (spec) {
    spec = spec || {};
    if (typeof spec.path !== "string" || !INTAKE_PATH_RE.test(spec.path)) return null;
    if (typeof spec.content !== "string" || !spec.content) return null;
    if (typeof spec.message !== "string" || !spec.message) return null;

    var a = auth();
    var author = (a && a.commitAuthor) ? a.commitAuthor()
      : { name: (FXC.state && FXC.state.role && FXC.state.role.name) || "Field", email: "field@fxcoating.ca" };

    var entry = {
      id: "q" + Date.now() + "-" + (++seq),
      kind: "dayclose",
      path: spec.path,
      content: spec.content,
      message: String(spec.message),
      author: { name: author.name, email: author.email || "field@fxcoating.ca" },
      jobNum: String(spec.jobNum || ""),
      intakeKind: spec.intakeKind === "day-close-money" ? "day-close-money" : "day-close",
      capturedAt: today()
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
  /* this tab's lock identity — ownership is verified before every renewal,
     step, and release, so a tab whose lock was legitimately stolen (it was
     backgrounded past LOCK_STALE_MS) ABORTS instead of re-stamping or
     deleting the thief's live lock and double-flushing the same entries. */
  var LOCK_OWNER = "tab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  /* multi-tab double-flush guard: a fresh lock in another tab wins;
     a stale one (tab killed or frozen mid-flush) is stolen. */
  function takeLock() {
    try {
      var raw = root.localStorage.getItem(LOCK_KEY);
      if (raw) {
        var cur = JSON.parse(raw) || {};
        if (cur.owner !== LOCK_OWNER) {
          var t = Number(cur.t);
          if (isFinite(t) && Date.now() - t < LOCK_STALE_MS) return false;
        }
      }
      root.localStorage.setItem(LOCK_KEY, JSON.stringify({ t: Date.now(), owner: LOCK_OWNER }));
      return true;
    } catch (e) { return true; } // storage broken → single-tab reality, proceed
  }
  function ownsLock() {
    var raw;
    try { raw = root.localStorage.getItem(LOCK_KEY); } catch (e) { return true; } // storage broken → single-tab reality
    if (!raw) return false;
    try { return (JSON.parse(raw) || {}).owner === LOCK_OWNER; } catch (e) { return false; }
  }
  /* heartbeat: a long flush over a slow connection easily outruns
     LOCK_STALE_MS — re-stamp (while still the owner) so another tab can't
     judge a LIVE flush stale, steal the lock, and replay the same FIFO head
     into duplicate committed rows. Returns false when the lock was lost. */
  function renewLock() {
    if (!ownsLock()) return false;
    try { root.localStorage.setItem(LOCK_KEY, JSON.stringify({ t: Date.now(), owner: LOCK_OWNER })); } catch (e) {}
    return true;
  }
  function releaseLock() {
    if (!ownsLock()) return; // never delete another tab's live lock
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
    /* day-close intake: verbatim PUT of the stored file — writeIntake maps a
       422 to {alreadyExists} (the earlier flush landed), so replay after a
       torn ack is idempotent, never a duplicate card. */
    if (entry.kind === "dayclose") {
      return d.writeIntake(entry.path, entry.content, entry.message, { author: entry.author, kind: entry.intakeKind })
        .then(function () { return { ok: true }; })
        ["catch"](function (e) {
          if (e && e.scopeError) {
            return { ok: false, blocked: true, error: "a queued closeout money strip is blocked — it syncs only with Brad or Dan signed in on this phone." };
          }
          if (e && (e.status === 401 || e.status === 403)) {
            return { ok: false, authError: true, error: "GitHub refused the sync (" + e.status + ") — a token problem, not signal. Reconnect this device." };
          }
          if (e && e.status) {
            return { ok: false, error: "sync failed (" + e.status + " on #" + (entry.jobNum || "?") + ") — your saves are still queued." };
          }
          return { ok: false, network: true, error: "still no signal — your saves are kept queued." };
        });
    }
    return readEntryJob(entry)
      .then(function (job) {
        var a = auth();
        function scopeBlocked() {
          return {
            ok: false, blocked: true,
            error: "a queued save for #" + entry.jobNum + " is blocked — the job left this role's edit scope. Show this phone to Brad or Dan."
          };
        }
        function transformBlocked(te) {
          /* a transform throw (e.g. the target section was renamed vault-side)
             is NOT a signal problem — saying "no signal" would wedge the queue
             behind this entry forever while the phone is fully online. */
          return {
            ok: false, blocked: true,
            error: "a queued save for #" + entry.jobNum + " can't be applied to the current job file — " +
              ((te && te.message) || "the record changed shape") + ". Show this phone to Brad or Dan."
          };
        }
        if (a && a.canEdit && !a.canEdit(job, entry.kind)) return scopeBlocked();
        var res;
        try { res = runAsCaptured(entry, job); }
        catch (te) { return transformBlocked(te); }
        return d.writeJob(job._meta.path, res.newText, job._meta.sha, entry.message, { author: entry.author })
          .then(function () { return { ok: true, newText: res.newText, path: job._meta.path }; })
          ["catch"](function (e) {
            if (e && e.status === 409) {
              return d.readJob(job._meta.path).then(function (fresh) {
                /* the same race the first-pass guard exists for can land AS a
                   409 — re-check scope on the FRESH job before re-running */
                if (a && a.canEdit && !a.canEdit(fresh, entry.kind)) return scopeBlocked();
                var res2;
                try { res2 = runAsCaptured(entry, fresh); }
                catch (te) { return transformBlocked(te); }
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
      if (!renewLock()) {
        // the lock was stolen while this tab was frozen — the thief owns the
        // queue now; continuing would replay entries it may already have landed
        return Promise.resolve({ synced: synced, remaining: load().length, error: "sync was taken over by another tab.", locked: true });
      }
      var entries = load(); // reload each step — captures added mid-flush ride along
      if (!entries.length) return Promise.resolve({ synced: synced, remaining: 0, error: null });
      var entry = entries[0];
      return flushOne(entry).then(function (r) {
        if (r.ok) {
          if (!queue.remove(entry.id)) {
            // another flusher already handled (and removed) this entry — stop
            // instead of marching into entries it may be mid-way through
            return { synced: synced, remaining: load().length, error: "another tab already synced this entry.", locked: true };
          }
          synced++;
          // let the app repaint the job the commit just changed (day-close
          // intake entries change no job file — nothing to repaint)
          try {
            if (r.newText && FXC.app && FXC.app.replaceJob && dataMod().parseJobMarkdown) {
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
    /* mid-entry heartbeat: one slow fetch inside flushOne can alone outrun
       LOCK_STALE_MS — keep the lock alive on a timer while this tab is
       actually running (a frozen/backgrounded tab's timer stops too, which
       is correct: a frozen tab SHOULD lose the lock). */
    var hb = null;
    try { hb = setInterval(renewLock, 15000); if (hb && hb.unref) hb.unref(); } catch (e) {}
    function finish(r) {
      if (hb) { try { clearInterval(hb); } catch (e) {} }
      releaseLock(); notify(); return r;
    }
    return step().then(
      finish,
      function (e) {
        return finish({ synced: synced, remaining: load().length, error: (e && e.message) || "sync failed." });
      }
    );
  }

  /* CommonJS export guard for node unit tests (same pattern as data.js) */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = queue;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
