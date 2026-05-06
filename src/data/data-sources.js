// fetchData() dispatcher: every UI builder calls fetchData(name) and
// gets back a Promise of already-cached (in-memory) normalized data.
// This layer wires raw fetchers to derivations and caches the result.

import { cacheGet, cacheSet, inflight } from "./cache.js";
import { jget } from "./net.js";
import { currentQth } from "../physics/qth.js";
import {
  fetchSwpc3day, fetchSwpcRegions, fetch27day, fetchDrap, fetchOvationHp,
  fetchDonkiCme, fetchDonkiHss, fetchWsprAgg, fetchKc2gStations,
  fetchKpApNow, fetchKpHistory, fetchF107Now, fetchXrayClass, fetchBzNow,
  fetchSolarWindPlasma, fetchProtonFlux
} from "./fetchers.js";
import {
  computePaths, deriveTec, computeImoShowers,
  computeBandsHf, deriveVhfBands, deriveConditions
} from "../derive.js";

export function fetchData(name) {
  var cached = cacheGet(name);
  if (cached) return Promise.resolve(cached);
  return inflight(name, function() { return _fetchData(name); });
}

function _fetchData(name) {
  switch (name) {
    case "_meta":         return Promise.resolve(cacheSet(name, { qth: currentQth() }));
    case "silso":         return jget("/api/silso").then(function(d) { return cacheSet(name, d); });
    case "hp30":          return jget("/api/hp30").then(function(d) { return cacheSet(name, d); });
    case "kyoto":         return jget("/api/kyoto").then(function(d) { return cacheSet(name, d); });
    case "giro":          return jget("/api/giro?qth=" + encodeURIComponent(currentQth()))
                                  .then(function(d) { return cacheSet(name, d); });
    case "tropo":         return jget("/api/tropo?qth=" + encodeURIComponent(currentQth()) + "&v=3")
                                  .then(function(d) { return cacheSet(name, d); });
    case "tec":           return fetchData("kc2g").then(function(k) { return cacheSet(name, deriveTec(k.stations, currentQth())); });
    case "kc2g":          return fetchKc2gStations().then(function(s) { return cacheSet(name, { stations: s }); });
    case "paths":         return fetchData("kc2g").then(function(k) { return cacheSet(name, computePaths(k.stations, currentQth())); });
    case "swpc-regions":  return fetchSwpcRegions().then(function(d) { return cacheSet(name, d); });
    case "swpc-3day-prob":
    case "swpc-kp-forecast":
      return inflight("swpc-3day-shared", function() {
        return fetchSwpc3day().then(function(d) {
          cacheSet("swpc-3day-prob",   d[0]);
          cacheSet("swpc-kp-forecast", d[1]);
          return d;
        });
      }).then(function(d) { return name === "swpc-3day-prob" ? d[0] : d[1]; });
    case "ises-27day":    return fetch27day().then(function(d) { return cacheSet(name, d); });
    case "drap":          return fetchDrap().then(function(d) { return cacheSet(name, d); });
    case "ovation":       return fetchOvationHp().then(function(d) { return cacheSet(name, d || {}); });
    case "donki-cme":     return fetchDonkiCme().then(function(d) { return cacheSet(name, d); });
    case "donki-hss":     return fetchDonkiHss().then(function(d) { return cacheSet(name, d); });
    case "imo-showers":   return Promise.resolve(cacheSet(name, computeImoShowers()));
    // Cache the three "always-fresh" upstreams so a settings change
    // triggers an instant in-cache re-derive of conditions instead of
    // a 1-3 s round-trip to SWPC.
    case "kp-ap-now":     return fetchKpApNow().then(function(d) { return cacheSet(name, { kp: d[0], ap: d[1] }); });
    case "kp-history":    return fetchKpHistory().then(function(d) { return cacheSet(name, { history: d }); });
    case "proton-flux":   return fetchProtonFlux().then(function(d) { return cacheSet(name, d || { p1: null, p10: null, p100: null }); });
    case "xray-class":    return fetchXrayClass().then(function(d) { return cacheSet(name, { xrayClass: d }); });
    case "f107-now":      return fetchF107Now().then(function(d) { return cacheSet(name, { f107: d.f107, f107A: d.f107A, series: d.series }); });
    case "bands-hf":
      return Promise.all([fetchWsprAgg(), fetchData("giro").catch(function(){return null;}), fetchData("drap").catch(function(){return null;})])
        .then(function(arr) {
          return cacheSet(name, computeBandsHf(arr[0], arr[1] ? arr[1].muf3000 : null, arr[2]));
        });
    case "bands-vhf":
      return Promise.all([
        fetchData("giro").catch(function(){return null;}),
        fetchData("ovation").catch(function(){return null;}),
        fetchData("tropo").catch(function(){return null;})
      ]).then(function(arr) { return cacheSet(name, deriveVhfBands(arr[0], arr[1], arr[2])); });
    case "conditions":
      return Promise.all([
        fetchData("bands-hf").catch(function(){return null;}),
        fetchData("bands-vhf").catch(function(){return null;}),
        fetchData("ovation").catch(function(){return null;}),
        fetchData("drap").catch(function(){return null;}),
        fetchData("paths").catch(function(){return null;}),
        fetchData("kp-ap-now").catch(function(){return null;}),
        fetchData("xray-class").catch(function(){return null;}),
        fetchData("f107-now").catch(function(){return null;}),
        fetchData("giro").catch(function(){return null;}),
        fetchData("kyoto").catch(function(){return null;}),
        fetchBzNow().catch(function(){return null;}),
        fetchData("kp-history").catch(function(){return null;}),
        fetchData("proton-flux").catch(function(){return null;}),
        fetchData("donki-hss").catch(function(){return null;}),
        fetchData("imo-showers").catch(function(){return null;}),
        fetchSolarWindPlasma().catch(function(){return null;}),
        fetchData("swpc-kp-forecast").catch(function(){return null;}),
      ]).then(function(a) {
        return cacheSet(name, deriveConditions({
          bandsHf:   a[0], bandsVhf: a[1], ovation: a[2], drap: a[3], paths: a[4],
          kpNow:     a[5] ? a[5].kp : null,
          apNow:     a[5] ? a[5].ap : null,
          xrayClass: a[6] ? a[6].xrayClass : null,
          f107:      a[7] ? a[7].f107 : null,
          f107A:     a[7] ? a[7].f107A : null,
          giroFoF2:  a[8]  ? a[8].foF2 : null,
          giroHmF2:  a[8]  ? a[8].hmF2 : null,
          giroStations: a[8] && Array.isArray(a[8].stations) ? a[8].stations : [],
          dst:       a[9] ? a[9].dst : null,
          bzNow:        a[10] ? a[10].now : null,
          bzHistory:    a[10] ? a[10].history : null,
          kpHistory: a[11] ? a[11].history : null,
          protonFluxP1:   a[12] ? a[12].p1   : null,
          protonFluxP10:  a[12] ? a[12].p10  : null,
          protonFluxP100: a[12] ? a[12].p100 : null,
          donkiHss:  a[13],
          showers:   a[14],
          solarWindNow:     a[15] ? a[15].now : null,
          solarWindHistory: a[15] ? a[15].history : null,
          kpForecast:       a[16] ? a[16].forecast : null,
        }));
      });
    default:
      return Promise.reject(new Error("unknown data name: " + name));
  }
}
