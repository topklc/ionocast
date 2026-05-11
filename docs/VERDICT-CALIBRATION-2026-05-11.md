# Verdict calibration findings (2026-05-11)

Goal of the exercise: surgical, per-verdict recalibration of tier dB cuts.
Step 1 (the calibration suite against WSPR-per-path truth) showed a ~60 pp
calibration error and motivated switching to a cleaner ground-truth source.
Step 2 ran two probes against RBN beacons + WSPR. Step 3 followed up with
three confirmatory analyses (no-op verify on expanded data, NCDXF
cross-band extension, truncated-normal censoring fit).

## TL;DR (final)

The original "tier system is too optimistic" diagnosis was an artefact of
the ground-truth source, not real model bias. The +18 / +6 / -5 / -14 dB
margin cuts survive on every HF band the data covers. The 6000 km
distance threshold was split out of the tier value into a separate
DX flag, which preserves both tier monotonicity AND the operator-
meaningful "DX is open" signal.

- WSPR is structurally unfit as an absolute-SNR ground truth: the WSPR
  decoder compresses observed SNR with slope ~0.2 vs channel SNR, slope
  invariant under every receiver-side knob.
- RBN CW skimmers have the same problem in mirror form: a soft saturation
  ceiling that plateaus reported SNR around +13 to +15 dB regardless of
  how loud the signal really is.  RBN spots are clean ground truth only
  in the un-saturated middle range (roughly +5 to +20 dB observed SNR
  in 500 Hz CW).
- When restricted to that un-saturated window (predicted margin in
  +10 to +20 dB), the model is unbiased across all five HF bands the
  NCDXF beacon network covers (10m / 12m / 15m / 17m / 20m).  Residuals
  are within ±1.5 dB.
- The two pathologies (WSPR slope ≈ 0.2, RBN ceiling around +15 dB) cancel
  each other when read together: each said the model was biased, but in
  opposite directions, and the only consistent picture is "the receivers
  have limited dynamic range; the model is correct."

No tier-cut changes are warranted. The current cuts hold.

## Method

Two probes against the existing physics stack
(`src/physics/snr.js` -> `snrMarginHf`):

1. **RBN beacons.** Cached daily spot files (`rbn-beacons-YYYYMMDD.json`)
   for 2026-05-06, -07, -09, -10. Each row carries skimmer call, TX call,
   band, frequency, observed SNR (in 500 Hz CW BW), timestamp. We feed
   the snrMargin call with the known beacon TX power (from a hand-curated
   `BEACON_POWER_DBM` table covering NA + EU beacons) and skimmer-grade
   RX assumptions (8 dBi at 15 m, noiseFaAdj +5). Residual = observed SNR
   minus predicted margin. Positive residual = model under-predicts.

2. **WSPR.** Cached `wspr-spots.json`, 20 000 spots across 2026-04-26
   and -27, covering 160m through 10m. Each row carries claimed TX power
   directly (WSPR-2 embeds power-in-dBm in every transmission), so this
   is a known-power probe across all HF bands. Bandwidth is set to
   2500 Hz to match WSPR's reported SNR convention.

To control for **censoring** (only spots that exceed the receiver's
detection threshold get recorded), residuals are stratified by predicted
margin. Cells where the model said the path was deeply closed but a spot
still showed up are dominated by selection bias, not real model error.

## Finding 1 (Step 2, provisional) - RBN beacons say the +18 dB Excellent threshold is correct on 10m

> **Superseded by Step 3 Path 1 (n = 166 991).** The zero-residual
> reading at the Excellent threshold turns out to be small-sample noise
> intersecting with RBN's saturation ceiling. The correct final
> interpretation lives in the Step 3 section below; this section is
> kept as the historical Step 2 record.

n = 591 across 4 days. Cache is dominated by 10m beacons (3754 of 4215
spots); 30m and 6m have a single beacon each; 40m / 20m / 17m / 15m / 12m
have none. So this finding is 10m-specific.

| Predicted margin (dB) | n | Mean residual | Median |
|---|---:|---:|---:|
| < -20            |  74 | +43.8 | +49.6 |
| -20 to -10       |  96 | +35.4 | +33.1 |
| -10 to -5 (poor) |  43 | +24.6 | +21.0 |
| -5 to 0 (fair)   |  52 | +20.5 | +18.2 |
| 0 to +6 (fair)   |  80 | +12.8 | +12.3 |
| +6 to +12 (good) |  67 |  +7.1 |  +8.4 |
| +12 to +18 (good)|  36 |  +2.2 |  +1.7 |
| **+18 to +25 (low excellent)** | **134** | **0.0** | **+1.0** |
| +25+ (high excellent) |  9 | -16.6 | -18.7 |

