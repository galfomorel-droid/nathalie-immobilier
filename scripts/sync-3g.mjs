/**
 * Synchronisation récurrente 3G → Supabase (table "biens"). FICHIER AUTONOME.
 * Site : www.immobilierdelapresquileguerandaise.fr
 *
 *  - Récupère les annonces 3G actives (clé secrète THREEG_TOKEN).
 *  - Ajoute / met à jour les biens 3G dans Supabase (id = identifiant 3G).
 *  - Supprime les biens 3G devenus inactifs (vendus / retirés).
 *  - PRÉSERVE la qualité déjà en base (titre, ville, surface, exclusivité, DPE,
 *    photos) : ces champs ne sont jamais écrasés s'ils existent déjà.
 *  - Ne touche QUE les biens 3G (id >= ID_3G_MIN). Les fiches hors 3G (petit id)
 *    restent intactes.
 *
 * 🔒 La clé n'est jamais dans le code : elle vient de THREEG_TOKEN (secret GitHub).
 * Test local sans écriture : DRY_RUN=1 THREEG_TOKEN="sk_..." node scripts/sync-3g.mjs
 */

// ===================== CONFIG =====================

const THREEG_TOKEN = process.env.THREEG_TOKEN;
const THREEG_URL = 'https://admin.3gimmobilier.fr/api/v1/site-perso/annonces';

// URL + clé "anon" Supabase : déjà publiques dans le site, ce ne sont pas des secrets.
const SUPA_URL = process.env.SUPABASE_URL || 'https://xfosdlaqzglljpcnpeir.supabase.co';
const SUPA_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhmb3NkbGFxemdsbGpwY25wZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzU0NTksImV4cCI6MjA5MjI1MTQ1OX0.KDG_02zsJpI3ZVfNSrvWwsdE7miCn4FNzBOtidkM_xo';

const ID_3G_MIN = 1000000000;
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

const TYPE_LABELS = {
  '1': 'Maison', '2': 'Appartement', '3': 'Terrain', '4': 'Local commercial',
  '5': 'Immeuble', '6': 'Parking', '7': 'Bureau', '8': 'Fonds de commerce',
};
const VILLES_CONNUES = [
  'La Baule', 'Guérande', 'Le Pouliguen', 'Pornichet', 'La Turballe', 'Le Croisic',
  'Batz-sur-Mer', 'Saint-Nazaire', 'Saint-André-des-Eaux', 'Herbignac',
  'Piriac-sur-Mer', 'Mesquer', 'Saint-Molf', 'Assérac', 'Trignac',
  'Montoir-de-Bretagne', 'Saint-Lyphard', 'Saint-Joachim', 'Pornic',
  'Saint-Brevin-les-Pins', 'Donges',
];

// ===================== OUTILS =====================

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
// Surface 3G parfois aberrante (×100 : "6456" = 64,56 m²). > 500 m² → on divise.
function corrigerSurface(raw) {
  const n = toInt(raw);
  if (n === null) return 0;
  return n > 500 ? Math.round(n / 100) : n;
}
// Quartiers / anciennes communes rattachés à une commune principale.
const ALIAS_VILLES = {
  escoublac: 'La Baule',
  'la baule-escoublac': 'La Baule',
};

