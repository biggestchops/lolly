# Droits créatifs, crédits et ce qui reste à toi

Tu devrais pouvoir utiliser le bon travail fait par d'autres personnes sans devenir un expert en licences, et sans écarter discrètement les personnes qui l'ont fait. Lolly garde donc la source de chaque œuvre à laquelle il fait appel, lit la licence qui a été enregistrée pour elle, détermine ce que cette licence demande pour l'usage que tu es en train d'en faire, fait la part qu'un programme peut faire, et nomme la part que toi seul peux faire.

Rien de tout cela n'est un conseil juridique, et rien n'est un jugement sur ton projet. Lolly enregistre des faits, applique un petit ensemble de règles lues dans les textes juridiques des licences elles-mêmes, et montre son raisonnement. Une licence avec des conditions est un choix normal et autorisé. Elle n'est jamais présentée comme un asset défectueux.

## Trois faits, gardés séparés

« CC BY 4.0 », « cet usage nécessite un crédit » et « le crédit est dans le fichier que tu viens de télécharger » sont trois affirmations différentes, et Lolly les garde séparées :

- **Preuve** est ce qu'une source a déclaré, enregistré tel qu'il a été trouvé, avec qui l'a dit et où cela a été lu. Un import ultérieur n'écrase jamais un enregistrement antérieur.
- **Obligation** est ce que les règles examinées tirent de cette preuve pour un usage, une voie de diffusion et un public donnés. Les conditions de partage restent conditionnelles tant que tu travailles en privé.
- **Livraison** est ce que les octets finis portent réellement, mesuré en les relisant. Lolly dit que les crédits sont inclus seulement après qu'un lecteur les a trouvés dans le fichier livré.

## Où tu rencontres ça en premier

Les jeux d'emojis sont le cas de tous les jours. Twemoji est en CC BY 4.0, donc un titre contenant un emoji s'exporte avec l'illustration créditée et plus rien à faire pour toi. Les deux jeux OpenMoji sont en CC BY-SA 4.0, donc recolorer un de leurs glyphes avec un traitement de marque est une adaptation, et partager cette adaptation te demande de choisir une licence compatible, une fois. Choisir le jeu n'est jamais bloqué, et le contrôle de sélection du jeu nomme la licence là où tu choisis. Les mêmes règles s'appliquent à une illustration du catalogue, une LUT, une police et toute autre œuvre enregistrée.

## Les mots qu'utilise Lolly

Un seul vocabulaire à travers le panneau d'export, Verify, la ligne de commande et le résultat machine.

| Ce que tu vois | Ce que ça veut dire |
|---|---|
| Les crédits de source seront inclus. | Le crédit est prêt et la voie peut le porter. Rien n'a encore été écrit, donc ce n'est pas un message de succès. |
| Crédits inclus dans les métadonnées de ce fichier. | Les octets livrés ont été relus, le credential vérifié et chaque source requise y a été trouvée. |
| Les crédits et les credentials sont dans le paquet de téléchargement. | Le crédit voyage comme fichier compagnon à côté de l'artefact. Garde-les ensemble quand tu les transmets. |
| Ajoute ce crédit à la description du post. | La voie choisie ne porte ni credential ni crédit lisible, donc le texte du crédit est à toi de le coller. |
| Si tu partages cette adaptation, elle a besoin d'une licence compatible. | Une source ShareAlike a été modifiée et le résultat se dirige vers autre chose qu'un usage privé. Choisir est une seule action, pas une boîte de dialogue par placement. |
| Licence de la source non enregistrée. | Rien n'a été enregistré pour cette source. C'est une lacune à combler, pas un constat contre l'œuvre. |
| Conditions enregistrées, pas encore interprétées. | L'identifiant est reconnu et ses conditions sont listées, et aucune règle ici ne les lit. Ni feu vert automatique, ni interdiction automatique. |
| Deux déclarations de licence se contredisent. | Deux enregistrements nomment des licences différentes et rien n'a sélectionné quel octroi s'applique. |
| Aucun crédit requis sous la dédicace CC0 enregistrée. | La dédicace ne demande rien. Un crédit de courtoisie est proposé quand même. |
| Les crédits ne sont pas dans le fichier qui a été livré. | Un crédit était promis, la relecture ne l'a pas trouvé, et le fichier reste le tien. Exporte à nouveau, ou utilise le texte du crédit à la main. |

Lolly n'utilise pas « droit d'auteur vérifié », « juridiquement sûr », « entièrement dégagé » ou « droits dégagés », et il n'existe nulle part dans le produit un unique badge vert de licence. Ces mots revendiqueraient quelque chose qu'aucun programme ne peut vérifier.

## Les licences que Lolly a examinées

