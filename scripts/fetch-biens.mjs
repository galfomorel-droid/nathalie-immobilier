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
const OUT_VENTES = path.join(__dirname, '..', 'data', 'ventes.json');
const MAX_VENTES = 12; // nb de ventes récentes conservées dans « Nos dernières ventes »

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

  // Ville : champ 3G structuré `adresse_bien_ville` PRIORITAIRE (autoritatif),
  // puis valeur déjà connue, puis détection dans la description (filet de secours).
  const villeStruct = a.adresse_bien_ville && String(a.adresse_bien_ville).trim();
  const ville = villeStruct ? String(a.adresse_bien_ville).trim()
    : ((ref && ref.ville) ? ref.ville : villeDepuisDescription(a.description_annonce));
  const surface = (ref && toInt(ref.surface)) ? toInt(ref.surface) : corrigerSurface(a.surface_bien);
  const titre = (ref && ref.titre) ? ref.titre : construireTitre(typeLabel, pieces, ville);

  // Badges issus des champs 3G structurés :
  // - exclusivité : type_mandat = 3 (mandat exclusif)
  // - statut : etat = 2 (sous compromis) / 3 (offre en cours) / sinon en vente
  //   (le « vendu » n'est PAS ici : une fois vendue, l'annonce quitte le flux 3G ; il vient de data/ventes.json)
  const desc3g = a.description_annonce || '';
  // Exclusivité : mandat exclusif 3G (type_mandat = 3) OU mention dans la description (filet).
  const exclusif = toInt(a.type_mandat) === 3 || /(en\s+)?exclusivit[ée]/i.test(desc3g);
  // Statut : champ 3G « etat » (2 = sous compromis, 3 = offre en cours, sinon en vente).
  const etat = toInt(a.etat);
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

function lireVentes() {
  try {
    const j = JSON.parse(fs.readFileSync(OUT_VENTES, 'utf8'));
    return Array.isArray(j.ventes) ? j.ventes : [];
  } catch {
    return [];
  }
}

// Champs 3G attendus (anti-dérive). Si l'un disparaît du flux → alerte forte :
// c'est exactement ce qui s'est produit avec « etat_pre_archivage » (jamais présent).
const CHAMPS_ATTENDUS = ['i', 'type', 'prix', 'surface_bien', 'description_annonce', 'etat', 'type_mandat', 'adresse_bien_ville', 'num_mandat'];
const ETATS_CONNUS = new Set([1, 2, 3, 4, 5]);
const MANDATS_CONNUS = new Set([1, 2, 3]);

// Vérifie la présence des champs clés et signale toute valeur inattendue.
// Retourne la liste des alertes (vide = OK). Ne bloque pas, mais loggue fort.
function verifierSchema3G(annonces) {
  const alertes = [];
  if (!annonces.length) { alertes.push('Aucune annonce reçue de 3G.'); return alertes; }
  const clesPresentes = new Set(annonces.flatMap((a) => Object.keys(a)));
  for (const champ of CHAMPS_ATTENDUS) {
    if (!clesPresentes.has(champ)) alertes.push(`Champ 3G ATTENDU ABSENT du flux : « ${champ} » (dérive de schéma ?).`);
  }
  const etatsVus = new Set(annonces.map((a) => toInt(a.etat)).filter((v) => v !== null));
  for (const v of etatsVus) if (!ETATS_CONNUS.has(v)) alertes.push(`Valeur d'etat INCONNUE : ${v} (à mapper).`);
  const mandatsVus = new Set(annonces.map((a) => toInt(a.type_mandat)).filter((v) => v !== null));
  for (const v of mandatsVus) if (!MANDATS_CONNUS.has(v)) alertes.push(`Valeur de type_mandat INCONNUE : ${v} (à mapper).`);
  return alertes;
}

// ===================== PROGRAMME PRINCIPAL =====================

