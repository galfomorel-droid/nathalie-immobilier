/**
 * Cloudflare Worker — proxy d'écriture des STATUTS depuis l'admin du site.
 * Site : www.immobilierdelapresquileguerandaise.fr
 *
 * Pourquoi : le site est statique (GitHub Pages). Pour qu'un clic « sous compromis /
 * offre / vendu / exclusivité » dans l'admin se sauvegarde et soit visible par TOUS
 * les visiteurs, il faut écrire dans le dépôt. Ce petit serveur garde le jeton GitHub
 * côté serveur (jamais exposé) : la cliente n'a JAMAIS de jeton à saisir.
 *
 * L'admin envoie { password, ventes } ; on vérifie le mot de passe puis on committe
 * data/ventes.json. La cliente clique simplement dans l'admin (déjà protégé par login).
 *
 * ───────── DÉPLOIEMENT (une seule fois) ─────────
 * 1. cloudflare.com → Workers & Pages → Create → Create Worker → nommer « statut-proxy » → Deploy.
 * 2. « Edit code » → coller TOUT ce fichier → Deploy.
 * 3. Settings → Variables and Secrets → ajouter 2 SECRETS :
 *      - ADMIN_PASSWORD = le mot de passe de l'admin du site
 *      - GH_TOKEN       = un jeton GitHub fine-grained (dépôt nathalie-immobilier, Contents: Read and write)
 * 4. Copier l'URL du worker (ex. https://statut-proxy.<compte>.workers.dev) et me la donner
 *    (ou la coller dans index.html : var STATUT_PROXY_URL = '...').
 */

const REPO = 'galfomorel-droid/nathalie-immobilier';
const FILE = 'data/ventes.json';
const BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON invalide' }, 400); }

    if (!env.ADMIN_PASSWORD || body.password !== env.ADMIN_PASSWORD) {
      return json({ error: 'Mot de passe invalide' }, 401);
    }
    if (!Array.isArray(body.ventes)) return json({ error: 'Champ « ventes » manquant' }, 400);

    const gh = (p, opts = {}) => fetch('https://api.github.com/repos/' + REPO + p, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + env.GH_TOKEN,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'nathalie-statut-proxy',
        ...(opts.headers || {}),
      },
    });

    try {
      // sha actuel du fichier (nécessaire pour une mise à jour)
      let sha;
      const cur = await gh('/contents/' + FILE + '?ref=' + BRANCH);
      if (cur.ok) sha = (await cur.json()).sha;

      const contenu = btoa(unescape(encodeURIComponent(JSON.stringify({ ventes: body.ventes }, null, 2))));
      const put = await gh('/contents/' + FILE, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Statuts (admin) — ' + body.ventes.length + ' entrée(s)',
          content: contenu, branch: BRANCH, ...(sha ? { sha } : {}),
        }),
      });
      if (!put.ok) return json({ error: 'Échec de publication GitHub', detail: await put.text() }, 502);
      return json({ ok: true, count: body.ventes.length }, 200);
    } catch (e) {
      return json({ error: 'Erreur serveur : ' + e.message }, 500);
    }
  },
};
