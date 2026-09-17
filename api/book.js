// .HOSPIRE PRO — Réservations publiques (widget) : disponibilité réelle par table + réservation atomique + email
// Variables d'entorno en Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  (obligatorias)
//   RESEND_API_KEY                       (opcional; sin ella no se envía email pero la reserva se guarda)
//   RESEND_FROM  (opcional, por defecto: "reservations@hospireclub.com")

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]; // getUTCDay(): 0=Sun

function json(res, code, obj) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.status(code).json(obj);
}

// Convierte una hora "de pared" (date=YYYY-MM-DD, time=HH:MM) en una zona horaria a un Date UTC correcto (con DST).
function zonedToUtc(dateStr, timeStr, tz) {
  const naive = new Date(dateStr + "T" + timeStr + ":00Z");
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {}; fmt.formatToParts(naive).forEach(function (x) { p[x.type] = x.value; });
  let hour = p.hour === "24" ? "00" : p.hour;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
  const offset = asUTC - naive.getTime();
  return new Date(naive.getTime() - offset);
}
function hm(mins) { return ("0" + Math.floor(mins / 60)).slice(-2) + ":" + ("0" + (mins % 60)).slice(-2); }
function parseHM(s) { const m = String(s).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; }

async function sb(path, opts, URL, KEY) {
  opts = opts || {};
  const headers = Object.assign({ apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, opts.headers || {});
  const r = await fetch(URL + "/rest/v1/" + path, { method: opts.method || "GET", headers: headers, body: opts.body });
  const txt = await r.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { ok: r.ok, status: r.status, data: data };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 200, {});
  const URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!URL || !KEY) return json(res, 500, { error: "Config Supabase manquante" });

  // --- Parámetros comunes ---
  let q = req.query || {};
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const blogId = String((req.method === "POST" ? b.blogId : q.blogId) || "").trim();
  if (!blogId) return json(res, 400, { error: "blogId requis" });

  // --- Cargar configuración + mesas ---
  const cfgR = await sb("resa_config?blog_id=eq." + encodeURIComponent(blogId) + "&select=data", {}, URL, KEY);
  const cfg = (cfgR.data && cfgR.data[0] && cfgR.data[0].data) || {};
  const turn = parseInt(cfg.turn, 10) || 90;
  const step = parseInt(cfg.step, 10) || 30;
  const tz = cfg.tz || "Europe/Paris";
  const windows = cfg.windows || {};
  const tblR = await sb("resa_tables?blog_id=eq." + encodeURIComponent(blogId) + "&active=eq.true&select=id,name,seats&order=seats.asc", {}, URL, KEY);
  const tables = (tblR.data || []).map(function (t) { return { id: t.id, name: t.name, seats: +t.seats }; });

  function tablesFor(party) { return tables.filter(function (t) { return t.seats >= party; }); }
  async function dayReservations(dateStr) {
    const start = zonedToUtc(dateStr, "00:00", tz), end = new Date(start.getTime() + 36 * 3600 * 1000);
    const r = await sb("reservations?blog_id=eq." + encodeURIComponent(blogId) + "&status=neq.cancelled&table_id=not.is.null&date_time=gte." + start.toISOString() + "&date_time=lt." + end.toISOString() + "&select=table_id,date_time,end_time", {}, URL, KEY);
    return (r.data || []).map(function (x) { return { table_id: x.table_id, s: new Date(x.date_time).getTime(), e: new Date(x.end_time).getTime() }; });
  }
  function freeTable(cands, existing, sMs, eMs) {
    for (let i = 0; i < cands.length; i++) {
      const t = cands[i];
      const clash = existing.some(function (r) { return r.table_id === t.id && r.s < eMs && r.e > sMs; });
      if (!clash) return t;
    }
    return null;
  }

  // ================================================================
  // BEAUTÉ (Modèle A) : praticien + durée par prestation.
  // Activé quand resa_config.data.mode === 'beauty'. N'affecte pas le resto.
  // ================================================================
  const beauty = (cfg.mode === "beauty");
  let staff = [];
  if (beauty) {
    const stR = await sb("resa_staff?blog_id=eq." + encodeURIComponent(blogId) + "&active=eq.true&select=id,name&order=sort.asc", {}, URL, KEY);
    staff = (stR.data || []).map(function (s) { return { id: s.id, name: s.name }; });
  }
  function reqDur(v) { var n = parseInt(v, 10); return (n && n > 0) ? n : turn; }
  async function dayResaStaff(dateStr) {
    const start = zonedToUtc(dateStr, "00:00", tz), end = new Date(start.getTime() + 36 * 3600 * 1000);
    const r = await sb("reservations?blog_id=eq." + encodeURIComponent(blogId) + "&status=neq.cancelled&staff_id=not.is.null&date_time=gte." + start.toISOString() + "&date_time=lt." + end.toISOString() + "&select=staff_id,date_time,end_time", {}, URL, KEY);
    return (r.data || []).map(function (x) { return { staff_id: x.staff_id, s: new Date(x.date_time).getTime(), e: new Date(x.end_time).getTime() }; });
  }
  function freeStaff(cands, existing, sMs, eMs) {
    for (let i = 0; i < cands.length; i++) {
      const st = cands[i];
      const clash = existing.some(function (r) { return r.staff_id === st.id && r.s < eMs && r.e > sMs; });
      if (!clash) return st;
    }
    return null;
  }

  // ----- BEAUTÉ GET : disponibilité (durée de la prestation, praticien optionnel) -----
  if (beauty && req.method === "GET") {
    const date = String(q.date || "").trim();
    const dur = reqDur(q.dur);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: "date invalide (YYYY-MM-DD)" });
    if (!staff.length) return json(res, 200, { slots: [], reason: "no_staff" });
    const wantStaff = String(q.staffId || "").trim();
    const cands = wantStaff ? staff.filter(function (s) { return s.id === wantStaff; }) : staff;
    if (!cands.length) return json(res, 200, { slots: [], reason: "staff_unknown" });
    const wkey = DAY_KEYS[new Date(date + "T12:00:00Z").getUTCDay()];
    const wins = windows[wkey] || [];
    if (!wins.length) return json(res, 200, { slots: [], reason: "closed" });
    const existing = await dayResaStaff(date);
    const now = Date.now();
    const slots = [];
    wins.forEach(function (w) {
      const a = parseHM(w.start), z = parseHM(w.end);
      if (a == null || z == null) return;
      for (let t = a; t + dur <= z; t += step) { // le RDV doit finir avant la fermeture
        const sUtc = zonedToUtc(date, hm(t), tz).getTime();
        if (sUtc < now + 60 * 60 * 1000) continue;
        const eUtc = sUtc + dur * 60000;
        if (freeStaff(cands, existing, sUtc, eUtc)) slots.push(hm(t));
      }
    });
    return json(res, 200, { slots: slots, dur: dur, staff: staff });
  }

  // ----- BEAUTÉ POST : réserver (atomique par praticien) -----
  if (beauty && req.method === "POST" && !b.action && !(b.group === true || b.group === "true" || b.mode === "group")) {
    const date = String(b.date || "").trim(), time = String(b.time || "").trim();
    const dur = reqDur(b.dur || b.service_dur);
    const service = String(b.service || "").trim().slice(0, 200);
    const name = String(b.name || "").trim().slice(0, 120);
    const phone = String(b.phone || "").trim().slice(0, 40);
    const email = String(b.email || "").trim().slice(0, 160);
    const notes = String(b.notes || "").trim().slice(0, 500);
    const brandName = String(b.brandName || "").trim().slice(0, 80) || "L'institut";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return json(res, 400, { error: "date/heure invalides" });
    if (!name) return json(res, 400, { error: "Nom requis" });
    if (!phone && !email) return json(res, 400, { error: "Téléphone ou email requis" });
    if (!b.consent) return json(res, 400, { error: "Consentement requis" });
    if (!staff.length) return json(res, 400, { error: "Réservation en ligne non configurée" });
    const sUtc = zonedToUtc(date, time, tz);
    const eUtc = new Date(sUtc.getTime() + dur * 60000);
    const wantStaff = String(b.staffId || "").trim();
    const cands = wantStaff ? staff.filter(function (s) { return s.id === wantStaff; }) : staff;
    if (!cands.length) return json(res, 409, { error: "Praticien indisponible." });
    const existing = await dayResaStaff(date);
    const ft = freeStaff(cands, existing, sUtc.getTime(), eUtc.getTime());
    if (!ft) return json(res, 409, { error: "Ce créneau n'est plus disponible." });
    const ordered = [ft].concat(cands.filter(function (s) { return s.id !== ft.id; }));
    let saved = null;
    for (let i = 0; i < ordered.length; i++) {
      const st = ordered[i];
      const payload = {
        blog_id: blogId, name: name, phone: phone, email: email, contact: (phone || email),
        covers: 1, adults: 1, children: 0, date_time: sUtc.toISOString(), end_time: eUtc.toISOString(),
        staff_id: st.id, table_id: null, service: service, service_dur: dur,
        source: "site", notes: notes, status: "confirmed", consent: true
      };
      const ins = await sb("reservations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }, URL, KEY);
      if (ins.ok) { saved = { id: (ins.data && ins.data[0] && ins.data[0].id) || null, staff: st.name }; break; }
      const msg = JSON.stringify(ins.data || "");
      if (msg.indexOf("no_overlap") >= 0 || ins.status === 409) continue; // praticien pris par une course → suivant
      break;
    }
    if (!saved) return json(res, 409, { error: "Ce créneau vient d'être réservé. Merci de choisir un autre horaire." });
    const emailed = await sendConfirm({ brandName: brandName, name: name, email: email, sUtc: sUtc, party: 1, service: service, staff: saved.staff, tz: tz, phone: cfg.phone || "", replyTo: cfg.email || b.replyTo, beauty: true });
    await sendOwnerNotif({ brandName: brandName, name: name, sUtc: sUtc, party: 1, service: service, staff: saved.staff, notes: notes, contact: (phone || email), tz: tz, ownerEmail: cfg.email, beauty: true });
    return json(res, 200, { ok: true, id: saved.id, staff: saved.staff, emailed: emailed });
  }

  // ====== GET : disponibilidad ======
  if (req.method === "GET") {
    const date = String(q.date || "").trim();
    const party = parseInt(q.party, 10) || 2;
    const isGroup = String(q.group || "") === "1" || String(q.group || "") === "true";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: "date invalide (YYYY-MM-DD)" });
    // ---- Mode GROUPE : tous les créneaux du service (sans filtrer par disponibilité de table) ----
    if (isGroup) {
      const wkeyG = DAY_KEYS[new Date(date + "T12:00:00Z").getUTCDay()];
      const winsG = windows[wkeyG] || [];
      if (!winsG.length) return json(res, 200, { slots: [], reason: "closed", group: true });
      const nowG = Date.now(); const slotsG = [];
      winsG.forEach(function (w) {
        const a = parseHM(w.start), z = parseHM(w.end);
        if (a == null || z == null) return;
        for (let t = a; t < z; t += step) {
          const sUtc = zonedToUtc(date, hm(t), tz).getTime();
          if (sUtc < nowG + 60 * 60 * 1000) continue;
          slotsG.push(hm(t));
        }
      });
      return json(res, 200, { slots: slotsG, turn: turn, group: true });
    }
    if (!tables.length) return json(res, 200, { slots: [], reason: "no_tables" });
    const cands = tablesFor(party);
    if (!cands.length) return json(res, 200, { slots: [], reason: "party_too_big" });
    const wkey = DAY_KEYS[new Date(date + "T12:00:00Z").getUTCDay()];
    const wins = windows[wkey] || [];
    if (!wins.length) return json(res, 200, { slots: [], reason: "closed" });
    const existing = await dayReservations(date);
    const now = Date.now();
    const slots = [];
    wins.forEach(function (w) {
      const a = parseHM(w.start), z = parseHM(w.end);
      if (a == null || z == null) return;
      for (let t = a; t < z; t += step) {
        const sUtc = zonedToUtc(date, hm(t), tz).getTime();
        if (sUtc < now + 60 * 60 * 1000) continue; // au moins 1h à l'avance
        const eUtc = sUtc + turn * 60000;
        if (freeTable(cands, existing, sUtc, eUtc)) slots.push(hm(t));
      }
    });
    return json(res, 200, { slots: slots, turn: turn });
  }

  // ====== POST action=notify : envoyer une confirmation (réservation créée dans l'app) ======
  if (req.method === "POST" && b.action === "notify") {
    const email = String(b.email || "").trim();
    if (!email) return json(res, 400, { error: "email requis" });
    const emailed = await sendConfirm({
      brandName: String(b.brandName || (b.beauty ? "L'institut" : "Le restaurant")).slice(0, 80), name: String(b.name || "").slice(0, 120),
      email: email, sUtc: new Date(b.dt || Date.now()), party: parseInt(b.party, 10) || 1,
      allergens: String(b.allergens || "").slice(0, 300), tz: tz, phone: cfg.phone || "", replyTo: cfg.email || b.replyTo,
      beauty: !!b.beauty, service: String(b.service || "").slice(0, 120), staff: String(b.staff || "").slice(0, 80)
    });
    return json(res, 200, { ok: true, emailed: emailed });
  }

  // ====== POST action=refuse : email amical de refus (demande de groupe non retenue) ======
  if (req.method === "POST" && b.action === "refuse") {
    const email = String(b.email || "").trim();
    if (!email) return json(res, 400, { error: "email requis" });
    const emailed = await sendRefusal({
      brandName: String(b.brandName || "Le restaurant").slice(0, 80), name: String(b.name || "").slice(0, 120),
      email: email, sUtc: new Date(b.dt || Date.now()), party: parseInt(b.party, 10) || 1,
      tz: tz, phone: cfg.phone || "", replyTo: cfg.email || b.replyTo
    });
    return json(res, 200, { ok: true, emailed: emailed });
  }

  // ====== POST group=true : demande de GROUPE (en attente de confirmation) ======
  if (req.method === "POST" && (b.group === true || b.group === "true" || b.mode === "group")) {
    const date = String(b.date || "").trim(), time = String(b.time || "").trim();
    const party = parseInt(b.party, 10) || 0;
    const children = Math.max(0, parseInt(b.children, 10) || 0);
    const name = String(b.name || "").trim().slice(0, 120);
    const phone = String(b.phone || "").trim().slice(0, 40);
    const email = String(b.email || "").trim().slice(0, 160);
    const allergens = String(b.allergens || "").trim().slice(0, 300);
    const notes = String(b.notes || "").trim().slice(0, 500);
    const brandName = String(b.brandName || "").trim().slice(0, 80) || "Le restaurant";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return json(res, 400, { error: "date/heure invalides" });
    if (!name || party < 1) return json(res, 400, { error: "Nom et nombre de convives requis" });
    if (!phone && !email) return json(res, 400, { error: "Téléphone ou email requis" });
    if (!b.consent) return json(res, 400, { error: "Consentement requis" });
    const sUtc = zonedToUtc(date, time, tz);
    const eUtc = new Date(sUtc.getTime() + turn * 60000);
    const payload = {
      blog_id: blogId, name: name, phone: phone, email: email, contact: (phone || email),
      adults: Math.max(1, party - children), children: children, covers: party,
      date_time: sUtc.toISOString(), end_time: eUtc.toISOString(), table_id: null,
      source: "site-groupe", allergens: allergens, notes: notes, status: "pending", consent: true
    };
    const ins = await sb("reservations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }, URL, KEY);
    if (!ins.ok) return json(res, 500, { error: "Impossible d'enregistrer la demande. Réessaie." });
    await sendOwnerNotif({ brandName: brandName, name: name, sUtc: sUtc, party: party, allergens: allergens, notes: notes, contact: (phone || email), tz: tz, ownerEmail: cfg.email, group: true });
    return json(res, 200, { ok: true, pending: true, id: (ins.data && ins.data[0] && ins.data[0].id) || null });
  }

  // ====== POST action=cancel : email d'annulation (réservation confirmée annulée par le restaurant) ======
  if (req.method === "POST" && b.action === "cancel") {
    const email = String(b.email || "").trim();
    if (!email) return json(res, 400, { error: "email requis" });
    const emailed = await sendCancellation({
      brandName: String(b.brandName || "Le restaurant").slice(0, 80), name: String(b.name || "").slice(0, 120),
      email: email, sUtc: new Date(b.dt || Date.now()), party: parseInt(b.party, 10) || 1,
      tz: tz, phone: cfg.phone || "", replyTo: cfg.email || b.replyTo
    });
    return json(res, 200, { ok: true, emailed: emailed });
  }

  // ====== POST action=remind : email « on vous attend » (client en retard) ======
  if (req.method === "POST" && b.action === "remind") {
    const email = String(b.email || "").trim();
    if (!email) return json(res, 400, { error: "email requis" });
    const emailed = await sendWaiting({
      brandName: String(b.brandName || "Le restaurant").slice(0, 80), name: String(b.name || "").slice(0, 120),
      email: email, sUtc: new Date(b.dt || Date.now()), party: parseInt(b.party, 10) || 1,
      tz: tz, phone: cfg.phone || "", replyTo: cfg.email || b.replyTo
    });
    return json(res, 200, { ok: true, emailed: emailed });
  }

  // ====== POST : réserver (atomique) ======
  if (req.method === "POST") {
    const date = String(b.date || "").trim(), time = String(b.time || "").trim();
    const party = parseInt(b.party, 10) || 0;
    const children = Math.max(0, parseInt(b.children, 10) || 0);
    const name = String(b.name || "").trim().slice(0, 120);
    const phone = String(b.phone || "").trim().slice(0, 40);
    const email = String(b.email || "").trim().slice(0, 160);
    const allergens = String(b.allergens || "").trim().slice(0, 300);
    const notes = String(b.notes || "").trim().slice(0, 500);
    const brandName = String(b.brandName || "").trim().slice(0, 80) || "Le restaurant";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return json(res, 400, { error: "date/heure invalides" });
    if (!name || party < 1) return json(res, 400, { error: "Nom et nombre de convives requis" });
    if (!b.consent) return json(res, 400, { error: "Consentement requis" });
    if (!tables.length) return json(res, 400, { error: "Réservation en ligne non configurée" });

    const sUtc = zonedToUtc(date, time, tz);
    const eUtc = new Date(sUtc.getTime() + turn * 60000);
    const cands = tablesFor(party);
    if (!cands.length) return json(res, 409, { error: "Aucune table ne peut accueillir " + party + " personnes." });

    // Intento por cada mesa libre; la restricción de exclusión de Postgres garantiza que no haya solape aunque haya carrera.
    const existing = await dayReservations(date);
    let ordered = cands.slice();
    const ft = freeTable(cands, existing, sUtc.getTime(), eUtc.getTime());
    if (!ft) return json(res, 409, { error: "Ce créneau n'est plus disponible." });
    // poner la mesa elegida primero, luego el resto como respaldo ante carreras
    ordered = [ft].concat(cands.filter(function (t) { return t.id !== ft.id; }));

    let saved = null, lastErr = null;
    for (let i = 0; i < ordered.length; i++) {
      const t = ordered[i];
      const payload = {
        blog_id: blogId, name: name, phone: phone, email: email,
        contact: (phone || email), adults: Math.max(1, party - children), children: children, covers: party,
        date_time: sUtc.toISOString(), end_time: eUtc.toISOString(), table_id: t.id,
        source: "site", allergens: allergens, notes: notes, status: "confirmed", consent: true
      };
      const ins = await sb("reservations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }, URL, KEY);
      if (ins.ok) { saved = { id: (ins.data && ins.data[0] && ins.data[0].id) || null, table: t.name }; break; }
      lastErr = ins;
      const msg = JSON.stringify(ins.data || "");
      if (msg.indexOf("no_overlap") >= 0 || ins.status === 409) continue; // mesa ocupada por carrera → probar siguiente
      break; // otro error → parar
    }
    if (!saved) return json(res, 409, { error: "Ce créneau vient d'être réservé. Merci de choisir un autre horaire." });

    // Email de confirmación al cliente (si Resend configurado y hay email)
    const emailed = await sendConfirm({ brandName: brandName, name: name, email: email, sUtc: sUtc, party: party, allergens: allergens, tz: tz, phone: cfg.phone || "", replyTo: cfg.email || b.replyTo });
    // Notification au restaurant (nouvelle réservation)
    await sendOwnerNotif({ brandName: brandName, name: name, sUtc: sUtc, party: party, allergens: allergens, notes: notes, contact: (phone || email), tz: tz, ownerEmail: cfg.email, table: saved.table, group: false });
    return json(res, 200, { ok: true, id: saved.id, table: saved.table, emailed: emailed });
  }

  return json(res, 405, { error: "Méthode non autorisée" });
};

function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }

