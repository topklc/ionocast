// Central deriveConditions: turns ctx (kpNow, dst, bz, paths, etc.)
// into the per-band tier verdicts the glance-simple table renders.
// Handles the per-path SNR budget walk (tryMargin/hfGroupVerdict),
// the VHF Es/Aurora/MS verdict (vhfVerdict), and the storm-phase
// classification fed to the physics budget.

import {
  BAND_FREQ_MHZ, FUSION_PRIMARY_MUF, SCATTER_WEIGHT
} from "../constants.js";
import {
  currentQth, qthToLatLon, gcPointAtFraction
} from "../physics/qth.js";
import {
  snrMarginHf, snrMarginHfEs, snrMarginVhfEs, snrMarginVhfAurora,
  solarCosZenith,
  tierFromMargin, tierRank, tierStability,
  cgmLatAbs,
  foF2Climatology, mufConsensus, pathMinMuf, grayLineBonusDb,
  midpointFoF2WithFallback, perHopFoF2FromStations,
  scatterBonusDb, irregularityRecoveryDb,
  hopsForDistance,
  tepBonusDb, nvisSecantFactor, nvisTailFactor
} from "../physics/physics.js";
import { snrOpts } from "../settings.js";
import { t } from "../i18n.js";
import { spotBaselineMean } from "./spots.js";
import {
  classifyStormType, bzForwardKpBump,
  forecastKpPenaltyDb, stormLagEffectiveKp
} from "./storm.js";
import { meteorScatterActive } from "./showers.js";

function pathDirections(paths) {
  // Bucket destinations into the highest band each path supports at FOT
  // (= 0.85 \u00d7 MUF). Derived directly from p.mufMHz so we don't need the
  // user-facing "band" label that was removed from path-table.
  var buckets = { "160":[], "80":[], "60":[], "40":[], "30":[], "20":[], "17":[], "15":[], "12":[], "10":[] };
  var BAND_FOT = [[28,"10"],[24,"12"],[21,"15"],[18,"17"],[14,"20"],[10,"30"],[7,"40"],[3.5,"80"],[1.8,"160"]];
  (paths && paths.paths || []).forEach(function(p) {
    if (p.mufMHz == null) return;
    var fot = 0.85 * p.mufMHz;
    var group = null;
    for (var k = 0; k < BAND_FOT.length; k++) {
      if (BAND_FOT[k][0] <= fot) { group = BAND_FOT[k][1]; break; }
    }
    if (!group) return;
    var name = (p.name || "").replace("QTH \u2192 ", "").split(" ")[0];
    if (name && buckets[group].indexOf(name) < 0) buckets[group].push(name);
  });
  return buckets;
}

/**
 * Top-level glue between the physics layer and the UI. Runs once per
 * 10-minute UI refresh and produces a fully-shaped conditions object
 * that the band tables, alert lists, reference-paths panel, and
 * outlook section all consume.
 *
 * Pipeline (in order):
 *   1. Build per-path geometry (TX→{NYC, SP, JNB, TYO, SYD} short and
 *      long path) and pull each midpoint's nearest GIRO digisonde
 *      foF2 + kc2g grid MUF.
 *   2. Derive the storm state: classify type (CME / HSS), compute the
 *      storm-lagged effective Kp, apply the Bz forward bump, classify
 *      phase (quiet / main / recovery).
 *   3. For each band × destination, score `snrMarginHf` and assign a
 *      tier from the (margin, σ) pair. Apply per-mode bonuses (TEP,
 *      gray-line, scatter, NVIS-tail, Es-as-primary) where the gates
 *      fire. Add propagation-mode hints (Es, aurora-E, MS) to VHF.
 *   4. Attach soft alerts for any threshold-crossing condition (M-class
 *      flare, Bz southward, Dst depression, PCA, D-RAP, storm tail).
 *   5. Resolve "best path" per band and populate the directional UI
 *      hints ("good · best to Joburg") that power the at-a-glance
 *      tier verdicts in the band tables.
 *
 * The function is pure given its inputs, no I/O, no caching. Inputs
 * are gathered upstream by the data layer (proxy fetchers + browser
 * caches) and passed in via `ctx`. Each `ctx` field is independently
 * stale-tolerant; missing fields skip their corresponding term in
 * the budget rather than hard-failing.
 *
 * @param {Object} ctx              Upstream-data bundle. See body for full field list.
 * @returns {Object} Conditions tree consumed by the UI builders.
 */
