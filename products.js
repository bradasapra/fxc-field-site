/* ============================================================
   FXC Field — products.js
   The sanitized Pricing-Master picker list, behind ONE interface.
   Owns window.FXC.products. Data source today: ./products.json
   (codes/names/units only — money lives in Airtable, NEVER here;
   regenerated from the master, see _BUILD_DAY_CLOSE.md). A future
   live source (Airtable fetch, vault-published list) swaps load()
   below — the Day-Close picker consumes list()/byCode() and never
   learns where the data came from.

   Contract (products.json v1):
     { version, generated, source, products: [{code,name,variants,unit}] }
   Codes are VERBATIM master codes (N222t ≠ N222FC ≠ N222FCT — the
   222-trap); this module never merges, trims or case-normalizes.
   ============================================================ */
(function (root) {
  "use strict";

  var FXC = (root.FXC = root.FXC || {});
  var products = (FXC.products = FXC.products || {});

  var _meta = null;  // {version, generated, source} once loaded
  var _list = [];
  var _byCode = {};

  /* setData(json) -> bool — validate + index. Bad shape leaves the
     module empty (the Day-Close sheet degrades to the off-master
     path + signal tap, never a crash). Node tests call this directly. */
  products.setData = function (json) {
    if (!json || typeof json !== "object" || !Array.isArray(json.products)) {
      _meta = null; _list = []; _byCode = {};
      return false;
    }
    _list = json.products
      .filter(function (p) {
        return p && typeof p === "object" &&
          typeof p.code === "string" && p.code &&
          typeof p.name === "string" &&
          typeof p.unit === "string" && p.unit;
      })
      .map(function (p) {
        return {
          code: p.code, // verbatim — never normalized
          name: p.name,
          unit: p.unit,
          variants: Array.isArray(p.variants) ? p.variants.slice() : []
        };
      });
    _byCode = {};
    _list.forEach(function (p) { _byCode[p.code] = p; });
    _meta = { version: json.version, generated: json.generated || "", source: json.source || "" };
    return _list.length > 0;
  };

  products.list = function () { return _list.slice(); };
  products.byCode = function (code) { return _byCode[String(code == null ? "" : code)] || null; };
  products.ready = function () { return _list.length > 0; };
  products.version = function () { return _meta ? _meta.version : null; };
  products.generated = function () { return _meta ? _meta.generated : null; };

  /* browser boot (app-glue): fetch the checked-in list. no-store like
     team.json — the SW precaches products.json for offline anyway. */
  products.load = function () {
    if (typeof fetch !== "function") return Promise.resolve(false);
    try {
      return fetch("./products.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return products.setData(j); })
        ["catch"](function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  };

  /* CommonJS export guard for node unit tests (same pattern as data.js) */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = products;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