async function sendOwnerNotif(o) {
  const RK = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  const to = String(o.ownerEmail || "").trim();
  if (!RK || !to) return false;
  try {
    const dt = new Date(o.sUtc).toLocaleString("fr-FR", { timeZone: o.tz || "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const party = o.party || 1;
    const isG = !!o.group;
    const title = isG ? "NOUVELLE DEMANDE DE GROUPE" : (o.beauty ? "NOUVEAU RENDEZ-VOUS" : "NOUVELLE RÉSERVATION");
    const accent = isG ? "#C4A265" : "#2E9E6B";
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1A1510">' +
      '<div style="background:#1A1510;color:#F5F0E8;padding:20px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:600">' + esc(o.brandName) + '</div><div style="color:' + accent + ';font-size:13px;letter-spacing:.05em">' + title + '</div></div>' +
      '<div style="border:1px solid #EAE4D9;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px">' +
      (isG ? '<p style="font-size:15px;line-height:1.6"><b>Une demande de groupe attend ta confirmation.</b> Ouvre l\'app .HOSPIRE PRO → Réservations pour l\'accepter. Le client sera prévenu automatiquement.</p>' : '<p style="font-size:15px;line-height:1.6">' + (o.beauty ? 'Un nouveau rendez-vous vient d\'arriver depuis ton site.' : 'Une nouvelle réservation vient d\'arriver depuis ton site.') + '</p>') +
      '<table style="font-size:14px;line-height:2;margin:8px 0">' +
      '<tr><td>👤</td><td style="padding-left:8px">' + esc(o.name) + '</td></tr>' +
      (o.beauty && o.service ? '<tr><td>💅</td><td style="padding-left:8px">' + esc(o.service) + '</td></tr>' : '') +
      '<tr><td>📅</td><td style="padding-left:8px">' + esc(dt) + '</td></tr>' +
      (o.beauty ? (o.staff ? '<tr><td>👩</td><td style="padding-left:8px">Avec ' + esc(o.staff) + '</td></tr>' : '') : '<tr><td>👥</td><td style="padding-left:8px">' + party + ' personne' + (party > 1 ? 's' : '') + '</td></tr>') +
      (o.contact ? '<tr><td>📞</td><td style="padding-left:8px">' + esc(o.contact) + '</td></tr>' : '') +
      (o.table ? '<tr><td>🍽️</td><td style="padding-left:8px">Table : ' + esc(o.table) + '</td></tr>' : '') +
      (o.allergens ? '<tr><td>⚠️</td><td style="padding-left:8px">' + esc(o.allergens) + '</td></tr>' : '') +
      (o.notes ? '<tr><td>📝</td><td style="padding-left:8px">' + esc(o.notes) + '</td></tr>' : '') +
      '</table>' +
      '<p style="font-size:12.5px;color:#8C857A">.HOSPIRE PRO — ton foyer digital</p>' +
      '</div></div>';
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RK, "Content-Type": "application/json" },
      body: JSON.stringify({ from: esc(o.brandName) + " <" + FROM + ">", to: [to], subject: (isG ? "🔔 Demande de groupe — " : (o.beauty ? "🔔 Nouveau rendez-vous — " : "🔔 Nouvelle réservation — ")) + o.brandName, html: html })
    });
    return er.ok;
  } catch (e) { return false; }
}

