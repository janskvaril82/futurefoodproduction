/* ==========================================================================
   IoT network designer — a farm near Lake Mälaren, five radio technologies.
   Model (Derive tab, Eqs. N1–N9):
   • link budget with free-space loss up to the two-ray break distance and a
     path-loss exponent n beyond it (N1–N2); wall losses from the 3GPP TR 38.901
     material formulas and foliage loss from Weissberger's model (N3);
     NB-IoT: Okumura–Hata macro-cell loss and the 164 dB coupling-loss target (N4);
   • receiver sensitivities from data sheets; log-normal shadowing → coverage
     probability; Rayleigh fading → per-packet success (N5);
   • LoRa time on air (Semtech) and the EU868 1 % duty cycle (N6–N7);
   • average current and battery life (N8); NB-IoT energy per report calibrated
     to the 3GPP TR 45.820 evaluation (N9).
   ========================================================================== */
import { Controls, Readouts, SimClock, fmt, hudChips, stageToolbar } from '/assets/js/ui.js';
import { Plot, BarChart } from '/assets/js/plot.js';
import { normCdf, normInv, mulberry32, randn, linreg, parseTable } from '/assets/js/stats.js';

/* ------------------------------------------------------------------ technologies */
const C0 = 299792458;
const LORA_S = { 7: -123, 8: -126, 9: -129, 10: -132, 11: -133, 12: -136 };   // SX1276, 125 kHz, band 1 (dBm)
const TECH = {
  wifi: { name: 'Wi-Fi 2.4 GHz', short: 'Wi-Fi', f: 2.437, ptx: 18, gn: 2, S: -98, col: '#5cc8ef', chart: 'water',
    hops: ['Sensor node', 'Wi-Fi access point', 'Router · internet', 'MQTT broker', 'Dashboard'], gwName: 'access point',
    phases: pl => [['measure', 0.5, 40], ['associate + listen', 1.7, 100], ['transmit', 0.3, 190]], sleep: 10, retries: 3,
    note: 'ESP32, 802.11b 1 Mbit/s: sensitivity −98 dBm; 18 dBm + 2 dBi = 20 dBm EIRP (EU limit)' },
  ble: { name: 'Bluetooth Low Energy', short: 'BLE', f: 2.44, ptx: 8, gn: 0, S: -95, col: '#a792f0', chart: 'c4',
    hops: ['Sensor node', 'BLE gateway (scanner)', 'Gateway software', 'MQTT broker', 'Dashboard'], gwName: 'BLE gateway',
    phases: (pl, phy) => { const tx = phy === 'coded' ? (3 * (80 + 296 + 12 * 64 + 24) + 400 + 64 * (Math.min(pl, 200) + 15)) * 1e-6 : 3 * (16 + Math.min(pl, 31)) * 8e-6 + 3 * 150e-6; return [['measure', 0.5, 5], ['advertise ×3 channels', tx, 16.4]]; },
    sleep: 3.16, retries: 0, diversity: 3, note: 'nRF52840, +8 dBm (16.4 mA); sensitivity −95 dBm (1 Mbit/s) or −103 dBm (125 kbit/s Coded)' },
  zigbee: { name: 'Zigbee (IEEE 802.15.4)', short: 'Zigbee', f: 2.44, ptx: 8, gn: 0, S: -100, col: '#f2b94b', chart: 'amber',
    hops: ['Sensor node', 'Zigbee coordinator', 'Zigbee2MQTT bridge', 'MQTT broker', 'Dashboard'], gwName: 'coordinator',
    phases: pl => [['measure', 0.5, 5], ['CSMA, ACK, poll parent', 0.012, 6.26], ['transmit', (33 + pl) * 32e-6 + 0.0006, 16.4]], sleep: 3.16, retries: 3,
    note: 'nRF52840 in 802.15.4 mode, +8 dBm; sensitivity −100 dBm at 250 kbit/s' },
  lora: { name: 'LoRaWAN EU868', short: 'LoRaWAN', f: 0.868, ptx: 13, gn: 2.15, S: null, col: '#6fd39a', chart: 'accent',
    hops: ['Sensor node', 'LoRaWAN gateway', 'Network server', 'MQTT broker', 'Dashboard'], gwName: 'gateway',
    phases: (pl, sf) => { const toa = loraToA(pl, sf); const ts = Math.pow(2, sf) / 125e3; return [['measure', 0.5, 5], ['transmit (time on air)', toa, 29], ['RX1 + RX2 windows', 16 * ts, 10.3]]; },
    sleep: 1.2, retries: 0, note: 'SX1276, +13 dBm (29 mA), 2.15 dBi: 13 dBm ERP ≤ 14 dBm ERP limit' },
  nbiot: { name: 'NB-IoT (LTE band 20)', short: 'NB-IoT', f: 0.8, ptx: 23, gn: 0, S: null, col: '#f07ad0', chart: 'magenta',
    hops: ['Sensor node', 'Base station (eNodeB)', 'Operator core network', 'MQTT broker', 'Dashboard'], gwName: 'base station',
    phases: () => [['measure', 0.5, 5]], sleep: 4.2, retries: 3, note: 'Power class 3 (23 dBm); coverage target: maximum coupling loss 164 dB' }
};
const TECH_KEYS = Object.keys(TECH);
/** LoRa time on air, s (Semtech formula; LoRaWAN: 13 bytes overhead, 8 preamble symbols, CR 4/5, CRC on, explicit header). */
function loraToA(appPayload, SF, BW = 125e3) {
  const Ts = Math.pow(2, SF) / BW, DE = Ts >= 0.016 ? 1 : 0, PL = appPayload + 13;
  const nPay = 8 + Math.max(Math.ceil((8 * PL - 4 * SF + 28 + 16) / (4 * (SF - 2 * DE))) * 5, 0);
  return (8 + 4.25) * Ts + nPay * Ts;
}
/** NB-IoT energy per report (J) versus coupling loss, calibrated to the TR 45.820 battery-life evaluation (Eq. N9). */
function nbEnergy(CL) { const a = [[144, 0.079], [154, 0.249], [164, 1.413]]; if (CL <= 144) return a[0][1]; if (CL >= 164) return a[2][1]; const i = CL < 154 ? 0 : 1; const f = (CL - a[i][0]) / 10; return Math.exp(Math.log(a[i][1]) + f * (Math.log(a[i + 1][1]) - Math.log(a[i][1]))); }

/* ------------------------------------------------------------------ the farm (metres; x east, y south) */
const WORLD = { w: 2400, h: 1500 };
const MAT = { wood: f => 4.85 + 0.12 * f, glass: f => 2 + 0.2 * f, concrete: f => 5 + 4 * f };
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const circlePoly = (cx, cy, r, n = 10) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
const BUILDINGS = [
  { id: 'farmhouse', name: 'Farmhouse', mat: 'wood', h: 5.5, poly: rect(1004, 646, 26, 15), roof: '#5b5f63', zone: 'farmhouse' },
  { id: 'barn', name: 'Barn', mat: 'wood', h: 9, poly: rect(1068, 684, 64, 26), roof: '#8e3a2e', zone: 'barn' },
  { id: 'greenhouse', name: 'Greenhouse', mat: 'glass', h: 5.5, poly: rect(944, 728, 96, 42), roof: '#cfe3ea', zone: 'greenhouse', crop: true },
  { id: 'workshop', name: 'Machine hall', mat: 'concrete', h: 8, poly: rect(1150, 640, 38, 26), roof: '#9aa0a4', zone: 'machine-hall' },
  { id: 'silo1', name: 'Grain silo', mat: 'concrete', h: 16, poly: circlePoly(1156, 724, 5.5), roof: '#c3c7ca', zone: 'grain-silo', round: [1156, 724, 5.5] },
  { id: 'silo2', name: 'Grain silo', mat: 'concrete', h: 16, poly: circlePoly(1170, 724, 5.5), roof: '#c3c7ca', zone: 'grain-silo', round: [1170, 724, 5.5] }
];
const FIELDS = [
  { id: 'north-field', name: 'North field · winter wheat', crop: 'wheat', poly: [[300, 90], [990, 70], [1010, 560], [290, 600]], angle: 0.1 },
  { id: 'rape-field', name: 'Oilseed rape', crop: 'rape', poly: [[1085, 75], [1880, 95], [1870, 560], [1170, 590]], angle: -0.05 },
  { id: 'ley', name: 'Ley (silage grass)', crop: 'ley', poly: [[1260, 660], [2330, 640], [2340, 1130], [1300, 1170]], angle: 1.5 },
  { id: 'south-field', name: 'South field · potatoes', crop: 'potato', poly: [[720, 860], [1240, 840], [1270, 1250], [780, 1300]], angle: 0.02 },
  { id: 'pasture', name: 'Pasture', crop: 'pasture', poly: [[40, 110], [255, 100], [245, 900], [40, 960]], angle: 0 }
];
const LAKE = [[0, 1040], [180, 1010], [330, 1030], [470, 1090], [580, 1190], [640, 1320], [610, 1500], [0, 1500]];
const STREAM = [[930, 0], [905, 90], [930, 190], [880, 300], [820, 380], [760, 470], [640, 560], [560, 690], [470, 820], [420, 950], [380, 1030]];
const VEG = [
  { id: 'forest-ne', name: 'Spruce forest', kind: 'forest', poly: [[1950, 0], [2400, 0], [2400, 560], [2230, 600], [2080, 560], [1930, 420], [1920, 180]] },
  { id: 'forest-se', name: 'Mixed forest', kind: 'forest', poly: [[1650, 1250], [2000, 1210], [2400, 1190], [2400, 1500], [1600, 1500], [1580, 1380]] },
  { id: 'hedge-1', name: 'Hedgerow', kind: 'hedge', poly: [[1040, 70], [1060, 70], [1080, 600], [1060, 600]] },
  { id: 'hedge-2', name: 'Tree row', kind: 'hedge', poly: [[1230, 620], [2330, 612], [2330, 628], [1230, 636]] },
  { id: 'hedge-3', name: 'Riparian trees', kind: 'hedge', poly: [[945, 20], [915, 190], [870, 300], [790, 410], [660, 540], [575, 690], [485, 830], [440, 980], [415, 975], [458, 822], [545, 680], [638, 528], [770, 398], [850, 290], [892, 188], [921, 18]] },
  { id: 'garden', name: 'Garden trees', kind: 'hedge', poly: [[960, 600], [1000, 596], [1004, 632], [962, 636]] },
  { id: 'alley', name: 'Avenue', kind: 'hedge', poly: [[1030, 560], [1042, 560], [1042, 640], [1030, 640]] }
];
const ROADS = [[[1000, 690], [1100, 676], [1250, 648], [1500, 642], [2400, 636]], [[1036, 560], [1036, 640]], [[1036, 0], [1036, 560]], [[1050, 780], [1030, 900], [980, 1500]]];
const YARD = [[935, 636], [1200, 626], [1210, 790], [930, 800]];