async function main() {
  console.log(`\n🏠 Synchronisation 3G → data/biens.json ${DRY_RUN ? '(MODE TEST — aucune écriture)' : ''}`);
  const annonces = await recupererAnnonces3G();
  console.log(`   ${annonces.length} annonce(s) active(s) récupérée(s) depuis 3G.`);

  // Garde-fou anti-dérive : alerte si un champ 3G attendu disparaît ou si une valeur est inconnue.
  const alertesSchema = verifierSchema3G(annonces);
  if (alertesSchema.length) {
    console.error('\n🚨 ALERTES SCHÉMA 3G :');
    for (const a of alertesSchema) console.error('   • ' + a);
    console.error('');
  } else {
    console.log('   ✅ Schéma 3G conforme (champs clés présents, valeurs connues).');
  }

  const existants = lireBiensExistants();
  const properties = annonces.map((a) => annonceVersBien(a, existants.get(Number(a.i))));

  // Tri : exclusivités d'abord, puis prix décroissant (le front re-trie par récence).
  properties.sort((a, b) => {
    const r = (a.exclusif ? 0 : 1) - (b.exclusif ? 0 : 1);
    return r !== 0 ? r : (b.prix || 0) - (a.prix || 0);
  });

  // ===== DÉTECTION AUTOMATIQUE DES VENTES (sans aucune intervention) =====
  // Un bien qui était « sous compromis » / « offre en cours » au passage précédent
  // et qui a DISPARU du flux 3G actif → il a été vendu : on le bascule dans
  // « Nos dernières ventes » (data/ventes.json). Si une vente est annulée et que le
  // bien réapparaît actif sur 3G, on le retire automatiquement des ventes.
  const idsActifs = new Set(properties.map((p) => p.id));
  let ventes = lireVentes().filter((v) => !idsActifs.has(Number(v.id)));
  const dejaVendu = new Set(ventes.map((v) => Number(v.id)));
  const maintenant = new Date().toISOString();
  let nouvellesVentes = 0;
  for (const [id, prev] of existants) {
    if (idsActifs.has(id) || dejaVendu.has(id)) continue;
    const st = prev && prev.statut;
    if (st === 'sous_compromis' || st === 'offre_en_cours' || st === 'vendu') {
      ventes.unshift({
        id: Number(id), titre: prev.titre || '', type: prev.type || 'Bien',
        ville: prev.ville || '', img: prev.img || '', prix: prev.prix || 0,
        statut: 'vendu', dateVente: prev.dateVente || maintenant,
      });
      nouvellesVentes++;
    }
  }
  ventes.sort((a, b) => new Date(b.dateVente || 0) - new Date(a.dateVente || 0));
  ventes = ventes.slice(0, MAX_VENTES);

  // Rapport de synthèse (anti-dérive) : visible à chaque run + committé dans data/_audit.json.
  const audit = {
    generatedAt: new Date().toISOString(),
    total: properties.length,
    parStatut: properties.reduce((acc, p) => { acc[p.statut] = (acc[p.statut] || 0) + 1; return acc; }, {}),
    exclusifs: properties.filter((p) => p.exclusif).length,
    ventes: ventes.length,
    nouvellesVentes,
    sansVille: properties.filter((p) => !p.ville).length,
    sansPhoto: properties.filter((p) => !p.photos || p.photos.length === 0).length,
    prixZero: properties.filter((p) => !p.prix).length,
    alertesSchema,
  };
  console.log(`   📊 Synthèse : ${audit.total} biens — ${JSON.stringify(audit.parStatut)} — ${audit.exclusifs} exclusif(s) — ${audit.ventes} vente(s) — ${audit.sansVille} sans ville — ${audit.sansPhoto} sans photo — ${audit.prixZero} prix=0.`);

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

  if (nouvellesVentes) console.log(`   🏷️ ${nouvellesVentes} bien(s) passé(s) en « vendu » (disparu(s) du flux après compromis/offre).`);
  console.log(`   📁 ${ventes.length} vente(s) dans « Nos dernières ventes ».`);

  if (DRY_RUN) { console.log('\n✅ Mode test terminé : aucune écriture.\n'); return; }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  fs.writeFileSync(OUT_VENTES, JSON.stringify({ ventes }, null, 2));
  fs.writeFileSync(path.join(__dirname, '..', 'data', '_audit.json'), JSON.stringify(audit, null, 2));

  // ===== SONDE 2 (corrélation statut) — À RETIRER après =====
  try {
    const champs = ['etat', 'type_mandat', 'transaction', 'procedure_alerte', 'sous_type', 'c', 'e', 'u', 'r_p', 'cle', 'num_mandat'];
    const tous = annonces.map((a) => {
      const o = { i: a.i, ville: a.adresse_bien_ville || null };
      for (const k of champs) o[k] = a[k];
      return o;
    });
    fs.writeFileSync(
      path.join(__dirname, '..', 'data', '_3g-debug2.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), tous }, null, 2),
    );
    console.log(`   🔎 SONDE2 : ${tous.length} biens → data/_3g-debug2.json`);
  } catch (e) { console.warn('   ⚠️ sonde2 échouée :', e.message); }

  console.log(`\n✅ Terminé : ${properties.length} bien(s) actifs + ${ventes.length} vente(s) écrits.\n`);
}

main().catch((e) => { console.error('\n❌ Échec :', e.message, '\n'); process.exit(1); });
