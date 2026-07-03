/* ============================================================
   FXC Field — config.js
   Repo coordinates + crew defaults. NO secrets live here.
   Loads BEFORE data.js / identity.js / edit.js / app-glue.js so the
   device-setup form and role picker have sensible defaults.

   - owner is left blank on purpose: each device captures it once at
     device-setup (so this public shell hard-codes nothing about the
     private repo). Brad CAN prefill it here if he wants one less field.
   - crew is the fallback roster used by the role picker until team.json
     loads (app-glue.js fetches team.json and overrides this if present).
   ============================================================ */
(function (root) {
  "use strict";
  var FXC = (root.FXC = root.FXC || {});
  FXC.state = FXC.state || { mode: null, role: null };

  FXC.config = {
    owner: "bradasapra", // Brad's GitHub account (prefilled 2026-07-02 — one less field per phone)
    repo: "fxc-pm",      // the private GitHub repo holding the job vault
    branch: "main"
  };

  /* fallback crew tiles for the role picker (team.json overrides at boot) */
  FXC.crew = ["Mike", "Sara"];
})(typeof window !== "undefined" ? window : this);