async function sendWaiting(o) {
  const RK = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  if (!RK || !o.email) return false;
  try {
    const dt = new Date(o.sUtc).toLocaleString("fr-FR", { timeZone: o.tz || "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const party = o.party || 1;
    const tel = (o.phone || "").replace(/\s+/g, "");
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1A1510">' +
      '<div style="background:#1A1510;color:#F5F0E8;padding:20px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:600">' + esc(o.brandName) + '</div><div style="color:#C4A265;font-size:13px;letter-spacing:.05em">ON VOUS ATTEND 🕐</div></div>' +
      '<div style="border:1px solid #EAE4D9;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px;font-size:15px;line-height:1.65">' +
      '<p>Bonjour ' + esc(o.name) + ',</p>' +
      '<p>Votre table pour <b>' + party + ' personne' + (party > 1 ? 's' : '') + '</b> (' + esc(dt) + ') vous attend chez ' + esc(o.brandName) + ' !</p>' +
      '<p>On garde votre place encore un petit moment. Si vous êtes en route, à tout de suite 🙂' + (tel ? (' Si vous avez un empêchement ou du retard, prévenez-nous vite au <a href="tel:' + esc(tel) + '" style="color:#B5904E;text-decoration:none;font-weight:600">' + esc(o.phone) + '</a>.') : ' Si vous avez un empêchement, prévenez-nous vite, merci.') + '</p>' +
      '<p style="color:#8C857A;font-size:13.5px">À très vite,<br>' + esc(o.brandName) + '</p>' +
      '</div></div>';
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RK, "Content-Type": "application/json" },
      body: JSON.stringify({ from: esc(o.brandName) + " <" + FROM + ">", to: [o.email], subject: "On vous attend chez " + o.brandName + " 🕐", html: html, reply_to: o.replyTo || undefined })
    });
    return er.ok;
  } catch (e) { return false; }
}

