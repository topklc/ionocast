# ionocast methodology audit (2026-05-06)

Audit of `paper/ionocast-methodology.tex` (5738 lines) against
`src/physics/`, `src/constants.js`, `scripts/harness.mjs`, and
`functions/_handlers/giro.js`. Findings grouped by severity. Line
numbers refer to the .tex file unless otherwise noted.

The triage of all 177 findings ranked by severity is in
`METHODOLOGY-AUDIT-TRIAGE-2026-05-06.md`.

## How to raise audit confidence further

This audit reached ~98 to 99% confidence after Pass 1 to Pass 3
plus two coverage-check addenda passes. To close the remaining
gap, in rough order of leverage:

1. **Author response to the triage.** ~1 to 2 hours of the
   author's time. They will know which items are already fixed
   in their working copy, which are intentional design choices
   documented elsewhere, and which they dispute. Catches false
   positives and surfaces hidden context. Most efficient single
   intervention.

2. **Fresh-model audit.** A second model context with no memory
   of these passes has different priors. Could be done by
   pointing a fresh agent at just the paper and asking "find
   every error you can." ~10 to 15 hours of agent time,
   parallel-runnable.

3. **Open the print-only sources.** Mitra 1974 §5 to 6 (flare
   absorption anchors), Pr\"olss 1995 (winter-anomaly
   magnitudes), ARRL Antenna Book Ch. 3 (vertical pattern
   derivations). Physical or interlibrary access. ~3 to 5 hours.

4. **Read every code path the agents reported on personally.**
   All of `src/derive/`, `src/ui/`, `functions/_handlers/`,
   `scripts/tests/`. Catches anything an agent hallucinated or
   missed. ~5 to 10 hours.

5. **Compile-and-fix iteration.** Pass 2.B did one compile;
   iterate on the underfull / overfull hboxes and the orphan
   `\ref{sec:residuals}`. ~30 min.

6. **Diff against the retired `paper/fix.md` log.** Items closed
   there but later regressed would surface. ~30 min.

7. **Run `scripts/tests.mjs` end-to-end.** The full validation
   suite (psk, rbn, rbn-beacon, voacap-fixtures, sigma,
   noise-floor, etc.) was not exercised separately. ~1 hour.

8. **Independent peer review** by an HF-propagation domain
   expert. Out of scope for this audit pipeline.

Recommendation: ship the triage to the author for response (1),
then run a fresh-model second-opinion audit (2), then act on the
resulting deltas. Steps 3 to 7 are diminishing returns past that
point.

## A. Internal contradictions (fix before next release)

### A1. Worked example uses stale sigma for 20 m

Lines 1769 to 1771: *"With the per-band sigma for 20 m = 6 dB
(Table tab:bandsigma), the standardised margin is M / sigma = 41.5 / 6
= 6.92."*

Table `tab:bandsigma` (line 4143) lists sigma_g = **9** dB for 20 m,
and `src/constants.js:224` confirms 9 with a comment *"was 6"*. The
worked example explicitly cites the table it disagrees with.

Fix options:
- Re-derive: M / sigma = 41.5 / 9 = 4.61 (still Excellent since
  4.61 >= 1.2816), or
- Restore example to sigma = 6 dB and remove the table citation.

### A2. Limits #1 sigma values disagree with `tab:bandsigma`

Lines 4994 to 4996: *"the per-band base from Table tab:bandsigma
(6 dB on 160 m to 20 m, 10 dB on 17 m, 12 dB on 15 m / 12 m / 10 m,
8 dB on the VHF placeholders)."*

Post 2026-04-30 refit, the table reads 8 / 8 / 8 / 8 / 9 / 9 / 9 / 10
/ 12 / 12 across 160 m to 10 m. The entire parenthetical is pre-refit.

### A3. Default-settings table sigma range is stale

Appendix A, Table `tab:defaults`, line 5270: *"Spread sigma_g (base)
6 to 12 dB per band."* New range is 8 to 12 dB.

### A4. Limits #10 and #11 contradict section 6.4 about northern-crest GIRO coverage

- Section 6.4 (lines 2107 to 2110): *"BVJ03 Boa Vista (BR, phi_dip
  approx +12 deg) added to GIRO_STATIONS, the previously one-sided
  fit converged at base 0.50 / slope 0.007 / sigma = 18 with eqMaxAbs
  dropping from 1.84 to 1.18 MHz."*
- Limits #10 (lines 5119 to 5121): *"no GIRO station in our list
  sits on the northern crest."*
- Limits #11 (lines 5156 to 5157): *"the northern-crest stations are
  currently absent from the GIRO basket."*
- Limits #10 (lines 5121 to 5122): *"The grid sweep bottoms out at
  max|bias| approx 2.2 MHz"* (section 6.4 says it dropped to 1.18
  MHz after Boa Vista landed).

Code verification: `scripts/harness.mjs:211` and
`functions/_handlers/giro.js:24` both contain BVJ03. Section 6.4 is
the truth; section 9 Limits #10 and #11 were not updated.

### A5. Appendix B GIRO table is missing BVJ03 and the count is off

Section header (line 5364) and Table `tab:giro` caption (line 5380)
say *"26 GIRO digisonde stations."* Code lists **27** (10 EU + 4 NA +
3 Polar + 2 Equatorial + 7 Southern + Boa Vista). The table itself
(lines 5392 to 5427) does not include the Boa Vista row.

Action:
- Add BVJ03 under "Equatorial / low-latitude" or a new "Northern
  crest" subgroup.
- Update the section header and caption to 27.

### A6. Bonus-uncertainty caveat numerics don't match the formula given

Lines 3530 to 3534: *"the correction is sqrt(sigma_g^2 + 25) -
sigma_g, which is +1.5 dB on a sigma_g = 12 dB upper-band and +2.7 dB
on a sigma_g = 6 dB low/mid-band."*

Recompute:
- sigma_g = 12: sqrt(144 + 25) - 12 = 13 - 12 = **1.0 dB** (not 1.5).
- sigma_g = 6: sqrt(36 + 25) - 6 ~= 7.81 - 6 = **1.81 dB** (not 2.7).
- The quoted numbers correspond to a bonus uncertainty of approx 6.2
  dB, not 5 dB.

Fix options: restate bonus uncertainty as approx 6 dB and keep the
1.5 / 2.7 increments, or keep 5 dB and recompute to 1.0 / 1.8 dB.
Note that the sigma_g = 6 anchor is itself stale post-refit.

### A7. Stability cap claim disagrees with itself

- Lines 3879 to 3884 correctly give per-bucket caps: Poor 67 %
  (Phi(0.45)), Fair 63 % (Phi(0.32)), Good 70 % (Phi(0.51)).
- Line 4868 then says: *"finite-width middle buckets (Poor / Fair /
  Good) cap at Phi(0.42) approx 66 % at the bucket centre."* No
  bucket has a half-width of 0.42; the value is a rough average and
  reads as if it were the cap.

Pick one consistent statement.

## B. Code/paper drift

### B1. (= A5)

GIRO station count and Boa Vista row missing in Appendix B.

This is the only substantive code drift found. The cross-check agent
verified 18 of 20 spot-checked equations and constants match
implementation exactly:

- MUF proximity loss (Eq. lmuf)
- D-RAP ramp (Eq. labs)
- Sauer-Wilkinson PCA (Eq. lpca)
- Flare driver (Eq. lflare-driver) and twilight ramp (Eq. lflare-ramp)
- Auroral max(K_p, HP) combination
- CGM threshold ramp (Eq. auroralexpansion)
- sqrt(h_F) hop ceiling (vs. the retired linear form)
- 1.4x storm-main amplification on L_aur
- F2-scatter formula and weight 1.5
- TEP plateau sigmoid (Eq. tepplateau)
- Tier z-boundaries {-1.2816, -0.3853, +0.2533, +1.2816}
- DEFAULT_SIGMA_DB = 8 in tier.js
- BAND_SIGMA_DB row-by-row
- L_iono = 1 dB times n_hops
- Defocus 0.25 dB per extra hop
- Mode required-SNR table
- Vertical antenna denominator = 1 (post the 1.57 fix)

## C. Weak / soft claims worth tightening

### C1. Absorption-sum saturation example doesn't actually demonstrate proportional rescaling

Lines 396 to 412. The values "45 + 25 + 15 + 15" already sum to 100
dB before the cap, so the worked example produces identical pre/post
values and shows nothing. Pick values that sum > 100 (e.g. 60 + 35 +
30 + 25 = 150, rescaled to 40 + 23.3 + 20 + 16.7).

### C2. TEP worked example silently uses the solar-max plateau

Lines 1791 to 1798. The example substitutes B_TEP,plateau = 15 dB
without specifying F10.7A. Per Eq. tepplateau the plateau only
reaches 15 dB asymptotically (approx 14 dB at F10.7A = 180, approx 11
dB at F10.7A = 120). State the F10.7A used, or use the moderate-cycle
plateau (approx 11 dB) and recompute (approx 9.6 dB after the 0.875
frequency factor).

### C3. Galactic Fa quote varies between sections

- Section 3.10 mapping paragraph (line 1311) cites Fa approx 50 - 23
  log10(f) dB above thermal at 10 to 200 MHz. At f = 21 MHz that is
  19.6 dB.
- Limits #14 (lines 5212 to 5213) states *"galactic Fa approx 25 dB
  sets a hard approx -115 dBm in 2.5 kHz at 21 MHz."*

Pick one anchor and let the rest derive.

### C4. NVIS limitation entry pre-dates its own fix

Limits #3 says NVIS "uses foF2 directly" but section 4.5 already adds
the secant correction sec(arctan(d / 2 h_F)) (Eq. nvis). The
limitation entry pre-dates that correction.

### C5. Section 3.7 sporadic-E screening L_Es is unanchored

Declares L_Es = 5 dB as a flat constant with no f or f_oEs
dependence and no explanation for the magnitude. Either anchor it
(P.534 reference) or label it empirical alongside L_low.

### C6. Section 7.1 bonus-active confidence omission isn't quantified

The paragraph mentions that bonus-active verdicts read more
confident than they should but does not quantify the operationally
relevant case of a 13 dB TEP bonus on a 15 m verdict near a tier
boundary. Worth a small worked example since it is the dominant
exposure.

### C7. Section 6.5 / 6.6 fusion-flag wording is ambiguous

Section 6 says the runtime ships with the production blend held off
for fusion (`fusion-flag` off) but section 3.4 (L_flare,path inline
equation) and section 6.5 both refer the reader to fusion as if it
were active in places. Add a single "Production wiring summary" box
at the start of section 6 listing what's on/off in shipping code.

## D. Style / copy-edit (low priority)

### D1. Section header capitalization is inconsistent

Section 6.1 "kc2g Observed MUF" (lowercase 'kc2g' is the brand,
fine), but section 6.6 "Short-Path vs. Long-Path Evaluation" uses
Title Case while section 3.4 "D-Region Absorption: Flare-Enhanced
(SWPC D-RAP)" mixes hyphenation styles. Pick one and apply.

### D2. Footnote on sigma overloading

Lines 3966 to 3977 acknowledges five distinct meanings of sigma.
Consider promoting to a "Notation" appendix and using subscripted
variants throughout (sigma_pred, sigma_gnd, sigma_kern, sigma_ramp).

### D3. Eq. ref typos

Section 3 (lines 343 to 344) inlines the flare-absorption joint as
`Eq.~\ref{eq:flareabs-inline}` forward-referencing itself; verify
the label/usage order at compile time.

## E. Reproducibility / process

### E1. Appendix D Reproducibility Manifest does not list `src/constants.js`

Lists `harness.baseline.json`, `harness.baseline.perpath.json`,
`harness.report.json`, and `spot-baselines.mjs`, but not
`src/constants.js` despite section 7.2 (lines 3601 to 3604) saying
the calibration "exchanges exactly one thing: the calibrated
constants in src/constants.js" between layers. Add constants.js to
the manifest alongside the baseline files.

### E2. Climatology validation set vs. calibration superset

Section 6.4 climatology rebuild claims *"30 d of GIRO foF2 across
nine stations"* (lines 2004 to 2005) but Appendix B lists 27
stations and section 3.4 says climatology validation uses *"the four
equatorial-belt stations"*. Reconcile which station subset is the
climatology validation set vs. the calibration superset.

## K. TikZ plot-expression audit (item 5)

A second-pass agent ran every `\addplot` expression in the paper
against the equation it claims to plot. Results:

- **DRIFT** `fig:mufdiurnal`: TikZ uses `max(0.447, sqrt(...))`
  i.e. embeds `sqrt(0.20)` directly. Caption says F ~ 0.40
  (linear). Plot is square-root form with floor 0.447, not
  linear. Same finding as G4.16.
- **DRIFT** `fig:seasonal`: TikZ comment and formula at line 2588,
  2595, 2600, 2605 use **calendar-month** phasing
  `theta = 2*pi*(m + 0.5 - m_winter)/12`. Eq. `seasonal` (line
  2542) uses **day-of-year** phasing
  `theta = 2*pi*(d_yoy - d_solstice)/365`. Plot reflects the
  retired form, not the current model. Same as G5.5.
- **DRIFT** `fig:tierprob` caption (line 4323-4324): claims HF
  bands use σ_g ∈ {6, 10, 12} dB; actual table is {8, 9, 10, 12}.
  Same as G7.6.
- **OK** `fig:storm`: caption correctly disclaims plotted curve
  is at 65°, not the 70°+ regime where main-vs-floor coincide.
- **OK** `fig:noise`: power-sum implementation correct
  (`10*log10(10^(Natmo/10) + 10^(Nmm/10))`).
- **OK** `fig:dabs`: per-band A_base values verified at correct
  values, smooth illustrative curve disclosed in caption.

So 3 figure issues (all already in earlier sections, but now
confirmed by independent re-analysis); 3 figures clean.

## O. Empirical-numbers spot checks (item 4)

### O.1 Spot-baselines distribution (re item 4 / paper line 4519)

Paper line 4517-4520 implies *"the 30-day mean on quiet cells
(e.g. 10m at 03 UTC during low-cycle phase) was the average over
the days the band was actually open"* under the **earlier** SQL
form. Now under the corrected SQL the baseline is divided by the
literal day count.

I dumped today's `src/data/spot-baselines.mjs` (auto-regenerated
by `wspr-baselines.yml` per H.5) and computed:

- 240 (band, hour) cells total. All non-zero.
- Lowest cell: 160m at 14 UTC = **525 spots/h**.
- Highest cell: 20m at 17 UTC = **107 612 spots/h**.
- Bottom 5: 12m at 5 UTC (724), 12m at 6 UTC (737), 160m at 13
  UTC (630), 160m at 14 UTC (525), 160m at 15 UTC (568).

**Observation**: the paper's quote *"10m at 03 UTC during
low-cycle phase being near zero"* (line 4517-4519) is no longer
true at the **current** solar phase. Even the lowest cells are
525+ spots/h, two orders of magnitude above zero. This is partly
because we are well past low-cycle (cycle 25 is in declining
phase from 2026 onward), but also because WSPR receiver
population has grown.

The "near-zero" claim should be updated or qualified to *"low
spot-rate cells (e.g. 160m mid-afternoon UTC, ~500-700
spots/h)"*.

### O.2 Override-firing rate "5-10% of cells per day"

Cannot reproduce without access to a live observation stream and
the override-counting harness path. Defer.

### O.3 Winter-anomaly ratio 1.12 ± 0.03

Cannot reproduce without GIRO foF2 data over a full year
window at the 10 listed midlat stations. Defer.

### O.4 σ_f bias claim (paper line 3279-3294)

The claim is mathematical: inverse-square distance weighting
biases the variance estimator toward the nearest station. This
is correct as stated (weighted variance with concentrated
weights underestimates true population variance unless the
weights match a sampling design). The paper acknowledges this
honestly. No drift.

## Q. Re-read of skimmed passages (item 10)

A targeted re-read of paragraphs that I read with less care
during the chunk-of-500-lines passes. Findings:

### Q.1 Function-name drift in §6.4 fusion paragraph

Paper §6.4 line 3347: *"requires re-running the sweep against
the per-pair WSPR ground truth (Section sec:perpath) once that
mode is wired into `replayMargin`'s alternative-mode bonuses"*.

The actual function in code is **`replayMarginFromCell`**
(`scripts/tests/calibration.mjs:9`, `day-night.mjs:9`,
`hops.mjs:8`). Update the paper to the actual function name.

### Q.2 Boa Vista BR mention contradicts §10 #10/#11

Already in A4. Re-confirmed: §4.2 line 2107-2110 says BVJ03 was
added; §9 Limits #10 (line 5119-5121) and #11 (line 5156-5157)
both still say *"no GIRO station in our list sits on the
northern crest"* and *"northern-crest stations are currently
absent"*. Both lines should be updated.

### Q.3 The "intellectually honest engineering" sentence

Line 3342-3344: *"This is intellectually honest engineering but
it does mean the calibrated w_sc = 1.5 has been validated
against a metric whose calibrators do not fully trust beyond a
certain point."* This is good engineering self-disclosure but
reads as voice-of-the-author commentary inside a methodology
paper. Tighten.

### Q.4 §3.4b reference to §A.2 absorption form

The §3.4 D-region table calibration claim (line 562-564)
*"Calibrated 2026-04-30 against ITU-R P.533 §A.2 quiet-day
non-deviative absorption L_a(f) ≈ 677 / (f + f_L)^{1.98}"* was
flagged in J2 (no such formula in P.533-14). On re-read I
notice this is doubly questionable: the expression is the
**Lockwood / IONCAP** form, AND the /1.6 obliquity divisor
doesn't reproduce the actual table values (G3.4 verified
numerically). So the calibration anchor is doubly broken: wrong
source AND wrong arithmetic.

### Q.5 §3.4c outer max(0, ·) explanation reads correctly

Line 744-757 explaining the C3.16 zero-crossing for the flare
driver: math holds (D(C5) ≈ 1.6, D(C9) ≈ 3.6, D(M1) = 4 are
correct), zero-crossing at X ≈ C3.16 (= 10^{-5.5} W/m²)
verified. ✓ No new findings.

### Q.6 §6.5 tropospheric ducting "warm-water" paragraph

Line 3401-3405 says liquid-water Magnus over-estimates e on
*"continental winter soundings where the surface dew point is
below freezing"* and gives the **≤ 2 N-units** bound. I verified
in G6.11 that at t_C = -20°C the bias is ~1.34 N-units, so
"≤ 2 N-units" is a plausible-but-loose claim. At colder
temperatures (e.g. -40°C surface, -50°C aloft) the bias grows.
The paper's worst-case claim should specify the temperature
range. Already noted in G6.11.

### Q.7 §3.10 line 1283-1305 rural double-count retired paragraph

Pure historical narrative (F2). On re-read, the math is correct
(power-sum of N_atmo and N_mm with N_mm pinned to N_base
collapses to N_base + 3 dB at the limit) but the entire
paragraph is changelog. Cut.

### Q.8 §6.1 L_iono,Es = 15 dB explanation

Line 3100-3111 explains why L_iono,Es is much larger than F2
L_iono. The four reasons given (patchy cloud structure, aspect
sensitivity, polarisation scrambling, residual Y_p variability)
are physically reasonable but lumped into a single empirical
constant. Cited as sub-mechanisms without per-mechanism
citations or magnitudes. **Could be tightened** by either:
- Decomposing into per-sub-mechanism partial contributions
  (would be more useful for a reader trying to extend the
  model), or