export function deriveConditions(ctx) {
  var bandsHf = ctx.bandsHf, bandsVhf = ctx.bandsVhf, ovation = ctx.ovation, drap = ctx.drap;
  var paths = ctx.paths, kpNow = ctx.kpNow, apNow = ctx.apNow;
  var xrayClassStr = ctx.xrayClass, f107 = ctx.f107;
  var f107A = ctx.f107A != null ? ctx.f107A : f107;   // 81-day mean; fall back to single-day
  var giroFoF2 = ctx.giroFoF2;      // nearest digisonde foF2 (MHz), for NVIS on short paths
  var giroHmF2 = ctx.giroHmF2;      // nearest digisonde F2-peak height (km), for NVIS-secant + hop ceiling
  var giroStations = ctx.giroStations || [];  // R3: all GIRO stations with foF2 readings, for fusion second opinion
  var dstNow = ctx.dst;             // Kyoto Dst (nT), negative = storm
  var bzNow = ctx.bzNow;            // DSCOVR IMF Bz (nT), negative = southward
  var bzHistory = ctx.bzHistory;    // last 60 min of Bz (1-min cadence) for forward bump
  var kpHistory = ctx.kpHistory;    // 7-day 3h-cadence Kp samples; storm-lag input
  var kpForecast = ctx.kpForecast;  // SWPC 3-day Kp forecast slots; σ inflation input
  var solarWindNow = ctx.solarWindNow;  // DSCOVR/ACE plasma { speedKmS, densityCm3, tempK }
  var protonFluxP1   = ctx.protonFluxP1;   // GOES >=1 MeV pfu; SEP onset detector
  var protonFluxP10  = ctx.protonFluxP10;  // GOES >=10 MeV pfu; PCA driver
  var protonFluxP100 = ctx.protonFluxP100; // GOES >=100 MeV pfu; deep PCA penetration
  var donkiHss = ctx.donkiHss;      // DONKI HSS (co-rotating stream) catalog
  var showers  = ctx.showers;       // IMO meteor shower catalog

  var nowDateForStorm = new Date();

  // Storm-lag effective Kp: ionospheric F-region depression lags the Kp
  // kick by a couple hours and recovers over ~half a day (CME) to a full
  // day (HSS). UI text continues to show kpNow so the displayed number
  // matches SWPC.
  var stormType = classifyStormType(donkiHss && donkiHss.items, dstNow, nowDateForStorm, solarWindNow, bzNow);
  var kpLagged = stormLagEffectiveKp(kpHistory, nowDateForStorm, kpNow, stormType);

  // Bz forward bump: real-time L1 Bz leads geomagnetic effect at Earth
  // by ~30-60 min, so the lagged kernel (which is decay-only) misses the
  // ramp. Add a small additive Kp from sustained negative Bz before the
  // 3 h Kp index catches up.
  var bzBump = bzForwardKpBump(bzHistory, nowDateForStorm);

  // Dst storm adjustment: when Dst < -50, the ring current is
  // enhanced (storm in progress), bump the effective Kp for model purposes.
  var kpEffective = kpLagged;
  if (dstNow != null && dstNow < -50 && kpEffective != null) {
    // Dst provides faster storm detection than 3-hour Kp.
    // Bump effective Kp by +1 per 50 nT below -50, capped at +2.
    var dstBump = Math.min(2, (-dstNow - 50) / 50);
    kpEffective = Math.min(9, kpEffective + dstBump);
  }
  if (bzBump > 0 && kpEffective != null) {
    kpEffective = Math.min(9, kpEffective + bzBump);
  }

  // Forecast σ inflation: precompute once and forward through bandOpts.
  // Pass the storm-lagged effective Kp (not raw kpNow) so the forecast
  // bump phases out as the F-region thermosphere actually catches up to
  // the predicted peak, matching the K_p^eff-keyed σ_storm branch in
  // physics.js. Using the live 3-hour Kp here would step the forecast
  // bump down on each 3-hour tick rather than smoothly hand off to
  // σ_storm, briefly inflating the in-quadrature σ at the catch-up
  // moment (per whitepaper §7.3.1).
  var forecastSigmaDb = forecastKpPenaltyDb(kpForecast, nowDateForStorm, kpEffective);

  var opts = snrOpts();              // tx power, antenna, mode, noise env

  var hfByName = {};
  ((bandsHf && bandsHf.rows) || []).forEach(function(r) { hfByName[r[0]] = r; });
  function cellText(c) { return c && typeof c === "object" ? c.text : c; }
  function spotsInt(n) {
    var r = hfByName[n]; if (!r) return 0;
    // Strip ALL locale-dependent grouping separators (comma, period, space,
    // non-breaking space) so parseInt works regardless of browser locale.
    var s = String(cellText(r[3]) || "").replace(/[.,\s\u00a0]/g, "").replace(/^-$/, "0");
    var v = parseInt(s, 10); return isNaN(v) ? 0 : v;
  }
  function fmuf(n) {
    var r = hfByName[n]; if (!r) return null;
    var v = parseFloat(cellText(r[4])); return isNaN(v) ? null : v;
  }
  function drapAbs(n) {
    var r = hfByName[n]; if (!r) return false;
    return String(cellText(r[5]) || "").indexOf("\u2265") === 0;
  }

  var pathDirs = pathDirections(paths);
  function withDirs(group, base) {
    var d = pathDirs[group];
    return d && d.length ? base + t("; best to ") + d.join(", ") : base;
  }

  // Closure context for verdict functions. Computed once; read by both
  // hfGroupVerdict (via the auroral & Es-screen terms) and vhfVerdict.
  var foes = null;
  var vhfRows0 = (bandsVhf && bandsVhf.rows) || [];
  if (vhfRows0.length) {
    var c0 = vhfRows0[0][2];
    var parsed0 = parseFloat(typeof c0 === "string" ? c0 : (c0 && c0.text) || "");
    foes = isNaN(parsed0) ? null : parsed0;
  }
  var ll = qthToLatLon(currentQth());
  var qthLatAbs = ll ? Math.abs(ll[0]) : null;
  var qthCgmLatAbs = ll ? cgmLatAbs(ll[0], ll[1]) : null;
  var auroraHp = ovation ? (ll && ll[0] >= 0 ? ovation.north_hp_gw : ovation.south_hp_gw) : null;
  var haf = drap ? drap.qth_freq : null;
  var nowDate = new Date();
  var cosZNow = ll ? solarCosZenith(ll[0], ll[1], nowDate) : null;

  // Storm-phase classification from Dst trajectory + Kp.
  //   quiet     - Dst > -30 and Kp < 4
  //   initial   - Dst > 0 with elevated Kp (sudden compression, rare)
  //   main      - Dst <= -50 and storm-lag kernel still loading
  //   recovery  - Dst depressed but kpEffective > kpNow (tail settling)
  // Hoisted up here so bandOpts can pass it into the physics budget;
  // physics.js applies +40% on lAuroralDb during main and +4 dB on
  // sigma during recovery.
  var stormPhase = (function() {
    if (dstNow == null && kpNow == null) return null;
    if (dstNow != null && dstNow > 0 && kpNow != null && kpNow >= 5) return "initial";
    if (dstNow != null && dstNow <= -50 && (kpEffective == null || kpEffective >= (kpNow || 0))) return "main";
    if (dstNow != null && dstNow <= -30 && kpEffective != null && kpNow != null && kpEffective > kpNow + 0.5) return "recovery";
    if ((dstNow == null || dstNow > -30) && (kpNow == null || kpNow < 4)) return "quiet";
    return "active";
  })();

  // Build a per-band SNR opts bundle (carries diurnal noise + environmental
  // context shared by all margin computations on this tick).
  function bandOpts(extra) {
    var o = Object.assign({}, opts, {
      haf: haf, kp: kpEffective, hpGw: auroraHp,
      cgmLatAbsValue: qthCgmLatAbs,
      foEs: foes, cosZenithNow: cosZNow,
      // Drivers for the per-hop ionospheric loss bundle in physics.js.
      // date + QTH geometry enable PCA / flare SID / per-hop D-region.
      protonFluxP1:   protonFluxP1,
      protonFluxP10:  protonFluxP10,
      protonFluxP100: protonFluxP100,
      xrayClass:     xrayClassStr,
      date:          nowDate,
      srcLat: ll ? ll[0] : null,
      srcLon: ll ? ll[1] : null,
      // Forecast σ inflation: precomputed once for all paths/bands.
      forecastSigmaDb: forecastSigmaDb,
      // Storm phase: feeds the lAuroralDb amplification (main) and
      // recovery-tail TID sigma penalty in snrMarginHf.
      stormPhase: stormPhase,
    });
    if (extra) Object.assign(o, extra);
    return o;
  }

  // Per-path verdict: walk the kc2g reference paths and compute margin
  // per (path, band). Take the best margin per band, and the band-group's
  // verdict is the best across its bands. Returns the best path's name
  // for the directional suffix. Falls back to local-MUF model when no
  // path data is available.
  function hfGroupVerdict(names, group) {
    var spots = Math.max.apply(null, names.map(spotsInt).concat([0]));
    var absorbed = names.some(drapAbs);
    var pathList = (paths && paths.paths) || [];

    var best = null;
    var openDirs = [];     // destinations where ANY band in the group is open
    // Per-band best candidate: { name: { margin, tier, mode, dest } }.
    // Used both for the per-band breakdown note when bands diverge and
    // for the HF-table renderer (each row gets the band's predicted
    // tier / margin / mode / best destination).
    var bestPerBand = {};

    // tryMargin: for a given band and path context, compute the SNR
    // margin with full data-layer treatment: kc2g↔climatology consensus
    // on MUF, per-hop minimum, and gray-line bonus when the midpoint is
    // on the terminator. `pathCtx` fields:
    //   mufMHz, dKm, midLat, midLon, destLat, destLon, destShort.
    function tryMargin(name, pathCtx) {
      var f = BAND_FREQ_MHZ[name];
      if (f == null) return null;

      // NVIS: for short paths (< 500 km) on low bands the signal travels
      // at near-vertical incidence. The relevant frequency limit is
      // foF2 × sec(angle), not MUF(3000). The secant factor corrects for
      // the mild obliqueness of a ~500 km hop (angle ~40° at F2 height
      // 300 km, sec ≈ 1.3). Dropping to foF2 directly, as the model did
      // previously, under-predicted the upper edge of NVIS by ~20-30 %.
      //
      // 500-1500 km on the low bands is a transition zone: NVIS still
      // contributes but progressively less as the takeoff angle becomes
      // shallower. Earlier code had a hard cutoff at 500 km; this branch
      // now blends the NVIS-derived MUF with the F2 MUF using
      // nvisTailFactor(dKm) (1 below 500, 0 above 1500, linear ramp).
      // The mode label tracks whichever side dominates so the UI's
      // per-band breakdown still says "NVIS" when NVIS is doing the
      // work and "F2" once F2 takes over.
      var dKm = pathCtx.dKm;
      // NVIS gate: short path, local foF2 reading, and the band fits
      // under the geometry-aware NVIS MUF (foF2 * sec(takeoff-zenith)).
      // Replaces the prior hard "f <= 8 MHz" cap which excluded 30 m
      // (10.1 MHz) even when daytime foF2 > 7 MHz routinely supports it
      // under F10.7 > 150 conditions.
      // Use observed hmF2 from the local digisonde when available so the
      // NVIS secant matches the same F2-peak height that hopCeilingKm
      // uses (Eq. 18 in the paper); 300 km only when the digisonde is
      // not reporting hmF2 in this query window. The 5% MUF_NVIS shift
      // at hmF2 = 340 km versus the 300 km default matters at the
      // upper edge of NVIS, where the band gate f <= MUF_NVIS(d) flips
      // around f_oF2.
      var hFNvis = (giroHmF2 != null && isFinite(giroHmF2) && giroHmF2 > 100)
                     ? giroHmF2 : 300;
      var nvisMuf      = (giroFoF2 != null && dKm != null)
                          ? giroFoF2 * nvisSecantFactor(dKm, hFNvis) : null;
      var nvisAvailable = dKm != null && dKm < 1500 &&
                          giroFoF2 != null && nvisMuf != null && f <= nvisMuf;
      var nvisTail = nvisAvailable ? nvisTailFactor(dKm) : 0;
      var f2Muf    = pathCtx.mufMHz != null ? pathCtx.mufMHz : null;
      var isNvis = nvisTail >= 0.5;        // mode label only
      var kc2gMuf;
      if (nvisAvailable && nvisTail > 0 && nvisMuf != null && f2Muf != null) {
        kc2gMuf = nvisTail * nvisMuf + (1 - nvisTail) * f2Muf;
      } else if (nvisAvailable && nvisTail > 0 && nvisMuf != null) {
        kc2gMuf = nvisMuf;
      } else {
        kc2gMuf = f2Muf;
      }

      // Solar zenith at the path midpoint, the reflection point where
      // D-region absorption actually happens. Reused for climatology,
      // per-hop scaling, and the diurnal-absorption term in snrMarginHf.
      var cosZmid = (pathCtx.midLat != null && pathCtx.midLon != null)
        ? solarCosZenith(pathCtx.midLat, pathCtx.midLon, nowDate)
        : null;

      // Second opinion at the path midpoint: fusion if FUSION_PRIMARY_MUF
      // is enabled and stations are in range, else climatology only.
      // The 2026-04 R2 climatology rebuild lowered the night floor and
      // added an F-region memory lag, narrowing the fusion-vs-climatology
      // gap. The harness sweeps both modes; flag stays OFF until R7
      // calibration confirms net-positive lift in joint optimization.
      var climoMuf = null;
      if (pathCtx.midLat != null && pathCtx.midLon != null) {
        var foF2c = null;
        if (FUSION_PRIMARY_MUF && giroStations.length > 0) {
          var blended = midpointFoF2WithFallback(
            giroStations, pathCtx.midLat, pathCtx.midLon,
            function (lat, lon) {
              var cz = solarCosZenith(lat, lon, nowDate);
              return foF2Climatology(f107A, cz, Math.abs(lat), lat, lon, nowDate);
            }
          );
          foF2c = blended ? blended.foF2 : null;
        } else if (cosZmid != null) {
          foF2c = foF2Climatology(
            f107A, cosZmid, Math.abs(pathCtx.midLat),
            pathCtx.midLat, pathCtx.midLon, nowDate
          );
        }
        if (foF2c != null) climoMuf = foF2c * 3.0;
      }
      var consensus = mufConsensus(kc2gMuf, climoMuf);
      var effMuf = consensus.muf;
      if (effMuf == null) return null;

      // Per-hop minimum via direct climatology evaluation at each
      // reflection point, scaled by the kc2g/climo correction at the
      // midpoint. climoMuf may be null (kc2g-only midpoint, no climo
      // input), pathMinMuf falls back to illumination-ratio scaling
      // in that case.
      if (pathCtx.midLat != null && pathCtx.destLat != null && pathCtx.dKm) {
        effMuf = pathMinMuf(effMuf, climoMuf, f107A,
                            pathCtx.midLat, pathCtx.midLon,
                            ll[0], ll[1],
                            pathCtx.destLat, pathCtx.destLon,
                            pathCtx.dKm, nowDate);
      }

      var m = snrMarginHf(f, effMuf, bandOpts({
        dKm: pathCtx.dKm,
        cosZenithPath: cosZmid,
        midLat: pathCtx.midLat, midLon: pathCtx.midLon,
        dstLat: pathCtx.destLat, dstLon: pathCtx.destLon,
      }));
      if (m == null) return null;

      // Compute the three additive recovery terms but DON'T stack them
      // blindly: gray-line and the irregularity-mode pair (TEP, scatter)
      // describe distinct physical phenomena, but TEP and scatter
      // describe overlapping ones, so the pair should not double-count.
      //
      //   glBonus     , D-region attenuation drop at the terminator
      //                   (low-band only); independent mechanism, ADDS.
      //   scatterBonus, F-region irregularity-driven recovery above MUF
      //                   (TIDs, plasma blobs, gradient instabilities).
      //   tepBonus    , chordal propagation across the magnetic equator
      //                   via equatorial F-region irregularities, late
      //                   afternoon / evening local at the midpoint.
      //
      // TEP and scatter are both "irregularity-driven recovery in the
      // F-region": when both fire on a TEP-eligible 15 m path in the
      // 17 to 23 LT window above MUF, summing them double-counts the same
      // physical recovery channel. Take the larger of the two instead.
      // The TEP plateau is calibrated at 15 dB and the scatter cap is
      // 15 dB at weight=1.5, so neither dominates by construction;
      // taking max keeps the more informative estimate per cell.

      var glBonus = 0;
      if (pathCtx.midLat != null) {
        glBonus = grayLineBonusDb(pathCtx.midLat, pathCtx.midLon, f, nowDate);
      }

      // F2-region scatter recovery on above-MUF paths. Per-hop foF2
      // variance from at least 2 GIRO stations along the great circle
      // (with climatology fill-in for out-of-range hops).
      var scatterBonus = 0;
      if (SCATTER_WEIGHT > 0 && pathCtx.dKm && giroStations.length >= 2 &&
          pathCtx.midLat != null && pathCtx.destLat != null) {
        var nHops = hopsForDistance(pathCtx.dKm);
        if (nHops >= 2) {
          var perHop = perHopFoF2FromStations(
            giroStations, ll[0], ll[1], pathCtx.destLat, pathCtx.destLon, pathCtx.dKm);
          var fof2List = [];
          for (var k = 0; k < perHop.length; k++) {
            if (perHop[k] != null) {
              fof2List.push(perHop[k].foF2);
            } else {
              var frac = (2 * (k + 1) - 1) / (2 * nHops);
              var pt = gcPointAtFraction(ll[0], ll[1], pathCtx.destLat, pathCtx.destLon, frac);
              var cz = solarCosZenith(pt[0], pt[1], nowDate);
              var v = foF2Climatology(f107A, cz, Math.abs(pt[0]), pt[0], pt[1], nowDate);
              if (v != null) fof2List.push(v);
            }
          }
          if (fof2List.length >= 2) {
            var meanF = fof2List.reduce(function (a, b) { return a + b; }, 0) / fof2List.length;
            var sumSq = 0;
            for (var ii = 0; ii < fof2List.length; ii++) {
              var dd = fof2List[ii] - meanF; sumSq += dd * dd;
            }
            var stdDev = Math.sqrt(sumSq / fof2List.length);
            scatterBonus = scatterBonusDb(f, effMuf, stdDev, SCATTER_WEIGHT);
          }
        }
      }

      // TEP: chordal propagation across the magnetic equator on
      // 15 m / 12 m / 10 m / 6 m during late afternoon / evening at the
      // midpoint, both endpoints with opposite-sign dip latitudes.
      // Peak magnitude scaled by f107A (solar-cycle-keyed; 8 dB at
      // solar min, 15 dB at peak, matches operator experience that
      // moderate-cycle TEP is weaker than peak-cycle TEP).
      var tepBonus = tepBonusDb(
        f,
        ll[0], ll[1],
        pathCtx.destLat, pathCtx.destLon,
        pathCtx.midLat, pathCtx.midLon,
        nowDate, f107A
      );

      // Apply: gray-line additive; TEP / scatter take the max.
      if (glBonus > 0) m.margin += glBonus;
      var irregularityRecovery = irregularityRecoveryDb(tepBonus, scatterBonus);
      if (irregularityRecovery > 0) m.margin += irregularityRecovery;

      // Mode tagging: when an additive bonus mechanism is materially
      // contributing to the margin (≥2 dB), surface it in the mode tag
      // so the operator sees TEP / Scatter / GL instead of just "F2".
      // Priority: Es (if it wins below) > GL (separate D-region mech) >
      // TEP > Scatter (TEP and scatter both fire on F-region irregularity
      // recovery; pick the dominant one).
      var mode = isNvis ? "NVIS" : "F2";
      if (irregularityRecovery >= 2) {
        mode = (tepBonus >= scatterBonus) ? "TEP" : "Scatter";
      }
      if (glBonus >= 2 && glBonus >= irregularityRecovery) {
        mode = "GL";
      }

      // Sporadic-E as an alternative propagation mode. When foEs is
      // strong enough and the band is at or below the Es MUF, we run a
      // single-hop Es budget in parallel with the F2 budget and keep
      // whichever mode gives the better margin. Captures summer-evening
      // 10 m / 12 m / 15 m Es openings the F2-only model calls closed.
      // (Es check below overrides mode when Es wins.)
      if (foes != null && foes > 0) {
        var mEs = snrMarginHfEs(f, foes, bandOpts({
          midLat: pathCtx.midLat, midLon: pathCtx.midLon
        }));
        if (mEs != null && mEs.margin > m.margin) {
          // Copy the Es budget into m, preserving the shape expected by
          // the rest of the pipeline (lAbsD / lPca / lFlare exist; lAur,
          // lEs, lHop, lLow, lAbs absent from Es → zero-fill).
          m = {
            margin: mEs.margin, sigma: mEs.sigma,
            lFs: mEs.lFs, lAbs: 0, lAbsD: mEs.lAbsD,
            lAur: 0, lMuf: mEs.lMuf,
            lLow: 0, lHop: 0, lEs: 0,
            lPca: mEs.lPca, lFlare: mEs.lFlare,
            n: mEs.n, dKm: mEs.dKm, nHops: 1,
            gAnt: mEs.gAnt, pTx: mEs.pTx
          };
          mode = "Es";
        }
      }

      // Track the best candidate for each band individually. Used both
      // by the per-band breakdown note when bands in a group diverge
      // by >=1 tier and by the HF-table renderer (each row gets the
      // band's predicted tier / margin / mode / best destination).
      // Tier comes from the (margin, sigma) reliability bucket, so the
      // boundary scales with each band's prediction uncertainty.
      if (bestPerBand[name] == null || m.margin > bestPerBand[name].margin) {
        bestPerBand[name] = {
          margin: m.margin,
          sigma:  m.sigma,
          // tierFromMargin reach-gates Excellent on dKm: a +18 dB
          // margin from a short F2 hop reads "good" not "excellent"
          // because it doesn't represent open DX — see tier.js.
          tier:   tierFromMargin(m.margin, pathCtx.dKm),
          confidence: tierStability(m.margin, m.sigma),
          mode:   mode,
          dest:   pathCtx.destShort || null,
          dKm:    pathCtx.dKm || null,
        };
      }

      var esOpen = foes != null && foes * 5 >= f;
      var candidate = {
        name: name, freq: f, muf: effMuf, ratio: f / effMuf,
        m: m, esOpen: esOpen, dest: pathCtx.destShort,
        dKm: pathCtx.dKm || null,
        glBonus: glBonus, tepBonus: tepBonus, scatterBonus: scatterBonus,
        mode: mode,
        mufSource: consensus.source,
        mufDivergence: consensus.divergence
      };
      // Keep the best for metadata (directional notes, Es flag, etc.)
      if (!best || m.margin > best.m.margin) best = candidate;
      if (m.margin >= 6 && pathCtx.destShort && openDirs.indexOf(pathCtx.destShort) < 0) {
        openDirs.push(pathCtx.destShort);
      }
      return m;
    }

    // Path-grounded budget: each kc2g reference path has its own MUF.
    pathList.forEach(function(p) {
      if (p.mufMHz == null || !p.lengthKm) return;
      var ctx = {
        mufMHz: p.mufMHz, dKm: p.lengthKm,
        midLat: p.midLat, midLon: p.midLon,
        destLat: p.destLat, destLon: p.destLon,
        destShort: p.destShort
      };
      names.forEach(function(n) { tryMargin(n, ctx); });
    });

    // Local-MUF fallback when no kc2g paths. Midpoint = QTH, no destination
    // geometry (single-point); pathMinMuf + grayLineBonusDb degrade
    // gracefully.
    if (!best) {
      names.forEach(function(n) {
        var f = BAND_FREQ_MHZ[n];
        var ratio = fmuf(n);
        if (f == null || ratio == null || ratio <= 0) return;
        tryMargin(n, {
          mufMHz: f / ratio, dKm: null,
          midLat: ll[0], midLon: ll[1],
          destLat: null, destLon: null,
          destShort: null
        });
      });
    }

    if (best) {
      // Verdict is for the best-margin path (from the kc2g reference set).
      // An earlier attempt to aggregate by median-across-all-paths was
      // removed: most of the 9 reference paths are transcontinental
      // long-hops that are routinely over-MUF or night-crossing at any
      // given moment, so the median was dominated by failing paths and
      // buried genuinely open short paths (NYC 944 km from EM79, etc.).
      // If a single path is viable, the band is not "closed" -- it's
      // open to that destination, which is what the reason string and
      // openDirs list already convey.
      // Ensemble blend with the N0NBH SFI-heuristic was removed
      // 2026-04-25 (D experiment). Replay against 30 d of WSPR
      // aggregates: pure physics scored 92.36 % binary accuracy /
      // Brier 0.0533, the historical flat 0.7 / 0.3 blend scored
      // 87.61 % / 0.0804, and the band-dependent 0.7-1.0 / 0-0.3 blend
      // (the 2026-04-25 attempt) was strictly intermediate. Even on
      // 160 m the heuristic was net-harmful (96.96 % pure → 91.56 %
      // blended). Margin now reflects the physics budget directly;
      // heuristicTier stays exported in physics.js for the scenarios
      // diagnostic harness but is no longer in the verdict path.

      // best.m carries the physics budget; the path that produced
      // it is `best`, whose dKm we plumb through for the Excellent
      // reach gate (Section sec:tiers in the paper, tierFromMargin
      // in tier.js).
      var tier = tierFromMargin(best.m.margin, best.dKm);
      if (absorbed && spots < 50) return ["closed", t("D-region absorption blocking signals"), bestPerBand];

      // WSPR activity override. One-way only: if observed spots exceed
      // the band's 30-day mean for this hour of the day, promote the
      // verdict up to "good" (capped). Never downgrade -- low activity
      // does not invalidate physics; it might just mean nobody is on
      // the air. The override exists so a genuine opening the physics
      // missed (e.g. an Es spike the model can't see, or a propagation
      // mode outside the budget) still surfaces as a usable band.
      // The override threshold is the 30-day mean times an empirical
      // multiplier > 1: bare "spots > mean" fires on roughly half of
      // refreshes by construction (mean is, well, the mean), which
      // would over-promote bands with high natural spot variance. The
      // 1.3x multiplier requires *meaningfully* above-average activity
      // before promoting -- approximately mean + 0.5 sigma assuming
      // typical spot-rate distributions.
      var avg = spotBaselineMean(best.name, nowDate);
      var SPOT_OVERRIDE_RATIO = 1.3;
      // Two distinct activity signals from the same observation:
      //   spotOverride: promote tier up to good when activity beats
      //     baseline AND the prior tier was below good. Tier-changing.
      //   exceptionalActivity: activity beats baseline regardless of
      //     prior tier. Display-only, preserves the "unusually busy"
      //     signal even on physics-Excellent bands, where the override
      //     intentionally never fires (nothing to promote to). The
      //     decoration is what an operator would otherwise miss: a band
      //     that's already physics-Excellent and is also reading 3× the
      //     normal spot rate is unambiguously the place to be, but the
      //     plain "Excellent · margin 22 dB" line doesn't say so.
      var spotsExceedBaseline = spots > avg * SPOT_OVERRIDE_RATIO;
      var spotOverride = false;
      if (spotsExceedBaseline && tierRank(tier) < tierRank("good")) {
        tier = "good";
        spotOverride = true;
      }
      var exceptionalActivity = spotsExceedBaseline && !spotOverride;

      // Compose the note from tidy dot-separated segments. Order:
      //   margin [. dirs] [. reliability]                (normal case)
      //   margin . unusually active: N spots/h vs avg M  (spot override)
      //   margin . dirs . exceptionally active: N/h vs M (Excellent + active)
      // Per-mechanism loss terms (D-abs, flare, PCA, aurora, Es-screen,
      // hop count, gray-line, kc2g/climo divergence) are deliberately
      // dropped here: rare ones are surfaced by the soft-alert bar at
      // the top of the page, and D-RAP is already shown per-band in
      // the dedicated HF Bands panel.
      var parts = [t("margin") + " " + Math.round(best.m.margin) + " dB"];

      if (spotOverride) {
        parts.push(t("unusually active: {n} spots/h vs avg {m}",
                      { n: spots, m: Math.round(avg) }));
      } else {
        // Directional suffix: only for genuinely open bands. Showing
        // "best: Joburg" on a closed row implied "least-bad direction,"
        // which is false precision; operators can consult the Path
        // Table in the Ionosphere section for per-destination detail.
        if (tier === "good" || tier === "excellent") {
          var opens = openDirs.slice();
          if (opens.length === 0 && best.dest) opens = [best.dest];
          if (opens.length >= 4)      parts.push(t("open worldwide"));
          else if (opens.length > 0)  parts.push(opens.join(", "));
        }
        // Exceptional-activity decoration: physics-Excellent bands that
        // are ALSO reading well above baseline. The override never
        // promotes Excellent (nothing to promote to), but the activity
        // signal stays informative, "excellent · open worldwide" by
        // itself is a static prediction; appending the live activity
        // count tells the operator the predicted opening is being
        // actively used right now.
        if (exceptionalActivity) {
          parts.push(t("exceptionally active: {n} spots/h vs avg {m}",
                        { n: spots, m: Math.round(avg) }));
        }
        // Confidence hint: P(predicted tier is correct) given (margin,
        // sigma). Borderline verdicts read low-confidence (~30 %),
        // stable verdicts read high (80 %+). Operator reads "good ·
        // 86 % confident" as "the model is 86 % sure the band is good
        // and not the next tier over." Percent shown for non-closed
        // verdicts only.
        if (tier !== "closed") {
          var pct = Math.round(tierStability(best.m.margin, best.m.sigma) * 100);
          parts.push(pct + "% " + t("confident"));
        }
      }

      return [tier, parts.join(" · "), bestPerBand];
    }

    // No MUF anywhere: spot-only fallback. bestPerBand stays empty
    // here -- no physics ran, so the verdict comes purely from observed
    // activity vs the 30-day baseline.
    var avg2 = spotBaselineMean(names[0], nowDate);
    if (absorbed && spots < 50) return ["closed", t("D-region absorption blocking signals"), bestPerBand];
    if (spots === 0)            return ["closed", t("no recent activity"), bestPerBand];
    if (spots > avg2)           return ["fair", t("active · {n} spots/h", { n: spots }), bestPerBand];
    return ["poor", t("quiet · {n} spots/h", { n: spots }), bestPerBand];
  }

  function groupStats(names) {
    var total = names.map(spotsInt).reduce(function(a, b) { return a + b; }, 0);
    var fms = names.map(fmuf).filter(function(x) { return x != null; });
    var fm = fms.length ? Math.min.apply(null, fms) : null;
    var spots = (total ? total.toLocaleString() : "0") + " " + t("spots/h");
    return fm != null ? spots + " \u00b7 f/MUF " + fm.toFixed(2) : spots;
  }

  function vhfVerdict(fMHz, hint6vs2) {
    var mEs  = snrMarginVhfEs(fMHz, foes, bandOpts());
    var mAur = snrMarginVhfAurora(fMHz, auroraHp, bandOpts());
    var via = null, margin = null, sigma = null;
    if (mEs  != null) { via = "Es";     margin = mEs.margin;  sigma = mEs.sigma; }
    if (mAur != null && (margin == null || mAur.margin > margin)) {
      via = "aurora"; margin = mAur.margin; sigma = mAur.sigma;
    }

    // Meteor-scatter floor: a major shower during the predawn window
    // supports bursty QSOs even when F2 / Es / aurora are all closed.
    // Lift the verdict to "poor" (viable with effort) and annotate.
    var ms = meteorScatterActive(showers, ll ? ll[0] : null, ll ? ll[1] : null, nowDate);

    // VHF "best" mirrors HF's: { margin, sigma, tier, mode, dest, reliability }.
    // There is no explicit destination for VHF since Es is omnidirectional
    // and aurora is northward scatter; leave dest null. When meteor scatter
    // is the only mode, dest carries the shower name.
    function pack(tier, marginVal, mode, dest, sig) {
      var conf = (marginVal != null && sig != null) ? tierStability(marginVal, sig) : null;
      return { margin: marginVal, sigma: sig != null ? sig : null,
               tier: tier, mode: mode, dest: dest || null, confidence: conf };
    }

    if (margin == null) {
      if (ms.active) {
        var msBest = pack("poor", null, "MS", ms.name, null);
        return ["poor", t("meteor scatter · {name} shower active", { name: ms.name }), msBest];
      }
      var noBest = pack("closed", null, hint6vs2 === "6m" ? "MS only" : "EME only", null, null);
      return hint6vs2 === "6m"
        ? ["closed", t("no Es or aurora; tropospheric / meteor scatter only"), noBest]
        : ["closed", t("tropospheric / EME only"), noBest];
    }
    // VHF (Es / aurora-E / MS) is inherently regional; the
    // Excellent reach-gate doesn't apply — pass null dKm so
    // tierFromMargin skips the gate and lets a strong margin
    // produce Excellent regardless of distance.
    var tier = tierFromMargin(margin, null);
    if (tier == null) tier = "closed";
    // MS also rescues closed E/aurora verdicts with low margin.
    if ((tier === "closed" || tier === "poor") && ms.active) {
      return ["poor", t("meteor scatter · {name} shower active", { name: ms.name }),
              pack("poor", margin, "MS", ms.name, sigma)];
    }
    var marginStr = t("margin") + " " + Math.round(margin) + " dB";
    var modeLabel = via === "Es" ? t("sporadic-E") : t("aurora-E");
    var parts = [modeLabel, marginStr];
    if (tier === "good") {
      if (via === "Es") {
        parts.push(hint6vs2 === "6m" ? t("listen 50.313 FT8") : t("listen 144.174 FT8"));
      } else {
        parts.push(hint6vs2 === "6m" ? t("try 50.110 SSB") : t("listen 144.300 distorted SSB"));
      }
    }
    var modeShort = via === "Es" ? "Es" : "Aurora";
    return [tier, parts.join(" · "), pack(tier, margin, modeShort, null, sigma)];
  }
  function vhf6m() { return vhfVerdict(50,  "6m"); }
  function vhf2m() { return vhfVerdict(144, "2m"); }
  function vhfStatsStr() {
    var bits = [];
    if (foes != null) bits.push("foEs " + foes.toFixed(1) + " MHz");
    if (auroraHp != null) bits.push(t("aurora") + " " + Math.round(auroraHp) + " GW");
    return bits.length ? bits.join(" \u00b7 ") : t("no recent data");
  }

  function makeHf(name, names, group) {
    var v = hfGroupVerdict(names, group);
    // v[2] is the per-band best-candidate map { bandName: { margin, tier,
    // mode, dest } }. Each makeHf call passes a single-band group, so
    // we look up by `name` directly. Will be undefined when the spot-
    // only fallback fired (no physics ran).
    return {
      name:    name,
      verdict: v[0],
      note:    v[1],
      stats:   groupStats(names),
      best:    (v[2] && v[2][name]) || null,
    };
  }
  function makeVhf(name, fn) {
    var v = fn();
    return { name: name, verdict: v[0], note: v[1], stats: vhfStatsStr(), best: v[2] || null };
  }

  var bands = [
    makeHf("160 m", ["160 m"], "160"),
    makeHf("80 m",  ["80 m"],  "80"),
    makeHf("60 m",  ["60 m"],  "60"),
    makeHf("40 m",  ["40 m"],  "40"),
    makeHf("30 m",  ["30 m"],  "30"),
    makeHf("20 m",  ["20 m"],  "20"),
    makeHf("17 m",  ["17 m"],  "17"),
    makeHf("15 m",  ["15 m"],  "15"),
    makeHf("12 m",  ["12 m"],  "12"),
    makeHf("10 m",  ["10 m"],  "10"),
    makeVhf("6 m", vhf6m),
    makeVhf("2 m", vhf2m),
  ];

  return {
    bands: bands,
    concurrent: {
      kpNow: kpNow,
      apNow: apNow,
      f107: f107,
      auroraHp: auroraHp,
      haf: haf,
      xrayClass: xrayClassStr,
      dst: dstNow,
      bz: bzNow,
      // Solar-wind plasma: speed in km/s, density in cm^-3. Used by the
      // storm-type classifier; surfaced for the UI alert layer too.
      swSpeed:   solarWindNow ? solarWindNow.speedKmS  : null,
      swDensity: solarWindNow ? solarWindNow.densityCm3 : null,
      // Storm-lag effective Kp: the value the physics budget actually
      // consumes (kpNow with Dst + history kernel + Bz bump applied).
      // Surfaces cases where the raw Kp has recovered but the F-region
      // hasn't, or where Bz is leading the index reading.
      kpEffective: kpEffective,
      bzBump:      bzBump,           // additive Kp from sustained negative Bz
      forecastSigmaDb: forecastSigmaDb,  // dB σ inflation from 3-day forecast peak
      stormType: stormType,          // "cme" or "hss"; affects decay timescale
      // Storm phase classification (computed once above, before bandOpts):
      //   quiet     - Dst > -30 and Kp < 4
      //   initial   - Dst > 0 with elevated Kp (sudden compression, rare)
      //   main      - Dst <= -50 and storm-lag kernel still loading
      //   recovery  - Dst depressed but kpEffective > kpNow (tail settling)
      stormPhase: stormPhase,
      // Drivers for derived alerts.
      protonFluxP1:   protonFluxP1,
      protonFluxP10:  protonFluxP10,
      protonFluxP100: protonFluxP100,
      cosZenithNow: cosZNow,
      qthLat: ll ? ll[0] : null,
      qthLon: ll ? ll[1] : null
      // The earlier `geomagLabel` field (a Kp-driven string label) was
      // removed: nothing read it, and it diverged from the NOAA G-scale
      // used by the alerts panel ("severe" at Kp=7 here vs G3=strong /
      // G4=severe at Kp=8 there). Anyone needing a state label should
      // either compute it inline against the alerts panel's Kp→G-code
      // table (src/ui/builders/alerts.js) or call a future shared
      // helper, but not duplicate the lookup here.
    }
  };
}
