/* ============================================================
   FXC Field — identity.js   (Builder D, identity unit)
   --------------------------------------------------------------
   Device setup + role picker + scope rules. No passwords:
     • DEVICE SETUP captures {owner,repo,branch,token} once per
       device, validates the token by hitting the repo, and stores
       it in localStorage. Token is write-once, never re-displayed.
     • ROLE PICKER lets the user tap who they are — Brad (owner,
       full edit), Dan (PM, full edit), or a crew name (field
       scope on active jobs only). Selection -> sessionStorage.
     • canEdit(job,field) encodes the LOCKED scope rules:
         full  -> may edit everything
         field -> only on bucket==='active' jobs: active-phase
                  gates, readings, product rows, notes, and the
                  active flow status. Never money/scope/dates/
                  planning/closeout.
       Re-checked at WRITE time by edit.js (defense in depth).

   Exposes window.FXCAuth (primary) and mirrors the same surface
   onto window.FXC.identity (interface-contract name) so app-glue
   can consume it either way. Plain DOM, reuses the v1 CSS vars.
   ============================================================ */
(function () {
  "use strict";

  /* ---- storage keys (per contract) ---- */
  var TOKEN_KEY  = "fxc.token";   // localStorage — per device
  var CONFIG_KEY = "fxc.config";  // localStorage — {owner,repo,branch}
  var ROLE_KEY   = "fxc.role";    // sessionStorage — {name,scope}

  var COMMITTER_EMAIL = "field@fxcoating.ca";

  /* ---- known roles ---- */
  var FULL_ROLES = ["Brad", "Dan"]; // owner + PM => scope "full" — fallback; team.json overrides at boot
  var FULL_SUBS = { Brad: "Owner · full edit", Dan: "PM · full edit" };

  /* team.json is the roster of record: its owner/pm rows replace FULL_ROLES
     at boot (app-glue loadTeam), honoring team.json's documented contract.
     Mutated IN PLACE so every closure over FULL_ROLES sees the update; the
     hardcoded pair stays whenever team.json is missing or names nobody.
     NOTE: a roster edit can now grant full scope — same trust level as
     editing the hosted code itself; the token is the real boundary. */
  function setFullRoles(people) {
    var names = [], subs = {};
    (Array.isArray(people) ? people : []).forEach(function (p) {
      var name = String((p && p.name) || "").trim();
      if (!name) return;
      names.push(name);
      subs[name] = /owner/i.test(String((p && p.role) || "")) ? "Owner · full edit" : "PM · full edit";
    });
    if (!names.length) return;
    FULL_ROLES.length = 0;
    names.forEach(function (n) { FULL_ROLES.push(n); });
    FULL_SUBS = subs;
  }

  /* status -> phase (mirrors data.js PHASE_OF / SCHEMA.md).
     Used for the active-phase gate guard so a field user can only
     toggle gates that belong to the ACTIVE phase. */
  var PLANNING = { won:1, "package-building":1, "scope-locked":1, scheduled:1, "cleared-to-deploy":1 };
  var ACTIVE   = { deployed:1, prepping:1, applying:1, destaging:1, "walkthrough-done":1 };
  var CLOSEOUT = { invoicing:1, "pja-pending":1, "warranty-issued":1 };

  /* ---------------------------------------------------------- */
  /* config — owner/repo/branch (token kept separate)            */
  /* ---------------------------------------------------------- */

  /* Fallback config coordinates if config.js (FXC.config) isn't
     present yet. Editable in the device-setup form. */
  var DEFAULT_CONFIG = { owner: "", repo: "fxc-pm", branch: "main" };

  function baseConfig() {
    // Prefer config.js coordinates when Builder A has loaded them.
    var f = (window.FXC && window.FXC.config) || {};
    return {
      owner:  f.owner  || DEFAULT_CONFIG.owner,
      repo:   f.repo   || DEFAULT_CONFIG.repo,
      branch: f.branch || DEFAULT_CONFIG.branch
    };
  }

  function getConfig() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch (e) { stored = null; }
    var b = baseConfig();
    if (!stored) return b;
    return {
      owner:  stored.owner  || b.owner,
      repo:   stored.repo   || b.repo,
      branch: stored.branch || b.branch
    };
  }

  function setConfig(cfg) {
    var clean = {
      owner:  String(cfg.owner  || "").trim(),
      repo:   String(cfg.repo   || "").trim(),
      branch: String(cfg.branch || "main").trim() || "main"
    };
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(clean)); } catch (e) {}
    return clean;
  }

  /* ---------------------------------------------------------- */
  /* token                                                       */
  /* ---------------------------------------------------------- */

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }

  /* setToken: probe GET /repos/{owner}/{repo} FIRST; only persist on
     200. Throws on 401/404 / network so the caller can show an
     inline error. cfg is optional — falls back to getConfig(). */
  function setToken(tok, cfg) {
    tok = String(tok || "").trim();
    cfg = cfg || getConfig();
    if (!tok) return Promise.reject(new Error("Paste a token first."));
    if (!cfg.owner || !cfg.repo) return Promise.reject(new Error("Set the owner and repo first."));

    var url = "https://api.github.com/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo);
    return fetch(url, {
      headers: {
        "Authorization": "Bearer " + tok,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }).then(function (res) {
      if (res.status === 200) {
        try { localStorage.setItem(TOKEN_KEY, tok); } catch (e) {}
        setConfig(cfg);
        return true;
      }
      if (res.status === 401) throw new Error("Token rejected (401). Check the token and that it isn't expired.");
      if (res.status === 404) throw new Error("Repo not found (404). Check owner/repo and that the token can see this private repo.");
      throw new Error("GitHub returned " + res.status + ". Try again.");
    }, function () {
      throw new Error("Couldn't reach GitHub. Check your connection and retry.");
    });
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  function hasToken() { return !!getToken(); }

  /* ---------------------------------------------------------- */
  /* role                                                        */
  /* ---------------------------------------------------------- */

  /* crew device: set when the app was opened via a worker card-link
     (#card=…&crew=1). The role picker then offers ONLY crew names and any
     typed name is clamped to field scope — a worker link can never hand out
     Brad/Dan (Brad 2026-07-03). UX guardrail, not security: the shared token
     is the real boundary (see PROXY-DESIGN.md). Cleared by forgetDevice(). */
  var CREW_KEY = "fxc.crewDevice";
  function isCrewDevice() {
    try { return localStorage.getItem(CREW_KEY) === "1"; } catch (e) { return false; }
  }
  function setCrewDevice(on) {
    try { on ? localStorage.setItem(CREW_KEY, "1") : localStorage.removeItem(CREW_KEY); } catch (e) {}
  }

  function scopeForName(name) {
    if (isCrewDevice()) return "field";
    name = String(name || "").trim();
    for (var i = 0; i < FULL_ROLES.length; i++) {
      if (FULL_ROLES[i].toLowerCase() === name.toLowerCase()) return "full";
    }
    return "field";
  }

  function getRole() {
    try {
      var r = JSON.parse(sessionStorage.getItem(ROLE_KEY) || "null");
      if (r && r.name) {
        // normalize scope in case an old value was stored
        r.scope = (r.scope === "full" || r.scope === "field") ? r.scope : scopeForName(r.name);
        return r;
      }
    } catch (e) {}
    return null;
  }

  function setRole(role) {
    var name = String((role && role.name) || "").trim();
    if (!name) return null;
    var scope = (role && (role.scope === "full" || role.scope === "field")) ? role.scope : scopeForName(name);
    if (isCrewDevice()) scope = "field"; // worker-link devices never hold full scope
    var clean = { name: name, scope: scope };
    try { sessionStorage.setItem(ROLE_KEY, JSON.stringify(clean)); } catch (e) {}
    // keep FXC.state.role in sync for the rest of the app
    if (window.FXC) { window.FXC.state = window.FXC.state || {}; window.FXC.state.role = clean; }
    return clean;
  }

  function clearRole() {
    try { sessionStorage.removeItem(ROLE_KEY); } catch (e) {}
    if (window.FXC && window.FXC.state) window.FXC.state.role = null;
  }

  /* The commit-author / role string used by data.js for messages
     and author.name. Falls back to "Field" if no role chosen. */
  function actorName() {
    var r = getRole();
    return (r && r.name) ? r.name : "Field";
  }

  function commitAuthor() {
    return { name: actorName(), email: COMMITTER_EMAIL };
  }

  /* ---------------------------------------------------------- */
  /* canEdit(job, field)  — the scope rules                      */
  /* ---------------------------------------------------------- */
  /* field in {gate,status,reading,product,note,money,scope,date,crew,on_hold}
     - demo mode / no role            -> false for everything
     - scope "full" (Brad/Dan)        -> true for all
     - scope "field" (crew)           -> true ONLY on bucket==='active'
       jobs, and only for:
         reading | product | note
         gate    -> only an ACTIVE-phase gate
         status  -> only an active-flow status target
       false for money/scope/date/crew/on_hold and any non-active job. */

  var FIELD_OK = { reading:1, product:1, note:1, gate:1, status:1 };

  function isActiveStatus(s) { return !!ACTIVE[s]; }

  /* For a status target, is it part of the ACTIVE flow?
     Accepts either a status string or undefined. The active flow
     entry status is "deployed"; "walkthrough-done" is the last
     active status (the Final Walkthrough gate then hands off to
     closeout, which is NOT a field write). */
  function isActiveFlowTarget(toStatus) {
    if (!toStatus) return true; // generic "advance" within active flow
    return !!ACTIVE[toStatus];
  }

  /* Is a given gate object an ACTIVE-phase gate? Tolerates either a
     gate phase string ("Active") or the absLine-bearing gate entry
     from job._meta.gateIndex ({phase:"Active",...}). edit.js may
     pass {gatePhase:"Active"} via opts. */
  function gateIsActive(job, opts) {
    opts = opts || {};
    var phase = opts.gatePhase || opts.phase;
    if (phase) return String(phase).toLowerCase() === "active";
    // No explicit phase given: fall back to the job's current phase.
    var st = job && (job.status || (job._meta && job._meta.status));
    if (st) return isActiveStatus(st);
    // Last resort: bucket==='active' already gated by the caller.
    return job && job.bucket === "active";
  }

  function canEdit(job, field, opts) {
    if (!job || !field) return false;

    var mode = (window.FXC && window.FXC.state && window.FXC.state.mode) || null;
    if (mode === "demo" || mode === "offline") return false; // preview / offline => read-only

    var role = getRole();
    if (!role) return false;                  // no actor chosen

    /* backward correction — deliberately UN-gated for now (Brad 2026-07-02):
       any signed-in role may move a job back; the required reason + role-stamped
       "revert" commit stays the audit trail. To re-gate to Brad/Dan, delete this
       line (full scope keeps the ability via the rule below). */
    if (field === "status-back") return true;

    if (role.scope === "full") return true;   // Brad / Dan edit everything

    /* ---- field scope (crew) ---- */
    if (job.bucket !== "active") return false;          // active jobs only
    if (field === "gate-bulk") return false;            // the check-all gate bypass is full scope only, never crew
    if (!FIELD_OK[field]) return false;                 // never money/scope/date/crew/on_hold

    if (field === "gate")   return gateIsActive(job, opts);                 // active-phase gates only
    if (field === "status") return isActiveFlowTarget(opts && opts.toStatus); // active flow only

    // reading | product | note
    return true;
  }

  /* ---------------------------------------------------------- */
  /* connection state helper                                     */
  /* ---------------------------------------------------------- */

  function isConnected() { return hasToken(); }

  function forgetDevice() {
    clearToken();
    clearRole();
    try { localStorage.removeItem(CONFIG_KEY); } catch (e) {}
    setCrewDevice(false); // the escape hatch for a phone that opened a worker link
  }

  /* ---------------------------------------------------------- */
  /* UI — overlays (plain DOM, v1 CSS vars/classes)             */
  /* ---------------------------------------------------------- */

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "style") n.setAttribute("style", attrs[k]);
      else if (k in n) { try { n[k] = attrs[k]; } catch (e) { n.setAttribute(k, attrs[k]); } }
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  function removeOverlay(id) {
    var ex = document.getElementById(id);
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
  }

  /* Shared full-screen overlay shell. Reuses panel/line/accent vars. */
  function overlayShell(id) {
    removeOverlay(id);
    var ov = el("div", { id: id });
    ov.setAttribute("style",
      "position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;" +
      "padding:20px;background:rgba(8,10,12,.86);backdrop-filter:blur(4px);overflow:auto;");
    return ov;
  }

  function cardShell(maxw) {
    var c = el("div", { className: "card" });
    c.style.cursor = "default";
    c.style.transform = "none";
    c.setAttribute("style",
      "background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);" +
      "padding:22px 20px;width:100%;max-width:" + (maxw || 440) + "px;box-shadow:var(--shadow);cursor:default;");
    return c;
  }

  function brandBar() {
    return '<div class="logo" style="font-size:17px;margin-bottom:4px">' +
           '<span class="mark">FX</span> Field</div>';
  }

  var BTN_PRIMARY =
    "width:100%;padding:13px 14px;border:none;border-radius:10px;background:var(--accent);" +
    "color:#10140f;font-weight:800;font-size:16px;cursor:pointer;";
  var INPUT_STYLE =
    "width:100%;padding:12px 12px;font-size:16px;border:1px solid var(--line);border-radius:10px;" +
    "background:var(--panel2);color:var(--ink);margin-top:5px;";
  var LABEL_STYLE =
    "display:block;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--ink-dim);" +
    "margin-top:14px;font-weight:700;";
  var LINK_STYLE = "color:var(--ink-dim);font-size:13px;cursor:pointer;text-decoration:underline;background:none;border:none;padding:0;";

  /* ---- DEVICE SETUP overlay ---- */
  /* onDone(): called after a token is saved (advance to role picker).
     onPreview(): called when the user taps "Just preview" (demo). */
  function showDeviceSetup(opts) {
    opts = opts || {};
    var cfg = getConfig();
    var ov = overlayShell("fxc-setup-overlay");
    var card = cardShell(460);

    card.innerHTML =
      brandBar() +
      '<p style="margin:2px 0 16px;color:var(--ink-dim);font-size:14px">' +
        'Connect this device once. Paste a GitHub fine-grained token scoped to the FXC PM repo ' +
        '(Contents: read &amp; write). It is stored on this device only and never shown again.</p>' +

      '<label style="' + LABEL_STYLE + '">GitHub account (owner)</label>' +
      '<input id="fxc-su-owner" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
        'style="' + INPUT_STYLE + '" value="' + escAttr(cfg.owner) + '" placeholder="brad-account">' +

      '<label style="' + LABEL_STYLE + '">Data repo</label>' +
      '<input id="fxc-su-repo" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
        'style="' + INPUT_STYLE + '" value="' + escAttr(cfg.repo) + '" placeholder="fxc-pm">' +

      '<label style="' + LABEL_STYLE + '">Branch</label>' +
      '<input id="fxc-su-branch" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
        'style="' + INPUT_STYLE + '" value="' + escAttr(cfg.branch) + '" placeholder="main">' +

      '<label style="' + LABEL_STYLE + '">Access token (paste once)</label>' +
      '<input id="fxc-su-token" type="password" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
        'autocomplete="off" style="' + INPUT_STYLE + '" placeholder="github_pat_...">' +

      '<div id="fxc-su-err" style="display:none;color:var(--red);font-size:13px;margin-top:12px"></div>' +

      '<button id="fxc-su-save" style="' + BTN_PRIMARY + ';margin-top:18px">Connect device</button>' +

      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">' +
        '<button id="fxc-su-preview" style="' + LINK_STYLE + '">Just preview</button>' +
        '<button id="fxc-su-forget" style="' + LINK_STYLE + '">Forget this device</button>' +
      '</div>';

    ov.appendChild(card);
    document.body.appendChild(ov);

    var err = card.querySelector("#fxc-su-err");
    var saveBtn = card.querySelector("#fxc-su-save");

    function showErr(msg) { err.textContent = msg; err.style.display = "block"; }
    function clearErr() { err.style.display = "none"; err.textContent = ""; }

    saveBtn.onclick = function () {
      clearErr();
      var formCfg = {
        owner:  card.querySelector("#fxc-su-owner").value,
        repo:   card.querySelector("#fxc-su-repo").value,
        branch: card.querySelector("#fxc-su-branch").value
      };
      var tok = card.querySelector("#fxc-su-token").value;
      if (!formCfg.owner || !formCfg.repo) { showErr("Enter the owner and repo."); return; }
      if (!tok.trim()) { showErr("Paste your access token."); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = "Checking…";
      setToken(tok, formCfg).then(function () {
        saveBtn.textContent = "Connected";
        removeOverlay("fxc-setup-overlay");
        if (typeof opts.onDone === "function") opts.onDone();
      }, function (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Connect device";
        showErr((e && e.message) || "Could not connect.");
      });
    };

    card.querySelector("#fxc-su-token").addEventListener("keydown", function (e) {
      if (e.key === "Enter") saveBtn.click();
    });

    card.querySelector("#fxc-su-preview").onclick = function () {
      removeOverlay("fxc-setup-overlay");
      if (typeof opts.onPreview === "function") opts.onPreview();
    };

    card.querySelector("#fxc-su-forget").onclick = function () {
      forgetDevice();
      var c = getConfig();
      card.querySelector("#fxc-su-owner").value = c.owner;
      card.querySelector("#fxc-su-repo").value = c.repo;
      card.querySelector("#fxc-su-branch").value = c.branch;
      card.querySelector("#fxc-su-token").value = "";
      clearErr();
    };

    return ov;
  }

  /* ---- ROLE PICKER overlay ---- */
  /* crewList: array of crew names. If absent, falls back to FXC.crew
     (config.js) and finally a sane default. onPick(role): called with
     the chosen {name,scope}. */
  function showRolePicker(opts) {
    opts = opts || {};
    var crew = opts.crewList || (window.FXC && window.FXC.crew) || ["Mike"];
    if (!crew.length) crew = ["Mike"];

    var ov = overlayShell("fxc-role-overlay");
    var card = cardShell(460);

    var fullTiles = isCrewDevice() ? "" : FULL_ROLES.map(function (n) {
      var sub = FULL_SUBS[n] || "PM · full edit";
      return roleTile(n, sub, "full");
    }).join("");

    var crewTiles = crew.map(function (n) {
      return roleTile(n, "Crew · field", "field");
    }).join("");

    card.innerHTML =
      brandBar() +
      '<p style="margin:2px 0 16px;color:var(--ink-dim);font-size:14px">Who are you? This sets your edit permissions and stamps your name on every change.</p>' +

      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--ink-faint);font-weight:700;margin-bottom:8px">Office</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">' + fullTiles + '</div>' +

      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--ink-faint);font-weight:700;margin-bottom:8px">Field crew</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">' + crewTiles + '</div>' +

      '<label style="' + LABEL_STYLE + ';margin-top:4px">Not listed? Type your name (field scope)</label>' +
      '<div style="display:flex;gap:8px">' +
        '<input id="fxc-role-free" type="text" autocapitalize="words" autocorrect="off" spellcheck="false" ' +
          'style="' + INPUT_STYLE + ';margin-top:5px;flex:1" placeholder="Your name">' +
        '<button id="fxc-role-freego" style="margin-top:5px;padding:0 16px;border:none;border-radius:10px;background:var(--panel2);border:1px solid var(--line);color:var(--ink);font-weight:700;font-size:15px;cursor:pointer">Go</button>' +
      '</div>';

    ov.appendChild(card);
    document.body.appendChild(ov);

    function choose(name, scope) {
      var role = setRole({ name: name, scope: scope });
      removeOverlay("fxc-role-overlay");
      if (typeof opts.onPick === "function") opts.onPick(role);
    }

    Array.prototype.forEach.call(card.querySelectorAll("[data-role-name]"), function (tile) {
      tile.onclick = function () {
        choose(tile.getAttribute("data-role-name"), tile.getAttribute("data-role-scope"));
      };
    });

    var freeInput = card.querySelector("#fxc-role-free");
    function freeGo() {
      var v = freeInput.value.trim();
      if (v) choose(v, scopeForName(v));
    }
    card.querySelector("#fxc-role-freego").onclick = freeGo;
    freeInput.addEventListener("keydown", function (e) { if (e.key === "Enter") freeGo(); });

    return ov;
  }

  function roleTile(name, sub, scope) {
    return '<button class="card" data-role-name="' + escAttr(name) + '" data-role-scope="' + scope + '" ' +
      'style="text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:10px;' +
      'padding:13px 13px;cursor:pointer;color:var(--ink);min-height:62px;margin:0">' +
      '<div style="font-weight:800;font-size:15px">' + escHtml(name) + '</div>' +
      '<div style="font-size:11px;color:var(--ink-faint);margin-top:3px">' + escHtml(sub) + '</div>' +
      '</button>';
  }

  /* ---- header connection / role chip ---- */
  /* Renders a tappable chip in the header brand area reflecting the
     current actor + mode. Tapping re-opens the role picker. mode is
     read from FXC.state.mode. onTap defaults to re-opening the picker. */
  function renderChip(onTap) {
    var brand = document.querySelector("header.top .brand");
    if (!brand) return null;
    var spacer = brand.querySelector(".spacer");
    var chip = document.getElementById("fxc-actor-chip");
    if (!chip) {
      chip = el("button", { id: "fxc-actor-chip", className: "chip" });
      chip.setAttribute("style",
        "cursor:pointer;font-size:12px;padding:5px 11px;border-radius:999px;background:#0e1216;" +
        "border:1px solid var(--line);color:var(--ink-dim);font-weight:700;");
      // insert just before the spacer so it sits left of the KPIs
      if (spacer) brand.insertBefore(chip, spacer);
      else brand.appendChild(chip);
    }

    var mode = (window.FXC && window.FXC.state && window.FXC.state.mode) || null;
    var role = getRole();
    var label, dot;
    if (mode === "demo") { label = "preview"; dot = "var(--grey)"; }
    else if (mode === "offline") { label = (role ? role.name : "—") + " · offline"; dot = "var(--amber)"; }
    else { label = (role ? role.name : "pick role") + " · live"; dot = "var(--green)"; }

    chip.innerHTML =
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dot + ';margin-right:6px;vertical-align:middle"></span>' +
      escHtml(label);

    chip.onclick = function () {
      if (typeof onTap === "function") { onTap(); return; }
      // default: re-open role picker (only meaningful when not demo)
      showRolePicker({ onPick: function () { renderChip(onTap); } });
    };
    return chip;
  }

  /* ---------------------------------------------------------- */
  /* small escapers (don't depend on v1 esc() being loaded)      */
  /* ---------------------------------------------------------- */
  function escHtml(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function escAttr(s) { return escHtml(s).replace(/'/g, "&#39;"); }

  /* ---------------------------------------------------------- */
  /* public surface                                              */
  /* ---------------------------------------------------------- */
  var FXCAuth = {
    // config + token
    getConfig: getConfig,
    setConfig: setConfig,
    getToken: getToken,
    setToken: setToken,         // returns a Promise; probes the repo first
    clearToken: clearToken,
    hasToken: hasToken,
    isConnected: isConnected,
    forgetDevice: forgetDevice,

    // role + scope
    getRole: getRole,
    setRole: setRole,
    clearRole: clearRole,
    scopeForName: scopeForName,
    canEdit: canEdit,

    // commit identity
    actorName: actorName,
    commitAuthor: commitAuthor,
    COMMITTER_EMAIL: COMMITTER_EMAIL,

    // UI overlays
    showDeviceSetup: showDeviceSetup,
    showRolePicker: showRolePicker,
    renderChip: renderChip,

    // crew-device flag (worker card-links)
    isCrewDevice: isCrewDevice,
    setCrewDevice: setCrewDevice,

    // constants (for callers that want them)
    FULL_ROLES: FULL_ROLES,
    setFullRoles: setFullRoles
  };

  window.FXCAuth = FXCAuth;

  /* Mirror onto FXC.identity (interface-contract name) so app-glue
     and edit.js can call the contract API directly. Only fills in
     identity if app-glue hasn't already provided one. */
  window.FXC = window.FXC || {};
  if (!window.FXC.identity) window.FXC.identity = FXCAuth;

  /* keep FXC.state.role in sync on load */
  window.FXC.state = window.FXC.state || { mode: null, role: null };
  if (!window.FXC.state.role) window.FXC.state.role = getRole();
})();
