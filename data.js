/* ============================================================
   FXC Field — data.js
   GitHub I/O + lossless markdown engine + fxc-pm -> v1 job mapping.
   Owns window.FXC.data. NO UI code.

   PUBLIC API (per the interface contract):
     FXC.data.configure({owner, repo, branch, token})
     FXC.data.listJobs() -> Promise<Job[]>
     FXC.data.readJob(path) -> Promise<Job>
     FXC.data.parseJobMarkdown(text, path)  (alias: parseJob)
     FXC.data.serialize(job) -> string
     FXC.data.mapToJobObject(fm, bodyLines, path, sha) -> Job
     FXC.data.writeJob(path, newText, sha, message, {move}) -> Promise<{sha}>
     FXC.data.toggleGate(job, absLine) -> {newText, message}
     FXC.data.setStatus(job, toStatus) -> {newText, message, move?}
     FXC.data.appendReading(job, row) -> {newText, message}
     FXC.data.appendProduct(job, row) -> {newText, message}     (alias: appendProductUsage)
     FXC.data.appendNote(job, text) -> {newText, message}
     FXC.data.setField(job, key, value) -> {newText, message}
     FXC.data.snapshot() / FXC.data.loadSnapshot()

   Every {newText,...} producer bumps frontmatter "updated:" to TODAY and
   builds a role-stamped commit message. The active role is read from
   FXC.state.role.name (falls back to "FXC").

   Encoding: b64ToUtf8 / utf8ToB64 are UTF-8 safe (TextEncoder/TextDecoder),
   never bare atob/btoa, so the ° symbol and accented chars survive.
   ============================================================ */