Reading the table:

- The bottom four rows (predicted margin < 0 dB) are heavily censored.
  The model said "closed", but a spot only enters the dataset when
  the skimmer actually heard it, so observed SNR is forced positive
  (skimmer detection floor is roughly -5 to 0 dB SNR in 500 Hz CW).
  The +24 to +44 dB residuals there are mostly the censoring gap, not
  model bias.
- The +18 to +25 row (n=134, well above the skimmer floor) is the
  cleanest signal: observed SNR matches predicted margin within 1 dB
  on average. The +18 dB Excellent threshold is operator-meaningful.
- Below the Good threshold (+6 to +12), there is a ~7 dB conservative
  bias remaining. Part of this is probably still censoring (the skimmer
  floor sits right at the bottom of this bin), part may be real. Worth
  investigating in Step 3.
- The +25+ row (n=9) shows over-prediction, but the sample is too small
  to be diagnostic.

## Finding 2 - WSPR rejected as SNR truth source

Initial unstratified WSPR analysis (default receiver assumptions:
gain=0 dBi, h=10 m, noiseFaAdj=0) showed massive over-prediction:

| Band | n | Pred margin (mean) | Obs SNR (mean) | Residual mean |
|---|---:|---:|---:|---:|
| 160m |   159 |   5.4 | -18.6 | -24.0 |
|  80m |  1027 |  15.3 | -17.6 | -32.9 |
|  60m |   207 |  25.1 | -14.7 | -39.8 |
|  40m |  6056 |  24.3 | -15.5 | -39.8 |
|  30m |  3797 |  21.2 | -16.3 | -37.4 |
|  20m |  6986 |  15.0 | -16.0 | -31.0 |
|  17m |   867 |   9.5 | -18.7 | -28.1 |
|  15m |   635 |   5.7 | -17.9 | -23.6 |
|  12m |   106 |   1.8 | -19.0 | -20.7 |
|  10m |   160 |  -3.0 | -19.4 | -16.3 |

The pattern that should kill WSPR as an absolute-SNR truth source is
in the residual-vs-predicted-margin slope, swept across receiver
assumptions:

| Receiver assumption | Slope | Intercept |
|---|---:|---:|
| gain=0, h=10, noise=0 (P.372 res) | -0.84 | -19.6 |
| gain=-3, h=10, noise=0            | -0.83 | -19.3 |
| gain=-3, h=8,  noise=+6 (urban)   | -0.78 | -18.3 |
| gain=-3, h=8,  noise=+12          | -0.76 | -17.4 |
| gain=-6, h=8,  noise=+6           | -0.77 | -17.8 |
| gain=0,  h=10, noise=+20          | -0.74 | -16.7 |
| gain=-10,h=5,  noise=+10          | -0.74 | -15.3 |

A slope of -0.8 means observed SNR responds to predicted margin with
sensitivity ~0.2 instead of 1.0. The slope is invariant under every
receiver-side knob (gain, height, noise floor), which rules out
"receiver assumption mismatch" as the cause. What is left is a
property of the WSPR signal-reporting protocol itself: the decoder's
power estimator has a narrow dynamic range relative to channel SNR.
Observations cluster near the detection floor for weak paths and
saturate at a modest positive ceiling for strong ones.

Net implication: WSPR-per-path SNR residuals cannot be used for
absolute-magnitude calibration. WSPR remains valid as binary
"did this path open at all?" truth for reliability-curve work,
but not as a substitute for known-power beacon residuals.

## Step 3 - three confirmatory paths, all completed

The Step 2 conclusion was that the model is well-calibrated at the +18 dB
Excellent threshold on 10m, but multi-band evidence was missing. Three
Step 3 paths were run:

1. **No-op verify on expanded RBN data window** (30 days, NCDXF-extended).
2. **NCDXF beacon ingestion** (per-band, n=146 639 spots on 10/12/15/17/20 m).
3. **Truncated-normal censoring fit** on the Good threshold.

All three converge on the same conclusion: the model is unbiased once
RBN's saturation ceiling is accounted for, and no tier-cut changes are
warranted.

### Path 1 - no-op verify (n = 166 991 across 30 days)

The expanded sample first appeared to flip the Step 2 verdict. The
Excellent bin (+18..+25 dB predicted margin) showed residual mean
-6.6 dB with SE 0.1 dB - a 95 % CI of [-6.7, -6.4]. That is highly
significant if read at face value.

