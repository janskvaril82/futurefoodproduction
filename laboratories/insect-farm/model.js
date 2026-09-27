/* Insect farm — batch model for mealworm (Tenebrio molitor) and black soldier fly (Hermetia illucens) larvae.
   Growth: Gompertz (mealworm) / logistic (BSF) with a Brière-1 temperature response; carbon (Pirt-type)
   balance for assimilation, respiration (CO₂, heat), feed and frass; self-heating of the crate;
   mortality. Equations I1–I11 in the Derive tab. Pure functions, no DOM. */

export const CRATE = { area: 0.24, w: 0.60, d: 0.40 };           // 60 × 40 cm rearing crate
export const RQ = 0.9, OXYCAL = 450e3;                             // J per mol O₂ (Gnaiger 1983)
export const HCO2 = OXYCAL / RQ;                                   // J per mol CO₂
export const CF = 0.45, CL = 0.50;                                 // carbon fraction of feed DM and of larval DM (assumed)

export const SPECIES = {
  mealworm: {
    label: 'Yellow mealworm', latin: 'Tenebrio molitor', growth: 'gompertz',
    m0: 1.0, mMax: 160, rRef: 0.0382, Tref: 27, Tmin: 10, Tmax: 35.5,
    maint: 0.05, Q10: 2, Y: 0.44, DM: 0.39, prot: 0.50,
    mort0: 0.0008, Tcrit: 35.5, dTm: 1.2, harvest: 0.85,
    layer: 0.04, kLayer: 0.25, wet: 0.02, rho50: 9, turnaround: 7, stress: 33,
    density: { min: 0.2, max: 8, step: 0.1, def: 1.5 },
    diets: {
      bran_carrot: { label: 'Wheat bran + carrots', q: 1.0, qm: 1.0, AD: 0.50, mort: 1, wet: 0.01, eu: 'ok', note: 'Standard commercial diet; carrots supply water.' },
      bran: { label: 'Wheat bran only (no fresh moisture)', q: 0.8, qm: 0.9, AD: 0.45, mort: 1.5, wet: 0.003, eu: 'ok', note: 'Slower growth without a water source (Oonincx et al. 2015).' },
      hp_byprod: { label: 'High-protein by-products (spent grain, yeast) + carrots', q: 1.12, qm: 1.05, AD: 0.58, mort: 1, wet: 0.01, eu: 'ok', note: 'Best ECI in Oonincx et al. (2015): 21 %, 85 days.' },
      lp_byprod: { label: 'Low-protein, high-starch by-products', q: 0.45, qm: 0.75, AD: 0.38, mort: 8, wet: 0.01, eu: 'ok', note: 'Survival only 15–18 %, 170–183 days (Oonincx et al. 2015).' },
      catering: { label: 'Catering / kitchen waste', q: 1.0, qm: 1.0, AD: 0.50, mort: 1.2, wet: 0.03, eu: 'ban', note: 'Prohibited as feed for farmed insects in the EU (feed-ban rules).' }
    }
  },
  bsf: {
    label: 'Black soldier fly', latin: 'Hermetia illucens', growth: 'logistic',
    m0: 0.1, mMax: 210, rRef: 0.60, Tref: 28, Tmin: 11.74, Tmax: 43.23,
    maint: 0.08, Q10: 2, Y: 0.44, DM: 0.35, prot: 0.42,
    mort0: 0.005, Tcrit: 38, dTm: 1.25, harvest: 0.90,
    layer: 0.06, kLayer: 0.40, wet: 0.20, rho50: 25, turnaround: 3, stress: 36,
    density: { min: 0.5, max: 15, step: 0.5, def: 4 },
    diets: {
      chicken: { label: 'Chicken feed (control)', q: 1.0, qm: 1.0, AD: 0.55, mort: 1, wet: 0.20, eu: 'ok', note: 'Standard laboratory substrate; ECI ≈ 27 % (Oonincx et al. 2015).' },
      spent_grain: { label: "Brewers' spent grain + yeast", q: 0.92, qm: 0.95, AD: 0.50, mort: 1, wet: 0.24, eu: 'ok', note: 'Diet D1 of Chia et al. (2018).' },
      fruit_veg: { label: 'Fruit & vegetable residues (no meat/fish)', q: 0.75, qm: 0.75, AD: 0.45, mort: 1.2, wet: 0.28, eu: 'ok', note: 'Former foodstuffs of vegetal origin are permitted after unpacking.' },
      food_waste: { label: 'Food / catering waste (post-consumer)', q: 1.1, qm: 0.95, AD: 0.62, mort: 1.2, wet: 0.24, eu: 'ban', note: 'High conversion (Naser El Deen et al. 2023) but prohibited in the EU.' },
      manure: { label: 'Pig manure solids', q: 0.35, qm: 0.30, AD: 0.30, mort: 2, wet: 0.24, eu: 'ban', note: 'Manure may not be fed to farmed insects in the EU.' }
    }
  }
};