Version des règles `rights-rules-2026-09-13.2`. Chaque règle ci-dessous a été lue dans le texte juridique propre à la licence, et la section dont elle provient est citée à côté, aussi bien dans `engine/src/rights-profiles.ts` qu'ici. Une version et un portage sont conservés tels qu'enregistrés : une déclaration CC BY 3.0 garde sa propre version plutôt que d'être rapportée comme 4.0 parce que le sélecteur de l'app préfère 4.0.

| Licence | Ce qu'elle demande pour un usage que Lolly peut faire | Lu dans |
|---|---|---|
| CC BY 4.0 | Le créateur, le titre, l'avis de droit d'auteur, le nom et le lien de la licence, le lien de la source et une indication des modifications, chacun quand la source l'a fourni. Aucun usage n'est exclu, l'usage commercial inclus. | [Texte juridique](https://creativecommons.org/licenses/by/4.0/legalcode.en), sections 2(a)(1) et 3(a) |
| CC BY-SA 4.0 | Le même crédit. De plus, si tu partages une adaptation, elle sort sous une licence compatible : CC BY-SA 4.0, la Free Art License 1.3, ou GPL-3.0-or-later, qui ne fonctionne que dans un sens. Ces trois-là sont portées comme des données depuis la liste de Creative Commons, jamais mises en correspondance par leur nom. | [Texte juridique](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en), sections 3(a) et 3(b) ; la [liste des licences compatibles](https://creativecommons.org/compatible-licenses/) |
| CC0 1.0 | Rien. La dédicace ne porte aucune condition, donc Lolly propose un crédit de courtoisie et n'en présente jamais un comme requis. | [La dédicace](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en), sections 2 et 3 ; la [FAQ de CC](https://creativecommons.org/faq/) sur le crédit |
| CC-PDDC | Rien. Ce qui est enregistré, c'est l'affirmation elle-même et qui l'a faite, car une certification est la déclaration d'une seule partie plutôt qu'une preuve. | Les paragraphes de [la dédicace et la certification](https://creativecommons.org/licenses/publicdomain/) |
| Apache License 2.0 | Les avis de la source et le texte d'attribution du fichier NOTICE voyagent avec une œuvre distribuée. Un usage à l'exécution ne demande rien. Une licence qui demande un texte d'avis et une œuvre qui n'en porte aucun est signalée comme une lacune. | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), section 4, conditions 1 à 4 |
| MIT | La ligne de droit d'auteur et l'avis de permission voyagent avec les copies et les parties substantielles. Les usages à l'exécution et de référence ne demandent rien. | [MIT](https://opensource.org/license/mit), la condition d'avis de permission |
| SIL OFL 1.1 | Rendre du texte avec la police ne demande rien du texte. Transmettre le fichier de police porte la licence, l'avis de droit d'auteur et la règle du nom réservé. | [OFL 1.1](https://openfontlicense.org/open-font-license-official-text/), conditions 2, 3 et 5 ; la [FAQ de l'OFL](https://openfontlicense.org/ofl-faq/) sur les documents |

### Enregistrées, non interprétées

CC BY-NC, CC BY-ND et les combinaisons NC-SA et NC-ND sont reconnues, leurs conditions sont listées, et aucune règle ici ne les lit. Elles rapportent `licence.unknown` avec une ligne nommant les conditions. Un contexte commercial ne peut pas se déduire d'un prix ou d'un compte, et chaque texte combiné a besoin de son propre examen avant qu'une règle n'y touche.

Trois réponses honnêtes de plus, dont aucune n'est une permission :

- Un identifiant `LicenseRef-` revient tel quel. Il pointe vers une définition stockée et n'est jamais propriétaire par sa seule orthographe.
- Une déclaration que rien ne reconnaît revient non analysée, avec le texte original conservé à côté.
- `A OR B` est un choix que le titulaire des droits a proposé, donc chaque alternative est renvoyée et aucune n'est sélectionnée. `A AND B` est cumulatif, et ces règles l'enregistrent plutôt que de lire deux profils ensemble.

L'absence d'information de licence n'est jamais lue comme la preuve qu'une œuvre est libre de transmission.

## Ce que Lolly fait pour toi

- **Dans le catalogue.** La fiche d'une œuvre montre sa source et son créateur, le nom canonique de la licence avec le libellé original conservé en dessous, un crédit copiable là où un est enregistré, et une ligne disant ce que son usage demande. Une tuile énonce l'exigence ; elle ne prétend jamais qu'un export a été effectué.
- **Dans le panneau d'export.** Une carte Crédits de source apparaît dès qu'un rendu utilise une œuvre enregistrée. Elle montre l'état, le texte du crédit derrière Détails, un bouton Copier le crédit, et une carte intégrée quand une décision est due. Une décision n'est jamais une boîte de dialogue bloquante : un téléchargement qui a encore une action en attente se poursuit, et l'œuvre privée reste utilisable.
- **Dans le fichier.** Un export qui a placé une œuvre enregistrée écrit un ingrédient source Content Credentials par œuvre distincte, lié aux octets originaux à leur adresse publique, portant le créateur, la licence et son lien, la source, la révision et les modifications. Lolly signe ce qu'il a observé. Il ne signe jamais une affirmation au nom de l'artiste d'origine, et Verify dit lequel des deux s'est produit.
- **Après l'écriture.** Les octets livrés sont relus avant que quoi que ce soit ne dise que les crédits sont inclus. Un credential qui n'a pas été vérifié ne compte pas comme un crédit livré.
- **Dans un fichier `.lolly` modifiable.** Les octets ne voyagent que lorsqu'une licence examinée enregistre la permission de transmettre la source, et le `CREDITS.txt` du pack liste ce qui a voyagé, sous quelle licence, et ce qui a été retenu avec la raison. Une licence non enregistrée est retenue. Tu peux quand même inclure délibérément du contenu retenu, et le fichier de crédits enregistre que c'était ton choix.
- **Dans Verify.** Un panneau Sources liste chaque source qu'un fichier enregistre, avec un résumé calculé, le crédit, un bouton Copier le crédit, un lien Ouvrir la source qui n'est ouvert que sur demande, et les limites énoncées de ce qui a été inspecté. Une question Vérifier pour cet usage n'est posée que lorsque tu choisis un usage, et rien n'est récupéré pour y répondre.
- **Quand tu retires les métadonnées.** Le nettoyage te dit combien de crédits de source le fichier ne porte plus, propose le texte du crédit, et propose un fichier propre avec les crédits à côté. Les octets nettoyés ne sont jamais retamponnés.

## Ce qui reste à toi

- **Ton choix de licence t'appartient.** Revendiquer un fichier sépare trois états qui n'en faisaient qu'un auparavant : aucune licence publique déclarée, un avis explicite tous droits réservés, et un véritable octroi de licence publique. Lolly n'écrit une ligne de droits que pour les deux derniers, et jamais depuis ton profil.
- **Ton œuvre n'est pas relicenciée à ta place.** Les conditions d'une source et ta propre déclaration de sortie sont des enregistrements séparés. Une condition ShareAlike s'applique à l'adaptation qu'elle régit, pas automatiquement à tout ce que tu as fait par ailleurs.
- **L'œuvre privée reste utilisable.** Les conditions qui s'appliquent au partage sont soulevées quand le partage est en vue. Rien ici ne se transforme en interdiction d'import, et aucun questionnaire de licence ne se dresse entre toi et tes propres fichiers.
- **Une décision est mémorisée en fonction de ses propres faits.** Chaque choix que tu enregistres est tamponné d'une empreinte des œuvres, des usages, de la voie et du public pour lesquels il a été fait. Change le jeu, le traitement, le format ou le public et la question est posée à nouveau. Il n'y a pas d'interrupteur général « ignorer les licences », parce que fermer un avertissement d'un clic ne peut ni livrer un crédit ni accorder une permission.
- **Tes coordonnées restent séparées du crédit d'un tiers.** Retirer tes propres métadonnées personnelles ne retire pas un artiste crédité, et un crédit requis n'est jamais une excuse pour exporter tes coordonnées.

## En ligne de commande

Un rendu affiche un bloc `Rights:` sur la sortie d'erreur standard quand l'évaluation comporte un crédit requis ou un problème. Il porte le statut, une ligne par problème au format `code - summary`, ce que la relecture du fichier livré a donné, et le texte du crédit à coller.

```
Rights: actions-required
  licence.adaptation-choice - If you share this adaptation, it needs a compatible licence.
  Credential intact. It records 1 source. The exporter recorded it; the source did not sign a credential of its own.
  Credits included in this file's metadata.
  "water wave (OpenMoji Color 17.0.0)" by Vanessa Boutzikoudi (OpenMoji), CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/, source https://raw.githubusercontent.com/hfg-gmuend/openmoji/f9fc506a3f913be9897ab0181d611d4c910a4104/color/svg/1F30A.svg, changes: recoloured.
```

Ces deux affirmations sont indépendantes, ce qui est tout l'intérêt de les garder séparées : le crédit est dans le fichier, et une décision de licence reste due avant que le fichier ne soit partagé. Le fichier est écrit dans les deux cas.

| Statut | Signification | Sortie |
|---|---|---|
| `ready` | Rien n'attend une personne. | 0 |
| `actions-required` | Une décision reste à prendre avant que le fichier ne soit partagé. Le fichier est quand même écrit. | 4 |
| `use-not-covered` | Une règle examinée dit que la licence ne couvre pas cet usage. | 4 |
| `unknown` | Les seuls problèmes sont des lacunes : une licence qui n'a pas été enregistrée, ou des conditions qui ne sont pas interprétées. | 0 |
| `delivery-failed` | Défini par un accusé de réception, jamais par une évaluation : un crédit promis n'a pas été trouvé dans les octets livrés. Le panneau d'export l'affiche ; le CLI rapporte le même fait dans sa ligne de relecture à la place. | non affiché |

La sortie 4 est le code que ce CLI donne déjà à une vérification protectrice qui a répondu non. Ce n'est délibérément pas 3, qui signifie « réessaie sur un autre runner », car une décision de licence attendra sur tous les runners qui existent.

`--rights=private` déclare que ce rendu n'est livré à personne. Le bloc s'affiche quand même et le crédit est toujours là à copier ; ce qui se retire, c'est la condition qui s'applique au partage, et aucune affirmation de livraison n'est enregistrée. Il n'y a pas d'option pour ignorer une condition : `--rights=ignore` est une erreur d'utilisation.

Les codes de problème sont stables et lisibles par machine, indépendants du texte traduit :

`attribution.source-missing`, `attribution.delivery-missing`, `licence.adaptation-choice`, `licence.use-not-covered`, `licence.grant-conflict`, `licence.unknown`, `source.redistribution-unknown`, `credential.ingredient-missing`.

Via MCP, `lolly_verify` renvoie une charge utile `rights` avec le résumé, une ligne par source enregistrée et les limites énoncées ; un `lolly_render` sans navigateur renvoie `status`, `issues`, `credits`, `fingerprint` et un indicateur `creditsInFile` mesuré en relisant les octets.

## Où vivent les règles

Quatre modules du moteur, tous purs : pas de réseau, pas d'horloge, pas de système de fichiers. Les données de règles sont versionnées et dans le dépôt, jamais récupérées à distance.

| Module | Ce qu'il contient |
|---|---|
| `engine/src/rights-profiles.ts` | La table des identifiants, le lecteur minimal d'expressions SPDX, les profils examinés avec leurs citations, et l'unique règle pour un lien qu'un crédit peut afficher. |
| `engine/src/rights-evaluate.ts` | La classification, les problèmes, le plan d'attribution et l'empreinte. Déterministe : les mêmes faits dans un ordre différent donnent la même réponse. |
| `engine/src/rights-attribution.ts` | Les crédits lisibles, les fichiers compagnons, les ingrédients source et l'accusé de réception mesuré après l'écriture. |
| `engine/src/rights-report.ts` | Un credential vérifié relu comme les trois questions que Verify pose. |

Les fichiers d'attentes dans `tests/fixtures/rights/` ont été rédigés à partir des textes des licences plutôt qu'à partir de la sortie de l'évaluateur, et son README cite la section derrière chaque attente.

## Ce que ceci ne fait pas

Énoncé clairement, parce qu'une lacune qui n'est pas nommée se lit comme une promesse.

- **NC et ND ne sont pas interprétées.** Leurs conditions sont enregistrées et rapportées comme inconnues.
- **Aucune destination n'est confirmée.** Lolly prépare une légende ; qu'un connecteur accepte une requête n'est pas la preuve qu'un crédit a atteint un lecteur, et rien ici ne promet qu'un envoi, une capture d'écran ou un transcodage ultérieur préserve les métadonnées cachées.
- **Les champs de crédit natifs des métadonnées ne sont pas écrits à partir du plan.** Les crédits voyagent dans les Content Credentials et en texte lisible. Les champs de crédit par source IPTC et XMP ne sont pas encore remplis à partir du plan d'attribution.
- **Les corrections et le retrait ne sont pas construits.** Ajouter un créateur manquant ou une correction locale à une œuvre enregistrée, et retirer un enregistrement, n'ont aucune interface.
- **Les fournisseurs connectés ne sont pas construits.** Une banque d'images achetée, une permission personnalisée et un compte fournisseur n'ont aucun chemin d'import, donc leurs octrois ne peuvent être enregistrés que comme ta propre déclaration.
- **La politique de l'organisation n'est pas composée avec ces résultats.** La politique d'export et les conditions de licence sont séparées aujourd'hui, et une approbation d'organisation n'est pas une permission d'un titulaire de droits.
- **Plusieurs voies de livraison ne sont pas encore sur ce chemin.** Télécharger un original du catalogue, un ZIP en masse, un téléchargement dérivé, Send et Copy image n'évaluent ni ne portent encore ces crédits.
