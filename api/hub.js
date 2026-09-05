// .HOSPIRE PRO — "portero" (proxy seguro hacia el proveedor social)
// El token NUNCA se expone al navegador: vive aquí como variable de entorno en Vercel.
//   METRICOOL_TOKEN   -> token de acceso del proveedor
//   METRICOOL_USER_ID -> userId de Metricool

const BASE = "https://app.metricool.com/api";
function isVideo(u) { return /\.(mp4|mov|m4v|webm|quicktime)(\?|#|$)/i.test(u || ""); }

module.exports = async function handler(req, res) {
  const TOKEN = process.env.METRICOOL_TOKEN;
  const USER = process.env.METRICOOL_USER_ID;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!TOKEN || !USER) {
    return res.status(500).json({ error: "Faltan variables de entorno METRICOOL_TOKEN / METRICOOL_USER_ID" });
  }

  const headers = { "X-Mc-Auth": TOKEN, "Accept": "application/json" };
  function auth(blogId, withBlog) {
    let q = `userToken=${encodeURIComponent(TOKEN)}&userId=${encodeURIComponent(USER)}`;
    if (withBlog && blogId) q += `&blogId=${encodeURIComponent(blogId)}`;
    return q;
  }

  // ================= POST =================
  if (req.method === "POST") {
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};

    // ---- Responder a una RESEÑA de Google ----
    if (b.action === "replyReview") {
      if (!b.reviewId || !b.text || !b.blogId) return res.status(400).json({ error: "reviewId, text et blogId requis" });
      const rurl = `${BASE}/v2/inbox/reviews/replies?${auth(b.blogId, true)}`;
      try {
        const rr = await fetch(rurl, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify({ provider: "GMB", text: String(b.text), reviewId: String(b.reviewId) }) });
        const rtext = await rr.text();
        try { await fetch(`${BASE}/v2/inbox/status?${auth(b.blogId, true)}`, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify({ provider: "gmb", conversationType: "review", conversationId: String(b.reviewId), status: "READ" }) }); } catch (e) {}
        res.status(rr.status); res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.send(rtext || "{}");
      } catch (e) { return res.status(502).json({ error: "Erreur réponse avis: " + String(e) }); }
    }

    // ---- Responder a un MENSAJE (DM / commentaire) ----
    if (b.action === "messageReply") {
      if (!b.provider || !b.text || !b.conversationId) return res.status(400).json({ error: "provider, text et conversationId requis" });
      const murl = `${BASE}/v2/inbox/conversations?${auth(b.blogId, true)}`;
      const body = { provider: b.provider, text: String(b.text), conversationId: String(b.conversationId) };
      if (b.recipient) body.recipient = String(b.recipient);
      try {
        const rr = await fetch(murl, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });
        const rtext = await rr.text();
        res.status(rr.status); res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.send(rtext || "{}");
      } catch (e) { return res.status(502).json({ error: "Erreur réponse message: " + String(e) }); }
    }

    // ---- Responder a un COMENTARIO de post ----
    if (b.action === "commentReply") {
      if (!b.objectId || !b.text) return res.status(400).json({ error: "objectId et text requis" });
      const curl = `${BASE}/v2/inbox/post-comments?${auth(b.blogId, true)}`;
      try {
        const rr = await fetch(curl, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify({ provider: b.provider || "instagrambusiness", text: String(b.text), objectId: String(b.objectId) }) });
        const rtext = await rr.text();
        res.status(rr.status); res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.send(rtext || "{}");
      } catch (e) { return res.status(502).json({ error: "Erreur réponse commentaire: " + String(e) }); }
    }

    // ---- Crear post ----
    if ((b.action || "") !== "createPost") return res.status(400).json({ error: "Acción POST desconocida" });
    if (!b.blogId || !b.dateTime || !(b.networks && b.networks.length)) {
      return res.status(400).json({ error: "Faltan datos: blogId, dateTime o networks" });
    }
    const draft = !!b.draft;
    const body = {
      publicationDate: { dateTime: b.dateTime, timezone: b.timezone || "Europe/Paris" },
      text: b.text || "",
      providers: b.networks.map(function (n) { return { network: n }; }),
      autoPublish: draft ? false : true,
      draft: draft,
      creatorUserId: Number(USER)
    };
    if (b.media && b.media.length) body.media = b.media;
    if (b.networks.indexOf("instagram") >= 0) { body.instagramData = { autoPublish: true }; if (b.media && b.media[0] && isVideo(b.media[0])) body.instagramData.type = "REEL"; }
    if (b.networks.indexOf("facebook") >= 0) body.facebookData = { type: "POST" };
    if (b.networks.indexOf("gmb") >= 0) body.gmbData = b.gmbData || { topicType: "STANDARD" };
    if (b.networks.indexOf("tiktok") >= 0) { const hasVid = (b.media || []).some(isVideo); if (!hasVid && b.media && b.media.length) body.tiktokData = Object.assign({ photoCoverIndex: 0 }, b.tiktokData || {}); }
    const url = `${BASE}/v2/scheduler/posts?${auth(b.blogId, true)}`;
    try {
      const r = await fetch(url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });
      const text = await r.text();
      res.status(r.status); res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.send(text);
    } catch (e) { return res.status(502).json({ error: "Error al publier: " + String(e) }); }
  }

  // ================= PUT (editar/aprobar post) =================
  if (req.method === "PUT") {
    let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
    if (!b.id || !b.blogId) return res.status(400).json({ error: "id/blogId requis" });
    const draft = !!b.draft;
    const body = { text: b.text || "", autoPublish: draft ? false : true, draft: draft };
    if (b.dateTime) body.publicationDate = { dateTime: b.dateTime, timezone: b.timezone || "Europe/Paris" };
    if (b.networks && b.networks.length) body.providers = b.networks.map(function (n) { return { network: n }; });
    if (b.media) body.media = b.media;
    if (b.networks && b.networks.indexOf("instagram") >= 0) { body.instagramData = { autoPublish: true }; if (b.media && b.media[0] && isVideo(b.media[0])) body.instagramData.type = "REEL"; }
    if (b.networks && b.networks.indexOf("facebook") >= 0) body.facebookData = { type: "POST" };
    if (b.networks && b.networks.indexOf("tiktok") >= 0) { const hasVid = (b.media || []).some(isVideo); if (!hasVid && b.media && b.media.length) body.tiktokData = Object.assign({ photoCoverIndex: 0 }, b.tiktokData || {}); }
    const url = `${BASE}/v2/scheduler/posts/${b.id}?${auth(b.blogId, true)}`;
    try {
      const r = await fetch(url, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });
      const text = await r.text();
      res.status(r.status); res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.send(text);
    } catch (e) { return res.status(502).json({ error: "Error al modifier: " + String(e) }); }
  }

  // ================= DELETE (borrar post) =================
  if (req.method === "DELETE") {
    const id = req.query.id, blogId = req.query.blogId;
    if (!id) return res.status(400).json({ error: "id requis" });
    const url = `${BASE}/v2/scheduler/posts/${id}?${auth(blogId, true)}`;
    try {
      const r = await fetch(url, { method: "DELETE", headers });
      const text = await r.text();
      res.status(r.status); res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.send(text || "{}");
    } catch (e) { return res.status(502).json({ error: "Error al supprimer: " + String(e) }); }
  }

  // ================= GET (lecturas) =================
  const { action = "", blogId = "", start = "", end = "", provider = "" } = req.query;
  let url;
  if (action === "brands") url = `${BASE}/admin/simpleProfiles?${auth(blogId, false)}`;
  else if (action === "igFollowers") url = `${BASE}/stats/timeline/igFollowers?start=${start}&end=${end}&${auth(blogId, true)}`;
  else if (action === "igReach") url = `${BASE}/stats/timeline/igReach?start=${start}&end=${end}&${auth(blogId, true)}`;
  else if (action === "igViews") url = `${BASE}/stats/timeline/igImpressions?start=${start}&end=${end}&${auth(blogId, true)}`;
  else if (action === "postsIg") url = `${BASE}/v2/analytics/posts/instagram?from=${start}&to=${end}&timezone=Europe/Paris&${auth(blogId, true)}`;
  else if (action === "scheduled") url = `${BASE}/v2/scheduler/posts?start=${start}&end=${end}&timezone=Europe/Paris&${auth(blogId, true)}`;
  else if (action === "inboxReviews") url = `${BASE}/v2/inbox/reviews?provider=GMB&${auth(blogId, true)}`;
  else if (action === "inboxConvos") url = `${BASE}/v2/inbox/conversations?provider=${encodeURIComponent(provider || "instagrambusiness")}&${auth(blogId, true)}`;
  else if (action === "inboxComments") url = `${BASE}/v2/inbox/post-comments?provider=${encodeURIComponent(provider || "instagrambusiness")}&${auth(blogId, true)}`;
  else if (action === "gmbInfo") url = `${BASE}/v2/settings/brands/${encodeURIComponent(blogId)}?${auth(blogId, true)}`;
  else if (action === "timeline") {
    const network = req.query.network || "instagram";
    const subject = req.query.subject || "account";
    const metric = req.query.metric || "followers";
    url = `${BASE}/v2/analytics/timelines?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&network=${encodeURIComponent(network)}&subject=${encodeURIComponent(subject)}&metric=${encodeURIComponent(metric)}&timezone=Europe/Paris&${auth(blogId, true)}`;
  }
  else if (action === "bestTimes") {
    const network = req.query.network || "instagram";
    url = `${BASE}/v2/scheduler/besttimes/${encodeURIComponent(network)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&timezone=Europe/Paris&${auth(blogId, true)}`;
  }
  else return res.status(400).json({ error: "Acción desconocida: " + action });

  try {
    const r = await fetch(url, { headers });
    const text = await r.text();
    res.status(r.status); res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(text);
  } catch (e) { return res.status(502).json({ error: "Error al contactar el service: " + String(e) }); }
};