/* ------------------------------------------------------------------ geometry helpers */
function bbox(poly) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of poly) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; }
BUILDINGS.forEach(o => o.bb = bbox(o.poly)); VEG.forEach(o => o.bb = bbox(o.poly)); FIELDS.forEach(o => o.bb = bbox(o.poly));
function inside(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
/** Length (m) of segment AB inside a polygon and number of boundary crossings. */
function segPoly(ax, ay, bx, by, o) {
  const [x0, y0, x1, y1] = o.bb; if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) return null;
  const P = o.poly, dx = bx - ax, dy = by - ay, ts = [];
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ex = P[i][0] - P[j][0], ey = P[i][1] - P[j][1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue;
    const qx = P[j][0] - ax, qy = P[j][1] - ay; const t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) ts.push(t);
  }
  const ain = inside(P, ax, ay), bin = inside(P, bx, by);
  if (!ts.length) return ain ? { len: Math.hypot(dx, dy), cross: 0 } : null;
  ts.sort((p, q) => p - q); const all = [0, ...ts, 1]; let len = 0;
  for (let i = 0; i < all.length - 1; i++) { const m = (all[i] + all[i + 1]) / 2; if (inside(P, ax + m * dx, ay + m * dy)) len += (all[i + 1] - all[i]); }
  return { len: len * Math.hypot(dx, dy), cross: ts.length, ain, bin };
}
function obstacles(ax, ay, bx, by, fGHz, ha = 1, hb = 1) {
  let walls = 0, veg = 0; const list = [];
  for (const b of BUILDINGS) {
    if ((ha > b.h && inside(b.poly, ax, ay)) || (hb > b.h && inside(b.poly, bx, by))) continue;   // antenna mounted above this roof
    const r = segPoly(ax, ay, bx, by, b); if (!r) continue; if (r.cross) { const l = r.cross * MAT[b.mat](fGHz); walls += l; list.push([b.name, l]); } if (b.crop) veg += r.len; }
  for (const v of VEG) { const r = segPoly(ax, ay, bx, by, v); if (r) veg += r.len; }
  return { walls, veg, list };
}
/** Weissberger's modified exponential decay model for foliage loss (Eq. N3). */
function foliageLoss(fGHz, d) { if (d <= 0) return 0; d = Math.min(d, 400); return d <= 14 ? 0.45 * Math.pow(fGHz, 0.284) * d : 1.33 * Math.pow(fGHz, 0.284) * Math.pow(d, 0.588); }
const fspl = (d, fGHz) => 20 * Math.log10(4 * Math.PI * Math.max(d, 1) * fGHz * 1e9 / C0);
/** Dual-slope path loss: free space to the two-ray break point, exponent n beyond (Eqs. N1–N2). */
function pathLoss(d, fGHz, ht, hr, n) { const lam = C0 / (fGHz * 1e9), db = Math.max(1, 4 * ht * hr / lam); return d <= db ? fspl(d, fGHz) : fspl(db, fGHz) + 10 * n * Math.log10(d / db); }
/** Okumura–Hata macro-cell loss, dB (Eq. N4). f MHz, hb, hm m, d km. */
function hata(fMHz, hb, hm, dkm, env) {
  const lf = Math.log10(fMHz), a = (1.1 * lf - 0.7) * hm - (1.56 * lf - 0.8);
  const Lu = 69.55 + 26.16 * lf - 13.82 * Math.log10(hb) - a + (44.9 - 6.55 * Math.log10(hb)) * Math.log10(dkm);
  if (env === 'urban') return Lu;
  if (env === 'suburban') return Lu - 2 * Math.pow(Math.log10(fMHz / 28), 2) - 5.4;
  return Lu - 4.78 * lf * lf + 18.33 * lf - 40.94;
}

/* ------------------------------------------------------------------ controls */
const ui = new Controls('#controls', { url: true });
const ro = new Readouts('#readouts');
ro.add({ id: 'conn', label: 'Nodes with a reliable link', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'worst', label: 'Weakest link margin', unit: 'dB', digits: 1, note: '&nbsp;' })
  .add({ id: 'cov', label: 'Mean coverage probability Φ(M/σ)', unit: '%', digits: 0, note: '&nbsp;' })
  .add({ id: 'pdr', label: 'Packets delivered (animation)', unit: '%', digits: 1, note: '&nbsp;' })
  .add({ id: 'life', label: 'Median battery life', unit: '', format: v => v, note: '&nbsp;' })
  .add({ id: 'iavg', label: 'Average current (median node)', unit: 'µA', digits: 1, note: '&nbsp;' })
  .add({ id: 'toa', label: 'Airtime per message', unit: 'ms', digits: 1, note: '&nbsp;' })
  .add({ id: 'dc', label: 'LoRa: max. messages per hour (1 % duty cycle)', unit: 'h⁻¹', digits: 0, note: '&nbsp;' })
  .add({ id: 'ttn', label: 'LoRa: TTN fair use, messages per day', unit: 'd⁻¹', digits: 0, note: '&nbsp;' });

ui.section('Radio technology');
ui.segmented({ id: 'tech', label: '', options: TECH_KEYS.map(k => ({ value: k, label: TECH[k].short })), value: 'lora' });
ui.select({ id: 'sf', label: 'LoRa spreading factor', options: [{ value: 'adr', label: 'Adaptive data rate (network chooses)' }, ...[7, 8, 9, 10, 11, 12].map(s => ({ value: String(s), label: `SF${s} (${LORA_S[s]} dBm)` }))], value: 'adr' });
ui.segmented({ id: 'phy', label: 'BLE physical layer', options: [{ value: '1m', label: '1 Mbit/s (−95 dBm)' }, { value: 'coded', label: 'Coded 125 kbit/s (−103 dBm)' }], value: '1m' });
ui.toggle({ id: 'mesh', label: 'Zigbee mesh: mains-powered nodes relay', value: true });
ui.slider({ id: 'bsd', label: 'Distance to the mobile base station', min: 1, max: 20, step: 0.5, value: 6, unit: 'km', help: 'Okumura–Hata is valid for 1–20 km, base station 30 m high' });
ui.segmented({ id: 'hataEnv', label: 'Macro-cell environment (Hata)', options: [{ value: 'open', label: 'Open' }, { value: 'suburban', label: 'Rural with trees' }, { value: 'urban', label: 'Small town' }], value: 'suburban' });
ui.section('Antennas and propagation');
ui.slider({ id: 'hg', label: 'Gateway antenna height', min: 2, max: 30, step: 0.5, value: 6, unit: 'm', help: 'Drag the gateway on the map to move it' });
ui.slider({ id: 'gg', label: 'Gateway antenna gain', min: 0, max: 9, step: 0.5, value: 3, unit: 'dBi' });
ui.slider({ id: 'hn', label: 'Node antenna height', min: 0.3, max: 3, step: 0.1, value: 1, unit: 'm' });
ui.slider({ id: 'n', label: 'Path-loss exponent beyond the break point', min: 2, max: 4.5, step: 0.05, value: 3.8, help: '2 = free space; 4 = flat-earth two-ray; crops, trees and terrain: 3–4' });
ui.slider({ id: 'sigma', label: 'Shadowing σ', min: 2, max: 12, step: 0.5, value: 6, unit: 'dB' });
ui.segmented({ id: 'rel', label: 'Required link reliability', options: [{ value: 0.9, label: '90 %' }, { value: 0.95, label: '95 %' }, { value: 0.99, label: '99 %' }], value: 0.9 });
ui.section('Traffic and battery');
ui.slider({ id: 'T', label: 'Reporting interval', min: 10, max: 86400, log: true, value: 900, format: v => durTxt(v) });
ui.slider({ id: 'pl', label: 'Application payload', min: 1, max: 51, step: 1, value: 12, unit: 'bytes', help: 'LoRaWAN allows 51 bytes at SF10–SF12; BLE legacy advertising 31' });
ui.slider({ id: 'cap', label: 'Battery capacity', min: 200, max: 20000, log: true, value: 2600, unit: 'mAh', help: 'Li-SOCl₂ AA ≈ 2.6 Ah · D cell ≈ 19 Ah' });
ui.slider({ id: 'eta', label: 'Usable fraction η', min: 0.5, max: 1, step: 0.05, value: 0.8 });
ui.slider({ id: 'iboard', label: 'Extra board sleep current', min: 0.1, max: 5000, log: true, value: 2, unit: 'µA', help: 'Regulator, sensor, LED… a USB dev board can draw 5000 µA' });
ui.section('Map');
ui.segmented({ id: 'heat', label: 'Heat map', options: [{ value: 'margin', label: 'Link margin' }, { value: 'sf', label: 'LoRa SF (ADR)' }, { value: 'off', label: 'Off' }], value: 'margin' });
ui.buttons([
  { label: 'Farmyard', onClick: () => zoomTo(880, 560, 1260, 840) },
  { label: 'Whole farm', onClick: () => zoomTo(0, 0, WORLD.w, WORLD.h) }
]);
ui.buttons([
  { label: 'Remove selected node', onClick: () => { if (sel >= 0) { nodes.splice(sel, 1); sel = -1; recompute(); } } },
  { label: 'Clear nodes', onClick: () => { nodes = []; sel = -1; recompute(); } }
]);
ui.button({ label: 'New shadowing realisation', onClick: () => { shadowSeed++; recompute(); } });
ui.html('<p class="ctl-help" style="margin:6px 0 0"><b>Click</b> the map to place a sensor node · <b>drag</b> nodes or the gateway · drag empty space to pan · wheel to zoom.</p>');
const PRESET_NODES = {
  gh: [[970, 748], [1015, 752], [1100, 698], [1165, 652], [1021, 653]],
  field: [[640, 330], [860, 180], [1500, 330], [1760, 480], [1800, 900], [1450, 1000], [1000, 1060], [150, 520], [420, 1180], [2150, 300]],
  mesh: [[960, 740], [1000, 760], [1030, 745], [1080, 700], [1120, 700], [1160, 655], [1230, 700], [1330, 760], [1420, 800], [1520, 860]],
  remote: [[150, 300], [150, 820], [2250, 250], [2100, 1350], [520, 1250], [1700, 330]],
  ble: [[1000, 660], [1040, 700], [980, 745], [1060, 690], [1100, 705]]
};
ui.presets([
  { label: 'Greenhouse and barn on Wi-Fi', values: { tech: 'wifi', hg: 6, gg: 3, hn: 1.5, n: 3.5 }, onApply: () => setNodes(PRESET_NODES.gh) },
  { label: 'Fields on LoRaWAN', values: { tech: 'lora', sf: 'adr', hg: 6, gg: 3, hn: 1, n: 3.8 }, onApply: () => setNodes(PRESET_NODES.field, true) },
  { label: 'Zigbee mesh through the yard', values: { tech: 'zigbee', mesh: true, hg: 4, gg: 2, hn: 1.5, n: 3.3 }, onApply: () => setNodes(PRESET_NODES.mesh) },
  { label: 'Remote sites on NB-IoT', values: { tech: 'nbiot', bsd: 9, hataEnv: 'suburban', hn: 1 }, onApply: () => setNodes(PRESET_NODES.remote, true) },
  { label: 'BLE around the house', values: { tech: 'ble', phy: '1m', hg: 3, gg: 2, hn: 1.2, n: 3.3 }, onApply: () => setNodes(PRESET_NODES.ble) }
]);
ui.saveButton('iot-network', () => ro.values());
function durTxt(s) { s = +s; if (s < 60) return `${Math.round(s)} s`; if (s < 3600) return `${+(s / 60).toFixed(s < 600 ? 1 : 0)} min`; if (s < 86400) return `${+(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`; return `${+(s / 86400).toFixed(1)} d`; }
function lifeTxt(h) { const y = h / 8766; if (!isFinite(y)) return '—'; if (y >= 20) return '> 20 y'; if (y >= 1) return `${y.toFixed(y < 10 ? 1 : 0)} y`; const d = h / 24; if (d >= 1) return `${d.toFixed(d < 10 ? 1 : 0)} d`; return `${h.toFixed(1)} h`; }

