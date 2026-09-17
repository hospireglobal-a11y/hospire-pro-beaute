// .HOSPIRE — Parrainage : enregistre un lead de recommandation + notifie .HOSPIRE.
// La landing /parrainage.html?ref=<blogId> poste ici. Écriture via SUPABASE_SERVICE_KEY.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (obligatoires) ; RESEND_API_KEY, RESEND_FROM,
//      REFERRAL_NOTIFY_TO (optionnels ; défaut hospire.global@gmail.com).

function json(res, code, obj) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.status(code).json(obj);
}
function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 200, {});
  if (req.method !== "POST") return json(res, 405, { error: "Méthode non autorisée" });

  const URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!URL || !KEY) return json(res, 500, { error: "Config Supabase manquante" });

  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};

  // Honeypot anti-bot : champ caché "website" qui doit rester vide.
  if (String(b.website || "").trim()) return json(res, 200, { ok: true });

  const ref = String(b.ref || "").trim().slice(0, 60);
  const name = String(b.name || "").trim().slice(0, 120);
  const salon = String(b.salon || "").trim().slice(0, 160);
  const contact = String(b.contact || "").trim().slice(0, 200);
  const note = String(b.note || "").trim().slice(0, 500);
  if (!ref) return json(res, 400, { error: "Lien de parrainage invalide." });
  if (!name && !contact) return json(res, 400, { error: "Laisse au moins un nom ou un contact." });

  const payload = {
    referrer_blog: ref, prospect_name: name, prospect_salon: salon,
    prospect_contact: contact, note: note, status: "new", source: "landing"
  };
  let saved = null;
  try {
    const r = await fetch(URL + "/rest/v1/referrals", {
      method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
    const txt = await r.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (!r.ok) return json(res, 500, { error: "Impossible d'enregistrer. Réessaie." });
    saved = { id: (data && data[0] && data[0].id) || null };
  } catch (e) { return json(res, 500, { error: "Impossible d'enregistrer. Réessaie." }); }

  await notify({ ref: ref, name: name, salon: salon, contact: contact, note: note });
  return json(res, 200, { ok: true, id: saved.id });
};

async function notify(o) {
  const RK = (process.env.RESEND_API_KEY || "").trim();
  const FROM = (process.env.RESEND_FROM || "reservations@hospireclub.com").trim();
  const TO = (process.env.REFERRAL_NOTIFY_TO || "hospire.global@gmail.com").trim();
  if (!RK || !TO) return false;
  try {
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1A1A1A">' +
      '<div style="background:#1A1A1A;color:#F5F0E8;padding:20px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:600">.HOSPIRE</div><div style="color:#C4A265;font-size:13px;letter-spacing:.05em">NOUVEAU PARRAINAGE</div></div>' +
      '<div style="border:1px solid #EAE4D9;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px">' +
      '<p style="font-size:15px;line-height:1.6">Une recommandation vient d\'arriver via la landing de parrainage.</p>' +
      '<table style="font-size:14px;line-height:2;margin:8px 0">' +
      '<tr><td>🔗</td><td style="padding-left:8px">Recommandé par (blogId) : <b>' + esc(o.ref) + '</b></td></tr>' +
      (o.name ? '<tr><td>👤</td><td style="padding-left:8px">' + esc(o.name) + '</td></tr>' : '') +
      (o.salon ? '<tr><td>🏠</td><td style="padding-left:8px">' + esc(o.salon) + '</td></tr>' : '') +
      (o.contact ? '<tr><td>📞</td><td style="padding-left:8px">' + esc(o.contact) + '</td></tr>' : '') +
      (o.note ? '<tr><td>📝</td><td style="padding-left:8px">' + esc(o.note) + '</td></tr>' : '') +
      '</table>' +
      '<p style="font-size:12.5px;color:#8C857A">.HOSPIRE — parrainage</p>' +
      '</div></div>';
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RK, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ".HOSPIRE <" + FROM + ">", to: [TO], subject: "🎁 Nouveau parrainage — " + (o.salon || o.name || o.ref), html: html })
    });
    return er.ok;
  } catch (e) { return false; }
}
