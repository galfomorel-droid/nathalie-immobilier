# DESIGN_SYSTEM.md — Charte « Bord de mer élégant »

> **Source du style (inspiration uniquement)** : `lacabane-immo.com` (accueil + composants), charte extraite du **CSS réellement chargé**.
> **Aucun contenu, texte, logo ou photo du site de référence n'est repris** — uniquement les choix de style (couleurs, typographies, espacements, composants, ambiance).
> On conserve l'identité de Nathalie Chaudet Morel (nom, secteur presqu'île guérandaise, honoraires, biens).

---

## 1. Palette (hex)

| Rôle | Token | Valeur | Usage |
|---|---|---|---|
| Fond principal (sombre) | `--bg` | `#192D56` | fond dominant « bleu marine profond », hero, sections fortes |
| Marine foncé | `--bg-deep` | `#13213F` | contrastes, ombres, footer |
| Accent bleu doux | `--accent` | `#6D8CC4` | CTA primaire, liens actifs, filets, focus |
| Accent foncé (texte) | `--accent-ink` | `#3A5A8F` | accent en TEXTE sur fond clair (liens, prix), AA |
| Blanc | `--white` | `#FFFFFF` | texte sur sombre, cartes |
| Blanc cassé bleuté | `--light` | `#F4F6FA` | sections claires (neutre clair bleuté) |
| Gris clair bleuté | `--light-2` | `#E7ECF4` | surfaces, bordures claires, hover |
| Texte adouci (sur sombre) | `--soft` | `rgba(255,255,255,.72)` | sous-titres, descriptions sur marine |
| Texte secondaire (sur clair) | `--muted` | `#5A6B86` | labels, légendes sur fond clair |
| Filet sur sombre | `--line` | `rgba(255,255,255,.16)` | séparateurs, bordures sur marine |
| Filet sur clair | `--line-light` | `rgba(25,45,86,.12)` | séparateurs sur fond clair |