async function sendCancellation(o) {
  const RK = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  if (!RK || !o.email) return false;
  try {
    const dt = new Date(o.sUtc).toLocaleString("fr-FR", { timeZone: o.tz || "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const party = o.party || 1;
    const tel = (o.phone || "").replace(/\s+/g, "");
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1A1510">' +
      '<div style="background:#1A1510;color:#F5F0E8;padding:20px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:600">' + esc(o.brandName) + '</div><div style="color:#C9564F;font-size:13px;letter-spacing:.05em">RÉSERVATION ANNULÉE</div></div>' +
      '<div style="border:1px solid #EAE4D9;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px;font-size:15px;line-height:1.65">' +
      '<p>Bonjour ' + esc(o.name) + ',</p>' +
      '<p>Nous devons malheureusement annuler votre réservation prévue le <b>' + esc(dt) + '</b> (' + party + ' personne' + (party > 1 ? 's' : '') + '). Nous en sommes sincèrement désolés pour la gêne occasionnée.</p>' +
      '<p style="margin:14px 0"><b>Pour reprogrammer :</b><br>• Choisissez un nouveau créneau depuis notre page de réservation.<br>' + (tel ? ('• Ou appelez-nous au <a href="tel:' + esc(tel) + '" style="color:#B5904E;text-decoration:none;font-weight:600">' + esc(o.phone) + '</a>, nous ferons le maximum pour vous trouver une place.') : '• Ou contactez-nous directement, nous ferons le maximum pour vous accueillir.') + '</p>' +
      '<p style="color:#8C857A;font-size:13.5px">Avec toutes nos excuses, et au plaisir de vous recevoir,<br>' + esc(o.brandName) + '</p>' +
      '</div></div>';
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RK, "Content-Type": "application/json" },
      body: JSON.stringify({ from: esc(o.brandName) + " <" + FROM + ">", to: [o.email], subject: "Annulation de votre réservation chez " + o.brandName, html: html, reply_to: o.replyTo || undefined })
    });
    return er.ok;
  } catch (e) { return false; }
}

