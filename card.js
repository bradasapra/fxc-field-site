/* ============================================================
   FXC Field — card.js
   The "Field card" — a worker/crew full-page job view (Bentpath Bento design,
   Brad-approved 2026-06-13). Renders a self-contained standalone HTML document
   (used as an iframe srcdoc in-app, and as the generated worker-link artifact)
   from the parsed job object. Phase-aware: shows what's TRUE for the job's
   current stage — the current gate rules the hero; active-only tiles (live
   enviro, day bar, diesel, field wire) appear once the data exists.
   Owns window.FXC.card.  No dependency on the app's DOM/styles (iframe-isolated).
   ============================================================ */
(function (root) {
  "use strict";
  var FXC = root.FXC = root.FXC || {};
  var card = FXC.card = {};

  /* verbatim Bentpath-Bento stylesheet (Brad-approved); body width made
     responsive for the in-app iframe + phone. iframe-isolated, no app collision. */
  card.CSS = [
    ':root{--ink:#2c2b2f;--sec:#5A595C;--lab:#939598;--bord:#BCBDC0;--line:#d9dadd;--hair:#e2e3e5;--stone:#f5f4f0;--fx1:#DD5061;--fx2:#AB5491;--fx3:#7A5896;--good:#14854f;--goodbg:rgba(20,133,79,.08);}',
    '*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased;}',
    'html,body{background:#fff;overflow-x:hidden;}',
    'body{max-width:480px;margin:0 auto;font-family:"Segoe UI",system-ui,sans-serif;color:var(--ink);}',
    '.fxtext{background:linear-gradient(100deg,var(--fx1),var(--fx2),var(--fx3));-webkit-background-clip:text;background-clip:text;color:transparent;}',
    '.mast{padding:11px 16px 9px;background:#fff;border-bottom:1px solid var(--hair);position:sticky;top:0;z-index:5;}',
    '.brandrow{display:flex;align-items:center;gap:8px;}',
    '.wordmark{font-size:11px;font-weight:700;letter-spacing:3px;color:var(--sec);}',
    '.day-chip{font-size:10.5px;font-weight:700;letter-spacing:1px;color:#fff;white-space:nowrap;background:linear-gradient(90deg,#DD5061,#AB5491,#7A5896);border-radius:999px;padding:4px 11px;margin-left:auto;}',
    '.bento{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px;}',
    '.span2{grid-column:1/-1;}',
    '.tile{background:#fff;border:1px solid #e3e4e6;border-radius:18px;padding:14px;position:relative;overflow:hidden;box-shadow:0 1px 3px rgba(44,43,47,.06);}',
    '.tlabel{font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--lab);text-transform:uppercase;display:flex;align-items:center;gap:6px;white-space:nowrap;}',
    '.tlabel .dot{width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,var(--fx1),var(--fx3));flex:0 0 auto;}',
    '.idstrip{min-height:68px;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fff;border:1px solid #e3e4e6;border-radius:18px;box-shadow:0 1px 3px rgba(44,43,47,.06);}',
    '.idstrip .jobno{font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1;}',
    '.idstrip .jobsub{font-size:9.5px;font-weight:600;letter-spacing:.07em;color:var(--lab);text-transform:uppercase;margin-top:4px;line-height:1.5;}',
    '.idright{display:flex;flex-direction:column;align-items:flex-end;gap:5px;}',
    '.daybar{display:flex;align-items:center;gap:4px;}',
    '.daybar .seg{width:18px;height:8px;border-radius:4px;background:#e8e9ea;}',
    '.daybar .seg.done{background:linear-gradient(90deg,var(--fx1),var(--fx2));}',
    '.daybar .seg.today{background:linear-gradient(90deg,var(--fx2),var(--fx3));outline:1.5px solid #fff;outline-offset:-3px;box-shadow:0 0 0 1.5px var(--fx2);}',
    '.idright .dlab{font-size:9.5px;font-weight:700;color:var(--lab);letter-spacing:.04em;white-space:nowrap;}',
    '.hero{padding:15px 16px;}',
    '.hero .head{display:flex;justify-content:space-between;align-items:baseline;}',
    '.hero .gname{font-size:17px;font-weight:800;margin-top:2px;letter-spacing:-.01em;color:var(--ink);}',
    '.hero .blocks{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--lab);text-transform:uppercase;text-align:right;line-height:1.5;}',
    '.herobody{display:flex;align-items:center;gap:13px;margin-top:10px;}',
    '.ringwrap{position:relative;width:150px;height:150px;flex:0 0 auto;}',
    '.ringwrap svg{display:block;}',
    '.ringcenter{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}',
    '.ringcenter .big{font-size:40px;font-weight:800;line-height:1;letter-spacing:-.03em;color:var(--ink);}',
    '.ringcenter .big small{font-size:21px;font-weight:700;color:var(--lab);}',
    '.ringcenter .cap{font-size:9px;font-weight:700;letter-spacing:.18em;color:var(--lab);margin-top:3px;}',
    '.chips{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0;}',
    '.chip{display:flex;align-items:center;gap:10px;min-height:56px;padding:8px 12px;background:#fafafa;border:1px solid var(--line);border-radius:14px;}',
    '.chip .box{width:24px;height:24px;border-radius:8px;border:2.5px solid var(--fx2);flex:0 0 auto;background:#fff;box-shadow:0 1px 2px rgba(171,84,145,.18);}',
    '.chip .ct{font-size:13px;font-weight:700;line-height:1.2;color:var(--ink);}',
    '.chip .cs{font-size:9.5px;color:var(--lab);font-weight:600;margin-top:2px;line-height:1.35;}',
    '.donerow{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px;font-weight:600;color:var(--lab);}',
    '.donerow .ck{width:18px;height:18px;border-radius:6px;background:var(--goodbg);color:var(--good);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex:0 0 auto;}',
    '.donerow s{text-decoration-color:rgba(20,133,79,.45);}',
    '.h150{min-height:150px;}',
    '.gauges{display:flex;justify-content:space-between;margin-top:8px;}',
    '.g{width:64px;text-align:center;}',
    '.g svg{display:block;width:64px;height:38px;margin:0 auto;}',
    '.g .gv{font-size:16px;font-weight:800;line-height:1;margin-top:1px;letter-spacing:-.02em;color:var(--ink);}',
    '.g .gv span{font-size:10px;font-weight:700;color:var(--lab);}',
    '.g .gl{font-size:8.5px;font-weight:700;letter-spacing:.08em;color:var(--lab);text-transform:uppercase;margin-top:2px;}',
    '.enviro .spec{font-size:9px;color:var(--good);font-weight:700;margin-top:9px;letter-spacing:.05em;text-align:center;}',
    '.stack{margin-top:7px;border-radius:10px;overflow:hidden;border:1px solid var(--line);}',
    '.stratum{display:flex;align-items:center;justify-content:space-between;padding:0 9px;gap:6px;}',
    '.stratum .sl{font-size:10.5px;font-weight:700;letter-spacing:.02em;}',
    '.stratum .sm{font-size:10.5px;font-weight:800;white-space:nowrap;}',
    '.s-primer{background:#dddee1;color:#4c4b50;border-bottom:1px solid #cfd0d3;}',
    '.s-conc{height:11px;background:repeating-linear-gradient(45deg,#e9eaeb 0 5px,#dfe0e2 5px 10px);}',
    '.stacknote{font-size:9px;color:var(--lab);font-weight:600;margin-top:6px;text-align:center;letter-spacing:.02em;}',
    '.crewchips{display:flex;gap:8px;margin-top:9px;}',
    '.crew{flex:1;display:flex;align-items:center;gap:7px;min-height:40px;padding:0 9px;background:#fafafa;border:1px solid var(--line);border-radius:11px;}',
    '.crew .av{width:24px;height:24px;border-radius:50%;flex:0 0 auto;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;}',
    '.crew .av.m{background:linear-gradient(135deg,var(--fx1),var(--fx2));}',
    '.crew .av.t{background:linear-gradient(135deg,var(--fx2),var(--fx3));}',
    '.crew .cn{font-size:13px;font-weight:700;color:var(--ink);}',
    '.diesel{margin-top:9px;}',
    '.diesel .drow{display:flex;justify-content:space-between;align-items:baseline;font-size:10px;font-weight:700;color:var(--lab);letter-spacing:.06em;}',
    '.diesel .drow b{font-size:15px;color:var(--ink);font-weight:800;letter-spacing:0;}',
    '.diesel .dtrack{height:8px;border-radius:4px;background:#e8e9ea;margin-top:5px;overflow:hidden;}',
    '.diesel .dfill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--fx3),var(--fx2));}',
    '.diesel .dcap{font-size:9px;color:var(--lab);font-weight:600;margin-top:5px;letter-spacing:.02em;}',
    '.inv{display:flex;flex-direction:column;gap:6px;margin-top:8px;}',
    '.invrow{display:flex;align-items:baseline;gap:7px;}',
    '.invrow .n{font-size:20px;font-weight:800;line-height:1;min-width:28px;text-align:right;letter-spacing:-.02em;color:var(--ink);}',
    '.invrow .u{font-size:10px;font-weight:700;color:var(--lab);letter-spacing:.04em;text-transform:uppercase;}',
    '.invrow .p{font-size:10px;color:var(--lab);font-weight:600;margin-left:auto;text-align:right;line-height:1.3;}',
    '.invfoot{font-size:9px;color:var(--lab);font-weight:600;margin-top:8px;letter-spacing:.02em;}',
    '.invfoot b{color:var(--good);}',
    '.ctrow{display:flex;gap:8px;margin-top:8px;}',
    '.btn{display:flex;align-items:center;gap:9px;border-radius:13px;padding:0 12px;min-height:54px;background:#fafafa;border:1px solid var(--line);text-decoration:none;}',
    '.btn.call{flex:1.35;background:linear-gradient(100deg,var(--fx1),var(--fx2),var(--fx3));border:none;box-shadow:0 2px 6px rgba(171,84,145,.3);}',
    '.btn.map{flex:1;}',
    '.btn .ic{width:24px;height:24px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;}',
    '.btn .bt{min-width:0;}',
    '.btn .b1{font-size:13.5px;font-weight:800;line-height:1.1;letter-spacing:.01em;color:var(--ink);}',
    '.btn .b2{font-size:10px;color:var(--lab);font-weight:600;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.btn.call .b1{color:#fff;}.btn.call .b2{color:rgba(255,255,255,.85);}',
    '.carousel-wrap{position:relative;margin:9px 0 4px;}',
    '.carousel{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:13px;}',
    '.carousel::-webkit-scrollbar{display:none;}',
    '.slide{flex:0 0 86%;scroll-snap-align:center;position:relative;border-radius:13px;overflow:hidden;height:236px;border:1px solid #e0e1e3;background:#eceded;cursor:pointer;}',
    '.slide img{width:100%;height:100%;object-fit:cover;display:block;}',
    '.slide .cap{position:absolute;left:0;right:0;bottom:0;padding:16px 10px 6px;background:linear-gradient(transparent,rgba(20,20,22,.78));font-size:10px;letter-spacing:1px;color:#f2f3f4;font-family:Consolas,monospace;}',
    '.slide .zoom{position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:8px;background:rgba(20,20,22,.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;}',
    '.car-btn{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:none;background:rgba(255,255,255,.93);color:#5A595C;font-size:19px;font-weight:700;box-shadow:0 2px 8px rgba(40,40,44,.28);display:flex;align-items:center;justify-content:center;font-family:inherit;z-index:2;cursor:pointer;}',
    '.car-btn.prev{left:8px;}.car-btn.next{right:8px;}',
    '.dots{display:flex;gap:5px;justify-content:center;margin:8px 0 4px;}',
    '.dots i{width:6px;height:6px;border-radius:4px;background:#d6d7d9;transition:all .2s;}',
    '.dots i.on{background:#AB5491;width:16px;}',
    '.lb{position:fixed;inset:0;background:rgba(16,14,18,.97);z-index:50;display:none;flex-direction:column;}',
    '.lb.open{display:flex;}',
    '.lb-top{display:flex;align-items:center;padding:12px 16px;}',
    '.lb-count{font-size:13px;font-weight:700;letter-spacing:1.5px;color:#fff;}',
    '.lb-x{margin-left:auto;width:44px;height:44px;border-radius:50%;border:none;background:rgba(255,255,255,.13);color:#fff;font-size:17px;font-family:inherit;}',
    '.lb-img{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:0 8px;}',
    '.lb-img img{max-width:100%;max-height:100%;border-radius:10px;}',
    '.lb-nav{display:flex;align-items:center;gap:10px;padding:14px 16px 22px;}',
    '.lb-btn{width:72px;height:54px;border-radius:13px;border:none;flex:0 0 auto;background:rgba(255,255,255,.15);color:#fff;font-size:23px;font-weight:700;font-family:inherit;}',
    '.lb-cap{color:#BCBDC0;font-size:11px;letter-spacing:1px;font-family:Consolas,monospace;text-align:center;flex:1;}',
    '.ledgerhead{margin:14px 12px 2px;display:flex;align-items:center;gap:10px;font-size:10px;font-weight:800;letter-spacing:.2em;color:var(--lab);text-transform:uppercase;}',
    '.ledgerhead::before,.ledgerhead::after{content:"";flex:1;height:1px;background:var(--hair);}',
    'table{width:100%;border-collapse:collapse;margin-top:8px;}',
    '.readings tr.main td{padding:7px 4px;font-size:12.5px;font-weight:700;white-space:nowrap;color:var(--ink);border-bottom:1px solid #efeff0;}',
    '.readings th{font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--lab);text-transform:uppercase;text-align:left;padding:0 4px 4px;border-bottom:1px solid var(--hair);}',
    '.readings td.r,.readings th.r{text-align:right;}',
    '.usage td{padding:6px 4px;font-size:12.5px;border-bottom:1px solid #efeff0;}',
    '.usage tr:last-child td{border-bottom:none;}',
    '.usage .q{font-weight:800;text-align:right;white-space:nowrap;color:var(--ink);}',
    '.usage .pn{font-weight:600;color:#3c3b40;}',
    '.usage .nt{font-size:10px;color:var(--lab);}',
    '.specrow{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid #efeff0;}',
    '.specrow:last-of-type{border-bottom:none;}',
    '.specrow .mils{font-size:16px;font-weight:800;min-width:54px;letter-spacing:-.02em;color:var(--ink);}',
    '.specrow .mils span{font-size:9px;color:var(--lab);font-weight:700;letter-spacing:.04em;}',
    '.specrow .pname{font-size:12.5px;font-weight:700;color:var(--ink);}',
    '.specrow .prole{font-size:10px;color:var(--lab);font-weight:600;}',
    '.spectotal{font-size:10.5px;color:var(--lab);font-weight:700;margin-top:8px;letter-spacing:.05em;}',
    'ul.notes{list-style:none;margin-top:8px;}',
    'ul.notes li{font-size:12px;line-height:1.45;color:var(--sec);padding:5px 0 5px 16px;position:relative;font-weight:500;}',
    'ul.notes li::before{content:"";position:absolute;left:2px;top:11px;width:6px;height:6px;border-radius:2px;background:linear-gradient(135deg,var(--fx1),var(--fx3));}',
    'ul.notes b{color:var(--ink);}',
    '.money{border:1px solid transparent;background:linear-gradient(#fff,#fff) padding-box,linear-gradient(120deg,var(--fx1),var(--fx2),var(--fx3)) border-box;}',
    '.moneyrow{display:flex;align-items:flex-end;justify-content:space-between;margin-top:8px;}',
    '.money .amt{font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1;color:var(--ink);}',
    '.money .amt span{font-size:12px;font-weight:700;color:var(--lab);}',
    '.money .bal{text-align:right;font-size:10.5px;font-weight:700;color:var(--lab);line-height:1.5;}',
    '.money .dep{display:flex;align-items:center;gap:7px;margin-top:10px;font-size:11.5px;font-weight:600;color:var(--sec);}',
    '.money .dep .ck{width:18px;height:18px;border-radius:6px;background:var(--goodbg);color:var(--good);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;}',
    '.money .inv-status{font-size:9.5px;color:var(--lab);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:7px;}',
    '.stamps{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;}',
    '.stamp{display:flex;align-items:center;gap:6px;min-height:32px;padding:0 11px;border-radius:999px;background:var(--goodbg);border:1px solid rgba(20,133,79,.3);font-size:11px;font-weight:700;color:#2f5c45;}',
    '.stamp .ck{color:var(--good);font-weight:800;}',
    '.stamp.dim{background:#f3f3f4;border-color:#e0e1e3;color:var(--lab);}',
    '.stampsec{font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--lab);text-transform:uppercase;margin-top:10px;}',
    '.linksrow{display:flex;gap:8px;}',
    '.linksrow.pds{margin-top:8px;}',
    '.link{flex:1;min-height:40px;display:flex;align-items:center;justify-content:center;gap:6px;border-radius:11px;background:#fff;border:1px solid var(--line);font-size:9.5px;font-weight:700;color:var(--sec);letter-spacing:.02em;padding:6px;text-align:center;}',
    'a.link{text-decoration:none;}',
    '.pdstag{font-size:8px;font-weight:800;letter-spacing:.06em;color:#fff;background:linear-gradient(135deg,var(--fx2),var(--fx3));border-radius:5px;padding:2px 5px;}',
    '.footer{padding:14px 12px 26px;font-size:9px;color:var(--bord);font-weight:600;letter-spacing:.08em;text-align:center;text-transform:uppercase;}',
    /* colorized, separately-boxed sections (ported from the work-order drawer):
       blue conditions box + amber watch-out rows, FX-tinted section headers */
    '.secblock{margin-top:3px;}',
    '.sechead{font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;display:flex;align-items:center;gap:7px;margin:4px 2px 8px;}',
    '.sechead.cond-h{color:var(--fx3);}',
    '.sechead.watch-h{color:var(--fx1);}',
    '.cbox{background:#eff4fb;border:1px solid #d6e2f1;border-left:3px solid #4d78ab;border-radius:12px;padding:12px 14px;font-size:12.5px;line-height:1.55;color:#3a536f;}',
    '.wbox{list-style:none;padding:0;margin:0;border:1px solid #ecdcae;border-left:3px solid #d99a00;border-radius:12px;overflow:hidden;background:#fffaef;}',
    '.wbox li{padding:9px 12px;border-top:1px solid #f1e4c2;font-size:12.5px;line-height:1.45;color:#6b4e00;font-weight:600;}',
    '.wbox li:first-child{border-top:0;}',
    '.wbox li::before{content:"▸  ";color:#d99a00;font-weight:800;}',
    '.speclim{margin-bottom:9px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 10px 8px;}',
    '.speclim .gauges{justify-content:space-around;margin-top:0;}',
    '.planstrip{margin-top:14px;margin-bottom:6px;justify-content:space-around;}',
    '.pcsub{font-size:8px;font-weight:600;color:var(--lab);margin-top:2px;text-align:center;letter-spacing:.02em;line-height:1.2;}',
    '.worklabel{font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--lab);text-transform:uppercase;margin:10px 2px 8px;}',
    '.estday{margin-top:11px;}',
    '.estday:first-of-type{margin-top:6px;}',
    '.estdh{font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--fx2);text-transform:uppercase;margin-bottom:3px;}',
    '.tlnote{font-size:8.5px;color:var(--lab);font-weight:600;margin:1px 2px 5px;letter-spacing:.02em;}',
    '.tl{display:flex;gap:3px;margin-top:3px;}',
    '.tlblk{flex-basis:0;min-width:30px;background:linear-gradient(135deg,var(--fx1),var(--fx2));color:#fff;border-radius:7px;padding:6px 7px;overflow:hidden;}',
    '.tlblk.alt{background:linear-gradient(135deg,var(--fx2),var(--fx3));}',
    '.tlname{display:block;font-size:9.5px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.tlhr{display:block;font-size:9px;font-weight:800;opacity:.85;margin-top:1px;}',
    /* --- Site Wire (activity feed over the job\'s append tables) --- */
    '.wireday{display:flex;align-items:center;gap:9px;margin:16px 6px 3px;font-size:9.5px;font-weight:800;letter-spacing:.14em;color:var(--lab);text-transform:uppercase;}',
    '.wireday .dchip{background:linear-gradient(90deg,var(--fx2),var(--fx3));color:#fff;border-radius:999px;padding:2px 8px;font-size:8.5px;letter-spacing:.06em;}',
    '.witem{display:flex;gap:9px;align-items:flex-start;padding:6px;}',
    '.wtag{flex:0 0 auto;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;background:linear-gradient(135deg,var(--fx1),var(--fx3));box-shadow:0 1px 3px rgba(171,84,145,.25);}',
    '.wtag.sys{background:linear-gradient(135deg,#5A595C,#2c2b2f);}',
    '.wtag.cam{background:linear-gradient(135deg,var(--fx2),var(--fx3));}',
    '.wbub{flex:1;min-width:0;background:#fafafa;border:1px solid var(--line);border-radius:13px;padding:9px 11px;}',
    '.wbub .wt{font-size:9px;font-weight:700;letter-spacing:.07em;color:var(--lab);text-transform:uppercase;margin-bottom:3px;}',
    '.wbub .wb{font-size:12.5px;font-weight:600;color:var(--ink);line-height:1.45;}',
    '.wbub .wb b{font-weight:800;}',
    '.wusage{display:flex;flex-direction:column;gap:5px;}',
    '.wusage .ur{display:flex;justify-content:space-between;gap:10px;font-size:12px;}',
    '.wusage .ur .up{color:#3c3b40;font-weight:600;}',
    '.wusage .ur .uq{font-weight:800;white-space:nowrap;color:var(--ink);}',
    '.wphotos{display:flex;gap:6px;flex-wrap:wrap;}',
    '.wphotos img{width:62px;height:62px;object-fit:cover;border-radius:9px;border:1px solid #e0e1e3;}',
    '.wstart{text-align:center;font-size:9px;font-weight:700;letter-spacing:.2em;color:var(--bord);text-transform:uppercase;margin:14px 0 2px;}',
    '.capbar{display:flex;gap:8px;margin:14px 6px 4px;}',
    '.capbtn{flex:1;min-height:48px;display:flex;align-items:center;justify-content:center;gap:5px;border-radius:13px;font-size:12px;font-weight:800;color:var(--ink);background:#fafafa;border:1px solid var(--line);}',
    '.capbtn.primary{background:linear-gradient(100deg,var(--fx1),var(--fx2),var(--fx3));color:#fff;border:none;box-shadow:0 2px 6px rgba(171,84,145,.3);}',
    /* --- last-reading strip (Feature B) --- */
    '.capstrip{display:flex;align-items:center;gap:8px;margin:14px 6px 4px;padding:9px 12px;border-radius:12px;background:#f6f6f7;border:1px solid var(--line);font-size:11.5px;font-weight:700;color:var(--sec);cursor:pointer;}',
    '.capstrip .dotm{width:8px;height:8px;border-radius:50%;background:var(--good);flex:0 0 auto;}',
    '.capstrip .cslab{color:var(--lab);letter-spacing:.08em;text-transform:uppercase;font-size:9px;}',
    '.capstrip .csval{color:var(--ink);}',
    '.capstrip.alarm{background:#fdecec;border-color:#f4b6b6;color:#8f2020;}',
    '.capstrip.alarm .dotm{background:#d64545;}',
    /* --- ghost capture form (Feature A) --- */
    '.capov{position:fixed;inset:0;z-index:60;background:rgba(20,19,22,.5);display:flex;align-items:flex-end;justify-content:center;}',
    '.capov[hidden]{display:none;}',
    '.capcard{width:100%;max-width:480px;max-height:92vh;overflow-y:auto;background:#fff;border-radius:18px 18px 0 0;padding:16px 16px 22px;box-shadow:0 -6px 30px rgba(0,0,0,.28);}',
    '.caphead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}',
    '.caphead .capt{font-size:15px;font-weight:800;color:var(--ink);}',
    '.capx{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:#fafafa;font-size:14px;color:var(--sec);font-family:inherit;cursor:pointer;}',
    '.capfield{margin-bottom:12px;}',
    '.capfield > label{display:block;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--lab);margin-bottom:5px;}',
    '.capfield input,.capfield textarea{width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--ink);font-family:inherit;}',
    '.capfield textarea{min-height:52px;resize:vertical;}',
    '.capchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;}',
    '.capchip{padding:7px 12px;min-height:38px;border-radius:10px;border:1px solid var(--line);background:#fafafa;font-size:12.5px;font-weight:700;color:var(--sec);font-family:inherit;cursor:pointer;}',
    '.capchip.on{background:linear-gradient(100deg,var(--fx1),var(--fx3));color:#fff;border-color:transparent;}',
    '.capchips.csp .capchip{min-width:42px;justify-content:center;text-align:center;}',
    '.capsteppers{display:flex;gap:8px;margin-bottom:12px;}',
    '.capstep{flex:1;border:1px solid var(--line);border-radius:12px;padding:9px 6px;text-align:center;background:#fff;}',
    '.capstep > label{display:block;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--lab);margin-bottom:5px;}',
    '.stepline{display:flex;align-items:center;justify-content:space-between;gap:4px;}',
    '.stepbtn{width:38px;height:38px;flex:0 0 auto;border-radius:11px;border:1px solid var(--line);background:#fafafa;font-size:20px;font-weight:800;color:var(--fx2);font-family:inherit;line-height:1;cursor:pointer;}',
    '.stepval{font-size:18px;font-weight:800;color:var(--ink);letter-spacing:-.02em;white-space:nowrap;}',
    '.stepval .u{font-size:10px;color:var(--lab);font-weight:700;margin-left:1px;}',
    '.capverdict{margin:0 0 12px;padding:10px 12px;border-radius:11px;font-size:12.5px;font-weight:800;text-align:center;}',
    '.capverdict.ok{background:var(--goodbg);color:var(--good);border:1px solid rgba(20,133,79,.3);}',
    '.capverdict.bad{background:#fdecec;color:#a11;border:1px solid #f4b6b6;}',
    '.capsave{width:100%;min-height:52px;border:none;border-radius:13px;background:linear-gradient(100deg,var(--fx1),var(--fx2),var(--fx3));color:#fff;font-size:15px;font-weight:800;font-family:inherit;box-shadow:0 2px 8px rgba(171,84,145,.3);cursor:pointer;}',
    '.capfoot{text-align:center;font-size:11px;color:var(--good);font-weight:700;margin-top:9px;min-height:14px;}',
    '.capnote{text-align:center;font-size:9.5px;color:var(--lab);font-weight:600;margin:7px 6px 2px;letter-spacing:.02em;}'
  ].join("");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function money(n) { return "$" + Number(n || 0).toLocaleString("en-US"); }
  function initials(name) {
    var p = String(name || "").trim().split(/\s+/);
    return ((p[0] || "")[0] || "") + ((p[1] || "")[0] || "");
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return iso ? esc(iso) : "—";
    return MON[+m[2] - 1] + " " + (+m[3]);
  }
  var PHASE_LABEL = { "1-planning": "PLANNING", "2-active": "ACTIVE", "3-closeout": "CLOSEOUT", "4-archive": "ARCHIVE" };

  /* the gate the crew can act on now = first gate not fully checked */
  function currentGate(job) {
    var gi = (job._meta && job._meta.gateIndex) || [];
    for (var i = 0; i < gi.length; i++) {
      var g = gi[i], done = 0;
      g.boxes.forEach(function (b) { if (b.checked) done++; });
      if (g.boxes.length && done < g.boxes.length) return { g: g, done: done, total: g.boxes.length, idx: i };
    }
    return null; // all gates complete
  }

  /* ===== TILE BUILDERS (each returns HTML or "" to omit) ===== */

  function tIdStrip(job) {
    var sub = esc(job.customer || "") + (job.title ? " · " + esc(stripCustomer(job)) : "");
    var dayBar = "", dlab = "";
    if (job.dates && job.dates.start && job.dates.end) {
      // crude day X/N from start..end inclusive (calendar days)
      var s = Date.parse(job.dates.start), e = Date.parse(job.dates.end);
      if (s && e && e >= s) {
        var n = Math.round((e - s) / 86400000) + 1;
        var segs = "";
        for (var d = 0; d < n; d++) segs += '<div class="seg' + (d === 0 ? " today" : "") + '"></div>';
        dayBar = '<div class="daybar">' + segs + "</div>";
        dlab = '<div class="dlab">' + n + "-DAY · " + shortDate(job.dates.start).toUpperCase() + "–" + shortDate(job.dates.end).toUpperCase().replace(/^[A-Z]+ /, "") + "</div>";
      }
    }
    if (!dayBar) {
      dlab = '<div class="dlab">WON ' + shortDate(job.dates && job.dates.won).toUpperCase() +
        (job.dates && job.dates.requested ? " · WANTS " + esc(String(job.dates.requested).slice(0, 12)).toUpperCase() : "") + "</div>";
    }
    return '<div class="idstrip span2">' +
      '<div><div class="jobno"><span class="fxtext">#' + esc(job.jobNumber) + '</span></div>' +
      '<div class="jobsub">' + sub + "<br>" + (job.sqft ? Number(job.sqft).toLocaleString() + " sqft" : "") +
      " · won " + shortDate(job.dates && job.dates.won) + "</div></div>" +
      '<div class="idright">' + dayBar + dlab + "</div></div>";
  }
  function stripCustomer(job) {
    var t = job.title || "";
    var c = job.customer || "";
    if (c && t.indexOf(c) === 0) t = t.slice(c.length).replace(/^[\s\-–·]+/, "");
    return t;
  }

  function tContact(job) {
    var c = job.contact || {};
    var tel = String(c.phone || "").replace(/[^\d+]/g, "");
    return '<div class="tile span2" style="padding:12px 14px;">' +
      '<div class="tlabel"><span class="dot"></span>Site contact</div>' +
      '<div class="ctrow">' +
      '<a class="btn call" href="' + (tel ? "tel:" + tel : "#") + '">' +
      '<div class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>' +
      '<div class="bt"><div class="b1">' + esc(c.name || "Contact") + '</div><div class="b2">' + esc(c.phone || "") + ' · tap to call</div></div></a>' +
      '<a class="btn map" href="' + esc(job.maps || "#") + '" target="_blank" rel="noopener">' +
      '<div class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A595C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>' +
      '<div class="bt"><div class="b1">' + esc(addrLine1(job.address)) + '</div><div class="b2">' + esc(addrLine2(job.address)) + ' · Maps ↗</div></div></a>' +
      "</div></div>";
  }
  function addrLine1(a) { return String(a || "").split(",")[0] || "Site"; }
  function addrLine2(a) { var p = String(a || "").split(","); return (p[1] || "").trim() || ""; }

  /* Worker-card hero is phase-aware (Brad 2026-07-02): the live gate ring only
     shows for the ACTIVE (on-site) gate — planning/closeout gates are office/admin
     tasks that make no sense to a field worker. Before the crew mobilizes we show
     a plan-at-a-glance + upcoming field-work preview instead. */
  function tHero(job) {
    if (job.phase === "2-active") {
      var cg = currentActiveGate(job);
      return cg ? heroRing(job, cg) : heroDone(job, null);
    }
    if (job.phase === "3-closeout" || job.phase === "4-archive") return heroDone(job, null);
    return heroPlan(job); // planning / pre-site
  }

  /* first incomplete ACTIVE-phase gate (the live on-site checkpoint). Distinct
     from currentGate() — we never surface a planning/closeout gate on the hero. */
  function currentActiveGate(job) {
    var gi = (job._meta && job._meta.gateIndex) || [];
    for (var i = 0; i < gi.length; i++) {
      var g = gi[i];
      if (!/active/i.test(g.phase || "") || !g.boxes.length) continue;
      var done = 0; g.boxes.forEach(function (b) { if (b.checked) done++; });
      if (done < g.boxes.length) return { g: g, done: done, total: g.boxes.length, idx: i };
    }
    return null;
  }

  /* ACTIVE-phase gate ring — the live on-site checklist */
  function heroRing(job, cg) {
    var pct = cg.total ? cg.done / cg.total : 0;
    var circ = 2 * Math.PI * 64; // r=64
    var dash = (pct * circ).toFixed(1) + " " + circ.toFixed(1);
    var open = cg.g.boxes.filter(function (b) { return !b.checked; });
    var done = cg.g.boxes.filter(function (b) { return b.checked; });
    var chips = open.slice(0, 4).map(function (b) {
      var parts = splitItem(b.text);
      return '<div class="chip"><div class="box"></div><div><div class="ct">' + esc(parts.t) +
        '</div>' + (parts.s ? '<div class="cs">' + esc(parts.s) + "</div>" : "") + "</div></div>";
    }).join("");
    if (open.length > 4) chips += '<div class="chip" style="min-height:0;border:none;background:none;padding-left:12px"><div class="cs">+ ' + (open.length - 4) + " more open</div></div>";
    var doneRow = done.slice(0, 2).map(function (b) {
      return '<div class="donerow"><div class="ck">✓</div><s>' + esc(splitItem(b.text).t) + "</s></div>";
    }).join("");
    var gateNo = (job._meta && job._meta.gateIndex || []).indexOf(cg.g) >= 0 ? cg.g.gateName : cg.g.gateName;
    return '<div class="tile hero span2"><div class="head"><div>' +
      '<div class="tlabel"><span class="dot"></span>Now · ' + esc(PHASE_LABEL[job.phase] || "") + '</div>' +
      '<div class="gname">' + esc(cg.g.gateName) + '</div></div>' +
      '<div class="blocks">blocks<br>' + esc((cg.g.statusTarget || "next").replace(/-/g, " ")) + '</div></div>' +
      '<div class="herobody"><div class="ringwrap">' +
      '<svg width="150" height="150" viewBox="0 0 160 160"><defs><linearGradient id="fxg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#DD5061"/><stop offset="50%" stop-color="#AB5491"/><stop offset="100%" stop-color="#7A5896"/></linearGradient></defs>' +
      '<circle cx="80" cy="80" r="64" fill="none" stroke="#e8e9ea" stroke-width="15"/>' +
      '<circle cx="80" cy="80" r="64" fill="none" stroke="url(#fxg)" stroke-width="15" stroke-linecap="round" stroke-dasharray="' + dash + '" transform="rotate(-90 80 80)"/></svg>' +
      '<div class="ringcenter"><div class="big">' + cg.done + '<small>/' + cg.total + '</small></div><div class="cap">ITEMS DONE</div></div></div>' +
      '<div class="chips">' + chips + "</div></div>" + doneRow + "</div>";
  }

  /* off-site: all field work done (closeout/archive) or every gate clear */
  function heroDone(job, cg) {
    var closeout = job.phase === "3-closeout" || job.phase === "4-archive";
    return '<div class="tile hero span2"><div class="head"><div>' +
      '<div class="tlabel"><span class="dot"></span>' + (closeout ? "Site work done" : "All gates clear") + '</div>' +
      '<div class="gname">' + (closeout ? "Off site · closeout" : "Job complete") + '</div></div>' +
      '<div class="blocks">' + (closeout ? "admin<br>only" : "all<br>clear") + '</div></div>' +
      '<div class="donerow"><div class="ck">✓</div>' +
      (closeout ? "On-site work is complete — remaining steps are office/admin (invoice, PJA, warranty)."
                : "Every gate checked — nothing blocks this job.") + "</div></div>";
  }

  /* pre-site (planning) hero: NO office checklist. A plan-at-a-glance strip
     (scheduled days · expected crew-hours · budgeted material · start) plus a
     preview of the on-site field work the crew will do once they mobilize. */
  function heroPlan(job) {
    /* When the job has a ## Schedule estimate, the per-task view is the horizontal
       Estimated-schedule timeline rendered right below the hero — so the hero only
       previews the active-phase gate names as a fallback when there's no estimate. */
    var sched = scheduleRows(job), worklabel = "", work = "";
    if (!sched || !sched.length) {
      worklabel = "On-site work once you mobilize";
      var gi = (job._meta && job._meta.gateIndex) || [];
      work = gi.filter(function (g) { return /active/i.test(g.phase || "") && g.boxes.length; }).map(function (g) {
        return '<div class="chip"><div class="box"></div><div><div class="ct">' +
          esc(g.gateName.replace(/^Gate\s*\d+:\s*/i, "")) + '</div>' +
          '<div class="cs">' + g.boxes.length + " checkpoint" + (g.boxes.length === 1 ? "" : "s") + "</div></div></div>";
      }).join("");
    }
    var s = scheduledSummary(job), mat = materialSummary(job), tot = scheduleTotals(job);
    /* the estimate is the source of truth when present (its rows sum to the total
       crew-hours); else fall back to the scheduled window + expected_hours field */
    var days = tot ? tot.days + "d" : s.days;
    var daysSub = tot ? "estimated" : s.daysSub;
    var hoursVal = tot ? tot.crewHours : job.expectedHours;
    var crewN = tot ? tot.maxCrew : ((job.crew && job.crew.length) || 0);
    var dNum = tot ? tot.days : s.daysNum;
    var hoursBig = hoursVal ? hoursVal + "h" : "TBD";
    var hoursSub = hoursVal
      ? (crewN && dNum ? "≈ " + crewN + " crew × " + dNum + "d" : (dNum ? dNum + "d window" : "budgeted"))
      : "at scheduling";
    var strip =
      planCell(days, "Days", daysSub) +
      planCell(hoursBig, "Crew-hrs", hoursSub) +
      planCell(mat.big, "Material", mat.sub) +
      planCell(s.start, "Start", s.startSub);
    return '<div class="tile hero span2"><div class="head"><div>' +
      '<div class="tlabel"><span class="dot"></span>' + esc(PHASE_LABEL[job.phase] || "PLANNING") + ' · upcoming</div>' +
      '<div class="gname">Not on site yet</div></div>' +
      '<div class="blocks">field work<br>preview</div></div>' +
      '<div class="gauges planstrip">' + strip + "</div>" +
      (work ? '<div class="worklabel">' + worklabel + '</div><div class="chips">' + work + "</div>" : "") +
      "</div>";
  }
  function planCell(big, label, sub) {
    return '<div class="g"><div class="gv" style="font-size:15px">' + big + "</div>" +
      '<div class="gl">' + esc(label) + "</div>" +
      (sub ? '<div class="pcsub">' + esc(sub) + "</div>" : "") + "</div>";
  }
  function scheduledSummary(job) {
    var d = job.dates || {};
    var out = { days: "TBD", daysSub: "not scheduled", start: "—", startSub: "unscheduled", daysNum: null };
    if (d.start && d.end) {
      var s = Date.parse(d.start), e = Date.parse(d.end);
      if (s && e && e >= s) { var n = Math.round((e - s) / 86400000) + 1; out.days = n + "d"; out.daysSub = "on site"; out.daysNum = n; }
    }
    if (d.start) { out.start = shortDate(d.start); out.startSub = "mobilize"; }
    else if (d.requested) { out.start = shortDate(d.requested); out.startSub = "requested"; }
    return out;
  }
  function materialSummary(job) {
    var m = job.materials;
    if (!m || !m.rows || !m.rows.length) return { big: "TBD", sub: "not calc'd" };
    var kits = 0, boxes = 0, other = 0;
    m.rows.forEach(function (r) {
      var bring = String(r[r.length - 1] || "");
      var num = parseFloat(((/(\d[\d.,]*)/.exec(bring) || [])[1] || "0").replace(/,/g, "")) || 0;
      if (/kit/i.test(bring)) kits += num;
      else if (/box/i.test(bring)) boxes += num;
      else other += num;
    });
    var parts = [];
    if (kits) parts.push(kits + " kit" + (kits === 1 ? "" : "s"));
    if (boxes) parts.push(boxes + " box");
    var big = parts.length ? parts[0] : (other ? other + " u" : "—");
    var sub = parts.length > 1 ? "+ " + parts.slice(1).join(" · ") : (m.rows.length + " line" + (m.rows.length === 1 ? "" : "s"));
    return { big: big, sub: sub };
  }

  /* ## Schedule estimate table (day · task · crew · hours) -> [{day,task,crew,hours}].
     Tolerant to column order/naming; `hours` is the task's estimated duration. */
  function scheduleRows(job) {
    var s = job.schedule;
    if (!s || !s.rows || !s.rows.length) return null;
    var H = (s.header || []).map(function (h) { return String(h).toLowerCase(); });
    var ci = function (name) { for (var i = 0; i < H.length; i++) { if (H[i].indexOf(name) >= 0) return i; } return -1; };
    var cDay = ci("day"), cTask = ci("task"), cCrew = ci("crew"), cHrs = ci("hour");
    if (cHrs < 0) cHrs = ci("hr");
    return s.rows.map(function (r) {
      return {
        day: cDay >= 0 ? String(r[cDay] || "").trim() : "",
        task: cTask >= 0 ? (r[cTask] || "") : (r[0] || ""),
        crew: cCrew >= 0 ? (Number(r[cCrew]) || 0) : 0,
        hours: cHrs >= 0 ? (Number(r[cHrs]) || 0) : 0
      };
    });
  }
  function scheduleTotals(job) {
    var rows = scheduleRows(job);
    if (!rows || !rows.length) return null;
    var days = {}, crewHours = 0, maxCrew = 0;
    rows.forEach(function (t) {
      if (t.day) days[t.day] = true;
      crewHours += (t.crew || 0) * (t.hours || 0);
      if (t.crew > maxCrew) maxCrew = t.crew;
    });
    return { days: Object.keys(days).length || rows.length, crewHours: Math.round(crewHours), maxCrew: maxCrew };
  }
  /* full per-day / per-task estimate breakdown — "what was estimated per task"
     (Brad 2026-07-02, from the hand-drawn PROJECT SCHEDULE sheets). */
  function tScheduleEstimate(job) {
    var rows = scheduleRows(job);
    if (!rows || !rows.length) return "";
    var tot = scheduleTotals(job);
    var byDay = {}, order = [];
    rows.forEach(function (t) { var d = t.day || "—"; if (!byDay[d]) { byDay[d] = []; order.push(d); } byDay[d].push(t); });
    var dayHrsOf = function (d) { return byDay[d].reduce(function (a, t) { return a + (t.hours || 0); }, 0); };
    var maxHrs = Math.max.apply(null, order.map(dayHrsOf)) || 1;
    /* one horizontal bar per day (like the field PROJECT SCHEDULE sheet): each
       task is a block whose width ∝ its hours, and the whole bar's width ∝ the
       day's length, so shorter days read shorter. */
    var blocks = order.map(function (d) {
      var items = byDay[d], crew = items[0].crew, dayHrs = dayHrsOf(d);
      var segs = items.map(function (t, i) {
        return '<div class="tlblk' + (i % 2 ? " alt" : "") + '" style="flex-grow:' + (t.hours || 0.4) + '" title="' +
          esc(t.task) + " · " + (t.hours || 0) + 'h">' +
          '<span class="tlname">' + esc(t.task) + '</span><span class="tlhr">' + (t.hours ? t.hours + "h" : "") + "</span></div>";
      }).join("");
      var w = Math.max(34, Math.round(dayHrs / maxHrs * 100));
      return '<div class="estday"><div class="estdh">Day ' + esc(d) + (crew ? " · " + crew + " crew" : "") + " · " + dayHrs + "h</div>" +
        '<div class="tl" style="width:' + w + '%">' + segs + "</div></div>";
    }).join("");
    return '<div class="tile span2"><div class="tlabel"><span class="dot"></span>Estimated schedule' +
      (tot ? " · " + tot.days + " days · ~" + tot.crewHours + " crew-hrs" : "") + "</div>" +
      '<div class="tlnote">rough timeline — wider block = longer task, longer bar = longer day</div>' + blocks + "</div>";
  }

  /* split "Headline (detail)" or "Headline — detail" into title + sub */
  function splitItem(text) {
    var m = /^(.*?)\s*[—\-]\s*(.+)$/.exec(text) || /^(.*?)\s*\((.+)\)\s*$/.exec(text);
    if (m) return { t: m[1].trim(), s: m[2].trim() };
    return { t: text, s: "" };
  }

  function tBuildup(job) {
    if (!job.buildup || !job.buildup.length) return "";
    var rows = job.buildup.map(function (l) {
      return '<div class="stratum s-primer" style="height:auto;padding:7px 9px;background:#f3f3f4;color:#4c4b50"><span class="sl">' +
        esc(l.product || l.layer) + '</span><span class="sm">' + esc(l.dft || "") + "</span></div>";
    }).join("");
    return '<div class="tile span2" style="padding:12px 14px;">' +
      '<div class="tlabel"><span class="dot"></span>Buildup · ' + esc(job.system || "system") + '</div>' +
      '<div class="stack">' + rows + '<div class="stratum s-conc"></div></div>' +
      (job.systemDesc ? '<div class="stacknote">' + esc(job.systemDesc) + "</div>" : "") + "</div>";
  }

  function tMaterial(job) {
    var m = job.materials;
    if (!m || !m.rows || !m.rows.length) {
      return '<div class="tile h150"><div class="tlabel"><span class="dot"></span>Material to bring</div>' +
        '<div class="invfoot" style="margin-top:14px">Load list not calculated yet.</div></div>';
    }
    var rows = m.rows.slice(0, 4).map(function (r) {
      var bring = String(r[r.length - 1] || "");
      var nm = /(\d[\d.,]*)/.exec(bring);
      var n = nm ? nm[1] : "•";
      var u = /\bkits?\b/i.test(bring) ? "kits" : /\bbox(?:es)?\b/i.test(bring) ? "boxes"
        : /\bgal\b/i.test(bring) ? "gal" : /\blbs?\b/i.test(bring) ? "lb" : "";
      var prod = String(r[0] || "").replace(/\s*[-(].*$/, "");
      return '<div class="invrow"><span class="n">' + esc(n) + '</span><span class="u">' + esc(u) +
        '</span><span class="p">' + esc(prod.slice(0, 30)) + "</span></div>";
    }).join("");
    return '<div class="tile h150"><div class="tlabel"><span class="dot"></span>Material to bring</div>' +
      '<div class="inv">' + rows + '</div><div class="invfoot">load list · calculated + 25% buffer</div></div>';
  }

  /* Site-power tile. Crew assignment was temporarily removed here (Brad 2026-07-02:
     crew is tagged at scheduling and isn't worth the upkeep on the worker card yet —
     keeping Site power holds the tile + two-up layout with less to maintain).
     To restore crew: re-add a crew-chips row above the diesel block and set the
     label back to "Crew". */
  function tCrew(job) {
    return '<div class="tile h150"><div class="tlabel"><span class="dot"></span>Site power</div>' +
      '<div class="diesel" style="margin-top:16px">' +
      '<div class="dtrack"><div class="dfill" style="width:0"></div></div>' +
      '<div class="dcap">' + esc(powerNote(job)) + "</div></div></div>";
  }
  function powerNote(job) {
    var s = (job.scope || "") + " " + (job.conditions || "");
    if (/no 600|tow-behind generator|no site power|generator required/i.test(s)) return "tow-behind generator · log diesel daily";
    return "confirm site power at scheduling";
  }

  function tPrep(job) {
    var out = "";
    if (job.conditions) {
      out += '<div class="span2 secblock"><div class="sechead cond-h">⚠ Conditions &amp; spec limits</div>' +
        specLimits(job) +
        '<div class="cbox">' + esc(job.conditions) + "</div></div>";
    }
    var items = (job.watchouts && job.watchouts.length) ? job.watchouts : (job.prep ? [job.prep] : []);
    if (items.length) {
      var lis = items.slice(0, 8).map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("");
      out += '<div class="span2 secblock"><div class="sechead watch-h">🚩 Critical watch-outs</div>' +
        '<ul class="wbox">' + lis + "</ul></div>";
    }
    return out;
  }

  function tPhotos(job) {
    if (!job.photoUrls || !job.photoUrls.length) return "";
    return '<div class="tile span2" style="padding:12px 14px 8px;">' +
      '<div class="tlabel"><span class="dot"></span>Site photos · ' + job.photoUrls.length + '</div>' +
      '<div class="carousel-wrap"><div class="carousel" id="car"></div>' +
      '<button class="car-btn prev" onclick="carNav(-1)">‹</button><button class="car-btn next" onclick="carNav(1)">›</button></div>' +
      '<div class="dots" id="dots"></div></div>';
  }

  /* ---- below the fold ---- */
  function tReadings(job) {
    var u = job.readings;
    if (!u || !u.rows || !u.rows.length) return "";
    var head = "<tr>" + u.header.slice(0, 5).map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr>";
    var body = u.rows.map(function (r) {
      return '<tr class="main">' + r.slice(0, 5).map(function (c, i) { return '<td' + (i ? ' class="r"' : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return '<div class="tile span2"><div class="tilehead"><div class="tlabel"><span class="dot"></span>Readings / batch log</div></div>' +
      '<table class="readings">' + head + body + "</table></div>";
  }
  function tUsage(job) {
    var u = job.usage;
    return '<div class="tile span2"><div class="tilehead"><div class="tlabel"><span class="dot"></span>Product usage · PJA capture</div></div>' +
      (u && u.rows && u.rows.length
        ? '<table class="usage">' + u.rows.map(function (r) {
          return '<tr><td class="pn">' + esc(r[0]) + (r[2] ? ' <span class="nt">' + esc(r[2]) + "</span>" : "") + '</td><td class="q">' + esc(r[1] || "") + "</td></tr>";
        }).join("") + "</table>"
        : '<div class="invfoot" style="margin-top:8px">Nothing logged yet — first mix lands here once applying.</div>') + "</div>";
  }
  function tSpec(job) {
    if (!job.buildup || !job.buildup.length) return "";
    var rows = job.buildup.map(function (l) {
      var mils = /([\d.]+)/.exec(l.dft || "");
      return '<div class="specrow"><div class="mils">' + (mils ? mils[1] : "—") + '<span> MILS</span></div>' +
        '<div><div class="pname">' + esc(l.product || l.layer) + '</div><div class="prole">' + esc(l.layer || "") + "</div></div></div>";
    }).join("");
    return '<div class="tile span2 spec"><div class="tlabel"><span class="dot"></span>System spec · ' + esc(job.system || "") + '</div>' +
      rows + '<div class="spectotal">' + (job.sqft ? Number(job.sqft).toLocaleString() + " SQFT" : "") +
      (job.systemDesc ? " · " + esc(job.systemDesc.toUpperCase()) : "") + "</div></div>";
  }
  function tGateHistory(job) {
    var gi = (job._meta && job._meta.gateIndex) || [];
    if (!gi.length) return "";
    var byPhase = {};
    gi.forEach(function (g) { (byPhase[g.phase] = byPhase[g.phase] || []).push(g); });
    var blocks = Object.keys(byPhase).map(function (ph) {
      var stamps = byPhase[ph].map(function (g) {
        var done = 0; g.boxes.forEach(function (b) { if (b.checked) done++; });
        var full = g.boxes.length && done === g.boxes.length;
        return '<div class="stamp' + (full ? "" : " dim") + '">' + (full ? '<span class="ck">✓</span>' : "") +
          esc(g.gateName) + (full ? "" : " " + done + "/" + g.boxes.length) + "</div>";
      }).join("");
      return '<div class="stampsec">' + esc(ph) + '</div><div class="stamps">' + stamps + "</div>";
    }).join("");
    return '<div class="tile span2"><div class="tlabel"><span class="dot"></span>Gate history</div>' + blocks + "</div>";
  }
  /* NOT rendered on the worker/crew card (no financials for the field) — reserved for a
     future role-gated PM/office variant. See the assembly note in card.body. */
  function tMoney(job) {
    var m = job.money || {};
    if (!m.quote) return "";
    return '<div class="tile span2 money"><div class="tlabel"><span class="dot"></span>Money</div>' +
      '<div class="moneyrow"><div class="amt">' + money(m.quote) + '<span> + HST</span></div>' +
      '<div class="bal">balance<br>due on completion</div></div>' +
      (m.deposit ? '<div class="dep"><span class="ck">' + (m.depositDate ? "✓" : "·") + '</span>Deposit ' + money(m.deposit) +
        (m.depositDate ? " received " + shortDate(m.depositDate) : " — pending") + "</div>" : "") +
      '<div class="inv-status">' + (m.invoiced ? "invoiced " + shortDate(m.invoiced) : "not yet invoiced") + "</div></div>";
  }
  function tLinks(job) {
    var folder = job.jobFolder || (job._meta && job._meta.path) || "";
    var out = '<div class="span2 linksrow"><div class="link">⛁ ' + esc(folder) + '</div>' +
      (job.quoteDoc ? '<div class="link">⎙ ' + esc(job.quoteDoc) + "</div>" : "") + "</div>";
    /* product datasheets (PDS) from the ## Links section — real hyperlinks when the
       target is an http URL, reference chips (with the Sync path on hover) otherwise */
    var pds = (job.linksList || []).filter(function (l) { return /\bpds\b|datasheet|data sheet/i.test(l.label); });
    if (pds.length) {
      out += '<div class="span2 linksrow pds">' + pds.map(function (l) {
        var name = String(l.label).replace(/^\s*PDS[\s:.-]*/i, "");   // "PDS 288 Enviro-Pox" -> "288 Enviro-Pox"
        var inner = '<span class="pdstag">PDS</span> ' + esc(name);
        return l.url
          ? '<a class="link" href="' + esc(l.target) + '" target="_blank" rel="noopener">' + inner + "</a>"
          : '<div class="link" title="' + esc(l.target) + '">' + inner + "</div>";
      }).join("") + "</div>";
    }
    return out;
  }

  /* spec-limit gauges (>temp / <RH / MVT), parsed from the Conditions prose.
     Rendered inside the Conditions section above the blue box — no longer its own
     standalone tile (Brad 2026-07-02: killed the duplicate "Spec limits" tile). */
  /* pure spec-limit parser (exported, node-safe): pulls the numeric temp floor /
     RH ceiling out of the Conditions prose. Returns nulls when nothing parses —
     the capture verdict renders ONLY when a real limit is present. The gauges
     reuse it for display. (Ghost-Row Capture, 2026-07-03.) */
  card.parseSpecLimits = function (conditionsText) {
    var c = String(conditionsText || "");
    var tempMin = null, rhMax = null;
    var tm = /above\s*(\d+)\s*°?\s*C/i.exec(c); if (tm) tempMin = +tm[1];
    var rm = /(?:under|below)\s*(\d+)\s*%/i.exec(c); if (rm) rhMax = +rm[1];
    return { tempMin: tempMin, rhMax: rhMax };
  };
  function specLimits(job) {
    var lim = card.parseSpecLimits(job.conditions || "");
    var temp = "&gt;" + (lim.tempMin != null ? lim.tempMin : 15) + "°C";
    var rh = "&lt;" + (lim.rhMax != null ? lim.rhMax : 85) + "%";
    return '<div class="speclim"><div class="gauges">' +
      gaugeFrame("temp", temp) + gaugeFrame("rh", rh) + gaugeFrame("MVT", "test") + "</div></div>";
  }

  /* today (YYYY-MM-DD): tests + gen-sitewire inject global.TODAY; the browser
     falls back to the real local date. Kept node-safe (no top-level Date call). */
  function todayISO() {
    var g = (typeof globalThis !== "undefined" && globalThis) ||
      (typeof global !== "undefined" && global) || (typeof window !== "undefined" && window) || {};
    if (typeof g.TODAY === "string" && g.TODAY) return g.TODAY;
    var d = new Date();
    var p = function (n) { n = String(n); return n.length < 2 ? "0" + n : n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* column index of the first readings header whose name contains `needle` */
  function readCol(header, needle) {
    var H = (header || []).map(function (h) { return String(h).toLowerCase(); });
    for (var i = 0; i < H.length; i++) { if (H[i].indexOf(needle) >= 0) return i; }
    return -1;
  }

  /* capture recency signal (exported, node-safe) — reads ONLY job.phase +
     job.readings. `active` mirrors the capture bar (phase >= 2). `last` = the most
     recently appended reading; `outOfSpecToday` = a row dated today carries the ⚠
     spec flag in its notes. No quotas, no timers (Brad softened OWED-TODAY 07-03). */
  card.captureState = function (job) {
    var active = parseInt(String((job && job.phase) || ""), 10) >= 2;
    var rd = (job && job.readings) || {};
    var header = rd.header || [], rows = rd.rows || [];
    var cDate = readCol(header, "date"), cArea = readCol(header, "area"), cNotes = readCol(header, "note");
    var today = todayISO(), todayCount = 0, outOfSpecToday = false, last = null;
    rows.forEach(function (r) {
      if (cDate >= 0 && r[cDate] === today) {
        todayCount++;
        var note = cNotes >= 0 ? String(r[cNotes] || "") : "";
        if (note.indexOf("⚠") >= 0) outOfSpecToday = true;
      }
    });
    if (rows.length) {
      var lr = rows[rows.length - 1];
      last = { area: cArea >= 0 ? (lr[cArea] || "") : "", date: cDate >= 0 ? (lr[cDate] || "") : "" };
    }
    return { active: active, todayCount: todayCount, last: last, outOfSpecToday: outOfSpecToday };
  };

  /* ===== GHOST-ROW CAPTURE (Feature A) ===== */
  /* the ghost seeds + chip sources + spec limits, computed once from the parsed
     vault markdown (node-safe: no DOM). Embedded as JSON into the card document. */
  card.captureData = function (job) {
    var rd = (job && job.readings) || {}, header = rd.header || [], rows = rd.rows || [];
    var cArea = readCol(header, "area"), cBatch = readCol(header, "batch"),
      cMoist = readCol(header, "moist"), cTemp = readCol(header, "temp"),
      cRH = readCol(header, "rh"), cCsp = readCol(header, "csp");
    var last = rows.length ? rows[rows.length - 1] : null;
    var cell = function (c) { return last && c >= 0 ? (last[c] || "") : ""; };
    var seed = { area: cell(cArea), batch: cell(cBatch), CSP: cell(cCsp), moisture: cell(cMoist), temp: cell(cTemp), RH: cell(cRH) };
    var seen = {}, areas = [];
    rows.forEach(function (r) { var a = cArea >= 0 ? String(r[cArea] || "").trim() : ""; if (a && !seen[a]) { seen[a] = 1; areas.push(a); } });
    var pseen = {}, products = [];
    var pushP = function (p) { p = String(p || "").trim(); if (p && !pseen[p]) { pseen[p] = 1; products.push(p); } };
    (((job && job.materials) || {}).rows || []).forEach(function (r) { pushP(r[0]); });
    (((job && job.usage) || {}).rows || []).forEach(function (r) { pushP(r[0]); });
    return { seed: seed, areas: areas, products: products, spec: card.parseSpecLimits((job && job.conditions) || "") };
  };

  function stepMarkup(key, label, unit) {
    return '<div class="capstep" data-key="' + key + '" data-val="">' +
      '<label>' + label + '</label><div class="stepline">' +
      '<button type="button" class="stepbtn" data-dir="-1">−</button>' +
      '<span class="stepval"><span class="v">—</span><span class="u">' + unit + '</span></span>' +
      '<button type="button" class="stepbtn" data-dir="1">+</button></div></div>';
  }
  /* the hidden bottom-sheet form (static skeleton; the controller fills it from CAP) */
  function captureOverlay() {
    return '<div class="capov" id="capov" hidden><div class="capcard">' +
      '<div class="caphead"><span class="capt" id="capt">Log a reading</span>' +
      '<button type="button" class="capx" id="capx">✕</button></div>' +
      '<div id="capread">' +
      '<div class="capfield"><label>Area</label><input id="c-area" autocomplete="off"><div class="capchips" id="c-areachips"></div></div>' +
      '<div class="capfield"><label>CSP · surface profile</label><div class="capchips csp" id="c-csp"></div></div>' +
      '<div class="capsteppers">' + stepMarkup("moisture", "Moisture", "%") + stepMarkup("temp", "Temp", "°C") + stepMarkup("RH", "RH", "%") + '</div>' +
      '<div class="capverdict" id="c-verdict" hidden></div>' +
      '<div class="capfield"><label>WFT / DFT</label><input id="c-dft" autocomplete="off"><div class="capchips"><button type="button" class="capchip" id="c-nocoat">no coating applied</button></div></div>' +
      '<div class="capfield"><label>Batch # · one or more</label><input id="c-batch" autocomplete="off" placeholder="e.g. 288-A-2207, 248-C-1130"></div>' +
      '<div class="capfield"><label>Notes</label><textarea id="c-notes"></textarea></div></div>' +
      '<div id="capuse" hidden>' +
      '<div class="capfield"><label>Product</label><input id="u-name" autocomplete="off"><div class="capchips" id="u-prodchips"></div></div>' +
      '<div class="capfield"><label>Qty used</label><input id="u-qty" autocomplete="off" placeholder="e.g. 9 kits (27 gal)"></div>' +
      '<div class="capfield"><label>Notes</label><input id="u-notes" autocomplete="off"></div></div>' +
      '<button type="button" class="capsave" id="capsave">Save reading</button>' +
      '<div class="capfoot" id="capfoot"></div></div></div>';
  }

  /* capture controller — serialized via .toString() into the card document, so it
     is authored as normal JS (node --check validates it) instead of a hand-escaped
     mega-string. Runs INSIDE the iframe, self-contained (CAP + the DOM only). In the
     standalone exported card there is no parent window, so it returns immediately and
     the +Reading/+Batch bar stays inert exactly as before (spec: standalone inert). */
  function capController(CAP) {
    if (!(window.parent && window.parent !== window)) return;
    var ov = document.getElementById("capov");
    if (!ov) return;
    var kind = "reading";
    var STEP = { moisture: 0.1, temp: 1, RH: 5 };
    var $ = function (id) { return document.getElementById(id); };
    function num(x) { var m = /-?\d+(\.\d+)?/.exec(String(x == null ? "" : x)); return m ? parseFloat(m[0]) : null; }
    function chip(t, on) { return '<button type="button" class="capchip' + (on ? " on" : "") + '">' + t + "</button>"; }
    function fillCsp(sel) { var h = ""; for (var i = 1; i <= 9; i++) h += chip(i, String(sel) === String(i)); $("c-csp").innerHTML = h; }
    function fillChips(el, list) { var h = "", L = list || []; for (var i = 0; i < L.length; i++) h += chip(L[i], false); el.innerHTML = h; }
    function stepEl(key) { return document.querySelector('.capstep[data-key="' + key + '"]'); }
    function setStep(key, val) { var s = stepEl(key); if (!s) return; var blank = (val === "" || val == null); s.setAttribute("data-val", blank ? "" : val); s.querySelector(".v").textContent = blank ? "—" : val; }
    function getStep(key) { var s = stepEl(key); return s ? (s.getAttribute("data-val") || "") : ""; }
    function verdict() {
      var v = $("c-verdict"), sp = CAP.spec || {};
      if (kind !== "reading" || (sp.tempMin == null && sp.rhMax == null)) { v.hidden = true; return; }
      var t = num(getStep("temp")), rh = num(getStep("RH")), bad = [];
      if (sp.tempMin != null && t != null && t < sp.tempMin) bad.push("⚠ " + t + "°C — spec is >" + sp.tempMin + "°C");
      if (sp.rhMax != null && rh != null && rh > sp.rhMax) bad.push("⚠ " + rh + "% RH — spec is <" + sp.rhMax + "%");
      v.hidden = false;
      if (bad.length) { v.className = "capverdict bad"; v.innerHTML = bad.join("<br>"); }
      else { v.className = "capverdict ok"; v.textContent = "IN SPEC"; }
    }
    function specFlags() {
      var sp = CAP.spec || {}, t = num(getStep("temp")), rh = num(getStep("RH")), f = [];
      if (sp.tempMin != null && t != null && t < sp.tempMin) f.push("⚠ temp below " + sp.tempMin + "°C spec");
      if (sp.rhMax != null && rh != null && rh > sp.rhMax) f.push("⚠ RH above " + sp.rhMax + "% spec");
      return f;
    }
    function open(k) {
      kind = k; var read = (k === "reading");
      $("capread").hidden = !read; $("capuse").hidden = read;
      $("capt").textContent = read ? "Log a reading" : "Log product usage";
      $("capsave").textContent = read ? "Save reading" : "Save usage";
      $("capfoot").textContent = "";
      if (read) {
        var s = CAP.seed || {};
        $("c-area").value = s.area || ""; $("c-batch").value = s.batch || "";
        $("c-dft").value = ""; $("c-notes").value = "";
        fillCsp(s.CSP || ""); setStep("moisture", s.moisture || ""); setStep("temp", s.temp || ""); setStep("RH", s.RH || "");
        fillChips($("c-areachips"), CAP.areas || []); verdict();
      } else {
        $("u-name").value = ""; $("u-qty").value = ""; $("u-notes").value = "";
        fillChips($("u-prodchips"), CAP.products || []);
      }
      ov.hidden = false;
    }
    function close() { ov.hidden = true; try { window.parent.postMessage({ fxc: "capture-close" }, "*"); } catch (e) {} }
    function post(kindStr, row) { try { window.parent.postMessage({ fxc: "capture", kind: kindStr, row: row }, "*"); } catch (e) {} }
    function reghost(row) {
      CAP.seed = { area: row.area || "", batch: row.batch || "", CSP: row.CSP || "", moisture: row.moisture || "", temp: row.temp || "", RH: row.RH || "" };
      if (row.area && CAP.areas.indexOf(row.area) < 0) CAP.areas.push(row.area);
    }
    function save() {
      if (kind === "reading") {
        var picked = document.querySelector("#c-csp .capchip.on");
        var row = {
          area: $("c-area").value.trim(), batch: $("c-batch").value.trim(),
          CSP: picked ? picked.textContent : "", moisture: getStep("moisture"), temp: getStep("temp"), RH: getStep("RH"),
          dft: $("c-dft").value.trim(), notes: $("c-notes").value.trim()
        };
        var fl = specFlags(); if (fl.length) row.notes = (row.notes ? row.notes + " " : "") + fl.join(" ");
        post("reading", row); reghost(row);
        $("c-notes").value = ""; $("capfoot").textContent = "Saved ✓ — next row ready"; verdict();
      } else {
        var urow = { product: $("u-name").value.trim(), qty: $("u-qty").value.trim(), notes: $("u-notes").value.trim() };
        if (!urow.product) { $("capfoot").textContent = "Pick or type a product first"; return; }
        post("usage", urow);
        $("u-qty").value = ""; $("u-notes").value = ""; $("capfoot").textContent = "Saved ✓ — next row ready";
      }
    }
    var rb = $("cap-reading"); if (rb) rb.onclick = function () { open("reading"); };
    var bb = $("cap-batch"); if (bb) bb.onclick = function () { open("usage"); };
    var strip = $("capstrip"); if (strip) strip.onclick = function () { open("reading"); };
    $("capx").onclick = close;
    ov.onclick = function (e) { if (e.target === ov) close(); };
    $("capsave").onclick = save;
    $("c-nocoat").onclick = function () { $("c-dft").value = "no coating applied"; };
    $("c-csp").onclick = function (e) { var b = e.target.closest(".capchip"); if (!b) return; var all = $("c-csp").querySelectorAll(".capchip"); for (var i = 0; i < all.length; i++) all[i].classList.remove("on"); b.classList.add("on"); };
    $("c-areachips").onclick = function (e) { var b = e.target.closest(".capchip"); if (b) $("c-area").value = b.textContent; };
    $("u-prodchips").onclick = function (e) { var b = e.target.closest(".capchip"); if (b) $("u-name").value = b.textContent; };
    var sbtns = document.querySelectorAll(".capstep .stepbtn");
    for (var i = 0; i < sbtns.length; i++) {
      sbtns[i].onclick = function () {
        var st = this.closest(".capstep"), key = st.getAttribute("data-key");
        var dir = +this.getAttribute("data-dir"), step = STEP[key] || 1;
        var cur = num(st.getAttribute("data-val")); if (cur == null) cur = 0;
        var nv = Math.round((cur + dir * step) * 100) / 100; if (nv < 0) nv = 0;
        setStep(key, nv); verdict();
      };
    }
  }
  card.captureScript = function (job) {
    return "(" + capController.toString() + ")(" + JSON.stringify(card.captureData(job)) + ");";
  };
  function gaugeFrame(label, val) {
    return '<div class="g"><svg viewBox="0 0 100 60"><path d="M 12 55 A 38 38 0 0 1 88 55" fill="none" stroke="#e6e7e9" stroke-width="9" stroke-linecap="round"/>' +
      '<path d="M 12 55 A 38 38 0 0 1 88 55" fill="none" stroke="#cfe9dc" stroke-width="9" stroke-linecap="round"/></svg>' +
      '<div class="gv" style="font-size:13px">' + val + '</div><div class="gl">' + esc(label) + "</div></div>";
  }

  /* ===== SITE WIRE — activity feed built from the job's own append tables =====
     Sources (no git backend needed): ## Readings/batch log (dated → day-grouped),
     ## Product usage (roll-up), site photos, and milestones from frontmatter dates +
     gate state. `who` is deferred (Brad 2026-07-02): readings key off the area/station
     tag, usage renders as a roll-up — person avatars slot in later once a `who` column
     exists. No financials on this card. */
  var WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  function wireDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return WD[dt.getUTCDay()] + " " + MON[+m[2] - 1].toUpperCase() + " " + (+m[3]);
  }
  function dayNumber(job, iso) {
    if (!job.dates || !job.dates.start) return null;
    var s = Date.parse(job.dates.start), d = Date.parse(iso);
    if (!s || !d || d < s) return null;
    return Math.round((d - s) / 86400000) + 1;
  }
  function stationTag(area) {
    var a = String(area || "").toLowerCase();
    if (a.indexOf("floor") >= 0 || a.indexOf("slab") >= 0) return "FLR";
    if (a.indexOf("air") >= 0) return "AIR";
    if (a.indexOf("drum") >= 0 || a.indexOf("batch") >= 0) return "DRM";
    return (String(area || "").slice(0, 3) || "LOG").toUpperCase();
  }
  function wireItem(tagClass, tag, label, bodyHtml) {
    return '<div class="witem"><div class="wtag' + (tagClass ? " " + tagClass : "") + '">' + esc(tag) +
      '</div><div class="wbub"><div class="wt">' + esc(label) + '</div><div class="wb">' + bodyHtml + "</div></div></div>";
  }
  function tSiteWire(job) {
    var top = [], days = [], miles = [];

    /* dated reading/batch entries, grouped by day (newest first) */
    var rd = job.readings;
    if (rd && rd.rows && rd.rows.length) {
      var H = (rd.header || []).map(function (h) { return String(h).toLowerCase(); });
      var ci = function (name) { for (var i = 0; i < H.length; i++) { if (H[i].indexOf(name) >= 0) return i; } return -1; };
      var cDate = ci("date"), cArea = ci("area"), cMoist = ci("moist"), cTemp = ci("temp"), cRH = ci("rh"), cBatch = ci("batch"), cWft = ci("wft");
      var dayMap = {}, dayOrder = [];
      rd.rows.forEach(function (r) {
        var parts = [];
        if (cMoist >= 0 && r[cMoist]) parts.push("<b>" + esc(r[cMoist]) + "</b> moisture");
        if (cTemp >= 0 && r[cTemp]) parts.push("<b>" + esc(r[cTemp]) + "</b>");
        if (cRH >= 0 && r[cRH]) parts.push("<b>" + esc(r[cRH]) + "</b> RH");
        if (cBatch >= 0 && r[cBatch]) parts.push("batch <b>" + esc(r[cBatch]) + "</b>");
        if (cWft >= 0 && r[cWft]) parts.push("<b>" + esc(r[cWft]) + "</b> WFT/DFT");
        var area = cArea >= 0 ? (r[cArea] || "") : "";
        var d = (cDate >= 0 && r[cDate]) ? r[cDate] : "undated";
        if (!dayMap[d]) { dayMap[d] = []; dayOrder.push(d); }
        dayMap[d].push(wireItem("", stationTag(area), area || "reading", parts.join(" · ") || esc(r.filter(Boolean).join(" · "))));
      });
      dayOrder.sort().reverse();
      dayOrder.forEach(function (d) {
        var dn = dayNumber(job, d);
        days.push('<div class="wireday">' + (wireDate(d) || "LOGGED") +
          (dn ? ' · <span class="dchip">DAY ' + dn + "</span>" : "") + "</div>");
        dayMap[d].forEach(function (h) { days.push(h); });
      });
    }

    /* latest bucket (undated "now"): photos + usage roll-up */
    if (job.photoUrls && job.photoUrls.length) {
      var ph = job.photoUrls.slice(0, 4).map(function (u) { return '<img src="' + esc(u) + '" alt="">'; }).join("");
      top.push(wireItem("cam", "CAM", "Site photos · " + job.photoUrls.length, '<div class="wphotos">' + ph + "</div>"));
    }
    if (job.usage && job.usage.rows && job.usage.rows.length) {
      var urs = job.usage.rows.map(function (r) {
        return '<div class="ur"><span class="up">' + esc(r[0]) + (r[2] ? " · " + esc(r[2]) : "") +
          '</span><span class="uq">' + esc(r[1] || "") + "</span></div>";
      }).join("");
      top.push(wireItem("", "USE", "Product usage · PJA capture", '<div class="wusage">' + urs + "</div>"));
    }

    /* milestones — frontmatter dates + gate state; no stored per-event timestamps → undated */
    var gi = (job._meta && job._meta.gateIndex) || [];
    gi.forEach(function (g) {
      var d = 0; g.boxes.forEach(function (b) { if (b.checked) d++; });
      if (g.boxes.length && d === g.boxes.length) {
        miles.push(wireItem("sys", "✓", "Gate cleared · " + String(g.phase || "").replace(/^\d+-/, ""),
          "<b>" + esc(g.gateName) + "</b> — all " + g.boxes.length + " items checked"));
      }
    });
    if (job.dates && job.dates.won) {
      miles.push(wireItem("sys", "FXC", shortDate(job.dates.won) + " · deal won",
        "<b>" + esc(job.customer || job.title || ("#" + job.jobNumber)) + "</b>" +
        (job.sqft ? " — " + Number(job.sqft).toLocaleString() + " sqft" : "")));
    }

    var out = [];
    if (top.length) { out.push('<div class="wireday">Now · latest capture</div>'); out = out.concat(top); }
    out = out.concat(days);
    if (miles.length) { out.push('<div class="wireday">Milestones</div>'); out = out.concat(miles); }
    out.push('<div class="wstart">— start of #' + esc(job.jobNumber) + " —</div>");
    /* capture bar is on-site only — readings/batches/photos wait for the ACTIVE
       phase (Brad 2026-07-03); planning/closeout cards show why it's not live yet */
    var onSite = parseInt(String(job.phase || ""), 10) >= 2;
    var cap;
    if (onSite) {
      var cs = card.captureState(job);
      var strip;
      if (cs.last && cs.last.date) {
        strip = '<div class="capstrip' + (cs.outOfSpecToday ? " alarm" : "") + '" id="capstrip">' +
          '<span class="dotm"></span><span class="cslab">Last reading</span>' +
          '<span class="csval">' + (cs.last.area ? esc(cs.last.area) + " · " : "") + (wireDate(cs.last.date) || esc(cs.last.date)) + '</span>' +
          (cs.outOfSpecToday ? '<span class="csval" style="margin-left:auto">⚠ out of spec today</span>' : "") + "</div>";
      } else {
        strip = '<div class="capstrip" id="capstrip"><span class="dotm" style="background:var(--lab)"></span>' +
          '<span class="csval">No readings yet — tap to log the first</span></div>';
      }
      cap = strip +
        '<div class="capbar"><div class="capbtn primary" id="cap-reading">+ Reading</div>' +
        '<div class="capbtn" id="cap-batch">+ Batch</div><div class="capbtn">+ Photo</div></div>' +
        '<div class="capnote">each Save writes one role-stamped row to the vault · + Photo coming</div>';
    } else {
      cap = '<div class="capnote">Capture opens once the job is active on site.</div>';
    }
    return '<div class="span2">' + out.join("") + cap + "</div>";
  }

  /* ===== ASSEMBLE ===== */
  card.body = function (job) {
    /* chip mirrors the hero: the field gate name only when on site, else the stage */
    var hgate = job.phase === "2-active" ? currentActiveGate(job) : null;
    var statusChip = esc((PHASE_LABEL[job.phase] || "") + " · " + (hgate ? hgate.g.gateName : (job.stage || "in progress")));
    return '<div class="mast"><div class="brandrow">' +
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2 21 7.2 12 12.4 3 7.2z" fill="none" stroke="#DD5061" stroke-width="1.7" stroke-linejoin="round"/><path d="M3 11.4 12 16.6 21 11.4" fill="none" stroke="#AB5491" stroke-width="1.7" stroke-linejoin="round"/><path d="M3 15.6 12 20.8 21 15.6" fill="none" stroke="#7A5896" stroke-width="1.7" stroke-linejoin="round"/></svg>' +
      '<div class="wordmark">FX COATING</div><div class="day-chip">' + statusChip + "</div></div></div>" +
      '<div class="bento">' +
      tIdStrip(job) + tContact(job) + tHero(job) + tScheduleEstimate(job) +
      tBuildup(job) +
      tCrew(job) + tMaterial(job) +
      tPrep(job) + tPhotos(job) + tLinks(job) +
      '<div class="ledgerhead span2">Site Wire · ' + esc(job.jobNumber) + "</div>" +
      // Site Wire is the card's closing section — it ends on the +Reading/+Batch/+Photo bar, per the
      // 10-site-wire design. It supersedes the flat tReadings/tUsage/tGateHistory tiles. tSpec dropped
      // too: it duplicated the Buildup tile up top (products-by-layer). tMoney omitted — worker/crew
      // card shows NO financials (Brad 2026-07-02). tReadings/tUsage/tGateHistory/tSpec/tMoney are kept
      // defined below but unwired (reserved for a future role-gated PM/office variant, phase G).
      tSiteWire(job) +
      "</div>" +
      '<div class="footer">FXC FIELD · ' + esc(job.jobNumber) + " · VAULT IS CANONICAL</div>";
  };

  card.script = function (job) {
    var photos = (job.photoUrls || []).map(function (u, i) { return { src: u, cap: "PHOTO " + (i + 1) }; });
    return "(function(){var PHOTOS=" + JSON.stringify(photos) + ";" +
      "var car=document.getElementById('car'),dots=document.getElementById('dots');" +
      "if(car){PHOTOS.forEach(function(p,i){var s=document.createElement('div');s.className='slide';" +
      "s.innerHTML='<img src=\"'+p.src+'\" alt=\"\"><div class=\"cap\">'+p.cap+'</div><div class=\"zoom\">⤢</div>';" +
      "s.onclick=function(){openLb(i)};car.appendChild(s);var d=document.createElement('i');if(i===0)d.className='on';dots.appendChild(d);});}" +
      "function sw(){return car.firstElementChild?car.firstElementChild.offsetWidth+8:1;}" +
      "window.carNav=function(dir){car.scrollBy({left:dir*sw(),behavior:'smooth'});};" +
      "if(car)car.addEventListener('scroll',function(){var n=Math.round(car.scrollLeft/sw());Array.prototype.forEach.call(dots.children,function(d,i){d.className=i===n?'on':'';});});" +
      "var lb=document.getElementById('lb'),lbImg=document.getElementById('lbImg'),lbCap=document.getElementById('lbCap'),lbCount=document.getElementById('lbCount'),cur=0;" +
      "window.openLb=function(i){cur=i;paint();lb.classList.add('open');};window.closeLb=function(){lb.classList.remove('open');};" +
      "window.lbNav=function(d){cur=(cur+d+PHOTOS.length)%PHOTOS.length;paint();};" +
      "function paint(){if(!PHOTOS[cur])return;lbImg.src=PHOTOS[cur].src;lbCap.textContent=PHOTOS[cur].cap;lbCount.textContent=(cur+1)+' / '+PHOTOS.length;}" +
      "var cb=document.getElementById('cmpBar');if(cb)cb.onclick=function(){var b=document.getElementById('cmpBody');b.hidden=!b.hidden;};" +
      "})();";
  };

  /* full standalone document — iframe srcdoc in-app, and the worker-link file */
  card.doc = function (job) {
    return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>" + esc(job.jobNumber) + " — FX Field card</title><style>" + card.CSS + "</style></head><body>" +
      card.body(job) +
      captureOverlay() +
      '<div class="lb" id="lb"><div class="lb-top"><div class="lb-count" id="lbCount"></div><button class="lb-x" onclick="closeLb()">✕</button></div>' +
      '<div class="lb-img"><img id="lbImg" src="" alt=""></div>' +
      '<div class="lb-nav"><button class="lb-btn" onclick="lbNav(-1)">‹</button><div class="lb-cap" id="lbCap"></div><button class="lb-btn" onclick="lbNav(1)">›</button></div></div>' +
      "<script>" + card.script(job) + card.captureScript(job) + "<\/script></body></html>";
  };

  if (typeof module !== "undefined" && module.exports) module.exports = card;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