// minuscule + sans accents → comparaison robuste
function normaliser(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Déduit la ville à partir du texte. Tolère l'article contracté ("du Croisic",
// "au Pouliguen") en ne cherchant que le NOM de la commune sans son article,
// comme un mot entier, et reconnaît les alias de quartiers (Escoublac → La Baule).
function villeDepuisDescription(desc) {
  if (!desc) return '';
  const texte = normaliser(desc);
  // 1. Alias explicites (quartiers, anciennes communes)
  for (const [motif, ville] of Object.entries(ALIAS_VILLES)) {
    if (new RegExp('\\b' + motif.replace(/[-\s]+/g, '[-\\s]+') + '\\b').test(texte)) return ville;
  }
  // 2. Communes connues : nom sans article (le/la/les), match en mot entier
  for (const v of VILLES_CONNUES) {
    const noyau = normaliser(v).replace(/^(le|la|les)\s+/, '');
    const motif = '\\b' + noyau.replace(/[-\s]+/g, '[-\\s]+') + '\\b';
    if (new RegExp(motif).test(texte)) return v;
  }
  return '';
}
function construireTitre(typeLabel, pieces, ville) {
  let t = typeLabel || 'Bien';
  if (pieces) t += ` ${pieces} pièces`;
  if (ville) t += ` à ${ville}`;
  return t;
}

// Convertit une annonce 3G en ligne `biens`, en préservant la qualité de `ref`
// (la version déjà en base) si elle existe.
function annonceVersBien(a, ref) {
  const typeLabel = TYPE_LABELS[String(a.type)] || (ref && ref.type) || 'Bien';
  const pieces = toInt(a.nb_pieces) || (ref && ref.pieces) || 0;

  const photos3g = [];
  for (let i = 1; i <= 20; i++) {
    const p = a['photo' + i];
    if (p && String(p).trim()) photos3g.push(String(p).trim());
  }
  const photosRef = (ref && Array.isArray(ref.photos)) ? ref.photos : [];
  const photos = photosRef.length > photos3g.length ? photosRef : photos3g;

  const ville = (ref && ref.ville) ? ref.ville : villeDepuisDescription(a.description_annonce);
  const surface = (ref && toInt(ref.surface)) ? toInt(ref.surface) : corrigerSurface(a.surface_bien);
  const titre = (ref && ref.titre) ? ref.titre : construireTitre(typeLabel, pieces, ville);

  return {
    id: Number(a.i), titre, type: typeLabel, ville,
    prix: toInt(a.prix) || 0, surface, pieces,
    chambres: toInt(a.nb_chambres) || (ref && ref.chambres) || 0,
    sdb: toInt(a.nb_salle_eau) || (ref && ref.sdb) || 0,
    salleBain: toInt(a.nb_salle_bain) || (ref && ref.salleBain) || 0,
    terrain: toInt(a.surface_terrain) || (ref && ref.terrain) || 0,
    annee: toInt(a.annee_construction) || (ref && ref.annee) || null,
    exclusif: ref ? !!ref.exclusif : false,
    ref: a.num_mandat ? String(a.num_mandat) : '',
    description: a.description_annonce || (ref && ref.description) || '',
    img: photos[0] || '', photos,
    dpe: (ref && ref.dpe) ? ref.dpe : (a.dpe_note_energie || ''),
    statut: 'en_vente', prixFAI: toInt(a.prix) || 0,
  };
}

// ===================== API 3G + SUPABASE =====================

async function recupererAnnonces3G() {
  if (!THREEG_TOKEN) throw new Error('THREEG_TOKEN manquant (secret non défini).');
  const res = await fetch(`${THREEG_URL}?token=${encodeURIComponent(THREEG_TOKEN)}`);
  if (res.status === 401) throw new Error('Clé 3G invalide ou révoquée (401).');
  if (res.status === 429) throw new Error('Limite 3G dépassée (429).');
  if (!res.ok) throw new Error(`Erreur API 3G : HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error('Réponse 3G : success=false');
  return data.annonces || [];
}

const supaHeaders = () => ({ apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' });

async function lireBiens3GExistants() {
  const res = await fetch(`${SUPA_URL}/rest/v1/biens?id=gte.${ID_3G_MIN}&select=*`, { headers: supaHeaders() });
  if (!res.ok) throw new Error(`Lecture Supabase : HTTP ${res.status} ${await res.text()}`);
  const map = new Map();
  for (const r of await res.json()) map.set(Number(r.id), r);
  return map;
}

async function upsertBiens(biens) {
  if (!biens.length) return;
  let payload = biens;
  for (let t = 0; t < 8; t++) {
    const res = await fetch(`${SUPA_URL}/rest/v1/biens`, {
      method: 'POST',
      headers: { ...supaHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;
    const txt = await res.text();
    const m = txt.match(/column "?([a-zA-Z_]+)"?/);
    if (res.status === 400 && m && m[1]) {
      console.warn(`  ⚠️ colonne "${m[1]}" absente → ignorée`);
      payload = payload.map((o) => { const c = { ...o }; delete c[m[1]]; return c; });
      continue;
    }
    throw new Error(`Upsert Supabase : HTTP ${res.status} ${txt}`);
  }
  throw new Error('Upsert Supabase : trop de colonnes manquantes.');
}

async function supprimerBiens(ids) {
  if (!ids.length) return;
  const res = await fetch(`${SUPA_URL}/rest/v1/biens?id=in.(${ids.join(',')})`, { method: 'DELETE', headers: supaHeaders() });
  if (!res.ok) throw new Error(`Suppression Supabase : HTTP ${res.status} ${await res.text()}`);
}

// ===================== PROGRAMME PRINCIPAL =====================

async function main() {
  console.log(`\n🏠 Synchronisation 3G → Supabase ${DRY_RUN ? '(MODE TEST — aucune écriture)' : ''}`);
  const annonces = await recupererAnnonces3G();
  console.log(`   ${annonces.length} annonce(s) active(s) récupérée(s) depuis 3G.`);

  const existants = await lireBiens3GExistants();
  const biens = annonces.map((a) => annonceVersBien(a, existants.get(Number(a.i))));
  const idsActifs = new Set(biens.map((b) => b.id));
  const aSupprimer = [...existants.keys()].filter((id) => !idsActifs.has(id));

  console.log('\n   Aperçu :');
  for (const b of biens.slice(0, 5)) {
    console.log(`   • [${b.id}] ${b.titre} — ${b.prix.toLocaleString('fr-FR')} € — ${b.surface} m² — ${b.photos.length} photo(s)`);
  }
  if (biens.length > 5) console.log(`   … et ${biens.length - 5} autre(s).`);
  if (aSupprimer.length) console.log(`   🗑️ ${aSupprimer.length} annonce(s) inactive(s) → suppression.`);

  if (DRY_RUN) { console.log('\n✅ Mode test terminé : aucune écriture.\n'); return; }

  await upsertBiens(biens);
  await supprimerBiens(aSupprimer);
  console.log(`\n✅ Terminé : ${biens.length} annonce(s) à jour` + (aSupprimer.length ? `, ${aSupprimer.length} retirée(s)` : '') + '.\n');
}

main().catch((e) => { console.error('\n❌ Échec :', e.message, '\n'); process.exit(1); });