/** Brière-1 thermal performance, normalised to 1 at T_ref (Brière et al. 1999). */
export function briere(sp, T) {
  const f = t => (t <= sp.Tmin || t >= sp.Tmax) ? 0 : t * (t - sp.Tmin) * Math.sqrt(sp.Tmax - t);
  return f(T) / f(sp.Tref);
}
export const briereOpt = sp => (4 * sp.Tmax + 3 * sp.Tmin + Math.sqrt(16 * sp.Tmax ** 2 + 9 * sp.Tmin ** 2 - 16 * sp.Tmax * sp.Tmin)) / 10;
/** Maintenance respiration (carbon-specific, d⁻¹) with a Q10 law. */
export const maintenance = (sp, T) => sp.maint * Math.pow(sp.Q10, (T - sp.Tref) / 10);
/** Daily mortality rate, d⁻¹. */
export function mortality(sp, diet, T, rhoB) {
  return sp.mort0 * diet.mort + 0.02 * Math.exp((T - sp.Tcrit) / sp.dTm) + (T < sp.Tmin + 3 ? 0.004 : 0) + 0.0005 * Math.max(0, rhoB / sp.rho50 - 1);
}
/** Effective heat-transfer coefficient per m² of crate, W m⁻² K⁻¹ (McAdams-type wind correlation). */
export const hConv = v => 5.7 + 3.8 * v;
/** Saturation vapour pressure, kPa (Tetens, FAO-56 eq. 11; same as svp() in physics.js). */
export const svp = T => 0.6108 * Math.exp(17.27 * T / (T + 237.3));
/** Latent-transfer coefficient per unit h (Lewis analogy): (1/c_p)·0.622·L_v/P, W m⁻² kPa⁻¹ per W m⁻² K⁻¹. */
export const KE = 0.622 * 2.43e6 / (1006 * 101.325);
/** Surface temperature of the substrate for a metabolic heat flux q (W m⁻²): sensible + evaporative loss (I7). */
export function surfaceT(q, Ta, RH, h, wet) {
  const ea = RH / 100 * svp(Ta); let Ts = Ta + q / h * 0.7;
  for (let i = 0; i < 12; i++) { const es = svp(Ts); const f = h * (Ts - Ta) + wet * KE * h * (es - ea) - q; const df = h + wet * KE * h * es * 17.27 * 237.3 / (Ts + 237.3) ** 2; Ts -= f / df; }
  const lat = Math.max(0, wet * KE * h * (svp(Ts) - ea));
  return { Ts, lat, sens: q - lat };
}
/** Heat released per mg CO₂ (J). */
export const J_PER_MG_CO2 = HCO2 / 44010;

/**
 * Simulate one batch in one crate.
 * p: { species, diet, Tair (°C), RH (%), density (larvae cm⁻²), v (m s⁻¹ air speed over crates) }
 * Returns time series (per day) and batch totals per crate.
 */
