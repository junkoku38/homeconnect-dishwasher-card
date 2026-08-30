# Home Connect Dishwasher Card

Carte Lovelace pour lave-vaisselle Bosch, Siemens ou Neff, via l'intégration officielle
`home_connect` ou l'intégration locale `homeconnect_ws`.

Suivi de cycle, phases, consommables, et **consommation réelle mesurée par une prise** —
que Home Connect ne fournit pas.

**Lecture du cycle seule.** Aucun pilotage de programme : la carte n'interrompt
pas un cycle en cours. Seule exception : l'interrupteur Marche/Veille
(`power_switch`) permet d'allumer l'appareil ou de le mettre en veille au repos.

## Classification de l'état : table explicite, pas de correspondance floue

Le mode de la carte (`idle`, `delayed`, `run`, `done`, `alert`) vient d'une **table
explicite** consultée avant toute heuristique, avec les états Home Connect et Miele.

C'est délibéré. Une correspondance par sous-chaîne se trompe : `"inactive"` contient
`"active"`, `"actionrequired"` contient `"on"`. Une telle approche classe `Inactive` et
`ActionRequired` en « en marche », et `Ready` en « terminé » si `ready` figure parmi les
mots de fin — alors que sur Home Connect `Ready` signifie « prêt à démarrer ».

Le repli flou n'intervient que pour les intégrations non répertoriées, n'utilise que des
mots d'au moins cinq lettres, et teste alerte puis terminé puis repos **avant** marche.

Surcharge possible par `state_map`.

## Le drapeau « à vider » ne masque jamais une alerte

`clean_flag` ne peut requalifier qu'un appareil `idle` ou `done`. Une erreur, un cycle en
cours ou un départ différé restent visibles. Sans cette garde, une panne resterait
invisible tant que la vaisselle n'aurait pas été vidée.

## Le piège que cette carte traite

`remaining_program_time` porte l'attribut `Is Estimated` et **change de sens selon
l'état de l'appareil** :

| `operation_state` | Sens réel de l'entité |
|---|---|
| `Ready`, `Inactive` | durée **estimée** du programme sélectionné |
| `Run`, `Pause` | temps **restant** avant la fin |

Une carte naïve affiche « Temps restant : 4 h 20 » sur un lave-vaisselle à l'arrêt. Celle-ci
distingue les deux cas et calcule l'heure de fin uniquement pendant un cycle.

## Consommation réelle par cycle

Home Connect ne donne que des **pourcentages relatifs** (`energy_forecast`,
`water_forecast`), pas des kWh ni des litres. La carte les affiche comme tels, sans les
faire passer pour des consommations absolues.

Pour la consommation réelle, elle s'appuie sur une prise mesurante :

1. Les cycles sont découpés depuis l'historique de `operation_state`, avec repli sur un
   seuil de puissance si cet historique manque.
2. L'énergie du cycle est le **delta du compteur d'énergie**, bien plus précis que
   l'intégration de la puissance. Sur une prise Legrand testée, le compteur publie une
   valeur toutes les 3 minutes contre 64 points de puissance sur 48 h — l'écart entre
   les deux méthodes atteignait 10 %.
3. Si le compteur manque ou a été remis à zéro, la carte intègre la puissance en paliers
   et ajoute la mention « estimé ».

Un cycle n'est déclaré « en cours » que si son segment est réellement ouvert. Quand un
cycle vient de démarrer et que l'historique ne contient encore que le précédent, la carte
affiche « mesure en attente » plutôt que d'attribuer au cycle courant l'énergie du
précédent.

## Installation

### HACS (dépôt personnalisé)

1. HACS → **Frontend** → ⋮ → **Dépôts personnalisés**
2. URL `https://github.com/junkoku38/homeconnect-dishwasher-card`, catégorie **Lovelace**
3. Installer, puis recharger le navigateur

### Manuelle

Copier `dist/homeconnect-dishwasher-card.js` dans `/config/www/`, puis déclarer la
ressource `/local/homeconnect-dishwasher-card.js` en type `module`.

## Configuration

Éditeur visuel inclus. En YAML :