/* ------------------------------------------------------------------ state */
let nodes = [];
let gw = { x: 1017, y: 652 };
let sel = -1, shadowSeed = 1, nodeSeq = 1;
function setNodes(list, zoomOut) { nodes = list.map(([x, y]) => mkNode(x, y)); sel = -1; if (zoomOut) zoomTo(0, 0, WORLD.w, WORLD.h); else zoomTo(880, 560, 1260, 840); recompute(); }
function zoneOf(x, y) {
  for (const b of BUILDINGS) if (inside(b.poly, x, y)) return { zone: b.zone, label: b.name, indoor: true };
  if (inside(LAKE, x, y)) return { zone: 'lake', label: 'Lake Mälaren (buoy)' };
  for (const v of VEG) if (v.kind === 'forest' && inside(v.poly, x, y)) return { zone: v.id === 'forest-ne' ? 'forest-north' : 'forest-south', label: v.name };
  for (const f of FIELDS) if (inside(f.poly, x, y)) return { zone: f.id, label: f.name.split(' · ')[0] };
  return { zone: 'yard', label: 'Farmyard / verge' };
}
const QUANT = {
  greenhouse: [['air', 'temperature', 'Cel', 22, 1.5], ['air', 'rh', '%RH', 72, 5], ['air', 'co2', 'ppm', 780, 60]],
  barn: [['air', 'nh3', 'ppm', 6, 2], ['air', 'temperature', 'Cel', 12, 1]],
  farmhouse: [['energy', 'power', 'W', 1800, 400]], 'machine-hall': [['fuel', 'tank-level', '%', 64, 3]], 'grain-silo': [['grain', 'temperature', 'Cel', 14, 0.5], ['grain', 'moisture', '%', 14.5, 0.3]],
  lake: [['water', 'temperature', 'Cel', 13, 0.4], ['water', 'do', 'mg/L', 9.8, 0.3]], pasture: [['water-trough', 'level', '%', 78, 6]],
  'forest-north': [['soil', 'moisture', '%VWC', 31, 2]], 'forest-south': [['soil', 'moisture', '%VWC', 33, 2]], yard: [['weather', 'temperature', 'Cel', 11, 1], ['weather', 'rain', 'mm', 0, 0.2]],
  field: [['soil', 'moisture', '%VWC', 27, 3], ['soil', 'temperature', 'Cel', 10.5, 0.8]]
};
function mkNode(x, y) {
  const z = zoneOf(x, y); const id = `n${String(nodeSeq++).padStart(2, '0')}`;
  const same = nodes.filter(n => n.zone === z.zone).length + 1;
  return { id, x, y, zone: z.zone, zlabel: z.label, indoor: !!z.indoor, point: `p${same}`, phase: Math.random(), next: 0, stats: { sent: 0, ok: 0 }, flash: 0 };
}

/* ------------------------------------------------------------------ link model */
function params() { const v = ui.values(); v.rel = +v.rel; v.F = normInv(v.rel) * v.sigma; return v; }
function budget(p, tk, sf, phy) {
  const t = TECH[tk];
  const S = tk === 'lora' ? LORA_S[sf] : tk === 'ble' ? (phy === 'coded' ? -103 : -95) : t.S;
  return { S, B: t.ptx + t.gn + p.gg - 1 - S };           // maximum allowed path + obstacle loss, dB (1 dB gateway cable loss)
}
function linkLoss(p, tk, ax, ay, bx, by, ht, hr) {
  const t = TECH[tk]; const d2 = Math.hypot(bx - ax, by - ay); const d = Math.hypot(d2, ht - hr);
  const ob = obstacles(ax, ay, bx, by, t.f, ht, hr); const lp = pathLoss(d, t.f, ht, hr, p.n); const lv = foliageLoss(t.f, ob.veg);
  return { d, lp, walls: ob.walls, veg: ob.veg, lv, L: lp + ob.walls + lv, list: ob.list };
}
const FARM_C = [1200, 750];
function bsPos(p) { return [FARM_C[0] + p.bsd * 1000 * Math.SQRT1_2, FARM_C[1] - p.bsd * 1000 * Math.SQRT1_2]; }   // base station to the north-east
function nbLink(p, x, y) {
  const [bx, by] = bsPos(p), hm = Math.max(1, p.hn); const dkm = Math.max(1, Math.hypot(bx - x, by - y) / 1000);
  const L = hata(800, 30, hm, dkm, p.hataEnv);
  const z = zoneOf(x, y); let walls = 0, list = [];
  if (z.indoor) { const b = BUILDINGS.find(b => b.zone === z.zone); walls = MAT[b.mat](0.8); list.push([b.name, walls]); }
  const CL = L + walls - 15 - 0;                                        // 15 dBi sector antenna, 0 dBi node antenna
  return { L, walls, CL, M: 164 - CL, list };
}
const shadow = id => { let h = 2166136261; for (const ch of id + ':' + shadowSeed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return randn(mulberry32(h >>> 0)); };
/** Evaluate every node: margin, SF, route, energy, battery life. */
function evalNodes(p) {
  const tk = p.tech, t = TECH[tk];
  const cnt = {}; nodes.forEach(n => { cnt[n.zone] = (cnt[n.zone] || 0) + 1; n.point = `p${cnt[n.zone]}`; });
  nodes.forEach(n => {
    n.X = shadow(n.id) * p.sigma;                                  // this node's shadowing realisation, dB
    if (tk === 'nbiot') {
      const r = nbLink(p, n.x, n.y); n.link = r; n.M = r.M; n.Mact = r.M - n.X; n.CL = r.CL; n.sf = null; n.hopsTo = 'bs';
    } else {
      const r = linkLoss(p, tk, n.x, n.y, gw.x, gw.y, p.hn, p.hg); n.link = r;
      if (tk === 'lora') {
        let chosen = p.sf === 'adr' ? 12 : +p.sf;
        if (p.sf === 'adr') for (let sf = 7; sf <= 12; sf++) { if (budget(p, tk, sf).B - r.L >= p.F) { chosen = sf; break; } }
        n.sf = chosen;
      } else n.sf = null;
      const b = budget(p, tk, n.sf, p.phy); n.S = b.S; n.M = b.B - r.L; n.Mact = n.M - n.X;
      n.parent = null; n.hop = n.Mact >= p.F ? 1 : Infinity; n.router = false;
    }
  });
  // Zigbee mesh: breadth-first search over reliable links (margin ≥ F); routers are mains-powered
  if (tk === 'zigbee' && p.mesh) {
    const Bnn = TECH.zigbee.ptx + 2 * TECH.zigbee.gn - TECH.zigbee.S;         // node-to-node budget: no gateway antenna or cable
    let changed = true, guard = 0;
    while (changed && guard++ < 12) {
      changed = false;
      nodes.forEach(n => { if (n.hop < Infinity) return; let best = null;
        nodes.forEach(m => { if (m === n || m.hop === Infinity) return; const r = linkLoss(p, tk, n.x, n.y, m.x, m.y, p.hn, p.hn); const M = Bnn - r.L - shadow(n.id + m.id) * p.sigma; if (M >= p.F && (!best || m.hop < best.m.hop || (m.hop === best.m.hop && M > best.M))) best = { m, M }; });
        if (best && best.m.hop + 1 < n.hop) { n.hop = best.m.hop + 1; n.parent = best.m; n.Mhop = best.M; best.m.router = true; changed = true; } });
    }
  }
  nodes.forEach(n => {
    // energy per message
    const ph = tk === 'lora' ? t.phases(p.pl, n.sf) : tk === 'ble' ? t.phases(p.pl, p.phy) : t.phases(p.pl);
    let q = 0, ta = 0; ph.forEach(([, dt, I]) => { q += dt * I; ta += dt; });                 // mA·s, s
    if (tk === 'nbiot') { const E = nbEnergy(n.CL); q += E / 3.6 * 1000; ta += 2; n.E = E; }   // J → mA·s at 3.6 V
    n.qmsg = q; n.tact = ta; n.toa = tk === 'lora' ? loraToA(p.pl, n.sf) : tk === 'ble' ? ph[1][1] : tk === 'zigbee' ? ph[2][1] : tk === 'wifi' ? 0.3 : NaN;
    let T = p.T; n.dcLimited = false;
    if (tk === 'lora') { const Tmin = n.toa / 0.01; if (T < Tmin) { T = Tmin; n.dcLimited = true; } }
    n.Teff = T;
    const Isl = (t.sleep + p.iboard) / 1000;                                                // mA
    const Iavg = (q + Isl * Math.max(0, T - ta)) / T;                                       // mA
    n.Iavg = Iavg; n.life = p.eta * p.cap / Iavg;                                           // h
    if (n.router) { n.life = Infinity; }
    // per-packet success with Rayleigh fading (Eq. N5) and retries/diversity
    const pk = Mact => Mact < -30 ? 0 : Math.exp(-Math.pow(10, -Mact / 10));
    let ps = pk(n.Mact);
    if (tk === 'zigbee' && n.parent) ps = pk(n.Mhop);
    const tries = t.retries + 1; ps = 1 - Math.pow(1 - ps, t.diversity || tries);
    if (tk === 'zigbee' && n.parent) { let m = n.parent, g = 0; while (m && g++ < 10) { ps *= 1 - Math.pow(1 - pk(m.parent ? m.Mhop : m.Mact), tries); m = m.parent; } }
    n.ps = ps;
    n.reliable = tk === 'zigbee' && p.mesh ? n.hop < Infinity : n.M >= p.F;
    n.cov = normCdf(n.M / p.sigma);
  });
}

/* ------------------------------------------------------------------ heat map (grid over the current view) */
let heat = null;
function computeHeat(p, coarse) {
  const tk = p.tech, t = TECH[tk]; const cols = coarse ? 90 : 190;
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0; const rows = Math.max(8, Math.round(cols * vh / vw));
  const Mg = new Float32Array(cols * rows), Lg = new Float32Array(cols * rows);
  const b = tk === 'nbiot' ? null : budget(p, tk, 12, p.phy);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = view.x0 + (i + 0.5) * vw / cols, y = view.y0 + (j + 0.5) * vh / rows; const k = j * cols + i;
    if (tk === 'nbiot') { const r = nbLink(p, x, y); Mg[k] = r.M; Lg[k] = r.CL; continue; }
    const r = linkLoss(p, tk, x, y, gw.x, gw.y, p.hn, p.hg); Lg[k] = r.L;
    Mg[k] = tk === 'lora' ? (p.sf === 'adr' ? b.B - r.L : budget(p, tk, +p.sf).B - r.L) : b.B - r.L;
  }
  heat = { cols, rows, Mg, Lg, view: { ...view }, tk, F: p.F, sf: p.sf, B: tk === 'lora' ? [7, 8, 9, 10, 11, 12].map(s => budget(p, tk, s).B) : null };
  paintHeat(p);
}
const hc = document.createElement('canvas');
function marginColour(M, F) {
  if (M < 0) { const a = Math.min(0.55, 0.25 + (-M) / 40); return [214, 48, 39, a]; }
  if (M < F) { const f = M / Math.max(F, 1e-6); return [244 + (254 - 244) * f, 109 + (224 - 109) * f, 67 + (139 - 67) * f, 0.45]; }
  const g = Math.min(1, (M - F) / 30); return [166 - 140 * g, 217 - 65 * g, 106 - 26 * g, 0.3 + 0.08 * g];
}
const SF_COL = { 7: [26, 152, 80], 8: [102, 189, 99], 9: [166, 217, 106], 10: [254, 224, 139], 11: [253, 174, 97], 12: [244, 109, 67] };
function paintHeat(p) {
  if (!heat) return; hc.width = heat.cols; hc.height = heat.rows; const c = hc.getContext('2d'); const img = c.createImageData(heat.cols, heat.rows);
  for (let k = 0; k < heat.cols * heat.rows; k++) {
    let rgba;
    if (p.heat === 'sf' && heat.tk === 'lora') { const L = heat.Lg[k]; let sf = 0; for (let s = 7; s <= 12; s++) if (heat.B[s - 7] - L >= heat.F) { sf = s; break; } rgba = sf ? [...SF_COL[sf], 0.5] : (heat.B[5] - L >= 0 ? [165, 0, 38, 0.35] : [120, 0, 30, 0.5]); }
    else rgba = marginColour(heat.Mg[k], heat.F);
    img.data[4 * k] = rgba[0]; img.data[4 * k + 1] = rgba[1]; img.data[4 * k + 2] = rgba[2]; img.data[4 * k + 3] = 255 * rgba[3];
  }
  c.putImageData(img, 0, 0);
  heat.contours = contourLines(heat, [0, heat.F]);
}
/** Marching squares on the margin grid. */
function contourLines(h, levels) {
  const out = [];
  for (const lv of levels) {
    const segs = [];
    for (let j = 0; j < h.rows - 1; j++) for (let i = 0; i < h.cols - 1; i++) {
      const v = [h.Mg[j * h.cols + i], h.Mg[j * h.cols + i + 1], h.Mg[(j + 1) * h.cols + i + 1], h.Mg[(j + 1) * h.cols + i]];
      const idx = (v[0] >= lv ? 8 : 0) | (v[1] >= lv ? 4 : 0) | (v[2] >= lv ? 2 : 0) | (v[3] >= lv ? 1 : 0); if (idx === 0 || idx === 15) continue;
      const P = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]; const e = (a, b) => { const t = (lv - v[a]) / (v[b] - v[a] || 1e-9); return [P[a][0] + t * (P[b][0] - P[a][0]), P[a][1] + t * (P[b][1] - P[a][1])]; };
      const E = [e(0, 1), e(1, 2), e(2, 3), e(3, 0)];
      const T = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 3], [2, 1]], 6: [[0, 2]], 7: [[0, 3]], 8: [[0, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] }[idx];
      T.forEach(([a, b]) => segs.push([E[a], E[b]]));
    }
    out.push({ lv, segs });
  }
  return out;
}

