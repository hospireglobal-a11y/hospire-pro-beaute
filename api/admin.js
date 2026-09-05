// .HOSPIRE PRO — Panel admin (crea/gestiona clientes). USA LA CLAVE SECRETA.
// Variables de entorno en Vercel:
//   SUPABASE_URL          -> https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  -> clé "service_role" (SECRÈTE, jamais dans le navigateur)
//
// Sécurité : chaque appel doit fournir le token de l'utilisateur connecté.
// La fonction vérifie que cet utilisateur est admin avant toute action.

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST requis" });

  const URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!URL || !KEY) return res.status(500).json({ error: "Config manquante (SUPABASE_URL / SUPABASE_SERVICE_KEY)" });

  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  if (!b.token) return res.status(401).json({ error: "Session requise" });

  // Vérifier que l'appelant est admin
  try {
    const ur = await fetch(URL + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + b.token } });
    const txt = await ur.text(); let u = {}; try { u = JSON.parse(txt); } catch (e) {}
    if (!ur.ok) return res.status(401).json({ error: "Auth " + ur.status + " : " + txt.slice(0, 140) });
    if (!(u && u.user_metadata && u.user_metadata.admin === true))
      return res.status(403).json({ error: "Accès réservé à l'administrateur" });
  } catch (e) { return res.status(401).json({ error: "Auth invalide : " + String(e) }); }

  const ADM = URL + "/auth/v1/admin/users";
  const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

  try {
    if (b.op === "listClients") {
      const r = await fetch(ADM + "?per_page=200", { headers: H });
      const j = await r.json();
      const users = (j && j.users) || (Array.isArray(j) ? j : []);
      return res.status(200).json({ clients: users.map(function (x) { return { id: x.id, email: x.email, meta: x.user_metadata || {} }; }) });
    }
    if (b.op === "createClient") {
      if (!b.email || !b.password) return res.status(400).json({ error: "email et mot de passe requis" });
      const body = { email: b.email, password: b.password, email_confirm: true, user_metadata: { blogId: String(b.blogId || ""), brand: b.brand || "", vertical: (b.vertical === "beauty" ? "beauty" : "resto") } };
      const r = await fetch(ADM, { method: "POST", headers: H, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (j && (j.msg || j.error_description || j.message)) || "Erreur création" });
      return res.status(200).json({ ok: true, user: { id: j.id, email: j.email } });
    }
    if (b.op === "updateClient") {
      if (!b.userId) return res.status(400).json({ error: "userId requis" });
      const body = { user_metadata: { blogId: String(b.blogId || ""), brand: b.brand || "", vertical: (b.vertical === "beauty" ? "beauty" : "resto") } };
      const r = await fetch(ADM + "/" + b.userId, { method: "PUT", headers: H, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json(); return res.status(r.status).json({ error: (j && j.msg) || "Erreur maj" }); }
      return res.status(200).json({ ok: true });
    }
    if (b.op === "deleteClient") {
      if (!b.userId) return res.status(400).json({ error: "userId requis" });
      const r = await fetch(ADM + "/" + b.userId, { method: "DELETE", headers: H });
      if (!r.ok) { const j = await r.json().catch(function () { return {}; }); return res.status(r.status).json({ error: (j && j.msg) || "Erreur suppression" }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Opération inconnue" });
  } catch (e) { return res.status(502).json({ error: String(e) }); }
};