(function (root) {
  "use strict";

  /* ---- namespace ---- */
  var FXC = (root.FXC = root.FXC || {});
  FXC.state = FXC.state || { mode: "demo", role: null };
  var data = (FXC.data = FXC.data || {});

  /* ============================================================
     CONFIG / SMALL UTILS
     ============================================================ */

  var _cfg = { owner: "", repo: "", branch: "main", token: "" };

  data.configure = function (cfg) {
    cfg = cfg || {};
    if (cfg.owner != null) _cfg.owner = cfg.owner;
    if (cfg.repo != null) _cfg.repo = cfg.repo;
    if (cfg.branch != null) _cfg.branch = cfg.branch;
    if (cfg.token != null) _cfg.token = cfg.token;
  };

  /* today's date, YYYY-MM-DD. Prefer the v1 TODAY constant if present so the
     whole app shares one "now" (snapshot reproducibility). */
  function today() {
    if (typeof root.TODAY === "string" && /^\d{4}-\d{2}-\d{2}$/.test(root.TODAY)) {
      return root.TODAY;
    }
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }
  data._today = today; // exposed for tests

  function role() {
    var r = FXC.state && FXC.state.role;
    return (r && r.name) ? r.name : "FXC";
  }

  /* UTF-8-safe base64 (MUST use these, never bare atob/btoa) */
  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    var clean = String(b64).replace(/\s+/g, "");
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }
  data._utf8ToB64 = utf8ToB64;
  data._b64ToUtf8 = b64ToUtf8;

  function stripWiki(s) {
    if (s == null) return "";
    return String(s).replace(/^\s*["']?\s*\[\[\s*/, "").replace(/\s*\]\]\s*["']?\s*$/, "").trim();
  }

  /* unwrap a single layer of surrounding quotes from a scalar frontmatter value */
  function unquote(s) {
    if (s == null) return "";
    var v = String(s).trim();
    if (v.length >= 2) {
      var a = v[0], b = v[v.length - 1];
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
        return v.slice(1, -1);
      }
    }
    return v;
  }

  function toNum(s) {
    if (s == null || s === "") return null;
    var n = Number(String(s).replace(/[$,]/g, "").trim());
    return isFinite(n) ? n : null;
  }

  /* a "blank-ish" frontmatter value: empty, [], false, null */
  function fmStr(v) {
    if (v == null) return "";
    var s = unquote(v);
    if (s === "" || s === "[]" || s === "null") return "";
    return s;
  }
  function isFalseOrBlank(v) {
    var s = fmStr(v);
    return s === "" || s === "false";
  }

  /* ============================================================
     STATUS <-> PHASE <-> BUCKET <-> STAGE
     ============================================================ */

  var PHASE_STATUSES = {
    "1-planning": ["won", "package-building", "scope-locked", "scheduled", "cleared-to-deploy"],
    "2-active": ["deployed", "prepping", "applying", "destaging", "walkthrough-done"],
    "3-closeout": ["invoicing", "pja-pending", "warranty-issued"],
    "4-archive": ["closed", "cancelled"]
  };
  var STATUS_PHASE = {};
  Object.keys(PHASE_STATUSES).forEach(function (ph) {
    PHASE_STATUSES[ph].forEach(function (st) { STATUS_PHASE[st] = ph; });
  });

  function phaseOf(status) { return STATUS_PHASE[status] || "1-planning"; }
  data.phaseOf = phaseOf;

  var STATUS_BUCKET = {
    "won": "upcoming", "package-building": "upcoming", "scope-locked": "upcoming",
    "scheduled": "upcoming", "cleared-to-deploy": "upcoming",
    "deployed": "active", "prepping": "active", "applying": "active",
    "destaging": "active", "walkthrough-done": "active",
    "invoicing": "closeout", "pja-pending": "closeout", "warranty-issued": "closeout",
    "closed": "closed", "cancelled": "closed"
  };

  var STAGE_LABELS = {
    "won": "Won", "package-building": "Package Building", "scope-locked": "Scope Locked",
    "scheduled": "Scheduled", "cleared-to-deploy": "Cleared to Deploy",
    "deployed": "Deployed", "prepping": "Prepping", "applying": "Applying",
    "destaging": "De-staging", "walkthrough-done": "Walkthrough Done",
    "invoicing": "Invoicing", "pja-pending": "PJA Pending", "warranty-issued": "Warranty Issued",
    "closed": "Closed", "cancelled": "Cancelled"
  };

  /* status -> status transitions, each gated by a named gate.
     toStatus : { from, gateMatch:RegExp } — gateMatch tests gate.name. */
  var TRANSITIONS = {
    "package-building": { from: "won", gate: /contract\s*binding|^gate\s*1\b/i },
    "scope-locked": { from: "package-building", gate: /package\s*ready|^gate\s*2\b/i },
    "scheduled": { from: "scope-locked", gate: /scope\s*locked|^gate\s*3\b/i },
    "cleared-to-deploy": { from: "scheduled", gate: /scheduling/i },
    // mobilization day — no checklist gates entry into deployed (never-match regex
    // = setStatus's tolerant path); without this link, cleared-to-deploy was a dead end
    "deployed": { from: "cleared-to-deploy", gate: /(?!)/ },
    "prepping": { from: "deployed", gate: /cleared\s*to\s*prep/i },
    "applying": { from: "prepping", gate: /cleared\s*to\s*apply/i },
    "destaging": { from: "applying", gate: /cleared\s*to\s*de-?stage/i },
    // destaging -> walkthrough-done and walkthrough-done -> invoicing are MANUAL flips in the
    // new structure (Gate 4 + Final Walkthrough removed). Old-format jobs still carry those gates,
    // so keep matching them; new-format jobs have no such gate -> setStatus's tolerant path allows
    // the manual advance. Both dialects work.
    "walkthrough-done": { from: "destaging", gate: /cleared\s*for\s*walkthrough/i },
    "invoicing": { from: "walkthrough-done", gate: /final\s*walkthrough/i },
    // closeout gate names differ by dialect — match BOTH (old: Administrative Complete / Financial
    // Picture Complete; new: Invoice Out / PJA + Warranty). Additive: adding alternatives can only
    // match more, and old gate names never contain the new tokens, so old-format advance is unchanged.
    "pja-pending": { from: "invoicing", gate: /administrative\s*complete|invoice\s*out/i },
    "warranty-issued": { from: "pja-pending", gate: /financial\s*picture|pja\b.*warranty|closeout/i },
    "closed": { from: "warranty-issued", gate: /closeout/i }
  };

  function expandSegment(code) {
    var c = (code || "").toString().trim().toUpperCase();
    var map = {
      CO: "CO — Commercial",
      FP: "FP — Food & Beverage",
      GE: "GE — Grain Elevators",
      AG: "AG — Agricultural"
    };
    return map[c] || (c ? c : "");
  }

  function mapsFromAddress(addr) {
    if (!addr) return "";
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr);
  }

  /* ============================================================
     MARKDOWN PARSE
     ============================================================ */

  /* detect "\r\n" vs "\n"; default "\n" */
  function detectNewline(text) {
    return /\r\n/.test(text) ? "\r\n" : "\n";
  }

  /* Split into lines preserving content (no trailing newline tokens).
     We keep a flag for a trailing newline at EOF so serialize is byte-exact. */
  function splitLines(text, nl) {
    // normalize the split on nl; the source uses one consistent style by detection
    var hadTrailing = text.length > 0 && (text.slice(-nl.length) === nl);
    var body = hadTrailing ? text.slice(0, text.length - nl.length) : text;
    var lines = body.length === 0 && !hadTrailing ? [] : body.split(nl);
    return { lines: lines, trailingNewline: hadTrailing };
  }

  /* Parse frontmatter into ordered entries. Multi-line list values
     (e.g. crew:, sources:) keep their "  - " continuation lines verbatim,
     captured as part of that key's block but each is also its own rawLine. */
  function parseFrontmatter(rawLines) {
    var fmOrder = [];
    var fm = {};
    var fmEndIndex = -1; // index of the closing "---"
    var fmStartIndex = -1;

    if (rawLines.length === 0 || rawLines[0].trim() !== "---") {
      return { fmOrder: fmOrder, fm: fm, fmStartIndex: -1, fmEndIndex: -1 };
    }
    fmStartIndex = 0;

    var i = 1;
    var lastKeyEntry = null;
    for (; i < rawLines.length; i++) {
      var line = rawLines[i];
      if (line.trim() === "---") { fmEndIndex = i; break; }

      var listItem = line.match(/^\s+-\s?(.*)$/);
      if (listItem && lastKeyEntry) {
        // continuation list line belonging to the previous key
        lastKeyEntry.listLines.push({ lineIndex: i, rawLine: line, value: listItem[1] });
        continue;
      }

      var kv = line.match(/^([A-Za-z0-9_]+):\s?(.*)$/);
      if (kv) {
        var key = kv[1];
        var val = kv[2];
        var entry = {
          key: key,
          rawLine: line,
          value: val,
          lineIndex: i,
          listLines: []
        };
        fmOrder.push(entry);
        fm[key] = val;
        lastKeyEntry = entry;
      } else {
        // a comment or stray line inside frontmatter — keep order, no key
        fmOrder.push({ key: null, rawLine: line, value: null, lineIndex: i, listLines: [] });
        lastKeyEntry = null;
      }
    }
    return { fmOrder: fmOrder, fm: fm, fmStartIndex: fmStartIndex, fmEndIndex: fmEndIndex };
  }

  /* locate the line index of each "## Section" header we care about */
  function indexSections(rawLines, bodyStart) {
    var idx = { scope: -1, links: -1, materials: -1, schedule: -1, gates: -1, readings: -1, product: -1, notes: -1 };
    for (var i = bodyStart; i < rawLines.length; i++) {
      var t = rawLines[i].trim().toLowerCase();
      if (t.indexOf("## ") !== 0) continue;
      var h = t.slice(3).trim();
      if (h === "scope") idx.scope = i;
      else if (h === "links") idx.links = i;
      else if (h === "materials" || h.indexOf("material load list") === 0) idx.materials = i;
      else if (h.indexOf("schedule estimate") === 0) idx.schedule = i;
      else if (h.indexOf("gate checklist") === 0) idx.gates = i;
      else if (h.indexOf("readings") === 0) idx.readings = i;
      else if (h.indexOf("product usage") === 0) idx.product = i;
      else if (h === "notes") idx.notes = i;
    }
    return idx;
  }

  /* parse the "## Materials" section: free-text note lines + one markdown table
     (header row + data rows). Returns {notes, header[], rows[][]} or null. */
  function parseMaterials(rawLines, sectionIdx) {
    var r = sectionRange(rawLines, sectionIdx.materials);
    if (!r) return null;
    var notes = [], header = null, rows = [];
    for (var i = r.start + 1; i < r.end; i++) {
      var line = rawLines[i].trim();
      if (!line) continue;
      if (line.charAt(0) === "|") {
        var cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
        if (/^[-:\s]*$/.test(cells.join(""))) continue; /* separator row */
        if (!header) header = cells; else rows.push(cells);
      } else {
        notes.push(line);
      }
    }
    if (!header && !rows.length && !notes.length) return null;
    return { notes: notes.join(" "), header: header || [], rows: rows };
  }

  /* parse the "## Links" bullets → [{label, target, url}] — Sync paths render as
     text, http(s) targets as real links (PDS refs live here per Brad 06-12) */
  function parseLinks(rawLines, sectionIdx) {
    var r = sectionRange(rawLines, sectionIdx.links);
    if (!r) return [];
    var out = [];
    for (var i = r.start + 1; i < r.end; i++) {
      var m = rawLines[i].match(/^\s*-\s*([^:]+):\s*(.+)$/);
      if (!m) continue;
      var target = m[2].trim().replace(/^`/, "").replace(/`$/, "");
      out.push({ label: m[1].trim(), target: target, url: /^https?:\/\//i.test(target) });
    }
    return out;
  }

  /* parse a "## ..." markdown table → {header, rows} (rows may be empty — a
     section can start as a blank header awaiting field logs). The separator row
     (|---|---|) is skipped. Shared by the readings + product-usage sections. */
  function parseTableSection(rawLines, headerIdx) {
    var r = sectionRange(rawLines, headerIdx);
    if (!r) return null;
    var header = null, rows = [];
    for (var i = r.start + 1; i < r.end; i++) {
      var line = rawLines[i].trim();
      if (!line || line.charAt(0) !== "|") continue;
      var cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
      if (/^[-:\s]*$/.test(cells.join(""))) continue;
      if (!header) header = cells; else rows.push(cells);
    }
    if (!header) return null;
    return { header: header, rows: rows };
  }
  /* "## Readings / batch log" and "## Product usage (PJA capture)" tables. Both
     feed the worker card's Site Wire (readings by station tag, usage roll-up). */
  function parseReadings(rawLines, sectionIdx) { return parseTableSection(rawLines, sectionIdx.readings); }
  function parseUsage(rawLines, sectionIdx) { return parseTableSection(rawLines, sectionIdx.product); }

  /* return [start, end) line range of a "## " section starting at headerIdx,
     ending just before the next "## " header (or EOF). headerIdx excluded? we
     include the header at [headerIdx]; the content is (headerIdx, end). */
  function sectionRange(rawLines, headerIdx) {
    if (headerIdx < 0) return null;
    var end = rawLines.length;
    for (var i = headerIdx + 1; i < rawLines.length; i++) {
      if (/^##\s/.test(rawLines[i])) { end = i; break; }
    }
    return { start: headerIdx, end: end };
  }

  /* ---- GATE PARSER (tolerant — parses BOTH dialects) ----
     phase opener:  "### PLANNING" | "### ACTIVE" | "### CLOSEOUT"
     gate header:   a bold line ("**...**") whose text matches the gate vocab,
                    optional leading ⚡, separator em-dash OR colon, optional
                    statusTarget after an arrow (→ or ->) w/ or w/o backticks.
     checkbox:      /^(\s*)-\s\[( |x|X)\]\s?(.*)$/
  */
  var CHECKBOX_RE = /^(\s*)-\s\[( |x|X)\]\s?(.*)$/;
  var GATE_VOCAB = /Gate|Scheduling|Final\s*Walkthrough|Closeout|Cleared|Administrative|Financial/i;

  function isPhaseOpener(line) {
    var t = line.trim();
    if (t === "### PLANNING") return "Planning";
    if (t === "### ACTIVE") return "Active";
    if (t === "### CLOSEOUT") return "Closeout";
    return null;
  }

  /* extract {gateName, statusTarget} from a bold header line, tolerant */
  function parseGateHeader(line) {
    var t = line.trim();
    if (t.indexOf("**") !== 0) return null;
    // pull the bold-wrapped text + any trailing target
    var m = t.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (!m) return null;
    var inner = m[1].trim();
    var trailer = (m[2] || "").trim();

    if (!GATE_VOCAB.test(inner) && !GATE_VOCAB.test(t)) return null;

    // strip a leading ⚡ (with optional following space)
    inner = inner.replace(/^[⚡⚡]\s*/, "").trim();

    // gate name + status target may both live INSIDE the bold, or the target may
    // be in the trailer. Look for an arrow first inside, then trailer.
    var statusTarget = "";
    var name = inner;

    // arrow inside the bold-wrapped text
    var arrowIn = inner.split(/\s*(?:→|->)\s*/);
    if (arrowIn.length > 1) {
      name = arrowIn[0].trim();
      statusTarget = arrowIn[arrowIn.length - 1];
    } else if (trailer) {
      // trailer like "→ `package-building`" or "-> package-building" or "→ warranty-issued → closed"
      var tr = trailer.replace(/^[:\s]*(?:→|->)?\s*/, "");
      statusTarget = tr;
    }
    statusTarget = (statusTarget || "").replace(/[`]/g, "").trim();
    // for chained targets ("warranty-issued -> closed") keep the first token
    if (/\s/.test(statusTarget)) {
      statusTarget = statusTarget.split(/\s*(?:→|->)\s*/)[0].trim();
    }
    statusTarget = statusTarget.split(/\s+/)[0] || "";

    // normalize the display name: drop a trailing em-dash/colon separator noise
    name = name.replace(/[—:\-]\s*$/, "").trim();

    return { name: name, statusTarget: statusTarget };
  }

  /* Parse the whole "## Gate checklists" section into:
       gateIndex: [{phase, gateName, statusTarget, boxes:[{absLine,checked,text}]}]
     and the v1 gates[] aggregate [{name:"Planning",items:[{name,done,total}]}].
     Robust to BOTH the template and the real-2813 dialect, and to the stray
     "- [x] Owner names: N/A" line under Closeout (gate stays done:1,total:3). */
  function parseGates(rawLines, gatesHeaderIdx) {
    var gateIndex = [];
    var phases = { Planning: [], Active: [], Closeout: [] };
    var phaseOrder = ["Planning", "Active", "Closeout"];

    if (gatesHeaderIdx < 0) {
      return { gateIndex: gateIndex, gates: phaseOrder.map(function (n) { return { name: n, items: [] }; }) };
    }
    var range = sectionRange(rawLines, gatesHeaderIdx);
    var end = range.end;

    var curPhase = null;
    var curGate = null;

    function pushGate(g) {
      if (!g) return;
      gateIndex.push(g);
      var ph = g.phase || "Planning";
      var done = 0;
      for (var b = 0; b < g.boxes.length; b++) if (g.boxes[b].checked) done++;
      (phases[ph] || phases.Planning).push({
        name: g.gateName, done: done, total: g.boxes.length, statusTarget: g.statusTarget,
        ref: g
      });
    }

    for (var i = gatesHeaderIdx + 1; i < end; i++) {
      var line = rawLines[i];

      var ph = isPhaseOpener(line);
      if (ph) {
        pushGate(curGate); curGate = null;
        curPhase = ph;
        continue;
      }

      var gh = parseGateHeader(line);
      if (gh) {
        pushGate(curGate);
        curGate = {
          phase: curPhase || "Planning",
          gateName: gh.name,
          statusTarget: gh.statusTarget,
          headerLine: i,
          boxes: []
        };
        continue;
      }

      var cb = line.match(CHECKBOX_RE);
      if (cb && curGate) {
        curGate.boxes.push({
          absLine: i,
          checked: (cb[2] === "x" || cb[2] === "X"),
          text: cb[3]
        });
      }
      // any other line (blank, prose) is ignored for gate purposes
    }
    pushGate(curGate);

    var gates = phaseOrder.map(function (n) {
      return {
        name: n,
        items: phases[n].map(function (g) {
          return { name: g.name, done: g.done, total: g.total };
        })
      };
    });

    return { gateIndex: gateIndex, gates: gates };
  }

  /* ---- best-effort body parsers (never throw; fall back to defaults) ---- */

  function getSectionText(rawLines, headerIdx) {
    var r = sectionRange(rawLines, headerIdx);
    if (!r) return "";
    var out = [];
    for (var i = r.start + 1; i < r.end; i++) out.push(rawLines[i]);
    // trim leading/trailing blank lines
    while (out.length && out[0].trim() === "") out.shift();
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    return out.join("\n").trim();
  }

  function parseScope(rawLines, idx) {
    try { return getSectionText(rawLines, idx.scope); } catch (e) { return ""; }
  }

  /* buildup <- "Buildup (products by layer):" bullets within Scope.
     bullet form: "- Primer / grout: Series 288 ..., DFT 6.0 mils" */
  function parseBuildup(scopeText) {
    var out = [];
    if (!scopeText) return out;
    var lines = scopeText.split("\n");
    var collecting = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (/buildup\s*\(products by layer\)\s*:/i.test(t)) { collecting = true; continue; }
      if (collecting) {
        var bullet = t.match(/^-\s+(.*)$/);
        if (!bullet) {
          if (t === "") continue;     // tolerate blank line within the list
          break;                      // a non-bullet, non-blank ends the list
        }
        var body = bullet[1];
        var layer = body, product = body, dft = "—";
        var colon = body.indexOf(":");
        if (colon > -1) {
          layer = body.slice(0, colon).trim();
          product = body.slice(colon + 1).trim();
        }
        // pull a trailing DFT clause "..., DFT 6.0 mils"
        var dftM = product.match(/,?\s*DFT\s+([\d.]+)\s*mils?/i);
        if (dftM) {
          dft = dftM[1] + " mil";
          product = product.replace(/,?\s*DFT\s+[\d.]+\s*mils?/i, "").trim();
        }
        out.push({ layer: layer, product: product, dft: dft });
      }
    }
    return out;
  }

  /* conditions <- "Conditions:" paragraph within Scope */
  function parseConditions(scopeText) {
    if (!scopeText) return "";
    var lines = scopeText.split("\n");
    var buf = [];
    var collecting = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var t = raw.trim();
      var m = t.match(/^Conditions\s*:\s*(.*)$/i);
      if (m) { collecting = true; if (m[1]) buf.push(m[1]); continue; }
      if (collecting) {
        if (t === "") break;                 // blank line ends the paragraph
        if (/^[A-Z][A-Za-z ]+:\s/.test(t)) break; // a new labelled paragraph
        buf.push(t);
      }
    }
    return buf.join(" ").trim();
  }

  /* watchouts <- "## Notes" "PM watch-outs:" sub-points (split on "; ") */
  function parseWatchouts(rawLines, idx) {
    var out = [];
    try {
      var notes = getSectionText(rawLines, idx.notes);
      if (!notes) return out;
      var lines = notes.split("\n");
      var buf = [];
      var collecting = false;
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        var m = t.match(/PM watch-?outs\s*:\s*(.*)$/i);
        if (m) { collecting = true; if (m[1]) buf.push(m[1]); continue; }
        if (collecting) {
          if (/^-\s/.test(t)) break;          // next bullet ends this one
          if (t === "") continue;
          buf.push(t);
        }
      }
      var blob = buf.join(" ").trim();
      if (blob) {
        blob.split(/;\s+/).forEach(function (s) {
          s = s.replace(/\.$/, "").trim();
          if (s) out.push(s.charAt(0).toUpperCase() + s.slice(1));
        });
      }
    } catch (e) { /* fall through to [] */ }
    return out;
  }

  /* ============================================================
     MAP TO V1 JOB OBJECT
     ============================================================ */

  /* parse "Name / phone / email" -> {name,phone,email} all strings */
  function parseContact(raw) {
    var c = { name: "", phone: "", email: "" };
    var v = fmStr(raw);
    if (!v) return c;
    var parts = v.split(" / ");
    c.name = (parts[0] || "").trim();
    c.phone = (parts[1] || "").trim();
    c.email = (parts[2] || "").trim();
    return c;
  }

  /* maps: prefer "## Links" "Maps:" line; else derive from address */
  function findMapsLink(rawLines, idx, address) {
    if (idx.links > -1) {
      var r = sectionRange(rawLines, idx.links);
      for (var i = r.start + 1; i < r.end; i++) {
        var m = rawLines[i].match(/Maps\s*:\s*(\S+)/i);
        if (m) return m[1].trim();
      }
    }
    return mapsFromAddress(address);
  }

  /* Build the v1-shape Job. fm = key->rawValue map. */
  data.mapToJobObject = function (fm, rawLines, path, sha, parsedExtra) {
    parsedExtra = parsedExtra || {};
    var get = function (k) { return fm[k]; };

    var status = fmStr(get("status")) || "won";
    var on_hold = (function () {
      var s = fmStr(get("on_hold"));
      return s === "true";
    })();

    var bucketBase = STATUS_BUCKET[status] || "upcoming";
    var bucket = on_hold ? "onhold" : bucketBase;

    var jobNumber = fmStr(get("job_number"));
    var address = fmStr(get("address"));
    var sqftNum = toNum(get("sqft"));

    var idxSections = parsedExtra.sectionLineIndex || {};
    var scopeText = parsedExtra.scopeText || "";

    var contact = parseContact(get("contact"));
    var maps = parsedExtra.maps || mapsFromAddress(address);

    var crewVal = parsedExtra.crew != null ? parsedExtra.crew : [];

    var job = {
      id: String(jobNumber || (path || "")),
      jobNumber: String(jobNumber),
      title: fmStr(get("title")),
      subtitle: "",
      status: status,
      phase: phaseOf(status),
      bucket: bucket,
      stage: STAGE_LABELS[status] || status,
      rich: true,
      source: "fxc-pm",
      customer: stripWiki(get("customer")),
      contact: contact,
      address: address,
      maps: maps,
      segment: expandSegment(get("segment")),
      system: stripWiki(get("coating_system")),
      systemDesc: "",
      sqft: sqftNum == null ? 0 : sqftNum,
      prep: fmStr(get("prep")),
      dates: {
        won: fmStr(get("date_won")) || null,
        requested: fmStr(get("client_requested")) || null,
        start: fmStr(get("start_date")) || null,
        end: fmStr(get("end_date")) || null,
        deadline: fmStr(get("deadline")) || null
      },
      money: {
        quote: toNum(get("quote_value")),
        deposit: toNum(get("deposit_amount")),
        depositDate: (function () { var s = fmStr(get("deposit_received")); return s && s !== "false" ? s : null; })(),
        invoiced: (function () { var s = fmStr(get("invoiced")); return !!(s && s !== "false"); })()
      },
      scope: scopeText,
      on_hold: on_hold,
      crew: crewVal,
      gates: parsedExtra.gates || [
        { name: "Planning", items: [] }, { name: "Active", items: [] }, { name: "Closeout", items: [] }
      ],

      materials: parsedExtra.materials || null,
      schedule: parsedExtra.schedule || null,
      readings: parsedExtra.readings || null,
      usage: parsedExtra.usage || null,
      linksList: parsedExtra.linksList || [],

      /* REQUIRED safe defaults so the UNGUARDED v1 richDetail never throws */
      buildup: parsedExtra.buildup || [],
      watchouts: parsedExtra.watchouts || [],
      conditions: parsedExtra.conditions || "",
      photos: parsedExtra.photos || 0,
      photosNote: parsedExtra.photosNote || "",
      quoteDoc: fmStr(get("quote_doc")),
      jobFolder: fmStr(get("job_folder")),
      /* optional planning-budget field (not yet in the vault schema — read
         gracefully so the worker card's plan strip populates once FXC-4 adds it) */
      expectedHours: (function () { var h = Number(fmStr(get("expected_hours"))); return h > 0 ? h : null; })()
    };

    return job;
  };

  /* ============================================================
     parseJobMarkdown — assemble Job + _meta from raw text
     PURE: no network.
     ============================================================ */
  data.parseJobMarkdown = function (text, path, sha) {
    var nl = detectNewline(text);
    var split = splitLines(text, nl);
    var rawLines = split.lines;

    var fmParsed = parseFrontmatter(rawLines);
    var fm = fmParsed.fm;
    var bodyStart = fmParsed.fmEndIndex >= 0 ? fmParsed.fmEndIndex + 1 : 0;

    var sectionIdx = indexSections(rawLines, bodyStart);

    // crew: capture list values verbatim from fmOrder if present
    var crew = [];
    fmParsed.fmOrder.forEach(function (e) {
      if (e.key === "crew") {
        if (e.listLines && e.listLines.length) {
          crew = e.listLines.map(function (l) { return unquote(l.value).trim(); }).filter(Boolean);
        } else {
          var inline = fmStr(e.value);
          if (inline && inline !== "[]") {
            crew = inline.replace(/^\[|\]$/g, "").split(",").map(function (s) { return unquote(s).trim(); }).filter(Boolean);
          }
        }
      }
    });

    var gatesParsed = parseGates(rawLines, sectionIdx.gates);
    var scopeText = parseScope(rawLines, sectionIdx);
    var buildup = parseBuildup(scopeText);
    var conditions = parseConditions(scopeText);
    var watchouts = parseWatchouts(rawLines, sectionIdx);
    var materials = parseMaterials(rawLines, sectionIdx);
    var schedule = parseTableSection(rawLines, sectionIdx.schedule); // ## Schedule estimate (day·task·crew·hours)
    var readings = parseReadings(rawLines, sectionIdx);
    var usage = parseUsage(rawLines, sectionIdx);
    var linksList = parseLinks(rawLines, sectionIdx);
    var maps = findMapsLink(rawLines, sectionIdx, fmStr(fm.address));
    var photos = fmStr(fm.site_photos) ? 0 : 0; // 0 unless explicitly countable; keep safe default

    var job = data.mapToJobObject(fm, rawLines, path, sha, {
      sectionLineIndex: sectionIdx,
      scopeText: scopeText,
      buildup: buildup,
      conditions: conditions,
      watchouts: watchouts,
      materials: materials,
      schedule: schedule,
      readings: readings,
      usage: usage,
      linksList: linksList,
      gates: gatesParsed.gates,
      maps: maps,
      photos: photos,
      crew: crew
    });

    // attach non-enumerable _meta
    var meta = {
      path: path || "",
      sha: sha || null,
      status: fmStr(fm.status) || "won",
      rawLines: rawLines,
      trailingNewline: split.trailingNewline,
      newline: nl,
      fmOrder: fmParsed.fmOrder,
      fmStartIndex: fmParsed.fmStartIndex,
      fmEndIndex: fmParsed.fmEndIndex,
      sectionLineIndex: {
        scope: sectionIdx.scope, gates: sectionIdx.gates,
        readings: sectionIdx.readings, product: sectionIdx.product, notes: sectionIdx.notes
      },
      gateIndex: gatesParsed.gateIndex
    };
    Object.defineProperty(job, "_meta", { value: meta, enumerable: false, writable: true, configurable: true });

    return job;
  };
  // alias
  data.parseJob = data.parseJobMarkdown;

  /* ============================================================
     SERIALIZE — rebuild file text from _meta.rawLines.
     Only mutated lines differ; join with the detected newline; preserve the
     trailing-newline state byte-for-byte (no-op serialize == original).
     ============================================================ */
  data.serialize = function (job) {
    var m = job._meta;
    if (!m) throw new Error("serialize: job has no _meta");
    var text = m.rawLines.join(m.newline);
    if (m.trailingNewline) text += m.newline;
    return text;
  };

  /* ---- internal helpers for the pure transforms ----
     Each transform clones rawLines, mutates exactly the target line(s),
     bumps frontmatter "updated:", and returns {rawLines, ...} so we can both
     produce newText AND keep an updated job for optimistic patching.
     We return only {newText, message, move?} per the contract; edit.js owns
     the optimistic re-parse via readJob/parseJobMarkdown on the new text. */

  function cloneLines(job) {
    return job._meta.rawLines.slice();
  }

  function joinLines(job, lines) {
    var nl = job._meta.newline;
    var text = lines.join(nl);
    if (job._meta.trailingNewline) text += nl;
    return text;
  }

  /* find the fmOrder entry for a key (first match) */
  function fmEntry(job, key) {
    var order = job._meta.fmOrder;
    for (var i = 0; i < order.length; i++) {
      if (order[i].key === key) return order[i];
    }
    return null;
  }

  /* set/replace a single frontmatter scalar line BY KEY, preserving the key +
     the "key: " spacing of the original line. Mutates `lines` in place.
     Returns true if the key existed and was rewritten. */
  function rewriteFmLine(lines, entry, newValue) {
    if (!entry) return false;
    var orig = lines[entry.lineIndex];
    // Split "  key:<spacing><value>" into indent, "key:", existing spacing, value.
    var m = orig.match(/^(\s*[A-Za-z0-9_]+:)(\s*)(.*)$/);
    var keyPart, gap;
    if (m) {
      keyPart = m[1];
      // Preserve the existing space convention when a value was already present
      // (keeps populated-field edits tidy). If the line was empty after the
      // colon, normalize to the vault's standard single space "key: value".
      gap = (m[3] !== "" && m[2] !== "") ? m[2] : " ";
    } else {
      keyPart = entry.key + ":";
      gap = " ";
    }
    // When clearing a field, emit just "key:" with no trailing space (matches the
    // template's blank-field convention) — except keep it consistent with YAML.
    if (newValue === "") {
      lines[entry.lineIndex] = keyPart;
    } else {
      lines[entry.lineIndex] = keyPart + gap + newValue;
    }
    return true;
  }

  /* bump (or no-op) the frontmatter "updated:" line to today */
  function bumpUpdated(job, lines) {
    var e = fmEntry(job, "updated");
    if (e) rewriteFmLine(lines, e, today());
  }

  /* ---- toggleGate(job, absLine) : flip [ ]<->[x] on ONE line only ---- */
  data.toggleGate = function (job, absLine) {
    var lines = cloneLines(job);
    var line = lines[absLine];
    var m = line && line.match(CHECKBOX_RE);
    if (!m) throw new Error("toggleGate: line " + absLine + " is not a checkbox");
    var wasChecked = (m[2] === "x" || m[2] === "X");
    var newChar = wasChecked ? " " : "x";
    // replace ONLY the token char between the brackets, preserve indent + text byte-for-byte
    lines[absLine] = line.replace(/^(\s*-\s\[)( |x|X)(\])/, "$1" + newChar + "$3");
    bumpUpdated(job, lines);

    // find which gate/item this box belongs to (for the commit detail)
    var detail = m[3] || "";
    var gateName = "";
    (job._meta.gateIndex || []).forEach(function (g) {
      g.boxes.forEach(function (b) { if (b.absLine === absLine) gateName = g.gateName; });
    });
    var action = wasChecked ? "uncheck" : "check";
    var msg = "[" + role() + "] " + action + " " + job.jobNumber + " — " +
      (gateName ? gateName + ": " : "") + detail.trim();

    return { newText: joinLines(job, lines), message: msg };
  };

  /* ---- setStatus(job, toStatus, opts) : rewrite status (+phase) by KEY;
          compute move if phase boundary crossed. Forward advance THROWS if the
          gating gate is not 100% checked.
          opts.back = a BACKWARD correction: skips the gate check, keeps gate
          state as-is, records opts.reason in the commit.
          opts.bulk = "check all & advance": instead of throwing on an
          incomplete gate, flips EVERY open box on the gating gate in this same
          commit and records it as a bulk-confirm (the audit trail shows the
          items were not verified one-by-one). ---- */
  data.setStatus = function (job, toStatus, opts) {
    opts = opts || {};
    /* the bulk gate-bypass is a full-scope override — enforce it in the
       engine too (not just canEdit at write time) so no UI path can hand a
       crew role a bulk advance. Demo sandbox exempt: nothing leaves the
       browser there. */
    if (opts.bulk) {
      var bulkMode = FXC.state && FXC.state.mode;
      var bulkScope = FXC.state && FXC.state.role && FXC.state.role.scope;
      if (bulkMode !== "demo" && bulkScope !== "full") {
        throw new Error("setStatus: bulk check-all is full scope (Brad/Dan) only — gates clear item-by-item");
      }
    }
    var fromStatus = fmStr(fmEntry(job, "status") ? fmEntry(job, "status").value : "") || "won";

    var trans = TRANSITIONS[toStatus];
    var matchG = null;
    // verify the gate (the gate that gates the move INTO toStatus) is 100% —
    // forward advances only; a backward correction is not gate-checked
    if (trans && !opts.back) {
      (job._meta.gateIndex || []).forEach(function (g) {
        if (trans.gate.test(g.gateName)) {
          // prefer the gate whose statusTarget matches toStatus when ambiguous
          if (!matchG || (g.statusTarget && g.statusTarget === toStatus)) matchG = g;
        }
      });
      if (matchG && !opts.bulk) {
        var total = matchG.boxes.length;
        var done = 0;
        matchG.boxes.forEach(function (b) { if (b.checked) done++; });
        if (total === 0 || done < total) {
          throw new Error("setStatus: gate \"" + matchG.gateName + "\" is not fully checked (" + done + "/" + total + ") — finish this gate first");
        }
      }
      // if no matching gate found we allow (tolerant); but still require known status
    }

    var lines = cloneLines(job);

    // bulk-confirm: flip every open box on the gating gate (same one-commit write)
    var bulkNote = "";
    if (opts.bulk && matchG) {
      var flipped = 0;
      matchG.boxes.forEach(function (b) {
        if (!b.checked) {
          lines[b.absLine] = lines[b.absLine].replace(/^(\s*-\s\[)( )(\])/, "$1x$3");
          flipped++;
        }
      });
      if (flipped) {
        bulkNote = " — \"" + matchG.gateName + "\": " + flipped + " item" + (flipped === 1 ? "" : "s") +
          " bulk-confirmed (not verified item-by-item)";
      }
    }

    var statusE = fmEntry(job, "status");
    if (!statusE) throw new Error("setStatus: no status frontmatter line");
    rewriteFmLine(lines, statusE, toStatus);

    var fromPhase = phaseOf(fromStatus);
    var toPhase = phaseOf(toStatus);
    var phaseE = fmEntry(job, "phase");
    if (phaseE) rewriteFmLine(lines, phaseE, toPhase);

    bumpUpdated(job, lines);

    var newText = joinLines(job, lines);
    var msg = opts.back
      ? "[" + role() + "] revert " + job.jobNumber + " " + fromStatus + " -> " + toStatus +
        (opts.reason ? " — " + String(opts.reason).replace(/\s+/g, " ").trim() : "")
      : "[" + role() + "] advance " + job.jobNumber + " " + fromStatus + " -> " + toStatus + bulkNote;

    var result = { newText: newText, message: msg };

    if (fromPhase !== toPhase) {
      var oldPath = job._meta.path;
      var filename = oldPath.split("/").pop();
      var toPath = "10-jobs/" + toPhase + "/" + filename;
      result.move = { toPath: toPath, oldPath: oldPath, oldSha: job._meta.sha };
    }

    return result;
  };

  /* ---- table append helpers ---- */
  function escapeCell(v) {
    return String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  }

  /* find the index of the LAST line starting "|" within a section; returns -1 */
  function lastTableRow(lines, headerIdx) {
    if (headerIdx < 0) return -1;
    var end = lines.length;
    for (var i = headerIdx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    var last = -1;
    for (var j = headerIdx + 1; j < end; j++) {
      if (/^\s*\|/.test(lines[j])) last = j;
    }
    return last;
  }

  /* generic single-row append after the last "|" row of a section */
  function appendTableRow(job, sectionKey, cells, action, detail) {
    var lines = cloneLines(job);
    var headerIdx = job._meta.sectionLineIndex[sectionKey];
    if (headerIdx == null || headerIdx < 0) {
      throw new Error("append: section \"" + sectionKey + "\" not found");
    }
    var lastRow = lastTableRow(lines, headerIdx);
    if (lastRow < 0) {
      throw new Error("append: no table found under \"" + sectionKey + "\"");
    }
    var rowText = "| " + cells.map(escapeCell).join(" | ") + " |";
    lines.splice(lastRow + 1, 0, rowText);
    bumpUpdated(job, lines);
    var msg = "[" + role() + "] " + action + " " + job.jobNumber + " — " + detail;
    return { newText: joinLines(job, lines), message: msg };
  }

  /* ---- appendReading(job, row) ----
     row: {date, area, moisture, temp, RH, CSP, batch, dft, notes}
     columns: date | area | moisture | temp | RH | CSP | batch # | WFT/DFT | notes */
  data.appendReading = function (job, row) {
    row = row || {};
    var date = row.date || today();
    var cells = [
      date, row.area, row.moisture, row.temp, row.RH, row.CSP, row.batch, row.dft, row.notes
    ];
    var detailBits = [];
    if (row.area) detailBits.push(row.area);
    var spec = [];
    if (row.moisture != null && row.moisture !== "") spec.push(row.moisture + "%");
    if (row.temp != null && row.temp !== "") spec.push(row.temp + "C");
    if (row.RH != null && row.RH !== "") spec.push(row.RH + "%RH");
    var detail = (detailBits.length ? detailBits.join(" ") + " " : "") + spec.join(" / ");
    if (!detail) detail = date;
    return appendTableRow(job, "readings", cells, "reading", detail);
  };

  /* ---- appendProduct(job, row) ----
     row: {product, qty, notes}  columns: product | qty used | notes */
  data.appendProduct = function (job, row) {
    row = row || {};
    var cells = [row.product, row.qty, row.notes];
    var detail = (row.product || "") + (row.qty != null && row.qty !== "" ? " — " + row.qty : "");
    return appendTableRow(job, "product", cells, "product", detail.trim() || "row");
  };
  // alias per the deliverable wording
  data.appendProductUsage = data.appendProduct;

  /* ---- appendNote(job, text) ----
     append "- <YYYY-MM-DD> (<Role>): <text>" after the last NON-BLANK line of
     "## Notes". Refuses (throws) if the target index <= last pre-existing
     content line of Scope/Notes (prose is unwritable). Per the contract we
     only ever INSERT a new bullet; we never touch existing prose. */
  data.appendNote = function (job, text) {
    if (!text || !String(text).trim()) throw new Error("appendNote: empty note");
    var lines = cloneLines(job);
    var notesIdx = job._meta.sectionLineIndex.notes;
    if (notesIdx == null || notesIdx < 0) throw new Error("appendNote: no ## Notes section");

    // find the end of the Notes section
    var end = lines.length;
    for (var i = notesIdx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    // last non-blank line within Notes
    var insertAt = notesIdx; // header itself, if section is empty
    for (var j = notesIdx + 1; j < end; j++) {
      if (lines[j].trim() !== "") insertAt = j;
    }
    // GUARD: never insert at/above the section header line of Notes (prose-safe).
    // Inserting AFTER the last content line (or after the header if empty) only
    // ever adds a bullet; it never overwrites existing prose.
    if (insertAt < notesIdx) {
      throw new Error("appendNote: refused — target is inside protected prose");
    }

    var noteLine = "- " + today() + " (" + role() + "): " + String(text).trim();
    lines.splice(insertAt + 1, 0, noteLine);
    bumpUpdated(job, lines);
    var detail = String(text).trim();
    if (detail.length > 50) detail = detail.slice(0, 47) + "...";
    var msg = "[" + role() + "] note " + job.jobNumber + " — " + detail;
    return { newText: joinLines(job, lines), message: msg };
  };

  /* ---- setField(job, key, value) : rewrite ONE frontmatter line by key.
          Allowed keys (dates / crew / on_hold / money / IDs). Preserves the
          key + spacing. crew arrays are written inline as a JSON-ish list. ---- */
  data.setField = function (job, key, value) {
    var lines = cloneLines(job);
    var e = fmEntry(job, key);
    if (!e) throw new Error("setField: no frontmatter key \"" + key + "\"");

    var written;
    if (key === "crew" && Array.isArray(value)) {
      written = "[" + value.map(function (n) { return String(n).trim(); }).filter(Boolean).join(", ") + "]";
    } else if (typeof value === "boolean") {
      written = value ? "true" : "false";
    } else if (value == null) {
      written = "";
    } else {
      written = String(value);
    }
    rewriteFmLine(lines, e, written);
    bumpUpdated(job, lines);

    var msg = "[" + role() + "] set " + job.jobNumber + " — " + key + " " + (written === "" ? "(cleared)" : written);
    return { newText: joinLines(job, lines), message: msg };
  };

  /* ============================================================
     GITHUB REST CLIENT
     ============================================================ */

  var API = "https://api.github.com";

  function ghHeaders() {
    var h = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (_cfg.token) h["Authorization"] = "Bearer " + _cfg.token;
    return h;
  }

  function ghBase() {
    return API + "/repos/" + encodeURIComponent(_cfg.owner) + "/" + encodeURIComponent(_cfg.repo);
  }

  /* probe — used by identity.setToken; returns the fetch Response */
  data.probeRepo = function () {
    return fetch(ghBase(), { headers: ghHeaders() });
  };

  /* listJobs: ONE tree call, filter 10-jobs/**.md, read each, build Job[].
     The trees API silently truncates very large repos (tree.truncated) —
     the phase folders are a fixed enum, so fall back to listing each one. */
  data.listJobs = function () {
    var treeUrl = ghBase() + "/git/trees/" + encodeURIComponent(_cfg.branch) + "?recursive=1";
    return fetch(treeUrl, { headers: ghHeaders() })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw mkErr(res.status, "listJobs tree", t); });
        return res.json();
      })
      .then(function (tree) {
        if (tree.truncated) return listJobPathsByFolder();
        return (tree.tree || [])
          .filter(function (n) {
            return n.type === "blob" &&
              n.path.indexOf("10-jobs/") === 0 &&
              /\.md$/i.test(n.path);
          })
          .map(function (n) { return n.path; });
      })
      .then(function (paths) {
        return Promise.all(paths.map(function (p) {
          return data.readJob(p)["catch"](function () { return null; });
        }));
      })
      .then(function (jobs) {
        var clean = jobs.filter(Boolean);
        /* torn-move detection: the same job number in two phase folders means
           an interrupted PUT+DELETE move. The copy in the LATER folder is the
           move target (moves only advance); the earlier one is stale — drop it
           from the list and surface it via lastListMeta for cleanup. */
        var byNum = {};
        clean.forEach(function (j) { (byNum[j.jobNumber] = byNum[j.jobNumber] || []).push(j); });
        var torn = [];
        clean = clean.filter(function (j) {
          var grp = byNum[j.jobNumber];
          if (grp.length < 2) return true;
          var keep = grp.reduce(function (a, b) { return a._meta.path > b._meta.path ? a : b; });
          if (j === keep) return true;
          torn.push({ jobNumber: j.jobNumber, keepPath: keep._meta.path, stalePath: j._meta.path, staleSha: j._meta.sha });
          return false;
        });
        data.lastListMeta = { torn: torn };
        _cacheJobs(clean);
        _persistSnapshot(clean);
        return clean;
      });
  };
  data.lastListMeta = { torn: [] };

  /* truncated-tree fallback: list the four phase folders directly */
  var PHASE_FOLDERS = ["1-planning", "2-active", "3-closeout", "4-archive"];
  function listJobPathsByFolder() {
    return Promise.all(PHASE_FOLDERS.map(function (ph) {
      var url = ghBase() + "/contents/" + encodePath("10-jobs/" + ph) + "?ref=" + encodeURIComponent(_cfg.branch);
      return fetch(url, { headers: ghHeaders() })
        .then(function (res) {
          if (res.status === 404) return []; // folder empty on this branch — GitHub drops empty dirs
          if (!res.ok) return res.text().then(function (t) { throw mkErr(res.status, "listJobs folder " + ph, t); });
          return res.json();
        })
        .then(function (items) {
          return (Array.isArray(items) ? items : [])
            .filter(function (n) { return n.type === "file" && /\.md$/i.test(n.name); })
            .map(function (n) { return n.path; });
        });
    })).then(function (perFolder) {
      return perFolder.reduce(function (all, p) { return all.concat(p); }, []);
    });
  }

  /* readJob: GET contents -> {content,sha}; decode; parse; attach _meta. */
  data.readJob = function (path) {
    var url = ghBase() + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(_cfg.branch);
    return fetch(url, { headers: ghHeaders() })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw mkErr(res.status, "readJob " + path, t); });
        return res.json();
      })
      .then(function (j) {
        var text = b64ToUtf8(j.content || "");
        var job = data.parseJobMarkdown(text, path, j.sha);
        return job;
      });
  };

  /* writeJob: PUT contents with sha; optional {move}. Returns {sha}. */
  data.writeJob = function (path, newText, sha, message, opts) {
    opts = opts || {};
    var author = { name: role(), email: "field@fxcoating.ca" };

    if (opts.move) {
      // phase-folder move: PUT new path (NO sha) THEN DELETE old path
      var put = {
        message: message,
        content: utf8ToB64(newText),
        branch: _cfg.branch,
        author: author,
        committer: author
      };
      var newSha = null;
      return fetch(ghBase() + "/contents/" + encodePath(opts.move.toPath), {
        method: "PUT", headers: ghHeaders(), body: JSON.stringify(put)
      }).then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw mkErr(res.status, "writeJob move PUT", t); });
        return res.json();
      }).then(function (j) {
        newSha = j.content && j.content.sha;
        function delOnce() {
          var del = {
            message: message,
            sha: opts.move.oldSha,
            branch: _cfg.branch,
            author: author,
            committer: author
          };
          return fetch(ghBase() + "/contents/" + encodePath(opts.move.oldPath), {
            method: "DELETE", headers: ghHeaders(), body: JSON.stringify(del)
          });
        }
        return delOnce().then(function (res) {
          if (res.ok) return { sha: newSha };
          return delOnce().then(function (res2) {
            if (res2.ok) return { sha: newSha };
            /* the PUT already landed — throwing here would make the UI claim
               failure AND (on 409) re-run the transform into a sha-less
               re-PUT (422). Report the torn state instead; listJobs flags
               the duplicate for cleanup. */
            return {
              sha: newSha,
              warning: "Moved, but the old copy at " + opts.move.oldPath +
                " couldn't be removed — it will be flagged for cleanup on the next load."
            };
          });
        });
      });
    }

    var body = {
      message: message,
      content: utf8ToB64(newText),
      branch: _cfg.branch,
      author: author,
      committer: author
    };
    if (sha) body.sha = sha;

    return fetch(ghBase() + "/contents/" + encodePath(path), {
      method: "PUT", headers: ghHeaders(), body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw mkErr(res.status, "writeJob PUT", t); });
      return res.json();
    }).then(function (j) {
      return { sha: j.content && j.content.sha };
    });
  };

  /* ---- removeStaleDuplicate({jobNumber, stalePath, staleSha}) : delete the
          stale copy a torn phase-move left behind (see listJobs detection).
          Full scope only — this is the one write that removes a file. ---- */
  data.removeStaleDuplicate = function (dup) {
    var scope = FXC.state && FXC.state.role && FXC.state.role.scope;
    if (scope !== "full") return Promise.reject(new Error("removeStaleDuplicate: full scope (Brad/Dan) only"));
    var author = { name: role(), email: "field@fxcoating.ca" };
    var body = {
      message: "[" + role() + "] cleanup " + dup.jobNumber + " — remove stale duplicate at " + dup.stalePath + " (torn phase move)",
      sha: dup.staleSha,
      branch: _cfg.branch,
      author: author,
      committer: author
    };
    return fetch(ghBase() + "/contents/" + encodePath(dup.stalePath), {
      method: "DELETE", headers: ghHeaders(), body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw mkErr(res.status, "removeStaleDuplicate", t); });
      return true;
    });
  };

  function mkErr(status, where, text) {
    var e = new Error(where + " " + status + (text ? " — " + text.slice(0, 200) : ""));
    e.status = status;
    return e;
  }

  /* encode each path segment but keep the slashes */
  function encodePath(path) {
    return String(path).split("/").map(encodeURIComponent).join("/");
  }

  /* ============================================================
     IN-MEMORY CACHE + SNAPSHOT (offline read)
     ============================================================ */
  var _byNumber = {};

  function _cacheJobs(jobs) {
    jobs.forEach(function (j) { _byNumber[j.jobNumber] = j; });
  }
  data.getCached = function (jobNumber) { return _byNumber[String(jobNumber)] || null; };
  data.putCached = function (job) { if (job && job.jobNumber) _byNumber[job.jobNumber] = job; };

  /* snapshot(): serializable Job[] with _meta stripped (it's non-enumerable,
     so JSON.stringify drops it automatically) */
  data.snapshot = function () {
    return Object.keys(_byNumber).map(function (k) {
      return JSON.parse(JSON.stringify(_byNumber[k]));
    });
  };

  function _persistSnapshot(jobs) {
    try {
      var plain = jobs.map(function (j) { return JSON.parse(JSON.stringify(j)); });
      root.localStorage.setItem("fxc.cache.jobs", JSON.stringify(plain));
    } catch (e) { /* storage unavailable — ignore */ }
  }

  data.loadSnapshot = function () {
    try {
      var raw = root.localStorage.getItem("fxc.cache.jobs");
      if (!raw) return null;
      var arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch (e) { return null; }
  };

  /* expose the maps for edit.js convenience (read-only intent) */
  data._cfg = _cfg;
  data.STATUS_BUCKET = STATUS_BUCKET;
  data.STAGE_LABELS = STAGE_LABELS;
  data.TRANSITIONS = TRANSITIONS;
  data.expandSegment = expandSegment;

  /* CommonJS export guard for node unit tests */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = data;
  }
  /* also expose the legacy global name requested in the deliverable */
  root.FXCData = data;

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