async function sendRefusal(o) {
  const RK = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  if (!RK || !o.email) return false;
  try {
    const dt = new Date(o.sUtc).toLocaleString("fr-FR", { timeZone: o.tz || "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const party = o.party || 1;
    const tel = (o.phone || "").replace(/\s+/g, "");
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1A1510">' +
      '<div style="background:#1A1510;color:#F5F0E8;padding:20px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:600">' + esc(o.brandName) + '</div><div style="color:#C4A265;font-size:13px;letter-spacing:.05em">À PROPOS DE VOTRE DEMANDE</div></div>' +
      '<div style="border:1px solid #EAE4D9;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px;font-size:15px;line-height:1.65">' +
      '<p>Bonjour ' + esc(o.name) + ',</p>' +
      '<p>Merci beaucoup pour votre demande de réservation pour <b>' + party + ' personne' + (party > 1 ? 's' : '') + '</b> le ' + esc(dt) + '.</p>' +
      '<p>Malheureusement, nous ne pouvons pas vous accueillir sur ce créneau. Nous en sommes vraiment désolés — l\'envie d\'accueillir votre groupe, elle, y est totalement !</p>' +
      '<p style="margin:14px 0"><b>Deux options :</b><br>• Retentez votre chance sur <b>une autre date</b> depuis notre page de réservation.<br>' + (tel ? ('• Appelez-nous au <a href="tel:' + esc(tel) + '" style="color:#B5904E;text-decoration:none;font-weight:600">' + esc(o.phone) + '</a> pour trouver ensemble la meilleure solution pour votre groupe.') : '• Contactez-nous directement pour organiser votre venue.') + '</p>' +
      '<p style="color:#8C857A;font-size:13.5px">Au plaisir de vous recevoir très bientôt,<br>' + esc(o.brandName) + '</p>' +
      '</div></div>';
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RK, "Content-Type": "application/json" },
      body: JSON.stringify({ from: esc(o.brandName) + " <" + FROM + ">", to: [o.email], subject: "Votre demande de réservation chez " + o.brandName, html: html, reply_to: o.replyTo || undefined })
    });
    return er.ok;
  } catch (e) { return false; }
}