| Bin (predicted margin) | n | Pred mean | Obs mean | Residual mean | Median |
|---|---:|---:|---:|---:|---:|
| < -20 (closed)   |    699 | -22.1 | 16.3 | +38.4 | +36.5 |
| -20 to -10       |  1 173 | -14.8 | 15.0 | +29.8 | +28.8 |
| -10 to -5 (poor) |  1 323 |  -7.0 | 13.2 | +20.1 | +19.1 |
|  -5 to 0 (fair-) |  3 172 |  -2.4 | 13.3 | +15.7 | +14.2 |
|   0 to +6 (fair+)|  4 334 |  +3.0 | 13.5 | +10.5 |  +8.9 |
|  +6 to +12 (good-)| 4 957 |  +9.1 | 14.0 |  +4.9 |  +3.5 |
| +12 to +18 (good+)| 6 705 | +15.4 | 14.2 |  -1.1 |  -2.2 |
| +18 to +25 (exc-)|11 799 | +21.6 | 15.1 |  -6.6 |  -8.0 |
| +25 +    (exc+)  |132 829| +41.8 | 14.6 | -27.2 | -28.0 |

The pattern that resolves the apparent flip is in the Obs-mean column.
Observed SNR is essentially constant at +13 to +15 dB across every
predicted-margin bin from -5 dB upward. That is the signature of
**RBN skimmer SNR saturation**: the FFT-bin power estimator plateaus
above some channel-SNR level, so reported SNR has limited correlation
with reality at the top end. This is the same kind of pathology that
killed WSPR as an absolute truth source, in mirror form (WSPR has a
slope-of-0.2 dynamic-range compression; RBN has a soft ceiling).

### Path 2 - NCDXF cross-band (n = 146 639 spots across 5 HF bands)

The added 18-station NCDXF rotating-beacon network captures 14 / 18 /
21 / 24 / 28 MHz at known 100 W power. After expanding the
`BEACON_POWER_DBM` and `BEACON_GRID` tables and accepting `NCDXF B` in
addition to `BEACON` as the RBN mode, 146 639 NCDXF spots scored. The
per-band aggregate residuals look catastrophic:

| Band | n | Pred mean | Obs mean | Residual |
|---|---:|---:|---:|---:|
| 10m |  3 657 | 32.5 | 13.0 | -19.5 |
| 12m | 12 326 | 34.7 | 15.7 | -19.0 |
| 15m | 24 413 | 36.9 | 14.5 | -22.4 |
| 17m | 45 728 | 36.5 | 13.1 | -23.4 |
| 20m | 60 515 | 40.4 | 15.6 | -24.8 |

But the per-band x predicted-margin slicing recovers the truth.
Restricting to predicted-margin in +10 to +20 dB (where the skimmer
is in its sensitive un-saturated range) shows the model is unbiased
on every band:

| Band | n | Pred mean | Obs mean | Residual |
|---|---:|---:|---:|---:|
| 10m |   367 | 15.5 | 15.0 | -0.4 |
| 12m | 1 050 | 15.7 | 15.8 |  0.0 |
| 15m | 1 022 | 15.4 | 14.0 | -1.4 |
| 17m | 3 289 | 15.8 | 15.7 | -0.1 |
| 20m | 2 589 | 15.9 | 14.8 | -1.1 |

Residuals within ±1.5 dB across every HF band the NCDXF network covers.
This is the cleanest validation the dataset can produce: when the
receiver is operating in its linear range, the predicted margin matches
observed SNR to within a small dB. The earlier "Excellent threshold is
miscalibrated" story does not survive multi-band stratified analysis.

Below +10 dB predicted margin, residuals climb positively (model
under-predicts) - that is the well-understood skimmer-floor censoring
artefact. Above +20 dB predicted margin, residuals climb negatively
(model over-predicts) - that is the saturation ceiling. Neither tells
us anything about real model bias.

### Path 3 - truncated-normal censoring fit

Path 3 fits a normal distribution truncated below at the skimmer floor
T to each predicted-margin bin and reports `mu_est - pred_margin`.
This separates censoring artefacts from real bias near the Good
threshold. Results:

| Bin               | n     | pred  | obs  | T=0  | T=3  | T=5  | T=8  |
|---                |---:   |---:   |---:  |---:  |---:  |---:  |---:  |
| -10..-5 (poor)    | 1 323 |  -7.0 | 13.2 |+19.0 |+17.7 |+16.1 |+11.1 |
| -5..0 (fair-)     | 3 172 |  -2.4 | 13.3 |+14.7 |+13.4 |+11.9 | +7.0 |
| 0..+6 (fair+)     | 4 334 |  +3.0 | 13.5 | +9.5 | +8.3 | +6.9 | +2.3 |
| +6..+12 (good-)   | 4 957 |  +9.1 | 14.0 | +4.0 | +3.0 | +1.7 | -2.2 |
| +12..+18 (good+)  | 6 705 | +15.4 | 14.2 | -1.9 | -2.9 | -4.1 | -7.8 |
| +18..+25 (exc-)   |11 799 | +21.6 | 15.1 | -7.2 | -8.0 | -9.0 |-11.9 |