export function simulate(p, { dt, tMax, keepSeries = true } = {}) {
  const sp = SPECIES[p.species], diet = sp.diets[p.diet] || Object.values(sp.diets)[0];
  dt = dt || (sp.growth === 'logistic' ? 0.02 : 0.1);
  tMax = tMax || (sp.growth === 'logistic' ? 80 : 400);
  const N0 = p.density * CRATE.area * 1e4;          // larvae per crate
  const h = hConv(p.v), Rin = sp.layer / (3 * sp.kLayer), RH = p.RH ?? 65;
  let m = sp.m0, N = N0, t = 0, Tl = p.Tair;
  let feed = 0, frass = 0, co2 = 0, heat = 0, gainC = 0, latent = 0;    // per crate: g DM, g DM, g CO₂, J, g C, J
  let peakTl = p.Tair, peakFlux = 0, peakWkg = 0, harvested = false;
  const S = { t: [], m: [], N: [], Tl: [], flux: [], wkg: [], co2kg: [] };
  const mMaxEff = rho => sp.mMax * diet.qm / (1 + 0.35 * Math.max(0, rho / sp.rho50 - 0.3));
  let step = 0; const every = Math.max(1, Math.round(0.5 / dt));
  while (t < tMax) {
    const rhoB = N * m * 1e-6 / CRATE.area;                          // kg larvae per m² crate
    const fd = 1 / (1 + 0.25 * rhoB / sp.rho50);                     // crowding penalty on growth rate
    // growth (I1, I2)
    const rT = sp.rRef * briere(sp, Tl) * diet.q * fd;
    const mm = mMaxEff(rhoB);
    const dm = sp.growth === 'logistic' ? rT * m * Math.max(0, 1 - m / mm) : rT * m * Math.max(0, Math.log(mm / m));
    const mu = dm / m;                                               // specific growth rate, d⁻¹
    // carbon balance (I3, I4)
    const mT = maintenance(sp, Tl);
    const Bc = m * sp.DM * CL;                                       // mg C per larva
    const qC = sp.Y * mu + mT;                                       // respiration, d⁻¹
    const aC = mu + qC;                                              // assimilation, d⁻¹
    const co2L = qC * Bc * 44.01 / 12.011;                           // mg CO₂ per larva per day
    const ingL = aC * Bc / (diet.AD * CF);                           // mg feed DM per larva per day (I5)
    const Pl = co2L * J_PER_MG_CO2 / 86400;                          // W per larva (I6)
    const flux = N * Pl / CRATE.area;                                // W m⁻² crate
    // self-heating of the larval mass (I7) — relax towards the steady value
    const sf = surfaceT(flux, p.Tair, RH, h, diet.wet ?? sp.wet); const TlSS = sf.Ts + flux * Rin;
    Tl += (TlSS - Tl) * Math.min(1, dt / 0.25);
    const mort = mortality(sp, diet, Tl, rhoB);
    // integrate
    feed += N * ingL * dt / 1000; frass += N * ingL * (1 - diet.AD) * dt / 1000;
    co2 += N * co2L * dt / 1000; heat += N * Pl * dt * 86400; latent += sf.lat * CRATE.area * dt * 86400; gainC += N * dm * dt * sp.DM * CL / 1000;
    const wkg = Pl / (m * 1e-6);
    peakTl = Math.max(peakTl, Tl); peakFlux = Math.max(peakFlux, flux); peakWkg = Math.max(peakWkg, wkg);
    if (keepSeries && step % every === 0) { S.t.push(t); S.m.push(m); S.N.push(N); S.Tl.push(Tl); S.flux.push(flux); S.wkg.push(wkg); S.co2kg.push(co2L / m * 1000); }
    m += dm * dt; N -= N * mort * dt; t += dt; step++;
    if (m >= sp.harvest * mm || (t > 5 && mu < 0.002 && sp.growth === 'gompertz') || N < 1) { harvested = m >= sp.harvest * mm * 0.98; break; }
  }
  const biomass = N * m / 1000;                                      // g fresh per crate at harvest
  const biomass0 = N0 * sp.m0 / 1000;
  const gain = Math.max(1e-9, biomass - biomass0);
  const protein = biomass * sp.DM * sp.prot;                          // g protein per crate
  const cycle = t + sp.turnaround;
  return {
    sp, diet, series: S, tHarvest: t, cycle, harvested, mFinal: m, survival: N / N0, N0, Nfinal: N,
    biomass, gain, feed, frass, co2, heat, protein, gainC,
    FCR: feed / gain,                                                // g DM feed per g fresh gain
    ECI: gain * sp.DM / feed,                                        // DM gain / DM ingested
    feedPerProtein: feed / protein,
    frassPerKg: frass / biomass, co2PerKg: co2 / biomass,
    peakTl, peakFlux, peakWkg, meanWkg: heat / (t * 86400) / Math.max(1e-9, (biomass + biomass0) / 2 / 1000),
    feedC: feed * CF, co2C: co2 * 12.011 / 44.01, frassC: frass * CF, h, latent, evap: latent / 2.43e6 * 1000, latentShare: latent / Math.max(1, heat)
  };
}