async function sendConfirm(o) {
  const RK = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  if (!RK || !o.email) return false;
  try {
    const dt = new Date(o.sUtc).toLocaleString("fr-FR", { timeZone: o.tz || "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const party = o.party || 1;
    const html =
      '<div style="font-family:Georgia,serif;max-width:520px;margin:auto;color:#1A1510">' +
      '<div style="background:#1A1510;color:#F5F0E8;padding:20px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:600">' + esc(o.brandName) + '</div><div style="color:#C4A265;font-size:13px;letter-spacing:.05em">' + (o.beauty ? 'RENDEZ-VOUS CONFIRMÉ' : 'RÉSERVATION CONFIRMÉE') + '</div></div>' +
      '<div style="border:1px solid #EAE4D9;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px;font-family:Arial,sans-serif">' +
      '<p style="font-size:15px">Bonjour ' + esc(o.name) + ',</p>' +
      '<p style="font-size:15px;line-height:1.6">' + (o.beauty ? 'Votre rendez-vous est confirmé. Voici le récapitulatif :' : 'Votre table est réservée. Voici le récapitulatif :') + '</p>' +
      '<table style="font-size:14px;line-height:2;margin:8px 0">' +
      (o.beauty && o.service ? '<tr><td>💅</td><td style="padding-left:8px">' + esc(o.service) + '</td></tr>' : '') +
      '<tr><td>📅</td><td style="padding-left:8px">' + esc(dt) + '</td></tr>' +
      (o.beauty ? (o.staff ? '<tr><td>👩</td><td style="padding-left:8px">Avec ' + esc(o.staff) + '</td></tr>' : '') : '<tr><td>👥</td><td style="padding-left:8px">' + party + ' personne' + (party > 1 ? 's' : '') + '</td></tr>') +
      (o.allergens ? '<tr><td>⚠️</td><td style="padding-left:8px">Allergènes : ' + esc(o.allergens) + '</td></tr>' : '') +
      '</table>' +
      '<p style="font-size:13px;color:#8C857A;line-height:1.6">Une question, une modification ou une annulation ?' + (o.phone ? (' Appelez-nous au <a href="tel:' + esc(o.phone).replace(/\s+/g, '') + '" style="color:#B5904E;text-decoration:none">' + esc(o.phone) + '</a>.') : ' Contactez directement le restaurant.') + '</p>' +
      '<p style="font-size:13px;color:#8C857A">À très bientôt,<br>' + esc(o.brandName) + '</p>' +
      '</div></div>';
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RK, "Content-Type": "application/json" },
      body: JSON.stringify({ from: esc(o.brandName) + " <" + FROM + ">", to: [o.email], subject: (o.beauty ? "Votre rendez-vous chez " : "Votre réservation chez ") + o.brandName + " ✓", html: html, reply_to: o.replyTo || undefined })
    });
    return er.ok;
  } catch (e) { return false; }
}