/* ------------------------------------------------------------------ stage: map canvas */
const stageEl = document.getElementById('stage');
const cv = document.createElement('canvas'); stageEl.appendChild(cv); const ctx = cv.getContext('2d');
const base = document.createElement('canvas'); const bctx = base.getContext('2d');
const hud = hudChips(stageEl); hud.el.style.flexDirection = 'row'; hud.el.style.flexWrap = 'wrap'; hud.el.style.maxWidth = '72%';
const legend = document.createElement('div'); legend.className = 'stage-legend iot-legend'; stageEl.appendChild(legend);
const card = document.createElement('div'); card.className = 'iot-card'; stageEl.appendChild(card);
stageToolbar(stageEl, {
  onReset: () => zoomTo(0, 0, WORLD.w, WORLD.h),
  onShot: () => { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = 'iot-network.png'; a.click(); }
});
let W = 0, H = 0, DPR = 1, PIPE = 74;
let view = { x0: 0, y0: 0, x1: WORLD.w, y1: WORLD.h };
function mapH() { return H - PIPE; }
function fitView(v) {
  const aspect = W / Math.max(1, mapH()); let w = v.x1 - v.x0, h = v.y1 - v.y0; const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  w = Math.min(w, WORLD.w * 1.6); h = Math.min(h, WORLD.h * 1.6); if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}
function zoomTo(x0, y0, x1, y1) { view = fitView({ x0, y0, x1, y1 }); baseKey = ''; scheduleHeat(false); }
const sx = x => (x - view.x0) / (view.x1 - view.x0) * W, sy = y => (y - view.y0) / (view.y1 - view.y0) * mapH();
const wx = X => view.x0 + X / W * (view.x1 - view.x0), wy = Y => view.y0 + Y / mapH() * (view.y1 - view.y0);
const mpp = () => (view.x1 - view.x0) / W;   // metres per pixel
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = stageEl.clientWidth; H = stageEl.clientHeight; if (!W || !H) return; PIPE = H > 480 ? 76 : 62;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  view = fitView(view); baseKey = ''; scheduleHeat(false);
}
new ResizeObserver(resize).observe(stageEl);

/* static base map rendered for the current view */
let baseKey = '', baseView = null;
const TREES = (() => { const r = mulberry32(99); const out = []; for (const v of VEG) { const [x0, y0, x1, y1] = v.bb; const sp = v.kind === 'forest' ? 11 : 8; for (let x = x0; x <= x1; x += sp) for (let y = y0; y <= y1; y += sp) { const px = x + (r() - 0.5) * sp * 0.9, py = y + (r() - 0.5) * sp * 0.9; if (inside(v.poly, px, py)) out.push([px, py, (v.kind === 'forest' ? 4.2 : 3.4) * (0.7 + 0.6 * r()), v.id === 'forest-ne' ? 0 : r() < 0.55 ? 1 : 0, r()]); } } return out; })();
function pathPoly(c, poly) { c.beginPath(); poly.forEach(([x, y], i) => i ? c.lineTo(sx(x), sy(y)) : c.moveTo(sx(x), sy(y))); c.closePath(); }
function renderBase() {
  const key = [W, H, view.x0, view.y0, view.x1, view.y1, DPR].join('|'); if (key === baseKey) return; baseKey = key; baseView = { ...view };
  base.width = Math.round(W * DPR); base.height = Math.round(mapH() * DPR); const c = bctx; c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const s = 1 / mpp();
  c.fillStyle = '#9fb77a'; c.fillRect(0, 0, W, mapH());
  // meadow texture
  const r = mulberry32(5); c.globalAlpha = 0.12; for (let i = 0; i < 900; i++) { c.fillStyle = r() < 0.5 ? '#7f9c5e' : '#b9c98f'; c.fillRect(r() * W, r() * mapH(), 2 + r() * 5, 2 + r() * 5); } c.globalAlpha = 1;
  // fields with row patterns
  const FC = { wheat: ['#b4c07c', '#9aab66'], rape: ['#5f9146', '#4f7d3a'], ley: ['#8fbd5f', '#7aa84f'], potato: ['#a4876a', '#8b6f55'], pasture: ['#86b25c', '#6f9a4a'] };
  FIELDS.forEach(f => {
    const [a, b] = FC[f.crop]; pathPoly(c, f.poly); c.fillStyle = a; c.fill();
    c.save(); pathPoly(c, f.poly); c.clip(); c.strokeStyle = b; c.lineWidth = Math.max(0.6, (f.crop === 'potato' ? 1.6 : 0.9) * Math.min(1.5, s * 0.9));
    const [x0, y0, x1, y1] = f.bb; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0);
    const sp = f.crop === 'pasture' ? 0 : f.crop === 'potato' ? 5 : 8; const step = Math.max(sp, 3 * mpp());
    if (sp) { c.beginPath(); for (let d = -R; d <= R; d += step) { const ux = Math.cos(f.angle), uy = Math.sin(f.angle); const ox = cx - uy * d, oy = cy + ux * d; c.moveTo(sx(ox - ux * R), sy(oy - uy * R)); c.lineTo(sx(ox + ux * R), sy(oy + uy * R)); } c.globalAlpha = 0.55; c.stroke(); c.globalAlpha = 1; }
    if (f.crop === 'pasture') { const rr = mulberry32(8); c.fillStyle = '#5d8a3f'; for (let i = 0; i < 400; i++) { const x = x0 + rr() * (x1 - x0), y = y0 + rr() * (y1 - y0); c.globalAlpha = 0.35; c.beginPath(); c.arc(sx(x), sy(y), Math.max(0.8, 2.5 * s), 0, 7); c.fill(); } c.globalAlpha = 1; }
    c.restore(); pathPoly(c, f.poly); c.strokeStyle = 'rgba(70,60,40,0.35)'; c.lineWidth = 1; c.stroke();
  });
  // lake
  const lg = c.createLinearGradient(sx(0), sy(1000), sx(300), sy(1500)); lg.addColorStop(0, '#6ea9c7'); lg.addColorStop(1, '#3f7fa6');
  pathPoly(c, LAKE); c.fillStyle = lg; c.fill(); c.strokeStyle = '#d9e6c9'; c.lineWidth = Math.max(1.5, 4 * s); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1; for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(sx(120 + i * 60), sy(1230 + (i % 3) * 60), Math.max(4, 18 * s), 0.2, 1.2); c.stroke(); }
  // stream
  c.strokeStyle = '#4f93b9'; c.lineWidth = Math.max(1.4, 4 * s); c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); STREAM.forEach(([x, y], i) => i ? c.lineTo(sx(x), sy(y)) : c.moveTo(sx(x), sy(y))); c.stroke();
  // yard and roads
  pathPoly(c, YARD); c.fillStyle = '#cfc3a4'; c.fill();
  ROADS.forEach(rd => { c.strokeStyle = '#a89878'; c.lineWidth = Math.max(2.4, 7 * s); c.beginPath(); rd.forEach(([x, y], i) => i ? c.lineTo(sx(x), sy(y)) : c.moveTo(sx(x), sy(y))); c.stroke(); c.strokeStyle = '#e1d6bb'; c.lineWidth = Math.max(1.4, 5 * s); c.stroke(); });
  // trees (forest floor, then crowns)
  VEG.forEach(v => { pathPoly(c, v.poly); c.fillStyle = v.kind === 'forest' ? (v.id === 'forest-ne' ? '#2f5a36' : '#3d6b3a') : '#4b7a3e'; c.fill(); });
  const rpx = Math.max(1.1, s * 4);
  for (const [x, y, r0, dec, jit] of TREES) {
    const X = sx(x), Y = sy(y); if (X < -10 || Y < -10 || X > W + 10 || Y > mapH() + 10) continue; const R = Math.max(1, r0 * s);
    c.fillStyle = 'rgba(15,30,18,0.35)'; c.beginPath(); c.arc(X + R * 0.35, Y + R * 0.35, R, 0, 7); c.fill();
    const g = c.createRadialGradient(X - R * 0.3, Y - R * 0.3, R * 0.1, X, Y, R); const base0 = dec ? [92 + jit * 30, 140 + jit * 20, 70] : [38 + jit * 20, 92 + jit * 20, 52];
    g.addColorStop(0, `rgb(${base0[0] + 40},${base0[1] + 40},${base0[2] + 30})`); g.addColorStop(1, `rgb(${base0[0]},${base0[1]},${base0[2]})`);
    c.fillStyle = g; c.beginPath(); c.arc(X, Y, R, 0, 7); c.fill();
  }
  // buildings
  BUILDINGS.forEach(b => {
    c.fillStyle = 'rgba(20,25,20,0.35)'; c.save(); c.translate(Math.max(1.5, 3 * s), Math.max(1.5, 3 * s)); pathPoly(c, b.poly); c.fill(); c.restore();
    if (b.round) { const [cx, cy, rr] = b.round; const g = c.createRadialGradient(sx(cx) - 2, sy(cy) - 2, 1, sx(cx), sy(cy), rr * s); g.addColorStop(0, '#eef0f1'); g.addColorStop(1, '#9ea4a8'); c.fillStyle = g; c.beginPath(); c.arc(sx(cx), sy(cy), Math.max(2, rr * s), 0, 7); c.fill(); c.strokeStyle = '#6d7377'; c.lineWidth = 1; c.stroke(); return; }
    pathPoly(c, b.poly); c.fillStyle = b.roof; c.fill(); c.strokeStyle = 'rgba(30,30,30,0.55)'; c.lineWidth = 1; c.stroke();
    const [x0, y0, x1, y1] = b.bb;
    if (b.id === 'greenhouse') { c.strokeStyle = 'rgba(90,120,130,0.55)'; c.lineWidth = 1; c.beginPath(); for (let x = x0 + 4; x < x1; x += 4) { c.moveTo(sx(x), sy(y0)); c.lineTo(sx(x), sy(y1)); } c.stroke(); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.moveTo(sx(x0), sy((y0 + y1) / 2)); c.lineTo(sx(x1), sy((y0 + y1) / 2)); c.stroke(); }
    else { const hor = (x1 - x0) > (y1 - y0); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.2; c.beginPath(); if (hor) { c.moveTo(sx(x0), sy((y0 + y1) / 2)); c.lineTo(sx(x1), sy((y0 + y1) / 2)); } else { c.moveTo(sx((x0 + x1) / 2), sy(y0)); c.lineTo(sx((x0 + x1) / 2), sy(y1)); } c.stroke();
      c.fillStyle = 'rgba(0,0,0,0.12)'; if (hor) c.fillRect(sx(x0), sy((y0 + y1) / 2), (x1 - x0) * s, (y1 - y0) / 2 * s); else c.fillRect(sx((x0 + x1) / 2), sy(y0), (x1 - x0) / 2 * s, (y1 - y0) * s); }
  });
  // labels
  c.textAlign = 'center'; c.font = `italic 600 ${Math.max(10, Math.min(13, 11 * Math.sqrt(s * 2)))}px Inter, sans-serif`;
  const lab = (t, x, y, col = 'rgba(40,52,30,0.75)') => { const X = sx(x), Y = sy(y); if (X < 30 || X > W - 30 || Y < 20 || Y > mapH() - 10) return; c.fillStyle = 'rgba(255,255,255,0.35)'; const w = c.measureText(t).width; c.fillRect(X - w / 2 - 4, Y - 11, w + 8, 15); c.fillStyle = col; c.fillText(t, X, Y); };
  FIELDS.forEach(f => { const [x0, y0, x1, y1] = f.bb; lab(f.name, (x0 + x1) / 2, (y0 + y1) / 2); });
  lab('Lake Mälaren', 220, 1330, 'rgba(230,242,250,0.9)'); lab('Spruce forest', 2180, 250, 'rgba(225,240,225,0.9)'); lab('Mixed forest', 2000, 1370, 'rgba(225,240,225,0.9)');
  if (s > 0.9) { c.font = '600 11px Inter, sans-serif'; BUILDINGS.forEach(b => { if (b.id === 'silo2') return; const [x0, y0, x1] = b.bb; lab(b.name, (x0 + x1) / 2, y0 - 3, 'rgba(30,30,30,0.85)'); }); }
}

