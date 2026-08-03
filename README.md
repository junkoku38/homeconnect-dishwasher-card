# Home Connect Dishwasher Card

Carte Lovelace pour lave-vaisselle Bosch, Siemens ou Neff, via l'intégration officielle
`home_connect` ou l'intégration locale `homeconnect_ws`.

Suivi de cycle, phases, consommables, et **consommation réelle mesurée par une prise** —
que Home Connect ne fournit pas.

**Lecture seule.** Aucun pilotage, aucun interrupteur d'alimentation : impossible de
couper un cycle en cours depuis la carte.

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
price: 0.1612
currency: €
hours: 48
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
| `power_state` | entity | — | Affiché en pied |
| `program_aborted` | entity | — | Bandeau d'alerte |
| `salt` / `rinse_aid` | entity | — | `empty` en rouge, `nearly_empty` en ambre |
| `energy_forecast` / `water_forecast` | entity | — | Pourcentages relatifs |
| `extra_dry`, `half_load`, `hygiene_plus`, `vario_speed`, `silence`, `child_lock` | entity | — | Options actives, en pastilles |
| `power` / `energy` | entity | — | Prise mesurante |
| `price` | number | `0.2` | Prix du kWh |
| `currency` | string | `€` | Devise |
| `running_threshold` | number | `20` | Seuil W de repli si l'historique d'état manque |
| `hours` | number | `12` | Fenêtre d'historique. Monter à 48 pour voir plusieurs cycles |
| `points` | number | `60` | Échantillons de courbe |
| `refresh` | number | `120` | Secondes entre deux relectures |
| `show_forecast` / `show_options` | bool | `true` | Masquer ces blocs |
| `program_names` | objet | `{}` | Surcharge des libellés de programmes |

### Programmes

Les identifiants Home Connect bruts (`dishcare_dishwasher_program_eco50`) sont traduits.
Pour en ajouter ou en corriger :

```yaml
program_names:
  dishcare_dishwasher_program_eco50: Éco silencieux
  favorite_001: Mon favori
```

## Licence

MIT
