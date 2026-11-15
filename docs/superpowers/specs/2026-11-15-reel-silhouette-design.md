# Spec — Reel en trois actes : mot → objet → blason

**Date :** 2026-11-15
**Statut :** validé (prototype « donjon » comparé en deux variantes, choix : dissolution)
**Emplacement :** `cli/lib/reel/` (scene, silhouette, index, encode), `cli/assets/silhouettes/`, `cli/test/reel.test.js`.

## Intention

Pousser le reel plus loin dans l'ASCII art dark fantasy : entre le mot et le blason, le mot devient l'objet qu'il nomme (« donjon » → un château), puis l'objet se désagrège et le blason pousse. Le concept mot → objet → blason doit se lire sans explication.

## Décisions

| Sujet | Décision | Pourquoi |
|---|---|---|
| Source des silhouettes | Bibliothèque curatée d'icônes game-icons.net (CC BY 3.0), complétable par des dessins maison au même format | Couverture large du champ lexical dark fantasy, gratuite, déterministe. Les dessins maison s'ajoutent sans code |
| Passage objet → blason | **Dissolution** : l'objet se désagrège vers les foyers, le blason classique pousse | Comparé à la variante « charge » (l'objet reste au cœur du blason) : la dissolution rend le concept plus lisible et marche pour toutes les formes. La charge est gardée pour plus tard |
| Blason final | Identique à `buildGrid` (garde-fou conservé) | Cohérence avec les exports image et les posts photo |
| Durée | 20 s (au lieu de 15) | Trois actes lisibles |
| Mots sans silhouette | L'acte 2 est sauté : mot → blason, comme avant | Fait varier les publications ; pas de silhouette approximative |
| Correspondance mot → silhouette | Table explicite (`index.json`), mots FR/EN normalisés (minuscules, sans accents), essai du singulier | Contrôle total, pas d'appel réseau, pas de faux positifs |
| Couleur d'accent | Le rouge `#E61919`, déjà présent (chiffres de la graine), pour les braises et étincelles uniquement | Une seule couleur, indépendante du mot : aucune complexité par silhouette |
| Poids | Débit vidéo plafonné à 1,5 Mb/s : environ 3,3 à 3,7 Mo pour 20 s | Le webhook Make de l'automation refuse plus de 5 Mo |

## Déroulé (avec silhouette)

| Temps | Séquence |
|---|---|
| 0,3 → 2,5 s | Cadre, mot en gothique tramé, graine |
| 2,5 → 4,5 s | Les points des lettres bâtissent l'objet, de bas en haut |
| 4,5 → 7,8 s | Tenue : lumière rasante, lueur mouvante, brume au pied, braises et étincelles rouges |
| 7,8 → 9,5 s | L'objet se désagrège vers les foyers du blason |
| 8,4 → 13,5 s | Pousse du blason |
| 13,5 → 18,2 s | Tenue, balayage de lumière ; couverture à 16,5 s |
| 18,2 → 19,7 s | Dissolution tramée, retour au noir |

## Licence

Chaque reel qui utilise une silhouette doit créditer l'icône (auteur + game-icons.net + CC BY 3.0). `renderReel` renvoie `silhouette: { id, author, source }` ; le CLI l'affiche, l'automation l'ajoute à la légende.

## Hors scope (plus tard)

- Variante « charge » : l'objet devient le meuble central du blason.
- Choix de la silhouette par similarité sémantique pour les mots hors table.
- Éviter deux silhouettes identiques à la suite dans l'automation.