```yaml
type: custom:homeconnect-dishwasher-card
name: Lave-vaisselle
area: Cuisine

operation_state: sensor.bosch_dishwasher_operation_state
active_program: sensor.bosch_dishwasher_active_program
selected_program: select.bosch_dishwasher_selected_program
program_phase: sensor.bosch_dishwasher_program_phase
program_progress: sensor.bosch_dishwasher_program_progress
remaining_time: sensor.bosch_dishwasher_remaining_program_time
start_in: sensor.bosch_dishwasher_start_in

door: binary_sensor.bosch_dishwasher_door
connection: binary_sensor.bosch_dishwasher_connection
power_state: sensor.bosch_dishwasher_power_state
program_aborted: binary_sensor.bosch_dishwasher_program_aborted
salt: sensor.bosch_dishwasher_salt
rinse_aid: sensor.bosch_dishwasher_rinse_aid

energy_forecast: sensor.bosch_dishwasher_energy_forecast
water_forecast: sensor.bosch_dishwasher_water_forecast

extra_dry: switch.bosch_dishwasher_extra_dry
half_load: switch.bosch_dishwasher_half_load
hygiene_plus: switch.bosch_dishwasher_hygiene_plus
vario_speed: switch.bosch_dishwasher_variospeedplus
child_lock: switch.bosch_dishwasher_child_lock

power: sensor.prise_lave_vaisselle_puissance
energy: sensor.prise_lave_vaisselle
price_entity: sensor.tarif_actuel_tempo_6kva_ttc
currency: €
hours: 48

power_switch: switch.bosch_dishwasher_power

offpeak_entity: binary_sensor.rte_tempo_heures_creuses
tariff_switch_entity: sensor.rte_tempo_heures_creuses_changement
price_low_entity: sensor.tarif_bleu_tempo_heures_creuses_ttc
price_high_entity: sensor.tarif_bleu_tempo_heures_pleines_ttc
tempo_color_entity: sensor.rte_tempo_couleur_actuelle

shopping_list: todo.liste_dachats

optimized_start: script.lave_vaisselle_lance_hc
notify_service: notify.mobile_app_paul
remind_after: 4
```

### Options

| Option | Type | Défaut | Rôle |
|---|---|---|---|
| `name` / `area` | string | `Lave-vaisselle` | Titre et pièce |
| `operation_state` | entity | — | **Requis.** Pilote tout l'affichage |
| `active_program` | entity | — | Programme en cours |
| `selected_program` | entity | — | Programme sélectionné, affiché hors cycle |
| `program_phase` | entity | — | Alimente les étapes Prélavage → Séchage |
| `program_progress` | entity | — | Pourcentage, barre de progression |
| `remaining_time` | entity | — | Temps restant ou durée estimée selon l'état |
| `start_in` | entity | — | Départ différé |
| `door` | entity | — | Alerte si ouverte pendant un cycle |
| `connection` | entity | — | Pastille sur l'icône |
| `power_state` | entity | — | Affiché en pied (binaire **ou** texte Home Connect `on`/`off`) |
| `power_switch` | entity | — | Interrupteur Marche/Veille (`switch.*_power`). Pied + boutons « Allumer »/« Veille » au repos |
| `program_aborted` | entity | — | Bandeau d'alerte |
| `salt` / `rinse_aid` | entity | — | Énumération, pourcentage ou binaire. `empty` en rouge |
| `clean_flag` | entity | — | `input_boolean` de fin de cycle. Bandeau « À vider » et bouton de remise à zéro |
| `start_button` / `pause_button` / `stop_button` | entity | — | Actions. Masquées si l'entité est indisponible |
| `cycle_energy` / `cycle_water` / `cycle_duration` | entity | — | Si l'appareil les publie, elles priment sur le calcul depuis la prise |
| `consumable_warning` | number | `30` | Seuil % d'alerte pour un consommable numérique |
| `state_map` | objet | `{}` | Surcharge de la table état → mode |
| `consumable_map` | objet | `{}` | Surcharge des niveaux de consommables |
| `phase_weights` | liste | `[0.14, 0.44, 0.22, 0.2]` | Poids des phases, pour déduire l'étape sans entité dédiée |
| `remaining_unit` | string | — | Force l'unité du temps restant |
| `energy_forecast` / `water_forecast` | entity | — | Pourcentages relatifs |
| `extra_dry`, `half_load`, `hygiene_plus`, `vario_speed`, `silence`, `child_lock` | entity | — | Options actives, en pastilles |
| `power` / `energy` | entity | — | Prise mesurante |
| `price` | number | `0.2` | Prix du kWh, valeur fixe |
| `price_entity` | entity | — | Prix dynamique, prend le pas sur `price` |
| `currency` | string | `€` | Devise |
| `running_threshold` | number | `20` | Seuil W de repli si l'historique d'état manque |
| `hours` | number | `12` | Fenêtre d'historique. Monter à 48 pour voir plusieurs cycles |
| `points` | number | `60` | Échantillons de courbe |
| `refresh` | number | `120` | Secondes entre deux relectures |
 | `show_forecast` / `show_options` | bool | `true` | Masquer ces blocs |