/* ------------------------------------------------------------------ animation state */
const packets = [], ripples = [], pipeDots = [];
let stats = { sent: 0, ok: 0, lost: 0 }, lastTopic = null;
const topicFlash = {};
function transmit(n, p) {
  const tk = p.tech; n.stats.sent++; stats.sent++;
  const ok = Math.random() < n.ps && (tk !== 'zigbee' || !p.mesh || n.hop < Infinity);
  const toaVis = tk === 'lora' ? 0.35 + 1.2 * Math.min(1, n.toa / 1.5) : tk === 'nbiot' ? 0.9 : 0.3;
  ripples.push({ x: n.x, y: n.y, t: 0, dur: toaVis, col: TECH[tk].col });
  const route = [];
  if (tk === 'nbiot') route.push([n.x, n.y], [...bsEdge()]);
  else { let m = n; route.push([m.x, m.y]); if (tk === 'zigbee' && p.mesh && m.parent) { let g = 0; while (m.parent && g++ < 10) { m = m.parent; route.push([m.x, m.y]); } } route.push([gw.x, gw.y]); }
  packets.push({ route, t: 0, dur: 0.7 + 0.25 * (route.length - 2), ok, node: n, col: TECH[tk].col, failAt: 0.35 + 0.4 * Math.random() });
}
function bsEdge() { const [bx, by] = bsPos(params()); const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2; const ang = Math.atan2(by - cy, bx - cx); const hw = (view.x1 - view.x0) / 2 * 0.9, hh = (view.y1 - view.y0) / 2 * 0.86; const t = Math.min(Math.abs(hw / Math.cos(ang)), Math.abs(hh / Math.sin(ang))); return [cx + t * Math.cos(ang), cy + t * Math.sin(ang)]; }
function deliver(n, p) {
  n.stats.ok++; stats.ok++; n.flash = 1;
  pipeDots.push({ t: 0, col: TECH[p.tech].col, node: n });
}
function topicFor(n) { const q = QUANT[n.zone] || QUANT[n.zone.includes('field') || n.zone === 'ley' || n.zone === 'rape-field' ? 'field' : 'yard'] || QUANT.field; return q; }
function arrive(n) {
  const q = topicFor(n); const [sub, qty, unit, mu, sd] = q[Math.floor(Math.random() * q.length)];
  const topic = `mdu/farm/${n.zone}/${n.point}/${sub}/${qty}`; topicFlash[topic] = 1; topicFlash[`mdu/farm/nodes/${n.id}/status`] = 0.6;
  const v = Math.max(0, mu + sd * randn(Math.random));
  const tSim = new Date(Date.UTC(2026, 8, 27, 6, 0, 0) + clock.t * 1000).toISOString().slice(0, 19) + 'Z';
  lastTopic = { topic, payload: `{"t":"${tSim}","v":${v.toFixed(unit === 'ppm' || unit === 'W' ? 0 : 2)},"u":"${unit}","q":1,"dev":"${n.id}"}` };
  renderTopics(true);
}

