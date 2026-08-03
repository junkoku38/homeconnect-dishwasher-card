/**
 * Home Connect Dishwasher Card
 * Carte Lovelace pour lave-vaisselle Bosch / Siemens / Neff via Home Connect
 * (intégration officielle `home_connect` ou locale `homeconnect_ws`).
 *
 * Suivi de cycle, consommables, et consommation réelle mesurée par une prise.
 * Lecture seule : aucun pilotage, aucune coupure d'alimentation possible.
 *
 * https://github.com/junkoku38/homeconnect-dishwasher-card
 */

const CARD_VERSION = "2.0.1";

console.info(
  `%c HOMECONNECT-DISHWASHER-CARD %c v${CARD_VERSION} `,
  "color:#eef1f6;background:#2a2f3a;font-weight:700;border-radius:3px 0 0 3px;padding:2px 6px",
  "color:#8fb0c9;background:#15181e;border-radius:0 3px 3px 0;padding:2px 6px"
);

/* ------------------------------------------------------------------ */
/* Traductions                                                         */
/* ------------------------------------------------------------------ */

/** `operation_state` : 9 valeurs possibles côté Home Connect. */
const STATE_FR = {
  Inactive: "Inactif",
  Ready: "Prêt",
  DelayedStart: "Départ différé",
  Run: "En marche",
  Pause: "En pause",
  ActionRequired: "Action requise",
  Finished: "Terminé",
  Error: "Erreur",
  Aborting: "Annulation",
};

/** Phases d'un cycle, dans l'ordre. `None` signifie hors cycle. */
const PHASES = ["PreRinse", "MainWash", "FinalRinse", "Drying"];
const PHASE_FR = {
  None: "—",
  PreRinse: "Prélavage",
  MainWash: "Lavage",
  FinalRinse: "Rinçage",
  Drying: "Séchage",
};

/** Identifiants Home Connect bruts, tels que renvoyés par l'appareil. */
const PROGRAM_FR = {
  favorite_001: "Favori 1",
  favorite_002: "Favori 2",
  dishcare_dishwasher_program_auto1: "Auto 35-45 °C",
  dishcare_dishwasher_program_auto2: "Auto 45-65 °C",
  dishcare_dishwasher_program_auto3: "Auto 65-75 °C",
  dishcare_dishwasher_program_eco50: "Eco 50 °C",
  dishcare_dishwasher_program_glas40: "Verres 40 °C",
  dishcare_dishwasher_program_glasscare: "Soin des verres",
  dishcare_dishwasher_program_intensiv70: "Intensif 70 °C",
  dishcare_dishwasher_program_intensivpower: "Intensif Power",
  dishcare_dishwasher_program_kurz60: "Court 60 °C",
  dishcare_dishwasher_program_machinecare: "Nettoyage machine",
  dishcare_dishwasher_program_mixedload: "Charge mixte",
  dishcare_dishwasher_program_nightwash: "Lavage nuit",
  dishcare_dishwasher_program_prerinse: "Prélavage",
  dishcare_dishwasher_program_quick45: "Rapide 45 °C",
  dishcare_dishwasher_program_quick65: "Rapide 65 °C",
  dishcare_dishwasher_program_quickd: "Rapide",
  dishcare_dishwasher_program_super60: "Super 60 °C",
};


const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const domainOf = (id) => (id ? String(id).split(".")[0] : null);

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");

/**
 * Table explicite état -> mode. Elle est consultée AVANT toute heuristique.
 * La correspondance par sous-chaîne est un piège : « inactive » contient
 * « active », « actionrequired » contient « on ». Sur Home Connect cela
 * classait Inactive et ActionRequired en « en marche ».
 */
const STATE_MODE = {
  // Home Connect
  inactive: "idle", ready: "idle", delayedstart: "delayed", delayed_start: "delayed",
  run: "run", pause: "run", aborting: "run",
  finished: "done", actionrequired: "alert", action_required: "alert", error: "alert",
  // Miele
  off: "idle", on: "idle", idle: "idle", not_connected: "alert",
  programmed: "delayed", waiting_to_start: "delayed",
  in_use: "run", rinse_hold: "run", programme_interrupted: "alert",
  end_programmed: "done", programme_ended: "done",
  failure: "alert", service: "alert",
  // génériques
  standby: "idle", stopped: "idle", running: "run", washing: "run",
  complete: "done", completed: "done", done: "done",
};

/**
 * Repli flou pour les intégrations non répertoriées. On n'utilise que des
 * mots distinctifs d'au moins cinq lettres, et on teste alerte puis
 * terminé puis repos avant marche, pour qu'« inactive » ne matche jamais un
 * mot de marche.
 */
const FUZZY = [
  ["alert", ["error", "failure", "fault", "panne", "defaut", "interrupted", "actionrequired"]],
  ["done", ["finished", "termine", "ended", "complete"]],
  ["idle", ["inactive", "standby", "stopped", "repos", "notrunning", "not_running"]],
  ["delayed", ["delayed", "programmed", "waiting"]],
  ["run", ["running", "washing", "prewash", "rinsing", "drying", "heating", "in_use",
           "lavage", "rincage", "sechage", "en_cours"]],
];

/** Niveaux de consommables : énumérations, pourcentages ou binaires. */
const LEVEL_MAP = {
  empty: 0, vide: 0, absent: 0, missing: 0, low: 1,
  nearly_empty: 1, presque_vide: 1, nearly: 1,
  full: 2, plein: 2, ok: 2, present: 2, sufficient: 2, good: 2,
};
const LEVEL_FR = ["Vide", "Presque vide", "Plein"];
const LEVEL_PCT = [6, 28, 100];

const COL = {
  txt: "#eef1f6",
  ok: "#8fbfae",
  warn: "#dfb37a",
  bad: "#c98f8f",
  info: "#8fb0c9",
  power: "#c9cfd9",
  dim: "rgba(255,255,255,.35)",
};

const ICONS = {
  dishwasher: `<path d="M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v3h14V4H5zm0 5v11h14V9H5zm2.5-3.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm2.5 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM12 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/>`,
  door: `<path d="M5 2h12a2 2 0 0 1 2 2v18H5V2zm2 2v16h10V4H7zm7 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>`,
  salt: `<path d="M7 2h10l1.5 6H5.5L7 2zm-2 8h14l-1.2 12H6.2L5 10zm4.5 3-.5 7h1l.5-7h-1zm4 0 .5 7h1l-.5-7h-1z"/>`,
  drop: `<path d="M12 3s6 6.4 6 10a6 6 0 1 1-12 0c0-3.6 6-10 6-10z"/>`,
  bolt: `<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>`,
  alert: `<path d="M12 2 1 21h22L12 2zm0 5 7.5 12.9h-15L12 7zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z"/>`,
  clock: `<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3V7z"/>`,
  check: `<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>`,
};

const fireEvent = (node, type, detail = {}) => {
  const ev = new Event(type, { bubbles: true, cancelable: false, composed: true });
  ev.detail = detail;
  node.dispatchEvent(ev);
};

async function ensureHaForm() {
  if (customElements.get("ha-form")) return true;
  try {
    const helpers = await window.loadCardHelpers();
    const card = helpers.createCardElement({ type: "entities", entities: [] });
    if (card?.constructor?.getConfigElement) await card.constructor.getConfigElement();
  } catch (err) {
    console.warn("homeconnect-dishwasher-card : ha-form indisponible", err);
  }
  return !!customElements.get("ha-form");
}

/* ------------------------------------------------------------------ */
/* Courbe                                                              */
/* ------------------------------------------------------------------ */