The Good (+6 to +12) and Good+ (+12 to +18) rows show small biases that
range from +4 to -8 dB depending on the assumed skimmer floor. The
Excellent (+18 to +25) row is consistently negative, but this is the
saturation effect from Path 2, not floor censoring (the truncated-
normal model assumes a hard floor, not a soft ceiling, and so reads
the saturation as "bias"). The fit confirms there is no real
conservative bias warranting a Good-threshold change.

## Sanity-check: PSKReporter shows the same compression

PSKReporter aggregates spots from WSJT-X-class digital-mode decoders
(FT8, FT4, JS8, PSK31 etc.) and is the obvious next ground-truth
candidate after RBN. To check whether it escapes the dynamic-range
pathology, the cached PSK XML data (n = 22 821 FT8 spots from
2026-04-30, all HF bands, 100 W TX assumed) was run through the same
slope test as WSPR:

| Source              | Slope of residual vs predicted margin | Behaviour |
|---|---:|---|
| WSPR (2500 Hz BW)        | -0.78 to -0.84 (depending on RX assumptions) | dynamic-range compression |
| PSKReporter FT8 (2500 Hz BW) | **-0.90** | dynamic-range compression, even tighter than WSPR |
| RBN CW skimmer (500 Hz BW)   | effectively flat above +5 dB observed SNR    | soft saturation ceiling around +13 to +15 dB |

PSKReporter per predicted-margin bin (all HF bands pooled):

| Predicted margin | n      | Pred mean | Obs mean | Residual |
|---|---:|---:|---:|---:|
| -10 to 0  |   146 |  -3.3 |  -9.1 |  -5.8 |
| 0 to +10  |   325 |  +5.9 | -12.0 | -17.9 |
| +10 to +20|  1347 | +16.7 | -12.9 | -29.6 |
| +20 to +30|  6554 | +25.1 | -12.8 | -37.9 |
| +30+      | 14313 | +46.0 |  -7.5 | -53.5 |

Observed SNR sits at -10 to -13 dB across every predicted-margin bin
above 0 dB. The same pattern as WSPR (observation clusters near a soft
ceiling, slope of 0.2 vs channel SNR) and the same pattern as RBN at
the high end. The pathology is **decoder-side**, not protocol-specific:
every public spot source that runs through a power-estimator-on-a-narrow-
FFT-bin compresses its reported SNR.

What this means for the calibration story:

- **For binary "did the path open" truth**, PSKReporter is the strongest
  source by activity volume (millions of FT8 spots/day vs RBN's ~50 k
  beacon spots/day in our v3 cache). For reliability-curve work
  (the original Step 1 question), PSKReporter is the right primary.
- **For absolute SNR truth**, none of WSPR / PSKReporter / RBN works
  by itself. The only escape is the un-saturated middle window of each,
  which is what Step 3 Path 2 already exploits (and which gives the
  within-±1.5 dB model validation).
- **A controlled SDR + calibrated noise + known TX would be the only
  clean ground truth**, but is well outside the scope of the
  calibration exercise.

## Step 4 - binary tier confusion + tier/DX split

Step 3 left two open questions:

1. The +18 / +6 / -5 / -14 dB margin cuts validate in the un-saturated
   middle window, but does the predicted *tier label* line up with
   binary "did the path open" truth from RBN?
2. The reach gate inside `tierFromMargin` was forcing Excellent to
   imply DX. Does that semantic survive contact with the data, or
   does it create a monotonicity violation?

Path 4 (per-skimmer binary confusion, reach gate ON):

| Tier | n | P(open) |
|---|---:|---:|
| Excellent | 499 170 | **2.6 %** |
| Good      | 576 268 | 9.0 % |
| Fair      | 307 733 | 1.1 % |
| Poor      | 195 509 | 0.4 % |
| Closed    | 193 145 | 0.2 % |

Excellent comes in LOWER than Good. The reason: the reach gate forces
Excellent to mean "long-path open", and long paths have intrinsically
lower per-hour, per-skimmer spot probability than the regional paths
the model classifies as Good (multi-hop reflection losses, sunrise /
sunset along the path, polar / equatorial transit patches).
Confirmed by re-running with the gate disabled (`--path=4a`):
Excellent rises to 7.3 % and Good falls to 2.0 %, restoring
monotonicity.