/** Humidity ratio, kg water per kg dry air. */
export const humRatio = (T, RH) => { const e = RH / 100 * svp(T); return 0.622 * e / (101.325 - e); };
/** Facility totals. f: { levels, area (m² rearing floor), dTsupply (K), co2max (ppm), Tair (°C), RH (%) }; supply air conditioned to RH 60 % at T − ΔT. */
export function facility(res, f) {
  const cratesPerM2 = f.levels / (CRATE.area * 2.0);                  // stacks + aisles: 0.48 m² floor per stack
  const crates = cratesPerM2 * f.area;
  const cyclesYr = 365 / res.cycle;
  const proteinYr = res.protein / 1000 * crates * cyclesYr;            // kg protein per year
  const larvaeYr = res.biomass / 1000 * crates * cyclesYr;             // kg fresh larvae per year
  // average and peak heat: batches are staggered, so the room sees the batch-average load
  const avgHeatW = res.heat / (res.cycle * 86400) * crates;
  const latentW = res.latent / (res.cycle * 86400) * crates, sensW = avgHeatW - latentW;
  const peakHeatW = res.peakFlux * CRATE.area * crates;
  const co2Avg = res.co2 / (res.cycle * 86400) * crates;                // g s⁻¹
  const rho = 1.18, cp = 1006;
  const Vheat = Math.max(0, sensW) / (rho * cp * f.dTsupply) * 3600;   // m³ h⁻¹ (I8), sensible part
  const dW = humRatio(f.Tair ?? 27, f.RH ?? 65) - humRatio((f.Tair ?? 27) - f.dTsupply, 60);
  const evapKgS = latentW / 2.43e6;
  const Vhum = dW > 1e-4 ? evapKgS / (rho * dW) * 3600 : Infinity;     // m³ h⁻¹ to remove evaporated water
  const co2Density = 1808;                                             // g m⁻³ CO₂ at 25 °C, 1 atm
  const Vco2 = (co2Avg / co2Density) / ((f.co2max - 420) * 1e-6) * 3600;
  return {
    cratesPerM2, crates, cyclesYr, proteinYr, larvaeYr, proteinPerM2: proteinYr / f.area, larvaePerM2: larvaeYr / f.area,
    avgHeatW, latentW, sensW, evapKgDay: latentW / 2.43e6 * 86400, peakHeatW, heatPerM2: avgHeatW / f.area, Vheat, Vco2, Vhum, dW, Vreq: Math.max(Vheat, Vco2, Math.min(Vhum, 1e9)), governs: Vhum >= Math.max(Vheat, Vco2) ? 'moisture' : Vheat >= Vco2 ? 'heat' : 'CO₂',
    feedYr: res.feed / 1000 * crates * cyclesYr, frassYr: res.frass / 1000 * crates * cyclesYr, co2Yr: res.co2 / 1000 * crates * cyclesYr
  };
}