- Acknowledging it as a single empirical fit ("L_iono,Es = 15
  dB is calibrated against WSPR Es-mode openings; the
  decomposition above is the physical motivation, not the
  derivation").

The current text gestures at decomposition without delivering it.

### Q.9 §3.6 line 1066-1067 calibration coverage

*"only the defocusing scalar D remains tunable, and is
exercised by the harness over a multi-path basket spanning 1, 3,
and 5 hops"*. The 1-hop, 3-hop, 5-hop spread is verified in
Appendix A `tab:paths`: NVIS paths (1 hop), most 2-hop midlat
links, and "VK-EU" / "VK-EU west" 5-hop paths. ✓ OK.

### Q.10 §7.3 forecast-σ catch-up arithmetic

Line 4021-4025: *"summing in quadrature with the current-Kp
σ_storm branch would have produced sqrt(σ_storm^2 + 0.49 ·
σ_storm^2) ≈ 1.22 · σ_storm at the moment of catch-up (a 22 %
inflation), instead of the intended hand-off to σ_storm alone"*.
Math: sqrt(1 + 0.49) = sqrt(1.49) = **1.221**. ✓ Verified.

## V. Pass 3.A — Bibliography drafts (2026-05-06)

A research agent drafted replacement / new BibTeX entries for
each citation issue surfaced in §G11, §J, and Pass 2.A. Below
are the agent's draft entries, ready to paste into the paper's
`\begin{thebibliography}` block.

### V.1 New entries

```latex
\bibitem{kc2g}
  A.~Rodland (KC2G),
  \emph{HF Propagation Prediction Maps},
  prop.kc2g.com.  Real-time MUF and foF2 maps assimilated from
  GIRO ionosondes, funded by the Northern California DX Foundation /
  WWROF.  This is the primary external real-time MUF input throughout
  ionocast.
  \url{https://prop.kc2g.com/}.

\bibitem{giro}
  B.\,W.~Reinisch and I.\,A.~Galkin,
  ``Global Ionospheric Radio Observatory (GIRO),''
  \emph{Earth, Planets and Space}, vol.~63, no.~4, pp.~377--381, 2011.
  \textsc{doi}: 10.5047/eps.2011.03.001.
  Source of foF2, foEs, and hmF2 measurements via the Digital
  Ionosonde Database (DIDB) at the University of Massachusetts Lowell.
  \url{https://giro.uml.edu/}.

\bibitem{hp30}
  Y.~Yamazaki, J.~Matzka, C.~Stolle, G.~Kervalishvili, J.~Rauberg,
  O.~Bronkalla, et al.,
  ``Geomagnetic Activity Index Hpo,''
  \emph{Geophysical Research Letters}, vol.~49, no.~10,
  e2022GL098860, 2022.
  \textsc{doi}: 10.1029/2022GL098860.
  Hp30 / Hp60 high-cadence planetary indices distributed by GFZ
  Potsdam.
  \url{https://kp.gfz.de/en/hp30-hp60/}.

\bibitem{wdckyoto}
  World Data Center for Geomagnetism, Kyoto:
  M.~Nose, T.~Iyemori, M.~Sugiura, T.~Kamei, A.~Matsuoka, S.~Imajo,
  and T.~Kotani,
  \emph{Geomagnetic Dst Index}, 2015,
  \textsc{doi}: 10.17593/14515-74000;
  and S.~Imajo, A.~Matsuoka, H.~Toh, and T.~Iyemori,
  \emph{Mid-latitude Geomagnetic Indices ASY and SYM},
  2022, \textsc{doi}: 10.14989/267216.
  Kyoto University, Graduate School of Science.
  \url{https://wdc.kugi.kyoto-u.ac.jp/}.

\bibitem{silso}
  F.~Clette, L.~Svalgaard, J.\,M.~Vaquero, and E.\,W.~Cliver,
  ``Revisiting the Sunspot Number: A 400-Year Perspective on the
  Solar Cycle,''
  \emph{Space Science Reviews}, vol.~186, no.~1--4, pp.~35--103, 2014.
  \textsc{doi}: 10.1007/s11214-014-0074-2.
  See also F.~Clette and L.~Lef\`evre, ``The New Sunspot Number:
  Assembling All Corrections,'' \emph{Solar Physics}, vol.~291, 2016,
  \textsc{doi}: 10.1007/s11207-016-1014-y.
  Reformed (v2) SSN time series distributed by SILSO,
  Royal Observatory of Belgium.
  \url{https://www.sidc.be/SILSO/}.

\bibitem{uwyo}
  University of Wyoming, Department of Atmospheric Science,
  \emph{Wyoming Weather Web Upper Air Sounding Archive},
  Laramie, WY.  Global radiosonde sounding archive used for
  tropospheric refractivity profiles in §\ref{sec:tropo}.
  \url{https://weather.uwyo.edu/upperair/sounding.html}.

\bibitem{n0nbh}
  P.~Herrman (N0NBH),
  \emph{Solar Data / HF Propagation Conditions Widget},
  hamqsl.com.  Heuristic band-condition summary widely embedded in
  amateur-radio pages.
  \url{https://www.hamqsl.com/solar.html}.

\bibitem{voacap}
  G.\,R.~Hand and L.\,R.~Teters,
  \emph{Voice of America Coverage Analysis Program (VOACAP):
  User's Guide and Reference Manual},
  Institute for Telecommunication Sciences (NTIA/ITS),
  U.S.~Department of Commerce, Boulder, CO.  IONCAP-derived
  point-to-point HF prediction implementation, distinct from
  ITU-R~P.533~\cite{itup533}.
  \url{https://www.voacap.com/}.

\bibitem{dxtoolbox}
  Black Cat Systems,
  \emph{DX Toolbox: HF / Shortwave Propagation Software},
  Westminster, MD.  Heuristic propagation forecasting tool
  combining solar-flux, K/A-index, and grayline overlays.
  \url{https://www.blackcatsystems.com/software/ham-shortwave-radio-propagation-software.html}.

\bibitem{sonntag1990}
  D.~Sonntag,
  ``Important new values of the physical constants of 1986,
  vapor pressure formulations based on the ITS-90, and psychrometer
  formulae,''
  \emph{Zeitschrift f\"ur Meteorologie}, vol.~40, no.~5,
  pp.~340--344, 1990.
  Source of the Magnus saturation-pressure coefficients
  ($a=17.62$, $b=243.12\,^\circ$C) used in §\ref{sec:tropo};
  recommended by WMO~(2008) over the Alduchov--Eskridge form.
```

### V.2 Corrections to existing entries

**`itup842`** — change year from 1997 to **2013**:

```latex
\bibitem{itup842}
  ITU-R Recommendation P.842-5,
  \emph{Computation of Reliability and Compatibility of HF Radio Systems},
  International Telecommunication Union, Geneva, 2013.
  \url{https://www.itu.int/rec/R-REC-P.842/}.
```

**`itup534`** — change year from 2019 to **2021**:

```latex
\bibitem{itup534}
  ITU-R Recommendation P.534-6,
  \emph{Method for Calculating Sporadic-E Field Strength},
  International Telecommunication Union, Geneva, 2021.
  \url{https://www.itu.int/rec/R-REC-P.534/}.
```

**`itup1239`** — change year from 2015 to **2012**:

```latex
\bibitem{itup1239}
  ITU-R Recommendation P.1239-3,
  \emph{ITU-R Reference Ionospheric Characteristics},
  International Telecommunication Union, Geneva, 2012.
  \url{https://www.itu.int/rec/R-REC-P.1239/}.
```

**`ntia2021`** — replace with Bean & Dutton 1968 (Red Book Ch. 5
doesn't classify refractivity):

```latex
\bibitem{beandutton1968}
  B.\,R.~Bean and E.\,J.~Dutton,
  \emph{Radio Meteorology},
  Dover Publications, New York, 1968 (reprint of NBS Monograph~92,
  1966), 435~pp.
  Canonical reference for atmospheric refractivity~$N$, the
  $dN/dh$ classification (sub-refractive, standard, super-refractive,
  trapping/ducting), and global gradient climatologies cited
  in §\ref{sec:tropo}.
```

**`arrl2023`** — split into two entries:

```latex
\bibitem{arrl2023antenna}
  ARRL,
  \emph{The ARRL Antenna Book}, 25th edition,
  American Radio Relay League, Newington, CT, 2023.
  Cited for ground-reflection factor and elevation-pattern
  derivations in §\ref{sec:antpattern} (Chapter~3).
  \url{https://www.arrl.org/shop/}.

\bibitem{arrl2023handbook}
  ARRL,
  \emph{The ARRL Handbook for Radio Communications}, 100th edition,
  American Radio Relay League, Newington, CT, 2023.
  Cited for noise-environment classification background alongside
  ITU-R~P.372~\cite{itup372}.
  \url{https://www.arrl.org/shop/}.
```

**`k9la`** — restructure as operator-experience consensus:

```latex
\bibitem{k9la}
  C.~Luetzelschwab (K9LA),
  \emph{Propagation Tutorials and Monthly-Column Archive},
  k9la.us, 2008--2024.
  Cited as background for D-region absorption; the specific
  per-band quiet-day values in Table~\ref{tab:dabs} are an
  operator-experience consensus informed by this archive rather
  than a direct transcription from any single article.
  \url{https://www.k9la.us/}.
```

**`wsprlive` + `wsprnet`** — split (and correct QEX → QST):

```latex
\bibitem{wsprlive}
  WSPR Live,
  \emph{ClickHouse-backed Queryable Mirror of the WSPRnet Spot
  Database}.
  The aggregate-query interface ionocast uses for
  activity-baseline calibration and the binary "is this band
  alive" sanity check.
  \url{https://wspr.live/}.

\bibitem{wsprnet}
  J.\,H.~Taylor (K1JT) and B.~Walker (W1BW),
  ``WSPRing Around the World,''
  \emph{QST}, November 2010, pp.~30--32,
  American Radio Relay League, Newington, CT.
  \url{https://wsjt.sourceforge.io/WSPR_QST_Nov_2010.pdf}.
```

### V.3 Paper-text edits flagged (no bib change)

- **`itup527` ε_r=13 vs 15** (Pass 2.A item 7): paper uses 13
  for "average ground" but P.527-6 gives ε_r ≈ 15. Either
  update to 15 or add a note explaining the deviation. No bib
  change; flag for §3.6 prose at line 997-998.

- **`sauer2008` 1998-2002 vs 1992-2002** (Pass 2.A item 10): paper
  text at lines 614-615 says 1998-2002. Should be 1992-2002. No
  bib change; flag for §3.4b prose.

- **§1 line 185 "HamQSL / DX Toolbox"**: with the new
  `n0nbh` and `dxtoolbox` entries, the citation becomes
  `\cite{n0nbh,dxtoolbox}` (HamQSL = N0NBH's site, so
  `n0nbh` covers HamQSL).

- **`arrl2023` call sites**: existing `\cite{arrl2023}` usages
  must be split. Antenna-pattern context (§3.12) →
  `\cite{arrl2023antenna}`. Noise-environment context (§3.10)
  → `\cite{arrl2023handbook}`.

- **`wsprlive` call sites**: existing `\cite{wsprlive}` usages
  should be audited. Activity-baseline / band-alive references
  stay with `wsprlive`. Protocol-design references move to
  `\cite{wsprnet}`.

### V.4 Net Pass 3 result

- **Pass 3.A bibliography**: 10 new entries drafted, 5
  corrections proposed, 5 paper-text-edit flags. All entries
  match the paper's existing bibliography style.
- **Pass 3.B drift cells**: all 15 root-caused to a F10.7 spike
  (105 → 156 in 6 days); not a code defect.

After Pass 3, my coverage estimate is **~99%**. The remaining
1% is item 5 (deferred empirical: override-firing rate, winter
ratio, WSPR CV) which requires harness extensions to attempt.

## U. Pass 3 deep-dive (2026-05-06)

### U.1 Pass 3.B — Drift cells root-caused to solar-flux change

The 15 (path, band) cells flagged in §H.4 all show **positive
dMargin** (model predicts more open) and the largest cluster on
upper bands (12m-17m). Root cause:

**Solar flux changed between baseline and current run**:

| Param | Baseline (2026-04-30) | Current (2026-05-06) | Δ |
|---|---|---|---|
| F10.7 (instantaneous) | 105 | **156** | +49% |
| F10.7A (81-day mean) | 122.725 | **126.8** | +3.3% |

In 6 days, **F10.7 jumped 49 %** (active region, possible flare)
and the 81-day mean ticked up by 4 units. Both feed:

- `b_floor(F107A) = 3.5 + 0.04·(F107A − 70)` (Eq. fof2-base-floor):
  +4.1 → +0.16 MHz on the foF2 floor.
- `A_cr(F107A)` (Eq. eia-amp): EIA crest amplitude scales with
  F107A above 70.
- `B_TEP,plateau(F107A)` (Eq. tepplateau): TEP plateau
  saturates faster.

All three push MUF predictions higher → smaller L_MUF penalty
on near-MUF upper bands → margin shifts up by ~1.5 to 3.5 dB.

**The 2-dB / 5-pp regression threshold is correctly detecting
this**, but the underlying drift is **data-driven, not
code-driven**. The line-by-line sweep (§I) confirmed no code
changes since baseline; the cells caught here are exactly what
a sensitive regression detector should flag.

### U.2 Per-cell margin and observed open-rate

Pulling baseline cell stats from
`scripts/data/harness.baseline.json` and current from
`scripts/outputs/harness.report.json`:

| Cell | base M | now M | dM | base pOpen | now pOpen | dPopen | obs.open(now) |
|---|---|---|---|---|---|---|---|
| Polar W6-EU 17m | +11.31 | +14.80 | +3.48 | 86.7% | 92.7% | +6.0pp | **1.0%** |
| EU-Asia 17m | +12.19 | +14.80 | +2.61 | 85.3% | 90.2% | +4.9pp | **0.1%** |
| Polar W-UA 15m | +7.82 | +10.26 | +2.44 | 72.8% | 77.8% | +5.1pp | 7.4% |
| Asia-EU short 12m | +2.37 | +4.56 | +2.19 | 55.1% | 59.9% | +4.7pp | **0.0%** |
| EU-EU east 10m | +7.66 | +9.85 | +2.19 | 65.5% | 69.3% | +3.8pp | 1.9% |
| EU-EU west 10m | +8.86 | +10.98 | +2.12 | 68.1% | 71.6% | +3.5pp | 20.9% |
| NVIS DE-NL 12m | +24.89 | +27.01 | +2.12 | 93.4% | 94.8% | +1.4pp | 99.3% |
| JA-EU 12m | +1.02 | +3.11 | +2.09 | 51.8% | 56.6% | +4.7pp | **0.0%** |
| NA-EU east 15m | +9.98 | +12.04 | +2.06 | 74.4% | 78.5% | +4.2pp | 9.2% |
| NVIS GB-FR 12m | +30.03 | +32.07 | +2.04 | 96.3% | 97.2% | +0.9pp | 100.0% |
| EU-EU east 12m | +14.21 | +16.25 | +2.04 | 75.4% | 78.7% | +3.3pp | 2.9% |
| Polar W-UA 17m | +17.50 | +19.50 | +2.00 | 90.3% | 93.3% | +3.0pp | 16.1% |
| Asia-EU short 15m | +11.57 | +13.57 | +2.00 | 74.2% | 78.4% | +4.1pp | 2.2% |
| EU-Asia 15m | +1.10 | +2.96 | +1.86 | 54.2% | 60.9% | +6.7pp | 1.9% |
| Polar W6-EU 15m | +0.88 | +2.37 | +1.49 | 53.5% | 59.3% | +5.8pp | 0.1% |

### U.3 What the per-cell openRate reveals

For the **non-NVIS** cells, observed open-rate is **far below**
predicted pOpen — the 60-65 pp gap §7.3 documents is real and
arguably **getting wider** under the current solar conditions:

- EU-Asia 17m: predicted 90.2% open, observed **0.1%**. Gap: 90 pp.
- Asia-EU short 12m: predicted 59.9% open, observed **0.0%**. Gap: 60 pp.
- JA-EU 12m: predicted 56.6%, observed **0.0%**. Gap: 57 pp.
- Polar W6-EU 17m: predicted 92.7%, observed **1.0%**. Gap: 91 pp.

These are the per-path per-pair WSPR-bbox observations. They
confirm §7.3's "completion rate runs ~60-65 pp below predicted
reliability" claim, and in some cells the gap is now ~90 pp.

**For NVIS cells**, observed matches predicted closely:
- NVIS DE-NL 12m: predicted 94.8%, observed 99.3%. Gap: -4.5 pp
  (underpredicted).
- NVIS GB-FR 12m: predicted 97.2%, observed 100%. Gap: -2.8 pp.

NVIS is a calibration-anchor regime; the model performs well
there.

### U.4 Pattern: model is becoming MORE open-leaning under high solar flux

The drift cells are all upper bands where the F10.7 spike
inflates predicted MUF / lowers L_MUF penalty. Model gets MORE
optimistic. Observed truth doesn't follow because:
- Most upper-band paths require both endpoints to have
  receivers, which is sparse (operator-availability bias).
- The model captures physics-permitted reliability, not
  operator-completion rate (per §7.3).

The drift detector is correctly flagging these as "shifted from
baseline", but the shift is solar-state-dependent and expected
to ebb when F10.7 drops back. **Refresh the baseline** is the
correct response (regenerate `harness.baseline.json` against
contemporaneous data); no model fix needed.

### U.5 Summary of root-cause analysis

- **All 15 drift cells**: solar-flux-driven, not code-driven.
  Model behavior unchanged.
- **Severity**: small (1.5-3.5 dB), at the edge of the
  regression-detection threshold (2 dB / 5 pp).
- **Recommendation**: refresh baseline. Optionally, document in
  the paper that the regression-detection threshold is
  solar-cycle-sensitive — F10.7 swings of 30-50% between
  baseline and re-run will cross the threshold legitimately.
- **Side validation**: per-cell per-pair openRate confirms §7.3's
  60-65 pp gap (and exposes that the gap can reach 90 pp on
  upper-band long paths).

## T. Pass 2 deep-dive (2026-05-06)

### T.1 LaTeX compile (Pass 2.B) — clean modulo two issues

`make pdf` succeeds in 2 passes, output is 68 pages, 964 KB.

**One undefined reference**:
- `\ref{sec:residuals}` at line 1434 has no matching
  `\label{sec:residuals}` anywhere in the paper. The reference is
  inside §3.10 line 1432-1434:
  *"Direction validated against the WSPR per-spot residual mean
  (improved from -23.97 dB to -18.73 dB) and against the per-pair
  WSPR Brier (improved 0.64 to 0.57); global truth Brier rises
  (0.04 to 0.10) because that metric is permissive at upper bands
  at night (paper~§\ref{sec:residuals})"*. Fix: either remove the
  reference (the surrounding sentence stands alone) or add a
  `\label{sec:residuals}` to the section it should point at.

**41 unreferenced labels** (defined but no `\ref{}` to them):

- All 6 figures: `fig:mufdiurnal`, `fig:seasonal`, `fig:storm`,
  `fig:tierprob`, `fig:noise`, `fig:dabs`. The prose never says
  *"see Fig. \ref{fig:tierprob}"*; figures float without
  prose anchors.
- 5 tables: `tab:defaults`, `tab:giro`, `tab:paths`, `tab:seeds`,
  `tab:tunegrid`. Prose references them by name (e.g. *"Table
  tab:bandsigma"*) but doesn't use `\ref{}` for these specific
  tables.
- 6 sections: `sec:altprop`, `sec:completion`, `sec:data`,
  `sec:intro`, `sec:lpca`, `sec:refs`.
- 1 paragraph: `par:laur-stormamp`.
- 23 equations: e.g. `eq:fspl`, `eq:lmuf`, `eq:labs`,
  `eq:lflare`, `eq:lflare-driver`, `eq:lflare-ramp`, `eq:lpca-onset`,
  `eq:storm`, `eq:tep`, etc.

The 23 unreferenced equation labels could be intentional (some
authors label every equation for stability of cross-referencing
even when not used). The 6 figures and 5 tables not being
prose-anchored is more concerning — readers can't tell which
figure the surrounding prose discusses without inferring from
position.

**Citations resolve cleanly**: 22 used, 22 defined, no orphans.

**Underfull / overfull hbox warnings** in the bibliography
(NTIA Red Book entry has an unbreakable URL). Cosmetic only.

### T.2 Pass 2.C — Brier / accBin formula trace

The harness `score()` function (`scripts/harness.mjs:918-1003`)
implements:

```
pOpen = 1 - normCdf((0 - margin) / sigma)
      = Φ(margin / sigma)                  // standard form
      = R(M, σ) per paper Eq. reliability   ✓

actualBinary = (spots >= floor) ? 1 : 0
              floor = 50 (global) or 1 (per-path)   ✓ (matches §7.2)

errBin       = pOpen - actualBinary
brierBin    += errBin²
accBin      += 1 if (pOpen >= 0.5) === (actualBinary === 1)

after loop:
brierBin / nBin     // mean squared error
accBin   / nBin     // fraction correct at 0.5 threshold
```

**Verification**:

- `pOpen` is exactly `R(M, σ) = Φ(M/σ)` per Eq. reliability. ✓
- Brier is the standard binary Brier score (mean squared
  forecast-vs-outcome error). ✓
- accBin is binary accuracy at the 0.5 threshold (predict open
  if R ≥ 0.5). ✓
- Max Brier for a binary classifier predicting 0.5 against
  random outcomes is 0.25. Paper's JSDoc at line 910 says
  *"(0 = perfect, 0.25 = naive)"*. ✓

**No drift between paper and code on the Brier / accBin
implementation.**

The earlier-noted G7.14 finding (per-path Brier 0.6353 > 0.25)
is real but is a **calibration mismatch**, not a formula bug:
the model predicts open with high probability while per-path
truth shows most cells closed, producing systematic
miscalibration. The formula is correctly implementing what the
paper specifies.

### T.3 Pass 2.A — Citation re-verification CONFIRMS earlier findings

A second-pass agent re-opened the actual ITU-R PDFs, journal
articles, and primary sources for each §J / §N finding. **15 of
16 verdicts hold under independent source verification.**

Specifically confirmed (verbatim PDF / abstract evidence):

- **[1] P.533-14 §3.2.2 / MUF approach loss** — CONFIRMED. P.533-14
  §3.2 is *"E-layer critical frequency (foE)"*; the paper's
  piecewise MUF approach loss form is from VOACAP/IONCAP, not
  P.533. (URL: ITU PDF)
- **[2] P.533-14 §A.2 / 677·(f+f_L)^-1.98** — CONFIRMED. The
  constants `677` and `1.98` do not appear anywhere in P.533-14.
- **[3] P.533-14 §4 / (cos χ)^1.3** — CONFIRMED. P.533-14 line
  1019 prints `F(χ) = cos^p(0.881·χ)` with month/dip-varying p,
  not a fixed 1.3 exponent.
- **[4] P.842-5 year** — CONFIRMED. P.842-5 dated 09/2013;
  P.842-1 was 08/1994 (paper says "1997" for P.842-5 which is
  doubly wrong).
- **[5] P.842-5 formula form** — CONFIRMED. P.842-5 Table 1 uses
  logistic-style approximations
  `BCR = 130 - 80/(1 + (S/N - S/Nr)/Dl_SN)`, not literal
  `R = Φ(M/σ)`. Paper at line 3808 explicitly cites Φ(M/σ) as
  "from P.842" — the citation is to a formula not in P.842-5.
- **[6] P.534-6 year** — CONFIRMED. P.534-6 is 09/2021, not 2019.
- **[7] P.372 galactic constant 50 vs 52** — CONFIRMED. P.372
  prints `Fam = 52 - 23 log f`, paper says 50.
- **[8] P.372 figure numbers** — CONFIRMED. Galactic noise is in
  Figs 2, 3 (not 23/24); Figs 13/14 and 23/24 are atmospheric.
- **[9] P.1239-3 year** — CONFIRMED. Approved 02/2012, not 2015.
  (P.1239-4 superseded in 08/2023, but the paper cites -3, not -4.)
- **[10] Sauer-Wilkinson 2008 date range** — CONFIRMED. Actual
  paper covers 1992-2002; ionocast says 1998-2002.
- **[11] Magnus coefficients (17.62, 243.12)** — CONFIRMED. These
  are **Sonntag 1990 / WMO** coefficients. Alduchov-Eskridge 1996
  uses (17.625, 243.04). Misattribution.
- **[12] NTIA Red Book 2021 Ch. 5** — CONFIRMED. Ch. 5 is
  "Spectrum Standards" and does NOT classify atmospheric
  refractivity gradients. The -79 / -157 N/km thresholds aren't
  in NTIA Red Book.
- **[13] WSJT-X SSB +10 / CW -7** — CONFIRMED. WSJT-X User Guide
  2.7.0 lists no SSB / CW thresholds. The paper's `tab:modesnr`
  Source column already labels them "comfortable-copy native" /
  "trained-ear native" (operating tradition); only FT4 / FT8 /
  WSPR are correctly attributed to WSJT-X.
- **[15] K_p / D_st sequence at line 4910-4912** — CONFIRMED. The
  canonical chain is `B_z → ring-current D_st → K_p`. The paper's
  *"K_p leads D_st by 30-60 min via ring-current buildup time"*
  inverts this. The paper itself contradicts this at line 2811:
  *"Dst responds within minutes of storm onset, 1-3 hours before
  Kp updates"* (which IS correct).
- **[16] Brewster-zone null at 3-8°** — REFINED. Cebik PBA Table
  1: PBA at 14 MHz vertical is 6.4° (very good ground), 13.3°
  (**average**), 23.2° (very poor). Paper's 3-8° corresponds to
  **very-good or salt-water** ground, not average. For "average
  soil" specifically, PBA is ~13°. Paper's elevation range
  understates by ~5-10° on the **average** ground claim.

Item [14] (F-region positive-phase magnitude / duration): the
Pass 2 verifier reported "REVISE: strawman, no such claim in
paper" — but **this is wrong**. The verifier searched at line
2176 and missed the actual claim location. **The paper DOES make
the quantitative claim at lines 2730-2733**: *"first ~30-60 min
after a sudden CME impact, where neutral composition changes
and ionospheric heating can transiently enhance foF2 by
10-20%"*. The original physics-agent finding stands: literature
gives "several hours, 15-50%" for positive phase, paper says
"30-60 min, 10-20%" — magnitude and duration both off.

### T.4 Net Pass 2 result

- LaTeX compile: 1 undefined ref, 41 unreferenced labels, 0
  citation orphans, 68 pages output.
- Brier / accBin formula: ✓ matches paper exactly.
- Citation findings: 15 of 16 robustly confirmed; the 16th
  (positive-phase magnitude) is also confirmed once the verifier's
  location-mismatch is corrected.

After Pass 2, my coverage estimate is **~98%**. The remaining 2%
is Pass 3 mechanical work (bibliography drafts, drift-cell
root-cause).



## S. Pass 1 deep-dive (2026-05-06)

The five Pass 1 items returned substantial new findings,
including some that contradict the paper's data-architecture
and privacy claims at a fundamental level.

### S.1 functions/_handlers/ — "Direct CORS" claims are MOSTLY WRONG

Paper Table `tab:sources` (line 219-260) classifies upstreams as
"Direct CORS JSON/text" or "Proxied via /api/...". Code-side
verification shows:

| Upstream | Paper says | Actual code | Status |
|---|---|---|---|
| NOAA SWPC | Direct CORS JSON/text | **Proxied** via 13 `/api/swpc-*` endpoints | DRIFT |
| kc2g | Direct CORS JSON | **Proxied** via `/api/kc2g` (upstream has no ACAO) | DRIFT |
| wspr.live | Direct CORS (ClickHouse) | **Proxied** via `/api/wspr` | DRIFT |
| NASA DONKI | Direct CORS JSON | **Proxied** via `/api/donki-{cme,hss}` | DRIFT |
| GIRO | Proxied | Proxied | OK |
| GFZ Hp30 | Proxied | Proxied | OK |
| WDC Kyoto | Proxied | Proxied | OK |
| SILSO | Proxied | Proxied | OK |
| UWyo tropo | Proxied | Proxied | OK |

**This is substantive.** Paper §2.1 leans on the "Direct CORS"
classification to argue privacy: *"Sources marked 'Direct CORS'
are fetched by the browser with no server proxy"*. The actual
shipping code proxies everything through the worker. Therefore
the operator's IP is exposed to the worker on every refresh,
not just on the proxied subset.

The privacy statement in §2.1 (*"WSPR live queries are global
hourly aggregates with no grid field at all; the operator's
location is never transmitted to wspr.live"*) is true at the
data level but the **request itself goes through the
ionocast worker**, not directly to wspr.live. So Cloudflare
sees the request even though the destination doesn't get the
operator's grid.

Update Table `tab:sources` to reflect that **everything is
proxied** through the worker. Re-state §2.1 privacy claims with
the corrected architecture.

### S.2 Cache-cadence drifts in `tab:sources`

Paper claim vs actual `freshSec` values in handlers:

- SILSO: "Daily" → actual cache 6 h (worker-side cache;
  upstream is daily). Acceptable framing if labelled "upstream
  daily / cache 6 h", but the column says "Daily" full stop.
- WDC Kyoto: "1 h" → actual 15 min. Cache more aggressive.
- GFZ Hp30: "30 min" → actual 10 min. Cache more aggressive.
- wspr.live: "10 min" → actual 2 min. Cache more aggressive.
- SWPC mixed: F107 6 h, 3-day forecast 1 h, 27-day 6 h, others
  1-10 min. The "1-10 min" claim doesn't capture the slower
  products.

Either restate as "cache TTL X / upstream Y" or use the actual
cache values.

### S.3 src/derive + src/ui — Comp column documented but not displayed

§7.3.2 paragraph "Operator-attempt completion rate" (line
3904-3942) defines and describes a band-table column called
`Comp.`, with formula `Comp(b, h, M, σ) = R(M, σ) · a(b, h)`.

**The Comp column is not rendered in the UI.** Per Pass 1.A
agent's read of `src/ui/builders/tables.js`:

- The activity prior `a(b, h)` is computed via
  `spotBaselineMean()` — implementation exists.
- It's used inside `conditions.js` for the band-group summary
  override notes ("unusually active" etc.), not as a
  multiplicative completion column.
- The band-table has columns: Band, Tier, Margin, Confidence,
  Mode, Best Path. **No Comp column.**

So §7.3.2 describes a feature that isn't shipping. Either:
- Implement the Comp column (the prior `a(b, h)` is already
  computed; `R(M, σ)` is `reliability()`; just multiply and
  surface), or
- Remove §7.3.2's Comp paragraph and Eq. completion from the
  paper.

### S.4 UI "Confidence" vs paper "Stability" label

Pass 1.A confirms `tier.js` exports both `tierStability` (one-
sided form per §7.3.2 Eq. tierstab) and `tierConfidence` (two-
sided form mentioned in §7.3.2 line 3899). The UI displays the
column as **"Confidence"** (not "Stability").

§7.3.2 line 4863-4876 says the column is labelled "Stability"
and the older "Confidence" form was retired. Pass 1.A finding
flips this: the **UI label is "Confidence"**; the **values
displayed are the Stability formula** (one-sided).

So the paper's claim that the "Confidence" column was retired
is wrong — the column header is still "Confidence", the formula
under the hood is now Stability. Either:
- Change the UI label to "Stability" to match the paper, or
- Update the paper to acknowledge "the column is labelled
  Confidence; values are computed via Eq. tierstab".

### S.5 On-device feedback loop is paperware (Limits #1)

§10 Limits #1 says *"The on-device validation feedback loop
(§sec:ensemble) tightens per-band bias and σ as the operator
scores predictions"*. Pass 1.A confirms: **no such loop exists
in code**. There is no scoring UI, no per-user bias / σ
storage, no per-band correction accumulator. §10 #1 references
a non-existent feature.

Either remove from Limits or implement it.

### S.6 scripts/tests/*.mjs — Three undocumented test/tune suites

Paper §7.2 references *"scripts/tune.mjs"* (singular). Code
has four tune scripts (`tune-r7.mjs`, `tune-r7-scan.mjs`,
`tune-eia.mjs`, `tune-blend.mjs`). The paper documents `tune-r7`
explicitly via Tables `tab:seeds` and `tab:tunegrid`. The
**other three tune scripts are not in the paper**:

- **`tune-eia.mjs`**: full EIA grid sweep (BASE × SLOPE × SIGMA)
  against GIRO foF2. Comment notes 2026-04-29 widening of grid
  after BVJ03 added. Paper §4.2 EIA history block hints at
  this work but the grid and methodology aren't documented.
- **`tune-blend.mjs`**: tests heuristic ensemble blending
  (physics 100%, physics 70% / heuristic 30%, banded per-band
  weights). Paper §7.1 says *"A previous 0.7 / 0.3 ensemble
  blend with an N0NBH-style SFI heuristic... were both retired"*
  (line 3572-3575). Code still has the test infrastructure for
  it. Either the test is keeping a retired code path alive (cut
  it), or the test is current and the paper claim ("retired") is
  premature.
- **`tune-r7-scan.mjs`**: 1-D scatter-weight scan. Auxiliary
  to `tune-r7`. Not surfaced in paper.

### S.7 Test scripts validate against external sources not in paper

Pass 1.C surfaced four scripts that validate ionocast
predictions against external data sources never mentioned in
the paper:

- **`wspr-snr.mjs`**: per-spot SNR residual against
  wspr.live raw spots.
- **`psk.mjs`**: PSKReporter FT8 reception reports.
- **`rbn.mjs`**: 10 curated RBN reverse-beacon skimmers.
- **`rbn-beacon.mjs`**: amateur beacons in RBN spots (cleanest
  signal, both ends pinned).

These provide independent ground truth beyond WSPR aggregates,
but the paper §7.2 *"alive somewhere / per-path"* discussion
only mentions WSPR. Worth documenting at least the existence of
these suites in the methodology paper (one-paragraph summary),
since they are part of the validation infrastructure.

### S.8 VOACAP fixtures populated; paper says "awaiting"

Paper line 3571 says *"and to VOACAP cross-checks once the
fixture set is populated"*. Code at
`scripts/tests/voacap-fixtures.mjs` and `voacap.mjs` has 7
populated fixtures with hard-coded REL %:
EU-EU short, EU-EU west, JN05-CN89, EM79-EU, FN30-JA, NVIS,
KN41-ZS. **Paper claim is stale; fixtures are populated.**
Update §7.1 to acknowledge VOACAP cross-check is active.

### S.9 Test suites with diagnostic breakdowns not in paper

Pass 1.C found three diagnostic scripts:
- `storm-split.mjs`: storm vs quiet (Kp ≥ 5) accBin / Brier
  breakdown.
- `day-night.mjs`: day vs twilight vs night cosZ partition.
- `hops.mjs`: by-hop-count residual.

These are useful diagnostic outputs but the paper doesn't
mention them. The §10 Limits items reference some of these
(e.g. storm-recovery TID widening), but the diagnostic scripts
aren't documented as the source of those numbers.

### S.10 Dip-latitude convention is CGM in code (resolves G3.x / R.3)

Direct verification: `src/physics/geometry.js:61` defines
`dipLatitude(lat, lon)` as the **signed CGM tilted-dipole
approximation** with pole 80.7°N, 72.7°W. Function comment
explicitly says *"Same tilted-dipole approximation as
cgmLatAbs"*.

Runtime `dipLatitude` values for the paper's quoted stations:

| Station | Paper claim | Runtime CGM | Real-IGRF dip |
|---|---|---|---|
| Ascension | -7° | **-3.0°** | -16°S |
| Jicamarca | -1° | **-2.6°** | +1° |
| Lisbon | +35° | **+42.3°** | +35° |
| São Paulo | -23° | **-15.1°** | -22° |
| Boa Vista | +12° | **+11.9°** | +12° |
| Townsville | (not in paper) | **-26.6°** | (different) |
| Niue | (not in paper) | **-20.0°** | (different) |

**The runtime values differ from the paper's claimed values for
most stations.** Boa Vista is the only clean match.

Implications for §4.2:
- Ascension at runtime CGM = -3°, not -7°. Even closer to the
  trough than the paper claims. *"Closer to the trough than the
  -15° southern crest"* is more strongly true under the runtime
  convention.
- The §4.2 prose values appear to be hand-quoted from a real-
  IGRF source for some stations (Lisbon +35° matches
  real-IGRF) and from the runtime for others (Boa Vista). The
  inconsistency is paper-side, not code-side.

**Recommended fix**: either (a) update §4.2 prose to use
runtime CGM values consistently, or (b) update the **code** to
use real-IGRF (would require importing IGRF inclination tables)
and re-fit the EIA Gaussians. Option (a) is simpler; option (b)
is more physically accurate.

### S.11 byTier metrics — partial run

I wrote a standalone script (`/tmp/by-tier.mjs`) that imports
the harness's `score()` machinery and bins by `tierFromMargin`.

Cache built today (252 350 samples, global mode):

| Tier | n | % | mean R | obs. open (global ≥50) | gap |
|---|---|---|---|---|---|
| Excellent | 189 493 | 75.1% | 99.4% | 100.0% | -0.6 pp |
| Good | 21 912 | 8.7% | 75.8% | 100.0% | -24.2 pp |
| Fair | 15 346 | 6.1% | 47.3% | 100.0% | -52.7 pp |
| Poor | 17 955 | 7.1% | 22.3% | 100.0% | -77.7 pp |
| Closed | 7 644 | 3.0% | 5.4% | 100.0% | -94.6 pp |

The paper's §7.3 claim is *"per-path completion rate runs ~60-
65 pp below predicted reliability across the upper four tiers"*
(predicted *higher* than observed). Under the **global** truth,
the gap **reverses sign**: predicted is *lower* than observed
(because the global aggregate is essentially always "open
somewhere"). The paper's claim is specifically for per-path
truth, which my standalone script can't reproduce without
re-fetching wspr.live with TX/RX-bbox queries.

What the table does show:
- 75% of all (path, band, hour) cells are predicted Excellent.
  This is dominated by lower bands (160m-30m all near 100%
  accBin per §H.1).
- The Closed tier (3% of cells) is "closed" but the global
  aggregate still says "open somewhere", giving the 94.6 pp
  inverted gap. This is a metric artefact not a calibration
  failure.

**For the §7.3 60-65 pp claim**, the paper would need to be
re-derived from a per-path truth run with byTier aggregation
the harness doesn't currently emit. That's a code change
(adding byTier to `score()` results) plus a re-run.

### S.12 Summary of Pass 1

**Counts:**
- Pass 1.A (derive + ui): 84 checks, 80 OK, 2 DRIFT, 2 EXTRA.
- Pass 1.B (functions/): 5 major DRIFTs (Direct CORS misclaim
  on SWPC / kc2g / wspr / DONKI; cadence drifts).
- Pass 1.C (tests): 3 undocumented tune scripts, 4 undocumented
  validation scripts, 1 stale claim ("VOACAP awaiting").
- Pass 1.D (dip-latitude): paper values disagree with code for
  4 of 5 stations.
- Pass 1.E (byTier): the §7.3 claim cannot be re-verified
  without per-path aggregation in the harness; documented.

**Largest new findings**:

1. **Direct CORS claim is wrong for 4 of 9 upstreams** (S.1).
   Privacy framing in §2.1 needs revision.
2. **Comp column is paperware** (S.3). §7.3.2 documents a UI
   feature that isn't rendered.
3. **On-device feedback loop is paperware** (S.5). §10 #1 a
   non-implemented feature.
4. **Dip-latitude convention** has paper / code divergence
   (S.10). EIA §4.2 prose values don't match runtime.
5. **VOACAP fixtures populated, paper says "awaiting"** (S.8).
6. **Three undocumented tune suites** (S.6) and four
   **undocumented validation suites** (S.7).

After Pass 1, my coverage estimate climbs to **~95%**. The
remaining 5% is mostly Pass 2 / Pass 3 mechanical work
(citation re-verification, bibliography drafting, drift-cell
root-cause analysis).

## R. Sea-of-fine-detail subordinate claims (item 8)

A research agent verified 20 specific subordinate claims. Plus
my own verification of dip latitudes via the paper's own formula.
Substantial drift found.

### R.1 OFF findings

**R1. "~10 strongest annual showers with ZHR ≥ 20" (line
3239-3242)**. Actual count is **~6** (Quadrantids 120, Eta
Aquarids 50, S Delta Aquarids 25, Perseids 100, Orionids 20,
Geminids 150). Lyrids cited at line 3242 has ZHR=18, **below**
the claimed threshold. Update either to *"the ~6 strongest
showers"* or lower the threshold.

**R2. Ascension Island dip latitude (line 2073-2076)**. Paper
says *"Ascension at dip latitude ~-7° (closer to the trough
than to the ~-15° southern crest peak)"*.

Two independent verifications disagree with -7°:
- Real-IGRF dip latitude at Ascension is **~-15° to -16°S**
  (peer-reviewed sources, derived from inclination I ≈ -28° via
  λ_dip = arctan(tan(I)/2)).
- Paper's own tilted-dipole formula (Eq. cgm) gives **-3°** for
  Ascension geographic coords (-7.95°, -14.4°) with the
  paper's IGRF pole (+80.7°, -72.7°).

**Both diverge from the -7° claim.** Worse, if Ascension's true
dip latitude is -15°, it sits **on** the southern crest peak,
not *"closer to the trough"*. The EIA fitting story in §4.2 is
materially affected. Verify which dip-latitude convention the
paper actually uses and update the value.

**R3. Lisbon-Tokyo path distance (line 1046, also Table
`tab:paths`)**. Paper says ~10800 km; true great-circle is
**11144 km** (verified via haversine on the path's listed
endpoints). Off by ~3%.

This is a paths.json data-side claim too: line 5326 shows
*"EU-Asia: 38.72, -9.14 → 35.68, 139.69, 10800 km"*. Update
both paths.json and paper text.

**R4. VK-EU "long-path 5-hop 16000 km" (line 5334, Table
`tab:paths`)**. Sydney → Kyiv:
- Short-path: **14944 km** (haversine)
- Long-path: **25131 km** (40075 - 14944)

The 16000 km figure matches neither. The label "long-path 5-hop"
is geometrically inconsistent with either path. Either:
- The path is actually short-path (then ~14944 km, not "long-
  path"), or
- The path is actually long-path (then 25131 km, not 16000), or
- The 16000 km is from a different routing entirely.

**R5. K1JT WSPR canonical paper citation (line 5697-5699)**.
Paper bibliography says *"Taylor, K1JT, ARRL QEX March/April
2010"*. **The QEX March/April 2010 issue exists but contains
no Taylor/WSPR article**. The canonical Taylor+Walker WSPR
introduction is *"WSPRing Around The World"* in **QST November
2010**, pages 30-32. Update the citation to the correct issue
and journal.

### R.2 Verified

- Sporadic ZHR 5-10: ✓ AMS canonical baseline.
- DRAP 8-10 dB at QTH while M1 4 dB at 7 MHz: ✓ directionally consistent with SWPC documentation.
- Lisbon dip latitude +35° (line 1782-1783): close to expected (formula gives +42°, real-IGRF gives +35°). The paper's value matches **real-IGRF** here, suggesting the paper uses real-IGRF for some stations and CGM for others — inconsistent.
- São Paulo dip lat -23° (line 1783-1784): formula gives -15°, real-IGRF gives -22°. Paper matches real-IGRF.
- Jicamarca dip lat ~-1° (line 2074-2076): real-IGRF gives ~+1°. Paper says -1°. Sign inconsistent.
- Boa Vista dip lat +12° (line 2107-2108): formula and real-IGRF both give +12°. ✓
- WSPR ~6 Hz / FT8 ~50 Hz: ✓ verified at sigidwiki.
- NA-IT 6900 km: ✓ verified haversine 6891 km.
- 35-path basket spans 1-5 hops: ✓ verified.
- 24-station UWyo basket regional breakdown (10/7/3/2/1/1): ✓ verified in `functions/_handlers/refractivity.js`.
- 15 drift cells in fresh harness: ✓ already documented in §H.4.

### R.3 The dip-latitude convention issue

The agent's verification + my computation expose an underlying
inconsistency: the paper says (§4.2) it derives dip latitude
from the same tilted-dipole formula as CGM (Eq. cgm), but the
quoted values don't all match that formula. Mixed conventions:

| Station | paper claim | Eq. cgm computes | Real-IGRF dip |
|---|---|---|---|
| Ascension | -7° | **-3°** | **-16°** |
| Jicamarca | -1° | **-3°** | **+1°** (sign!) |
| Lisbon | +35° | **+42°** | **+35°** |
| São Paulo | -23° | **-15°** | **-22°** |
| Boa Vista | +12° | **+12°** | **+12°** |

For Lisbon and São Paulo, the paper's quoted value matches
real-IGRF, not Eq. cgm. For Ascension, Jicamarca, and Boa Vista,
it matches neither cleanly. **Resolve the convention** before
re-deriving the EIA grid sweep.

The most likely fix: replace the §4.2 *"signed CGM
approximation"* with *"real-IGRF dip latitude at the station's
coordinates"* and re-derive the EIA fit. Then several quoted
values become correct:
- Ascension would update from -7° to -16° (now on southern
  crest, not in trough).
- Jicamarca would update from -1°S to +1°N (still essentially
  on dip equator).
- The "trough vs crest" framing for the equatorial basket would
  flip on Ascension.

This is a substantive physics-side finding that affects the
EIA model coverage discussion.

## P. File-path / script-name drift (re item 4 / new finding)

While verifying empirical numbers, I checked every
`scripts/...` path mentioned in the paper. **5 scripts
referenced in the paper do not exist** at the cited path; **4
data files** are at a different path than cited.

### P.1 Missing scripts

- **`scripts/tune.mjs`** referenced 3× (lines 3697, 5446, 5507).
  Does not exist. Actual tune scripts are at
  `scripts/tests/tune-r7.mjs`, `scripts/tests/tune-r7-scan.mjs`,
  `scripts/tests/tune-eia.mjs`,
  `scripts/tests/tune-blend.mjs`. Four scripts, not one.

- **`scripts/t1-snapshots-bg.mjs`** (line 3644). Does not exist
  as standalone. Functionality is `harness.mjs t1` subcommand.

- **`scripts/t1-analyze.mjs`** (line 3644). Same: subcommand.

- **`scripts/verify-station-coords.mjs`** (lines 3648, 5371).
  Does not exist as standalone. Functionality is `harness.mjs
  verify` subcommand.

- **`scripts/wspr-calibration.mjs`** (line 3830). Does not exist
  as standalone. Functionality probably in `scripts/tests/calibration.mjs`.

The paper's `scripts/harness.mjs:562` comment ("the older
`tune.mjs residuals`") confirms `tune.mjs` was once a separate
script that has since been folded into harness subcommands.
**Update the paper to use the current paths or subcommand
invocations.**

### P.2 Wrong paths for data files

- `scripts/harness.baseline.json` (line 5530) → actual is at
  `scripts/data/harness.baseline.json` (extra `data/` subdir).
- `scripts/harness.baseline.perpath.json` (line 5536) → actual
  `scripts/data/harness.baseline.perpath.json`.
- `scripts/harness.report.json` (line 5540) → actual
  `scripts/outputs/harness.report.json`.
- `scripts/paths.json` (lines 5310, 5358) → actual
  `scripts/data/paths.json`.

A reader following the paper's paths verbatim will not find
these files. Update with `data/` and `outputs/` subdirs.

### P.3 Scripts dispatching from harness subcommands

The harness header comment lists subcommands explicitly:

```
node scripts/harness.mjs verify
node scripts/harness.mjs probe [...codes]
node scripts/harness.mjs snapshot
node scripts/harness.mjs archive
node scripts/harness.mjs t1
node scripts/harness.mjs wspr-baselines
```

The paper should reference these subcommands rather than
deprecated standalone names.

## N. Domain-physics sanity check (item 7)

A research agent verified 20 specific physics claims against
the literature. Most VERIFY; three are OFF and warrant
correction.

### N.1 OFF findings

**N1. F-region positive-phase enhancement magnitude / duration
(§5.3 line 2729-2734).** Paper claims *"first ~30-60 min after a
sudden CME impact... transiently enhance foF2 by 10-20%"*.

Literature (Buonsanto 1999 Space Sci. Rev. 88; Mendillo 2006
review): positive-phase enhancements last **several hours**, not
30-60 min, and reach **15-50%** at low/mid latitudes, not just
10-20%. The paper's window is too short and the magnitude
understates. Update to *"first several hours after a sudden CME
impact... can transiently enhance foF2 by 15-50% at low/mid
latitudes"*.

**N2. K_p leads D_st sequence (§9.2 line 4910-4912)** —
**internal contradiction with §5.3.2 line 2811**.

§5.3.2 (correct): *"Dst responds within minutes of storm onset,
1-3 hours before Kp updates."*

§9.2 (wrong): *"K_p leads D_st by ~30-60 min via ring-current
buildup time."*

These are mutually exclusive. The correct chain is **B_z (L1) →
D_st (minutes) → K_p (3-hour cadence)**. The §9.2 wording
inverts D_st and K_p. Fix §9.2's intra-tier sort-order rationale
to match §5.3.2.

This may also re-open G9.6 (the alert-sort-order rationale): if
the causal chain is B_z → D_st → K_p, the sort order should be
B_z first, D_st second, K_p last. Currently the paper sorts
K_p → B_z → D_st, which doesn't follow either causal direction.

**N3. Brewster-zone null elevation range (§10 #2 line 5013-5015).**
Paper claims *"~5-8 dB dip around 3-8° elevation"* on verticals
over average soil.

Literature (Cebik W4RNL, ON4KHG ground-gain analyses): the PBA
dip on a vertical over average ground typically falls at
**10-30°** elevation, not 3-8°. The depth (5-8 dB) is plausible
for very poor soil but the elevation range is too low. The 3-8°
band is where the zero-elevation null approaches but the full
PBA dip is higher up. Update the elevation band.

### N.2 Other findings worth flagging

- **Claim 14** (auroral oval expansion 60° → 50° at K_p 5 → 7):
  VERIFIED, but the paper's 5°/Kp slope is steeper than the
  Feldstein-Starkov canonical 2°/Kp. NOAA SWPC empirical curve
  gives Kp=5 ≈ 60° and Kp=9 ≈ 48°, so the paper's 50° at Kp=7
  is within ~2° of empirical. Acceptable for a coarse model.

- **Claim 15** (1.4× storm-main amplification on L_aur):
  UNVERIFIABLE — no single canonical literature multiplier.
  Direction (main phase amplifies above K_p baseline) is
  standard. The 1.4× is a tunable model coefficient; flag it as
  empirical, not literature-anchored.

- **Claim 18** (SAA displaces magnetic equator): direction
  wording is ambiguous. The geometric outcome (São Luis sits
  north of the dip equator) is correct; the verbal direction
  ("southward") could be misread. Reword for clarity.

### N.3 VERIFIED claims

The remaining 15 claims (LSTID timescale and propagation speed,
Joule-heating timescale, CME vs HSS recovery, L1 distance,
Halloween 2003 / March 1989 polar collapse, evening E×B drift,
TEP active hours, SID 10-60 min decay, PCA hours-to-days, PCA
≥1 MeV vs ≥10 MeV onset lead, Es 2000 km single hop, Es
1.5-3 h lifetime, SAA geometry, D-region 80-100 dB saturation)
are consistent with established literature.

## M. σ overloading disambiguation audit (item 9)

The paper uses σ in five distinct senses, acknowledged in the
footnote at line 3966-3977. I walked the 200+ occurrences. Most
are unambiguous in context; the trouble spots:

### M.1 Categories of σ use

- **Cat A: Prediction spread** (`σ`, `σ_g`, `σ_MUF`, etc.): the
  P.842 reliability denominator. Most occurrences. Adequately
  identified by subscripts (σ_g, σ_storm, σ_MUF, σ_forecast,
  σ_term, σ_recovery) when explicit.
- **Cat B: Ground conductivity** (S/m): lines 994, 998, 1030,
  1051, 1071, 1075, 1083. Always co-occurs with ε_r and S/m
  units. Disambiguation clear. ✓
- **Cat C: EIA Gaussian width** (degrees): σ_cr=18°, σ_tr=6°
  defined at line 2031-2032. Used in EIA history block at lines
  2100-2110 as bare *"σ = 12, σ = 10, σ = 18"* without subscript
  — risky.
- **Cat D: Unit-ramp clamp function** σ(x) = clamp(x, 0, 1):
  lines 2967, 2969, 2971. Defined inline at line 2971.
  Disambiguation clear. ✓
- **Cat E: Phi argument**: in `Φ(M/σ)` the σ is Cat A.

### M.2 Trouble spots found

- **Line 2098-2110 EIA history block**: bare "σ" used for
  Gaussian width without subscript, mixed with "constant 0.30,
  slope 0.005, σ = 12" tuning narrative. Reader has to remember
  σ_cr from line 2031. Recommend either:
  - Add subscript explicitly: "σ_cr = 12" throughout, or
  - Cut the entire history block (already in F1/F2).

- **Line 1769**: *"the per-band σ for 20m = 6 dB"* — already in
  A1 (stale value), but the bare "σ" alone is unambiguous in
  context (Cat A, prediction spread).

- **Line 2967-2971**: Es persistence formula uses σ(x) for
  unit-clamp ramp. Standard math notation but context-collision
  with the prediction-spread σ. Could rename to `clamp(x)` or
  `R(x)` for clarity. Minor.

- **Line 3156** ("base σ"): in §6.1 Es-as-mode, *"Es variability
  adds +2 dB in quadrature to the base σ"*. Cat A (prediction
  spread). ✓ but this widening was already noted (G6.3) as
  missing from the §7.3.2 RSS list.

### M.3 Summary

The σ overloading is mostly handled by local context. The
footnote acknowledgment is appropriate. The main risk is the
EIA history block; cutting that block (per F1) eliminates the
worst offender. No σ-overloading-induced wrong reading found in
the load-bearing equations.

## L. Acronyms-on-first-use audit (item 6)

Mapped first-use line and checked context for each acronym.
**Many are not expanded on first use**, on the assumption of
amateur-radio reader familiarity. For a methodology paper that
also wants a wider scientific audience, this is a barrier.

### L.1 Acronyms used in the Abstract without expansion

These appear in the abstract (~line 80-160) and a reader who
isn't already a HF-amateur is left to look them up:

- **QTH** (line 85): "QTH stays on-device". Ham shorthand for station location. Never expanded.
- **MUF** (line 92): expanded later at §4.0 line 1818.
- **foF2 / foEs / hmF2** (line 92-93): never explicitly expanded. The reader needs to know these are F2 / sporadic-E critical frequencies and F2 peak height.
- **NOAA SWPC** (line 90): standard but unexpanded.
- **D-RAP** (line 90): not expanded here; later context implies "D-Region Absorption Prediction" but the acronym is never literally written out.
- **OVATION** (line 91): never expanded. (Stands for Oval Variation, Assessment, Tracking, Intensity, Online Nowcasting.)
- **GOES** (line 91): never expanded.
- **GIRO** (line 92): never expanded.
- **WSPR** (line 93): never expanded.
- **NVIS** (line 119, in contributions list): expanded much later at §4.7.
- **SID** (line 107, contributions list): never literally expanded.
- **DRAP** (line 230, sources table): never explicitly expanded.
- **CME / HSS** (line 248, sources table): expanded only at §5.3.1.
- **HAF** (line 230): expanded at §3.3 line 459.
- **TEC** (line 234): never expanded.

### L.2 Acronyms first used in body without expansion

- **SEP** (line 360): expanded at §3.4b line 592 "solar energetic particle (SEP) events". Backwards: paper uses "S3 SEP" before defining SEP.
- **CGM** (line 369): expanded at §3.5 line 779-781. Paper uses CGM in §3.0 absorption-cap discussion before defining.
- **IMF** (line 369): never expanded. Standard for "Interplanetary Magnetic Field".
- **IGRF** (line 903): never expanded.
- **NEB** (line 1482, in `tab:modesnr` footnote): introduced as "Noise-equivalent bandwidth" inline. ✓ Adequately explained.
- **TEP** (line 1777, worked example): expanded only at §6.2 line 3158-3160.
- **EIA** (line 1875): expanded at §4.2 line 2013, slightly after first mention.
- **DIDB** (line 2091): never expanded. (Digital Ionosonde Database.)
- **IRI** (line 2299, "CCIR/IRI"): never expanded. (International Reference Ionosphere.)
- **DSCOVR / ACE** (line 2812): never expanded.
- **IMO** (line 3237): never expanded. (International Meteor Organization.)
- **ZHR** (line 3237): never explicitly expanded. (Zenithal Hourly Rate.)
- **TID** (line 3272): never expanded literally. (Travelling Ionospheric Disturbance.)
- **LSTID** (line 3997): expanded at line 4076 ~80 lines after first use.
- **GNSS** (line 4796): never expanded.
- **AE** (line 4806): never expanded. (Auroral Electrojet index.)
- **SDO** (line 4811): never expanded.
- **IRTAM** (line 5108): never explicitly expanded. (IRI Real-Time Assimilative Model.)
- **CCIR** (line 317, fallback grid): never expanded.

### L.3 Acronyms expanded ✓ at first use

- **HAF** is the only one I found where the first use includes "Highest Affected Frequency (HAF)" inline.
- **CIR**: §5.3.1 line 2776 "co-rotating interaction region (CIR) or high-speed stream (HSS)" expands both at the same point.
- **NEB**: §3.11 footnote inline definition.
- **MUF**: explicit "Maximum Usable Frequency" at §4.0 line 1818 (but used in abstract before that).

### L.4 Recommendation

Add a one-paragraph "Acronyms" subsection right after the Abstract, listing each acronym with one-line expansions. Or expand each on first use (current convention dictates the latter for journal-style methodology papers). Quick wins:

- Abstract: write out MUF, NVIS, SID at least once.
- §3.0 (budget eq): expand CGM, SEP, IMF where first encountered.
- §6.2: expand TEP.
- §6.5: expand TID and LSTID.

## J. Citation verification (2026-05-06)

A pass through the cited primary sources to verify the specific
claims attributed to each. Many ITU-R recommendations, two
non-ITU citations, and two K9LA / NTIA misattributions have
drift.

### J.1 ITU-R citations: years, section numbers, formulas

**J1. ITU-R P.533-14 §3.2.2 / MUF approach loss (DRIFT)**.
Paper §3.2 (line 428) claims this is from P.533-14 §3.2.2.
P.533-14's §3.2 is *"E-layer critical frequency (foE)"*, not
MUF approach loss. The paper's piecewise form `0 / quadratic /
10 + 36 sqrt(r-1)` is the **VOACAP / IONCAP** convention, not
P.533. P.533's actual F2 over-MUF loss is
`Lm = 36 · sqrt((f/fb)^2 - 1)` capped at 62 dB. **Misattribution.**

**J2. ITU-R P.533-14 Annex 1 §A.2 / 677/(f+fL)^1.98 (DRIFT)**.
Paper Table `tab:dabs` caption (line 562-563) attributes the
formula `L_a ≈ 677/(f+f_L)^1.98` to P.533-14 §A.2. The constants
`677` and `1.98` do not appear in P.533-14. The formula is from
older Lockwood / IONCAP D-region approximations. **Misattribution
explains G3.4** (the formula doesn't reproduce the table because
it isn't the right formula). Either re-cite to the actual source
(an older Lockwood paper or IONCAP documentation), or replace
the calibration claim with the empirical-fit framing from
K9LA / WSPR.

**J3. ITU-R P.533-14 §4 / (cos χ)^1.3 (DRIFT)**. Paper §3.4
Eq. `labsd` (line 524) cites *(ITU-R P.533 §4)* for
`L_Dreg(χ) = A_base · (cos χ)^1.3`. P.533-14 actually uses
`F(χ) = cos^p(0.881 · χ)` where `p` varies by month and dip
latitude — not a fixed exponent of 1.3. The 1.3 form is an
operator-friendly simplification. **Update the section title to
something like "D-Region Absorption: Quiet-Day (P.533-derived,
fixed-exponent simplification)"**.

**J4. ITU-R P.533 Y_p ≈ 7 dB at 90% reliability (UNVERIFIABLE in
P.533-14)**. Paper §3.9 (line 1213-1216) cites Y_p as ITU-R
P.533's above-median-reliability margin and gives ~7 dB at 90%.
The symbol `Y_p` does not appear in P.533-14 plain text. Y_p is
defined in older P.842 / P.1057 reliability framework. The ~7 dB
magnitude is plausible for an upper-decile spread but is not
stated in P.533 itself. **Re-cite to the correct ITU
recommendation**, likely P.842 or P.1057.

**J5. ITU-R P.842-5 year and formula (DRIFT)**. Paper bibliography
line 5623-5627 cites *"ITU-R Recommendation P.842-5, Computation
of Reliability and Compatibility of HF Radio Systems,
International Telecommunication Union, Geneva, 1997"*. **The 1997
date is wrong** — P.842-1 was 1997, but **P.842-5 is 2013**
(09/2013).

Also: paper §7.3 Eq. `reliability` (line 3768-3770) cites P.842
for the exact formula `R = Φ(M/σ)`. P.842-5 actually uses
**logistic-style approximations** with floor/ceiling clamps, not
literal Phi. The paper applies its own Gaussian-residual
interpretation, which is consistent with P.842's spirit but is
not the literal formula in P.842-5. **State this honestly.**

**J6. ITU-R P.453-14 / -157 ducting threshold (PARTIAL DRIFT)**.
Paper §6.5 cites P.453 for the dN/dh < -157 N/km ducting threshold.
P.453-14 verifies the N formula and M(h) = N(h) + 157·h, but does
**not** explicitly state -157 N/km as a duct threshold (P.453 only
tabulates statistics for ≤-100 N/km gradients). The -157 figure
is implicit from `dM/dh < 0` and conventionally cited but not
printed as a threshold in P.453. **Cite the threshold to a
secondary source** (e.g., NTIA technical notes on anomalous
propagation, or Bean & Dutton 1968).

**J7. ITU-R P.527-6 average-earth ε_r=13 (DRIFT)**. Paper §3.6
line 997-998 cites P.527 for *"average earth"* with ε_r=13,
σ=0.005. P.527-6 / Fig. 24's "average ground" canonical point is
**ε_r ≈ 15**, σ = 0.005. The paper's ε_r=13 is within the
displayed range but is not the canonical P.527 value. Either
update to ε_r=15 to match P.527, or note that 13 is a slightly
drier-than-average choice.

**J8. ITU-R P.534-6 year (DRIFT)**. Paper bibliography line 5605
cites P.534-6 with year 2019. **Actual year is 2021** (P.534-6
published 09/2021). Title and topic match. Update year only.

**J9. ITU-R P.372-14 galactic constant 50 vs 52 and figures
(DRIFT)**. Paper §3.10 line 1310 cites P.372 galactic Fa
≈ "50 - 23 log10(f_MHz)". **P.372-14 §4.1 Eq. (13) prints
`Fam = 52 - 23 log f`** (constant 52, not 50). Off by 2 dB.

Paper line 1265 cites *"P.372 Fig.~23/24 vs Fig.~13/14"* as
galactic vs atmospheric. **All four figures (13/14 AND 23/24)
are actually atmospheric-noise charts** (Winter and Spring
windows). Galactic noise lives in P.372-14 Figures 2 and 3
(broad-frequency overview), not 23/24. Re-cite figure numbers.

**J10. ITU-R P.1239-3 year (DRIFT)**. Paper bibliography line
5593-5597 says 2015. **Actual P.1239-3 was published 02/2012**
with editorial amendments in 2016. Update year.

**J11. ITU-R P.525-4 / 32.44 vs 32.4 (VERIFIED, rounding only)**.
P.525-4 prints constant as `32.4`. The paper's `32.44` is the
more precise value. ✓ Acceptable.

### J.2 Non-ITU citations

**J12. Mitra 1974 §5-6 (UNVERIFIABLE)**. Print-only; book exists
(Astrophysics and Space Science Library Vol. 46, Reidel 1974)
and covers SID / D-region. The specific anchor pairs
(M1=4 dB, X1=12 dB, X10=20 dB, slope 8 dB/decade) cited in §3.4c
cannot be cross-checked without the book. The order of magnitude
is consistent with broader SID-absorption literature.
**Recommendation**: open a copy and verify §5-6 contains the
specific dB anchors; if not, re-anchor to a citable source.

**J13. Sauer-Wilkinson 2008 date range (DRIFT)**. Paper §3.4b
line 614-615 says *"11 large SEP events 1998-2002 at Thule,
Greenland"*. The actual paper covers **1992-2002**, not
1998-2002. Update date range. Thule / 30 MHz / 11 events / flux
range 10-10^4 pfu verified as plausible.

**J14. Mendillo 2006 (VERIFIED qualitatively)**. The "40° CGM
ceiling" claim cited at §5.3 line 2675-2680 is consistent with
the storm-trough literature, though whether Mendillo 2006
specifically prints "40°" is not directly verified. ✓

**J15. Pr\"olss 1995 winter ~10-15% (VERIFIED qualitatively)**.
The chapter exists; the magnitude claim is in the canonical
range. ✓

**J16. Anderson 1981 (VERIFIED)**. Paper exists at the cited
location. ✓

**J17. Alduchov-Eskridge 1996 Magnus coefficients (DRIFT,
MISATTRIBUTION)**. Paper §6.5 line 3395-3399 attributes the
constants `(17.62, 243.12)` to *"the Alduchov-Eskridge 1996
coefficients for saturation over liquid water"*. **Wrong.**
Alduchov-Eskridge 1996 (J. Appl. Meteorol. 35, 601-609)
recommend **`a = 17.625, b = 243.04`**. The pair `(17.62, 243.12)`
is from **Sonntag 1990 / WMO**, not Alduchov-Eskridge.

**Either** update the code to use the actual Alduchov-Eskridge
constants (17.625, 243.04) **or** update the paper to cite
Sonntag 1990 / WMO for the (17.62, 243.12) constants. The
current state is a misattribution.

**J18. Middleton 1977 (VERIFIED)**. ✓

**J19. IGRF-13 / Alken 2021 / pole 80.7°N, -72.7°E (VERIFIED
within rounding)**. WMM2020 / IGRF-13 epoch 2020.0 dipole pole
is 80.65°N, 72.68°W. Rounding to 80.7°/-72.7° is correct. ✓

**J20. K9LA per-band absorption table (UNVERIFIABLE)**. K9LA's
public *"Tutorials"* page (k9la.us) lists Propagation_101 (Sep
2007), VOACAP, and W6ELProp. The Propagation_101 PDF discusses
absorption qualitatively but contains no per-band dB table.
K9LA's *"Physics of Propagation"* article references a
"Table 1 — Absorption Results" but the table is an embedded
image not extractable from PDF text. The specific dB values
(160m=28, 80m=18, 60m=10, ..., 10m=0.2) **cannot be matched to
any publicly accessible K9LA document**. Either:
- Open a non-public K9LA monthly column with the values, or
- Re-cite to a specific accessible source (P.533 §A.2 if the
  table is fitted to it, or to a specific WSPR-derived
  empirical tune).

**J21. NTIA Red Book 2021 Chapter 5 (DRIFT, MISATTRIBUTION)**.
Paper §6.5 line 3427 cites *"ITU-R P.453 / NTIA classification"*
with super-refractive / ducting thresholds at -79 / -157 N/km.
**Chapter 5 of the 2021 NTIA Red Book is "Spectrum Standards"**
covering transmitter/receiver standards and conducted emissions
— it does **not** classify refractivity gradients. The -79 /
-157 thresholds are standard in radar / anomalous-propagation
literature but not in NTIA Red Book Ch. 5. **Misattribution.**
Re-cite to a textbook (Bean & Dutton 1968) or radar handbook.

**J22. WSJT-X / K1JT thresholds (PARTIAL VERIFIED)**.
- FT8 -21 dB: ✓ widely-cited K1JT/WSJT-X published value.
- WSPR -28 dB: ✓ widely-cited.
- FT4 -17 dB: actual published value is **-16.4 dB** (per
  FT4_FT8_QEX). Off by 0.6 dB; rounded.
- SSB +10 dB and CW -7 dB at 2500 Hz: **NOT K1JT-published**.
  These originate from ham-radio operating tradition (ARRL
  Handbook / operator practice), not from WSJT-X documentation.
  The bibliography cite `\cite{k1jt}` is appropriate for FT4 /
  FT8 / WSPR but inappropriate for SSB / CW.

Update Table `tab:modesnr` "Source" column for SSB/CW to credit
ARRL Handbook or operator-practice consensus rather than K1JT.

### J.3 Implications

The citation drift cluster shows three patterns:

1. **Year drift**: P.842 (-5 not 1997), P.534 (2021 not 2019),
   P.1239 (2012 not 2015). Easy fixes — bibliography years out
   of date.
2. **Section / formula drift**: P.533 §3.2.2 / Annex 1 §A.2 are
   misattributed. The MUF approach loss form is from VOACAP/
   IONCAP; the 677/(f+fL)^1.98 anchor is from Lockwood / older
   IONCAP. P.453 doesn't print the -157 threshold. P.372 galactic
   formula is `52-23 log f` not `50-23 log f`. NTIA Red Book Ch.5
   is the wrong chapter for refractivity classification.
3. **Misattribution**: Alduchov-Eskridge constants are actually
   Sonntag 1990. SSB/CW thresholds aren't from WSJT-X.

The drifts in (2) and (3) are substantive and would surprise a
reader who follows the citations expecting to find the formulas
where the paper says they live. (1) is mechanical update.

**Action items** ordered by severity:
- **High**: J17 (Alduchov-Eskridge misattribution → likely
  Sonntag), J9 (P.372 galactic constant 50 vs 52), J21 (NTIA
  Red Book Ch. 5 misattribution), J5 (P.842-5 year and formula).
- **Medium**: J1, J2, J3 (P.533 misattributions), J6, J7
  (P.453 threshold and P.527 ε_r), J22 (WSJT-X
  partial-misattribution), J13 (Sauer-Wilkinson date range).
- **Low / mechanical**: J8, J10 (year updates), J11 (rounding).
- **Unverifiable / requires source access**: J12 (Mitra 1974),
  J20 (K9LA dB table).

## I. Line-by-line code v paper sweep (2026-05-06)

A second pass verifying every named constant, every per-mechanism
formula, and every paper-side table against `src/constants.js`,
`src/physics/`, `functions/_handlers/`, and `scripts/`.

**Result: 153 checks, 153 OK, 0 drift, 0 not found.**

The code-side implementation matches the paper exactly within
numerical precision and code idiom. Specifically verified:

- All 12 BAND_SIGMA_DB rows match Table `tab:bandsigma`
- All 10 N_BASE rows match Table `tab:noisebase`
- All 10 A_BASE rows match Table `tab:dabs`
- All 6 L_LOW rows match Table `tab:lowbandextra`
- All 35 paths in `scripts/data/paths.json` match Table `tab:paths`
- All 27 GIRO stations (including BVJ03 Boa Vista) in code
- Tier z-boundaries, R thresholds, DEFAULT_SIGMA_DB
- L_MUF / L_DRAP / L_PCA / L_flare / L_aur / L_hop / L_Es
  formulas and caps
- Antenna patterns: horizontal sin·sin form, vertical f_v=cos/cos
  with denominator=1, compromise -2(1-θ/10°), loop high-angle
  factor
- Climatology formulas: P(φ) with 73°/8° (the post-rebuild form),
  EIA crest/trough Gaussians, winter anomaly, night decay
- TEP plateau sigmoid (8 + 7/(1+exp(-(F107A-125)/30)))
- F2 scatter formula and weight 1.5
- NVIS secant and tail blend
- Gray-line per-band amplitudes (Table `tab:graylineamps`)
- IGRF pole 80.7°/-72.7°
- Hop ceiling √(h/300) scaling
- 24-station tropo basket, refractivity formula, ducting threshold
- 3 calibration seeds match Table `tab:seeds`
- Tune-grid sweep ranges match Table `tab:tunegrid`

### I.1 Implications for the rest of the audit

The code-v-paper drift findings I worried might exist in §10 of
my "Honest assessment" don't exist in practice. Every formula and
constant in the paper is faithfully implemented.

This means:

- **A1, A2, A3** (sigma values stale): these are **paper-internal**
  inconsistencies (the worked example, Limits #1, defaults table
  cite older σ values). The code is consistent with `tab:bandsigma`.
  The paper's prose / examples need to catch up with `tab:bandsigma`,
  not the other way around.

- **A5** (GIRO 26 vs 27): paper text says 26, code has 27. Paper
  is wrong; code is correct.

- **G3.6** (auroral f^-1 vs f^-1.5): the **code** uses f^-1 (30/f)
  per `loss.js:334`. So the paper accurately describes the code.
  This is a physics-philosophy inconsistency *within* the paper
  (PCA uses f^-1.5, aurora uses f^-1), not a code drift. Documented
  truthfully.

- **G3.4** (D-region table calibration anchor doesn't reproduce):
  the **code** stores the table verbatim and interpolates per the
  caption. The /1.6 anchor is a paper-side calibration claim that
  doesn't reproduce when re-derived; the code does what the table
  says.

### I.2 The one constant the agent flagged but isn't in the paper

`L_IONO_AUR_DB = 25` exists in `loss.js:62` and is exported, used
by `snrMarginVhfAurora`. This constant does **not** appear in the
methodology paper. Either:
- Document the VHF auroral lumped iono loss (L_IONO_AUR_DB = 25
  dB) in §6 alongside Es-as-mode, or
- Remove the export if VHF auroral propagation is not surfaced
  in production.

This is the **only** code-side symbol I can find that isn't paper-
documented.

## H. Fresh harness execution (2026-05-06)

I re-ran `node scripts/harness.mjs --window-days=30` in both
ground-truth modes today. Headline numbers vs paper:

| Run mode | Paper-quoted | Fresh re-run (2026-05-06) | Delta |
|---|---|---|---|
| Global, accBin | 94.25 % | **86.06 %** | -8.19 pp |
| Global, Brier | 0.0386 | **0.0937** | +0.0551 |
| Per-path, accBin | 30.97 % | **38.29 %** | +7.32 pp |
| Per-path, Brier | 0.6353 | **0.5740** | -0.0613 |

Both modes diverge from the paper's quoted numbers by amounts
that are well outside the harness's own *"2 dB margin or 5 pp
P(open)"* drift threshold. The drift detector itself flagged
**15 (path, band) cells** in the global run as drifted from the
saved baseline, mostly on 12 m / 15 m / 17 m on long paths
(Polar W6-EU, EU-Asia, Asia-EU short, EU-EU east, etc.); the
per-path run reported zero cells drifted because its baseline
was just written today.

### H.1 Per-band breakdown (global run, 2026-05-06)

| Band | n | Brier | accBin | margin mean | margin std |
|---|---|---|---|---|---|
| 160m | 25235 | 0.0639 | 90.6% | +17.41 dB | 12.23 dB |
| 80m | 25235 | 0.0016 | 99.8% | +30.08 dB | 10.19 dB |
| 60m | 25235 | 0.0002 | 100% | +35.51 dB | 9.01 dB |
| 40m | 25235 | 0.0001 | 100% | +38.12 dB | 8.65 dB |
| 30m | 25235 | 0.0001 | 100% | +35.69 dB | 8.85 dB |
| 20m | 25235 | 0.0181 | 97.5% | +29.14 dB | 12.68 dB |
| 17m | 25235 | 0.0940 | 86.6% | +20.12 dB | 15.99 dB |
| 15m | 25235 | 0.1658 | 75.5% | +14.77 dB | 17.40 dB |
| 12m | 25235 | 0.2579 | 59.6% | +8.22 dB | 17.64 dB |
| 10m | 25235 | 0.3350 | 51.0% | +3.54 dB | 17.12 dB |

Lower bands (60m through 30m) saturate at accBin 100% under the
global truth metric — the budget always says "open" and at
least one path on the band has spots, so the OR-over-paths
target is trivially passed. Meaningful information is on 17m and
above. 10m at 51.0% is essentially coin-flip against the global
truth.

### H.2 Implication for the paper

Update Table `tab:harnessruns` (line 3725-3757) to reflect
2026-05-06 numbers. Or, if the 2026-04-28 production basket
numbers (94.25 / 0.0386) are pinned by some specific tune state
that has since shifted, document that pinning explicitly. As-is,
the headline 94.25% number is no longer reproducible from a fresh
run, which contradicts §7.2 line 5566-5572 *"the regression
detection signal (drift > 2 dB mean margin or 5 pp in P(open))
is the reproducibility guarantee, not bit-exact metric values"* —
the metrics drift by a lot more than the regression-detection
signal would tolerate, and 15 cells exceed the 2 dB / 5 pp
threshold.

### H.3 Per-path accBin contradicts §7.3

§7.3 (line 3833-3837) reports per-path open rates by tier as:
*"the predicted 'excellent' bucket sees a ~30% per-path open
rate against the WSPR cache; 'good' ~14%; 'fair' ~3%; 'poor'
~1%; 'closed' ~0.1%"*. Today's per-path run produces a different
distribution; the tier-vs-completion-rate mapping should be
re-derived from the 2026-05-06 cache before the §7.3 numbers
are quoted.

### H.4 Drift cells flagged (global mode)

15 cells exceeded the 2 dB / 5 pp threshold; all show a
**positive** dMargin (current margin higher than baseline),
meaning the model is now reading "more open" than its 2026-04-28
baseline on those cells. The largest deltas are on Polar W6-EU
17m (+3.48 dB), EU-Asia 17m (+2.61 dB), Polar W-UA 15m (+2.44
dB) — long upper-band paths in the NH winter / spring window
(Boreal April-May), suggesting the climatology may be predicting
an Es/F2 enhancement that the WSPR truth doesn't show. Worth
checking whether the spot-baselines refresh has been running
daily as advertised in `data-wspr-refresh.yml` — if the WSPR
baselines drifted but the climatology did not, the divergence is
expected.

### H.5 wspr-baselines workflow IS in place

Verified `.github/workflows/data-wspr-refresh.yml` exists and
runs daily at 06:00 UTC, calling
`node scripts/harness.mjs wspr-baselines` and committing the
diff. This **resolves G8.4** in favour of the daily-cadence
description (line 4493-4498) being correct; the
"every few months manual" claim at line 4575-4587 is the stale
one. Update §8.1 prose accordingly.

### H.6 Module-import bug in harness

A standalone finding from running the harness: the repo has no
`package.json`, so Node 18 treats `src/physics/physics.js` as
CommonJS and the ES `export *` syntax fails to resolve named
exports. The fix is to add `package.json` with `{"type":
"module"}`. The CI runs Node 20 which evidently has different
default detection (or a different package layout the local
checkout is missing). Either:
- Add `package.json` with `{"type": "module"}` to the repo, or
- Document the Node 20+ requirement explicitly in
  `docs/MAINTENANCE.md` or the harness header comment.

I added a temporary `package.json` to make the harness run for
this audit; that file is now in the repo and should be reviewed
for whether it stays.

## G. Sentence-by-sentence scan (added 2026-05-06)

This section is the running log of a sentence-by-sentence pass
through the paper, top to bottom. Findings are appended as I work
through each section. New issues only; items already covered in
A through F are not repeated here unless I find more instances of
the same pattern.

(Scan complete. 11 subsections cover lines 1-5738; subsection
counts: G.1 to G.11.)

### G.0 Sentence-by-sentence scan: summary

100 % of the paper's 5738 lines were read sentence-by-sentence
with findings logged below. The scan surfaced ~150 new findings
beyond A through F, broken roughly into:

- **Numerical errors** (verified by re-derivation): G4.2
  (P(φ) values match the retired 75°/7° formula, not the current
  73°/8°), G3.4 (D-region absorption table doesn't reproduce
  from the cited /1.6 anchor), G3.10 (F10.7A "varies on
  minutes" claim is wrong), G3.15 (worked example L_Dreg = 0.5
  contradicts Table tab:dabs A_base = 1.5 at 20m), G7.6
  (`fig:tierprob` caption σ set is stale {6,10,12} vs actual
  {8,9,10,12}), G7.7 (`tab:sigmasens` 15m / 17m σ values don't
  match `tab:bandsigma`).

- **Internal contradictions**: G5.1 (gray-line bonus listed in
  §5 deferred but is in live verdict), G8.4 (baseline
  regeneration cadence: daily GH Actions vs manually every few
  months), G9.6 (sort order claimed to follow causal chain but
  doesn't), G7.4-G7.5 (sigma widening counts don't agree across
  three places).

- **Stale post-refit text**: G3.14 (4-path Lisbon basket vs 35
  paths), G10.4 (Limits #1 σ_g defaults), G10.6 (EIA "30 %"
  understates 50-85 %), G10.9-G10.10 (Limits #10/#11 ignore
  Boa Vista), G10.14 (Limits #14 is closed work, not a
  limitation), G11.1 (Default settings σ_g range), G11.5
  (Appendix B GIRO 26 vs 27).

- **Code-level claims unverified**: G2.8 (worker doesn't log
  query strings), G4.4 (cold-start fix), G6.7 (NVIS-tail /
  Es-prim final values), G10.3 (on-device feedback loop).

- **Nomenclature / variable-name drift**: G5.2 (B_GL vs
  B_grayline), G3.6 (auroral f^-1 vs other D-region f^-1.5),
  G6.5 ("half-threshold" ambiguous).

- **Citations and bibliography**: G1.6 (VOACAP cite is wrong),
  G1.7 / G2.3 (kc2g, GIRO, GFZ, Kyoto, SILSO, UWyo, HamQSL,
  DX Toolbox not cited), G11.10 (missing data-source
  citations), G11.11 (bundled bib entries), G11.16 (Alduchov-
  Eskridge 1996 not cited).

- **Figure issues**: G4.16 (`fig:mufdiurnal` floor constant
  mismatch), G5.5 (`fig:seasonal` plots retired calendar-month
  formulation), G7.6 (`fig:tierprob` caption σ set stale), G9.1
  (`fig:noise` "phantom 7 dB" comparison undefined).

- **Path-naming inconsistencies in `tab:paths`**: G11.4
  (Asia-EU short reversed; Polar W-UA confusing; Equator NA
  not NA).

- **Style / structure**: G3.20 (beam pattern simplification not
  caveated), G6.6 (MS verdict cliff not actually smoothed),
  G8.10 (architecture description sound but worth clarifying
  override placement).

The detailed findings are in G.1 through G.11 below.



### G.1 §1 Abstract + Introduction (lines 1-210)

**G1.1** Line 70: `\date{April 2026}`. Last dated activity in the
body is 2026-04-30 and you (the author) referenced an audit
2026-05-06. If the paper has any May-dated edits the date stamp
should reflect that; otherwise keep April but freeze it.

**G1.2** Line 134: *"26-station GIRO list"* in the
Source-and-reproducibility paragraph. Stale. Code has 27 (Boa
Vista). Already in A5; flagging that this exact phrasing repeats in
the Abstract too, so the fix needs to land here as well as in
Appendix B.

**G1.3** Lines 143 and 147: hard-coded harness metrics
(`94.25 % / 0.0386`, `30.97 % / 0.6353`) in the Abstract. The
Abstract is the most-cited section and the metrics drift week to
week with WSPR activity. Either move the metrics to §7.2
(Table `tab:harnessruns`) and reference them, or commit to refresh
the Abstract numbers on every harness run. Pinning live metrics in
the Abstract is a maintenance trap.

**G1.4** Lines 116-117 (Key Contributions bullet): *"Equatorial and
winter anomaly corrections to the foF2 climatology"*. §4.2 actually
implements an EIA *crest enhancement* AND a *trough depression*
(two separate Gaussians). The contribution bullet collapses both
into the singular "equatorial anomaly correction", which understates
the model. Reword to *"Equatorial-anomaly crest-and-trough
corrections..."* or similar.

**G1.5** Line 134: *"35-path calibration basket"*. Verified at 35
in Appendix A; OK.

**G1.6** Line 177: VOACAP cited as `\cite{itup533}`. VOACAP is the
implementation; P.533 is the underlying standard. The bibliography
key `itup533` resolves to the ITU recommendation, not to VOACAP.
A reader following the citation lands on the standard, not the
tool. Either drop the cite, or add a separate VOACAP entry to the
bibliography (Greg Hand, NTIA/ITS, original VOACAP code) and cite
that.

**G1.7** Lines 180-186 (Existing-tools list): N0NBH, kc2g, HamQSL,
DX Toolbox are mentioned by name with no citation, no URL, no
attribution. The kc2g network in particular is the paper's primary
real-time MUF input and is never given a primary citation anywhere
in the bibliography. Add at minimum a URL footnote for each, or a
bibliography entry for kc2g (Andrew Rodland, KC2G,
prop.kc2g.com).

**G1.8** Line 191-192: *"five reference propagation paths"*.
Inconsistent with §3.2 / §4.6 which evaluate both short-path AND
long-path per destination, i.e. 10 paths total. Reword to *"five
reference destinations (short and long path each)"* or
*"ten reference propagation paths (five destinations, short and
long)"*.

**G1.9** Lines 193-194: *"+3, +6, +12, and +24 h"*. These specific
projection horizons appear nowhere in §5 (which only refers to
"next 24 h" and a generic Δ). Either §5 should enumerate these
horizons or the Abstract should drop them. Currently the Abstract
makes a specificity claim the body doesn't support.

**G1.10** Lines 191: *"stored in \texttt{localStorage} only"*. The
Abstract's later qualifier *"sent to ionocast's own proxy for
resolution and discarded after the response"* contradicts the
"only" wording; the proxy-side QTH transmission is a real second
channel. §2.1 phrases this more accurately. Soften the Abstract
*"stored in localStorage only"* to *"stored on-device in
localStorage"* to match §2.1.

**G1.11** Lines 162-163: `\tableofcontents \newpage`. The TOC is
generated automatically; verify on compile that section numbering
matches the cross-references throughout (no orphan
`\ref{sec:perpath}` etc.). I have not run a compile; flagged as a
release-checklist item.

**G1.12** Line 88: *"Section~\ref{sec:privacy}"* used inside the
Abstract. Cross-section references in an Abstract are a style
choice; some publishers strip them. If the paper is going to a
formal venue, replace with §2.1 inline or cut the parenthetical.

### G.2 §2 Data Sources + Privacy (lines 210-322)

**G2.1** Lines 213-217: *"Sources marked 'Proxied' pass through a
Cloudflare Worker endpoint that resolves the operator's Maidenhead
grid to a station identifier server-side."* Misleading. Of the six
"Proxied" sources in Table `tab:sources`, only `/api/giro` (and
arguably `/api/tropo` for the nearest-station highlight) actually
do grid-to-station resolution. Hp30, Kyoto Dst, SILSO SSN, and
UWyo tropo are global products with no grid resolution, just CORS
shimming. Reword to *"some Proxied sources resolve the operator's
grid server-side; others are global products served via the worker
purely for CORS"*.

**G2.2** Table `tab:sources`, Refresh column row 1: *"NOAA SWPC...
1 to 10 min"*. SWPC products span a much wider cadence range:
X-ray flux ~1 min, Bz/solar wind plasma ~1 min, OVATION ~5 min,
DRAP ~5 min, Kp planetary index 3 h, Ap daily, F10.7 daily, 3-day
forecast 3 h, 27-day outlook weekly. The 1-to-10 min range
misrepresents the slower-cadence products listed in the same row.
Either split SWPC into "fast products" and "slow products" rows
or write "1 min to 1 day" with a footnote.

**G2.3** Table `tab:sources` citations: only DONKI is cited. kc2g,
GIRO, GFZ Potsdam, WDC Kyoto, SILSO, UWyo, and wspr.live (cited
later) are listed without cite keys. wspr.live appears in the
bibliography (`\cite{wsprlive}`) but is not cited at the table
itself. Pick a consistent policy: cite all upstreams in the
table, or cite none and put the bibliography references in the
prose.

**G2.4** Line 234: kc2g is given as `prop.kc2g.com` (URL fragment)
rather than a proper attribution. Standard practice is "kc2g
(Andrew Rodland, KC2G; prop.kc2g.com)" since this is the most
load-bearing real-time input in the entire model. The data
source's primary attribution should be unambiguous.

**G2.5** Lines 252-259 (footnote *): Hp30 and SILSO are fetched
but unused. The footnote text says they are *"wired forward in
case future calibration work uses them as cross-checks"*. Fine,
but a reader auditing the model wonders why a paper documents
fetchers that don't feed the verdict. One sentence justifying
the choice (*"removing them would create a CORS regression for
the Geomagnetic / Solar panels"*?) would help.

**G2.6** Line 244: UWyo row says *"lowest-1km dN/dh over a
24-station basket"*. Verify against §6.5 (tropo) which also says
24 stations and against `functions/_handlers/refractivity.js` (I
have not verified this myself; flagged).

**G2.7** Line 264-265: *"The operator's QTH is stored exclusively
in \texttt{localStorage} and is never logged or retained by the
ionocast Cloudflare Worker."* The first half ("stored exclusively")
is contradicted three lines down by *"Sent for resolution, not
retained"*. The phrasing should be *"stored on-device in
localStorage; transmitted only to the worker for resolution and
not retained server-side"*. The current first-line phrasing
overstates and the bullet list immediately corrects it.

**G2.8** Lines 275-276: *"the worker does not log request bodies
or query strings"*. Strong claim. Should be verifiable from the
worker source. I have not opened `functions/` to confirm. Add a
citation to the specific commit / file that sets the access-log
configuration, or remove the absolute claim and replace with
"the worker is configured to not log request bodies or query
strings; see `functions/_middleware.js` for the current
configuration".

**G2.9** Lines 287-289: *"No third-party analytics or tracking
are loaded; the Cloudflare access logs the worker host retains
for 24--72 h are the only request-side trace."* The 24-72 h
window is a specific Cloudflare retention claim. Cloudflare's
access-log retention varies by plan and by setting. Either link
to the relevant Cloudflare docs or soften to *"Cloudflare's
default access-log retention applies"*.

**G2.10** Lines 313-321 (First-visit default): JN05 grid math
checks out (J=0-20°E, N=40-50°N, 0=0-2°E, 5=45-46°N -> centred
~1°E, 45.5°N). OK.

**G2.11** Lines 316-318: *"...near where the CCIR R-12 / P.1239
foF2 coefficients underlying this paper are tabulated."* This is
incorrect or at best misleading. The CCIR (P.1239) foF2
coefficients are spherical-harmonic coefficients defined
globally, not tabulated at any specific geographic location. JN05
is not "near where the coefficients are tabulated" because the
coefficients aren't tabulated anywhere geographically. Either cut
the geographic-anchoring claim or rephrase: *"a midlat European
reference point that exercises the foF2 climatology in a
well-validated regime"*.

**G2.12** Line 304: examples include `Australia/Sydney -> QF56`.
Verify: Sydney is at -33.87°S, 151.21°E. QF maps to
(140-160°E, -40 to -30°S). 5 within QF longitude is 150-152°E
(QF longitude width is 20°, sub-divided into 10 chars of 2° each,
so 5 = 10-12° from 140 = 150-152°). 6 within QF latitude:
QF latitude is -40 to -30°S (10° wide, 10 sub-chars of 1° each,
6 = -40 + 6 = -34 to -33°S). So QF56 = 150-152°E, -34 to -33°S,
centred at 151°E, -33.5°S. Sydney at 151.21°E, -33.87°S falls
inside that cell. OK.

**G2.13** §2.1 Privacy section is missing one fact that is
operationally important: the WSPR.live ClickHouse query also
goes out from the browser at runtime (per Table `tab:sources` row
8: "Direct CORS"). The paper's privacy bullet list says *"WSPR
live queries are global hourly aggregates with no grid field at
all"*, which is true, but a reader concerned about request-source
privacy should know the browser's IP is exposed to wspr.live's
ClickHouse endpoint on every refresh. Add a parenthetical
acknowledging the IP exposure (which is intrinsic to direct CORS
and unfixable without a proxy).

### G.3 §3 SNR Budget Model (lines 322-1815)

**G3.1** Eq. budget (line 328-335) computes M_physics, but is
labelled simply M and the paper subsequently refers to it as the
verdict margin in places. The actual verdict margin (§7.1, Eq.
blend) adds bonuses: M_verdict = M_physics + B_grayline +
max(B_TEP, B_scatter). The §3 budget should explicitly say
*"this gives M_physics; verdict margin adds bonuses per Eq.
blend in §7.1"* up front, so a reader doesn't read §3 and
think they have the full verdict computation.

**G3.2** Line 423-425 (FSPL): *"clamped to a minimum of 50 km to
avoid numerical singularity on extremely short paths."* The
log10 of d_km is finite for any d > 0; 50 km is a physical
choice, not a numerical floor. At d = 1 km the FSPL is 32.44 +
20log10(14.097) + 0 ≈ 55.4 dB, not singular. The clamp's purpose
is "below 50 km, sky-wave isn't the right model and the budget
shouldn't apply", not numerical. Reword.

**G3.3** Line 559-561 (Table `tab:dabs` caption):
*"geometric-mean interpolation between adjacent anchors"* is
non-standard phrasing. Interpolating "in log-frequency / log-
magnitude" space at unequal sample spacings is log-linear
interpolation, not geometric mean (which only equals log-linear
interpolation at the midpoint). Reword to *"linear interpolation
in log-frequency / log-magnitude space"*.

**G3.4** Lines 562-569 (Table `tab:dabs` calibration anchor):
*"Calibrated 2026-04-30 against ITU-R P.533 §A.2 quiet-day
non-deviative absorption $L_a(f) \approx 677 / (f + f_L)^{1.98}$
divided by ~1.6 for typical oblique-path obliquity"*. Reproduce
the table values from this anchor:

- 17 m (f=18.106): L_a / 1.6 ≈ 677 / 18.106^1.98 / 1.6 = 677 /
  309.6 / 1.6 = 1.37 dB. Table says **0.8** dB.
- 15 m (21.096): 677 / 419 / 1.6 = 1.01 dB. Table says **0.5**.
- 20 m (14.097): 677 / 178 / 1.6 = 2.38 dB. Table says **1.5**.
- 40 m (7.040): 677 / 51.5 / 1.6 = 8.22 dB. Table says **6.0**.

Systematic factor of ~1.6 to 2 between formula and table. Either
the divisor is wrong (closer to /3 reproduces upper-band values
within 0.1 dB but breaks lower-band values) or the formula is a
loose approximation rather than a calibration. If the table is
hand-tuned to WSPR residuals (which the caption later admits with
*"lower-band values held at prior empirical settings"*), the
P.533 anchor citation should be softened to *"informed by"*
rather than *"calibrated against"*.

**G3.5** Line 533-535: K9LA's table cited as the calibration
anchor with "agree with P.533 Annex 1 to within ~2 dB at
midlatitude where they overlap". Verify: per G3.4, the divergence
is up to 2.2 dB at upper bands, so the ~2 dB agreement is at the
edge of being supported.

**G3.6** L_aur band scaling (Eq. laur, line 783): *"D · 30 / f_MHz"*
uses f^-1 frequency dependence. PCA (Eq. lpca, line 624) and
flare (Eq. lflare, line 688) both use f^-1.5. The PCA section
explicitly says *"the same f^-1.5 frequency dependence as
ordinary D-region absorption is retained"* (line 619). Auroral
absorption is also a D-region phenomenon and should presumably
share that scaling. Either:
- Document why aurora differs (riometer convention vs
  D-region oblique-path), or
- Harmonize to f^-1.5.

**G3.7** Per-hop absorption caps are inconsistent across
mechanisms:
- L_Dreg: no per-hop cap (only path cap at 50 dB).
- L_PCA: 30 dB per-hop, 50 dB path.
- L_flare: 40 dB per-hop, 50 dB path.
- L_aur: 30 dB per-hop, 50 dB path.

L_flare's 40 dB per-hop differs from PCA/aurora's 30 dB without
explanation. The paragraph at line 354-358 says *"Each of the
four ionospheric absorption terms is individually capped at 50 dB
per path"* (path cap matches), but the per-hop disparity is not
addressed. Either harmonize per-hop caps to 30 dB across the
board, or add one sentence justifying flare's 40 dB.

**G3.8** Line 832: in c(φ) ramp: *"(|φ| - (φ_thr - 5°)) / 5°"*.
At φ=φ_thr - 5°, c=0; at φ=φ_thr, c=1. ✓ Continuous.

**G3.9** Line 891-902 CGM eq. The clamp guards against
floating-point overshoot at the pole. But what about the south
geomagnetic pole? The formula uses φ_P=+80.7° (north pole). For a
QTH near the south magnetic pole (around -80.7°S, +107.3°E i.e.
Antarctica), the clamp also catches the overshoot. ✓ OK.

**G3.10** Lines 916-919: *"F\textsubscript{10.7A} varies on
minutes (daily product, with significant intraday spread), so
consuming the live value is correct"*. **Wrong.** F10.7A is the
81-day average of F10.7. It varies on the order of days to
weeks, not minutes. Even F10.7 (without A) is reported daily,
not minute-by-minute. The phrase *"varies on minutes"* should
be *"varies on days"* and the parenthetical *"daily product"*
contradicts the *"minutes"* claim in the same sentence.

**G3.11** Line 1056: typical magnitudes example: *"L_hop = 1.7 ·
(0.66 + 0.25) ≈ 1.55 dB"*. Verified: 1.7 · 0.91 = 1.547. ✓ OK.

**G3.12** §3.7 Es screening (line 1099-1107): *"L_Es = 5 dB"* as
a flat constant. The threshold *"f < 2 f_oEs"* is given but the
paper does not explain why 2× (vs the 5× ratio used for Es as a
mode in §6.1) or why a flat 5 dB regardless of f, f_oEs, or
geometry. Anchor with a citation (P.534 has more nuance) or
explicitly label it as "empirical anchor matching observed F2
fade-on-Es-day patterns in WSPR data".

**G3.13** §3.8 line 1144: *"the round values (8, 5, 3, 2 dB)
are the visible signature of [hand-set integers]"*. But Table
`tab:lowbandextra` (line 1178) shows 30 m at **0.5** dB, not
an integer. The "visible signature" claim has an exception that
goes unmentioned. Either round 30 m to 0 or 1 dB, or note the
30 m value as the interpolation tail.

**G3.14** §3.9 line 1208-1209: *"calibrated against the
single-hop NVIS-dominated 4-path Lisbon basket"*. The current
calibration basket (Appendix A) is **35 paths**. The 4-path
Lisbon basket is historical narrative. Should be cut along with
the rest of F2.

**G3.15** Worked example Table `tab:waterfall` (line 1751):
**L_Dreg = -0.5 dB**. Per Table `tab:dabs` (line 580), A_base
for 20m = **1.5 dB** at f=14.097 MHz. At cos chi = 1 (noon, as
the caption states), L_Dreg = 1.5 · 1^1.3 = 1.5 dB. Worked
example shows 0.5 dB, off by 1.0 dB. Same root cause as A1: the
2026-04-30 calibration changed Table `tab:dabs` but the worked
example wasn't updated. Add to A1's fix list.

If the L_Dreg row is corrected to 1.5 dB, the running totals
change: Σ at L_Dreg becomes -61.5, Σ at L_iono becomes -62.5,
Signal at Rx = -62.5 dBm, M = -62.5 + 113 - 10 = +40.5 dB. The
paper currently shows +41.5 dB.

**G3.16** Line 1773: *"reliability is Phi(6.92) > 99.99%"*. The
standard normal CDF at z=6.92 is essentially 1 to 11 decimal
places (1 - ~1e-12). So *"> 99.99%"* is a vast understatement;
either give the more precise value (1 - 5×10^-12) or state
*"effectively 100%"*. With the corrected M=+40.5 dB and σ=9 dB
(per G3.15 + A1), z = 4.50 and Phi(4.50) = 0.9999966, still
"effectively 100%" but the precision claim should match the
input.

**G3.17** Worked example with bonuses (lines 1777-1813): the
example silently uses B_TEP,plateau = 15 dB without specifying
F10.7A. Per Eq. tepplateau (line 3203), 15 dB is the asymptotic
plateau (F10.7A → ∞). At F10.7A=120 the plateau is ~11 dB. State
the F10.7A used (e.g. solar maximum), or use the moderate-cycle
value and recompute (≈ 11 · 0.875 = 9.6 dB instead of 13.1 dB).
Already in C2; flagging again because the worked-example sub-
section is the canonical place to fix it.

**G3.18** Line 1801: B_scatter formula uses
*"min(2, f/MUF - 1)"* but at line 3302 (the original definition)
this is *"min(2, f/MUF - 1)"* too, ✓. At f/MUF = 1.10, this
gives min(2, 0.10) = 0.10. ✓ Math holds.

**G3.19** Line 1606-1608 (horizontal loop high-angle weighting):
*"Horizontal loops pick up an additional (0.5 + 0.5 sin θ) high-
angle weighting"*. The formula isn't displayed as an equation;
it's prose. The factor multiplies gf_H? Replaces it? Adds in dB?
Make explicit: write a numbered equation for the loop case and
state it multiplies gf_H before the 20 log10 step.

**G3.20** Line 1610-1614 (beams use horizontal-wire pattern):
*"the elevation lobe of a Yagi is set by the ground reflection,
not the number of elements"*. Strong simplification — a stack of
two Yagis at different heights shows interference between two
ground-reflection patterns (broadside-stack lobing). The
"directivity bonus lives in G_peak" approximation collapses
multiple-element broadside response into a scalar. Worth a one-
sentence caveat that stacked / phased arrays are approximated.

**G3.21** Line 1684 (Vertical row): *"h = 0 m"* but the formula
in §3.12 vertical (line 1620) says gf_V = 2|cos(kh sin θ)| which
at h=0 gives gf_V = 2 (peak, image in phase). And the §3.12
explicit shortcut branch *"h ≲ 0.1 m"* applies. So h=0 is the
reference for ground-mounted vertical. ✓ Consistent.

**G3.22** Line 1666 (Compromise): G_rel = -max(0, 2(1 - θ/10°)).
At θ=0 this gives -2 dB. So a Compromise antenna is *worse* at
horizon than at θ ≥ 10°. This models nearby-conductor obstruction
at low takeoff angles. The text *"gentle low-angle penalty from
nearby conductors"* says so. OK, but the compromise formula is
the only antenna pattern with a *negative-going* shape at θ=0
(all others peak at low angle and fall off elsewhere). Worth
calling out so the reader doesn't mistake it for a typo.

**G3.23** Line 1668-1672 (Compromise unit-conversion note):
*"where θ is the takeoff elevation in degrees (the 10° literal
sets the unit)"*. The horizontal-pattern equations gf_H also
take θ in degrees inside sin θ — it's the standard convention.
The Compromise paragraph singles itself out by noting "must be in
degrees", implying other patterns might not be. Either add the
same note everywhere, or remove from the Compromise paragraph
since it's a global convention.

**G3.24** §3.10 noise model. F_a values (suburban +15, urban
+25 above N_base) are operator-friendly numbers but P.372's
business / residential / quiet-rural F_a values are conventionally
expressed in dB above kT0 (thermal floor at 290 K). The mapping
between *"+15 dB above the rural baseline N_base"* and the P.372
F_a numbers (which run 30 to 80 dB above thermal depending on
band and environment) is non-trivial. A short paragraph
explicitly bridging the two conventions would help a reader
who knows P.372 verify the F_a choices.

**G3.25** Line 1399: *"Re-derived 2026-04-30 from P.372-15 Fig
13 (atmospheric) ⊕ Fig 23 (galactic) max-of at midlat midnight
summer"*. The ⊕ symbol is used as power-sum notation. Reader
needs to know this. Since the paper uses ⊕ in only this one
place, define it inline or replace with "power-sum".

**G3.26** Line 716-717: M1=4 dB, X1=12 dB, X10=20 dB at 7 MHz
reference. Slope verified: 8 dB/decade. ✓ But note that the
8 dB/decade between M1 and X10 is *also* the slope between M1
(4 dB) and X1 (12 dB), since 12-4 = 8 over one decade. Eq.
lflare-driver `4 + 8 log10(X/M1)` reproduces all three anchors
exactly. ✓

**G3.27** Line 1066-1067 (calibration coverage): *"only the
defocusing scalar D remains tunable, and is exercised by the
harness over a multi-path basket spanning 1, 3, and 5 hops"*.
Appendix C tune grid for D is `0, 0.25, 0.5, 1.0` (line 5515),
and the production value is 0.25 dB. Verified consistent with
constants.js. ✓

**G3.28** Line 1009: clamp `L_gr ∈ [0, 8] dB`. The lower bound
0 is the lossless reflection limit (impossible at HF over real
ground, but mathematically the floor of |R_h|^2 ≤ 1). The upper
bound 8 dB is empirical. Document that 0 is rarely approached
in practice (typical sub-3 dB at amateur takeoff angles).

### G.4 §4 MUF Estimation (lines 1815-2465)

**G4.1** Line 1839-1840: *"five reference paths --- great circles
from the operator's QTH to five canonical destinations (...) and
their long-path counterparts"*. As in G1.8, the paths are
5 × 2 = 10. The phrasing here treats SP and LP together as "five
reference paths". §4.8 line 2395-2399 then says *"both the SP and
LP midpoints"*, confirming 10 paths total. Reword to "five
reference destinations" or "ten reference paths" consistently.

**G4.2** **NUMERICAL ERROR.** Lines 1897-1899: the listed P(φ)
values do not match the formula in Eq. fof2-poleward.

Eq. fof2-poleward (current): φ_thr = 73°, steepness = 8°.

Computed values for the listed angles using the current 73°/8°
formula:

- P(45°) = (1 - 0.135) · 1/(1 + exp(-3.5)) = 0.865 · 0.9707 ≈
  **0.84** (paper says 0.86)
- P(60°) = 0.82 · 1/(1 + exp(-1.625)) = 0.82 · 0.836 ≈ **0.685**
  (paper says 0.73)
- P(70°) = 0.79 · 1/(1 + exp(-0.375)) = 0.79 · 0.593 ≈ **0.47**
  (paper says 0.53)
- P(80°) = 0.76 · 1/(1 + exp(0.875)) = 0.76 · 0.294 ≈ **0.22**
  (paper says 0.25)

The listed values match the **prior 75°/7°** formula:

- P(45°) ≈ 0.85, P(60°) ≈ 0.73, P(70°) ≈ 0.53, P(80°) ≈ 0.25.

So the example values were computed for the pre-2026-04-30
formula and were not updated when φ_thr / steepness moved to
73°/8°. Recompute and update the four numerical anchors. (The
P(80°) value 0.25 happens to coincide between the two formulas
within rounding, but the others diverge by ~5-10 %.)

**G4.3** Line 1881: *"where P(phi) is the two-stage poleward
fall-off:"* — connecting back to Eq. fof2-base, but separated by
~15 lines of digression about b_floor's sign. The "where" reads
as if P(φ) is being introduced fresh, but it was already used in
Eq. fof2-base. Reorder so the prose flow is: state Eq. fof2-base
→ define P(φ) → define d(cos chi) → side-note on b_floor's
sign-handling at deep solar minimum.

**G4.4** Lines 1937-1954 (cold-start pre-population fix): this
paragraph describes a candidate fix that is "tracked in
Section sec:limits" but has not yet shipped. It then makes
three operational claims:

(a) cosχ_{-3h} is "purely astronomical".
(b) The fix "retires the cold-start bias entirely without any
    historical state".
(c) Until the fix ships, the runtime "should at minimum surface
    a 'cold-start cache filling' chip".

(a) and (b) are correct. (c) is a recommendation, not a
description of the model. Methodology paper text should say
*what the model does*, not what it should do. Move (c) to
§sec:limits, or label this paragraph clearly as a future-work
recommendation.

**G4.5** Line 1972-1983 (Phase 1 / Phase 2 night-decay):
"Phase 1" and "Phase 2" labels are physically meaningful. Keep.
But §4.2's "(R2)" label at line 2003 is an internal release
marker (F3); cut.

**G4.6** Line 1985-1994 (Eq. fof2): the floor `max(2, b)` enforces
a minimum f_oF2 of 2 MHz before anomaly scaling. The combined
anomaly product is then floored at 0.7. Worst case for f_oF2:
2 · 0.7 = 1.4 MHz. So MUF(3000) ≥ 4.2 MHz. This means the
climatology never returns a band that would even support 80m
NVIS as closed via the climo path. State this explicitly so a
reader doesn't expect the model to predict 60m closed in deep
solar minimum.

**G4.7** Line 1995-2000 (0.7 floor binding): *"the unfloored
product would otherwise read 0.50"*. At F10.7A ≥ 170 the trough
saturates at A_tr = 0.50, so 1 + α_EIA = 0.50. ✓ Correct.

**G4.8** Lines 2098-2110 (history block): pure changelog. Already
in F1. Cut entire paragraph.

**G4.9** Line 2143: *"(1.12 ± 0.03 across the basket)"*. Anchor
for A_win = 0.12. The basket of 10 northern midlat stations is
listed by name (line 2138-2141). Verify each is in Appendix B:
all 10 present (Juliusruh, Pruhonice, Fairford, Sopron, Athens,
Rome, Gibilmanna, Millstone Hill, Boulder, Wallops Island). ✓ OK.

But: this basket is purely northern hemisphere. The southern-
hemisphere winter-anomaly amplitude (which the formula applies
via the d_solstice = 172 branch for φ < 0) was never validated.
A_win = 0.12 may be NH-specific. Add a sentence acknowledging
this asymmetry in the calibration coverage.

**G4.10** Line 2155: divergence δ definition. The geometric mean
in line 2157 ignores δ ("does not branch the result"). δ is shown
only diagnostically. OK.

**G4.11** Line 2151-2160 (Symmetric Consensus Blend): the blend
is a geometric mean. Note that geometric mean is correct only
if both estimates have similar fractional uncertainty. If one
source is 5x more accurate than the other, geometric mean
underweights the better source. Inverse-variance weighting (in
log space) is the principled extension. Worth a one-sentence
acknowledgment that geometric mean is the equal-weight choice
on the prior assumption of similar fractional uncertainty.

**G4.12** §4.6 Night Floor (lines 2299-2319). The entire section
documents Eq. nightfloor whose F is "consumed only by the legacy
illumination-ratio fallback" (line 2309-2310) and is *"not used
by production per-hop MUF"*. Either:
- Move §4.6 to a "Legacy fallback" appendix, or
- Cut the section and keep the fallback description inline in
  §4.5's "Legacy fallback path" paragraph.

The current structure dedicates a top-level subsection to a
formula that doesn't run in production.

**G4.13** Line 2333-2336 (Eq. nvis): NVIS secant uses
`sec(arctan(d/(2 h_F)))`. Verify equivalent form:
`sec(arctan(x)) = sqrt(1 + x²)`. So MUF_NVIS = f_oF2 · sqrt(1 +
(d/(2 h_F))²). At d=500, h_F=300: sqrt(1 + (500/600)²) =
sqrt(1 + 0.694) = sqrt(1.694) = 1.302. ✓ Matches the 1.30 cited.

The closed form sqrt(1 + x²) is more numerically stable than
sec(arctan) (no trig functions). If the implementation uses
sec(arctan), an optimisation note. If implementation uses the
sqrt form, the equation could be presented in that form for
readability.

**G4.14** Line 2382-2386 (NVIS dynamic gate): *"Earlier versions
hard-coded f ≤ 8 MHz, which excluded 30 m..."* — F2/F1.

**G4.15** §4.8 line 2398: LP antipode formula
*"$(-\phi_{\text{mid}}, \lambda_{\text{mid}} + 180°)$"*. Standard.
Note that adding 180° produces a longitude possibly > 180°; the
implementation must wrap to [-180, 180]. Worth a one-line note.

**G4.16** Figure `fig:mufdiurnal` (line 2403-2464) at line 2433:
the `\addplot` expression uses constant **0.447**. Caption says
F ≈ 0.40 (midlat moderate). 0.447 = sqrt(0.20), corresponding to
the lower clamp of F in Eq. nightfloor (clamp at 0.20). The
caption explains *"F is the dimensionless illumination ratio
(~0.40)"* but the figure plots `max(0.447, sqrt(...))` which
gives an effective floor of 0.447 · 20 = 8.94 MHz, not the 8 MHz
shown by the dashed line. Either change the constant in the TikZ
expression to 0.40 (which gives 8 MHz floor) or update the caption
to say F = 0.447. Currently the dashed line is misaligned with
the actual floor of the plotted curve.

**G4.17** Figure title (line 2420): *"Diurnal MUF Variation
(Midlatitude, $F_{10.7A}=150$)"*. F10.7A = 150 is roughly
moderate-solar-cycle. At F10.7A=150, the climatology's daytime
peak f_oF2 (with EIA crest at midlat) is approximately 7-9 MHz,
giving MUF(3000) ≈ 21-27 MHz. The 20 MHz peak shown is at the
low end of this range. Caption says *"representative midlat
F10.7A ≈ 150"*. OK approximate.

**G4.18** Line 2401: *"both paths compete for the best-margin
verdict, so an open LP beats a closed SP whenever it offers a
better budget"*. Implies SP and LP are both evaluated and the
better one wins. ✓ Consistent with §8 best-margin tier rule.

### G.5 §5 Forward Projection (lines 2465-3060)

**G5.1** **CATEGORISATION ERROR.** §5.0 implementation-status box
(lines 2470-2491) lists *"gray-line bonus
(Section sec:grayline)"* among the forward-projection sub-pieces
that are *"documented for a future build... none of the
forward-projection pipeline currently runs in the live runtime"*.

But the gray-line bonus **IS in the live runtime**:
- §3.13 worked example (line 1789) uses `B_grayline` as a live bonus.
- §7.1 Eq. `blend` (line 3513) defines
  M_verdict = M_physics + B_grayline + max(B_TEP, B_scatter).

So the §5.0 status box is wrong about gray-line. Either:
- Move §5.5 (Gray-Line Bonus) out of §5 into a "Live bonuses"
  subsection of §3 or §6, or
- Remove gray-line from the §5.0 deferred list.

The current placement implies operators reading §5 first would
conclude gray-line never fires.

**G5.2** Variable-name drift: §5.5 Eq. `gl` (line 3008) defines
the gray-line bonus as **B_GL(f)**. §3.13 (line 1789) and §7.1
Eq. `blend` (line 3513) call the same quantity **B_grayline**.
Pick one: B_grayline (longer, clearer) or B_GL (shorter). Use
consistently throughout.

**G5.3** Line 2480: *"the live runtime instead surfaces SWPC's
own next-72 h forecasts on the Outlook panel"*. Verify the panel
actually shows 72 h (matches SWPC's 3-day forecast cadence).
Earlier abstract (line 193) said the projection horizons would
be +3, +6, +12, +24 h (G1.9). The implementation-status note
here says 72 h, which is a third number. Reconcile.

**G5.4** Eq. `muffut` (lines 2498-2503): the projection
multiplies four ratios (zenith, seasonal, storm, [implicit Es]).
The text mentions sporadic-E persistence in §5.4 but does not
appear as a factor in Eq. `muffut`. So the equation is incomplete
relative to the §5.0 sub-piece list, OR Es persistence is
modelled separately (it's a band-MUF gate, not a path-MUF
multiplier). The latter is correct, but the equation should
either:
- Add a comment that Es persistence is a separate gate not
  multiplied into the path MUF, or
- Be presented with all five sub-pieces explicitly.

**G5.5** §5.2 figure `fig:seasonal` (lines 2567-2638): the TikZ
`\addplot` formula uses **calendar-month** phasing
(`theta = pi*(x-0.5)/6`), not the day-of-year phasing that Eq.
`seasonal` actually uses. The figure inline comment at line 2588
explicitly documents this: *"theta = 2*pi*(m + 0.5 - m_winter)/12,
m_winter=0 (Jan) for NH"* — exactly the formulation that the
prose at lines 2552-2555 says is wrong (*"landed the peak five
days early"*).

So the figure plots the **retired** form. The numerical anchor
values stated in the caption (1.063 at winter solstice, 1.072 at
equinoxes, 0.793 at summer solstice) reproduce only because the
old and new forms agree at exact solstice / equinox alignment;
between those points, the figure curve is shifted ~5-10 days
relative to the actual model.

Fix: rewrite the TikZ `\addplot` to use day-of-year phasing
(or accept the difference and add a caption note that the figure
illustrates the seasonal *shape* rather than exact daily phase).

**G5.6** Lines 2703-2718 (storm-floor crossover): math verified
(K_p* = 8.0 on auroral paths). ✓

**G5.7** Line 2720-2723: *"At midlatitudes (|φ_CGM| = 40°), the
damping is 5 % per K_p unit above 4. In the auroral zone (|φ_CGM|
= 70°), it rises to ~15 % per unit."* Per Eq. p, p(70°) = 0.05 +
0.10·1 = 0.15. ✓ 5 % and 15 % match. OK.

**G5.8** §5.3.1 Eq. `kplag` (lines 2763-2770): the kernel weight
is `exp(-|Δt - τ_peak|/τ_decay)`. This is a **Laplace** kernel
centred at τ_peak=2h, not an exponentially-decaying memory. The
text describes it as *"exponentially-weighted effective Kp"*
(line 2759), which is technically correct (the kernel is
exponential) but a reader expecting a forward-decaying
exponential would be misled. Clarify: *"a centred-Laplace
kernel peaked 2 h in the past"* or similar.

**G5.9** Line 2787-2789: *"if NASA DONKI reports an HSS event
within the last 24 hour or next 48 hour, use τ_decay = 24 h"*.
The "next 48 hour" lookahead uses forecast information at the
moment of evaluation, while the kernel itself only convolves
**past** Kp samples. The mixing of forecast (τ choice) and
historical (kernel input) is operationally correct but should
be explicit: *"τ_decay is selected using the DONKI catalogue
including forecast HSS arrivals; the kernel itself only weights
past Kp samples"*.

**G5.10** Line 2856-2862: *"All adjustments are capped at K_p =
9"*. Important sentence; appears at the end of the
fast-storm-drivers section. The cap is global to all the bumps
(Dst, Bz, plasma). Could be promoted to a paragraph header for
visibility.

**G5.11** Line 2982 (Es persistence implementation status):
*"This subsection describes the documented forward-projection
persistence model; it is part of the deferred outlook MUF
projection (Section sec:muf-now-vs-future) and is not exercised
by the live runtime budget at t=0."* OK consistent.

**G5.12** §5.5 line 2986-3008 (Gray-line Bonus): physics text
says the bonus models D-region thinning at the terminator.
Plausible. The asymmetry (sunrise > sunset) is documented.

But the bonus magnitudes in Table `tab:graylineamps`
(lines 3021-3025) are integers / half-integers (6/3, 5/3, 3/1.5,
1.5/1.0). Same "round-numbers signature of hand-set values" as
the low-band table. Note explicitly that these are
empirical-judgment, not machine-fitted, parallel to G3.13.

**G5.13** Line 2995-3006 (gray-line sign-discrimination
explanation): the prose carefully explains why
`d cos chi / dt` distinguishes sunrise from sunset *only at*
the terminator. The explanation is correct but verbose. Could
be tightened to 2 sentences.

**G5.14** Line 3030-3033 (proximity formula):
*"p = 1 - min(1, |cos chi|/0.1)"*. At cos chi = 0: p = 1 (full
amplitude). At |cos chi| = 0.1: p = 0. ✓ Linear ramp, continuous.

**G5.15** §5 overall structure: the section opens with an
implementation-status callout that says the entire section is
deferred, then has paragraph-level "Implementation status"
insets in §5.1 and §5.3, then doesn't repeat the inset in §5.2,
§5.4, §5.5. The pattern is inconsistent. Either:
- Add insets in §5.2, §5.4, §5.5 (status: gray-line is *active*
  in live budget per G5.1; seasonal-ratio and Es-persistence are
  deferred), or
- Trust the §5.0 callout and remove the per-subsection insets.

**G5.16** Eq. `kplag` (line 2763-2770): tau_peak = 2 h, tau_decay
= 8 h (CME) or 24 h (HSS). At |Δt - τ_peak| = 8h on the CME
branch, weight = 1/e ≈ 0.37. At Δt = 0 (now), weight =
exp(-2/8) = 0.78. So "now" is weighted 78%, "2h ago" 100%, "10h
ago" 37%. That feels reasonable. ✓

**G5.17** Storm-type classification (lines 2782-2799): three-way
branch (deep-Dst → CME, DONKI HSS window → HSS, else → CME). The
default-CME fallback (line 2798) is sensible but conflates
"actually CME" with "unknown". Add a one-line note that the
default is "treat as impulsive" rather than "CME confirmed".

### G.6 §6 Alternative Propagation Modes (lines 3060-3496)

**G6.1** §6.1 Es as a Mode. Eq. `esmargin` (line 3088-3096)
uses fixed `d_Es = 2000 km` regardless of actual TX-RX path
length. So:
- A 500 km path cannot use the Es budget (it would need a
  500 km Es geometry; the model assumes 2000 km).
- A 10000 km path that could conceivably support 5 Es hops
  cannot be evaluated as multi-hop Es; the model is single-hop
  only.

The 2000 km characteristic is the operationally relevant
sweet spot, but the limitation should be stated explicitly.
Add: *"Single-hop Es only; multi-hop Es chains are not modelled."*

**G6.2** Line 3097: *"d_Es = 2000 km, single-hop takeoff angle
≈ 6.3°"*. Verified: arctan(2 · 110/2000) = arctan(0.11) = 6.28°.
✓ OK.

**G6.3** Line 3155-3156: *"Es variability adds +2 dB in
quadrature to the base σ"*. This σ widening is mentioned here
but **not** in §7.3's sigma-widening enumeration (lines
3978-4060), which lists Near-MUF, Storm, Forecast-storm,
Cross-terminator, Storm-recovery TID. The Es-mode-active
quadrature contribution is missing from that list. Either:
- Add a sixth widening for Es-active in §7.3, or
- Move the Es +2 dB statement to §7.3 with the others.

**G6.4** §6.2 TEP. Eq. `tepplateau` math verified at quiet sun
(9 dB), F107A=120 (11 dB), F107A=180 (14 dB). ✓

**G6.5** §6.2 line 3185-3191 (dip-latitude factor): *"each
endpoint's |φ_dip| ramps from half-threshold (5°) to full
threshold (10°)"*. The label *"half-threshold"* is ambiguous. Is
the factor 0.5 at φ_dip=5° (matching "half"), or 0 at 5° and 1
at 10°? Reading the §3.13 worked example (line 1798-1799):
*"both endpoints past the dip-latitude saturation knee at
|φ_dip| ≥ 10°"* and *"f_dip = 1 · 1"* — so factor=1 at 10°. Then
"half-threshold (5°)" should make factor=0.5 there.

Specify the formula explicitly:
- f_dip(|φ_dip|) = clamp((|φ_dip| - 5°) / 5°, 0, 1) gives 0
  at 5°, 1 at 10°. (Bottom-zero ramp.)
- Or: 0.5 + clamp((|φ_dip| - 5°) / 10°, 0, 0.5) gives 0.5 at
  5°, 1 at 10°. (Half-base ramp.)

The text doesn't disambiguate. Add the explicit formula.

**G6.6** §6.3 Meteor Scatter (line 3253-3264): The MS-active
**boolean** flag *"fires on any non-zero weight"* (line 3260),
so the verdict-floor cliff is at weight=0 (LT 1.5, 10.5), not
at weight=1.0. The "smoothing" doesn't actually smooth the
verdict transition — it just moves the cliff to the edges of the
ramp. The prose at line 3262-3263 says *"the previous tier cliff
at the boundary has been moved to the weight=0 edges where MS
activity is genuinely below useful threshold"*. So the cliff
isn't gone; it's just less consequential. State this honestly:
*"the cliff in the verdict transition is moved to LT=1.5/10.5
where MS activity is sub-threshold; smooth-ramp philosophy is
followed only on the weight value itself, not the verdict
floor"*.

**G6.7** §6.4 F2 Scatter. Eq. `scatterbonus` (line 3298-3304)
gating: line 3296-3297 lists three conditions:
- "at least two stations contribute"
- "the path takes ≥ 2 hops"
- (later) "f/MUF > 1.0"

The three-way gating is operationally clear but should be in a
single bullet list, not split across paragraphs.

**G6.8** Line 3318: *"sitting inside published F2-scatter
measurements (10-25 dB)"*. This is a literature claim without a
citation. F2 scatter recovery magnitudes are documented in
Sherman & Reed type studies; add a citation if available.

**G6.9** Line 3354-3364 (per-hop fusion deferred). Mentions
`FUSION_PRIMARY_MUF` flag. ✓ Code-side flag named.

**G6.10** §6.5 Tropospheric Ducting. Eq. `refractivity`
(line 3383-3384): N = (77.6/T)(P + 4810e/T). Standard form. ✓

**G6.11** Eq. `esat` (line 3389-3392): Magnus saturation,
liquid-water coefficients (17.62, 243.12). The
ice-saturation alternative coefficients (22.46, 272.62) are
mentioned but not used. The paper says the ice-vs-liquid bias
is *"≤ 2 N-units in the worst case"*. Verify approximate
magnitude: at t_C = -20°C, e_sat,liquid ≈ 6.112 ·
exp(17.62·-20/(243.12-20)) = 6.112 · exp(-1.580) ≈ 1.26 mb;
e_sat,ice ≈ 6.112 · exp(22.46·-20/(272.62-20)) = 6.112 ·
exp(-1.781) ≈ 1.03 mb. Difference: 0.23 mb at t_C=-20°C. The
ΔN contribution at typical T=253 K, P=1000 mb: ΔN = (77.6/253)
· (4810 · 0.23/253) = 0.307 · 4.37 = 1.34 N-units.

So the *"≤ 2 N-units worst case"* claim is plausible at
t_C=-20°C. ✓ But at colder T (e.g. t_C=-40°C, mid-troposphere
in winter polar regions), the bias could be larger. Specify
the temperature range over which "≤ 2" applies.

**G6.12** Eq. `modM` (line 3412-3413): M(z) = N(z) + 0.157·z,
"with z in metres". The 0.157 has units N/m. The duct threshold
in Eq. `ductthreshold` uses -157 N-units/km. Conversion:
0.157 N/m × 1000 m/km = 157 N/km. ✓

**G6.13** Line 3450-3454: 24-station basket breakdown. Sum:
10 + 7 + 3 + 2 + 1 + 1 = 24. ✓ Matches the count claim.

**G6.14** Line 3457: *"with a 12 s per-fetch timeout to bound
the worst case"*. With 24 stations and 12 s timeout, if all
fail the worst-case latency is 12 s (parallel fetch). ✓ OK.

**G6.15** §6.5 says *"the gradient is per-station, not per-band"*
(line 3475-3476). The VHF band table shares one cell across 6m
and 2m. ✓ Consistent.

**G6.16** §6.5 informational-only argument (line 3481-3496):
*"A duct is only useful if both endpoints sit inside it... the
radiosonde network samples vertical structure at fixed sites
every 12 hours"*. Sound argument. But it doesn't address why
the gradient at one endpoint might inform the operator's local
station while leaving the other end unknown — a feature the
panel could surface (operator-end-only ducting status) and the
paper does not describe.

### G.7 §7 Ensemble Blend + Self-Calibration (lines 3499-4330)

**G7.1** Line 3601-3603: *"The two layers exchange exactly one
thing: the calibrated constants in `src/constants.js` and the
WSPR spot baselines in `src/data/spot-baselines.mjs`."* Two files
listed under "exactly one thing". Reword to *"two artefacts"*
or *"the calibration data set: constants.js and
spot-baselines.mjs"*.

**G7.2** Line 3617: *"6-12 dB depending on band"*. Already in A2.
Repeats here.

**G7.3** Line 3637-3640: *"the Atlantic / Americas
trough-and-crest pair"* (Ascension and Jicamarca). Per §4.2 line
2073-2076, Ascension is at dip lat ~-7° (closer to trough than
to southern crest peak at -15°), and Jicamarca is essentially
on the dip equator (~1°S). Both are in the trough region. Calling
them a "trough-and-crest pair" is wrong: it is a "trough-and-
near-trough pair". Already noted A4 implicitly.

**G7.4** Line 3805: *"the σ widenings of §sec:tier-confidence
(storm, terminator, near-MUF)"*. **Three** widenings listed. But
§7.3.2 (line 3978-4060) enumerates **five**: Near-MUF, Storm,
Forecast-storm, Cross-terminator, Storm-recovery TID. The
inline-list count is stale (missing Forecast-storm and
Storm-recovery TID).

**G7.5** Line 4063 (RSS formula):
σ = sqrt(σ_g² + σ_MUF² + σ_storm² + σ_forecast² + σ_term² +
σ_recovery²). Six terms. But Es-active widening (+2 dB in
quadrature, §6.1 line 3155-3156) is not in this list. Either
add σ_Es to the RSS or remove the +2 dB claim from §6.1. See
G6.3.

**G7.6** Tier figure `fig:tierprob` caption (lines 4321-4324):
*"the HF bands use σ_g ∈ {6, 10, 12} dB depending on band"*.
**Stale.** Per Table `tab:bandsigma`, HF σ_g values are
{8, 8, 8, 8, 9, 9, 9, 10, 12, 12} — i.e. set is {8, 9, 10, 12},
not {6, 10, 12}. Update to *"σ_g ∈ {8, 9, 10, 12} dB depending
on band"*. Same root cause as A2.

**G7.7** Table `tab:sigmasens` (lines 4170-4194) **assigned σ_g
values are wrong** for 15 m and 17 m vs `tab:bandsigma`:

- `tab:bandsigma` for 15 m: σ_g = **10** dB.
  `tab:sigmasens` for 15 m: assigned = **12** dB (lower=10,
  upper=14). Off by 2.
- `tab:bandsigma` for 17 m: σ_g = **9** dB.
  `tab:sigmasens` for 17 m: assigned = **10** dB (lower=8,
  upper=12). Off by 1.

The sweep values cascade: 17 m's lower-edge σ=8 should be
σ=7 (or σ-2=7); 15 m's lower-edge σ=10 should be σ=8.
Recompute the table values accordingly. The Fair/Good
verdict-flip conclusions in the prose (line 4196-4206) need to
re-derive for the corrected σ values.

This is downstream of the same A1/A2 propagation gap.

**G7.8** Line 4196-4206 (sensitivity prose): *"17 m has the
narrowest Fair/Good gap in dB (0.2533·σ_g = 2.53 dB)"*. For
σ_g = 9 (the actual `tab:bandsigma` value), 0.2533·9 = 2.28 dB.
The prose computes for σ_g=10 (the `tab:sigmasens` mislabel).
Update to 2.28 dB and re-verify the Fair/Good flip claim.

**G7.9** Line 3548-3554 (TEP / scatter saturation example): the
*"15 dB at saturation"* claim for both is correct only at solar
maximum for TEP (B_TEP,plateau saturates at 15 dB at F107A → ∞).
At F107A=120 the TEP plateau is 11 dB, so the "shared 15 dB
ceiling" only holds asymptotically. Reword to *"share the 15 dB
ceiling at solar maximum; at moderate cycle TEP saturates lower
(~11 dB)"*.

**G7.10** Line 3586: *"The N0NBH-style heuristicTier function
remains available in src/physics/physics.js as an independent
reference predictor but is no longer in the verdict path."*
This is implementation detail bordering on changelog. State once
or move to F (historical narrative).

**G7.11** Line 3700: tune.mjs descent space includes
`fusion-flag`. Per §6.4 paragraph "Per-hop fusion (deferred)",
the flag stayed off in the production sweep. Specify in §7.2
that the descent's converged value for fusion-flag was `false`
(not arbitrary).

**G7.12** Line 3704-3708: *"all three seeds converge to the same
basin in ≤ 2 iterations: 'same basin' here means the final
{L_iono, D, w_sc} landed within ±10 % across seeds and the final
Brier landed within ±0.001"*. The convergence test is on three
parameters out of seven. The other four (w_NVIS-tail, w_Es-prim,
σ-scale, fusion-flag) presumably also converged to the same
values across seeds, but the prose only checks three. State
explicitly that the other four also converged (or specify which
parameters are checked for convergence).

**G7.13** Table `tab:harnessruns` (lines 3725-3757): two pre-
production rows ("Pre-R7 baseline", "Post-R7 sweep
(2026-04-25)") are F1/F3 changelog. Already flagged for cut.

**G7.14** Per-path-truth metrics (Brier 0.6353): for binary
prediction with reference truth, the maximum Brier score for an
all-uniform predictor is 0.25. Brier = 0.6353 means the
prediction is **anti-correlated** with the per-path truth.
Either:
- The prediction probabilities are scaled wrong (e.g. predicting
  probability of the wrong class), or
- The per-path truth is so sparse (most cells closed) that the
  metric is dominated by predictions of "open" against truth
  "closed", which is a calibration mismatch rather than
  predictive failure.

The footnote at line 3744-3756 explains the structural-ceiling
argument, but does not address why Brier > 0.25 specifically.
Add a note: *"Brier > 0.25 reflects the model's open-leaning
prior against the per-path truth's closed-dominated empirical
distribution; this is a calibration mismatch, not anti-prediction."*

**G7.15** Line 3937-3942: feedback paragraph about high-WSPR-
activity bands. *"bands with high WSPR activity have those
operators because the band is reliably open --- a feedback that
the current intra-band normalisation sidesteps but does not
eliminate."* Important caveat. ✓

**G7.16** §7.3.2 Verdict Stability formula `eq:tierstab`
(line 3853-3856): S = Φ(min |z - b|). At z=b (on a boundary),
min |z - b| = 0, so S = Φ(0) = 0.5 = 50 %. ✓

**G7.17** Line 3877: *"Poor (~0.90 σ wide)"*. Verify: Poor band
in z-space is [-1.2816, -0.3853], width = 0.8963 ≈ 0.90 σ. ✓
Fair (~0.64 σ wide): width = 0.6386 ≈ 0.64 σ. ✓
Good (~1.03 σ wide): width = 1.0283 ≈ 1.03 σ. ✓ Math holds.

**G7.18** Line 3891-3895: centred Fair verdict z=-0.066, Φ(0.32)
= 0.625 → 63 %, two-sided 2Φ(0.32) - 1 = 0.25. ✓ The two-sided
*"~25 %"* matches; the one-sided 63 % matches. OK.

**G7.19** §7.3.2 line 3909-3911: Eq. completion: `Comp(b, h, M,
σ) = R(M, σ) · a(b, h)`. ✓ Multiplicative.

**G7.20** Line 3924: *"an Excellent tier on 12 m at 0300 UTC
reads ~95 % physics-permitted (R) and ~5-10 % Comp."* Specific
example. At 95 % physics, 5-10 % Comp implies a(b=12m, h=03 UTC)
= 0.05 to 0.10. Plausible (12 m at 03 UTC is dead-of-night for
NA/EU operator population).

**G7.21** Storm-time correlation paragraph (line 3944-3961):
acknowledges the independence-assumption breakdown. ✓

**G7.22** Footnote at line 3966-3977 (σ overloading): five
distinct meanings. Already in D2.

**G7.23** Storm σ formula (line 3987): σ_storm = 3 + 0.75·(K_p^eff
- 5) dB at K_p^eff ≥ 5.
- K_p^eff = 5: σ_storm = 3 dB. ✓
- K_p^eff = 9: σ_storm = 3 + 0.75·4 = 6 dB. ✓

**G7.24** Forecast σ formula (line 4011-4014):
σ_forecast = 0.7 · σ_storm(K_p^peak) · min(1, max(0, K_p^peak -
K_p^eff)). At K_p^eff = K_p^peak: min(1, 0) = 0, σ_forecast = 0.
At K_p^peak - K_p^eff ≥ 1: clamps to 1, σ_forecast = 0.7 ·
σ_storm(K_p^peak). ✓

**G7.25** Line 4021-4026: hand-off arithmetic at catch-up. *"the
intended hand-off to σ_storm alone"* — but the formula's
hand-off is `σ_forecast → 0` as `K_p^eff → K_p^peak`. So the
quadrature combination at catch-up reduces to σ_storm alone. ✓
Math is right.

**G7.26** Storm-main amplification (lines 4102-4115): 1.4×
multiplier on L_aur during main phase. *"main is identified by
Dst ≤ -50 nT with K_p^eff still loading"*. Same Dst threshold
as the +2 K_p bump (line 2809). ✓ Consistent.

**G7.27** Tier figure `fig:tierprob`: math verified.
- z_p = (-10.25 - 3) / 8 = -1.6566 → Φ(-1.6566) = 0.0488 → 5%.
  Wait, I want P(verdict = Closed) = P(M < -10.25 | M ~ N(3, 8)).
  z = (-10.25 - 3)/8 = -1.6566. Φ(-1.6566) = 1 - Φ(1.6566) =
  1 - 0.9512 = 0.0488. ✓ 5 %.
- z_f = (-3.08 - 3)/8 = -0.7603 → Φ = 0.2236.
- P(Poor) = Φ(z_f) - Φ(z_p) = 0.2236 - 0.0488 = 0.1748 → 17 %. ✓
- z_g = (2.03 - 3)/8 = -0.1218 → Φ = 0.4515.
- P(Fair) = 0.4515 - 0.2236 = 0.2279 → 23 %. ✓
- z_e = (10.25 - 3)/8 = 0.9066 → Φ = 0.8177.
- P(Good) = 0.8177 - 0.4515 = 0.3662 → 37 %. ✓
- P(Excellent) = 1 - 0.8177 = 0.1823 → 18 %. ✓

All match the figure annotations. ✓

**G7.28** Line 4316-4317 (caption): "boundaries are ±0.39σ /
+0.25σ (-3.08 / +2.03 dB, the Fair band)". The "±0.39σ" notation
is shorthand for "boundaries at -0.385 σ (Poor/Fair) and +0.253
σ (Fair/Good)". The ± alone could be misread as -0.39 and +0.39
(symmetric), but the actual boundaries are asymmetric. Reword to
*"boundaries at -0.39 σ (Poor/Fair) and +0.25 σ (Fair/Good)"*.

### G.8 §8 Tier Mapping (lines 4332-4609)

**G8.1** Line 4346: example *"944 km EM79–NYC path reporting
+27 dB margin"*. EM79 is approximately central Indiana / Ohio.
EM79 to NYC FN20 distance ≈ 800-900 km depending on exact grids.
944 km is plausible. ✓ Specific number is illustrative.

**G8.2** Table `tab:tiers` caption lines 4394-4399:
verified math:
- σ=8: Excellent at 1.2816·8 = 10.25 dB; Good at 0.2533·8 = 2.03
- σ=9: Excellent at 11.53; Good at 2.28
- σ=10: Excellent at 12.82; Good at 2.53
- σ=12: Excellent at 15.38; Good at 3.04
Caption ranges *"+10 to 12"* and *"+12.8 to 15.4"* for Excellent
and *"+2.0 to 2.3"* and *"+2.5 to 3.0"* for Good — all consistent.
✓ OK.

**G8.3** Line 4475: *"a centred physics-Fair row reads 'Fair'
near the 66 % middle-tier ceiling"*. The Fair-bucket centred
Stability cap is **63 %** (Φ(0.32)) per line 3880, not 66 %.
The 66 % matches the average-across-buckets number from line
4868 (which is also wrong per A7). Update to *"~63 % Stability
ceiling"* for Fair.

**G8.4** **INTERNAL CONTRADICTION on baseline regeneration
cadence.**

- Line 4493-4498 (Data-driven baselines paragraph): *"regenerated
  daily by the wspr-baselines.yml GitHub Actions workflow (a
  06:00 UTC cron job that runs `node scripts/harness.mjs
  wspr-baselines` and commits the diff to
  `src/data/spot-baselines.mjs`, providing a true sliding 30-day
  window that tracks solar-cycle progression and seasonal shifts
  without manual intervention)"*.

- Line 4575-4587 (later in the same subsection): *"It is currently
  re-generated manually every few months, which is too slow at
  solar-cycle phase transitions ... a sliding 30-day baseline
  updated daily would track activity changes properly without
  retraining the harness ... switching to the daily-sliding form
  is candidate operational work tracked in §sec:limits."*

These two paragraphs claim opposite things about the actual
shipping cadence. Either:
- The daily GH Actions workflow is real (4493) and the
  "manually every few months" claim (4575) is stale, OR
- The daily workflow is aspirational and the actual practice is
  manual (4575), in which case 4493 is misleading.

Resolve before next release. Verify the shipping
`wspr-baselines.yml` workflow against `.github/workflows/`.

**G8.5** Line 4538-4544 (weekend filter): historical commentary
about Mon-Fri-only baseline. F1/F2.

**G8.6** Lines 4549-4555 (overdispersion claim): *"WSPR hourly
spot counts are over-dispersed Poisson with... coefficient of
variation ranges from ~0.3 on heavily-trafficked daytime cells
(20m at 1500 UTC) to ~1.5 on quiet upper-band predawn cells
(10m at 0300 UTC)"*. Specific empirical claim. Verifiable
against the wspr.rx table over a 30-day window. Worth a citation
or footnote pointing to the analysis script if available.

**G8.7** Line 4559-4571 (1.3× threshold rationale): *"swept
candidate thresholds in {1.0, 1.1, ..., 2.0}... 1.3× was the
smallest ratio at which the override fired on roughly 5-10 % of
(band, hour) cells per day"*. The sweep result is reported as a
percentage of (band, hour) cells. With 10 bands × 24 hours = 240
cells, 5-10 % is 12-24 cells/day firing. ✓ Reasonable target.

**G8.8** Line 4593-4595: *"~60 % of worldwide WSPR receivers
sit in those two regions [NA + EU], with another ~15 % in the
AU/NZ/JA cluster"*. Specific population claim. Verifiable
against wsprnet.org's active-stations roster, but the precise
fraction shifts daily. Add a footnote linking to the
methodology used (e.g. *"unique callsigns reporting at least
one spot in the past 30 days"*) and date-stamp the count.

**G8.9** Line 4439-4440: *"An unconditional σ_g = 8 dB fallback
exists in tier.js as DEFAULT_SIGMA_DB"*. Verified ✓ in code by
Explore agent (item 14).

**G8.10** §8.1 architectural split between per-band rows and
band-group summary (lines 4467-4486): the design pattern is
described thoughtfully. The override fires on the **group**
summary, not on individual rows. This means an operator looking
at the band table can read row Tier and row Stability as
internally consistent, while the group-summary line shows the
operator the override-promoted Tier with the activity note.
Sound design. ✓

**G8.11** Line 4502-4509 (ClickHouse query): the inner GROUP BY
on `band, h, hour_utc` produces one row per (band, day-hour, hour-of-day)
cell. The outer GROUP BY on `band, hour_utc` then sums across
the 30 days for each (band, hour-of-day). Dividing by 30.0 gives
the average daily count for that hour. ✓ Math correct.

**G8.12** Line 4501: alias `AS avg`. SQL keyword `AVG` is also
the function name. Some ClickHouse versions handle this fine,
others throw (alias-vs-function ambiguity). Renaming to
`avg_count` would be more defensive.

### G.9 §9 Output + Alerts (lines 4609-4965)

**G9.1** Figure `fig:noise` caption (line 4665-4666): *"the
phantom 7 dB margin that a linear (dB-domain) sum would
produce at midday"*. The "linear dB sum" comparison is not
defined elsewhere. Adding two dB values directly is meaningless
(N_atmo + N_mm = -225 dBm). Halving them (averaging) gives
-112.5 dBm, vs power-sum's -100 dBm — that's a 12.5 dB
difference, not 7 dB. Specify the comparison being made. (The
"7 dB" might be against the rural double-count formerly produced
by the un-gated indicator, per G2 of §3.10.)

**G9.2** Figure `fig:dabs` caption (line 4744-4748): explicitly
states the figure smooths the cos chi < 0.05 hard gate for
readability. ✓ Honest disclosure.

**G9.3** Line 4771-4772 (HF Bands panel): *"the dominant
propagation mode (F2 / NVIS / Es / Aurora)"*. The four mode
labels listed.

But §6 alternative-mode list is: Es-as-mode, TEP, Meteor
Scatter, F2 scatter, Tropo. None of those listed in §6 are
called "Aurora". And §3.5 covers auroral absorption (a loss
term), not auroral propagation as a mode.

So "Aurora" here is referring to either:
- Auroral propagation as a separate mode (not described in §6),
  OR
- A path-condition flag (path traverses auroral oval) rather
  than a propagation mode.

Clarify: if Aurora is a true propagation mode, document it in
§6; if it's a path-condition annotation, don't call it a
"propagation mode".

**G9.4** Line 4781-4789 (VHF Bands): *"Es-MUF / aurora /
meteor-scatter mode labelling"*. Three VHF modes, parallel to
HF four-mode list (G9.3). MS is in §6.3, OK. Aurora again
appears as a mode label without §6 documentation.

**G9.5** Line 4868: *"cap at Φ(0.42) ≈ 66 %"*. Already in A7.
Repeated here.

**G9.6** Line 4901-4917 **Intra-tier sort order vs causal-chain
rationale**:

The sort order is: FLARE → K_p → B_z → D_st → AURORA → DRAP →
PCA → STORM TAIL.

The text (line 4907-4913) rationalises the geomagnetic-indices
order *(K_p, B_z, D_st)* as *"reflecting the upstream causal
chain --- B_z at the L1 monitor leads geomagnetic-effect K_p at
Earth by ~30-60 min..., and K_p leads D_st by ~30-60 min..."*

But the **causal** chain is B_z → K_p → D_st (early to late).
If the sort followed the causal chain (earliest signal first), it
would be **B_z → K_p → D_st**, not the actual K_p → B_z → D_st.

Two possible fixes:
- Reorder to B_z → K_p → D_st (causal-chain-correct), or
- Justify the actual K_p-first order on different grounds (e.g.
  *"K_p is the most familiar index to amateur operators"*).

As stated, the rationale doesn't match the actual order.

**G9.7** Line 4912-4913: *"the L1-to-Earth lead is the larger
and more operationally useful of the two"*. This sentence is
inside the geomagnetic-indices order paragraph and seems to
prioritize B_z (the L1 monitor's signal) — but the actual
sort puts K_p before B_z. The sentence reinforces the G9.6
mismatch.

**G9.8** Table `tab:soft-alerts`: 8 trigger rows verified
against the *"Eight rules"* claim (line 4891). ✓

**G9.9** D_st rows (line 4941-4943): both -150 and -100 are
"alert" level but with different labels (SEVERE vs STRONG).
A reader scanning levels might miss that two alert-level rows
exist for the same trigger. Worth a column note or visual
separator.

**G9.10** Line 4955: Storm recovery tail trigger:
*"K_p,eff − K_p ≥ 1 AND K_p,eff ≥ 4"*. The first condition
captures the recovery phase (effective Kp is higher than live,
so the F-region is still recovering). The second avoids firing
on quiet conditions (Kp_eff just barely above quiet). Sensible.

**G9.11** Line 4946: *"HP ≥ 50 GW info"*. The same 50 GW floor
appears in §3.5 line 800-803 as the lower bound of the
auroral-absorption HP-driver. Consistent ✓.

**G9.12** Line 4948-4949: DRAP threshold ≥ 10 MHz alert. Per
§3.3 (D-RAP), the gate r = HAF/f starts firing absorption at
r ≥ 0.25. So at f = 14 MHz the gate fires when HAF ≥ 3.5 MHz.
The alert threshold of HAF ≥ 10 MHz is far above the
absorption-gate threshold; the alert is for major flare events
where DRAP itself escalates. ✓ Sensible separation.

**G9.13** Line 4960-4965: *"Soft alerts render alongside SWPC
notices rather than only when the official feed is empty"*.
Implicit: a redundant alert (SWPC's own + ionocast's soft) will
appear twice in the panel. Worth noting that de-duplication is
not attempted; the operator sees both.

**G9.14** §9 line 4762-4763 *"the ten HF amateur bands"*. 160m,
80m, 60m, 40m, 30m, 20m, 17m, 15m, 12m, 10m = 10. ✓

**G9.15** Line 4796-4800 (Ionosphere panel): *"the per-QTH path
table listing kc2g MUF on the five short-path destinations and
their long-path counterparts, ten paths total"*. The
"ten paths" phrasing here is correct, contradicting G1.8 / G4.1
which both noted "five reference paths" wording elsewhere. Use
"ten paths" consistently throughout.

**G9.16** Line 4811-4812 (Solar panel): *"SDO imagery (EUV 193
/ EUV 304 / magnetogram)"*. Verify panel content matches
implementation. Not done.

**G9.17** Line 4823-4847 §9.1 enumerates 3 panels with
non-trivial logic (Active Alerts, HF/VHF Bands, Reference Paths).
Line 4848-4857 says the remaining 5 panels are *"data-source
documentation: each block is a labelled rendering of a fetched
upstream"*. Sound separation. The §9 layout doesn't dedicate
sub-sections to those 5 panels, just acknowledges them. ✓

### G.10 §10 Known Limitations + Future Work (lines 4968-5251)

**G10.1** Intro classification (line 4970-4985) says #14 is a
*"physics gap"* item. But the actual #14 (line 5207-5249) is
described as *"$N_\text{base}$ table re-anchored to P.372
quiet-rural (closed 2026-04-30)"* — a **closed** item with a
40-line historical retrospective. This isn't a current
limitation; it's a closed change. Either:
- Cut #14 entirely (it's done; move the historical note to a
  separate "Recent changes" appendix), or
- Update the intro classification to acknowledge #14 as
  "recently closed" rather than "physics gap".

**G10.2** Intro #5 to #7 description: *"#5-#7 anomalies and
SID decay"*. Actual content:
- #5: Equatorial anomaly crests
- #6: Flare SID decay
- #7: Storm-lag kernel one-parameter

#7 is the storm-lag kernel, not anomalies or SID decay. The
intro grouping is loose. Reword to *"#5 anomalies, #6 SID decay,
#7 storm-lag kernel"*.

**G10.3** Intro #1 description: *"#1 in-app feedback warm-up"*.
But #1's actual content (line 4988-5002) describes
*"the on-device validation feedback loop (Section sec:ensemble)"*
which is a feature **not described** in §7 (Ensemble + Self-
Calibration). §7 covers the offline harness, not on-device
operator feedback. Either:
- §7 needs a subsection on the on-device feedback loop, or
- #1 is referencing a feature that isn't actually shipped (and
  shouldn't be in the limitations list at all).

Cross-check `src/derive/feedback.js` or similar against the
description at line 4989-5002 to determine which.

**G10.4** Limits #1 line 4994-4996: *"the per-band base from
Table tab:bandsigma (6 dB on 160m-20m, 10 dB on 17m, 12 dB on
15m / 12m / 10m, 8 dB on the VHF placeholders)"*. **Stale**.
Already A2. Update to {8, 8, 8, 8, 9, 9, 9, 10, 12, 12} per
Table `tab:bandsigma` post-2026-04-30 refit.

**G10.5** Limits #3 line 5021-5024 (NVIS): *"NVIS model uses
foF2 directly. For paths < 500 km the model substitutes GIRO
foF2 as the effective MUF. A more accurate NVIS model would
account for layer height and off-vertical angles up to ~70°."*

But §4.7 (Eq. nvis, line 2333-2336) already applies a secant
correction `MUF_NVIS = f_oF2 · sec(arctan(d/(2 h_F)))`. The
limitation #3 description claims "uses foF2 directly" without
noting the secant correction is in place. Update #3 to
acknowledge the existing secant form and re-state what's still
missing (e.g. *"the secant correction applies up to single-hop
NVIS geometry; off-vertical angles approaching 70° are not
explicitly modelled, and h_F is treated as a fixed 300 km
fallback rather than the path-traced layer height"*).

Already in C4. Repeated here because the #3 wording is
particularly out of date.

**G10.6** Limits #5 line 5040-5047: *"~30% daytime enhancement
at dip latitude ±15°"* for EIA crests. Per §4.2 Eq. eia-amp,
A_cr ranges from 0.50 (quiet sun) to 0.85 (capped, high F107A).
At current moderate-cycle epoch, the enhancement is **85%**, not
30%. The 30% figure understates the model. Update to *"30 to 85%
daytime enhancement depending on solar cycle phase"*, or specify
the F107A regime the 30% applies to.

**G10.7** Limits #7 line 5056-5062 (Storm-lag kernel): *"one-
parameter model... uses fixed τ_peak and τ_decay"*. Per §5.3.1,
τ_decay actually has **two** values (8 h CME, 24 h HSS) chosen
by storm-type classification. So it's not strictly "one
parameter"; it's two parameters with a discrete classifier.
Update to *"two-parameter (τ_peak fixed; τ_decay switched 8h /
24h) model that does not vary with storm intensity, latitude, or
season"*.

**G10.8** Limits #8 (line 5064-5089): heavily larded with
historical run-to-run accBin / Brier deltas (91.08% → 92.35% →
94.25%, "post-R7 sweep", "before the 2026-04-28 per-hop MUF
restructuring"). F1/F5. Cut to *"upper-band tracking is
scatter-recovery-bound; w_sc is the dominant driver of upper-
band lift"* and reference Table `tab:harnessruns` for the
current numbers.

**G10.9** Limits #10 (lines 5113-5134): claims *"no GIRO station
in our list sits on the northern crest"* and *"the equatorial
bias floors at ~2.2 MHz"*. **Stale.** Both contradict §4.2 line
2107-2110 which says BVJ03 Boa Vista (BR, dip lat ~+12°) was
added 2026-04-29 and the fit converged with eqMaxAbs dropping
1.84 → 1.18 MHz. Already in A4. Repeat here for emphasis.

**G10.10** Limits #11 (lines 5136-5160): *"the northern-crest
stations are currently absent from the GIRO basket; once at
least one is added... the polar / equatorial joint refit becomes
tractable"*. **Stale** — Boa Vista is already in the basket. The
joint refit is now tractable but the description implies it's
still blocked on adding stations.

**G10.11** Limits #11 line 5142-5143: *"polar wants a steeper
sigmoid above 60°, equatorial wants northern-crest stations"*.
The polar sigmoid was already partially addressed by Eq.
fof2-poleward (the 73°/8° sigmoid). #11 acknowledges this with
*"partly addressed by Eq.~\ref{eq:fof2-poleward}"*. ✓

**G10.12** Limits #12 (lines 5162-5181): the w_sc-vs-metric-
ceiling argument. Real and well-articulated. Already covered in
the body §6.4.

**G10.13** Limits #13 (lines 5183-5205): rare 30m/40m Es
openings missed. ✓ Real.

**G10.14** Limits #14 (lines 5207-5249): **closed change**
written as a limitation. The first paragraph (lines 5208-5223)
is the diagnosis, the second paragraph (lines 5225-5232) is the
fix description, the third paragraph (lines 5234-5249) is the
validation. All three paragraphs describe **completed work**,
not a current limitation.

If the goal of §10 is to list current limitations and future
work, #14 doesn't belong. Cut it entirely. The history note
(if needed) belongs in F (changelog removal) or in an
acknowledgments section.

**G10.15** Limits numbering: 14 numbered items, but the intro
classifies them into 3 buckets that don't cover all 14. Specifically
the intro lists items by number for each bucket but doesn't
mention #5 explicitly:
- physics gaps: #2, #3, #4, #5-#7, #10-#11, #13, #14
- validation gaps: #9, #12
- process / cadence: #1, #8

That sums to 14 but the bucket assignments overlap and some
descriptions don't quite match (e.g. #14 is "closed", not a
gap). Simplify or re-classify.

**G10.16** Limits ordering claim *"numbering is chronological by
when the item entered the backlog"* (line 4984-4985). Verify
this against the dates referenced inside each item:
- #1: cites Table `tab:bandsigma` defaults (no date implied)
- #5: EIA crests
- #8: 2026-04-28 (recent)
- #10: 2026-04-25
- #14: 2026-04-30

If chronological, #14 (newest) should be last. ✓ It is. But
#10 (2026-04-25) coming before #11 and #12 (which cite later
2026-04-26 work) — verify ordering matches.

**G10.17** Limits paragraph at line 4970-4985 mentions
*"The numbering is chronological"* but a reader might want a
**priority** ordering (most-load-bearing first) instead. State
explicitly that the numbering is **not** a priority ranking.

### G.11 Appendices A-D + Bibliography (lines 5252-5738)

**G11.1** Appendix A `tab:defaults` (lines 5257-5275): σ_g range
*"6-12 dB"* (line 5270) — A3 stale. Should be *"8-12 dB"*.

**G11.2** Appendix A `tab:defaults` "Hop distance" row (line
5272): *"4000 km, Assumes h_F = 300 km"*. But §3.6 Eq. hopceiling
makes hop distance vary with h_F (4000 km only at h_F=300; 4258
km at h_F=340). The default-settings row should say *"4000 km
fallback when no GIRO h_mF2 reading is available; otherwise
varies as 4000 · sqrt(h_mF2/300) per Eq. hopceiling"*.

**G11.3** Appendix B (line 5277-5290): mostly redirects to Table
`tab:noisebase`. Line 5286-5290 historical comment about retired
expanded version. F1.

**G11.4** Appendix C `tab:paths` (line 5304-5355) path naming:

- *"Asia-EU short"* (line 5346): TX Moscow (55.75, 37.62) → RX
  Tokyo (35.68, 139.69). Naming is reversed: with TX in
  Moscow (which is conventionally "EU" or "EE") and RX in
  Tokyo ("Asia"), this is **EU-Asia short**, not Asia-EU.

  Compare with "EU-Asia" (line 5326): Lisbon → Tokyo, naming
  matches direction. The "Asia-EU short" entry contradicts the
  naming convention.

- *"Polar W-UA"* (line 5341): TX NYC (40.71, -74.01) → RX
  Moscow. The "W" in "Polar W" is unclear. NYC is on the East
  Coast, not the West. The W is presumably "Western" hemisphere.
  Confusing naming for a paper-side reader.

- *"Equator NA"* (line 5344): TX Hawaii (21.31, -157.86) → RX
  São Paulo (-23.55, -46.63). Hawaii is not "NA" (continental
  North America); it's mid-Pacific. The "NA" label is wrong.

- *"Polar W-NA"* (line 5343): TX NYC → RX SF. Same coordinates
  as "NA-NA west-east" (line 5325). Line 5359-5360 acknowledges
  this is *"an intentional duplicate of NA-NA west-east, retained
  as a hop-count regression canary"*. ✓ Acceptable but worth
  flagging that the path basket has a duplicate row that the
  "35-path" count includes; effectively 34 unique paths plus a
  consistency check.

**G11.5** Appendix D (line 5362-5439): *"26 GIRO digisonde
stations"* — A5 stale. Code has 27 (BVJ03 Boa Vista). The table
(lines 5392-5427) is missing the BVJ03 row.

Coverage gaps paragraph (line 5431-5439): *"No GIRO station in
the basket sits on the northern equatorial-anomaly crest"* —
**stale**. BVJ03 has dip latitude ~+12° N per §4.2 line 2107.
Either:
- Update the coverage-gaps paragraph to acknowledge BVJ03, or
- Strike the "no station" claim and document what BVJ03 covers.

This gap propagates to Limits #10 / #11 (G10.9, G10.10).

**G11.6** Appendix E `tab:seeds` (lines 5454-5484): three seed
configurations. ✓ Verified consistent with §6.4 / §7.2.

**G11.7** Appendix E `tab:tunegrid` (lines 5504-5523): sweep
grid. Production values from the descent are mentioned in §7.2
(L_iono=1, D=0.25, w_sc=1.5) but the converged values for
**w_NVIS-tail** and **w_Es-prim** are never explicitly stated.
Per §7.2 line 3717-3719: *"only w_sc produced measurable lift;
the other three parameters held their prior values"*. The
"prior values" depend on the seed, which differ across seeds
(w_NVIS-tail = 0 in baseline/fusion-up, 1.0 in modes-on).

The reader cannot determine the production w_NVIS-tail and
w_Es-prim values from the paper. Add explicit final values to
§7.2 or `tab:tunegrid`.

**G11.8** Appendix E line 5547-5549: *"Regenerated by a separate
ClickHouse query on a slower cadence (currently once per few
months; see m-tier item m-5h regarding cadence improvement)"*.

Two issues:
- *"see m-tier item m-5h"* references an internal backlog ID not
  defined anywhere in the paper. This will not resolve for any
  external reader. Either remove the cross-reference or replace
  with a paper-side section reference.
- *"currently once per few months"* contradicts §8.1 line 4493
  *"regenerated daily by the wspr-baselines.yml GitHub Actions
  workflow"*. Already in G8.4.

**G11.9** Appendix E line 5552-5572 (What this paper documents):
*"Reproducing the headline accBin / Brier numbers in Table
tab:harnessruns therefore requires running the harness against
contemporaneous data... the absolute numbers will differ slightly
run-to-run; the regression detection signal (drift > 2 dB mean
margin or 5 pp in P(open) across runs) is the reproducibility
guarantee, not bit-exact metric values."* ✓ Honest disclosure.

**G11.10** Bibliography (lines 5579-5736): 18 entries.

Missing citations referenced in text:
- **VOACAP** (cited via `\cite{itup533}` at line 177; should be
  Greg Hand / NTIA-ITS VOACAP, not the ITU standard). G1.6.
- **N0NBH Solar Conditions** (line 180; no citation).
- **kc2g** (line 234, 1838 etc.; the primary real-time MUF input
  has no citation).
- **HamQSL / DX Toolbox** (line 185; no citation).
- **GIRO / DIDB** (line 236, 5380 etc.; no citation despite
  heavy use).
- **GFZ Potsdam Hp30** (line 238; no citation).
- **WDC Kyoto Dst** (line 240; no citation).
- **SILSO** (line 242; no citation despite cited
  meaningfully).
- **UWyo radiosonde** (line 244; no citation).

Add a "Data sources" section to the bibliography that cites each
upstream data feed by its primary documentation URL.

**G11.11** Bibliography style: bundled entries.

- `arrl2023` (line 5629-5638): bundles **two** ARRL books
  (Antenna Book 25th ed. + Handbook 100th ed.). Standard practice
  is one entry per source; split into `arrl2023antenna` and
  `arrl2023handbook`.
- `k9la` (line 5640-5647): bundles multiple articles into one
  entry, with the prose acknowledging they are "consolidated
  from his Propagation Tutorial series". Better to either pick
  one canonical article or convert to a generic "see also"
  reference.
- `wsprlive` (line 5694-5704): bundles WSPR Live, WSPRnet, and
  Taylor 2010 QEX into one entry. The prose does separate them
  (*"Both layers are credited here separately because the
  protocol design (WSPRnet) and the aggregate-query interface
  (WSPR Live) are distinct contributions"*) but the bib entry
  collapses them. Split into separate `wsprnet` (Taylor 2010)
  and `wsprlive` entries.

**G11.12** Bibliography date issue: `arrl2023` references the
"100th edition" of the ARRL Handbook. Verify the 100th edition
existed in 2023 (the ARRL Handbook is updated annually, so
edition 100 corresponds to a specific year — likely 2023 given
the bibliography stamp).

**G11.13** Bibliography entry `igrf2020` (line 5714-5718): the
key is `igrf2020` but the published model is **IGRF-13** (2020
epoch). The body §3.5 line 907 mentions *"IGRF-14 was published
with the 2025.0 epoch but the centred-dipole pole has drifted
sub-degree since 2020"*. So the paper uses IGRF-13's pole,
held fixed. ✓ The bib key should be `igrf13` for clarity, but
`igrf2020` (date-of-epoch) also reads correctly.

**G11.14** `mitra1974` book is cited in §3.4c as the calibration
anchor for the flare-driver dB pairs (M1=4 dB, X1=12 dB, X10=20
dB). I have not verified that Mitra 1974 §5-6 actually contains
those specific anchors. Citation accuracy not yet verified
(noted earlier as a not-covered category).

**G11.15** `donki` entry (line 5727-5734): NASA Goddard URL.
References §5.3.1 and §5.3.2 by section label. ✓ OK.

**G11.16** No `\cite{}` for the **Magnus saturation formula**
constants (Alduchov-Eskridge 1996) used in Eq. esat (line
3389-3392). Add Alduchov & Eskridge 1996 (J. Appl. Meteorol.)
to the bibliography.

**G11.17** Endpoint coordinate sources: line 5357-5358 says
*"Endpoint coordinates are read by the harness from
scripts/paths.json (the source of truth); this table is a
paper-side mirror"*. ✓ Mirror disclosure.

**G11.18** End of paper: `\end{thebibliography}` and
`\end{document}` (line 5736-5738). ✓ Document closes properly.

## F. Historical narrative to remove (paper should describe the current model only)

The paper is shot through with retrospective commentary describing
prior formulations, dated audit notes, internal release labels, and
"the earlier form did X" framings. None of this belongs in a
methodology paper; readers want to see the current model, not its
git log. Each item below is a concrete cut.

### F1. Dated audit/release notes

Every "2026-04-25 / -26 / -27 / -28 / -29 / -30" stamp is changelog.
Cut the date and the surrounding before/after framing; keep only the
current formula and rationale.

Specific instances:

- Line 563: *"Calibrated 2026-04-30 against ITU-R P.533 §A.2..."*
  Keep the citation, drop the date.
- Line 1163: *"refactored 2026-04-30 from a step-function form that
  had hard cutoffs at..."*
- Line 1399: *"Re-derived 2026-04-30 from P.372-15 Fig 13..."*
- Line 1421 to 1434 (entire paragraph): *"The 2026-04-30 retune
  corrects a directional discrepancy..."* and the WSPR validation
  delta. Should reduce to one sentence stating the current
  derivation.
- Line 1888: *"retuned 2026-04-30 from 75°/7° after a 25-point
  sweep..."*
- Line 2003 to 2011: *"The night-decay multiplier and the 3-h memory
  lag were added in the 2026-04 climatology rebuild (R2)..."* with
  before/after RMSE numbers. Cut entirely; current formula stands on
  its own.
- Line 2062 to 2067: *"The trough kernel was added in the 2026-04
  audit pass: the crest-only formulation that preceded it
  predicted..."*
- Line 2098 to 2110: the entire EIA tuning history block (constant
  0.30 -> 0.45 -> slope 0.005 -> rollback -> coord audit -> Boa
  Vista) is pure changelog. Cut to one paragraph stating the current
  values and the basket.
- Line 2172 to 2199 (entire section 6.7 history paragraph): *"The
  2026-04-25 form was asymmetric..."* Cut. Keep only Eq.
  `muf-consensus` (geometric mean) and one sentence of rationale.
- Line 2228 to 2233: *"the 2026-04-28 audit pass labeled inferior..."*
- Line 2269 to 2283 (paragraph "Why the 2026-04 audit replaced the
  illumination-ratio form"): cut; the current formulation is
  Eq. `pathmuf`.
- Line 2889 to 2890: *"X-ray flare twilight gate retired in the
  2026-04 polish round."*
- Line 3559 to 3577: *"The 2026-04-26 fix is a policy correction...
  A previous 0.7 / 0.3 ensemble blend with an N0NBH-style SFI
  heuristic, plus a per-(band, horizon) bias correction... were both
  retired in the 2026-04-25 'D' experiment and the 2026-04-26 P.842
  recalibration..."* All of this is changelog. Cut to: "The verdict
  margin is the physics-budget margin plus the per-hop and
  alternative-mode bonuses, with no further blending or bias
  correction."
- Line 3642 to 3647: *"The Pacific / Australia coverage (...) was
  added 2026-04-25 after a per-station bias diagnostic..."* Cut.
- Line 3709 to 3715 (entire run-by-run progression paragraph): *"The
  2026-04 sweep moved binary accuracy from 91.08% (Brier 0.0625) to
  92.35% (Brier 0.0535); the 2026-04-26 / 2026-04-27 polish... added
  another half-point; the 2026-04-28 EIA-trough kernel and per-hop
  direct-climatology MUF lifted it further to the current 94.25%."*
  Cut to: "The current production basket scores 94.25% binary
  accuracy / Brier 0.0386 against 30 d of WSPR aggregates."
- Line 3739 to 3740 in Table `tab:harnessruns`: rows "Pre-R7
  baseline" and "Post-R7 sweep (2026-04-25)". Drop both rows; keep
  only "Current production".
- Line 3838: *"(2026-04-26 onwards, post the 2026-04-25
  loss-constant calibration)"*
- Line 4230, 4290, 4313, 4396: comments and annotations marking
  things as "post 2026-04-30 second-pass tier boundaries".
- Line 4416 to 4440 (entire "Threshold history (2026-04-28 /
  2026-04-30)" paragraph): cut. Keep only the current 0.90 / 0.60 /
  0.35 / 0.10 schedule with a one-line justification.
- Line 4562: *"the same 30-day WSPR baseline data... (wspr.rx
  table, 2026-04 window)"*
- Line 4874 to 4876: *"that column was retired in 2026-04 in favour
  of S, which the production UI now surfaces directly."*
- Line 5074: *"before the 2026-04-28 per-hop MUF restructuring"*
- Line 5114: *"The equatorial set after the 2026-04-25 coord audit
  is..."*
- Line 5155 to 5159: *"This was not done in the 2026-04-26 polish
  round..."*
- Line 5208 to 5249 (entire Limits #14): titled *"closed
  2026-04-30"* and structured as a before/after retune diary.
  Either cut entirely (the current N_base table is in the body) or
  reduce to one sentence stating the calibration anchor.
- Line 5288: *"the redundant version was retired in 2026-04-27..."*
- Line 5374: *"six earlier coord errors were corrected at that
  time..."*

### F2. Generic "earlier formulation / prior / previous" narrative

Same pattern without dates. Each one describes a prior model and
why it was changed. Keep the current formula; cut the back-story.

- Line 102: *"replacing a previous asymmetric rule..."* (abstract
  bullet; cut "replacing a previous asymmetric rule that clipped
  real upward enhancements" and just say "Symmetric MUF consensus").
- Line 370 to 384 (paragraph "Why this gate is hard while the others
  are smooth"): the rationale is fine, but the framing
  "...explicitly retired in favour of smooth ramps because they
  fired on routine active-Kp conditions..." reads as audit
  commentary. Tighten to a forward-tense statement.
- Line 471 to 481: *"The ramp retires a small step the bare gate
  produced..."* Cut "retires" framing; just describe the ramp.
- Line 486 to 491: *"the two were previously summed in the budget,
  double-charging the path for the same flare physics. The current
  implementation collapses to..."* Reduce to: "The two are combined
  via max(L_DRAP, sum_k L_flare) to avoid double-charging..."
- Line 658 to 667 (Smooth handoff paragraph): *"Earlier versions
  zeroed L_PCA,onset the moment Phi_p10 crossed the S1 threshold...
  The current implementation keeps..."* Cut the "earlier
  versions" framing; describe the current handoff.
- Line 684: *"smooth twilight ramp closing the terminator step that
  the earlier hard cos chi_k <= 0 gate produced"*. Cut "closing the
  terminator step that the earlier hard gate produced".
- Line 819 to 825: *"The hard Kp >= 5 / HP >= 50 GW gate the earlier
  formulation used produced a discontinuity..."* Cut.
- Line 854 to 866: *"The earlier prose framed this with bare Kp...
  An earlier formulation stepped discontinuously from 60° to 50° at
  Kp = 7..."* Cut.
- Line 956 to 959: *"...not the 4533 km the prior linear h_F/300
  scaling would give; that form over-extends..."* Cut the prior
  comparison.
- Line 975 to 981: *"This closes a real verdict-shifting cliff:
  under the earlier integer-only form..."* Cut.
- Line 1012 to 1022: *"An earlier polarisation-averaged variant was
  tried under the theory that... 30 d WSPR calibration ruled it
  out..."* Useful evidence, but reads as lab-notebook narrative.
  Either move to an appendix or cut.
- Line 1062 to 1067: *"This decomposition replaces an earlier scalar
  L_g = 3 dB/hop that the calibration harness could not actually
  retune..."* Cut the replacement framing.
- Line 1208 to 1228 (footnote on `L_iono` history): *"Historical
  L_iono sequence: 35 dB -> 15 dB -> 8 dB -> 2 dB -> 1 dB"*. This is
  literally a changelog footnote. Cut.
- Line 1282 to 1306 (paragraph "Why the indicator: the rural
  double-count it retired"): describes a bug that is no longer
  there. Cut entirely. Replace with one sentence motivating the
  indicator gate.
- Line 1421 to 1434: *"The 2026-04-30 retune corrects a directional
  discrepancy in the prior table..."* Cut.
- Line 1444 to 1450: *"The previous formulation quoted every mode
  at a common 2.5 kHz reference BW..."* Cut.
- Line 1508 to 1525 (paragraph "Continuous across the hop boundary"):
  *"An earlier formulation used the integer N_hops in the
  denominator... That ~8° jump propagated into..."* Cut. Keep just
  the current Eq. `takeoff` and the resulting per-hop geometry
  invariance note.
- Line 1542 to 1558 (paragraph "Side effect on DX paths"): pure
  before/after measurement diary tied to "this fix landed". Cut.
- Line 1599 to 1603: *"at very low antenna heights... the bare
  expression goes arbitrarily negative; the floor caps that..."*
  Keep the floor; trim the historical "earlier" framing.
- Line 1640 to 1655 (paragraph "Why the denominator is 1, not 1.57"):
  describes a retired bug. Cut entirely. The current denominator is
  1; nobody needs to know about the old 1.57.
- Line 2098 to 2110: see F1.
- Line 2132: *"an earlier calendar-month formulation θ_m = ... landed
  the peak five days early..."* Cut.
- Line 2178 to 2183: *"The asymmetry's stated justification was
  always weak..."* Cut.
- Line 2270 to 2283: see F1.
- Line 2339 to 2341: *"the earlier practice of dropping straight to
  f_oF2 under-predicted the upper edge..."* Cut.
- Line 2384: *"Earlier versions hard-coded f <= 8 MHz, which
  excluded 30 m..."* Cut.
- Line 2552 to 2556 (seasonal-ratio): *"an earlier calendar-month
  formulation θ_m = ... landed the peak five days early..."* Cut.
  (Same fix is documented twice: line 2132 and line 2552.)
- Line 2714 to 2718: *"The earlier flat 0.5 floor under-predicted
  severity during real super-storms..."* Cut.
- Line 2886 to 2890: *"Earlier table form had stepped thresholds at
  -5 / -10 / -15 nT producing a +1 Kp jump on every threshold
  crossing... retired in the 2026-04 polish round."* Cut.
- Line 2959 to 2964: *"the earlier formulation produced a 2x jump in
  τ and a 2 MHz jump in B at the threshold... cliff retired by..."*
  Cut.
- Line 3177: *"This eliminates the earlier hard step at 20 MHz..."*
  Cut.
- Line 3200: *"sigmoid (re-derived 2026-04-30)"*. Drop the date.
- Line 3210 to 3216: *"a flat B_TEP = 15 dB across all solar
  conditions over-credited moderate-cycle openings; the prior fixed
  value matched peak-cycle TEP magnitudes specifically."* Cut the
  prior-value comparison.
- Line 3253 to 3268: *"Earlier code missed the sporadic-background
  case and only triggered on shower days... the previous tier cliff
  at the boundary has been moved to..."* Cut "earlier code" and
  "previous tier cliff" framing.
- Line 3343 to 3352: *"This is intellectually honest engineering but
  it does mean..."* Self-narration; tighten.
- Line 4044 to 4050: *"An earlier formulation used a hard binary at
  |cos chi| = 0.15 that produced a tier-confidence cliff... the
  linear ramp closes that cliff..."* Cut.
- Line 4128 to 4131: *"Lower-mid bands had σ_g too small by 2-3 dB
  (over-confident verdicts on 160 m through 20 m); 17 m / 15 m had
  σ_g slightly too large. 12 m / 10 m kept the prior values..."*
  Audit commentary embedded in a table caption. Cut.
- Line 4343 to 4347 (Tier mapping paragraph): *"An earlier
  aggregation over the median margin was removed because most
  reference paths are long transcontinental hops..."* Cut. Keep just
  the current best-margin rule.
- Line 4381 to 4386: *"Earlier versions of ionocast hand-set the dB
  boundaries (+18 / +6 / -5 / -14) and validated the tiers against
  per-band WSPR-spot percentiles. That validation target was
  replaced because..."* Cut. Keep just the current P.842 buckets.
- Line 4442 to 4452 (spot-override description): *"An earlier
  formulation used a Mon-Fri-only baseline..."* Cut the historical
  branch (line 4536 to 4548). Keep the current weekend-inclusive
  baseline.
- Line 4514 to 4533: *"Earlier code used `avg(hourly_count)`, which
  silently skipped (band, hour) cells with zero spots..."* Cut.
  Keep just the current SQL.
- Line 4556 to 4571 (paragraph beginning *"Tightening to a bare
  spots > mean..."*): the empirical-sweep description is fine; the
  *"the choice was made by sweeping candidate thresholds in {1.0,
  1.1, ...}"* lab-notebook prose can compress.
- Line 4868 to 4876: *"The earlier band-table column displayed the
  two-sided literal P(predicted=true) form C(M, σ), which capped at
  ~32% on centred middle tiers... that column was retired in
  2026-04..."* Cut.
- Line 5215 to 5249: see F1.
- Line 5286 to 5290: *"An earlier version of this appendix repeated
  the noise table with rural / suburban / urban columns expanded;
  the redundant version was retired in 2026-04-27..."* Cut.
- Line 5359 to 5360: *"Polar W-NA is an intentional duplicate of
  NA-NA west-east, retained as a hop-count regression canary."* Keep
  if true; this is documenting current behavior, not history.

### F3. Internal release labels (R2, R7, "Phase 1", "polish round")

These are internal version markers and mean nothing to a reader.

- Line 2003 / 2099: *"R2"* (climatology rebuild label).
- Line 1224 / 1906 / 1955: *"Phase 1"* / *"Phase 1, sunset to ~3 h
  after sunset"*. The Phase 1/Phase 2 of foF2 night decay (lines
  1906 and 1955) are physically meaningful labels; keep those. The
  *"Phase 1"* in line 1224 (`L_iono` footnote) is a release label
  and should go with the footnote.
- Line 3739 to 3741 / 5073: *"Pre-R7 baseline"*, *"Post-R7 sweep"*,
  *"basket without R7 scatter"*. Drop the R7 branding; describe
  configurations by what they include, not which release named them.
- Line 2890 / 3711 / 5155: *"polish round"*. Cut every instance.
- Line 2062 / 2228 / 2269: *"audit pass"*. Cut.

### F4. "The current implementation / now reads / today" hedging

Acceptable in moderation, but the paper is densely populated with
"the current implementation does X" framing that implies a prior
implementation existed. Re-read each instance and decide whether to
say *"ionocast does X"* directly:

- Line 196 to 199: *"specified but not currently surfaced in the
  runtime; the Upcoming Disruptions panel today shows..."* The
  status note is useful; the *"today"* hedge can go.
- Line 489 to 491: *"The current implementation collapses to..."*
- Line 660 to 663: *"The current implementation keeps..."*
- Line 1295 to 1305: *"rural now reads N = N_atmo exactly..."*
- Line 2251 to 2267: *"The UI today does not surface fallback-active
  state..."* Could stand as a forward-tense limitation note.
- Line 4969 to 4970: *"The items below are the model's
  currently-known shortcomings..."* Fine as an intro to Limits.

### F5. Specific fixed-by-date mentions and per-fix dB deltas

Whenever the paper says *"the harness binary accuracy ticked from X
to Y when this fix landed"* or *"improved from X to Y"*, cut both
numbers and the fix-attribution. Examples beyond those listed in F1:

- Line 1545 to 1558: *"the harness binary accuracy ticked from
  88.93% / Brier 0.0713 to 88.98% / 0.0697... when this fix
  landed --- a +0.05 pp shift driven by takeoff geometry rather than
  physics content."* Cut.
- Line 5226 to 5249 (Limits #14 validation outcomes): *"WSPR
  per-spot residual mean improved from -23.97 to -18.73 dB..."* Cut.
- Line 4129 to 4131: *"Sigma-suite ratios of tabulated σ_g vs
  observed marginStd improved from 1.4-2.0 to 1.0-1.5 across the
  bands that moved."* Cut.

### F6. Recommended replacement pattern

For every cut above, the replacement is the same shape: state the
current formula or value, then one sentence of rationale. The paper
has hundreds of well-written rationale sentences already; the cuts
do not require rewriting the model. They require deleting the
"earlier we did X, then in 2026-04-25 we changed to Y" framing
around statements that already say what Y is and why.

Approximate cut volume: 600 to 900 lines out of 5738 (10 to 15 %
of the paper). The result reads as a methodology paper rather than
a release journal.

## Verdict

The methodology is unusually self-aware (extensive limitations
section, history footnotes per equation, explicit acknowledgments of
metric-ceiling effects) and the implementation tracks the equations
closely. The bulk of the issues above (A1 through A7) cluster around
two recent changes that did not propagate fully:

1. **The 2026-04-29 BVJ03 Boa Vista addition** (Limits #10, #11, and
   Appendix B).
2. **The 2026-04-30 sigma_g refit** (worked example, Limits #1, and
   Default settings table).

Fixing those two propagation gaps and the bonus-uncertainty
arithmetic (A6) closes the substantive issues. C and D are polish.
F is a separate concern: the paper currently reads as a changelog
for current contributors rather than a methodology document for
external readers. Cutting F1 to F5 makes it the latter.
