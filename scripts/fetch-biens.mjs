/**
 * Synchronisation 3G → data/biens.json (FICHIER STATIQUE committé). FICHIER AUTONOME.
 * Site : www.immobilierdelapresquileguerandaise.fr
 *
 * Modèle « Saben » : plus de Supabase. Les annonces 3G actives sont écrites dans
 * data/biens.json, committé par la GitHub Action et servi par GitHub Pages.
 * Les PHOTOS restent des URLs 3G (admin.3gimmobilier.fr) → aucun stockage à gérer.
 *
 * - Récupère les annonces 3G actives (clé secrète THREEG_TOKEN).
 * - Préserve les corrections manuelles déjà présentes dans data/biens.json
 *   (ville, titre, surface, exclusivité, DPE, photos) : jamais écrasées si renseignées.
 * - Le statut « vendu » est géré séparément dans data/ventes.json (édité depuis
 *   l'admin du site) ; ce script n'y touche pas.
 *
 * 🔒 La clé vient de THREEG_TOKEN (secret GitHub). Jamais dans le code.
 * Test local : DRY_RUN=1 THREEG_TOKEN="sk_..." node scripts/fetch-biens.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'data', 'biens.json');

const THREEG_TOKEN = process.env.THREEG_TOKEN;
const THREEG_URL = 'https://admin.3gimmobilier.fr/api/v1/site-perso/annonces';
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
const ALIAS_VILLES = { escoublac: 'La Baule', 'la baule-escoublac': 'La Baule' };

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
function normaliser(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
// Déduit la ville depuis le texte. Tolère l'article contracté ("du Croisic",
// "au Pouliguen") et reconnaît les alias de quartiers (Escoublac → La Baule).
function villeDepuisDescription(desc) {
  if (!desc) return '';
  const texte = normaliser(desc);
  for (const [motif, ville] of Object.entries(ALIAS_VILLES)) {
    if (new RegExp('\\b' + motif.replace(/[-\s]+/g, '[-\\s]+') + '\\b').test(texte)) return ville;
  }
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

// Convertit une annonce 3G en bien, en préservant la qualité de `ref` (la version
// déjà présente dans data/biens.json) si elle existe.
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

  // Badges issus de 3G :
  // - exclusivité : détectée dans le texte de la description ("(en) exclusivité")
  // - statut : etat_pre_archivage 2 = sous compromis, 3 = offre en cours, sinon en vente
  //   (le « vendu » n'est PAS ici : une fois vendue, l'annonce quitte le flux 3G ; il vient de data/ventes.json)
  const desc3g = a.description_annonce || '';
  const exclusif = /(en\s+)?exclusivit[ée]/i.test(desc3g);
  const etat = toInt(a.etat_pre_archivage);
  const statut = etat === 2 ? 'sous_compromis' : (etat === 3 ? 'offre_en_cours' : 'en_vente');

  return {
    id: Number(a.i), titre, type: typeLabel, ville,
    prix: toInt(a.prix) || 0, surface, pieces,
    chambres: toInt(a.nb_chambres) || (ref && ref.chambres) || 0,
    sdb: toInt(a.nb_salle_eau) || (ref && ref.sdb) || 0,
    salleBain: toInt(a.nb_salle_bain) || (ref && ref.salleBain) || 0,
    terrain: toInt(a.surface_terrain) || (ref && ref.terrain) || 0,
    annee: toInt(a.annee_construction) || (ref && ref.annee) || null,
    exclusif: exclusif,
    ref: a.num_mandat ? String(a.num_mandat) : '',
    description: a.description_annonce || (ref && ref.description) || '',
    img: photos[0] || '', photos,
    dpe: (ref && ref.dpe) ? ref.dpe : (a.dpe_note_energie || ''),
    statut: statut, dateVente: null,
    prixFAI: toInt(a.prix) || 0,
  };
}

// ===================== API 3G =====================

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

function lireBiensExistants() {
  try {
    const j = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    const arr = Array.isArray(j) ? j : (j.properties || []);
    const map = new Map();
    for (const b of arr) map.set(Number(b.id), b);
    return map;
  } catch {
    return new Map();
  }
}

// ===================== PROGRAMME PRINCIPAL =====================

async function main() {
  console.log(`\n🏠 Synchronisation 3G → data/biens.json ${DRY_RUN ? '(MODE TEST — aucune écriture)' : ''}`);
  const annonces = await recupererAnnonces3G();
  console.log(`   ${annonces.length} annonce(s) active(s) récupérée(s) depuis 3G.`);

  const existants = lireBiensExistants();
  const properties = annonces.map((a) => annonceVersBien(a, existants.get(Number(a.i))));

  // Tri : exclusivités d'abord, puis prix décroissant (le front re-trie par récence).
  properties.sort((a, b) => {
    const r = (a.exclusif ? 0 : 1) - (b.exclusif ? 0 : 1);
    return r !== 0 ? r : (b.prix || 0) - (a.prix || 0);
  });

  const payload = {
    source: '3G IMMO API v1',
    fetched_at: new Date().toISOString(),
    count: properties.length,
    properties,
  };

  console.log('\n   Aperçu :');
  for (const b of properties.slice(0, 5)) {
    console.log(`   • [${b.id}] ${b.titre} — ${(b.prix || 0).toLocaleString('fr-FR')} € — ${b.surface} m² — ${b.photos.length} photo(s)`);
  }
  if (properties.length > 5) console.log(`   … et ${properties.length - 5} autre(s).`);
  const sansVille = properties.filter((p) => !p.ville);
  if (sansVille.length) console.warn(`   ⚠️ ${sansVille.length} bien(s) sans ville détectée : ${sansVille.map((p) => p.id).join(', ')}`);

  if (DRY_RUN) { console.log('\n✅ Mode test terminé : aucune écriture.\n'); return; }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Terminé : ${properties.length} bien(s) écrits dans data/biens.json\n`);
}

main().catch((e) => { console.error('\n❌ Échec :', e.message, '\n'); process.exit(1); });