/* ------------------------------------------------------------ life cycle durations (days) */
// Tenebrio molitor: stage durations measured at 20–30 °C (Heidari Parsa et al. 2023, Table 2), linearly interpolated
const TM_TABLE = { T: [20, 23, 25, 27, 30], egg: [12.55, 10.32, 8.01, 6.82, 7.25], pupa: [21.88, 18.07, 15.10, 12.55, 15.00], adult: [23.37, 26.04, 29.17, 31.62, 27.41] };
function interp(xs, ys, x) { if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + f * (ys[i] - ys[i - 1]); } return ys[ys.length - 1]; }
/** Returns [{stage, days, note}] for the life cycle at air temperature T (larval days from the growth model). */
export function lifeCycle(species, T, larvalDays) {
  if (species === 'mealworm') {
    const inRange = T >= 20 && T <= 30;
    return [
      { stage: 'Egg', days: interp(TM_TABLE.T, TM_TABLE.egg, T), note: inRange ? '' : 'outside 20–30 °C data' },
      { stage: 'Larva', days: larvalDays, note: 'from the growth model' },
      { stage: 'Pupa', days: interp(TM_TABLE.T, TM_TABLE.pupa, T), note: '' },
      { stage: 'Adult beetle', days: interp(TM_TABLE.T, TM_TABLE.adult, T), note: 'lifespan; lays eggs' }
    ];
  }
  // Hermetia illucens: linear degree-day model (Chia et al. 2018, diet D1)
  const dd = (K, T0) => T > T0 + 0.5 ? K / (T - T0) : Infinity;
  const preov = Math.max(5, Math.min(16, 16 - (T - 20) * 11 / 15));
  return [
    { stage: 'Egg', days: dd(69.2, 13.65), note: '69 °C d above 13.6 °C' },
    { stage: 'Larva', days: larvalDays, note: 'from the growth model' },
    { stage: 'Prepupa + pupa', days: dd(142.9, 13.29) * 2, note: '2 × 143 °C d above 13.3 °C' },
    { stage: 'Adult fly', days: preov, note: 'pre-oviposition period; adults do not feed' }
  ];
}

/* ------------------------------------------------------------ literature comparison (per kg edible product / protein) */
export const COMPARE = {
  feed: { label: 'Feed per kg edible weight', unit: 'kg feed kg⁻¹', note: 'Live-weight FCR (US systems, Smil 2002) divided by the edible fraction (Nakagaki & DeFoliart 1991), as compiled by van Huis et al. (2013). Insects: Oonincx et al. (2015), eaten whole.', rows: [
    { k: 'Cricket', lo: 2.1, hi: 2.1 }, { k: 'Mealworm (lit.)', lo: 1.8, hi: 5.3 }, { k: 'BSF larvae (lit.)', lo: 2.0, hi: 2.3 }, { k: 'Chicken', lo: 4.5, hi: 4.5 }, { k: 'Pork', lo: 9.1, hi: 9.1 }, { k: 'Beef', lo: 25, hi: 25 }] },
  ghg: { label: 'Greenhouse gases per kg edible protein', unit: 'kg CO₂-eq kg⁻¹', note: 'Life-cycle assessment of mealworm production (Oonincx & de Boer 2012), compared with ranges for conventional products from de Vries & de Boer (2010) as reported there.', rows: [
    { k: 'Mealworm', lo: 14, hi: 14 }, { k: 'Chicken', lo: 18.5, hi: 37.4 }, { k: 'Pork', lo: 21.1, hi: 54.2 }, { k: 'Beef', lo: 77.3, hi: 175 }] },
  land: { label: 'Land use per kg edible protein', unit: 'm² kg⁻¹', note: 'Oonincx & de Boer (2012); 85 % of the mealworm land use is for feed grains. “This farm” shows only the floor area of the rearing room.', rows: [
    { k: 'Mealworm', lo: 18, hi: 18 }, { k: 'Chicken', lo: 41, hi: 51 }, { k: 'Pork', lo: 46, hi: 63 }, { k: 'Beef', lo: 142, hi: 254 }] },
  energy: { label: 'Energy use per kg edible protein', unit: 'MJ kg⁻¹', note: 'Oonincx & de Boer (2012): mealworms are not better than chicken or pork on energy, because the rearing rooms are heated.', rows: [
    { k: 'Mealworm', lo: 173, hi: 173 }, { k: 'Chicken', lo: 80, hi: 152 }, { k: 'Pork', lo: 95, hi: 237 }, { k: 'Beef', lo: 176, hi: 273 }] },
  water: { label: 'Water footprint per g protein', unit: 'L g⁻¹', note: 'Mealworm: Miglietta et al. (2015); livestock global averages: Mekonnen & Hoekstra (2012).', rows: [
    { k: 'Mealworm', lo: 23, hi: 23 }, { k: 'Chicken', lo: 34, hi: 34 }, { k: 'Pork', lo: 57, hi: 57 }, { k: 'Beef', lo: 112, hi: 112 }] }
};