/* ------------------------------------------------------------------ draw */
function draw() {
  if (!W || !H) return; const p = params(); if (!(drag && drag.moved && drag.kind === 'pan') || !baseView) renderBase();
  const c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
  c.fillStyle = '#9fb77a'; c.fillRect(0, 0, W, mapH()); c.drawImage(base, sx(baseView.x0), sy(baseView.y0), sx(baseView.x1) - sx(baseView.x0), sy(baseView.y1) - sy(baseView.y0));
  const Mh = mapH();
  c.save(); c.beginPath(); c.rect(0, 0, W, Mh); c.clip();
  // heat map
  if (heat && p.heat !== 'off') {
    const v = heat.view; c.imageSmoothingEnabled = true; c.globalAlpha = 1;
    c.drawImage(hc, sx(v.x0), sy(v.y0), sx(v.x1) - sx(v.x0), sy(v.y1) - sy(v.y0));
    if (heat.contours && p.heat === 'margin') heat.contours.forEach(({ lv, segs }) => {
      c.strokeStyle = lv === 0 ? 'rgba(120,10,10,0.8)' : 'rgba(20,60,20,0.75)'; c.lineWidth = lv === 0 ? 1.6 : 1.3; c.setLineDash(lv === 0 ? [] : [5, 4]); c.beginPath();
      const gx = i => sx(v.x0 + i / heat.cols * (v.x1 - v.x0) + 0.5 * (v.x1 - v.x0) / heat.cols), gy = j => sy(v.y0 + j / heat.rows * (v.y1 - v.y0) + 0.5 * (v.y1 - v.y0) / heat.rows);
      segs.forEach(([a, b]) => { c.moveTo(gx(a[0]), gy(a[1])); c.lineTo(gx(b[0]), gy(b[1])); }); c.stroke(); c.setLineDash([]);
    });
  }
  // links
  const tk = p.tech;
  nodes.forEach((n, i) => {
    const to = tk === 'nbiot' ? bsEdge() : (tk === 'zigbee' && p.mesh && n.parent ? [n.parent.x, n.parent.y] : [gw.x, gw.y]);
    const st = linkStatus(n, p); c.strokeStyle = st.col; c.lineWidth = i === sel ? 2.6 : 1.6; c.setLineDash(st.dash); c.globalAlpha = tk === 'nbiot' ? 0.45 : 0.9;
    c.beginPath(); c.moveTo(sx(n.x), sy(n.y)); if (tk === 'nbiot') { const dx = to[0] - n.x, dy = to[1] - n.y, L = Math.hypot(dx, dy); c.lineTo(sx(n.x + dx / L * 120), sy(n.y + dy / L * 120)); } else c.lineTo(sx(to[0]), sy(to[1])); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  });
  // ripples and packets
  ripples.forEach(r => { const k = r.t / r.dur; const R = 6 + k * 34; c.strokeStyle = r.col; c.globalAlpha = Math.max(0, 0.8 * (1 - k)); c.lineWidth = 2; c.beginPath(); c.arc(sx(r.x), sy(r.y), R, 0, 7); c.stroke(); c.beginPath(); c.arc(sx(r.x), sy(r.y), R * 0.6, 0, 7); c.stroke(); c.globalAlpha = 1; });
  packets.forEach(pk => {
    const k = Math.min(1, pk.t / pk.dur); const segs = pk.route.length - 1; const fpos = pk.ok ? k : Math.min(k, pk.failAt);
    const si = Math.min(segs - 1, Math.floor(fpos * segs)), f = fpos * segs - si; const a = pk.route[si], b = pk.route[si + 1];
    const X = sx(a[0] + (b[0] - a[0]) * f), Y = sy(a[1] + (b[1] - a[1]) * f);
    if (!pk.ok && k > pk.failAt) { const q = Math.min(1, (k - pk.failAt) / 0.3); c.strokeStyle = `rgba(230,60,50,${1 - q})`; c.lineWidth = 2.2; c.beginPath(); c.moveTo(X - 6, Y - 6); c.lineTo(X + 6, Y + 6); c.moveTo(X + 6, Y - 6); c.lineTo(X - 6, Y + 6); c.stroke(); return; }
    c.fillStyle = '#fff'; c.shadowColor = pk.col; c.shadowBlur = 10; c.beginPath(); c.arc(X, Y, 4.2, 0, 7); c.fill(); c.shadowBlur = 0; c.fillStyle = pk.col; c.beginPath(); c.arc(X, Y, 2.6, 0, 7); c.fill();
  });
  // gateway
  if (tk !== 'nbiot') drawGateway(c, p); else drawBaseStationArrow(c, p);
  // nodes
  nodes.forEach((n, i) => drawNode(c, n, i, p));
  c.restore();
  drawScale(c); drawPipeline(c, p);
}
function linkStatus(n, p) {
  if (p.tech === 'zigbee' && p.mesh && n.hop < Infinity && n.parent) return { col: '#1f8f4e', dash: [6, 3], txt: `${n.hop} hops via ${n.parent.id}` };
  if (n.M >= p.F) return { col: '#1f8f4e', dash: [], txt: 'reliable' };
  if (n.M >= 0) return { col: '#e39a16', dash: [5, 4], txt: 'marginal' };
  return { col: '#d33a2c', dash: [2, 4], txt: 'no link' };
}
function drawGateway(c, p) {
  const X = sx(gw.x), Y = sy(gw.y); const pulse = (performance.now() / 1000) % 1.6;
  c.strokeStyle = 'rgba(255,255,255,0.9)'; c.globalAlpha = 0.5 * (1 - pulse / 1.6); c.lineWidth = 2; c.beginPath(); c.arc(X, Y - 18, 10 + pulse * 18, 0, 7); c.stroke(); c.globalAlpha = 1;
  c.strokeStyle = '#2b2f33'; c.lineWidth = 3; c.beginPath(); c.moveTo(X, Y); c.lineTo(X, Y - 20); c.stroke();
  c.strokeStyle = '#2b2f33'; c.lineWidth = 2; c.beginPath(); c.moveTo(X - 7, Y); c.lineTo(X, Y - 8); c.lineTo(X + 7, Y); c.stroke();
  c.fillStyle = TECH[p.tech].col; c.strokeStyle = '#1b1f22'; c.lineWidth = 1.5; c.beginPath(); c.arc(X, Y - 22, 6.5, 0, 7); c.fill(); c.stroke();
  c.fillStyle = '#10151a'; c.font = '700 11px Inter, sans-serif'; c.textAlign = 'center';
  const t = `${TECH[p.tech].gwName} · ${p.hg} m`; const w = c.measureText(t).width; c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillRect(X - w / 2 - 5, Y - 45, w + 10, 16); c.fillStyle = '#10151a'; c.fillText(t, X, Y - 33);
}
function drawBaseStationArrow(c, p) {
  const [bx, by] = bsEdge(); const X = sx(bx), Y = sy(by);
  c.fillStyle = 'rgba(255,255,255,0.9)'; c.strokeStyle = '#6b2a5b'; c.lineWidth = 2; c.beginPath(); c.moveTo(X, Y - 26); c.lineTo(X - 9, Y + 4); c.lineTo(X + 9, Y + 4); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(X, Y - 26); c.lineTo(X, Y + 4); c.moveTo(X - 6, Y - 8); c.lineTo(X + 6, Y - 8); c.stroke();
  c.font = '700 11px Inter, sans-serif'; c.textAlign = 'right'; const t = `→ base station ${p.bsd} km NE, 30 m mast`; const w = c.measureText(t).width;
  c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(X - 16 - w - 6, Y + 8, w + 12, 17); c.fillStyle = '#4a1d40'; c.fillText(t, X - 16, Y + 21);
}
function drawNode(c, n, i, p) {
  const X = sx(n.x), Y = sy(n.y); const st = linkStatus(n, p);
  const sfc = p.tech === 'lora' && n.sf ? `rgb(${SF_COL[n.sf].join(',')})` : st.col;
  if (n.flash > 0) { c.strokeStyle = `rgba(255,255,255,${n.flash})`; c.lineWidth = 2; c.beginPath(); c.arc(X, Y - 11, 13 + (1 - n.flash) * 8, 0, 7); c.stroke(); }
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(X + 2, Y + 1, 5, 2.5, 0, 0, 7); c.fill();
  c.fillStyle = i === sel ? '#ffffff' : '#20262b'; c.beginPath(); c.moveTo(X, Y); c.bezierCurveTo(X - 9, Y - 10, X - 9, Y - 22, X, Y - 22); c.bezierCurveTo(X + 9, Y - 22, X + 9, Y - 10, X, Y); c.fill();
  c.fillStyle = sfc; c.beginPath(); c.arc(X, Y - 14, 5.2, 0, 7); c.fill();
  if (n.router) { c.fillStyle = '#ffd84d'; c.font = '700 10px Inter'; c.textAlign = 'center'; c.fillText('⚡', X + 10, Y - 18); }
  c.font = '650 10.5px Inter, sans-serif'; c.textAlign = 'left'; const lab = p.tech === 'lora' && n.sf ? `${n.id} · SF${n.sf}` : n.id; const w = c.measureText(lab).width;
  c.fillStyle = i === sel ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.8)'; c.fillRect(X + 8, Y - 30, w + 8, 14); c.fillStyle = '#12171b'; c.fillText(lab, X + 12, Y - 19.5);
}
function drawScale(c) {
  const target = 120 * mpp(); const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000].find(v => v >= target * 0.6) || 1000; const px = nice / mpp();
  const x = 14, y = mapH() - 16; c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(x - 6, y - 16, px + 58, 24); c.strokeStyle = '#1b2227'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + px, y); c.moveTo(x, y - 5); c.lineTo(x, y + 3); c.moveTo(x + px, y - 5); c.lineTo(x + px, y + 3); c.stroke();
  c.fillStyle = '#1b2227'; c.font = '600 11px "JetBrains Mono", monospace'; c.textAlign = 'left'; c.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + px + 8, y + 4);
  // compass
  const cx = W - 26, cy = mapH() - 30; c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.arc(cx, cy, 15, 0, 7); c.fill(); c.fillStyle = '#b3261e'; c.beginPath(); c.moveTo(cx, cy - 12); c.lineTo(cx - 5, cy + 2); c.lineTo(cx + 5, cy + 2); c.fill(); c.fillStyle = '#1b2227'; c.font = '700 9px Inter'; c.textAlign = 'center'; c.fillText('N', cx, cy + 11);
}
function drawPipeline(c, p) {
  const y0 = mapH(), h = PIPE; const g = c.createLinearGradient(0, y0, 0, H); g.addColorStop(0, '#101814'); g.addColorStop(1, '#0a0f0d'); c.fillStyle = g; c.fillRect(0, y0, W, h);
  c.strokeStyle = 'rgba(255,255,255,0.1)'; c.beginPath(); c.moveTo(0, y0 + 0.5); c.lineTo(W, y0 + 0.5); c.stroke();
  const hops = TECH[p.tech].hops; const n = hops.length; const narrow = W < 600; const pad = narrow ? 6 : 20; const bw = Math.min(170, (W - 2 * pad) / n - (narrow ? 6 : 22)), gap = (W - 2 * pad - n * bw) / (n - 1);
  const bx = i => pad + i * (bw + gap), by = y0 + (narrow ? 8 : 12), bh = h - (narrow ? 16 : 24);
  const icons = ['node', p.tech === 'nbiot' ? 'tower' : 'gw', 'server', 'broker', 'dash'];
  for (let i = 0; i < n; i++) {
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1; roundRect(c, bx(i), by, bw, bh, 9); c.fill(); c.stroke();
    if (narrow) { drawIcon(c, icons[i], bx(i) + bw / 2, by + 15, TECH[p.tech].col); c.fillStyle = '#e6eee9'; c.font = '600 8.5px Inter, sans-serif'; c.textAlign = 'center'; c.fillText(['node', 'gateway', 'server', 'broker', 'dashboard'][i], bx(i) + bw / 2, by + bh - 7); }
    else { drawIcon(c, icons[i], bx(i) + 20, by + bh / 2, TECH[p.tech].col); c.fillStyle = '#e6eee9'; c.font = `600 ${bw < 120 ? 10 : 11}px Inter, sans-serif`; c.textAlign = 'left'; wrapText(c, hops[i], bx(i) + 38, by + bh / 2 - (bh > 40 ? 5 : 1), bw - 42, 12); }
    if (i < n - 1) { c.strokeStyle = 'rgba(255,255,255,0.28)'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(bx(i) + bw + 3, by + bh / 2); c.lineTo(bx(i + 1) - 3, by + bh / 2); c.stroke(); c.setLineDash([]); }
  }
  c.fillStyle = 'rgba(200,220,210,0.75)'; c.font = '500 10px "JetBrains Mono", monospace'; c.textAlign = 'right';
  if (!narrow) c.fillText(`${stats.ok} delivered · ${stats.lost} lost`, bx(n - 1) + bw - 8, by + bh - 6);
  pipeDots.forEach(d => { const k = Math.min(1, d.t / 1.6); const pos = 0.5 + k * (n - 1.5); const i = Math.floor(pos), f = pos - i; const X = bx(i) + bw * 0.5 + f * (bw + gap); c.fillStyle = '#fff'; c.shadowColor = d.col; c.shadowBlur = 10; c.beginPath(); c.arc(Math.min(X, bx(n - 1) + bw * 0.5), narrow ? by + 15 : by + bh / 2, 4, 0, 7); c.fill(); c.shadowBlur = 0; });
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function wrapText(c, t, x, y, w, lh) { const words = t.split(' '); let line = '', yy = y; const lines = []; words.forEach(wd => { const test = line ? line + ' ' + wd : wd; if (c.measureText(test).width > w && line) { lines.push(line); line = wd; } else line = test; }); lines.push(line); yy = y - (lines.length - 1) * lh / 2 + 4; lines.forEach((l, i) => c.fillText(l, x, yy + i * lh)); }
function drawIcon(c, kind, x, y, col) {
  c.save(); c.strokeStyle = '#e6eee9'; c.fillStyle = col; c.lineWidth = 1.6;
  if (kind === 'node') { c.fillRect(x - 7, y - 5, 14, 12); c.beginPath(); c.moveTo(x + 3, y - 5); c.lineTo(x + 3, y - 13); c.stroke(); }
  else if (kind === 'gw') { c.beginPath(); c.moveTo(x, y + 9); c.lineTo(x, y - 7); c.stroke(); c.beginPath(); c.arc(x, y - 8, 3.5, 0, 7); c.fill(); c.beginPath(); c.arc(x, y - 8, 8, -2.3, -0.8); c.stroke(); }
  else if (kind === 'tower') { c.beginPath(); c.moveTo(x, y - 11); c.lineTo(x - 7, y + 9); c.moveTo(x, y - 11); c.lineTo(x + 7, y + 9); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.stroke(); }
  else if (kind === 'server') { for (let i = 0; i < 3; i++) { c.strokeRect(x - 8, y - 9 + i * 6.5, 16, 5); } c.fillRect(x + 4, y - 8, 2, 2); }
  else if (kind === 'broker') { c.beginPath(); c.arc(x, y, 8, 0, 7); c.stroke(); c.font = '700 8px Inter'; c.fillStyle = '#e6eee9'; c.textAlign = 'center'; c.fillText('MQTT', x, y + 3); }
  else { c.strokeRect(x - 9, y - 7, 18, 13); c.beginPath(); c.moveTo(x - 6, y + 2); c.lineTo(x - 2, y - 2); c.lineTo(x + 2, y + 1); c.lineTo(x + 6, y - 4); c.strokeStyle = col; c.stroke(); }
  c.restore();
}

/* ------------------------------------------------------------------ interaction */
let drag = null;
function hitNode(X, Y) { for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]; if (Math.hypot(sx(n.x) - X, sy(n.y) - 12 - Y) < 13) return i; } return -1; }
function hitGw(X, Y) { return params().tech !== 'nbiot' && Math.hypot(sx(gw.x) - X, sy(gw.y) - 16 - Y) < 16; }
cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top; if (Y > mapH()) return;
  const ni = hitNode(X, Y);
  drag = { X, Y, moved: false, kind: ni >= 0 ? 'node' : hitGw(X, Y) ? 'gw' : 'pan', i: ni, v: { ...view } };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!drag) return; const r = cv.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
  if (Math.hypot(X - drag.X, Y - drag.Y) > 4) drag.moved = true; if (!drag.moved) return;
  if (drag.kind === 'pan') { const dx = (X - drag.X) * mpp(), dy = (Y - drag.Y) * mpp(); view = { x0: drag.v.x0 - dx, y0: drag.v.y0 - dy, x1: drag.v.x1 - dx, y1: drag.v.y1 - dy }; baseKey = ''; draw(); }
  else if (drag.kind === 'node') { const n = nodes[drag.i]; n.x = clampW(wx(X), 'x'); n.y = clampW(wy(Y + 12), 'y'); const z = zoneOf(n.x, n.y); n.zone = z.zone; n.zlabel = z.label; n.indoor = !!z.indoor; sel = drag.i; evalNodes(params()); draw(); showCard(); }
  else if (drag.kind === 'gw') { gw.x = clampW(wx(X), 'x'); gw.y = clampW(wy(Y + 16), 'y'); evalNodes(params()); scheduleHeat(true); draw(); }
});
cv.addEventListener('pointerup', e => {
  if (!drag) return; const d = drag; drag = null;
  if (!d.moved) {
    if (d.kind === 'node') { sel = d.i === sel ? -1 : d.i; showCard(); draw(); return; }
    if (d.kind === 'gw') return;
    if (nodes.length >= 30) { window.FFP && FFP.toast && FFP.toast('Maximum 30 nodes'); return; }
    const x = wx(d.X), y = wy(d.Y); if (x < 0 || y < 0 || x > WORLD.w || y > WORLD.h) return;
    nodes.push(mkNode(x, y)); sel = nodes.length - 1; recompute(); return;
  }
  if (d.kind === 'pan') scheduleHeat(false); else recompute();
});
cv.addEventListener('wheel', e => {
  e.preventDefault(); const r = cv.getBoundingClientRect(), X = e.clientX - r.left, Y = Math.min(mapH(), e.clientY - r.top);
  const k = e.deltaY > 0 ? 1.2 : 1 / 1.2; const mx = wx(X), my = wy(Y); const w = (view.x1 - view.x0) * k;
  if (w < 120 || w > WORLD.w * 1.6) return;
  view = { x0: mx - (mx - view.x0) * k, y0: my - (my - view.y0) * k, x1: mx + (view.x1 - mx) * k, y1: my + (view.y1 - my) * k }; baseKey = ''; draw(); scheduleHeat(false);
}, { passive: false });
const clampW = (v, a) => Math.max(5, Math.min(a === 'x' ? WORLD.w - 5 : WORLD.h - 5, v));
function showCard() {
  if (sel < 0 || !nodes[sel]) { card.style.display = 'none'; return; }
  const n = nodes[sel], p = params(), tk = p.tech, st = linkStatus(n, p);
  const rows = [];
  if (tk === 'nbiot') {
    rows.push(['Hata loss (' + p.hataEnv + ', ' + p.bsd + ' km)', fmt(n.link.L, 1) + ' dB']); n.link.list.forEach(([nm, l]) => rows.push([nm + ' walls', fmt(l, 1) + ' dB']));
    rows.push(['Coupling loss (−15 dBi sector)', fmt(n.CL, 1) + ' dB'], ['Margin to MCL 164 dB', fmt(n.M, 1) + ' dB'], ['Coverage class', n.CL <= 144 ? 'normal (≤ 144 dB)' : n.CL <= 154 ? 'robust (≤ 154 dB)' : n.CL <= 164 ? 'extreme (≤ 164 dB)' : 'no coverage'], ['Energy per report', fmt(n.E * 1000, 0) + ' mJ']);
  } else {
    rows.push(['Distance to ' + TECH[tk].gwName, fmt(n.link.d, 0) + ' m'], ['Path loss (dual slope)', fmt(n.link.lp, 1) + ' dB']);
    n.link.list.forEach(([nm, l]) => rows.push([nm + ' walls', fmt(l, 1) + ' dB']));
    if (n.link.veg > 0) rows.push([`Foliage ${fmt(n.link.veg, 0)} m (Weissberger)`, fmt(n.link.lv, 1) + ' dB']);
    rows.push(['Sensitivity' + (n.sf ? ` (SF${n.sf})` : ''), n.S + ' dBm'], ['Mean link margin M', fmt(n.M, 1) + ' dB']);
    if (tk === 'lora') rows.push(['Time on air', fmt(n.toa * 1000, 1) + ' ms'], ['Max. per hour at 1 %', fmt(36 / n.toa, 0)]);
  }
  rows.push(['Shadowing here (this realisation)', fmt(-n.X, 1) + ' dB'], ['Packet success (Rayleigh fading)', fmt(100 * n.ps, 1) + ' %'], ['Average current', fmt(n.Iavg * 1000, 1) + ' µA'], ['Battery life', n.router ? 'mains-powered router' : lifeTxt(n.life)]);
  card.innerHTML = `<div class="iot-card-h"><b>${n.id}</b> · ${n.zlabel}${n.indoor ? ' (indoors)' : ''}<button type="button" aria-label="Close">✕</button></div><div class="iot-card-s" style="color:${st.col}">${st.txt}${n.dcLimited ? ' · <span style="color:#d33a2c">duty-cycle limited</span>' : ''}</div><table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`;
  card.style.display = 'block';
  card.querySelector('button').onclick = () => { sel = -1; showCard(); draw(); };
}