function smoothPath(pts, tension = 0.3) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < pts.length ? pts[i + 2] : p2;
    d += ` C${(p1[0] + ((p2[0] - p0[0]) * tension) / 2).toFixed(1)},${(
      p1[1] +
      ((p2[1] - p0[1]) * tension) / 2
    ).toFixed(1)} ${(p2[0] - ((p3[0] - p1[0]) * tension) / 2).toFixed(1)},${(
      p2[1] -
      ((p3[1] - p1[1]) * tension) / 2
    ).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function buildSpark(values, w, h, color, gid) {
  const clean = values.filter((v) => v != null && !Number.isNaN(v));
  if (clean.length < 2) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="rgba(255,255,255,.10)"
        stroke-width="1.4" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/></svg>`;
  }
  let lo = Math.min(...clean);
  let hi = Math.max(...clean);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const n = values.length;
  const pts = [];
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) return;
    pts.push([(i * w) / (n - 1), h - 3 - ((v - lo) / (hi - lo)) * (h - 6)]);
  });
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  const X = pts[pts.length - 1][0].toFixed(1);
  const Y = pts[pts.length - 1][1].toFixed(1);
  /* Point final : segment de longueur nulle à bout rond. Avec
     vector-effect="non-scaling-stroke" il reste un disque parfait, là où un
     <circle> serait déformé en ellipse par preserveAspectRatio="none". */
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".26"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round"
      stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <line x1="${X}" y1="${Y}" x2="${X}" y2="${Y}" stroke="${color}" stroke-width="4.8"
      stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Carte                                                               */
/* ------------------------------------------------------------------ */

class HomeConnectDishwasherCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._els = {};
    this._hist = null;
    this._busy = false;
    this._fetchedAt = 0;
    this._tick = null;
  }

  setConfig(config) {
    if (!config) throw new Error("Configuration invalide");
    this._config = {
      name: "Lave-vaisselle",
      hours: 12,
      points: 60,
      refresh: 120,
      price: 0.2,
      currency: "€",
      /** Puissance au-delà de laquelle on considère le cycle actif, en W. */
      running_threshold: 20,
      show_forecast: true,
      show_options: true,
      program_names: {},
      ...config,
    };
    this._programNames = { ...PROGRAM_FR, ...(this._config.program_names || {}) };
    this._built = false;
    this._hist = null;
    this._fetchedAt = 0;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
  }

  static async getConfigElement() {
    await ensureHaForm();
    return document.createElement("homeconnect-dishwasher-card-editor");
  }

  /** Configuration déduite : premier appareil exposant un `operation_state`. */
  static getStubConfig(hass) {
    const stub = { type: "custom:homeconnect-dishwasher-card", name: "Lave-vaisselle" };
    if (!hass?.states) return stub;
    const op = Object.keys(hass.states).find(
      (id) =>
        id.startsWith("sensor.") &&
        /operation_state$/.test(id) &&
        Array.isArray(hass.states[id].attributes?.options) &&
        hass.states[id].attributes.options.includes("Run")
    );
    if (!op) return stub;
    const dev = hass.entities?.[op]?.device_id;
    const same = (re, domain) =>
      Object.keys(hass.states).find(
        (id) => id.startsWith(domain) && hass.entities?.[id]?.device_id === dev && re.test(id)
      );
    const cfg = {
      ...stub,
      operation_state: op,
      program_progress: same(/program_progress$/, "sensor."),
      remaining_time: same(/remaining_program_time$/, "sensor."),
      active_program: same(/active_program$/, "sensor."),
      selected_program: same(/selected_program$/, "select."),
      program_phase: same(/program_phase$/, "sensor."),
      door: same(/_door$/, "binary_sensor."),
      salt: same(/_salt$/, "sensor."),
      rinse_aid: same(/rinse_aid$/, "sensor."),
      connection: same(/_connection$/, "binary_sensor."),
    };
    Object.keys(cfg).forEach((k) => cfg[k] === undefined && delete cfg[k]);
    const d = hass.devices?.[dev];
    if (d) cfg.name = d.name_by_user || d.name || cfg.name;
    const areaId = hass.entities?.[op]?.area_id || d?.area_id;
    const areaName = areaId ? hass.areas?.[areaId]?.name : null;
    if (areaName) cfg.area = areaName;
    return cfg;
  }

  getCardSize() {
    const c = this._config || {};
    let n = 5;
    if (c.salt || c.rinse_aid) n += 1;
    if (c.show_forecast && (c.energy_forecast || c.water_forecast)) n += 1;
    if (c.power) n += 3;
    return n;
  }

  /* ---------- Cycle de vie ---------- */

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
    if (first) this._fetch();
  }

  connectedCallback() {
    this._tick = setInterval(() => {
      this._update();
      if (Date.now() - this._fetchedAt > this._config.refresh * 1000) this._fetch();
    }, 20000);
  }

  disconnectedCallback() {
    if (this._tick) clearInterval(this._tick);
    this._tick = null;
  }

  /* ---------- Helpers ---------- */

  _st(id) {
    return id && this._hass ? this._hass.states[id] : null;
  }

  _s(id) {
    return this._st(id)?.state ?? null;
  }

  _num(id) {
    const s = this._st(id);
    if (!s) return null;
    const v = Number(s.state);
    return Number.isNaN(v) ? null : v;
  }

  _more(id) {
    if (id) fireEvent(this, "hass-more-info", { entityId: id });
  }

  _lang() {
    return this._hass?.locale?.language || "fr";
  }

  /**
   * Prix du kWh. Une entité prend le pas sur la valeur fixe : sur un contrat
   * à tarif variable, un prix figé peut se tromper d'un facteur 5.
   */
  _price() {
    const c = this._config;
    if (c.price_entity) {
      const v = this._num(c.price_entity);
      if (v != null) return v;
    }
    return Number(c.price) || 0;
  }

  _fmt(v, dec = 2) {
    if (v == null || Number.isNaN(v)) return "—";
    return new Intl.NumberFormat(this._lang(), { maximumFractionDigits: dec }).format(v);
  }

  /** Durée en minutes -> "4 h 20" ou "35 min". */
  _dur(minutes) {
    if (minutes == null || Number.isNaN(minutes) || minutes < 0) return "—";
    const total = Math.round(minutes);
    if (total < 60) return `${total} min`;
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return mm ? `${hh} h ${String(mm).padStart(2, "0")}` : `${hh} h`;
  }

  _clock(date) {
    return new Intl.DateTimeFormat(this._lang(), { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  _ago(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "";
    const d = Math.max(0, (Date.now() - t) / 1000);
    if (d < 60) return `${Math.round(d)} s`;
    if (d < 3600) return `${Math.round(d / 60)} min`;
    if (d < 86400) return `${Math.round(d / 3600)} h`;
    return `${Math.round(d / 86400)} j`;
  }

  _op() {
    return this._s(this._config.operation_state);
  }

  /**
   * Mode retenu : run | done | idle | delayed | alert.
   * Table explicite d'abord, repli flou ensuite, heuristiques en dernier.
   * Le drapeau « à vider » ne l'emporte que si aucun cycle n'est en cours.
   */
  _mode() {
    const c = this._config;
    const raw = this._rawMode();
    /* Le drapeau ne peut requalifier qu'un appareil au repos ou déjà terminé.
       Il ne doit jamais masquer une alerte, un cycle en cours ou un départ
       différé : une panne resterait invisible tant que la vaisselle n'a pas
       été vidée. */
    if (["idle", "done"].includes(raw) && c.clean_flag && this._s(c.clean_flag) === "on")
      return "done";
    return raw;
  }

  _rawMode() {
    const c = this._config;
    const table = { ...STATE_MODE, ...(c.state_map || {}) };
    const st = this._s(c.operation_state);
    if (st && !["unknown", "unavailable"].includes(st)) {
      const v = norm(st).split(".").pop();
      if (table[v]) return table[v];
      for (const [mode, words] of FUZZY) {
        if (words.some((w) => v.includes(w))) return mode;
      }
    }
    // Heuristiques : puissance mesurée, puis temps restant
    const p = this._num(c.power);
    if (p != null) return p > (Number(c.running_threshold) || 20) ? "run" : "idle";
    const rem = this._remainingMinutes();
    return rem != null && rem > 0 ? "run" : "idle";
  }

  _running() {
    return this._mode() === "run";
  }

  /**
   * Minutes restantes, quelle que soit la forme de l'entité : horodatage ISO,
   * durée HH:MM:SS, ou nombre avec unité s / min / h.
   */
  _remainingMinutes() {
    const c = this._config;
    const s = this._st(c.remaining_time);
    if (!s) return null;
    const raw = s.state;
    if (["unknown", "unavailable", ""].includes(raw)) return null;
    if (/\d{4}-\d{2}-\d{2}T/.test(raw)) {
      const d = (new Date(raw).getTime() - Date.now()) / 60000;
      return Number.isNaN(d) ? null : Math.max(0, d);
    }
    if (/^\d+:\d{2}(:\d{2})?$/.test(raw)) {
      const p = raw.split(":").map(Number);
      return p[0] * 60 + p[1] + (p[2] || 0) / 60;
    }
    const v = Number(raw);
    if (Number.isNaN(v)) return null;
    const u = norm(c.remaining_unit || s.attributes?.unit_of_measurement || "min");
    if (["s", "sec", "second", "seconds"].includes(u)) return v / 60;
    if (["h", "hour", "hours"].includes(u)) return v * 60;
    return v;
  }

  _startInMinutes() {
    const c = this._config;
    const s = this._st(c.start_in);
    if (!s) return null;
    const v = Number(s.state);
    if (Number.isNaN(v)) return null;
    const u = norm(s.attributes?.unit_of_measurement || "min");
    if (["s", "sec", "seconds"].includes(u)) return v / 60;
    if (["h", "hour", "hours"].includes(u)) return v * 60;
    return v;
  }

  /** Niveau d'un consommable, tolérant aux énumérations et aux binaires. */
  _level(id) {
    const s = this._st(id);
    if (!s) return null;
    const raw = s.state;
    if (["unknown", "unavailable", ""].includes(raw)) return null;
    const n = Number(raw);
    if (!Number.isNaN(n)) {
      const warn = Number(this._config.consumable_warning ?? 30);
      const rank = n <= warn / 3 ? 0 : n <= warn ? 1 : 2;
      return { rank, pct: Math.max(0, Math.min(100, n)), text: `${Math.round(n)} %` };
    }
    const v = norm(raw);
    const map = { ...LEVEL_MAP, ...(this._config.consumable_map || {}) };
    let rank = map[v];
    if (rank === undefined) {
      // capteur binaire de type « niveau bas » : on = bas
      if (v === "on") rank = 0;
      else if (v === "off") rank = 2;
    }
    if (rank === undefined) return { rank: 2, pct: 100, text: raw };
    return { rank, pct: LEVEL_PCT[rank], text: LEVEL_FR[rank] };
  }

  _programLabel(raw) {
    if (!raw || ["unknown", "unavailable"].includes(raw)) return null;
    return this._programNames[raw] || raw;
  }

  /** Programme affiché : l'actif s'il existe, sinon le sélectionné. */
  _program() {
    const c = this._config;
    const active = this._programLabel(this._s(c.active_program));
    if (active) return { label: active, active: true };
    const sel = this._programLabel(this._s(c.selected_program));
    return sel ? { label: sel, active: false } : null;
  }

  /* ---------- Historique et consommation réelle ---------- */

  async _fetch() {
    const c = this._config;
    const ids = [c.power, c.energy, c.operation_state].filter(Boolean);
    if (!ids.length || !this._hass || this._busy) return;
    this._busy = true;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - c.hours * 3600 * 1000);
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        minimal_response: true,
        no_attributes: true,
        entity_ids: ids,
      });
      this._hist = { data: res || {}, start: start.getTime(), end: end.getTime() };
      this._fetchedAt = Date.now();
      this._renderCharts();
    } catch (err) {
      console.warn("homeconnect-dishwasher-card : historique indisponible", err);
      this._hist = { data: {}, start: 0, end: 0 };
      this._fetchedAt = Date.now();
      this._renderCharts();
    } finally {
      this._busy = false;
    }
  }

  _samples(id, numeric = true) {
    const h = this._hist;
    if (!h || !id || !h.data[id]) return [];
    const out = [];
    h.data[id].forEach((p) => {
      const t = p.lu != null ? p.lu * 1000 : new Date(p.last_updated).getTime();
      const raw = p.s !== undefined ? p.s : p.state;
      if (!t) return;
      if (numeric) {
        const v = Number(raw);
        if (!Number.isNaN(v)) out.push([t, v]);
      } else {
        out.push([t, raw]);
      }
    });
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }

  _series(id) {
    const h = this._hist;
    const s = this._samples(id);
    if (!h || s.length < 2) return null;
    const n = this._config.points;
    const step = (h.end - h.start) / (n - 1);
    const out = new Array(n).fill(null);
    let idx = 0;
    let last = s[0][1];
    for (let i = 0; i < n; i++) {
      const t = h.start + i * step;
      let sum = 0;
      let cnt = 0;
      while (idx < s.length && s[idx][0] <= t) {
        last = s[idx][1];
        sum += s[idx][1];
        cnt++;
        idx++;
      }
      out[i] = cnt ? sum / cnt : last;
    }
    return out;
  }

  /**
   * Découpe les cycles à partir de l'historique de `operation_state`, sinon
   * à partir de la puissance mesurée. Renvoie des intervalles [début, fin].
   */
  _cycles() {
    const c = this._config;
    const h = this._hist;
    if (!h) return [];
    const segs = [];
    const op = this._samples(c.operation_state, false);
    if (op.length) {
      let start = null;
      op.forEach(([t, v]) => {
        const run = ["Run", "Pause", "Aborting"].includes(v);
        if (run && start == null) start = t;
        if (!run && start != null) {
          segs.push([start, t]);
          start = null;
        }
      });
      if (start != null) segs.push([start, Date.now(), true]);
      return segs;
    }
    // Repli : seuil de puissance
    const p = this._samples(c.power);
    if (!p.length) return [];
    let start = null;
    p.forEach(([t, v]) => {
      const run = v > c.running_threshold;
      if (run && start == null) start = t;
      if (!run && start != null) {
        segs.push([start, t]);
        start = null;
      }
    });
    if (start != null) segs.push([start, Date.now(), true]);
    return segs;
  }

  /** Valeur du compteur d'énergie au plus tard à `t`, normalisée en kWh. */
  _meterAt(t) {
    const c = this._config;
    const s = this._samples(c.energy);
    if (!s.length) return null;
    const unit = (this._st(c.energy)?.attributes?.unit_of_measurement || "kWh").toLowerCase();
    const k = unit === "wh" ? 1 / 1000 : 1;
    let v = null;
    for (const [ts, val] of s) {
      if (ts > t) break;
      v = val;
    }
    return v == null ? null : v * k;
  }

  /**
   * Énergie d'un cycle. On privilégie le delta du compteur d'énergie, bien plus
   * précis que l'intégration de la puissance : sur une prise Legrand le compteur
   * publie une valeur toutes les trois minutes, la puissance seulement lors des
   * changements notables. L'intégration reste le repli.
   */
  _cycleEnergy(from, to) {
    const a = this._meterAt(from);
    const b = this._meterAt(to);
    if (a != null && b != null) {
      const d = b - a;
      // un delta négatif signale une remise à zéro du compteur : on retombe sur l'intégration
      if (d >= 0) return { kwh: d, source: "compteur" };
    }
    const i = this._integrate(from, to);
    return i == null ? null : { kwh: i, source: "puissance" };
  }

  /** Intégration en paliers de la puissance sur un intervalle, en kWh. */
  _integrate(from, to) {
    const p = this._samples(this._config.power);
    if (p.length < 2) return null;
    let wh = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const t0 = Math.max(p[i][0], from);
      const t1 = Math.min(p[i + 1][0], to);
      if (t1 <= t0) continue;
      // palier : la puissance reste à p[i] jusqu'au point suivant
      wh += (p[i][1] * (t1 - t0)) / 3600000;
    }
    return wh / 1000;
  }

  /* ---------- Construction ---------- */

  _build() {
    const c = this._config;
    this.shadowRoot.innerHTML = `<style>${HomeConnectDishwasherCard.styles}</style>${this._template()}`;
    this._built = true;
    const $ = (s) => this.shadowRoot.querySelector(s);
    const e = this._els;

    e.card = $("ha-card");
    e.halo = $(".halo");
    e.hn = $(".hn");
    e.hs = $(".hs");
    e.connDot = $(".conn");
    e.alert = $(".alert");
    e.stateLabel = $(".hero .k");
    e.stateVal = $(".hero .v");
    e.stateRight = $(".hero .right");
    e.stateRight2 = $(".hero .right2");
    e.prog = $(".pbar > i");
    e.progTxt = $(".ptxt");
    e.steps = $(".steps");
    e.progName = $(".prog-name");
    e.opts = $(".opts");
    e.cons = $(".cons");
    e.forecast = $(".forecast");
    e.tofill = $(".tofill");
    e.tofillSub = $(".tofill .tsub");
    e.bilanK = $(".bilan .bk");
    e.bilanSrc = $(".bilan .bsrc");
    e.bgrid = $(".bgrid");
    e.actions = $(".actions");
    e.real = $(".real");
    e.realPower = $(".real .rp");
    e.realCycle = $(".real .rc");
    e.realSlot = $(".real .slot");
    e.foot = $(".bar");
    e.footLeft = $(".bar .left");
    e.footRight = $(".bar .right");

    if (e.halo) e.halo.addEventListener("click", () => this._more(c.operation_state));
    if (e.tofill) e.tofill.addEventListener("click", () => this._more(c.clean_flag));
    const hero = $(".hero");
    if (hero) hero.addEventListener("click", () => this._more(c.operation_state));
    this.shadowRoot.querySelectorAll("[data-e]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._more(el.dataset.e);
      });
    });
  }

  _template() {
    const c = this._config;
    const svg = (p, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24">${p}</svg>`;
    const nothing = !c.operation_state;

    return `
      <ha-card>
        <div class="head">
          <div class="halo">${svg(ICONS.dishwasher)}<span class="conn"></span></div>
          <div class="htitle">
            <div class="hn"></div>
            <div class="hs">—</div>
          </div>
        </div>

        ${nothing ? `<div class="empty-hint">Renseignez au moins « État de fonctionnement ».</div>` : ""}

        <div class="alert hidden">${svg(ICONS.alert)}<span class="msg"></span></div>

        ${
          c.clean_flag
            ? `<div class="tofill hidden">
                 <span class="tdot"></span>
                 <span class="ttxt"><b>À vider</b><span class="tsub">—</span></span>
               </div>`
            : ""
        }

        ${
          !nothing
            ? `
        <div class="hero">
          <div class="k">—</div>
          <div class="hero-row">
            <div class="v">—</div>
            <div class="rblock">
              <div class="right">—</div>
              <div class="right2">—</div>
            </div>
          </div>
          <div class="pbar"><i></i></div>
          <div class="ptxt">—</div>
          <div class="steps"></div>
        </div>

        <div class="prow">
          <span class="prog-name">—</span>
          ${c.show_options ? `<span class="opts"></span>` : ""}
        </div>`
            : ""
        }

        ${c.salt || c.rinse_aid ? `<div class="cons"></div>` : ""}

        ${
          c.show_forecast && (c.energy_forecast || c.water_forecast)
            ? `<div class="forecast"></div>`
            : ""
        }

        ${
          c.power
            ? `<div class="real">
                 <div class="rhead">
                   <span class="k">Consommation mesurée</span>
                   <span class="rp">—</span>
                 </div>
                 <div class="slot"></div>
                 <div class="rc">—</div>
               </div>`
            : ""
        }

        <div class="bilan">
          <div class="lbl"><span class="bk">Bilan du cycle</span><span class="bsrc"></span></div>
          <div class="bgrid"></div>
        </div>

        <div class="actions hidden"></div>

        <div class="bar">
          <span class="left"></span>
          <span class="right"></span>
        </div>
      </ha-card>`;
  }

  /* ---------- Mise à jour ---------- */

  _update() {
    const c = this._config;
    const e = this._els;
    if (!this._hass || !this._built) return;

    const op = this._op();
    const mode = this._mode();
    const running = mode === "run";
    const finished = mode === "done";
    const problem = mode === "alert";
    const delayed = mode === "delayed";

    e.hn.textContent = c.area ? `${c.name} · ${c.area}` : c.name;

    /* Connexion */
    if (e.connDot) {
      const cn = this._s(c.connection);
      e.connDot.className = "conn";
      if (!c.connection) e.connDot.classList.add("hidden");
      else e.connDot.classList.add(cn === "on" ? "ok" : "bad");
      e.connDot.title = cn === "on" ? "Connecté" : "Hors ligne";
    }
    if (e.halo) e.halo.classList.toggle("active", running);
    if (e.card) e.card.classList.toggle("is-problem", problem);

    /* Sous-titre */
    const st = this._st(c.operation_state);
    if (e.hs) {
      const label = STATE_FR[op] || op || "—";
      e.hs.textContent = st ? `${label} · depuis ${this._ago(st.last_changed)}` : "—";
    }

    /* Bandeau : problème, ou porte ouverte pendant un cycle */
    if (e.alert) {
      const msgs = [];
      if (problem) {
        const lbl = STATE_FR[op];
        msgs.push(lbl ? `${lbl} — intervention sur l'appareil` : "Anomalie signalée par l'appareil");
      }
      if (this._s(c.program_aborted) === "on") msgs.push("Programme interrompu");
      if (running && this._s(c.door) === "on") msgs.push("Porte ouverte pendant le cycle");
      e.alert.querySelector(".msg").textContent = msgs.join(" · ");
      e.alert.classList.toggle("hidden", !msgs.length);
    }

    /* Bandeau à vider */
    if (e.tofill) {
      const flag = this._st(c.clean_flag);
      const on = flag?.state === "on";
      e.tofill.classList.toggle("hidden", !on);
      if (on && e.tofillSub)
        e.tofillSub.textContent = `La vaisselle est propre depuis ${this._ago(flag.last_changed)}`;
    }

    /* Bloc principal */
    const prog = this._num(c.program_progress);
    const remaining = this._remainingMinutes();
    const startIn = this._startInMinutes();
    const program = this._program();

    if (e.stateVal) {
      if (running && prog != null) {
        e.stateLabel.textContent = PHASE_FR[this._s(c.program_phase)] || STATE_FR[op] || "En marche";
        e.stateVal.innerHTML = `${Math.round(prog)}<span class="u">%</span>`;
      } else {
        e.stateLabel.textContent = program ? (program.active ? "Programme" : "Programme sélectionné") : "État";
        e.stateVal.innerHTML = `<span class="txt ${problem ? "bad" : finished ? "ok" : ""}">${esc(
          STATE_FR[op] || op || "—"
        )}</span>`;
      }
    }

    /**
     * `remaining_program_time` porte l'attribut « Is Estimated ». Hors cycle,
     * il vaut la durée prévue du programme sélectionné, pas un décompte.
     * Afficher « Temps restant » dans ce cas serait faux.
     */
    if (e.stateRight) {
      let r1 = "—";
      let r2 = "";
      if (delayed && startIn != null && startIn > 0) {
        r1 = this._dur(startIn);
        r2 = "avant départ";
      } else if (running && remaining != null) {
        r1 = this._dur(remaining);
        r2 = `fin vers ${this._clock(new Date(Date.now() + remaining * 60000))}`;
      } else if (remaining != null && remaining > 0) {
        r1 = this._dur(remaining);
        r2 = "durée estimée";
      } else if (finished) {
        r1 = "Terminé";
        r2 = st ? `il y a ${this._ago(st.last_changed)}` : "";
      }
      e.stateRight.textContent = r1;
      e.stateRight2.textContent = r2;
    }

    /* Barre de progression */
    if (e.prog) {
      const pct = running && prog != null ? Math.max(0, Math.min(100, prog)) : finished ? 100 : 0;
      e.prog.style.width = `${pct}%`;
      e.prog.className = finished ? "done" : "";
      e.progTxt.textContent = running && prog != null ? `${Math.round(pct)} % effectué` : "";
      e.progTxt.classList.toggle("hidden", !(running && prog != null));
    }

    /* Étapes du cycle. Si l'appareil ne publie pas de phase, on la déduit de
       la progression via les poids relatifs des étapes. */
    if (e.steps) {
      const cur = this._s(c.program_phase);
      let idx = PHASES.indexOf(cur);
      if (idx < 0 && running && prog != null) {
        const w = c.phase_weights || [0.14, 0.44, 0.22, 0.2];
        const tot = w.reduce((a, b) => a + b, 0);
        let acc = 0;
        for (let k = 0; k < PHASES.length; k++) {
          acc += (w[k] ?? 1) / tot;
          if (prog / 100 < acc) {
            idx = k;
            break;
          }
        }
        if (idx < 0) idx = PHASES.length - 1;
      }
      e.steps.innerHTML = PHASES.map((p, i) => {
        let cls = "";
        if (idx >= 0 && i < idx) cls = "past";
        else if (idx >= 0 && i === idx) cls = "now";
        return `<span class="step ${cls}">${PHASE_FR[p]}</span>`;
      }).join("");
      e.steps.classList.toggle("hidden", !c.program_phase || idx < 0);
    }

    /* Programme et options */
    if (e.progName) e.progName.textContent = program ? program.label : "—";
    if (e.opts) {
      const map = [
        ["extra_dry", "Séchage +"],
        ["half_load", "Demi-charge"],
        ["hygiene_plus", "Hygiène +"],
        ["vario_speed", "VarioSpeed"],
        ["silence", "Silence"],
        ["child_lock", "Sécurité enfant"],
      ];
      const on = map
        .filter(([k]) => c[k] && this._s(c[k]) === "on")
        .map(([k, l]) => `<span class="chip" data-e="${esc(c[k])}">${esc(l)}</span>`);
      e.opts.innerHTML = on.join("");
    }

    /* Consommables */
    if (e.cons) {
      const row = (key, icon, label) => {
        if (!c[key]) return "";
        const lv = this._level(c[key]);
        const rank = lv ? lv.rank : null;
        const cls = rank === 0 ? "bad" : rank === 1 ? "warn" : rank === 2 ? "ok" : "";
        return `<div class="cbox ${cls}" data-e="${esc(c[key])}">
          <svg viewBox="0 0 24 24">${icon}</svg>
          <div class="ct"><div class="cl">${label}</div><div class="cv">${esc(lv ? lv.text : "—")}</div>
          <div class="cbar"><i style="width:${lv ? lv.pct : 0}%"></i></div></div>
        </div>`;
      };
      e.cons.innerHTML = row("salt", ICONS.salt, "Sel régénérant") + row("rinse_aid", ICONS.drop, "Liquide de rinçage");
    }

    /* Prévisions Home Connect : pourcentages relatifs, pas des kWh ni des litres */
    if (e.forecast) {
      const bar = (key, label) => {
        const v = this._num(c[key]);
        if (v == null) return "";
        return `<div class="fb" data-e="${esc(c[key])}">
          <div class="fl"><span>${label}</span><b>${Math.round(v)} %</b></div>
          <div class="ft"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>
        </div>`;
      };
      e.forecast.innerHTML =
        `<div class="fh">Prévision relative du programme</div>` +
        bar("energy_forecast", "Énergie") +
        bar("water_forecast", "Eau");
    }

    if (e.realPower) {
      const p = this._num(c.power);
      e.realPower.textContent = p == null ? "—" : `${this._fmt(p, 0)} ${this._st(c.power)?.attributes?.unit_of_measurement || "W"}`;
    }

    this._updateActions(mode);
    this._updateFooter();
  }

  /** Actions disponibles selon le mode. Les entités indisponibles sont masquées. */
  _updateActions(mode) {
    const c = this._config;
    const e = this._els;
    if (!e.actions) return;
    const avail = (id) => !!id && !!this._st(id) && this._st(id).state !== "unavailable";

    const acts = [];
    if (mode === "run") {
      if (avail(c.pause_button)) acts.push({ l: "Pause", ghost: true, id: c.pause_button });
      if (avail(c.stop_button)) acts.push({ l: "Arrêter", ghost: true, id: c.stop_button });
    } else if (mode === "done") {
      if (c.clean_flag) acts.push({ l: "Marquer comme vidé", flag: c.clean_flag });
    } else if (mode === "delayed") {
      /* Un départ est déjà programmé : proposer « Démarrer » serait ambigu. */
      if (avail(c.stop_button)) acts.push({ l: "Annuler le départ", ghost: true, id: c.stop_button });
    } else if (mode === "idle") {
      if (avail(c.start_button)) acts.push({ l: "Démarrer", id: c.start_button });
    }
    /* En mode alerte on n'expose aucune action : l'appareil demande une
       intervention physique, lui envoyer un ordre n'aurait pas de sens. */

    e.actions.innerHTML = acts
      .map((a, i) => `<div class="btn${a.ghost ? " ghost" : ""}" data-i="${i}">${a.l}</div>`)
      .join("");
    e.actions.classList.toggle("hidden", !acts.length);
    e.actions.querySelectorAll(".btn").forEach((btn) => {
      const a = acts[Number(btn.dataset.i)];
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (a.flag) {
          const d = domainOf(a.flag);
          this._hass.callService(d === "input_boolean" ? d : "homeassistant", "turn_off", {
            entity_id: a.flag,
          });
        } else if (a.id) {
          const d = domainOf(a.id);
          const press = d === "button" || d === "input_button";
          this._hass.callService(press ? d : "homeassistant", press ? "press" : "turn_on", {
            entity_id: a.id,
          });
        }
      });
    });
  }

  _updateFooter() {
    const c = this._config;
    const e = this._els;
    if (!e.footLeft) return;
    const bits = [];
    if (c.door) bits.push(this._s(c.door) === "on" ? "Porte ouverte" : "Porte fermée");
    if (c.power_state) bits.push(this._s(c.power_state) === "on" ? "Sous tension" : "Hors tension");
    e.footLeft.textContent = bits.join(" · ");
    if (!e.footRight.textContent) e.footRight.textContent = "";
  }

  /* ---------- Graphiques et énergie du cycle ---------- */

  _renderCharts() {
    const c = this._config;
    const e = this._els;
    if (!this._built || !this._hist) return;
    const uid = Math.random().toString(36).slice(2, 7);

    if (e.realSlot) {
      const serie = this._series(c.power);
      e.realSlot.innerHTML = buildSpark(serie || [], 342, 34, COL.power, `gD${uid}`);
    }

    /* Énergie du cycle : intégration de la puissance sur l'intervalle du
       cycle, découpé depuis l'historique de `operation_state`. */
    if (e.realCycle) {
      const cycles = this._cycles();
      const price = this._price();
      const parts = [];
      const last = cycles.length ? cycles[cycles.length - 1] : null;
      /* Un segment n'est « en cours » que s'il a été clos par l'instant présent,
         pas par un changement d'état. Sinon l'appareil vient de démarrer et
         l'historique ne contient encore que le cycle précédent : on ne doit pas
         attribuer son énergie au cycle en cours. */
      const open = !!(last && last[2] === true);
      const running = this._running();

      if (running && !open) {
        parts.push("Cycle en cours · mesure en attente");
        if (last) {
          const r = this._cycleEnergy(last[0], last[1]);
          if (r) parts.push(`dernier cycle ${this._fmt(r.kwh, 2)} kWh`);
        }
      } else if (last) {
        const r = this._cycleEnergy(last[0], last[1]);
        const dur = (last[1] - last[0]) / 3600000;
        if (r) {
          parts.push(
            `${open && running ? "Cycle en cours" : "Dernier cycle"} · ${this._fmt(r.kwh, 2)} kWh` +
              (price ? ` · ${this._fmt(r.kwh * price, 2)} ${c.currency}` : "")
          );
          parts.push(`durée ${this._dur(dur)}`);
          if (r.source === "puissance") parts.push("estimé");
        }
        if (!(open && running) && cycles.length > 1) {
          const prev = cycles[cycles.length - 2];
          const r2 = this._cycleEnergy(prev[0], prev[1]);
          if (r2) parts.push(`précédent ${this._fmt(r2.kwh, 2)} kWh`);
        }
      } else {
        parts.push(`Aucun cycle sur ${c.hours} h`);
      }
      e.realCycle.textContent = parts.join(" · ");
    }

    /* Bilan du cycle */
    if (e.bgrid) {
      const cycles = this._cycles();
      const last = cycles.length ? cycles[cycles.length - 1] : null;
      const open = !!(last && last[2] === true);
      const running = this._running();
      const price = this._price();

      let durMin = null;
      let kwh = null;
      let source = null;
      if (last) {
        durMin = (last[1] - last[0]) / 60000;
        const r = this._cycleEnergy(last[0], last[1]);
        if (r) {
          kwh = r.kwh;
          source = r.source;
        }
      }
      // entités dédiées si l'intégration en fournit
      const dedEnergy = this._num(c.cycle_energy);
      if (dedEnergy != null) {
        kwh = dedEnergy;
        source = "appareil";
      }
      const dedDur = this._num(c.cycle_duration);
      if (dedDur != null) durMin = dedDur;
      const water = this._num(c.cycle_water);

      if (running && !open) {
        e.bilanK.textContent = "Cycle en cours";
        e.bilanSrc.textContent = "mesure en attente";
        durMin = null;
        kwh = dedEnergy != null ? dedEnergy : null;
      } else {
        e.bilanK.textContent = open && running ? "Cycle en cours" : "Dernier cycle";
        e.bilanSrc.textContent = source ? `source : ${source}` : "";
      }

      const cells = [
        { k: "Durée", v: this._dur(durMin) },
        { k: "Énergie", v: kwh != null ? `${this._fmt(kwh, 2)} kWh` : "—" },
        { k: "Eau", v: water != null ? `${this._fmt(water, 1)} L` : "—" },
        {
          k: "Coût",
          v: kwh != null && price ? `${this._fmt(kwh * price, 2)} ${c.currency}` : "—",
        },
      ];
      e.bgrid.innerHTML = cells
        .map((x) => `<div class="bc"><span class="ck">${x.k}</span><span class="cv">${x.v}</span></div>`)
        .join("");
    }

    /* Total cumulé de la prise, en pied de carte */
    if (e.footRight) {
      const tot = this._num(c.energy);
      if (tot != null) {
        const u = this._st(c.energy)?.attributes?.unit_of_measurement || "kWh";
        // Certaines prises Legrand publient des Wh avec une précision absurde
        const kwh = u.toLowerCase() === "wh" ? tot / 1000 : tot;
        e.footRight.textContent = `total ${this._fmt(kwh, 1)} kWh`;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

HomeConnectDishwasherCard.styles = `
:host{
  --dw-bg1:#1a1d24; --dw-bg2:#15181e; --dw-bg3:#111318;
  --dw-txt:#eef1f6; --dw-ok:#8fbfae; --dw-warn:#dfb37a; --dw-bad:#c98f8f; --dw-info:#8fb0c9;
  display:block;
}
*{box-sizing:border-box;}
.hidden{display:none !important;}

ha-card{
  border-radius:var(--ha-card-border-radius,18px);
  padding:17px 16px 15px;position:relative;overflow:hidden;
  border:1px solid rgba(255,255,255,.06);
  background:linear-gradient(170deg,var(--dw-bg1) 0%,var(--dw-bg2) 60%,var(--dw-bg3) 100%);
  color:var(--dw-txt);
  font-family:var(--primary-font-family,"Inter","Segoe UI",Roboto,sans-serif);
}
ha-card::before{
  content:"";position:absolute;left:16px;right:16px;top:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);
}
ha-card.is-problem{border-color:rgba(201,143,143,.4);}

/* Tête */
.head{display:flex;align-items:center;gap:10px;}
.halo{width:36px;height:36px;border-radius:11px;flex-shrink:0;position:relative;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.11);}
.halo svg{width:17px;height:17px;fill:rgba(255,255,255,.55);}
.halo.active{background:rgba(143,176,201,.14);border-color:rgba(143,176,201,.35);}
.halo.active svg{fill:var(--dw-info);}
.conn{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;
  background:rgba(255,255,255,.3);border:2px solid var(--dw-bg1);}
.conn.ok{background:var(--dw-ok);}
.conn.bad{background:var(--dw-bad);}
.htitle{flex:1;min-width:0;}
.hn{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.hs{font-size:11px;color:rgba(255,255,255,.5);margin-top:2px;}

/* Bandeau */
.alert{margin-top:13px;padding:10px 12px;border-radius:10px;display:flex;align-items:center;gap:9px;
  background:rgba(201,143,143,.14);border:1px solid rgba(201,143,143,.42);
  font-size:11.5px;font-weight:700;color:#e8b4b4;}
.alert svg{width:15px;height:15px;fill:var(--dw-bad);flex-shrink:0;}
.empty-hint{margin-top:16px;padding:14px 12px;border-radius:11px;text-align:center;
  background:rgba(255,255,255,.035);border:1px dashed rgba(255,255,255,.14);
  font-size:11.5px;color:rgba(255,255,255,.5);}

/* Bloc principal */
.hero{margin-top:18px;cursor:pointer;}
.k{font-size:9px;letter-spacing:2px;text-transform:uppercase;
  color:rgba(255,255,255,.42);font-weight:600;}
.hero-row{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:5px;}
.v{font-size:44px;font-weight:200;letter-spacing:-2.5px;line-height:1;
  font-variant-numeric:tabular-nums;display:flex;align-items:baseline;min-width:0;}
.v .u{font-size:18px;font-weight:300;color:rgba(255,255,255,.45);margin-left:3px;letter-spacing:0;}
.v .txt{font-size:26px;font-weight:300;letter-spacing:-.6px;line-height:1.15;}
.v .txt.ok{color:var(--dw-ok);}
.v .txt.bad{color:var(--dw-bad);}
.rblock{text-align:right;flex-shrink:0;padding-bottom:4px;}
.right{font-size:13px;font-weight:600;color:rgba(255,255,255,.78);font-variant-numeric:tabular-nums;}
.right2{font-size:9.5px;color:rgba(255,255,255,.36);margin-top:3px;}

.pbar{margin-top:12px;height:5px;border-radius:3px;background:rgba(255,255,255,.07);overflow:hidden;}
.pbar > i{display:block;height:100%;width:0;border-radius:3px;
  background:linear-gradient(90deg,rgba(143,176,201,.65),var(--dw-info));
  transition:width .6s ease;}
.pbar > i.done{background:linear-gradient(90deg,rgba(143,191,174,.6),var(--dw-ok));}
.ptxt{font-size:9.5px;color:rgba(255,255,255,.34);margin-top:5px;font-variant-numeric:tabular-nums;}

.steps{display:flex;gap:5px;margin-top:10px;}
.step{flex:1;text-align:center;font-size:8.5px;letter-spacing:.4px;text-transform:uppercase;
  font-weight:600;padding:5px 2px;border-radius:7px;color:rgba(255,255,255,.3);
  background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);}
.step.past{color:rgba(143,191,174,.75);border-color:rgba(143,191,174,.22);}
.step.now{color:var(--dw-info);background:rgba(143,176,201,.14);border-color:rgba(143,176,201,.38);}

/* Bandeau a vider */
.tofill{margin-top:13px;padding:10px 12px;border-radius:12px;cursor:pointer;
  display:flex;align-items:center;gap:10px;
  background:rgba(143,191,174,.09);border:1px solid rgba(143,191,174,.26);}
.tdot{width:7px;height:7px;border-radius:50%;background:var(--dw-ok);flex-shrink:0;
  box-shadow:0 0 8px rgba(143,191,174,.5);}
.ttxt b{display:block;font-size:12px;font-weight:700;color:#cfe4dc;}
.ttxt .tsub{display:block;font-size:10.5px;color:rgba(255,255,255,.48);margin-top:2px;}

/* Bilan du cycle */
.bilan{margin-top:16px;}
.lbl{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;}
.bk{font-size:9px;letter-spacing:2px;text-transform:uppercase;
  color:rgba(255,255,255,.42);font-weight:600;}
.bsrc{font-size:9px;color:rgba(255,255,255,.3);}
.bgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}
@media (max-width:340px){.bgrid{grid-template-columns:repeat(2,1fr);}}
.bc{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.075);
  border-radius:11px;padding:9px 5px;text-align:center;}
.ck{display:block;font-size:8px;letter-spacing:.9px;text-transform:uppercase;
  color:rgba(255,255,255,.38);font-weight:600;}
.cv{display:block;font-size:13px;font-weight:600;margin-top:5px;
  font-variant-numeric:tabular-nums;letter-spacing:-.2px;}

/* Actions */
.actions{display:flex;gap:7px;margin-top:15px;}
.btn{flex:1;text-align:center;font-size:12px;font-weight:600;padding:11px 0;
  border-radius:11px;background:rgba(233,238,246,.14);
  border:1px solid rgba(255,255,255,.22);color:var(--dw-txt);cursor:pointer;transition:.15s;}
.btn:hover{background:rgba(233,238,246,.2);}
.btn:active{transform:scale(.985);}
.btn.ghost{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.09);
  color:rgba(255,255,255,.6);}
.btn.ghost:hover{color:var(--dw-txt);}

/* Programme */
.prow{margin-top:14px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;}
.prog-name{font-size:12.5px;font-weight:600;color:rgba(255,255,255,.82);}
.opts{display:flex;flex-wrap:wrap;gap:5px;margin-left:auto;}
.chip{font-size:9px;font-weight:600;letter-spacing:.3px;padding:3px 7px;border-radius:6px;
  cursor:pointer;background:rgba(143,176,201,.12);border:1px solid rgba(143,176,201,.3);
  color:#bcd0e0;}

/* Consommables */
.cons{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:7px;}
@media (max-width:330px){.cons{grid-template-columns:1fr;}}
.cbox{display:flex;align-items:center;gap:9px;padding:10px 11px;border-radius:12px;cursor:pointer;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.075);transition:.15s;}
.cbox svg{width:16px;height:16px;flex-shrink:0;fill:rgba(255,255,255,.35);}
.ct{min-width:0;}
.cl{font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.4);
  font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cv{font-size:13px;font-weight:600;margin-top:2px;color:rgba(255,255,255,.8);}
.cbar{margin-top:6px;height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;}
.cbar > i{display:block;height:100%;border-radius:2px;transition:width .3s;
  background:rgba(255,255,255,.5);}
.cbox.warn .cbar > i{background:var(--dw-warn);}
.cbox.bad .cbar > i{background:var(--dw-bad);}
.cbox.ok svg{fill:var(--dw-ok);}
.cbox.warn{background:rgba(223,179,122,.09);border-color:rgba(223,179,122,.3);}
.cbox.warn svg{fill:var(--dw-warn);}
.cbox.warn .cv{color:var(--dw-warn);}
.cbox.bad{background:rgba(201,143,143,.11);border-color:rgba(201,143,143,.36);}
.cbox.bad svg{fill:var(--dw-bad);}
.cbox.bad .cv{color:var(--dw-bad);}

/* Prévisions */
.forecast{margin-top:14px;padding:11px 12px;border-radius:12px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);}
.fh{font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.34);
  font-weight:600;margin-bottom:8px;}
.fb{margin-top:7px;cursor:pointer;}
.fb:first-of-type{margin-top:0;}
.fl{display:flex;justify-content:space-between;font-size:10.5px;color:rgba(255,255,255,.5);}
.fl b{color:rgba(255,255,255,.78);font-variant-numeric:tabular-nums;}
.ft{height:4px;border-radius:2px;background:rgba(255,255,255,.07);margin-top:4px;overflow:hidden;}
.ft > i{display:block;height:100%;border-radius:2px;background:rgba(143,176,201,.6);}

/* Consommation mesurée */
.real{margin-top:14px;}
.rhead{display:flex;align-items:baseline;justify-content:space-between;}
.rp{font-size:13px;font-weight:600;color:rgba(255,255,255,.8);font-variant-numeric:tabular-nums;}
.real .spark{width:100%;height:34px;display:block;margin-top:7px;}
.rc{font-size:9.5px;color:rgba(255,255,255,.4);margin-top:4px;font-variant-numeric:tabular-nums;}

/* Pied */
.bar{margin-top:14px;padding-top:11px;border-top:1px solid rgba(255,255,255,.07);
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  font-size:10px;color:rgba(255,255,255,.4);}
.bar .right{text-align:right;font-variant-numeric:tabular-nums;}
`;

/* ------------------------------------------------------------------ */
/* Éditeur visuel                                                      */
/* ------------------------------------------------------------------ */

const FLAT_KEYS = [
  "name", "area", "operation_state", "active_program", "selected_program", "program_phase",
  "program_progress", "remaining_time", "start_in", "door", "connection", "power_state",
  "program_aborted", "salt", "rinse_aid", "energy_forecast", "water_forecast",
  "extra_dry", "half_load", "hygiene_plus", "vario_speed", "silence", "child_lock",
  "power", "energy", "price", "price_entity", "currency", "running_threshold",
  "clean_flag", "start_button", "pause_button", "stop_button",
  "cycle_energy", "cycle_water", "cycle_duration", "consumable_warning",
  "hours", "points", "refresh", "show_forecast", "show_options",
];
const MANAGED_KEYS = [...FLAT_KEYS, "type", "program_names", "state_map", "consumable_map", "phase_weights", "remaining_unit"];

const LABELS = {
  name: "Nom", area: "Pièce",
  operation_state: "État de fonctionnement", active_program: "Programme actif",
  selected_program: "Programme sélectionné", program_phase: "Phase du programme",
  program_progress: "Progression", remaining_time: "Temps restant ou durée estimée",
  start_in: "Départ différé", door: "Porte", connection: "Connexion",
  power_state: "Alimentation de l'appareil", program_aborted: "Programme interrompu",
  salt: "Sel régénérant", rinse_aid: "Liquide de rinçage",
  clean_flag: "Drapeau « à vider »",
  start_button: "Bouton Démarrer", pause_button: "Bouton Pause", stop_button: "Bouton Arrêter",
  cycle_energy: "Énergie du cycle (appareil)", cycle_water: "Eau du cycle (appareil)",
  cycle_duration: "Durée du cycle (appareil)",
  consumable_warning: "Seuil d'alerte consommable",
  energy_forecast: "Prévision énergie", water_forecast: "Prévision eau",
  extra_dry: "Séchage +", half_load: "Demi-charge", hygiene_plus: "Hygiène +",
  vario_speed: "VarioSpeed", silence: "Silence", child_lock: "Sécurité enfant",
  power: "Puissance mesurée (prise)", energy: "Énergie cumulée (prise)",
  price: "Prix du kWh", price_entity: "Entité de prix du kWh", currency: "Devise",
  running_threshold: "Seuil de cycle actif",
  hours: "Fenêtre d'historique", points: "Échantillons de courbe",
  refresh: "Relecture des données",
  show_forecast: "Afficher les prévisions", show_options: "Afficher les options actives",
};

const HELPERS = {
  remaining_time:
    "La même entité vaut le temps restant pendant un cycle, et la durée estimée du programme sélectionné à l'arrêt. La carte adapte l'étiquette.",
  power:
    "Prise mesurante alimentant l'appareil. Sert à calculer la consommation réelle par cycle, que Home Connect ne fournit pas.",
  energy_forecast:
    "Home Connect renvoie un pourcentage relatif au maximum de l'appareil, pas des kWh. La carte l'affiche comme tel.",
  running_threshold:
    "Utilisé seulement en repli, si l'historique de l'état de fonctionnement est indisponible.",
  price_entity:
    "Prend le pas sur le prix fixe. Indispensable sur un contrat à tarif variable comme EDF Tempo.",
  clean_flag:
    "input_boolean activé en fin de cycle. Fait apparaître le bandeau « À vider » et le bouton de remise à zéro.",
  cycle_energy:
    "Si l'appareil publie déjà l'énergie du cycle, elle prend le pas sur le calcul depuis la prise.",
  start_button:
    "Le démarrage à distance exige que l'appareil l'autorise. Le bouton est masqué si l'entité est indisponible.",
};

const SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "area", selector: { text: {} } },
  { name: "operation_state", selector: { entity: { filter: [{ domain: "sensor" }] } } },
  {
    type: "grid", name: "",
    schema: [
      { name: "program_progress", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "remaining_time", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "active_program", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "selected_program", selector: { entity: { filter: [{ domain: ["select", "sensor"] }] } } },
      { name: "program_phase", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "start_in", selector: { entity: { filter: [{ domain: "sensor" }] } } },
    ],
  },
  {
    type: "expandable", name: "", title: "Consommables et état", icon: "mdi:shaker-outline",
    schema: [
      { name: "salt", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "rinse_aid", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "door", selector: { entity: { filter: [{ domain: "binary_sensor" }] } } },
      { name: "connection", selector: { entity: { filter: [{ domain: "binary_sensor" }] } } },
      { name: "program_aborted", selector: { entity: { filter: [{ domain: "binary_sensor" }] } } },
      { name: "power_state", selector: { entity: { filter: [{ domain: ["sensor", "switch"] }] } } },
      { name: "clean_flag", selector: { entity: { filter: [{ domain: ["input_boolean", "switch", "binary_sensor"] }] } } },
      { name: "consumable_warning", selector: { number: { min: 1, max: 90, mode: "box", unit_of_measurement: "%" } } },
    ],
  },
  {
    type: "expandable", name: "", title: "Actions", icon: "mdi:gesture-tap-button",
    schema: [
      { name: "start_button", selector: { entity: { filter: [{ domain: ["button", "script", "scene"] }] } } },
      { name: "pause_button", selector: { entity: { filter: [{ domain: ["button", "script"] }] } } },
      { name: "stop_button", selector: { entity: { filter: [{ domain: ["button", "script"] }] } } },
    ],
  },
  {
    type: "expandable", name: "", title: "Options du programme", icon: "mdi:tune-variant",
    schema: [
      { name: "extra_dry", selector: { entity: { filter: [{ domain: "switch" }] } } },
      { name: "half_load", selector: { entity: { filter: [{ domain: "switch" }] } } },
      { name: "hygiene_plus", selector: { entity: { filter: [{ domain: "switch" }] } } },
      { name: "vario_speed", selector: { entity: { filter: [{ domain: "switch" }] } } },
      { name: "silence", selector: { entity: { filter: [{ domain: "switch" }] } } },
      { name: "child_lock", selector: { entity: { filter: [{ domain: "switch" }] } } },
      { name: "show_options", selector: { boolean: {} } },
    ],
  },
  {
    type: "expandable", name: "", title: "Consommation mesurée", icon: "mdi:flash",
    schema: [
      { name: "power", selector: { entity: { filter: [{ domain: "sensor", device_class: "power" }] } } },
      { name: "energy", selector: { entity: { filter: [{ domain: "sensor", device_class: "energy" }] } } },
      { name: "cycle_energy", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "cycle_water", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "cycle_duration", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      {
        type: "grid", name: "",
        schema: [
          { name: "price", selector: { number: { min: 0, max: 5, step: 0.0001, mode: "box" } } },
          { name: "currency", selector: { text: {} } },
          { name: "running_threshold", selector: { number: { min: 1, max: 500, mode: "box", unit_of_measurement: "W" } } },
        ],
      },
      { name: "price_entity", selector: { entity: { filter: [{ domain: ["sensor", "input_number"] }] } } },
    ],
  },
  {
    type: "expandable", name: "", title: "Prévisions et affichage", icon: "mdi:tune",
    schema: [
      { name: "energy_forecast", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "water_forecast", selector: { entity: { filter: [{ domain: "sensor" }] } } },
      { name: "show_forecast", selector: { boolean: {} } },
      {
        type: "grid", name: "",
        schema: [
          { name: "hours", selector: { number: { min: 1, max: 72, mode: "box", unit_of_measurement: "h" } } },
          { name: "points", selector: { number: { min: 8, max: 400, mode: "box" } } },
          { name: "refresh", selector: { number: { min: 30, max: 3600, mode: "box", unit_of_measurement: "s" } } },
        ],
      },
    ],
  },
];

class HomeConnectDishwasherCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  setConfig(config) {
    this._config = config ? { ...config } : {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    this._render();
  }

  connectedCallback() {
    ensureHaForm().then(() => this._render());
  }

  _data() {
    const c = this._config || {};
    const d = {};
    FLAT_KEYS.forEach((k) => {
      if (c[k] !== undefined) d[k] = c[k];
    });
    return d;
  }

  /** Fusionne le formulaire dans la config, en conservant les clés inconnues. */
  _merge(v) {
    const out = { ...this._config };
    FLAT_KEYS.forEach((k) => {
      const val = v[k];
      if (val === "" || val === undefined || val === null) delete out[k];
      else out[k] = val;
    });
    return out;
  }

  _unmanaged() {
    const extra = Object.keys(this._config || {}).filter((k) => !MANAGED_KEYS.includes(k));
    if (this._config.program_names && Object.keys(this._config.program_names).length)
      extra.push("noms de programmes personnalisés");
    return extra;
  }

  _render() {
    if (!this.shadowRoot) return;
    if (!customElements.get("ha-form")) {
      this.shadowRoot.innerHTML = `<style>${HomeConnectDishwasherCardEditor.styles}</style>
        <div class="warn">Le composant <code>ha-form</code> n'a pas pu être chargé.
        Utilisez l'éditeur YAML de la carte.</div>`;
      return;
    }
    if (!this._form) {
      this.shadowRoot.innerHTML = `<style>${HomeConnectDishwasherCardEditor.styles}</style>
        <div class="wrap"></div><div class="note"></div>`;
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => LABELS[s.name] || s.name;
      this._form.computeHelper = (s) => HELPERS[s.name] || "";
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        fireEvent(this, "config-changed", { config: this._merge(ev.detail.value) });
      });
      this.shadowRoot.querySelector(".wrap").appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = SCHEMA;
    this._form.data = this._data();
    const extra = this._unmanaged();
    const note = this.shadowRoot.querySelector(".note");
    if (extra.length) {
      note.innerHTML = '<div class="keep">Conservé sans être éditable ici : <b></b>. Passez par l\'éditeur YAML pour y toucher.</div>';
      note.querySelector("b").textContent = extra.join(", ");
    } else note.innerHTML = "";
  }
}

HomeConnectDishwasherCardEditor.styles = `
:host{display:block;}
.warn,.keep{margin-top:12px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5;}
.warn{background:var(--warning-color,#dfb37a);color:#1c1c1c;}
.keep{background:rgba(143,176,201,.16);color:var(--primary-text-color);
  border:1px solid rgba(143,176,201,.4);}
code{font-family:monospace;}
`;

if (!customElements.get("homeconnect-dishwasher-card-editor")) {
  customElements.define("homeconnect-dishwasher-card-editor", HomeConnectDishwasherCardEditor);
}

/* ------------------------------------------------------------------ */

if (!customElements.get("homeconnect-dishwasher-card")) {
  customElements.define("homeconnect-dishwasher-card", HomeConnectDishwasherCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "homeconnect-dishwasher-card",
  name: "Home Connect Dishwasher Card",
  description:
    "Lave-vaisselle Bosch / Siemens / Neff : suivi de cycle, phases, consommables, et consommation réelle mesurée par une prise. Lecture seule.",
  preview: true,
  documentationURL: "https://github.com/junkoku38/homeconnect-dishwasher-card",
});
