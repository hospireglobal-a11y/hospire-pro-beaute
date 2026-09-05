// .HOSPIRE PRO — Rappels automatiques (cron quotidien)
// Envía un email de recordatorio a las reservas de MAÑANA (status confirmed, con email, no recordadas aún).
// Se ejecuta desde Vercel Cron (ver vercel.json). Protegido por CRON_SECRET.
// Variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, RESEND_FROM (opcional), CRON_SECRET

const TZ = "Europe/Paris";

function zonedToUtc(dateStr, timeStr, tz) {
  const naive = new Date(dateStr + "T" + timeStr + ":00Z");
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {}; fmt.formatToParts(naive).forEach(function (x) { p[x.type] = x.value; });
  const hour = p.hour === "24" ? "00" : p.hour;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
  return new Date(naive.getTime() - (asUTC - naive.getTime()));
}
function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }

async function sbREST(URL, KEY, path, opts) {
  opts = opts || {};
  const headers = Object.assign({ apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, opts.headers || {});
  const r = await fetch(URL + "/rest/v1/" + path, { method: opts.method || "GET", headers: headers, body: opts.body });
  const txt = await r.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { ok: r.ok, status: r.status, data: data };
}

async function sendReminder(o) {
  const RK = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  if (!RK || !o.email) return false;
  try {
    const dt = new Date(o.sUtc).toLocaleString("fr-FR", { timeZone: o.tz || TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const html =
      '<div style="font-family:Georgia,serif;max-width:520px;margin:auto;color:#1A1510">' +
      '<div style="background:#1A1510;color:#F5F0E8;padding:20px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:600">' + esc(o.brandName) + '</div><div style="color:#C4A265;font-size:13px;letter-spacing:.05em">' + (o.beauty ? 'RAPPEL DE RENDEZ-VOUS' : 'RAPPEL DE RÉSERVATION') + '</div></div>' +
      '<div style="border:1px solid #EAE4D9;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px;font-family:Arial,sans-serif">' +
      '<p style="font-size:15px">Bonjour ' + esc(o.name) + ',</p>' +
      '<p style="font-size:15px;line-height:1.6">Petit rappel : nous vous attendons <b>demain</b> !</p>' +
      '<table style="font-size:14px;line-height:2;margin:8px 0">' +
      (o.beauty && o.service ? '<tr><td>💅</td><td style="padding-left:8px">' + esc(o.service) + '</td></tr>' : '') +
      '<tr><td>📅</td><td style="padding-left:8px">' + esc(dt) + '</td></tr>' +
      (o.beauty ? '' : '<tr><td>👥</td><td style="padding-left:8px">' + (o.party || 1) + ' personne' + ((o.party || 1) > 1 ? 's' : '') + '</td></tr>') +
      '</table>' +
      '<p style="font-size:13px;color:#8C857A;line-height:1.6">Un empêchement ?' + (o.phone ? (' Appelez-nous au <a href="tel:' + esc(o.phone).replace(/\s+/g, '') + '" style="color:#B5904E;text-decoration:none">' + esc(o.phone) + '</a> pour nous prévenir.') : ' Merci de nous prévenir.') + '</p>' +
      '<p style="font-size:13px;color:#8C857A">À demain,<br>' + esc(o.brandName) + '</p>' +
      '</div></div>';
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RK, "Content-Type": "application/json" },
      body: JSON.stringify({ from: esc(o.brandName) + " <" + FROM + ">", to: [o.email], subject: "Rappel : votre " + (o.beauty ? "rendez-vous" : "réservation") + " demain chez " + o.brandName, html: html, reply_to: o.replyTo || undefined })
    });
    return er.ok;
  } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  // Multi-projet (1 code, N déploiements Vercel) : un SEUL projet doit exécuter le cron
  // (tous partagent la même base). Mets CRON_DISABLED=1 sur les projets secondaires (ex. beauté)
  // pour éviter les rappels en double ; le projet principal (resto) garde le cron actif.
  if ((process.env.CRON_DISABLED || "") === "1") return res.status(200).json({ ok: true, skipped: "cron disabled on this project" });
  // Seguridad: Vercel Cron añade "Authorization: Bearer <CRON_SECRET>" si CRON_SECRET está configurada.
  const SECRET = (process.env.CRON_SECRET || "").trim();
  const auth = req.headers["authorization"] || "";
  const keyq = (req.query && req.query.key) || "";
  if (SECRET && auth !== "Bearer " + SECRET && keyq !== SECRET) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  const URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!URL || !KEY) return res.status(500).json({ error: "Config Supabase manquante" });

  // Rango de MAÑANA en Europe/Paris
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const todayLocal = nowParts; // YYYY-MM-DD
  const tmr = new Date(new Date(todayLocal + "T12:00:00Z").getTime() + 24 * 3600 * 1000);
  const tmrStr = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(tmr);
  const start = zonedToUtc(tmrStr, "00:00", TZ);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);

  const q = "reservations?select=id,blog_id,name,email,date_time,covers,adults,children,service&status=eq.confirmed&reminded=eq.false&email=not.is.null&date_time=gte." + start.toISOString() + "&date_time=lt." + end.toISOString();
  const r = await sbREST(URL, KEY, q);
  const rows = (r.data || []).filter(function (x) { return x.email; });

  const cfgCache = {};
  async function cfgFor(blogId) {
    if (cfgCache[blogId]) return cfgCache[blogId];
    const c = await sbREST(URL, KEY, "resa_config?blog_id=eq." + encodeURIComponent(blogId) + "&select=data");
    const data = (c.data && c.data[0] && c.data[0].data) || {};
    cfgCache[blogId] = data; return data;
  }

  let sent = 0;
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i];
    const cfg = await cfgFor(x.blog_id);
    const party = x.covers || ((+x.adults || 0) + (+x.children || 0)) || 1;
    const _beauty = (cfg.mode === "beauty");
    const ok = await sendReminder({
      brandName: cfg.name || (_beauty ? "L'institut" : "Le restaurant"), name: x.name || "", email: x.email,
      sUtc: new Date(x.date_time), party: party, service: x.service || "", beauty: _beauty,
      phone: cfg.phone || "", tz: cfg.tz || TZ, replyTo: cfg.email || undefined
    });
    if (ok) {
      await sbREST(URL, KEY, "reservations?id=eq." + x.id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ reminded: true }) });
      sent++;
    }
  }
  return res.status(200).json({ ok: true, tomorrow: tmrStr, candidates: rows.length, sent: sent });
};