/* ------------------------------------------------------------------ charts and topic tree */
const lifePlot = new Plot('#chart-life', { x: { label: 'Reporting interval', unit: 's', log: true, min: 10, max: 86400, format: v => durTxt(v) }, y: { label: 'Battery life', unit: 'years', log: true, min: 0.01, max: 50 } });
const marginChart = new BarChart('#chart-margin', { horizontal: true, y: { label: 'Mean link margin', unit: 'dB', min: 'auto' }, legend: false });
const airChart = new BarChart('#chart-air', { y: { label: 'Time on air per message', unit: 'ms', min: 0 }, legend: false });
const topicEl = document.getElementById('topics');
function lifeCurve(p, tk, extra = {}) {
  const t = TECH[tk]; const xs = [], ys = [];
  for (let i = 0; i <= 60; i++) {
    const T = 10 * Math.pow(8640, i / 60); xs.push(T);
    const ph = tk === 'lora' ? t.phases(p.pl, extra.sf) : tk === 'ble' ? t.phases(p.pl, p.phy) : t.phases(p.pl);
    let q = 0, ta = 0; ph.forEach(([, dt, I]) => { q += dt * I; ta += dt; }); if (tk === 'nbiot') { q += nbEnergy(extra.CL) / 3.6 * 1000; ta += 2; }
    let Te = T; if (tk === 'lora' && T < loraToA(p.pl, extra.sf) / 0.01) { ys.push(NaN); continue; }
    const I = (q + (t.sleep + p.iboard) / 1000 * Math.max(0, Te - ta)) / Te; ys.push(p.eta * p.cap / I / 8766);
  }
  return { xs, ys };
}
function updateCharts(p) {
  lifePlot.clear();
  const l7 = lifeCurve(p, 'lora', { sf: 7 }), l12 = lifeCurve(p, 'lora', { sf: 12 });
  const bx = [], lo = [], hi = []; l7.xs.forEach((x, i) => { if (isFinite(l12.ys[i])) { bx.push(x); lo.push(l12.ys[i]); hi.push(l7.ys[i]); } });
  lifePlot.band('lora-b', bx, lo, hi, { color: 'accent', alpha: 0.18 });
  lifePlot.line('lora7', l7.xs, l7.ys, { color: 'accent', width: 2.2, label: 'LoRaWAN SF7' });
  lifePlot.line('lora12', l12.xs, l12.ys, { color: 'accent', width: 2, dash: [6, 4], label: 'LoRaWAN SF12' });
  const nb1 = lifeCurve(p, 'nbiot', { CL: 144 }), nb3 = lifeCurve(p, 'nbiot', { CL: 164 });
  lifePlot.band('nb-b', nb1.xs, nb3.ys, nb1.ys, { color: 'magenta', alpha: 0.12 });
  lifePlot.line('nb1', nb1.xs, nb1.ys, { color: 'magenta', width: 2.2, label: 'NB-IoT, coupling loss 144 dB' });
  lifePlot.line('nb3', nb3.xs, nb3.ys, { color: 'magenta', width: 2, dash: [6, 4], label: 'NB-IoT, 164 dB' });
  const z = lifeCurve(p, 'zigbee'); lifePlot.line('zb', z.xs, z.ys, { color: 'amber', width: 2.2, label: 'Zigbee' });
  const b = lifeCurve(p, 'ble'); lifePlot.line('ble', b.xs, b.ys, { color: 'c4', width: 2.2, label: `BLE (${p.phy === 'coded' ? 'Coded' : '1M'})` });
  const w = lifeCurve(p, 'wifi'); lifePlot.line('wifi', w.xs, w.ys, { color: 'water', width: 2.2, label: 'Wi-Fi' });
  lifePlot.vline('now', p.T, { color: 'danger', label: 'your interval', dash: [4, 3] });
  lifePlot.hline('ten', 10, { color: 'muted', label: '10 years', dash: [3, 4] });
  // margin per node
  if (nodes.length) {
    const cats = nodes.map(n => `${n.id} ${n.zlabel.split(' ')[0]}${n.sf ? ' · SF' + n.sf : ''}`);
    marginChart.set(cats, [{ label: 'Margin', values: nodes.map(n => n.M), colors: nodes.map(n => linkStatus(n, p).col), format: v => fmt(v, 1) }]);
    marginChart.refLines([{ v: 0, label: 'sensitivity', color: 'danger' }, { v: p.F, label: `fade margin ${fmt(p.F, 1)} dB`, color: 'accent' }]);
  } else marginChart.set(['(place nodes on the map)'], [{ label: 'Margin', values: [0] }]);
  // LoRa airtime per SF
  const toa = [7, 8, 9, 10, 11, 12].map(s => loraToA(p.pl, s) * 1000);
  const used = new Set(p.tech === 'lora' ? nodes.map(n => n.sf) : []);
  airChart.set([7, 8, 9, 10, 11, 12].map(s => `SF${s}`), [{ label: 'Time on air', values: toa, colors: [7, 8, 9, 10, 11, 12].map(s => used.has(s) ? `rgb(${SF_COL[s].join(',')})` : 'rgba(140,150,145,0.55)'), format: v => fmt(v, 0) }]);
  const refs = []; const top = Math.max(...toa) * 1.6; const dcl = 0.01 * p.T * 1000, ttl = 30 * p.T / 86400 * 1000;
  if (dcl < top) refs.push({ v: dcl, label: `1 % duty cycle at ${durTxt(p.T)}`, color: 'danger' }); if (ttl < top) refs.push({ v: ttl, label: 'TTN fair use (30 s per day)', color: 'amber' });
  airChart.refLines(refs);
  document.getElementById('air-note').innerHTML = `At a reporting interval of ${durTxt(p.T)}, the 1 % duty cycle allows ${fmt(dcl, 0)} ms of airtime per message and The Things Network's fair-use policy ${fmt(ttl, 0)} ms.` + (refs.length < 2 ? ' Limits above the tallest bar are not drawn.' : '');
}
function renderTopics(flashOnly) {
  const zones = {}; nodes.forEach(n => { (zones[n.zone] = zones[n.zone] || []).push(n); });
  if (!flashOnly || !topicEl.dataset.built) {
    const lines = ['<span class="tt-root">mdu/farm/</span>'];
    const zk = Object.keys(zones).sort();
    zk.forEach((z, zi) => {
      const last = zi === zk.length - 1 && false; lines.push(`${'├─'} <span class="tt-z">${z}/</span>`);
      zones[z].forEach((n, ni) => { const q = topicFor(n); lines.push(`│  ${ni === zones[z].length - 1 ? '└─' : '├─'} ${n.point}/ ` + q.map(([s, qn]) => `<span class="tt-leaf" data-t="mdu/farm/${z}/${n.point}/${s}/${qn}">${s}/${qn}</span>`).join(' · ')); });
    });
    lines.push(`└─ <span class="tt-z">nodes/</span>`);
    nodes.forEach((n, i) => lines.push(`   ${i === nodes.length - 1 ? '└─' : '├─'} ${n.id}/ <span class="tt-leaf" data-t="mdu/farm/nodes/${n.id}/status">status</span> · battery · rssi`));
    topicEl.innerHTML = `<pre class="tt">${lines.join('\n')}</pre><div class="tt-last"></div>`; topicEl.dataset.built = '1';
  }
  topicEl.querySelectorAll('.tt-leaf').forEach(el => { const f = topicFlash[el.dataset.t] || 0; el.style.setProperty('--f', f.toFixed(2)); el.classList.toggle('hot', f > 0.05); });
  if (lastTopic) topicEl.querySelector('.tt-last').innerHTML = `<div class="tt-lab">last message received by the broker</div><code>${lastTopic.topic}</code><code class="tt-pay">${lastTopic.payload}</code>`;
}

