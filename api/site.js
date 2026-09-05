// .HOSPIRE PRO — Contenu du site (public, lecture seule)
// La web del cliente lee de aquí su carte / horaires / infos y los pinta.
// GET /api/site?b=BLOGID  ->  { carte:[{section,name,price}], hours:[{d,h}], info:{phone,resa,address} }
// Variables: SUPABASE_URL, SUPABASE_SERVICE_KEY

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  if (req.method === "OPTIONS") return res.status(200).end();

  const URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!URL || !KEY) return res.status(500).json({ error: "Config manquante" });

  const blogId = String((req.query && (req.query.b || req.query.blogId)) || "").trim();
  if (!blogId) return res.status(400).json({ error: "b (blogId) requis" });

  try {
    const r = await fetch(URL + "/rest/v1/site_content?blog_id=eq." + encodeURIComponent(blogId) + "&select=data", {
      headers: { apikey: KEY, Authorization: "Bearer " + KEY }
    });
    const j = await r.json();
    const data = (j && j[0] && j[0].data) || {};
    // Nettoyage à la sortie : trim + espaces internes réduits (corrige les données déjà sauvegardées, sans toucher la BD)
    const clean = function (s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); };
    const carte = (Array.isArray(data.carte) ? data.carte : []).map(function (d) {
      d = d || {};
      return { menu: clean(d.menu), section: clean(d.section), name: clean(d.name), price: clean(d.price), desc: clean(d.desc), dur: clean(d.dur) };
    });
    const hours = (Array.isArray(data.hours) ? data.hours : []).map(function (d) {
      d = d || {};
      return { d: clean(d.d), h: clean(d.h) };
    });
    const info0 = data.info || {};
    const info = {};
    Object.keys(info0).forEach(function (k) { info[k] = clean(info0[k]); });
    return res.status(200).json({ carte: carte, hours: hours, info: info, name: clean(data.name) });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
};
