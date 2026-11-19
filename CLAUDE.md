# CLAUDE.md

Générateur procédural de blasons/emblèmes pour l'univers vvd.world × odilon.wav. Voir [README.md](README.md) pour l'usage et l'architecture fonctionnelle.

## Contraintes non négociables

- **Fichier unique autonome** : tout dans `index.html`. Zéro dépendance externe, zéro build, zéro backend, zéro API.
- **Jamais `Math.random()`** : toute la génération consomme un seul flux `mulberry32(seed)` seedé par hash du texte, dans un ordre fixe. C'est ce qui garantit le déterminisme (même texte → même image).
- **Charte odilon.wav** : fond noir, palette `#6B7EC4` / `#8A9AD4`, aucun contour net, aucun cadre/vignette/cercle de contention. Aucun texte/label sur le visuel exporté.
- **Jamais de moulinet** : les familles radiales k=3 et k=4 sont toujours miroir (`mirror: true`, symétrie diédrale). Une rotation seule à 3 ou 4 branches dessine des bras crochus qui évoquent un triskèle ou une svastika, et les visuels partent en prod sur Instagram. Testé dans les trois suites.
- **Séparation stricte** entre `#blason-script` (logique pure, zéro accès DOM, testable en Node) et `#blason-ui` (câblage DOM, non testé). Ne jamais faire fuir du code DOM dans `#blason-script`.

## Pièges déjà rencontrés (ne pas répéter)

1. **Caractères Unicode combinants littéraux vs échappés.** Le regex de suppression des diacritiques dans `slugify` doit être écrit `̀-ͯ` (forme échappée, texte ASCII lisible), jamais des caractères combinants littéraux collés dans la classe de caractères — ils sont fonctionnellement identiques mais invisibles/non éditables dans la plupart des éditeurs, et ce piège s'est reproduit deux fois dans ce projet (une fois dans la spec, une fois à l'implémentation de Task 7). L'outil Edit ne peut pas distinguer les deux formes de façon fiable (elles rendent pareil) — pour corriger ce genre de ligne, utiliser un script Python/Node qui fait un remplacement explicite au niveau des octets, puis vérifier avec `grep -n 'u0300' index.html` (si ça ne trouve rien, la forme échappée n'est pas présente).

2. **Mismatch de prototype `node:vm` / `assert/strict`.** Les tableaux construits à l'intérieur d'un `vm.createContext()` ont un `Array.prototype` différent de celui du realm Node hôte. `assert/strict`'s `deepEqual` (qui se comporte comme `deepStrictEqual`) échoue sur ces comparaisons même quand les valeurs sont identiques. Ne jamais corriger ça en manipulant le prototype du retour d'une fonction pure (ex. `Object.setPrototypeOf`) — c'est un hack de test qui fuit dans le code de prod. La bonne correction : utiliser `require('node:assert')` (non strict) pour la comparaison concernée, uniquement dans le test qui en a besoin.

3. **Apostrophe typographique transcrite en apostrophe droite dans une chaîne JS.** Un implémenteur (Task 11 de `terminal/index.html`) a retranscrit `alert('Génère un blason d’abord...')` (apostrophe typographique `’`, U+2019) en `alert('Génère un blason d'abord...')` (apostrophe droite `'`, U+0027) — ce qui ferme la chaîne à quote simple prématurément et casse la syntaxe de tout le bloc `<script>` contenant. Même famille de piège que le n°1 (caractère visuellement quasi-identique mais fonctionnellement différent, invisible à l'œil dans un diff). Détecté seulement parce que la revue finale a fait tourner `node --check` sur le bloc extrait — un agent qui transcrit du texte français avec apostrophes depuis une spec/plan doit préserver l'apostrophe typographique telle quelle dans les chaînes à quotes simples, jamais la "corriger" en apostrophe droite.

## Tests

```bash
node --test test/core.test.js
```

Zéro dépendance npm. `test/support/extract-core.js` extrait le contenu de `<script id="blason-script">` via regex + `node:vm` et l'exécute dans un sandbox exposant `{module: {exports: {}}}` — c'est ce qui permet de tester du code shippé tel quel dans le navigateur sans aucun build.

`#blason-ui` (DOM) n'a pas de couverture automatisée par design — vérification manuelle au navigateur requise pour tout changement dedans.

## Process de développement suivi

Ce projet a été construit avec le pipeline superpowers : `brainstorming` → `writing-plans` → `subagent-driven-development` (implémenteur + reviewer par tâche, TDD strict) → `finishing-a-development-branch`. Spec et plan complets dans `docs/superpowers/specs/` et `docs/superpowers/plans/` — à consulter avant toute évolution pour ne pas contredire les décisions déjà prises (ex. pourquoi pas de silhouette fixe, pourquoi le hash n'est pas insensible à la casse, etc.).

Pour toute évolution future (PWA, galerie, sauvegarde — explicitement hors scope de la session initiale), repartir du cycle brainstorming → spec → plan plutôt que de coder directement dans `index.html`.