/* ------------------------------------------------------------------ site survey: fit n and σ to pasted RSSI data */
const svEl = document.getElementById('survey');
const svPlot = svEl ? new Plot('#chart-survey', { x: { label: 'Distance', unit: 'm', log: true }, y: { label: 'Path loss', unit: 'dB' } }) : null;
let svFit = null;
function exampleSurvey() {
  const r = mulberry32(21), lines = ['distance_m,rssi_dBm'];
  for (let i = 0; i < 40; i++) { const d = Math.round(80 * Math.pow(3000 / 80, i / 39) * (0.9 + 0.2 * r())); const L = pathLoss(d, 0.868, 6, 1, 3.8) + 6 * randn(r); lines.push(`${d},${(13 + 2.15 + 3 - 1 - L).toFixed(1)}`); }
  return lines.join('\n');
}
function fitSurvey() {
  const msg = svEl.querySelector('.ud-msg'), get = k => parseFloat(svEl.querySelector(`[data-k="${k}"]`).value);
  const tb = parseTable(svEl.querySelector('textarea').value); const d = [], rssi = [];
  tb.rows.forEach(rw => { const a = +rw[0], b = +rw[1]; if (rw.length >= 2 && a > 0 && isFinite(b)) { d.push(a); rssi.push(b); } });
  if (d.length < 5) { msg.textContent = 'Please paste at least five rows with a positive distance (m) and an RSSI (dBm).'; return; }
  const d0 = get('d0') > 0 ? get('d0') : 100, budget0 = get('ptx') + get('gn') + get('gg') - get('lc');
  const L = rssi.map(v => budget0 - v), X = d.map(v => 10 * Math.log10(v / d0));
  const f = linreg(X, L); svFit = { n: f.slope, se: f.seSlope, L0: f.intercept, s: f.s, r2: f.r2, N: d.length };
  svPlot.clear();
  svPlot.scatter('pts', d, L, { color: 'water', r: 3.6, label: 'your survey: path loss = budget − RSSI' });
  const lo = Math.min(...d), hi = Math.max(...d), xs = Array.from({ length: 60 }, (_, i) => lo * Math.pow(hi / lo, i / 59));
  svPlot.setAxis('x', { min: lo * 0.8, max: hi * 1.25 });
  svPlot.line('fit', xs, xs.map(x => f.intercept + f.slope * 10 * Math.log10(x / d0)), { color: 'accent', width: 2.4, label: `fit: n = ${fmt(f.slope, 2)}, σ = ${fmt(f.s, 1)} dB` });
  svPlot.band('band', xs, xs.map(x => f.intercept + f.slope * 10 * Math.log10(x / d0) - f.s), xs.map(x => f.intercept + f.slope * 10 * Math.log10(x / d0) + f.s), { color: 'accent', alpha: 0.12 });
  const p = params(), t = TECH[p.tech]; const fGHz = p.tech === 'nbiot' ? 0.868 : t.f;
  svPlot.line('model', xs, xs.map(x => pathLoss(x, fGHz, p.hg, p.hn, p.n)), { color: 'magenta', width: 1.8, dash: [6, 4], label: `lab model (${fmt(fGHz, 3)} GHz, h ${p.hg}/${p.hn} m, n = ${p.n})` });
  msg.innerHTML = `${d.length} points · fitted exponent <b>n = ${fmt(f.slope, 2)} ± ${fmt(f.seSlope, 2)}</b> (standard error) · L(d₀ = ${fmt(d0, 0)} m) = ${fmt(f.intercept, 1)} dB · shadowing <b>σ = ${fmt(f.s, 1)} dB</b> · R² = ${fmt(f.r2, 2)}. ${f.slope < 2 ? 'An exponent below 2 suggests guided or line-of-sight paths — or a distance range too short to leave the free-space region.' : ''}`;
}
if (svEl) {
  svEl.querySelector('textarea').value = exampleSurvey();
  svEl.querySelector('[data-act="fit"]').addEventListener('click', fitSurvey);
  svEl.querySelector('[data-act="use"]').addEventListener('click', () => { if (!svFit) fitSurvey(); if (!svFit) return; ui.setMany({ n: Math.min(4.5, Math.max(2, +svFit.n.toFixed(2))), sigma: Math.min(12, Math.max(2, Math.round(svFit.s * 2) / 2)) }); if (window.FFP && FFP.toast) FFP.toast(`Model updated: n = ${fmt(svFit.n, 2)}, σ = ${fmt(svFit.s, 1)} dB`); });
}

/* ------------------------------------------------------------------ readouts */
function setPdr() { const done = stats.ok + stats.lost; const r = done ? stats.ok / done : NaN; ro.set('pdr', done ? 100 * r : NaN, !done ? null : r >= 0.95 ? 'ok' : r >= 0.8 ? 'warn' : 'bad', `${stats.ok} of ${done} messages that completed their trip`); }
function updateReadouts(p) {
  const tk = p.tech, t = TECH[tk]; const n = nodes.length;
  if (!n) { ['conn', 'worst', 'cov', 'pdr', 'life', 'iavg', 'toa', 'dc', 'ttn'].forEach(k => ro.set(k, k === 'conn' || k === 'life' ? '—' : NaN, null, k === 'conn' ? 'click the map to place nodes' : '&nbsp;')); return; }
  const rel = nodes.filter(x => x.reliable).length; ro.set('conn', `${rel} / ${n}`, rel === n ? 'ok' : rel >= 0.7 * n ? 'warn' : 'bad', tk === 'zigbee' && p.mesh ? `${nodes.filter(x => x.hop > 1 && x.hop < Infinity).length} via mesh relays` : `fade margin ${fmt(p.F, 1)} dB (${Math.round(p.rel * 100)} % with σ = ${p.sigma} dB)`);
  const worst = nodes.reduce((a, b) => (b.M < a.M ? b : a)); ro.set('worst', worst.M, worst.M >= p.F ? 'ok' : worst.M >= 0 ? 'warn' : 'bad', `${worst.id} (${worst.zlabel})`);
  const cov = nodes.reduce((s, x) => s + x.cov, 0) / n; ro.set('cov', 100 * cov, cov >= p.rel ? 'ok' : cov >= 0.7 ? 'warn' : 'bad', 'probability that shadowing leaves the link working');
  setPdr();
  const lives = nodes.filter(x => !x.router).map(x => x.life).sort((a, b) => a - b); const ml = lives.length ? lives[Math.floor((lives.length - 1) / 2)] : NaN;
  ro.set('life', lifeTxt(ml), ml / 8766 >= 5 ? 'ok' : ml / 8766 >= 1 ? 'warn' : 'bad', `${fmt(p.cap, 0)} mAh × ${p.eta}; shortest ${lifeTxt(lives[0])}`);
  const iav = nodes.map(x => x.Iavg).sort((a, b) => a - b)[Math.floor((n - 1) / 2)]; ro.set('iavg', iav * 1000, null, `sleep ${fmt(t.sleep + p.iboard, 1)} µA · ${fmt(nodes[0].qmsg, 2)} mA·s per message`);
  const toas = nodes.map(x => x.toa).filter(isFinite).sort((a, b) => a - b);
  ro.set('toa', toas.length ? 1000 * toas[Math.floor((toas.length - 1) / 2)] : NaN, null, tk === 'nbiot' ? 'connection and repetitions: see energy' : tk === 'wifi' ? 'plus ≈ 1.7 s association and listening' : tk === 'lora' ? `median node; SF${nodes.map(x => x.sf).sort((a, b) => a - b)[Math.floor((n - 1) / 2)]}` : '&nbsp;');
  if (tk === 'lora') {
    const w = nodes.reduce((a, b) => (b.toa > a.toa ? b : a)); const dcN = 36 / w.toa; const lim = nodes.filter(x => x.dcLimited).length;
    ro.set('dc', dcN, 3600 / p.T <= dcN ? 'ok' : 'bad', `slowest node (SF${w.sf}, ${fmt(w.toa * 1000, 0)} ms)${lim ? ` · ${lim} node(s) limited` : ''}`);
    const ttn = 30 / w.toa; ro.set('ttn', ttn, 86400 / p.T <= ttn ? 'ok' : 'warn', `you send ${fmt(86400 / p.T, 0)} per day`);
  } else { ro.set('dc', NaN, null, tk === 'nbiot' ? 'licensed band: no duty cycle' : '2.4 GHz band: other access rules, no 1 % duty cycle in this model'); ro.set('ttn', NaN, null, 'LoRaWAN only'); }
}

/* ------------------------------------------------------------------ recompute & loop */
let heatT = null;
function scheduleHeat(coarse) { clearTimeout(heatT); const p = params(); if (coarse) { computeHeat(p, true); draw(); } heatT = setTimeout(() => { computeHeat(params(), false); draw(); }, coarse ? 250 : 60); }
function recompute() {
  const p = params();
  ['sf'].forEach(id => ui.show(id, p.tech === 'lora')); ui.show('phy', p.tech === 'ble'); ui.show('mesh', p.tech === 'zigbee'); ui.show('bsd', p.tech === 'nbiot'); ui.show('hataEnv', p.tech === 'nbiot');
  evalNodes(p); updateReadouts(p); updateCharts(p); renderTopics(false); showCard();
  scheduleHeat(false);
  clock.speed = p.T / 3.5;
  legend.innerHTML = p.heat === 'sf' && p.tech === 'lora'
    ? `<div style="margin-bottom:3px">ADR spreading factor for margin ≥ ${fmt(p.F, 1)} dB</div><div class="sf-row">${[7, 8, 9, 10, 11, 12].map(s => `<span style="background:rgb(${SF_COL[s].join(',')})">SF${s}</span>`).join('')}<span style="background:#a50026">none</span></div>`
    : p.heat === 'off' ? '' : `<div>Mean link margin M (dB) · ${TECH[p.tech].short}</div><div class="cbar" style="background:linear-gradient(to right,#d6302788 0%,#d63027 20%,#f46d43 40%,#fee08b 55%,#a6d96a 70%,#1a9850 100%)"></div><div class="cbar-ticks"><span>&lt; 0</span><span>0</span><span>${fmt(p.F, 0)} (fade)</span><span>+30</span></div>`;
  legend.style.display = p.heat === 'off' ? 'none' : '';
  hud.set('tech', `<b>${TECH[p.tech].short}</b> · ${TECH[p.tech].f} GHz · ${TECH[p.tech].ptx} dBm`);
  draw();
}
const clock = new SimClock({
  speed: 900 / 3.5,
  onStep: dt => {
    const p = params(); const T = p.T;
    nodes.forEach(n => { const Teff = n.Teff || T; if (!n.next) n.next = clock.t + n.phase * Teff; if (clock.t + dt >= n.next) { n.next = Math.max(n.next + Teff, clock.t + 0.5 * Teff); transmit(n, p); } });
  },
  onFrame: () => {
    const now = performance.now(); const dtr = Math.min(0.1, lastFrame ? (now - lastFrame) / 1000 : 1 / 60); lastFrame = now;
    ripples.forEach(r => r.t += dtr); for (let i = ripples.length - 1; i >= 0; i--) if (ripples[i].t > ripples[i].dur) ripples.splice(i, 1);
    const p = params();
    packets.forEach(pk => pk.t += dtr);
    for (let i = packets.length - 1; i >= 0; i--) { const pk = packets[i]; if (pk.t >= pk.dur + (pk.ok ? 0 : 0.3)) { packets.splice(i, 1); if (pk.ok) deliver(pk.node, p); else { stats.lost++; } } }
    pipeDots.forEach(d => d.t += dtr); for (let i = pipeDots.length - 1; i >= 0; i--) if (pipeDots[i].t >= 1.6) { const d = pipeDots.splice(i, 1)[0]; arrive(d.node); }
    nodes.forEach(n => { if (n.flash > 0) n.flash = Math.max(0, n.flash - 0.04); });
    Object.keys(topicFlash).forEach(k => { topicFlash[k] *= 0.94; if (topicFlash[k] < 0.02) delete topicFlash[k]; });
    if ((frameN = (frameN + 1) % 12) === 0) { renderTopics(true); setPdr(); }
    if (W >= 600) hud.set('t', `1 s ≈ <b>${durTxt(clock.speed)}</b> · simulated <b>${durTxt(clock.t)}</b>`); else hud.remove('t');
    draw();
  }
});
let frameN = 0, lastFrame = 0;
let pausedByScroll = false;
new IntersectionObserver(es => es.forEach(en => { if (!en.isIntersecting && clock.running) { clock.pause(); pausedByScroll = true; } else if (en.isIntersecting && pausedByScroll) { pausedByScroll = false; clock.play(); } })).observe(stageEl);
ui.onChange((st, id) => {
  if (['tech', 'sf', 'phy', 'mesh', 'n', 'sigma', 'rel', 'hg', 'hn', 'gg', 'bsd', 'hataEnv', 'pl', 'T'].includes(id)) { stats = { sent: 0, ok: 0, lost: 0 }; nodes.forEach(n => { n.stats = { sent: 0, ok: 0 }; n.next = 0; }); }
  if (id === 'tech') { packets.length = 0; pipeDots.length = 0; }
  recompute();
});

/* ------------------------------------------------------------------ start */
nodes = PRESET_NODES.field.map(([x, y]) => mkNode(x, y)); sel = nodes.length - 1;
resize();
if (W < 600) sel = -1;
recompute();
if (svEl) fitSurvey();
clock.play();
window.__iot = { nodes: () => nodes, params, evalNodes, loraToA, nbEnergy, hata, pathLoss, foliageLoss, obstacles, TECH };
