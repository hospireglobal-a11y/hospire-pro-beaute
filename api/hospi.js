// .HOSPIRE PRO — Hospi (IA) : captions, chat et génération, personnalisés par la fiche de marque
// Variable de entorno en Vercel: ANTHROPIC_API_KEY

// Voix selon le niche (vertical) : resto (par défaut) ou beauty.
const VOICE_RESTO = "Tu es Hospi, l'assistante de contenu pour la restauration et l'hôtellerie. " +
  "Voix chaleureuse, complice et professionnelle, jamais corporate. Concise et concrète. " +
  "RÈGLE ABSOLUE : le contenu représente UNIQUEMENT l'établissement du client. " +
  "N'écris JAMAIS « .HOSPIRE », ni @hospire, ni aucun hashtag lié à .HOSPIRE.";

const VOICE_BEAUTY = "Tu es Hospi, la complice de contenu pour les métiers de la beauté et du bien-être " +
  "(institut, salon de coiffure, onglerie, esthétique, spa, massage, maquillage). " +
  "Voix douce, chaleureuse et complice — comme une amie qui s'y connaît vraiment. Jamais corporate, jamais distante. " +
  "Tutoiement bienveillant, concis et concret. Célèbre le soin, la confiance en soi et le moment pour soi. " +
  "RÈGLE ABSOLUE : le contenu représente UNIQUEMENT l'établissement de la cliente. " +
  "N'écris JAMAIS « .HOSPIRE », ni @hospire, ni aucun hashtag lié à .HOSPIRE.";

function isBeauty(v) { return /beau/i.test(String(v || "")); }
function voiceFor(v) { return isBeauty(v) ? VOICE_BEAUTY : VOICE_RESTO; }