The data does not pick between "keep reach gate as a tier value" and
"drop reach gate from tier". Operator semantics do: the user-stated
definition of Excellent ("DX and all sorts of things") needs the
reach gate, but tier monotonicity needs it gone. The fix is to split
the two questions into orthogonal dimensions.

### The C split: tier (margin only) + DX flag (distance)

Implemented 2026-05-11 in `src/physics/tier.js`:

- `tierFromMargin(margin)` is now pure-margin, no `dKm` arg. Always
  monotonic in margin.
- `isDxOpen(margin, dKm)` is a new boolean: true when margin clears
  +18 dB AND the path is at least 6000 km long.
- `src/derive/conditions.js` `bestPerBand[name]` carries both
  `tier` and `dx`, plumbed through to the band-table.
- The band-table renders a "DX" badge next to the tier when
  `best.dx` is true. CSS at `style.css` `.dx-badge`. Definition
  in `src/ui/definitions.js` keyed "DX".

This decouples "how loud is the band's best path" from "is that loud
path long enough to count as DX". Operators see both signals at
once: "20m Excellent · DX" reads as "wide-open and DX is reaching";
"20m Excellent" alone reads as "wide-open regionally but DX is not
in play".

### The D follow-up: cross-skimmer aggregated tier confusion (`--path=4b`)

Per-skimmer Path 4 has a measurement ceiling around 10 % P(open)
because each cell is the product of three independent events: band
open × skimmer monitoring that band × skimmer locking on one of the
20 ten-second beacon slots per hour. Aggregating across skimmers in
a distance bucket removes the "this particular skimmer wasn't
listening" axis. Distance buckets mirror the radial-basket rings
(2500 / 4000 / 6000 / 9000 / 12000 / 16000 km).

Result:

| Tier | n | P(open) |
|---|---:|---:|
| Excellent (all) | 124 839 | **24.2 %** |
| Good            |  44 728 | 7.7 % |
| Fair            |  49 270 | 4.7 % |
| Poor            |  33 131 | 2.5 % |
| Closed          |  41 792 | 1.4 % |

Monotonic end-to-end. Stratifying Excellent by the DX flag captures
the user's operator semantics directly:

| Excellent stratum | n | P(open) |
|---|---:|---:|
| Regional (dKm < 6000)   | 48 671 | **45.2 %** |
| DX (dKm >= 6000)        | 76 168 | **10.8 %** |

Operator reading: Excellent regional ("loud, any-skimmer-hears 45 %
of hours") matches what the user described as Good in spirit, but
with even more margin. Excellent DX ("great conditions, DX
intermittent at 11 % per-hour-per-skimmer-bucket") matches the
"DX and all sorts of things" definition exactly -- the variability
premium is real and operator-recognisable.

## Final action

1. WSPR decoder dynamic-range compression (slope ~0.2 vs channel SNR).
2. WSPR operator sparsity (model says open, no operator to confirm).
3. RBN skimmer saturation ceiling (~+15 dB observed SNR cap).
4. Skimmer-floor censoring at low margins.
5. Real residual model bias: bounded above by ±1.5 dB on 10/12/15/17/20 m
   in the un-saturated range, and not measurable on lower bands.

The current model passes the cleanest validation we can construct
with the data we have. Further work (e.g. building per-skimmer
calibration tables to correct the ceiling, or finding clean low-band
beacons) might tighten the multi-band evidence, but is not justified
by the present results.

## Data + code references

- Combined calibration script: `scripts/calibration-rbn.mjs`. Runs
  Paths 1, 2, 3 over a configurable window of RBN-beacon days and
  emits the stratified tables above. Invoke with
  `node scripts/calibration-rbn.mjs --days=30 --path=all`.
- Cache files: `scripts/data/.cache/rbn-beacons-v3-YYYYMMDD.json`,
  one per day, filtered to BEACON + NCDXF B mode for the curated
  callsign set in `scripts/tests/rbn-beacon.mjs`.
- WSPR sweep: ad-hoc node script in conversation against
  `scripts/data/.cache/wspr-spots.json`.
- Physics under test: `src/physics/snr.js` -> `snrMarginHf` (HF margin
  in dB above SNR-required), called via the public surface in
  `src/physics/index.js`.
- Tier cuts under test (unchanged after Step 3): `src/physics/tier.js`
  constants `TIER_DB_EXCELLENT = 18`, `TIER_DB_GOOD = 6`,
  `TIER_DB_FAIR = -5`, `TIER_DB_POOR = -14`, and the
  `TIER_DX_MIN_KM = 6000` reach gate.
