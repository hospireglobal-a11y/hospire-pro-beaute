// .HOSPIRE PRO — Email marketing : campagnes vers la base clients du restaurateur
// Seguridad: cada envío exige el token de sesión del dueño; solo puede enviar a SU marca.
// Env (ya existentes): SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, RESEND_FROM, CRON_SECRET

const crypto = require("crypto");

function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
function nl2br(s) { return esc(s).replace(/\r?\n/g, "<br>"); }
function sign(secret, blogId, email) {
  return crypto.createHmac("sha256", String(secret)).update(String(blogId) + "|" + String(email).toLowerCase()).digest("hex").slice(0, 32);
}
function json(res, code, obj) { res.status(code).setHeader("Content-Type", "application/json; charset=utf-8"); return res.send(JSON.stringify(obj)); }

function emailHtml(o) {
  // o: {brandName, title, message, imageUrl, ctaText, ctaUrl, unsubUrl, phone, address}
  var img = o.imageUrl ? '<tr><td style="padding:0 0 22px"><img src="' + esc(o.imageUrl) + '" alt="" style="display:block;width:100%;max-width:560px;border-radius:14px"></td></tr>' : "";
  var cta = (o.ctaUrl && o.ctaText) ? '<tr><td align="center" style="padding:6px 0 26px"><a href="' + esc(o.ctaUrl) + '" style="background:#C4A265;color:#1A1510;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:100px;display:inline-block">' + esc(o.ctaText) + '</a></td></tr>' : "";
  var info = [o.address ? esc(o.address) : "", o.phone ? esc(o.phone) : ""].filter(Boolean).join(" · ");
  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F5F0E8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:28px 12px"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +
    '<tr><td align="center" style="padding:0 0 18px;font-family:Georgia,serif;font-size:24px;font-weight:700;color:#1A1510">' + esc(o.brandName) + '</td></tr>' +
    '<tr><td style="background:#FFFFFF;border-radius:18px;padding:30px 28px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    img +
    (o.title ? '<tr><td style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1A1510;padding:0 0 12px">' + esc(o.title) + '</td></tr>' : "") +
    '<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#3d372f;padding:0 0 22px">' + nl2br(o.message) + '</td></tr>' +
    cta +
    (info ? '<tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8C857A;border-top:1px solid #EAE4D9;padding:16px 0 0">' + info + '</td></tr>' : "") +
    '</table></td></tr>' +
    '<tr><td align="center" style="padding:20px 10px;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#8C857A;line-height:1.7">' +
    'Envoyé avec ♥ par ' + esc(o.brandName) + ' via <a href="https://hospireclub.com" style="color:#C4A265;font-weight:700;text-decoration:none">.HOSPIRE&nbsp;PRO</a><br>' +
    '<a href="' + esc(o.unsubUrl) + '" style="color:#8C857A;text-decoration:underline">Se désinscrire de ces emails</a>' +
    '</td></tr></table></td></tr></table></body></html>';
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const URL_ = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  const RESEND = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  const SECRET = (process.env.CRON_SECRET || "").trim();
  if (!URL_ || !KEY) return json(res, 500, { error: "Config manquante" });
  const SH = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

  // ====== GET action=unsub : lien de désinscription (public, protégé par signature) ======
  if (req.method === "GET" && (req.query.action || "") === "unsub") {
    const blogId = String(req.query.b || "").trim();
    const email = String(req.query.e || "").trim().toLowerCase();
    const t = String(req.query.t || "").trim();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const page = function (msg) {
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Désinscription</title></head>' +
        '<body style="margin:0;background:#F5F0E8;font-family:Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">' +
        '<div style="background:#fff;border-radius:18px;padding:38px 34px;max-width:420px;text-align:center;box-shadow:0 10px 40px rgba(26,21,16,.08)">' +
        '<div style="font-size:34px;margin-bottom:12px">✉️</div><div style="font-size:16px;line-height:1.6;color:#1A1510">' + msg + '</div>' +
        '<div style="margin-top:18px;font-size:11px;color:#8C857A">.HOSPIRE PRO</div></div></body></html>';
    };
    if (!blogId || !email || !SECRET || t !== sign(SECRET, blogId, email)) return res.status(400).send(page("Lien de désinscription invalide ou expiré."));
    try {
      await fetch(URL_ + "/rest/v1/marketing_unsubs", {
        method: "POST",
        headers: Object.assign({ Prefer: "resolution=ignore-duplicates" }, SH),
        body: JSON.stringify({ blog_id: blogId, email: email })
      });
    } catch (e) {}
    return res.status(200).send(page("C'est fait — vous ne recevrez plus d'offres de cet établissement.<br><br>Vos réservations, elles, continueront d'être confirmées par email normalement."));
  }

  if (req.method !== "POST") return json(res, 405, { error: "POST requis" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const blogId = String(b.blogId || "").trim();
  if (!blogId) return json(res, 400, { error: "blogId requis" });
  if (!b.token) return json(res, 401, { error: "Session requise" });

  // ====== Auth : le token doit appartenir au propriétaire de CETTE marque (ou à l'admin) ======
  try {
    const ur = await fetch(URL_ + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + b.token } });
    const ut = await ur.text(); let u = {}; try { u = JSON.parse(ut); } catch (e) {}
    if (!ur.ok) return json(res, 401, { error: "Session invalide" });
    const meta = (u && u.user_metadata) || {};
    const isAdmin = meta.admin === true;
    if (!isAdmin && String(meta.blogId || "") !== blogId) return json(res, 403, { error: "Accès refusé pour cette marque" });
  } catch (e) { return json(res, 401, { error: "Auth invalide" }); }

  if (!RESEND) return json(res, 500, { error: "Email non configuré (RESEND_API_KEY)" });
  if (!SECRET) return json(res, 500, { error: "CRON_SECRET manquant (nécessaire au lien de désinscription)" });

  const subject = String(b.subject || "").trim().slice(0, 160);
  const title = String(b.title || "").trim().slice(0, 160);
  const message = String(b.message || "").trim().slice(0, 4000);
  const imageUrl = String(b.imageUrl || "").trim().slice(0, 600);
  const ctaText = String(b.ctaText || "").trim().slice(0, 60);
  const ctaUrl = String(b.ctaUrl || "").trim().slice(0, 400);
  const brandName = String(b.brandName || "").trim().slice(0, 80) || "Notre établissement";
  const phone = String(b.phone || "").trim().slice(0, 40);
  const address = String(b.address || "").trim().slice(0, 160);
  const replyTo = String(b.replyTo || "").trim().slice(0, 160);
  const base = "https://" + (req.headers["x-forwarded-host"] || req.headers.host || "pro.hospireclub.com");
  if (!subject || !message) return json(res, 400, { error: "Objet et message requis" });

  function buildMsg(toEmail) {
    const unsubUrl = base + "/api/campaign?action=unsub&b=" + encodeURIComponent(blogId) + "&e=" + encodeURIComponent(toEmail) + "&t=" + sign(SECRET, blogId, toEmail);
    const m = {
      from: brandName + " <" + FROM + ">",
      to: [toEmail],
      subject: subject,
      html: emailHtml({ brandName: brandName, title: title, message: message, imageUrl: imageUrl, ctaText: ctaText, ctaUrl: ctaUrl, unsubUrl: unsubUrl, phone: phone, address: address }),
      headers: { "List-Unsubscribe": "<" + unsubUrl + ">" }
    };
    if (replyTo) m.reply_to = replyTo;
    return m;
  }

  // ====== Envoi de TEST (uniquement au propriétaire) ======
  if (b.test) {
    const to = String(b.test).trim().toLowerCase();
    const msg = buildMsg(to); msg.subject = "[TEST] " + msg.subject;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" }, body: JSON.stringify(msg) });
    if (!r.ok) { const e = await r.text(); return json(res, 502, { error: "Envoi test impossible : " + e.slice(0, 180) }); }
    return json(res, 200, { ok: true, test: true });
  }

  // ====== Destinataires : clients consentants − désinscrits ======
  let recips = [];
  try {
    const rr = await fetch(URL_ + "/rest/v1/reservations?blog_id=eq." + encodeURIComponent(blogId) + "&marketing_consent=eq.true&email=not.is.null&select=email", { headers: SH });
    const rows = await rr.json();
    const seen = {};
    (Array.isArray(rows) ? rows : []).forEach(function (x) {
      const e = String(x.email || "").trim().toLowerCase();
      if (e && /@/.test(e) && !seen[e]) { seen[e] = 1; recips.push(e); }
    });
    const ur2 = await fetch(URL_ + "/rest/v1/marketing_unsubs?blog_id=eq." + encodeURIComponent(blogId) + "&select=email", { headers: SH });
    const un = await ur2.json();
    const out = {}; (Array.isArray(un) ? un : []).forEach(function (x) { out[String(x.email || "").toLowerCase()] = 1; });
    recips = recips.filter(function (e) { return !out[e]; });
  } catch (e) { return json(res, 502, { error: "Lecture de la base clients impossible" }); }
  if (!recips.length) return json(res, 400, { error: "Aucun client abonné aux offres pour le moment." });

  // ====== Envoi par lots (Resend batch = 100 max) ======
  let sent = 0, failed = 0;
  for (let i = 0; i < recips.length; i += 100) {
    const batch = recips.slice(i, i + 100).map(buildMsg);
    try {
      const r = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" }, body: JSON.stringify(batch) });
      if (r.ok) sent += batch.length; else failed += batch.length;
    } catch (e) { failed += batch.length; }
    if (i + 100 < recips.length) await new Promise(function (ok) { setTimeout(ok, 700); });
  }

  // ====== Historique ======
  try {
    await fetch(URL_ + "/rest/v1/campaigns", { method: "POST", headers: SH, body: JSON.stringify({ blog_id: blogId, subject: subject, sent_count: sent }) });
  } catch (e) {}

  if (!sent) return json(res, 502, { error: "L'envoi a échoué. Réessaie dans une minute." });
  return json(res, 200, { ok: true, sent: sent, failed: failed, total: recips.length });
};