function profileBlock(pf, vertical) {
  pf = pf || {};
  var beauty = isBeauty(vertical);
  var L = [];
  if (pf.name) L.push("Établissement : " + pf.name);
  if (pf.city) L.push("Ville : " + pf.city + " (utilise des hashtags locaux pertinents)");
  if (pf.type) L.push("Type / concept : " + pf.type);
  if (pf.price) L.push("Gamme de prix : " + pf.price);
  if (pf.tone) L.push("Ton de voix souhaité : " + pf.tone);
  if (pf.words) L.push("Mots qui le définissent : " + pf.words);
  if (pf.emojis) L.push("Usage des emojis : " + pf.emojis);
  if (pf.star) L.push((beauty ? "Prestation / soin phare : " : "Plat / produit star : ") + pf.star);
  if (pf.specialties) L.push((beauty ? "Spécialités / techniques : " : "Spécialités : ") + pf.specialties);
  if (pf.diets) L.push((beauty ? "Options proposées (végan, sans cruauté, hypoallergénique…) : " : "Options proposées : ") + pf.diets);
  if (pf.audience) L.push("Public cible : " + pf.audience);
  if (pf.occasions) L.push("Occasions à mettre en avant : " + pf.occasions);
  if (pf.seasons) L.push("Temps forts / saisonnalité : " + pf.seasons);
  if (pf.goals) L.push("Objectifs du business : " + pf.goals);
  if (pf.improve) L.push("À améliorer : " + pf.improve);
  if (pf.hashtags) L.push("Hashtags favoris à privilégier : " + pf.hashtags);
  if (pf.tag_accounts) L.push("Comptes à identifier quand pertinent : " + pf.tag_accounts);
  if (pf.avoid) L.push("À éviter absolument : " + pf.avoid);
  if (pf.story) L.push("Histoire / valeurs / âme : " + pf.story);
  var titre = beauty ? "FICHE DE MARQUE DE LA CLIENTE" : "FICHE DE MARQUE DU CLIENT";
  return L.length ? ("\n\n" + titre + " (respecte-la scrupuleusement) :\n" + L.join("\n")) : "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST requis" });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(200).json({ text: "", needsKey: true, message: "Hospi n'est pas encore activée (clé API manquante)." });

  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const mode = b.mode || "caption";
  const pf = b.profile || {};
  const vertical = b.vertical || pf.vertical || "resto";
  const beauty = isBeauty(vertical);
  const VOICE = voiceFor(vertical);
  const brand = (pf.name || b.brand || (beauty ? "l'institut" : "le restaurant")).slice(0, 160);
  const network = b.network || "Instagram";
  const _lg = String((pf.language || b.lang || "")).toLowerCase();
  const lang = /esp|españ|spanish|^es/.test(_lg) ? "espagnol" : (/engl|anglais|^en/.test(_lg) ? "anglais" : "français");
  const pfx = profileBlock(pf, vertical);

  let system = VOICE + " Tu écris en " + lang + "." + pfx, prompt = "", maxTokens = 500;

  if (mode === "i18n") {
    const target = /esp|españ|spanish|^es/.test(_lg) ? "espagnol (Espagne, neutre)" : "anglais (neutre, international)";
    const strings = Array.isArray(b.strings) ? b.strings.slice(0, 120).map(function (s) { return String(s).slice(0, 300); }) : [];
    system = "Tu es un traducteur professionnel d'interface logicielle (SaaS pour restaurateurs). Tu traduis du FRANÇAIS vers le " + target + ". " +
      "RÈGLES STRICTES : 1) Ne traduis JAMAIS les noms de marque : « .HOSPIRE », « HOSPIRE », « Hospi », « PRO » restent identiques. " +
      "2) Conserve exactement les emojis, les nombres, la ponctuation et les symboles (✦, ↻, ✕, →, ·, %, €). " +
      "3) Traductions courtes, naturelles, adaptées à une interface (boutons, titres, libellés). " +
      "4) Réponds UNIQUEMENT par un objet JSON valide { \"texte source\": \"traduction\", ... }, sans aucun texte autour.";
    prompt = "Traduis ces chaînes d'interface (clé = source française, valeur = traduction) :\n" + JSON.stringify(strings);
    maxTokens = 4000;
  } else if (mode === "chat") {
    system = VOICE + " Tu écris en " + lang + ". Tu aides " + (beauty ? "la professionnelle de la beauté" : "le restaurateur") + " : idées de contenu, réponses aux avis, conseils marketing. Réponses courtes et actionnables (3-6 phrases)." + pfx;
    prompt = (b.message || "").slice(0, 1500) || "Bonjour";
    maxTokens = 600;
  } else if (mode === "batch") {
    const n = Math.min(Math.max(parseInt(b.count || 8, 10), 1), 12);
    const themes = beauty ? "prestations & soins, avant/après, ambiance du salon, équipe, coulisses, promotions, conseils beauté, moments forts" : "plats, ambiance, équipe, coulisses, offres, moments forts";
    prompt = "Génère " + n + " idées de posts variés pour " + brand + " (" + themes + "). " +
      "Pour chaque post : une légende courte prête à publier, avec 1-2 emojis et 3-4 hashtags ciblés (locaux si pertinent). " +
      "Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour : [{\"text\":\"...\"}, ...].";
    maxTokens = 2000;
  } else {
    const brief = (b.brief || "").slice(0, 800).trim();
    prompt = "Rédige une légende " + network + " pour " + brand + ".\n" +
      "CONTEXTE DU CONTENU (photo/carrousel/vidéo à publier) fourni par le client :\n\"" + brief + "\"\n\n" +
      "RÈGLES : base-toi STRICTEMENT sur ce contexte. N'invente AUCUN détail non mentionné (plat, ingrédient, prix, événement, lieu). " +
      "Si le contexte est vague, reste général et fidèle à l'établissement, sans inventer de faits précis. " +
      "Donne UNIQUEMENT la légende finale (2-4 phrases, emojis, 3-5 hashtags pertinents, locaux si pertinent).";
    maxTokens = 400;
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system: system, messages: [{ role: "user", content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (j && j.error && j.error.message) || "Erreur Claude" });
    const text = (j.content && j.content[0] && j.content[0].text) ? j.content[0].text.trim() : "";
    if (mode === "i18n") {
      let map = {};
      try { const m = text.match(/\{[\s\S]*\}/); map = JSON.parse(m ? m[0] : text); } catch (e) { map = {}; }
      return res.status(200).json({ map: map });
    }
    if (mode === "batch") {
      let posts = [];
      try { const m = text.match(/\[[\s\S]*\]/); posts = JSON.parse(m ? m[0] : text); }
      catch (e) { posts = text.split(/\n{2,}/).map(function (x) { return { text: x.replace(/^\d+[\).\s-]*/, "").trim() }; }).filter(function (p) { return p.text; }); }
      return res.status(200).json({ posts: posts });
    }
    return res.status(200).json({ text: text });
  } catch (e) {
    return res.status(502).json({ error: "Erreur: " + String(e) });
  }
};
