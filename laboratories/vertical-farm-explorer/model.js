/* ==========================================================================
   Vertical farm explorer — annual facility balance of a plant factory with
   artificial lighting (PFAL) growing lettuce. Pure functions (no DOM).

   Light → yield:   Y = LUE · DLI · days / DM                     (Kozai 2013; Jin et al. 2023)
   Light → power:   P = PPFD / (η_ph · η_cap)                       (Lesson 4.3)
   Energy balance:  all electricity becomes heat (minus the chemical energy stored
                    in the crop); HVAC electricity = heat / COP     (Kozai 2013; Lesson 8.1)
   Transpiration:   60 % of the absorbed, non-stored light energy drives latent heat (Lesson 8.1)
   Water, CO₂:      condensate recovery and CO₂ use efficiency       (Kozai 2013)
   Costs:           capital recovery factor, labour and consumables per m² of
                    cultivation area                                 (Zhuang et al. 2022)
   ========================================================================== */
export const RACK_DEPTH = 1.25, TIER_PITCH = 0.45, BASE_H = 0.35, TRAY_FILL = 0.92;
export const ROOM = { L: 22, W: 14, segLen: 8.75, endAisle: 1.5, sideAisle: 1.2 };
export const UMOL_PER_J_PAR = 4.9, CANOPY_ABS = 0.9, KJ_PER_G_DW = 17.5, LATENT_SHARE = 0.6, LAMBDA = 2.45; // MJ kg⁻¹
export const USD_EUR = 0.92;

/** Rack layout in the grow room for a given aisle width and number of tiers. */
export function layout(aisle, tiers) {
  const usable = ROOM.W - 2 * ROOM.sideAisle;
  const rows = Math.max(1, Math.floor((usable + aisle) / (RACK_DEPTH + aisle)));
  const span = rows * RACK_DEPTH + (rows - 1) * aisle;
  const z0 = -span / 2 + RACK_DEPTH / 2;
  const rowZ = Array.from({ length: rows }, (_, i) => z0 + i * (RACK_DEPTH + aisle));
  const segX = [-(ROOM.endAisle / 2 + ROOM.segLen / 2), ROOM.endAisle / 2 + ROOM.segLen / 2];
  const footprint = rows * 2 * ROOM.segLen * RACK_DEPTH;
  const floor = ROOM.L * ROOM.W;
  const cultivation = footprint * tiers * TRAY_FILL;
  const rackTop = BASE_H + tiers * TIER_PITCH + 0.1;
  return { rows, rowZ, segX, footprint, floor, cultivation, rackTop, roomH: Math.max(4.6, rackTop + 1.7), sue: cultivation / floor };
}

const crf = (r, n) => r <= 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));