| `program_names` | objet | `{}` | Surcharge des libellés de programmes |
 | `offpeak_entity` | entity | — | Binaire heures creuses (ex. rtetempo). Active le conseil tarifaire |
| `price_low_entity` | entity | — | Prix kWh heures creuses |
| `price_high_entity` | entity | — | Prix kWh heures pleines |
| `tariff_switch_entity` | entity | — | Capteur horodaté du prochain changement de tarif |
 | `tempo_color_entity` | entity | — | Capteur couleur Tempo. Répartition des kWh par couleur ce mois-ci |
| `water_meter` | entity | — | Compteur d'eau totalisant (litres ou m³). Delta par cycle, comme la prise |
| `shopping_list` | entity | — | Entité `todo.*`. Bouton « ajouter » sur un consommable bas |
| `shopping_item_salt` / `shopping_item_rinse_aid` | string | libellés par défaut | Texte ajouté à la liste |
| `drift_percent` | number | `15` | Hausse kWh du dernier cycle déclenchant l'alerte de tendance |
| `filter_counter` | entity | — | `input_number` de cycles depuis le dernier nettoyage du filtre |
| `filter_warning` | number | `30` | Cycles déclenchant « à nettoyer » |
| `tabs_entity` | entity | — | `input_number` de pastilles restantes (bouton « −1 ») |
| `tabs_low` | number | `10` | Seuil « pastilles basses » |
| `optimized_start` | entity | — | Script/automatisation de lancement au bon créneau |
| `notify_service` | string | — | Service de rappel « à vider », ex. `notify.mobile_app_paul` |
| `remind_after` | number | `4` | Heures avant que le bouton « Me le rappeler » n'apparaisse |
| `remind_message` | string | message par défaut | Texte de la notification de rappel |

## Conseil tarifaire

Au repos, si `offpeak_entity`, `price_high_entity` et `tariff_switch_entity`
sont renseignés, la carte affiche :

- **Heures creuses** — bandeau vert : bon créneau, pas d'attente à conseiller.
- **Heures pleines, gain chiffré** — « Attendre 3 h 04 économise ~0,28 € par
  cycle », si la moyenne des kWh/cycle mesurés existe. Sans mesure suffisante,
  la carte l'écrit au lieu d'inventer un chiffre.

Pendant un cycle, aucun conseil : interrompre une vaisselle pour trois
centimes ne se justifie pas. Le bandeau est cliquable et ouvre le tarif courant.

## Tendance kWh / cycle

Un sparkline des kWh des derniers cycles complets, et la dérive du dernier
par rapport à la moyenne des précédents. Une dérive ≥ `drift_percent` passe
en rouge avec la mention « vérifier filtre et gicleurs » : un
lave-vaisselle vieillit en consommant plus (calcaire, encrassement), pas
moins. Deux cycles complets minimum, sinon le bloc reste masqué.

## Codes erreur

Les états Home Connect de la forme `E24`, `e09`… sont décodés dans le bandeau
d'alerte : `E24 — Filtre bouché / vidange (code E24)`. Un code brut n'aide
personne pendant une panne ; la cause, si.

## Stats par programme et note éco

La carte croise l'historique d'`active_program` avec la découpe de cycles :
chaque cycle est attribué au programme qui couvre le plus long segment de son
intervalle. Résultat : « Eco 50 °C : 0,92 kWh · 12× ».

**Tous les programmes de l'appareil sont listés** (options du
`selected_program`), pas seulement les mesurés : ceux sans cycle dans la
fenêtre affichent « pas encore de mesure » — savoir ce qui n'a jamais été
vérifié est l'information utile. Les mesurés sont triés en premier.

### Choisir le programme depuis la carte

Au repos, si l'appareil est sous tension, le libellé du programme devient un
**vrai sélecteur** : on choisit le programme, puis « Démarrer » (ou
« Démarrer optimisé »). Hors tension ou pendant un cycle, seul le libellé
s'affiche — un `select` unavailable côté Home Connect n'est pas pilotable,
afficher un menu mort serait trompeur.

La **note éco** (A–E) compare le dernier cycle à la moyenne de **son propre
programme** — Eco 50 contre Intensif 70 serait absurde. ±5 % autour de la
moyenne donne B/C/D, au-delà A ou E. Il faut au moins deux cycles mesurés du
même programme, sinon pas de note.

## Coût estimé avant lancement

