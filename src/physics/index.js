// Aggregate physics module. Each per-domain submodule exports a slice
// of the public surface; this file merges them so consumers (derive,
// harness, scripts/*) keep importing from `src/physics/physics.js`
// without caring about which submodule owns each symbol.

export {
  refDistanceHfKm,
  hopsForDistance,
  hopCeilingKm,
  cgmLatAbs,
  dipLatitude,
  takeoffAngleDeg,
  solarCosZenith,
} from "./geometry.js";
export {
  currentQth,
  defaultQth,
  qthToLatLon,
  haversineKm,
  gcMidpoint,
  gcDestination,
  gcPointAtFraction,
} from "./qth.js";
export {
  L_IONO_HF_DB,
  L_IONO_ES_DB,
  L_IONO_AUR_DB,
  freeSpaceLossDb,
  lMufDb,
  lAbsDb,
  lLowBandExtraDb,
  lAbsDiurnalDb,
  lHopGroundReflectionDb,
  lMultiHopDb,
  lEsScreenDb,
  lAuroralDb,
  lPcaDb,
  lPcaOnsetDb,
  lFlareDb,
  pathIonoLosses,
  noiseDbm,
} from "./loss.js";
export {
  nightFloor,
  foF2Climatology,
  mufConsensus,
  pathMinMuf,
} from "./climatology.js";
export {
  STATION_FUSION_MAX_KM,
  STATION_FUSION_MAX_ES_KM,
  interpolateFoF2FromStations,
  perHopFoF2FromStations,
  interpolateFoEsFromStations,
  midpointFoF2WithFallback,
} from "./fusion.js";
export {
  SOURCES as FUSE_SOURCES,
  PRIOR_ERROR_MHZ as FUSE_PRIOR_ERROR_MHZ,
  buildFoF2Grid,
  giroToObservations,
  giroToEsObservations,
  tecGridToObservations,
  cosmicProfilesToObservations,
  computeFuseGrid,
  computeFuseEsGrid,
} from "./fuse.js";
export {
  invertOneSpot,
  wsprSpotsToObservations,
} from "./wspr-invert.js";
export {
  tepBonusDb,
  tepBonusMaxDb,
  nvisSecantFactor,
  nvisTailFactor,
  scatterBonusDb,
  irregularityRecoveryDb,
  heuristicTier,
  grayLineBonusDb,
  grayLineBonusPathDb,
} from "./modes.js";
export {
  REF_DISTANCE_KM_VHF,
  REF_POWER_DBM,
  SNR_REQUIRED_DB,
  antennaGainAtElevation,
  snrMarginHf,
  REF_DISTANCE_KM_HFES,
  snrMarginHfEs,
  snrMarginVhfEs,
  snrMarginVhfAurora,
  bandSigmaDb,
} from "./snr.js";
export {
  DEFAULT_SIGMA_DB,
  TIER_DB_EXCELLENT,
  TIER_DB_GOOD,
  TIER_DB_FAIR,
  TIER_DB_POOR,
  TIER_DX_MIN_KM,
  tierFromMargin,
  isDxOpen,
  tierRank,
  reliability,
  tierConfidence,
  tierStability,
} from "./tier.js";
