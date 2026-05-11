// DEFINITIONS - one entry per clickable label as it appears in the page.
// Each definition is specific to that metric/value rather than a broader
// concept, so e.g. "WSPR SNR" and "WSPR N/h" each get their own focused
// popover. Keys must match the label string passed to abbr() exactly.

import { _escAttr, _escHtml } from "./dom.js";
import { t } from "../i18n.js";

export const DEFINITIONS = {

  // ---- solar drivers (Drivers panel) ----
  "F10.7": {
    name: "F10.7 (Solar Flux Index)",
    def: "Solar radio flux at 2800 MHz, in solar flux units (1 sfu = 10\u207b\u00b2\u00b2 W m\u207b\u00b2 Hz\u207b\u00b9). The canonical input to ionospheric models. Range ~65 (solar minimum) to 300+ (very active). Higher = more F-region ionization = better HF, especially above 14 MHz. Older literature calls this SFI."
  },
  "SN (SILSO)": {
    name: "SN (Sunspot Number, SILSO)",
    def: "Daily provisional International Sunspot Number (EISN) from the SILSO World Data Center in Brussels. Counts visible sunspots weighted by group complexity. Tracks closely with F10.7 and conditions on the upper HF bands (10-15 m)."
  },
  "X-ray": {
    name: "X-ray flare class",
    def: "Current GOES XRS-B (0.1-0.8 nm) X-ray flux, classified by decade: A=10\u207b\u2078, B=10\u207b\u2077, C=10\u207b\u2076, M=10\u207b\u2075, X=10\u207b\u2074 W/m\u00b2. M and X class flares cause HF blackouts on the sunlit side within minutes (NOAA R-scale: M1\u2192R1, M5\u2192R2, X1\u2192R3, X10\u2192R4, X20\u2192R5)."
  },
  "Protons \u22651 MeV": {
    name: "Protons \u22651 MeV",
    def: "GOES integral flux of protons with E > 1 MeV, in pfu (proton flux units, particles cm\u207b\u00b2 s\u207b\u00b9 sr\u207b\u00b9). The lowest-energy GOES proton channel. Useful as a solar energetic particle (SEP) onset detector: \u22651 MeV typically rises ~1 hour before the canonical \u226510 MeV channel crosses the S1 threshold, giving early warning of polar-cap absorption events."
  },
  "Protons \u226510 MeV": {
    name: "Protons \u226510 MeV",
    def: "GOES integral flux of protons with E > 10 MeV, in pfu (proton flux units, particles cm\u207b\u00b2 s\u207b\u00b9 sr\u207b\u00b9). NOAA radiation-storm S-scale: S1 at 10 pfu, S2 at 100, S3 at 1000, S4 at 10\u2074, S5 at 10\u2075. Drives polar-cap absorption (PCA) on HF paths crossing the polar regions."
  },
  "Protons \u2265100 MeV": {
    name: "Protons \u2265100 MeV",
    def: "GOES integral flux of protons with E > 100 MeV, in pfu. Hard SEPs that penetrate deep into the D-region (down to ~30 km altitude) and produce the most severe transpolar HF blackouts. Quiet-sun background is well below 1 pfu; even 1 pfu is operationally significant. Also a radiation-dose driver for high-altitude flight crews."
  },
  "Electrons \u22652 MeV": {
    name: "Electrons \u22652 MeV",
    def: "GOES integral flux of energetic electrons above 2 MeV at GEO, in particles cm\u207b\u00b2 s\u207b\u00b9 sr\u207b\u00b9. Sustained values above 1000 indicate internal-charging risk for satellites in geostationary orbit."
  },

  // ---- geomag (Drivers panel) ----
  "Kp (3 h)": {
    name: "Kp (planetary K, 3-hour)",
    def: "Quasi-log 0-9 geomagnetic disturbance index, planetary average over 13 subauroral observatories, updated every 3 hours. 0-1 quiet, 2-3 unsettled, 4 active, 5+ storm. NOAA G-scale: Kp5\u2192G1 (minor) ... Kp9\u2192G5 (extreme). Higher Kp degrades HF, especially polar paths."
  },
  "Effective Kp": {
    name: "Effective Kp (composite, physics-internal)",
    def: "The composite Kp value the propagation physics actually consumes. Built from the instantaneous Kp plus three corrections: an exponentially-weighted lag kernel (the F-region keeps responding hours after Kp peaks), a Bz forward bump (sustained southward IMF at L1 leads the index by 30 to 60 min), and a Dst ring-current bump (intensification beyond what Kp alone captures). When this number exceeds the live Kp, the upper-HF verdicts are running ahead of the published index."
  },
  "Storm type": {
    name: "Storm type (CME shock vs HSS stream)",
    def: "Classification of the current geomagnetic disturbance source: CME (transient coronal mass ejection shock) or HSS (high-speed solar wind stream from a coronal hole). CME-driven storms typically have a faster recovery (~8 h decay timescale); HSS-driven storms decay more slowly (~24 h) because the stream keeps arriving for days. Determines how long the storm tail lingers in the propagation budget."
  },
  "Storm phase": {
    name: "Storm phase (Dst trajectory)",
    def: "Geomagnetic storm phase classified from Dst + Kp + storm-lag kernel: initial (sudden compression, Dst positive), main (Dst dropping rapidly toward minimum), recovery (Dst returning to zero while kpEffective trails kpNow), or active (between thresholds). HF behaviour over the next several hours follows directly: main-phase HF degrades fast on polar paths, recovery-phase upper HF lags."
  },
  "Hp30": {
    name: "Hp30 (30-min Kp equivalent)",
    def: "GFZ Potsdam high-cadence successor to Kp, published every 30 minutes since 2022. Same 0-9 scale and physics as Kp, but catches sub-storms that the slower 3-hour Kp averages out."
  },
  "Sym-H": {
    name: "Sym-H (1-min ring current)",
    def: "1-minute resolution equivalent of Dst from WDC Kyoto, in nT. Tracks ring-current intensity in real time. Negative values = storm main phase; below \u221250 nT = G1 storm, below \u2212100 nT = G2."
  },
  "AE": {
    name: "AE (auroral electrojet)",
    def: "1-min auroral electrojet index from WDC Kyoto (AE = AU \u2212 AL), derived from 12 northern-hemisphere magnetometers, in nT. Tracks substorm activity directly; jumps above 1000 nT during substorms."
  },

  // ---- DSCOVR / solar wind ----
  "Bz": {
    name: "Bz (IMF southward component)",
    def: "North-south component of the interplanetary magnetic field at L1 (~1 h upstream of Earth), in nT. Sustained Bz < \u22125 nT is the empirical storm trigger: the magnetosphere opens, energy couples in, geomagnetic storms begin. Best near-real-time storm predictor we have."
  },
  "Bt": {
    name: "Bt (IMF total magnitude)",
    def: "Total interplanetary magnetic field magnitude at L1, in nT. Combined with Bz, tells you how strong the field is and how much of it is southward (geoeffective)."
  },
  "Speed": {
    name: "Vsw (solar wind bulk speed)",
    def: "Solar wind speed at L1, in km/s. Quiet ~350; coronal-hole high-speed streams 500-800; CME shocks can exceed 1000 km/s."
  },
  "Density": {
    name: "Nsw (solar wind proton density)",
    def: "Solar wind proton density at L1, in particles/cm\u00b3. Quiet ~5; elevated values in slow streams and CME sheaths. Density and speed together set the dynamic pressure on the magnetosphere."
  },
  "Pdyn": {
    name: "P_dyn (solar wind dynamic pressure)",
    def: "Solar wind ram pressure at L1, in nPa. P_dyn = m_p \u00d7 n \u00d7 V\u00b2 \u2248 1.6726\u00d710\u207b\u2076 \u00d7 n \u00d7 V\u00b2. Drives magnetopause compression: typical values 1-3 nPa, > 5 nPa moves the magnetopause inside ~7 R_E, > 10 nPa pushes it inside geosynchronous orbit. CME shock arrivals show as sudden P_dyn jumps."
  },

  // ---- iono panel: digisonde ----
  "foF2": {
    name: "foF2 (F2 critical frequency)",
    def: "Highest frequency reflected at vertical incidence from the F2 layer over the digisonde, in MHz. The hard ceiling for NVIS. Multiply by M(3000)F2 (~3) to estimate the 3000 km path MUF."
  },
  "foE": {
    name: "foE (E-layer critical frequency)",
    def: "Critical frequency of the regular E layer (~110 km altitude), in MHz. Daytime only; rises and falls smoothly with the solar zenith angle. Sets the floor for E-layer absorption on lower HF."
  },
  "foEs": {
    name: "foEs (sporadic-E critical frequency)",
    def: "Critical frequency of sporadic-E patches (thin, dense, transient ionization in the E region), in MHz. > 5 MHz can support 10 m hops; > 8 MHz supports 6 m Es; > 25 MHz needed for 2 m Es."
  },
  "hmF2": {
    name: "hmF2 (F2 peak height)",
    def: "Peak height of the F2 layer over the digisonde, in km. Sets the geometry of the hop: higher hmF2 means longer single-hop distances at the same MUF."
  },
  "M(3000)F2": {
    name: "M(3000)F2 (obliquity factor)",
    def: "Obliquity factor from the digisonde ionogram for a 3000 km hop. Multiply foF2 by M(3000)F2 to get MUF(3000)F2. Typically 2.8-3.3 depending on hmF2."
  },
  "MUF(3000)F2": {
    name: "MUF(3000)F2 (digisonde MUF)",
    def: "Maximum usable frequency for a 3000 km hop, computed directly from the local digisonde ionogram as foF2 \u00d7 M(3000)F2. Ground truth for the nearest path; produced by ARTIST-5 autoscaling."
  },

  // ---- iono panel: TEC ----
  "vTEC": {
    name: "vTEC (vertical Total Electron Content)",
    def: "Total electrons in a vertical column through the ionosphere over the QTH, in TECU (10\u00b9\u2076 e\u207b/m\u00b2). Higher = denser ionosphere = higher MUF. Sourced from the kc2g GNSS network."
  },
  "ROTI": {
    name: "ROTI (Rate-of-TEC index)",
    def: "15-minute standard deviation of dTEC/dt, in TECU/min. Above ~1 indicates ionospheric scintillation that fades HF, GNSS, and trans-ionospheric signals."
  },
  "S4": {
    name: "S4 (amplitude scintillation index)",
    def: "GNSS amplitude scintillation index, dimensionless 0-1. Above 0.5 = significant scintillation, i.e. rapid signal fading on satellite and trans-ionospheric links."
  },

  // ---- path table ----
  "MUF(3000)": {
    name: "MUF(3000) (modeled, kc2g)",
    def: "Maximum usable frequency for a 3000 km hop along this path, in MHz, sampled from the kc2g IRI-assimilated MUF grid. Above this frequency, signals pass into space rather than refract back. Modeled, not measured; see MUF(3000)F2 for the nearest digisonde value."
  },
  "foF2 mid": {
    name: "foF2 at path midpoint",
    def: "F2 critical frequency at the midpoint of this path, in MHz, sampled from the kc2g grid. Drives the modeled MUF for the path."
  },

  // ---- tier verdict cell values (band table) ----
  "excellent": {
    name: "excellent (top tier)",
    def: "Reliability ≥ 95 %: the configured station's achieved SNR clears the mode's required SNR essentially every attempt. Wall-to-wall S9+ signals; QSOs complete on the first call. Threshold scales with each band's prediction sigma."
  },
  "good": {
    name: "good (high tier)",
    def: "Reliability ≥ 80 %: about 4 of 5 attempts complete a QSO at the configured station. Strong, comfortable signals; ragchews and DX both viable. Threshold scales with each band's prediction sigma."
  },
  "fair": {
    name: "fair (middle tier)",
    def: "Reliability ≥ 50 %: roughly half-and-half. Ordinary contacts work but require patience; weak DX and digital modes succeed where SSB struggles. The center of the verdict scale."
  },
  "poor": {
    name: "poor (low tier)",
    def: "Reliability ≥ 20 %: the band is alive but signals are weak. FT8 and WSPR will get through, SSB intermittent. Operator can make contacts with effort and persistence."
  },
  "closed": {
    name: "closed (band effectively dead)",
    def: "Reliability < 20 %: at the configured station, almost no attempt completes a QSO. Could be over-MUF, blocked by D-region absorption, or below the noise floor. May still produce isolated WSPR spots from extreme stations."
  },

  // ---- DX flag (band table, rendered next to the tier) ----
  "DX": {
    name: "DX (long-path reach)",
    def: "The band-table's Excellent tier means \"the loudest path on this band has plenty of margin\"; the DX badge says \"that loud path is at least 6000 km long, so continent-crossing DX is open\". Excellent without DX means the band is loud regionally (one or two short F2 hops) but the long-path reach isn't there. DX without the badge isn't impossible -- weaker paths can still work -- but the badge marks where the model expects DX to be easy."
  },

  // ---- propagation mode cell values (band table) ----
  "F2": {
    name: "F2 (F-region skywave)",
    def: "Ordinary HF skywave propagation: refraction off the F2 layer (~300 km altitude). The dominant DX mode on 30-10 m. Limited by the maximum usable frequency (MUF), which depends on solar activity, time of day, and path geometry."
  },
  "NVIS": {
    name: "NVIS (Near-Vertical Incidence Skywave)",
    def: "Steep-angle skywave on the low bands (40 m and below) for short paths (under 500 km). Signal goes nearly straight up, refracts off the F2 (or E) layer, and comes nearly straight down. Fills the skip zone where ground wave fades and oblique skywave overshoots."
  },
  "Es": {
    name: "Es (sporadic-E)",
    def: "Single-hop refraction off thin, dense, transient ionization in the E layer (~110 km altitude). Active when foEs is high; supports 10-50 MHz hops over typical distances of 1000-2000 km. Onset and ending are sudden; openings last minutes to hours."
  },
  "TEP": {
    name: "TEP (trans-equatorial F2 scatter)",
    def: "Cross-equatorial chordal propagation off F-region irregularities. Active on 14-60 MHz when both endpoints sit on opposite sides of the magnetic dip equator with |dipLat| ≥ 10°, and the path midpoint local time is in 17:00-23:00 (afternoon to evening). Bonus magnitude scales with solar cycle: peak openings reach 15+ dB recovery, moderate cycle is 8-12 dB. Sporadic in nature, works for 1-3 hour evening windows, not all day."
  },
  "Scatter": {
    name: "Scatter (F2 above-MUF recovery)",
    def: "F-region irregularity scatter brings signals through above the standard MUF. Fires when the band is above the climatological MUF AND foF2 varies meaningfully across hops (heterogeneous path). Intensity scales with above-MUF excess and foF2 spread; saturates at ~15 dB recovery. Less reliable than F2; gives a partial recovery rather than full."
  },
  "GL": {
    name: "GL (gray-line)",
    def: "D-region attenuation drops sharply at the terminator (sunrise / sunset line); low-band paths that include the terminator at the path midpoint see a brief absorption-window opening. Active on bands ≤ 14 MHz when the path midpoint is within ~6° of zenith-grazing solar angle. Lasts 30-60 minutes per terminator crossing. Most useful for 80m and 40m DX morning / evening windows."
  },
  "Aurora": {
    name: "Aurora (auroral-E scatter)",
    def: "VHF signals scatter off the disturbed auroral E region during geomagnetic storms (Kp ≥ 5). Characteristic raspy / distorted CW note from Doppler smearing. Only viable on 6 m and 2 m at high latitudes; SSB barely intelligible."
  },
  "MS": {
    name: "MS (meteor scatter)",
    def: "Forward scatter off the ionization trails left by meteors entering the upper atmosphere (~85-105 km). Bursts last fractions of a second to several seconds; sustained QSOs require digital modes (MSK144, FSK441). Productive on 6 m and 2 m, especially during major showers."
  },
  "EME": {
    name: "EME (Earth-Moon-Earth)",
    def: "Bouncing signals off the Moon for ultra-DX VHF/UHF contacts. Path loss is ~250 dB total; needs high power, large antennas, and digital modes (Q65, JT65). Always available when both stations see the Moon, independent of ionosphere."
  },
  "MS only": {
    name: "MS only (meteor scatter as last resort)",
    def: "On a VHF band where Es and aurora are both absent, meteor scatter is the only ionospheric mode left. Bursty, requires digital, but works year-round (background ~10 meteors/h, much higher during showers). Tropospheric ducting may also help line-of-sight extension."
  },
  "EME only": {
    name: "EME only (Earth-Moon-Earth as last resort)",
    def: "On 2 m and above when no ionospheric mode is open, EME (Moon bounce) remains the only true skywave option. Tropospheric ducting may also extend line-of-sight contacts. Both require effort and equipment well above casual."
  },

  // ---- band table: shared prediction columns (HF + VHF) ----
  "Band": {
    name: "Band (amateur radio band)",
    def: "Amateur radio band by wavelength: 160 m at 1.8 MHz down to 2 m at 144 MHz. Each band has its own propagation character: low bands (160-40 m) for night and short-skip, mid bands (30-20 m) for steady DX, upper bands (17-10 m) for solar-cycle DX, VHF (6 m / 2 m) for line-of-sight + Es / aurora / meteor scatter."
  },
  "f (MHz)": {
    name: "f (band reference frequency)",
    def: "The reference frequency in MHz used by the propagation budget for this band. Anchored at the typical digital-mode segment (e.g. 14.097 for 20 m FT8) so the SNR computation reflects where most operators actually transmit. Different exact frequencies on the same band see almost identical propagation."
  },
  "Tier": {
    name: "Tier (verdict bucket)",
    def: "Five-level operator-facing verdict for this band: excellent, good, fair, poor, or closed. The bucket is an ITU-R P.842 circuit-reliability bucket: excellent ≥ 95 %, good ≥ 80 %, fair ≥ 50 %, poor ≥ 20 %, closed < 20 %, where reliability is the probability the achieved SNR clears the mode's required SNR for the configured station."
  },
  "Margin": {
    name: "Margin (SNR budget margin)",
    def: "Achieved SNR minus required SNR, in dB, for the configured station on the best-margin reference path. Positive = comfortable, zero = at the decoder threshold, negative = below threshold. The tier converts this into a reliability bucket via the per-band sigma; the same margin can yield different tiers depending on path uncertainty."
  },
  "Stability": {
    name: "Stability (verdict stability)",
    def: "How likely the Tier label is to stay put if the true margin moves to its expected value. Computed as Φ(σ-distance to the nearest tier boundary). 50% means the prediction sits right on a tier boundary and a small shift in conditions would flip the verdict; 84% means 1σ inside the bucket (the verdict has comfortable margin from either neighbouring tier); ≥97% means 2σ inside (essentially locked-in). Bucket-width-independent: a centred Fair verdict reads the same as a centred Excellent verdict if both sit equally far from their nearest boundary. A high Stability does not mean the band is open, that's what Tier says, it means the Tier label itself is unlikely to change."
  },
  "Mode": {
    name: "Mode (winning propagation mechanism)",
    def: "The propagation mechanism that produces the highest margin on this band: F2 for ordinary skywave, NVIS for short low-band paths, Es for sporadic-E (single 2000 km hop off the E layer), Aurora for VHF auroral-E scatter, MS for meteor scatter. The model evaluates each mode in parallel and the winner drives the verdict."
  },
  "Best Path": {
    name: "Best Path (highest-margin direction)",
    def: "Of the 72 paths sampled around your QTH (12 compass bearings × 6 distance rings: 2500 / 4000 / 6000 / 9000 / 12000 / 16000 km), the one with the highest predicted SNR margin on this band, labelled by compass direction and distance. The distance is shown in megametres (1 Mm = 1000 km, so 9.0 Mm = 9000 km), more compact than \"9000 km\" in a narrow column. Tells you which way to point and how far you can usefully reach: the band is most viable in that direction right now. Sub-2500 km contacts (NVIS) are handled separately, not in this basket."
  },

  // ---- band table: HF ----
  "foEs (MHz)": {
    name: "foEs (sporadic-E critical frequency, MHz)",
    def: "Critical frequency of sporadic-E patches at the nearest digisonde, in MHz; same quantity as foEs in the ionosphere panel. > 5 MHz can support 10 m hops, > 8 MHz supports 6 m Es, > 25 MHz needed for 2 m Es. Sporadic-E is short-lived (minutes to hours) and short-skip (typical single hop ~2000 km)."
  },
  "WSPR SNR": {
    name: "WSPR SNR (median, last 60 min)",
    def: "Median signal-to-noise ratio of WSPR spots received on this band over the last hour, in dB on a 2.5 kHz noise reference. Higher = the band is delivering stronger signals right now."
  },
  "WSPR N/h": {
    name: "WSPR spot count (last 60 min)",
    def: "Number of WSPR spots received on this band in the last 60 minutes. A direct activity proxy: more spots = more stations getting through to receivers worldwide. Doesn't measure SNR, just whether the band is alive."
  },
  "z 27-d": {
    name: "z 27-d (27-day z-score)",
    def: "Z-score of the current value vs its 27-day rolling baseline (one solar rotation): (x \u2212 mean) / stddev. Positive = unusually active for this point in the rotation; negative = unusually quiet. Strips out the slow Carrington-rotation trend so you can see today's anomaly."
  },
  "f/MUF": {
    name: "f/MUF (band freq \u00f7 path MUF)",
    def: "Band frequency divided by the modeled path MUF. < 0.85 stable (FOT region); 0.85-1.0 marginal/near-MUF; > 1.0 above MUF, meaning no F2 support on this path. ITU-R P.533 defines FOT = 0.85 \u00d7 MUF."
  },
  "D-RAP": {
    name: "D-RAP (D-region absorption flag)",
    def: "SWPC D-Region Absorption Prediction for this band frequency. Flagged here when modeled absorption \u2265 1 dB, i.e. the D-layer is eating signal before it can reach the reflective F-layer above. Caused by solar X-ray flares and proton events."
  },

  // ---- band table: VHF ----
  "Es MUF/f": {
    name: "Es MUF / band frequency",
    def: "Sporadic-E MUF divided by the band frequency. \u2265 1 means an Es opening is supported on this band. Es openings are typically 50-144 MHz, brief (minutes to hours), and short-skip (~2000 km single hop)."
  },
  "Aurora HP": {
    name: "Aurora hemispheric power",
    def: "OVATION Prime-derived auroral hemispheric power proxy, in GW. \u2265 50 GW = aurora-E propagation possible on VHF (signals scatter off the auroral E region; characteristic raspy CW note)."
  },
  "MS rate": {
    name: "MS rate (meteor scatter, /h)",
    def: "Estimated meteor scatter rate, meteors per hour. Background ~10/h from sporadic meteors; major showers (Perseids, Geminids, Leonids) reach 100+/h. Productive on 6 m and 2 m via short-burst forward scatter off ionization trails."
  },
  "Tropo dN/dh": {
    name: "Tropo dN/dh (refractivity gradient)",
    def: "Refractivity gradient across the lowest 1 km of the nearest radiosonde sounding, in N-units per km. The same metric the ducting table below classifies on: dN/dh > \u221279 is standard atmosphere, \u221279 to \u2212157 super-refractive (extended VHF range), below \u2212157 a duct forms (signals trapped in a waveguide). Both 6 m and 2 m share this cell because the gradient is per-station, not per-band."
  },

  // ---- ducting table (VHF section) ----
  "Station": {
    name: "Station (radiosonde site)",
    def: "World Meteorological Organization 5-digit station number plus a place name, identifying the radiosonde site whose sounding produced this row. The University of Wyoming archive is hit once per station; failed rows mean that site did not release a sounding for the current 00 Z or 12 Z slot."
  },
  "Region": {
    name: "Region (Wyoming archive bucket)",
    def: "The continental sub-archive Wyoming groups this station under (europe, naconf for North America, samer for South America, africa, seasia for South / Southeast Asia and the southwest Pacific, ant for Antarctica). Carried for at-a-glance geography; ionocast hits the per-region URL for each station."
  },
  "Surface N": {
    name: "Surface N (refractivity at the surface)",
    def: "Atmospheric refractivity N at the lowest sounding sample, computed from temperature, pressure, and water-vapor pressure: N = 77.6 / T_K \u00b7 (P_mbar + 4810 \u00b7 e_mbar / T_K). Typical sea-level values are 280-320 N-units; the absolute level matters less than how fast it falls with height (dN/dh)."
  },
  "dN/dh (N/km)": {
    name: "dN/dh (refractivity gradient)",
    def: "Refractivity gradient across the lowest 1 km of the sounding, in N-units per km. dN/dh > \u221279 is standard atmosphere; \u221279 to \u2212157 super-refractive (signals bend more strongly than line-of-sight); below \u2212157 a duct forms (signals are trapped in a waveguide). The \u2212157 threshold comes from modified-refractivity theory: dM/dz = dN/dz + 0.157 N/m, so a duct exists when dM/dz < 0."
  },
  "Status": {
    name: "Status (ducting classification)",
    def: "ITU-R P.453 / NTIA classification of the lowest-1-km gradient: standard (no enhancement), super-refractive (extended VHF range), or ducting (waveguide traps signal over 100s to 1000s of km). Values below the column come from this row's dN/dh."
  },
  "ducting": {
    name: "ducting (dN/dh < \u2212157 N/km)",
    def: "A surface-based or elevated atmospheric duct exists in the lowest 1 km: a sufficiently strong temperature inversion or moisture lapse produces a layer where dM/dz < 0, trapping VHF/UHF signals into a horizontal waveguide. Operationally: 6 m and 2 m stations sharing the duct can work each other over hundreds to thousands of km independent of ionospheric propagation."
  },
  "super-refractive": {
    name: "super-refractive (\u221279 to \u2212157 N/km)",
    def: "The lowest 1 km bends radio rays downward more than a standard atmosphere but not enough to trap them. Typical effects: the radio horizon extends past the geometric horizon, and tropospheric scatter paths run noticeably above their fair-weather budget. Common precursor to ducting; watch for the gradient steepening further."
  },
  "standard": {
    name: "standard atmosphere (no ducting enhancement)",
    def: "The lowest 1 km has a refractivity gradient between roughly \u221279 and 0 N/km, the normal mid-latitude state. Radio rays bend gently toward Earth (the standard 4/3 effective Earth radius), but no duct or significant range extension. Default condition outside of marine inversions and warm-season stratification events."
  },

  // ---- alert pill severity tiers (clickable from every pill on
  //      both stacks) ----
  "INFO": {
    name: "INFO (gray pill, lowest tier)",
    def: "Informational alert. Either a SWPC summary / forecast / advisory bulletin (event recap, scheduled outlook, operational note) or a soft alert flagging a context-relevant condition (storm recovery still loading the F-region, mild forecast σ inflation). Color is gray; no immediate operational impact."
  },
  "WATCH": {
    name: "WATCH (yellow pill, event likely)",
    def: "Watch tier. An event is expected or a leading indicator has crossed its threshold (substorm-precursor Bz, G1-onset Kp, S1 protons, M-class flare, Dst ≤ −50 nT, mid-strength HSS). Plan around the expected window; degradation is likely but not yet at full strength."
  },
  "ALERT": {
    name: "ALERT (red pill, event in progress)",
    def: "Alert tier. A threshold has been crossed and HF impact is active right now: M5+/X1+ flares (R2/R3), Kp 6-7 (G2/G3), Dst ≤ −100 nT, S2/S3 proton events, strong HSS, geomagnetic storm main phase, D-RAP ≥ 10 MHz at QTH. Expect active HF degradation on affected paths."
  },
  "EXTREME": {
    name: "EXTREME (deep red pill, top-tier severity)",
    def: "Extreme tier. The most severe end of the NOAA scales: R4-R5 X-ray flares (X10+), G4-G5 geomagnetic storms (Kp 8-9), S4-S5 radiation storms (≥ 10 000 pfu), or Dst ≤ −250 nT ring-current intensification. Operationally: widespread HF blackouts persisting hours-to-days, transpolar paths closed, low bands degraded, auroral oval expanded to mid-latitudes."
  },

  // ---- SWPC topic pills (parsed from Space Weather Message Code) ----
  "RADIO": {
    name: "RADIO (Type II / IV solar radio sweep)",
    def: "SWPC bulletin for a Type II or Type IV radio emission. A radio fingerprint of a coronal shock outpacing the solar wind (Type II almost always means a CME is on the way) or a long-duration energetic-electron source (Type IV). Operationally a heads-up to watch for proton events and CME arrival in 1 to 4 days."
  },
  "M-FLR": {
    name: "M-FLR (M-class X-ray flare)",
    def: "SWPC bulletin for an M-class solar X-ray flare. M1-M4.9 = NOAA R1; M5-M9.9 = R2. Causes minor-to-moderate HF blackouts on the sunlit hemisphere lasting tens of minutes; D-region absorption decays with the X-ray flux."
  },
  "X-FLR": {
    name: "X-FLR (X-class X-ray flare)",
    def: "SWPC bulletin for an X-class solar X-ray flare. X1-X9.9 = NOAA R3; X10+ = R4-R5. Wide-area HF blackout on the sunlit side for ~1 h; the largest events can degrade HF for days and trigger proton events at Earth within hours."
  },
  "KP": {
    name: "KP (planetary K-index alert)",
    def: "SWPC bulletin for a planetary Kp alert or warning. Codes K04-K09 indicate Kp 4 (active) up to Kp 9 (extreme). Maps to the NOAA G-scale: Kp 5 = G1, Kp 9 = G5. Higher Kp means HF degradation widens equatorward and the auroral oval expands."
  },
  "GSTM": {
    name: "GSTM (geomagnetic storm watch)",
    def: "SWPC watch bulletin for an upcoming geomagnetic storm, typically issued from a CME arrival forecast or an HSS interface prediction. Codes A50 / A70 correspond to G3 / G4 watches. Plan operations: HF on polar paths will fade and the auroral oval will expand."
  },
  "PROT": {
    name: "PROT (proton flux event)",
    def: "SWPC bulletin for an integral solar proton flux threshold crossing. PX1 = ≥ 1 MeV, PX10 = ≥ 10 MeV (this is the S-scale anchor: 10 pfu = S1), PX100 = ≥ 100 MeV. The ≥ 10 MeV channel drives polar-cap absorption, any HF path crossing above ~ 60 ° magnetic latitude is closed."
  },
  "PCA": {
    name: "PCA (polar cap absorption)",
    def: "SWPC bulletin for a polar-cap absorption event. Solar protons ionize the D-region inside the polar cap, producing severe HF absorption on any path that crosses above ~ 60 ° magnetic latitude. Can persist hours to days. Code prefix PC."
  },
  "ELEC": {
    name: "ELEC (energetic-electron flux)",
    def: "SWPC bulletin for energetic-electron flux ≥ 2 MeV at GEO sustained above the EF3 threshold. An internal-charging risk for satellites in geostationary orbit; not directly an HF concern, but a useful sustained-disturbance indicator since electron events trail major storms by 1 to 3 days."
  },
  "10CM": {
    name: "10CM (10 cm radio burst)",
    def: "SWPC bulletin for a 10.7 cm (2800 MHz) solar radio burst. Often pairs with M-class flares. Operationally a marker that the emitting region is energetically active; not directly an HF concern, but a useful concurrent flare indicator since the burst arrives within minutes of the flare peak."
  },

  // ---- soft-alert labels: NOAA scales (R / S / G) ----
  "R1": {
    name: "R1 (minor radio blackout)",
    def: "NOAA R-scale, minor tier (M1-M4.9 X-ray flare). Sunlit-side HF degraded for ~tens of minutes; navigation and satellite data flow can briefly drop. Several events per month at solar maximum."
  },
  "R2": {
    name: "R2 (moderate radio blackout)",
    def: "NOAA R-scale, moderate tier (M5-M9.9 X-ray flare). Wider-area HF blackouts on sunlit side; ~1 h recovery typical. Tens of events per year at solar maximum."
  },
  "R3": {
    name: "R3 (strong radio blackout)",
    def: "NOAA R-scale, strong tier (X1-X9.9 X-ray flare). Wide-area HF blackout on sunlit side for ~1 h; satellite navigation impaired for hours. ~10 events per year at solar maximum."
  },
  "R4": {
    name: "R4 (severe radio blackout)",
    def: "NOAA R-scale, severe tier (X10-X19.9 X-ray flare). HF radio blackout on most of the sunlit side for 1 to 2 h; navigation widely degraded. Rare, about 8 events per 11-year solar cycle."
  },
  "R5": {
    name: "R5 (extreme radio blackout)",
    def: "NOAA R-scale, extreme tier (X20+ X-ray flare). Complete HF blackout on entire sunlit side for hours; navigation outages 1+ day. Less than 1 event per solar cycle on average."
  },
  "G1": {
    name: "G1 (minor geomagnetic storm)",
    def: "NOAA G-scale, minor tier (Kp = 5). Weak power-grid fluctuations at high latitudes; HF fade on polar paths; aurora visible at high latitudes."
  },
  "G2": {
    name: "G2 (moderate geomagnetic storm)",
    def: "NOAA G-scale, moderate tier (Kp = 6). HF propagation can fade at higher latitudes; aurora visible to mid-latitudes."
  },
  "G3": {
    name: "G3 (strong geomagnetic storm)",
    def: "NOAA G-scale, strong tier (Kp = 7). Intermittent HF radio problems; surface charging on satellites; aurora visible to lower mid-latitudes."
  },
  "G4": {
    name: "G4 (severe geomagnetic storm)",
    def: "NOAA G-scale, severe tier (Kp = 8). Sporadic HF radio propagation; extensive surface charging; aurora visible to low latitudes."
  },
  "G5": {
    name: "G5 (extreme geomagnetic storm)",
    def: "NOAA G-scale, extreme tier (Kp = 9). HF radio may be impossible in many areas for 1 to 2 days; aurora visible as far as equatorial latitudes."
  },
  "S1": {
    name: "S1 (minor radiation storm)",
    def: "NOAA S-scale, minor tier (≥ 10 MeV proton flux ≥ 10 pfu). Polar-cap absorption building; HF on transpolar paths degrades. ~50 events per solar cycle."
  },
  "S2": {
    name: "S2 (moderate radiation storm)",
    def: "NOAA S-scale, moderate tier (≥ 100 pfu). Polar-cap absorption active; transpolar HF paths typically closed. ~25 events per solar cycle."
  },
  "S3": {
    name: "S3 (strong radiation storm)",
    def: "NOAA S-scale, strong tier (≥ 1 000 pfu). Strong polar-cap absorption; transpolar HF blacked out for hours-to-days. ~10 events per solar cycle."
  },
  "S4": {
    name: "S4 (severe radiation storm)",
    def: "NOAA S-scale, severe tier (≥ 10 000 pfu). Severe polar-cap absorption; transpolar HF blacked out for days; satellite operations impacted. ~3 events per solar cycle."
  },
  "S5": {
    name: "S5 (extreme radiation storm)",
    def: "NOAA S-scale, extreme tier (≥ 100 000 pfu). Extreme polar-cap absorption; transpolar HF blacked out for the duration of the event. Less than 1 event per solar cycle on average."
  },

  // ---- soft-alert topic labels (no NOAA scale match) ----
  "BZ": {
    name: "BZ (southward IMF)",
    def: "Soft alert: the north-south component of the interplanetary magnetic field at L1 is strongly negative. Sustained Bz < −5 nT opens the magnetosphere to solar-wind energy and is the empirical trigger for substorms and geomagnetic storms; Bz ≤ −10 nT typically precedes a substorm by minutes."
  },
  "DST": {
    name: "DST (ring-current disturbance)",
    def: "Soft alert: Sym-H (1-minute Dst equivalent) shows ring-current intensification. Dst ≤ −50 nT corresponds to G1 onset, ≤ −100 nT to G2, ≤ −250 nT to G4. Severity is carried by the pill color (watch / alert / extreme); the body shows the actual Dst value."
  },
  "AURORA": {
    name: "AURORA (auroral hemispheric power elevated)",
    def: "Soft alert: OVATION hemispheric-power proxy is elevated. ≥ 50 GW supports 6 m aurora-E at high latitudes; ≥ 100 GW opens VHF aurora propagation more broadly. Signals scatter off the auroral E region with characteristic raspy tones."
  },
  "D-RAP": {
    name: "D-RAP (D-region absorption at QTH)",
    def: "Soft alert: SWPC D-Region Absorption Prediction model shows the highest absorbed frequency at your QTH is elevated. ≥ 5 MHz degrades low-HF (40 m / 80 m / 160 m); ≥ 10 MHz is a local HF blackout. Caused by solar X-ray flares or proton events."
  },
  "RECOV": {
    name: "RECOV (storm recovery, ionosphere lagging)",
    def: "Soft alert: the exponentially-weighted effective Kp (peaked 2 h in the past, 8 h decay) is substantially higher than the instantaneous Kp. The geomagnetic field has relaxed but the F-region is still catching up, so upper-HF verdicts trail the published Kp by hours. Transient; clears as the kernel decays."
  },
  "STORM": {
    name: "STORM (geomagnetic storm main phase)",
    def: "Soft alert: a deep Dst depression (≤ −50 nT) is loading the storm-lag kernel. The F-region is in active main-phase suppression: MUF drops 5 to 30 % at midlatitudes, more at high latitudes; absorption rises; auroral oval expands. Distinct from RECOV (recovery) and from the per-Kp G-pills (severity by index value)."
  },
  "HSS": {
    name: "HSS (high-speed solar-wind stream arrival)",
    def: "Soft alert: solar-wind speed at L1 sustained ≥ 600 km/s without sharply negative Bz signals a corotating-stream interaction (HSS / CIR), not a CME shock. HSS storms are mild-Dst but long-tail (24+ h recovery). Operator effect: 10/12 m get worse, 17/20 m unsettled, low bands often quiet down. ≥ 800 km/s escalates to alert level."
  },
  "FCAST": {
    name: "FCAST (sigma inflated by upcoming disturbance)",
    def: "Soft alert: the SWPC 3-day Kp forecast contains disturbed slots in the next 6 to 12 h, which the model translates into widened tier-prediction uncertainty (forecast σ). Verdicts on upper bands soften: a borderline 'good' becomes more like 'good with caveat'. Use this when planning a sked or contest window."
  },
  // ---- Outlook panel: solar regions, CMEs, showers, 27-day -----------
  "AR": {
    name: "AR (NOAA active region number)",
    def: "NOAA-assigned 4-digit number for a sunspot group. Numbering is monotonic across cycles (does not reset). Used by SWPC to track an individual region's flare history and report its M-class / X-class probabilities."
  },
  "Alpha": {
    name: "Alpha (Hale magnetic class)",
    def: "Hale magnetic classification for a sunspot group with a single dominant magnetic polarity. Smallest and quietest configuration; near-zero flare probability."
  },
  "Beta": {
    name: "Beta (Hale magnetic class)",
    def: "Hale magnetic classification for a sunspot group with two distinct opposite-polarity regions cleanly separated. Common configuration; modest flare risk (typically C-class, occasional M)."
  },
  "Beta-Gamma": {
    name: "Beta-Gamma (Hale magnetic class)",
    def: "Hale magnetic classification for a sunspot group with two opposite polarities but irregular intermixing along the polarity inversion line. Stronger flare risk; M-class flares likely, X-class possible."
  },
  "Beta-Gamma-Delta": {
    name: "Beta-Gamma-Delta (Hale magnetic class)",
    def: "Hale magnetic classification for the most complex configuration: opposite polarities sharing a single penumbra (delta), intermixed (gamma), within a generally bipolar region (beta). High X-class flare probability; the regions that produce the most extreme flares typically carry this classification."
  },
  "ZHR": {
    name: "ZHR (Zenith Hourly Rate)",
    def: "Number of meteors a single observer would see per hour at peak shower activity, with the radiant directly overhead and a clear sky to magnitude 6.5. ionocast uses ZHR ≥ 20 as the threshold for upgrading the VHF meteor-scatter floor on 6 m / 2 m during the predawn window."
  },
  "halfAngle": {
    name: "halfAngle (CME angular half-width)",
    def: "Angular half-width of a coronal mass ejection as fit from coronagraph imagery. A 30° halfAngle CME spans 60° of sky and is more likely to be Earth-directed; very narrow CMEs (< 15°) typically miss Earth. Reported by CCMC's WSA-ENLIL+Cone fit on each DONKI entry."
  },
  "no impact study": {
    name: "no impact study (CME)",
    def: "CCMC has not yet run a magnetospheric-impact simulation for this CME. Either the event is too recent (impact studies typically post within hours of detection) or the CME is judged not Earth-directed enough to warrant the run. Without an impact study, no Kp peak or arrival time prediction is available."
  },
  "Kp peak": {
    name: "Kp peak (CME impact study)",
    def: "Predicted peak Kp value the CME is expected to drive at Earth, from the CCMC WSA-ENLIL+Cone simulation attached to the DONKI entry. Quotes only what the model produced; uncertainty is wide (typically ±1 Kp) and arrival timing has ±6-8 h spread."
  },
  "active": {
    name: "active (meteor shower phase)",
    def: "Meteor shower is within ±2 days of the IMO catalog peak. ionocast applies the meteor-scatter floor lift on 6 m / 2 m during this phase."
  },
  "building": {
    name: "building (meteor shower phase)",
    def: "Meteor shower is on the leading edge of its activity envelope per the IMO calendar (a few days before the active window). Floor lift fires in this phase too because the catalogued ZHR rises smoothly into peak."
  },
  "fading": {
    name: "fading (meteor shower phase)",
    def: "Meteor shower is on the trailing edge of its activity envelope per the IMO calendar (a few days past peak). The ZHR is dropping back toward background; ionocast does not apply the floor lift in this phase."
  },
  "SFI": {
    name: "SFI (Solar Flux Index, equivalent to F10.7)",
    def: "Solar 10.7 cm radio flux in solar flux units, identical to F10.7. Older amateur-radio literature uses ‘SFI’; modern ionospheric models use ‘F10.7’. The 27-day outlook reports daily predicted SFI from the ISES weekly product."
  },
  "Ap": {
    name: "Ap (planetary daily geomagnetic index)",
    def: "Daily geomagnetic activity index, computed from the eight 3-hour Kp values of the day converted to a linear-scale ap and averaged. Range: 0-7 quiet, 8-15 unsettled, 16-29 active, 30+ storm. Used in the 27-day outlook as the slow-tracker analogue of Kp."
  },

  // ---- prob-table row labels (NOAA R/S/G scales, 3-day forecast) ----
  "R1-R2 blackout": {
    name: "R1-R2 radio blackout probability",
    def: "Probability of a minor-to-moderate HF radio blackout over the forecast window. R1 = M1 flare (minor blackout on sunlit side for tens of minutes); R2 = M5 flare (moderate, wider-area degradation)."
  },
  "R3+ blackout": {
    name: "R3+ radio blackout probability",
    def: "Probability of a strong-or-greater HF radio blackout. R3 = X1 flare (wide-area HF blackout for about an hour on sunlit side); R4 = X10; R5 = X20 with days of HF disruption."
  },
  "S1+ radiation": {
    name: "S1+ radiation storm probability",
    def: "Probability of a solar radiation storm at S1 or higher. Driven by solar energetic protons reaching Earth; degrades HF on polar paths via polar-cap absorption. Thresholds: S1 at 10 pfu (≥10 MeV), rising by factors of 10 to S5."
  },
  "G1+ geomagnetic storm": {
    name: "G1+ geomagnetic storm probability",
    def: "Probability of Kp ≥ 5 (minor geomagnetic storm) within the forecast window. Minor power-grid effects, HF fade on polar paths, aurora visible at high latitudes."
  },
  "G2+ geomagnetic storm": {
    name: "G2+ geomagnetic storm probability",
    def: "Probability of Kp ≥ 6 (moderate-or-stronger geomagnetic storm) within the forecast window. HF fade on higher-latitude paths; aurora visible to mid-latitudes."
  },
  "G3+ geomagnetic storm": {
    name: "G3+ geomagnetic storm probability",
    def: "Probability of Kp ≥ 7 (strong-or-stronger geomagnetic storm) within the forecast window. Intermittent HF problems; surface charging on satellites; aurora visible to lower mid-latitudes."
  }
};

export function resolveDef(label) {
  var d = DEFINITIONS[label];
  if (!d) return null;
  return { name: t(d.name), def: t(d.def) };
}

// abbr(label, display) -> HTML string. Click to open a popover with the full
// definition. Unknown terms render as plain (escaped) text, no underline.
// role="button" + aria-haspopup tell screen readers this isn't a navigation
// link but a popover trigger.
// `display` lets callers show a translated string while keeping `label`
// as the English lookup key for DEFINITIONS. When display is omitted,
// the label itself is run through t() so e.g. abbr("Kp (3 h)") shows
// the translated "Kp (3 s)" string in TR mode without every caller
// having to remember to pass the second argument.
export function abbr(label, display) {
  var shown = display != null ? display : t(label);
  if (!resolveDef(label)) return _escHtml(shown);
  return '<a class="term-link" tabindex="0" role="button" aria-haspopup="dialog"' +
         ' aria-label="Definition of ' + _escAttr(label) + '"' +
         ' data-term="' + _escAttr(label) + '">' + _escHtml(shown) + '</a>';
}