Au repos, si le programme sélectionné a un historique mesuré :
« ≈ 0,15 € (0,92 kWh × 0,1654 €, 12 cycles mesurés) ». Moyenne kWh du
programme × tarif courant. Sans historique de ce programme, aucune
estimation — afficher un chiffre inventé serait pire.

## Consommation d'eau

Home Connect ne publie **pas** de litres : `water_forecast` est un
pourcentage relatif (40 %), affiché comme tel. Pour de vrais litres, la
carte calcule le **delta d'un compteur d'eau totalisant** (`water_meter`)
sur l'intervalle de chaque cycle — exactement la méthode retenue pour
l'énergie de la prise, pour les mêmes raisons de précision. Unités `l`,
`m³` et `hl` reconnues ; remise à zéro détectée (delta négatif ignoré).

Résultat visible au trois endroits : bilan du cycle (Eau), moyenne par
programme (`0,92 kWh · 12× · 11 L`), cumul mensuel.

**Mesurer l'eau physiquement** — un lave-vaisselle ne donne pas cette
information :

| Solution | Coût | Précision |
|---|---|---|
| Compteur d'eau à impulsions (reed) + ESPHome sur l'arrivée d'eau dédiée | ~15-25 € | Excellente |
| Débitmètre YF-B10 + ESPHome (cumul dans un `total`) | ~10 € | ±5 % |
| Caméra sur le compteur d'eau existant | 0 € | Variable |

Exemple ESPHome pour un compteur à impulsions (1 impulsion = 1 L) :

```yaml
sensor:
  - platform: pulse_counter
    pin: GPIO5
    name: "Lave-vaisselle : impulsions eau"
    unit_of_measurement: "L/min"
    filters:
      - multiply: 1.0
  - platform: integration
    source: lave_vaisselle_impulsions_eau
    name: "Lave-vaisselle : eau totale"
    unit_of_measurement: "L"
    time_unit: min
    restore: true
```

La carte consomme directement le capteur totalisant.

## Filtre et pastilles

Home Connect ne connaît ni l'état du filtre, ni les pastilles. La carte
affiche deux compteurs tenus par des automatisations :

- `filter_counter` : cycles depuis le dernier nettoyage. Passe en rouge à
  `filter_warning` (défaut 30). Le bouton ✓ remet à zéro — au moment où l'on
  nettoie, pas avant.
- `tabs_entity` : pastilles restantes, décrémenté à chaque cycle. Bouton
  « −1 » pour l'ajustement au moment du rechargement du bac.

La carte ne tient pas ces comptes elle-même : elle peut être fermée,
rechargée, ouverte deux fois. Un compteur de maintenance ne doit pas dépendre
d'une carte Lovelace.

## Historique mensuel

Cycles, kWh et € cumulés depuis le 1ᵉʳ du mois. Avec `tempo_color_entity`,
répartition des kWh par couleur Tempo (bleu/blanc/rouge) : vérifiez d'un coup
d'œil que vos lancements tombent bien sur les jours bleus.

## Démarrage optimisé et rappel

- `optimized_start` : bouton « Démarrer optimisé » à côté de « Démarrer ».
  Appelle votre script/automatisation de lancement au bon créneau — la carte
  délègue, elle ne duplique pas votre logique tarifaire.
- `notify_service` + `remind_after` : quand la vaisselle est propre depuis
  trop longtemps (défaut 4 h), le bouton « Me le rappeler » envoie une
  notification mobile one-shot. Pas de spam : c'est vous qui cliquez.

### Programmes

Les identifiants Home Connect bruts (`dishcare_dishwasher_program_eco50`) sont traduits.
Pour en ajouter ou en corriger :

```yaml
program_names:
  dishcare_dishwasher_program_eco50: Éco silencieux
  favorite_001: Mon favori
```

## Consommables : énumérations, pourcentages ou binaires

`_level()` accepte les trois formes. Les énumérations Home Connect
(`empty` / `nearly_empty` / `full`) sont reconnues explicitement.

C'est le second piège de ce type d'appareil. Un code qui teste `Number(state)` puis
`state === "on"` retombe sur sa valeur par défaut pour une énumération, et affiche
« OK » à 100 % alors que le réservoir est **vide**. L'inverse exact de la réalité.

| Valeur du capteur | Affichage | Barre |
|---|---|---|
| `empty`, `vide`, `absent` | Vide, rouge | 6 % |
| `nearly_empty`, `low` | Presque vide, ambre | 28 % |
| `full`, `ok`, `present` | Plein | 100 % |
| `on` (capteur de niveau bas) | Vide, rouge | 6 % |
| nombre | `n %`, seuil `consumable_warning` | `n %` |

## Licence

MIT