Statuts (conservés, re-teintés pour l'harmonie marine) : exclusivité = `--accent`, sous compromis = `#B8731E`, offre = `#C24D0C`, vendu = `#1B7A3E`, baisse = `#D7281C`, nouveauté = `--accent`.

---

## 2. Typographies (Google Fonts)

> **Correction (29/10/2026)** : après mesure des polices réellement *rendues* sur la référence, les titres ne sont pas en serif : **tout le site est en Montserrat** (titres 800, texte 300). Le logo est une écriture manuscrite → **Allura** pour « Côté Presqu'île ».

```
https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=Allura&display=swap
```

| Token | Famille | Usage |
|---|---|---|
| `--sans` (et `--serif`, aligné) | `'Montserrat', system-ui, sans-serif` | Titres (800), texte (300), boutons, formulaires |
| `--script` | `'Allura', cursive` | Logo « Côté Presqu'île » (menu + pied de page) |

**Hiérarchie** :
- Grand titre accueil : capitales, 800, `clamp(2.5rem, 7.4vw, 6.4rem)`
- `h1` de page (`.cb-h1`) : 800, `clamp(2.2rem, 4.6vw, 3.5rem)`
- `h2` (`.cb-h2`) : 800, `clamp(1.75rem, 3.2vw, 2.5rem)`
- Sur-titre (`.cb-kicker`) : 0.68rem, capitales, interlettrage 0.26em, bleu `#6D8CC4`
- Texte : 300, 1rem, interligne 1.7, marine `#192D56`
- Bouton (`.cb-btn`) : pilule marine, capitales 0.8rem, interlettrage 0.12em

Composants réutilisables : `.cb-section` (`.light`, `.dark`), `.cb-hero` (`.is-light`), `.cb-card` (liseré `#D5DCEA`, rayon 14px, `.step`, `.centered`), `.cb-grid g2/g3/g4`, `.cb-split`, `.cb-photo`, `.cb-chip`, `.cb-btn` (`.ghost`, `.accent`, `.on-dark`, `.on-dark-outline`).

---

## 3. Espacements & mise en page

- **Conteneur** : `max-width: 1120px`, padding latéral `28px` (mobile `20px`).
- **Échelle d'espacement** (base 8) : 8 / 16 / 24 / 32 / 48 / 64 / 96 px.
- Sections : padding vertical généreux `clamp(4rem, 9vw, 7rem)`.
- Grilles cartes : gap `24–28px`.

---

## 4. Rayons & ombres (teintées marine)

| Token | Valeur |
|---|---|
| `--r-pill` | `999px` (boutons, chips) |
| `--r-card` | `16px` (cartes, images) |
| `--r-input` | `12px` |
| `--shadow-ring` | `0 0 0 1px rgba(25,45,86,.25)` |
| `--shadow-sm` | `0 2px 8px rgba(4,19,50,.18)` |
| `--shadow` | `0 10px 30px rgba(25,45,86,.07)` |
| `--shadow-lg` | `0 14px 34px rgba(25,45,86,.14)` (hover cartes) |

---

## 5. Composants

**Boutons** — **pilules** (`--r-pill`), `padding: 14px 32px`, UPPERCASE, `letter-spacing .12em`, 0.8rem, poids 500 :
- **Primaire** (sur sombre) : fond `--accent`, texte `--bg`.
- **Secondaire** (sur sombre) : fond `--bg`, bordure 1px `--white`, texte `--white`.
- **Contour** (sur clair) : fond `--white`, bordure 1px `--bg`, texte `--bg`.
- Hover : léger `translateY(-2px)` + `--shadow-sm`, transition 0.4s.

**Chips / badges** — pilule, fond `--white` (ou `--light-2`), texte `--bg`, 0.85rem. Badges statut = aplat couleur statut + texte blanc, UPPERCASE.

**Cartes de bien** — `--r-card`, `overflow:hidden`, fond `--white`, `--shadow`, hover `--shadow-lg` + `translateY(-4px)`. Image en haut (ratio 4/3), infos dessous (ville, type, prix en `--accent-ink`), chips caractéristiques.

**Champs de formulaire** — `--r-input`, bordure 1px `--line-light`, focus = bordure `--accent` + halo `0 0 0 3px rgba(109,140,196,.25)`.

---

## 6. Images & ambiance

- Photos **plein cadre**, coins `--r-card`, voile marine léger `linear-gradient(rgba(25,45,86,.0), rgba(25,45,86,.35))` sur les héros pour lisibilité du texte blanc.
- Ambiance : **marine profond dominant**, titres serif élégants, labels UPPERCASE espacés, accent bleu doux, cartes blanches lumineuses, beaucoup d'air, orientation « photo d'abord ».
- Alternance de sections **marine ↔ clair bleuté** pour le rythme.

---

## 7. Micro-animations

- Apparition au scroll : fade + translateY(14px), 0.6s `cubic-bezier(.22,1,.36,1)`.
- Hover cartes/boutons : élévation douce (translateY + ombre), 0.4s.
- Transitions lentes et feutrées (jamais brusques).

---

## 8. Bloc `:root` (prêt à coller)

```css
:root{
  --bg:#192D56; --bg-deep:#13213F;
  --accent:#6D8CC4; --accent-ink:#3A5A8F;
  --white:#FFFFFF; --light:#F4F6FA; --light-2:#E7ECF4;
  --soft:rgba(255,255,255,.72); --muted:#5A6B86;
  --line:rgba(255,255,255,.16); --line-light:rgba(25,45,86,.12);
  --serif:'Cormorant Garamond',Georgia,serif;
  --sans:'Montserrat',system-ui,-apple-system,sans-serif;
  --r-pill:999px; --r-card:16px; --r-input:12px;
  --shadow-ring:0 0 0 1px rgba(25,45,86,.25);
  --shadow-sm:0 2px 8px rgba(4,19,50,.18);
  --shadow:0 10px 30px rgba(25,45,86,.07);
  --shadow-lg:0 14px 34px rgba(25,45,86,.14);
  --container:1120px;
  --transition:.45s cubic-bezier(.22,1,.36,1);
}
```