/** Annual balance. p: see the Controls in main.js (all SI-like units as labelled there). */
export function balance(p) {
  const L = layout(p.aisle, p.tiers);
  const A = L.cultivation;                                   // m² of cultivation area
  const dli = p.ppfd * p.photo * 3600 / 1e6;                  // mol m⁻² d⁻¹
  const days = 365 * p.util;                                 // production days per year
  const molYr = dli * days;                                  // mol m⁻² yr⁻¹ at the canopy
  const dwYr = p.lue * molYr;                                // g DW m⁻² yr⁻¹
  const fwYr = dwYr / (p.dm / 100) / 1000;                   // kg FW m⁻² yr⁻¹ (per cultivation area)
  const perFloor = fwYr * A / L.floor;                        // kg FW per m² of grow-room floor
  const buildingFloor = L.floor / (1 - p.support / 100);
  const perBuilding = fwYr * A / buildingFloor;
  const prodT = fwYr * A / 1000;                             // t yr⁻¹
  const headG = p.lue * dli * p.cycle / (p.dm / 100) / p.density; // g FW per head at harvest
  const headsDay = prodT * 1e6 / Math.max(1, headG) / 365;
  // electricity per m² cultivation per year (kWh)
  const eLight = molYr * 1e6 / (p.eff * p.cap) / 3.6e6;
  const eAux = p.aux / 100 * eLight;
  const radiant = Math.min(eLight, eLight * p.eff / UMOL_PER_J_PAR);      // PAR leaving the fixtures
  const incident = radiant * p.cap, absorbed = incident * CANOPY_ABS;
  const chem = dwYr * KJ_PER_G_DW / 3600;                                 // kWh m⁻² yr⁻¹ stored in dry matter
  const latent = LATENT_SHARE * Math.max(0, absorbed - chem);
  const heat = eLight + eAux - chem;                                     // heat to remove (envelope neglected)
  const eHVAC = heat / p.cop;
  const eTot = eLight + eAux + eHVAC;
  const kwhKg = eTot / fwYr;
  // water: transpiration = latent heat / λ ; recovered at the cooling coil
  const transp = latent * 3.6 / LAMBDA;                                   // kg m⁻² yr⁻¹
  const waterNet = transp * (1 - p.rec / 100) + fwYr * (1 - p.dm / 100); // lost + water leaving in the product
  const lKg = waterNet / fwYr, transpKg = transp / fwYr;
  // CO₂
  const co2Fixed = dwYr / 1000 * 0.40 * 44.01 / 12.011;                   // kg m⁻² yr⁻¹
  const co2Supply = co2Fixed / p.cue;
  // money (€ per m² cultivation per year)
  const cElec = eTot * p.price;
  const cCap = p.capex * (crf(p.rate / 100, p.life) + 0.015);
  const cLab = p.labour;
  const cCons = p.cons * fwYr, cPack = p.pack * fwYr;
  const cTot = cElec + cCap + cLab + cCons + cPack;
  const perKg = x => x / fwYr;
  // facility totals
  const hoursLit = p.photo;
  const pLightInst = p.ppfd / (p.eff * p.cap) * A / 1000;                 // kW installed (all lights on)
  const coolPeak = (pLightInst * (1 + p.aux / 100)) * (1 - chem / (eLight + eAux));
  return {
    L, A, dli, days, molYr, dwYr, fwYr, perFloor, perBuilding, prodT, headG, headsDay, buildingFloor,
    e: { light: eLight, aux: eAux, hvac: eHVAC, tot: eTot, radiant, incident, absorbed, chem, latent, heat },
    kwhKg, lKg, transpKg, co2Kg: co2Supply / fwYr, co2eKg: kwhKg * p.grid / 1000,
    cost: { elec: perKg(cElec), light: perKg(eLight * p.price), hvac: perKg(eHVAC * p.price), aux: perKg(eAux * p.price), cap: perKg(cCap), lab: perKg(cLab), cons: p.cons, pack: p.pack, tot: perKg(cTot) },
    elecShare: cElec / cTot, pLightInst, coolPeak, mwh: eTot * A / 1000, wm2: p.ppfd / (p.eff * p.cap), hoursLit
  };
}

/* ---------------------------------------------------------------- comparison systems (per kg of fresh lettuce) */
// Västerås (59.6° N) mean daily PAR by month, MJ m⁻² d⁻¹ (NASA POWER climatology 2001–2020, as used in the Sun-path laboratory)
const PAR_VAS = [0.46, 1.48, 3.75, 6.31, 8.43, 9.6, 8.89, 6.96, 4.44, 2.02, 0.67, 0.28];
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Light-based yield estimate for a Swedish greenhouse: τ = 0.65, lamps top up to 17 mol m⁻² d⁻¹ (max 180 µmol m⁻² s⁻¹ for 18 h), LUE 0.39 g DW mol⁻¹ (Jin et al. 2023). */
export function swedishGreenhouseYield(dm) {
  let mol = 0; PAR_VAS.forEach((par, m) => { const nat = par * 4.57 * 0.65; const lamp = Math.min(Math.max(0, 17 - nat), 180 * 18 * 3600 / 1e6); mol += (nat + lamp) * MDAYS[m]; });
  return 0.39 * mol / (dm / 100) / 1000;       // kg FW m⁻² yr⁻¹ of cultivation area
}
export function comparisons(dm) {
  const f = dm / 100;
  return [
    { key: 'pfal', label: 'Plant factory (Graamans)', kwh: 247 * f, water: NaN, yield: NaN },
    { key: 'gh-se', label: 'Swedish GH, 68° N (Graamans)', kwh: 182 * f, water: NaN, yield: NaN },
    { key: 'gh-vas', label: 'Västerås GH (estimate)', kwh: NaN, water: NaN, yield: swedishGreenhouseYield(dm) },
    { key: 'gh-az', label: 'Arizona GH (Barbosa)', kwh: 90000 / 3600, water: 20, yield: 41 },
    { key: 'field', label: 'Arizona field (Barbosa)', kwh: 1100 / 3600, water: 250, yield: 3.9 }
  ];
}
