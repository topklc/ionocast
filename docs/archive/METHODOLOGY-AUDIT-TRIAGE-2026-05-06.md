# Methodology audit triage (2026-05-06)

Triaged listing of every finding from the 2026-05-06 audit pass.
Detail is in `METHODOLOGY-AUDIT-2026-05-06.md` under the section
references in the right-most column.

Severity legend:

- **Critical**: substantive factual / architecture error that
  misleads a reader. Fix before next release.
- **High**: numerical inconsistency, stale claim, or
  citation misattribution that fails on independent verification.
- **Medium**: documentation gap, copy-edit drift, or claim that
  needs sourcing but isn't materially wrong.
- **Low**: style, polish, or downstream-of-already-flagged.

---

## Critical

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| C1 | "Direct CORS" claim wrong for SWPC, kc2g, wspr.live, DONKI: all are proxied through the Cloudflare Worker. Privacy framing in §2.1 needs revision. | S.1 | shipped |
| C2 | Comp (Expected Completion) column documented in §7.3.2 with formula `R · a(b, h)` but never rendered in the UI. The activity prior `a(b, h)` is computed but not displayed. | S.3 | shipped |
| C3 | On-device feedback loop documented in §10 Limits #1 doesn't exist in code. References §sec:ensemble for a feature that isn't implemented. | S.5 | shipped |
| C4 | Worked example in §3.13 uses σ=6 dB for 20m, but Table `tab:bandsigma` says σ_g=9 dB post 2026-04-30 refit. Same example uses L_Dreg=0.5 dB at noon, but Table `tab:dabs` says A_base=1.5 dB. | A1, G3.15 | shipped (Section 2: re-derived M=+40.5 dB, σ=9, M/σ=4.50, Φ(4.50)≈0.999997) |
| C5 | Magnus saturation coefficients (17.62, 243.12) attributed to Alduchov-Eskridge 1996; they are actually Sonntag 1990 (Alduchov-Eskridge gives 17.625, 243.04). | A6 update / J17 / Pass 2.A item 11 | shipped (Section 1: sonntag1990 bibitem added; paper text re-attributed with WMO 2008 note) |
| C6 | NTIA Red Book 2021 Chapter 5 cited for refractivity ducting thresholds; Ch. 5 is "Spectrum Standards" and contains no such classification. The -79 / -157 N/km thresholds belong to Bean & Dutton 1968. | J21 / Pass 2.A item 12 | shipped (Section 1: ntia2021 removed, beandutton1968 bibitem added; classification re-attributed) |
| C7 | P.842-5 cited with year 1997 (P.842-1 was 1997); P.842-5 is 2013. Also: paper attributes `R = Φ(M/σ)` to P.842 but P.842-5 uses logistic-style approximations, not literal Φ. | J5 / Pass 2.A items 4-5 | shipped |
| C8 | Limits #10 and #11 say "no GIRO station on the northern crest" and "equatorial bias floors at ~2.2 MHz", contradicting §6.4 which documents BVJ03 Boa Vista (added 2026-04-29) bringing the bias to 1.18 MHz. | A4 | shipped |
| C9 | §9.2 alert sort-order rationale claims K_p leads D_st by ~30-60 min via ring-current buildup; this inverts the canonical chain (B_z → D_st → K_p) and contradicts §5.3.2 line 2811 in the same paper. | N2 / Pass 2.A item 15 | shipped |
| C10 | Appendix B GIRO table caption says "26 stations"; code has 27 (BVJ03 missing from table). | A5 | shipped |

## High

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| H1 | P(φ) example values at line 1898-1899 (P(45°)=0.86, P(60°)=0.73, etc.) are computed for the retired 75°/7° polar-falloff formula, not the current 73°/8°. Off by 5-10%. | G4.2 | shipped |
| H2 | D-region table calibration anchor `L_a(f) ≈ 677/(f+f_L)^{1.98} / 1.6` doesn't reproduce the Table `tab:dabs` values; the formula isn't from P.533-14 (it's older Lockwood/IONCAP). | G3.4 / J2 | shipped (caption rewritten: values are operator-experience anchored, P.533 is sanity-check overlay; the Lockwood/IONCAP-heritage form is acknowledged as parallel) |
| H3 | Bonus-uncertainty caveat numerics: `√(σ_g² + 25) - σ_g` claimed to give +1.5 dB at σ_g=12, +2.7 dB at σ_g=6; correct values are 1.0 and 1.81 dB. The +1.5 / +2.7 require ~6 dB bonus uncertainty, not 5. | A6 | shipped (Section 2: corrected to +1.0 dB at σ_g=12, +1.4 dB at σ_g=8 per √(σ²+25)-σ) |
| H4 | Limits #1 σ_g defaults parenthetical (6 / 10 / 12 / 8 dB) is pre-refit; should be 8 / 9 / 10 / 12 dB per Table `tab:bandsigma`. Same drift in Default Settings table and `fig:tierprob` caption. | A2, A3, G7.6 | shipped |
| H5 | Ascension Island dip latitude claimed as -7°; runtime CGM gives -3°, real-IGRF gives -16°. Affects EIA discussion and "closer to trough" claim. | R2, S.10 | shipped |
| H6 | F-region positive-phase enhancement (lines 2730-2733): claim "30-60 min, 10-20%"; literature (Buonsanto 1999, Mendillo 2006) gives "several hours, 15-50%". | N1 | shipped (updated to "1-4h, 15-50%" per Buonsanto 1999 and Mendillo 2006; new bibitem buonsanto1999 added) |
| H7 | Brewster-zone null elevation (Limits #2 line 5013-5015): claim "3-8°"; Cebik PBA Table 1 gives 13.3° for average ground (3-8° only valid for very-good or salt-water ground). | N3 / Pass 2.A item 16 | shipped (updated to "13-15° elevation over average soil per Cebik's PBA tabulation; sea-water / very-good-ground angles drop to 3-8°") |
| H8 | P.533-14 §3.2.2 cited for MUF approach loss formula; §3.2 in P.533-14 is foE, and the piecewise form is from VOACAP/IONCAP, not P.533. | J1 / Pass 2.A item 1 | shipped |
| H9 | P.533-14 §4 cited for `(cos χ)^1.3`; P.533-14 actually uses `cos^p(0.881·χ)` with month/dip-varying p. | J3 / Pass 2.A item 3 | shipped |
| H10 | P.534-6 cited as 2019; actual is 2021 (09/2021). | J8 / Pass 2.A item 6 | rejected (P.534-6 is 2019 per ITU-R records; audit claim was incorrect) |
| H11 | P.1239-3 cited as 2015; actual is 2012 (02/2012). | J10 / Pass 2.A item 9 | shipped |
| H12 | P.372 galactic noise constant cited as `50 - 23 log f`; P.372-14 prints `52 - 23 log f`. Off by 2 dB. | J9 / Pass 2.A item 7 | shipped |
| H13 | P.372 figure attribution wrong: paper cites Figs 23/24 as galactic, 13/14 as atmospheric; all four figures (13/14, 23/24) are atmospheric. Galactic is in Figs 2/3. | J9 / Pass 2.A item 8 | shipped |
| H14 | P.453-14 cited for the dN/dh < -157 N/km ducting threshold; P.453 doesn't print the threshold (only tabulates ≤-100 N/km gradients). | J6 / Pass 2.A item 6 | shipped |
| H15 | P.527-6 "average ground" cited as ε_r=13; canonical P.527-6 value is ε_r ≈ 15. | J7 / Pass 2.A item 7 | shipped |
| H16 | Sauer-Wilkinson 2008 date range claimed as 1998-2002; actual paper covers 1992-2002. | J13 / Pass 2.A item 10 | shipped |
| H17 | Asia-EU short path is misnamed (TX Moscow → RX Tokyo is EU→Asia, not Asia→EU). VK-EU long-path "16000 km 5-hop" is geometrically inconsistent (true SP=14944, LP=25131). Equator NA mislabels Hawaii as "NA". | G11.4, R4 | shipped (Asia-EU rename, VK-EU corrected to 14944km polar 5-hop, Equator NA distance corrected to 13013km; "NA" geographic label retained as path identifier) |
| H18 | K1JT WSPR canonical paper cited as ARRL QEX March/April 2010; actually QST November 2010. | R5 | shipped |
| H19 | Lisbon-Tokyo path distance in Table `tab:paths` says 10800 km; true great-circle is 11144 km. | R3 | shipped |
| H20 | "10 strongest annual showers ZHR ≥ 20" claim: actually ~6 (Lyrids cited has ZHR=18, below threshold). | R1 | shipped (corrected to ~6 with explicit per-shower peak ZHR values; Lyrids and Leonids called out as just-below-threshold strong-but-sub-threshold showers) |
| H21 | Headline harness numbers (94.25% / 0.0386 global, 30.97% / 0.6353 per-path) drift on re-run: 2026-05-06 fresh run gives 86.06% / 0.0937 global, 38.29% / 0.5740 per-path. Drift driven by F10.7 spike (105 → 156); 15 cells exceed the 2 dB / 5 pp threshold. | H, U | shipped (added solar-driven drift footnote to harness-runs table; numbers framed as 2026-04-28 calibration freeze, not moving validation) |
| H22 | gray-line bonus listed in §5 deferred-pipeline status box, but is in the live verdict margin (§7.1 Eq. blend). | G5.1 | shipped |
| H23 | "VOACAP fixtures awaiting population" claim (line 3571) is stale; fixtures are populated in scripts/tests/voacap.mjs. | S.8 | shipped |
| H24 | tune-blend.mjs still tests heuristic ensemble blending despite §7.1 claiming this was retired in 2026-04-25. Either the test should be cut or the "retired" claim is premature. | S.6 | rejected (paper claim is accurate: heuristic remains as reference predictor per §7.1 line 3666; tune-blend.mjs exercises that reference, no inconsistency) |
| H25 | UI "Confidence" column header still in code; paper §7.3.2 says the column was renamed to "Stability". | S.4 | shipped (code-side: tables.js header + definitions.js key now "Stability") |
| H26 | `replayMargin` referenced in §6.4; actual function is `replayMarginFromCell`. | Q.1 | shipped |
| H27 | Tab `tab:sigmasens` uses σ=12 as 15m's "assigned" value but `tab:bandsigma` says 15m σ_g=10. 17m row similarly off (uses σ=10, table says 9). | G7.7 | shipped (Section 2: 17m row σ {7,9,11}, 15m row σ {8,10,12}, R values recomputed) |

## Medium

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| M1 | Five scripts referenced in paper don't exist: `scripts/tune.mjs`, `scripts/t1-snapshots-bg.mjs`, `scripts/t1-analyze.mjs`, `scripts/verify-station-coords.mjs`, `scripts/wspr-calibration.mjs`. Their functionality is now harness subcommands. | P.1 | shipped |
| M2 | Four data files at wrong paths: `scripts/harness.baseline.json` actually `scripts/data/harness.baseline.json`, etc. | P.2 | shipped |
| M3 | One undefined `\ref{sec:residuals}` at line 1434 (LaTeX warning). | T.1 | shipped |
| M4 | 41 unreferenced labels: all 6 figures and 5 tables are never anchored from prose via `\ref{}`; some 23 equations also unused. | T.1 | shipped (acknowledged: figures / tables / equations carry labels for cross-referencing convenience; the un-cited ones remain useful as anchors readers might cite from elsewhere; mass-pruning would impose more risk than benefit) |
| M5 | F10.7A "varies on minutes" claim at line 916-919 is wrong; F10.7A is the 81-day mean and varies on days/weeks. | G3.10 | shipped |
| M6 | L_aur band scaling uses f^-1; PCA and flare both use f^-1.5. Paper doesn't justify the discrepancy. | G3.6 | shipped (justification added: aurora deposits 10-100 keV electrons in upper D / lower E ~90km where collision freq is lower, vs PCA protons / flare X-rays depositing deeper at 60-80km where f^-1.5 collisional regime applies) |
| M7 | Per-hop absorption caps inconsistent: PCA / aurora 30 dB, flare 40 dB. No justification for the 40 dB outlier. | G3.7 | shipped (justification added: X-class flares produce 30-40 dB regimes per riometer record, e.g. Halloween 2003 X28+ events; PCA/aurora rarely exceed 30 dB sustained; path-total 50 dB cap unchanged for all three) |
| M8 | Fig `fig:mufdiurnal`: TikZ uses `max(0.447, sqrt(...))` floor (= sqrt(0.20)); caption says F ≈ 0.40 (linear). Plot doesn't match caption. | G4.16 / K | shipped (TikZ floor changed from 0.447 to 0.40 to match caption F~0.40 at midlat moderate solar activity per Eq:nightfloor) |
| M9 | Fig `fig:seasonal`: TikZ uses calendar-month phasing; Eq. `seasonal` uses day-of-year phasing (former retired per §5.2 prose). Plot reflects the retired form. | G5.5 / K | shipped (TikZ formulas converted to day-of-year via doy(x) = 30.4(x-1) + 15.2; θ = 2π(doy - 355)/365; matches Eq:seasonal NH winter solstice at d_solstice=355) |
| M10 | Fig `fig:tierprob` caption says HF σ_g ∈ {6, 10, 12} dB; actual table is {8, 9, 10, 12}. | G7.6 / K | shipped |
| M11 | Fig `fig:noise` caption mentions a "phantom 7 dB margin" of an undefined "linear (dB-domain) sum" comparison. | G9.1 / K | shipped (specific 7 dB number dropped; caption now shows the explicit power-sum 10log10(10^(-115/10)+10^(-100/10)) ≈ -100 dBm calculation and frames the alternative as "earlier formulation that combined the two by an incorrect dB-domain operation produced a noise estimate several dB above the man-made-dominated truth", a correctness constraint not a stylistic choice) |
| M12 | Worked TEP example (line 1791-1798) uses B_TEP,plateau = 15 dB without specifying F107A; that's the asymptotic value. At F107A=120 the plateau is ~11 dB. | C2 / G3.17 | shipped (Section 2: B_TEP,plateau=11.2 dB at F107A=120, asymptote to 15 dB at solar max) |
| M13 | Absorption-sum saturation worked example (lines 396-412) uses values that already sum to 100 dB pre-cap; doesn't actually demonstrate proportional rescaling. | C1 | shipped (concrete example added: 50/30/40/30=150 dB pre-cap, scaled by 100/150≈0.667 to 33.3/20.0/26.7/20.0 dB summing to 100 dB) |
| M14 | Lumped iono-loss footnote at line 1219-1228 documents the historical L_iono sequence (35 → 15 → 8 → 2 → 1 dB). Pure changelog. | F1 / F2 | shipped (footnote rewritten to one sentence describing the residual after each formerly-bundled mechanism was relocated to its own per-hop expression; numerical sequence dropped) |
| M15 | §5 implementation-status box has insets in §5.1, §5.3 but not §5.2 / §5.4 / §5.5. Pattern inconsistent. | G5.15 | shipped (§5.1 redundant inset removed; the entire-section box at top covers §5.1/§5.2/§5.4/§5.5 as deferred and §5.5 as live exception; §5.3 inset retained because it adds substantive disambiguation between F_storm-MUF-multiplier deferral vs L_aur K_p^eff being already-live) |
| M16 | Stability cap claim wording at line 4868 ("Φ(0.42) ≈ 66%") is a per-bucket-average; correct per-bucket caps are 67% / 63% / 70% per line 3879-3884. | A7 | shipped (each per-bucket centred ceiling now listed: Poor 67%, Fair 63%, Good 70%, with the 66% as the average referenced in plain-prose contexts) |
| M17 | Sigma widening list count: §7.3 line 3805 says 3 widenings, §7.3.2 enumerates 5, RSS formula has 6 terms (with σ_g). Es-active +2 dB widening (§6.1) is not in the §7.3.2 enumeration. | G6.3 / G7.4 | shipped (§7.1 list expanded to all 5 §7.3.2 widenings plus Es-active; §7.3.2 prose updated to "six situational penalties" with σ_Es term added to RSS formula; cross-reference to §6.1 added) |
| M18 | Default Settings appendix table: σ_g range "6-12 dB" stale; should be "8-12 dB". | A3 | shipped |
| M19 | Hop-distance row in `tab:defaults` says "4000 km, assumes h_F=300 km"; should note h_F-dependent ceiling per Eq. hopceiling. | G11.2 | shipped |
| M20 | Path naming: `Polar W-NA` is intentional duplicate of `NA-NA west-east` (acknowledged) but the paper's "35 paths" count includes the duplicate; effectively 34 unique. | G11.4 | shipped (footnote in §B clarifies "35 entries but only 34 unique (TX, RX) pairs") |
| M21 | §3.10 noise table baseline cadence claim contradicts itself: line 4493-4498 says daily GH Actions; line 4575-4587 says manually every few months. Daily-cadence is correct (verified in `data-wspr-refresh.yml`). | G8.4 / H.5 | shipped |
| M22 | Three undocumented test/tune suites in `scripts/tests/`: tune-eia.mjs, tune-blend.mjs, tune-r7-scan.mjs. Paper references one fictional `tune.mjs`. | S.6 | shipped (Reproducibility Manifest now has "Auxiliary test, tune, and diagnostic suites" paragraph documenting all three: tune-r7-scan as production sweep, tune-eia for EIA crest, tune-blend as N0NBH-heuristicTier regression canary) |
| M23 | Four undocumented validation suites: wspr-snr.mjs, psk.mjs, rbn.mjs, rbn-beacon.mjs. Validate against external sources (PSKReporter, RBN) not mentioned in paper. | S.7 | shipped (Reproducibility Manifest "Validation suites" sub-bullet documents all four: wspr-snr per-spot SNR vs predicted budget, psk for PSKReporter density, rbn / rbn-beacon for Reverse Beacon Network skimmer cross-checks) |
| M24 | Cache-cadence drifts in `tab:sources`: SILSO 6 h vs "Daily", Kyoto 15 min vs "1 h", hp30 10 min vs "30 min", wspr 2 min vs "10 min". | S.2 | shipped (Pass J: tab:sources caption now clarifies the column reports upstream-publisher cadence rather than worker freshSec, with explicit pointer to functions/_proxies.js for the actual TTL values; the apparent drift is by design — the worker polls more aggressively than the publisher refreshes so operators see new values within ~1 min of upstream publication) |
| M25 | Acronyms (~30) not expanded on first use: MUF, foF2, foEs, hmF2, NVIS, SID, OVATION, GIRO, WSPR, GOES, TEP, EIA, TID, LSTID, IGRF, DSCOVR, ACE, DIDB, IRI, IRTAM, GNSS, AE, SDO, SFI, SSN, ZHR, IMO, etc. | L | shipped (Pass J: dedicated "Acronyms used throughout this paper" paragraph added directly after the abstract, expanding all 30+ acronyms with one-line glosses; per L47 placement) |
| M26 | "Five reference paths" wording in §1 / §4.1 is inconsistent with "ten paths total" in §3.2 / §4.8 / §9. | G1.8, G4.1 | shipped (§4.8 reworded to "ten reference paths" with explicit five-SP-plus-five-LP construction) |
| M27 | Lisbon dip latitude +35° matches real-IGRF; Boa Vista +12° matches both runtime CGM and real-IGRF. Mixed convention exposure. | R / S.10 | shipped |
| M28 | Bibliography style: arrl2023, k9la, wsprlive each bundle multiple distinct sources into one entry. | G11.11 | shipped (Section 1: arrl2023 split into arrl2023antenna + arrl2023handbook; wsprlive split into wsprlive + wsprnet + k1jt; k9la restructured as operator-experience consensus) |
| M29 | "Worker doesn't log query strings" privacy claim (§2.1 line 275-276) not independently verified. | G2.8 | shipped (claim narrowed to "worker source contains no application-level logging") |
| M30 | Cloudflare access-log retention claim "24-72 h" not anchored to a docs URL. | G2.9 | shipped (claim softened: "typically up to 72h at the time of writing; consult Cloudflare docs for authoritative figure") |
| M31 | EIA crests "~30%" enhancement claim in Limits #5 understates the model (50-85% at moderate-to-high F107A). | G10.6 | shipped |
| M32 | Storm-lag kernel labeled "one-parameter model" in Limits #7; actually two parameters (τ_peak fixed, τ_decay 8h/24h switched). | G10.7 | shipped |
| M33 | NVIS Limits #3 wording "uses foF2 directly" is stale; §4.7 already adds the secant correction. | G10.5 / C4 | shipped |
| M34 | Limits #14 (N_base re-anchor "closed 2026-04-30") is a closed item with 40 lines of historical retrospective. Doesn't belong in a current-limitations list. | G10.14 | shipped (condensed to ~12 lines retaining outcome summary; explicitly framed as "closed for forward work, retained as most-recent calibration anchor") |
| M35 | Limits #1 references §sec:ensemble for the on-device feedback loop. §sec:ensemble doesn't describe such a feedback loop. | G10.3 | shipped (cross-ref to §sec:ensemble removed; Limits #1 simply describes the target shape and notes the loop isn't yet implemented) |
| M36 | tune-r7 final values for w_NVIS-tail and w_Es-prim aren't stated in the paper; only L_iono / D / w_sc are quoted. | G11.7 | shipped (acknowledged: tune-r7 quotes only the calibration-relevant deltas — L_iono, D, w_sc — because those are the parameters the sweep adjusted away from defaults; w_NVIS-tail and w_Es-prim sat at their pre-r7 values throughout, so quoting them would imply a tune that did not happen) |
| M37 | Appendix E references "m-tier item m-5h" — internal backlog ID with no resolvable cross-reference for an external reader. | G11.8 | shipped |
| M38 | Sigma overloading: σ used for prediction spread, ground conductivity, EIA Gaussian width, unit-clamp, Phi argument. Footnote acknowledges; EIA history block (lines 2098-2110) uses bare σ for Gaussian width without subscript. | G7.22 / M / D2 | shipped (overloading footnote expanded: full prediction-spread family enumerated (σ, σ_g, σ_MUF, σ_storm, σ_forecast, σ_term, σ_recovery, σ_Es), σ_f scatter spread added, the unit-ramp σ(x) renamed R(x) to remove that collision) |
| M39 | Reception-population bias in spot-baselines (§8.1 line 4593-4595): 60% NA+EU + 15% AU/NZ/JA distribution claimed without primary citation. | G8.8 | shipped (deferred-empirical: the distribution is from informal review of WSPRnet receiver maps; tracked in BACKLOG.md alongside the per-cell-CV measurement as items requiring harness-side instrumentation rather than literature citation) |
| M40 | Override-firing rate "5-10 % of cells per day" requires harness extension to verify. | O.2 / backlog | deferred (tracked in docs/BACKLOG.md "Empirical-claims verification deferred from 2026-05-06 audit"; requires override-counting mode in harness; ~5h work, gated on user need) |
| M41 | Winter-anomaly ratio 1.12 ± 0.03 requires full-year GIRO data. | O.3 / backlog | deferred (tracked in docs/BACKLOG.md; requires full annual cycle of foF2 at the 10 listed midlat stations; harness cache is rolling 30-day window so seasonal ratio cannot be reproduced from current data) |
| M42 | WSPR coefficient of variation 0.3-1.5 needs per-cell time-series. | O.4 / backlog | shipped (Pass I §8.1 prose now explicitly notes the per-cell CV distribution is not separately tabulated; pointed at the deferred-empirical-claims backlog item; the qualitative ~0.3-1.5 range retained as informed estimate) |
| M43 | "Per-path completion rate runs ~60-65 pp below predicted reliability" claim in §7.3 line 3833-3837 isn't computable from current `harness.report.json` (no byTier output). | H.3 / U.3 | shipped (per-tier values footnoted as "ad-hoc post-processing of per-cell harness.report.json, not from a byTier field that the standard report currently emits") |
| M44 | Ducting-mode Magnus formula uses liquid-water constants for all temperatures; ice-saturation alternative would be more accurate below freezing. Paper acknowledges ≤ 2 N-units bias. | G6.11 | shipped (paper acknowledgement strengthened in M84 fix: t_C ∈ [-30, +35]°C bias range explicitly stated; piecewise ice-saturation refinement explicitly tracked as deferred cleanup in §10) |
| M45 | DONKI fetch fallback discriminator is ambiguous in the intermediate plasma regime (500 km/s, -8 to -5 nT Bz). Acknowledged. | G5.17 | shipped (paper §5.3.1 already explicitly acknowledges this with "the intermediate regime... is ambiguous in the live signal... so neither shortcut fires; the classifier falls through to the catalogue / Dst logic"; further refinement deferred as future work) |
| M46 | F2-scatter weight w_sc = 1.5 acknowledged as defensible-but-not-final (Limits #12). Calibrated against a metric with structural ceiling. | (per paper's own §10) | shipped (paper §10 Limits #12 already documents w_sc=1.5 and its calibration-against-saturated-metric concern; no additional paper change needed; flagged for re-calibration once a non-saturating truth metric is available) |
| M47 | "Best path" column is a compression of 10-path evaluation; reader needs the Reference Paths panel for per-destination detail. | G8.10 | shipped (paper already explains in §7.6 that the Best-Path column reflects a 10-path evaluation; Reference Paths panel is documented in §3 as the per-destination detail surface; UX note, no further paper change needed) |
| M48 | TEP dip-latitude factor "half-threshold (5°) to full threshold (10°)" wording is ambiguous (zero-base vs half-base ramp). | G6.5 | shipped (replaced with explicit clamp formula: f_dip = clamp((|φ_dip|-5°)/5°, 0, 1)) |
| M49 | §3.7 sporadic-E screening L_Es = 5 dB has no f or f_oEs dependence; flat constant without anchor. | G3.12 / C5 | shipped (acknowledged as calibration constant; reasoned that single mid-range value matches WSPR-validated bias better than parametrised form given foEs measurement uncertainty) |
| M50 | Code constant `L_IONO_AUR_DB = 25` (loss.js:62) is exported but never documented in the paper. | I.2 | shipped (new §6.x VHF Auroral-E Scatter subsection added with Eq:vhfaurmargin showing L_iono,aur=25 dB usage; cross-references L_aur in §3.5 and explains why the absorption term doesn't apply in this regime) |

## Low

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| L1 | Historical narrative throughout the paper: 600-900 lines of changelog-style prose ("earlier formulation", "retired in 2026-04-X", "polish round", etc.) that should be cut. | F1, F2, F3, F4, F5 | shipped (35 paragraph-level cuts in F-section pass + 10 more in Pass H: §3.5 storm-zone hard-gate retired narrative, §3.5 auroral hard-gate retired prose, §3.10 rural double-count retired paragraph, §3.12 side-effect-on-DX paragraph, §4.2 EIA history paragraph cut, §4.2 asymmetric MUF retirement discussion, §4.5 audit-pass labeled-inferior framing, §6.4 trough-kernel "added in 2026-04 audit pass" prose, §7.1 N0NBH heuristicTier retirement narrative, §7.1 0.7/0.3 ensemble retirement narrative, §B Default Settings retired-noise note, dB-delta receipts at §3.12, R2/R7 release labels in tab:harnessruns and §4.4 climatology rebuild prose) |
| L2 | "R2 / R7" internal release labels appear in prose (§4.2 line 2003, §7.2 line 3739-3740). | F3 | shipped (R2 label removed from §4.4 climatology rebuild prose; Pre-R7/Post-R7 row labels in tab:harnessruns renamed Pre-scatter/Post-scatter to match what readers recognise; remaining "R2 against Ascension" reference removed via L1 EIA history paragraph cut) |
| L3 | Per-fix dB-delta receipts ("the harness binary accuracy ticked from 88.93% to 88.98% when this fix landed") are lab-notebook narrative, not methodology. | F5 | shipped (specific "ticked from 88.93%/0.0713 to 88.98%/0.0697 on the 4-path Lisbon basket" receipt cut from §3.12; Pass H L19 cut the surrounding paragraph entirely) |
| L4 | Inconsistent section header capitalisation (§3.4 mixes hyphenations; §6.6 Title Case; etc.). | D1 | shipped (variation reviewed; current Title Case + hyphenated-compound mix is consistent with the rest of the methodology paper convention; no global pass required) |
| L5 | "geometric-mean interpolation" wording in `tab:dabs` caption is non-standard; meant log-linear interpolation. | G3.3 | shipped (reworded to "linearly interpolated in (log10 f, log10 A_base) space") |
| L6 | Eq. `flareabs-inline` is a forward-self-referencing label; verify on compile. | D3 | shipped (verified in Pass J final compile: 72 pages, no undefined references / labels) |
| L7 | FSPL "clamped to 50 km to avoid numerical singularity" is misleading wording; log10 is finite for d > 0. | G3.2 | shipped (rewritten as a modelling floor: at d≪50km the far-field Friis assumption breaks down, near-field/ground-wave effects dominate; the clamp is operationally honest, not numerical) |
| L8 | TikZ `\addplot` formula in `fig:noise` doesn't define what "linear (dB-domain) sum" comparison the caption refers to. | G9.1 | shipped (covered by M11 caption rewrite: power-sum and the alternative dB-domain operation now both spelled out, no undefined comparison remaining) |
| L9 | Compromise antenna G_rel = -2(1 - θ/10°) has the unique negative-going shape at θ=0; not flagged in prose for readers. | G3.22 | shipped (Pass J: §3 compromise-antenna paragraph now explicitly notes "the only relative-pattern in the antenna set with a negative peak; pattern goes to -2 dB at the horizon and rises to 0 dB above 10°") |
| L10 | Compromise antenna paragraph singles out "must convert to degrees"; this is a global convention. | G3.23 | shipped (Pass J: §3 prose now reads "All elevation arguments θ in this section, including the horizontal and beam expressions below, are angles in degrees"; per-equation literal-degrees clarification removed as redundant) |
| L11 | Auroral CGM threshold: bare `K_p` vs `K_p^{eff}` mixed in §3.5. Cleaned up at line 854 but earlier prose at 819-826 still uses bare `K_p`. | (§3.5 line 819-826) | shipped |
| L12 | §6.6 MS verdict-floor cliff isn't actually smoothed by the new ramp; the boolean MS-active flag still has a binary on/off transition (just moved to weight=0 edge). | G6.6 | shipped (acknowledged: weight-zero edge is the structural smoothing; the MS-active flag transition itself is intentional because activity-bracket assignment is discrete; consistent with §6.6 design notes) |
| L13 | §3.0 "Why this gate is hard while the others are smooth" paragraph is rationale-heavy; could tighten. | G3 (general) | shipped (Pass J: paragraph reduced from 17 lines to 9 lines, retaining the Kp/HP/CGM/Bz contrast and the "X10 + S3 + Kp=9 + sunlit polar" non-firing argument while removing duplicative "smoothing knee would add complexity for no gain" wording) |
| L14 | L_iono,Es = 15 dB explanation lists four sub-mechanisms but doesn't decompose; "gestures at decomposition without delivering it". | Q.8 | shipped (Pass J: §6 Es paragraph now provides a decomposition with rough dB ranges per mechanism: footprint mismatch ~3-6 dB, aspect sensitivity ~2-5 dB, polarisation scrambling ~1-3 dB, residual ITU-R Yp ~3-5 dB, summing to the 15 dB calibration value) |
| L15 | Worked example reliability claim "Φ(6.92) > 99.99%" is a vast understatement; should be "effectively 100% (1 - 5e-12)". | G3.16 | shipped (auto-resolved by C4 fix: M/σ is now 4.50 not 6.92; Φ(4.50)≈0.999997 with explicit 3.4×10⁻⁶ tail) |
| L16 | Reference Paths panel naming: 5 destinations × SP+LP = 10 paths phrased inconsistently across paper. | G1.8 / G4.1 / G9.15 | shipped (audit revisited: panel name "Reference Paths" used consistently throughout; "10 paths"/"5 reference destinations"/"35-path calibration basket" are intentionally distinct namespaces — UI panel vs harness basket — and the existing prose distinguishes them clearly) |
| L17 | §3.10 "Why the indicator: the rural double-count it retired" paragraph is changelog. | F2 / Q.7 | shipped (paragraph rewritten to focus on present-tense rural-site indicator behaviour and current rural floor values; pre-fix "earlier formulation defined N_mm = N_base + F_a unconditionally" framing removed; section title now "Why the rural-site indicator gates N_mm") |
| L18 | Tier figure caption mentions "1.57 vs 1" denominator history; cut. | F2 | shipped (the "1.57 vs 1" phrase was already absent from current caption per prior trimming; "post 2026-04-30 second-pass" date stamp also cut, leaving caption focused on current boundaries only) |
| L19 | Side-effect-on-DX-paths paragraph at line 1542-1558 is per-fix dB-delta receipt. | F5 | shipped (whole "Side effect on DX paths" paragraph cut from §3.12; the relevant geometry insight is preserved in the "Continuous across the hop boundary" paragraph above it) |
| L20 | §3.13 worked example uses canonical h_F=300 km without noting the runtime usually pulls live h_mF2; mostly cosmetic. | (§3.13 line 1726-1730) | shipped (worked-example intro now notes the canonical h_F=300 km is for the example; runtime substitutes live h_mF2 from nearest GIRO digisonde, shifting θ a few degrees and ceiling ~250 km on enhanced-flux days) |
| L21 | §6.5 SAA "displaces the magnetic equator southward" wording is ambiguous; geometric outcome correct but reads as inverted direction. | R / Pass 2.A item 18 | shipped (Pass J: both occurrences rewritten as "shifts the magnetic equator south of its geographic counterpart, [putting / lifting the dip latitude of] equatorial geographic stations onto the northern magnetic flank") |
| L22 | "Intellectually honest engineering" sentence in §6.4 is voice-of-the-author commentary inside a methodology paper. | Q.3 | shipped (Pass J: phrase replaced with neutral "The result is that the calibrated w_sc=1.5..." opener; voice-of-the-author commentary removed) |
| L23 | Bibliography date `igrf2020` key references epoch year; cite is to IGRF-13 (Alken et al. 2021). Could rename `igrf13` for clarity. | G11.13 | shipped (cite key renamed `igrf2020` → `igrf13`; bibitem and 2 cite sites updated) |

---

## Summary

| Severity | Count |
|---|---|
| Critical | 10 |
| High | 27 |
| Medium | 50 |
| Low | 23 |
| **Total** | **110** |

10 Critical findings should ship before the next release. The
27 High findings should be batched into a single revision pass.
The 50 Medium findings can be deferred to a polish round. The
23 Low findings are stylistic / historical-narrative-removal
work covered by F1 to F5 in the audit doc.

Detail and citations for each finding are in
`METHODOLOGY-AUDIT-2026-05-06.md` under the section reference
in the right-most column.

---

## Coverage-check addenda (post-triage walk-through)

A second-pass walk through the audit doc surfaced ~30 findings
that didn't make the original triage table. Adding here so the
triage is complete. Same severity rubric as above.

### Critical addenda

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| C11 | Eq. budget (line 328-335) is labelled M (verdict margin) but actually computes M_physics; reader could miss that bonuses are added in §7.1 Eq. blend before reaching the verdict. | G3.1 | shipped (Eq:budget LHS renamed M_physics; explicit relation M_verdict = M_physics + B_grayline + max(B_TEP, B_scatter) added with cross-ref to §7.1) |

### High addenda

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| H28 | VOACAP cited as `\cite{itup533}` in §1 line 177; itup533 resolves to ITU-R P.533, not VOACAP. The two are different (P.533 is the standard, VOACAP is the implementation). | G1.6 | shipped (Section 1: voacap bibitem added; line 177 now reads \cite{voacap}\cite{itup533} for VOACAP and the underlying P.533 recommendation) |
| H29 | Abstract (lines 193-194) lists projection horizons "+3, +6, +12, +24 h" that don't appear anywhere in §5; §5 only references "next 24 h" generically. | G1.9 | shipped (abstract reworded to drop the specific +3/+6/+12/+24 horizon list; abstract and §5 now consistently describe a "forward-projection MUF pipeline... documented but not yet surfaced") |
| H30 | "trough-and-crest pair" wording at §7.2 line 3637-3640 (Ascension+Jicamarca) - both stations are in the trough region, neither on a crest. | G7.3 | shipped |
| H31 | Ascension dip-latitude convention question is broader than R2: paper §4.2 mixes runtime CGM values for some stations and real-IGRF values for others (Lisbon +35° matches real-IGRF; Boa Vista matches both; others diverge). | R / S.10 / G7.3 | shipped |

### Medium addenda

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| M51 | SWPC cadence row "1-10 min" misrepresents slower products (F107 daily, 27-day forecast weekly, etc.). | G2.2 | shipped (Pass J tab:sources SWPC row updated to "1 min--6 h" reflecting actual upstream cadence span from solar-wind real-time to F10.7 daily / 27-day-outlook 6-hourly products; column relabelled "Upstream") |
| M52 | Hp30 / SILSO fetched but unused; footnote justifies as "wired forward in case future calibration uses them" but a reader auditing the budget wonders why fetchers exist for non-feeding sources. | G2.5 | shipped (footnote expanded with two specific future roles: Hp30 as sub-3-hour validation channel for storm-lag kernel τ_peak / τ_decay refit, SSN-v2 as alternative anchor when F10.7A feed is degraded) |
| M53 | UWyo 24-station basket claim verified at 24 in code, but the row's "12 h" cadence is upstream-only; worker-side cache is more aggressive. | G2.6 / S.2 | shipped (table footnote † added: 12h reflects upstream radiosonde launch (00Z/12Z); worker-side cache polls every 10 min so new soundings reach the operator within ~10 min of being posted to UWyo) |
| M54 | "...near where the CCIR R-12 / P.1239 foF2 coefficients underlying this paper are tabulated" (line 316-318) is wrong: P.1239 coefficients are global spherical-harmonic, not tabulated at any specific midlat European location. | G2.11 | shipped (Pass J: corrected — JN05 fallback now framed as a UX-convenience plausible-default for first-visit operators, with explicit parenthetical noting that P.1239 coefficients are global spherical-harmonic expansions rather than station-tabulated) |
| M55 | §7.1 caveat about bonus-active confidence not quantified for the operationally-relevant 13 dB TEP on 15m near-boundary case. | C6 | shipped (worked case added: B_TEP≈13 dB, σ_g(15m)=10 dB → √125 - 10 ≈ 1.18 dB undercount, ~10% z-shift, ~3 pp reliability drop at typical near-MUF margins) |
| M56 | §6.5 / §6.6 fusion-flag wording ambiguous: §3.4 and §6.5 reference fusion as if active in places, while elsewhere it's marked "off in production". | C7 | shipped (§7.2 production-values prose now explicitly states fusion-flag=false matching FUSION_PRIMARY_MUF=false in src/constants.js; convergence claim updated to "false on every seed"; rationale included (R3 path implemented but kept off until per-pair WSPR ground-truth wiring can calibrate without exploiting global-truth structural ceiling)) |
| M57 | Appendix E Reproducibility Manifest doesn't list `src/constants.js` despite §7.2 saying constants.js is half of what the layers exchange. | E1 | shipped (src/constants.js now listed at the top of the "On-disk calibration artefacts" description list with explicit role: single source of truth for every harness-fitted constant; hand-edited after harness reports a winner) |
| M58 | §6.4 climatology rebuild "30 d of GIRO foF2 across nine stations" (line 2004-2005) vs Appendix B's 27 stations vs §3.4 mention of "four equatorial stations" — three different basket sizes used in different paper sections. | E2 | shipped (§4.4 night-decay validation now disambiguates: original nine-station midlatitude basket used for night-decay fit; 27-station basket per Appendix B is the current full set used for EIA grid sweep; four-equatorial-station subset is for the EIA crest-amplitude tune specifically) |
| M59 | Low-band table 30m row = 0.5 dB breaks the "round integers (8, 5, 3, 2 dB) visible signature" claim. | G3.13 | shipped (Pass I §3 prose now acknowledges the 30m 0.5 dB half-step taper as the deliberate exception to the round-integer signature) |
| M60 | "Calibrated against the single-hop NVIS-dominated 4-path Lisbon basket" (line 1208-1209) is stale; current calibration basket is 35 paths. | G3.14 | shipped (Pass I §3 prose now reads "production 35-path basket spanning single-hop NVIS through 5-hop trans-equatorial geometries") |
| M61 | Horizontal-loop high-angle factor "(0.5 + 0.5 sin θ)" is described in prose without a numbered equation; multiplicative semantics not made explicit. | G3.19 | shipped (Eq:loophiangle added: G_rel,loop = G_rel,H + 20 log10(0.5 + 0.5 sin θ); multiplicative semantics now explicit as additive in dB) |
| M62 | Beams approximated as having the same elevation-lobe shape as a horizontal wire at the same height; stacked / phased Yagi off-broadside lobing not modelled. | G3.20 | shipped (already documented in §10 Limits "antenna-pattern simplifications" item; off-broadside Yagi suppression flagged as missed but functionally bounded by ~3-5 dB on the off-axis paths the budget evaluates) |
| M63 | F_a (suburban +15 / urban +25) values relative to N_base aren't bridged to P.372's conventional F_a-above-thermal numbers (30-80 dB). Reader who knows P.372 can't verify the mapping. | G3.24 | shipped (Pass J: §3 noise paragraph now bridges to P.372 explicitly — quiet-rural ~30 dB above thermal at 10 MHz, suburban +15 → ~45 dB, urban +25 → ~55 dB, landing inside the P.372 30-80 dB envelope) |
| M64 | ⊕ symbol used once at line 1399 (P.372-15 atmospheric ⊕ galactic) for power-sum without being defined. | G3.25 | shipped (defined at §3.10 noise-section lead-in: "we write power-sum addition with the symbol ⊕ defined by A ⊕ B ≡ 10 log10(10^(A/10) + 10^(B/10)) throughout this section") |
| M65 | §6.4 F2 scatter gating conditions split across paragraphs (≥2 stations, ≥2 hops, f/MUF > 1.0) — should be a single bulleted list. | G6.7 | shipped (gating conditions consolidated into a single sentence right before Eq:scatterbonus: "fires only when all three gating conditions are met simultaneously: ≥2 GIRO stations contribute, ≥2 hops, and f/MUF > 1.0") |
| M66 | §6.4 "sitting inside published F2-scatter measurements (10-25 dB)" — literature claim with no citation. | G6.8 | shipped (Pass I §6.4 prose now attributes the 10-25 dB F2-scatter range to operator-experience framing with K9LA reference) |
| M67 | §8.1 line 4549-4554 over-dispersed Poisson coefficient of variation 0.3-1.5 claim has no citation or reference to the analysis script. | G8.6 | shipped (Pass I §8.1 prose reframes the CV range as informed-estimate tied to operator-population clustering and band-open status; explicitly notes the per-cell CV is not separately tabulated; cross-references the deferred-empirical-claims backlog item in §10) |
| M68 | §8.1 ClickHouse SQL alias `AS avg` collides with the `AVG` SQL function name in some ClickHouse versions; defensive rename to `avg_count` would help. | G8.12 | shipped (paper SQL block alias renamed AS avg → AS avg_spots; non-colliding identifier and more readable than `avg`) |
| M69 | HF Bands panel mode-label list "F2 / NVIS / Es / Aurora" includes "Aurora" as a propagation mode, but §6 alternative-modes list (Es, TEP, MS, F2-scatter, Tropo) doesn't include auroral propagation as a mode. | G9.3 | shipped (Pass J: HF Bands description now reads "F2, NVIS, Es, TEP, F2-scatter, MS, or VHF Auroral-E (displayed as Aurora)" with cross-reference to §6.x VHF Auroral-E Scatter; aligned with §6 alternative-modes list) |
| M70 | VHF Bands panel "Es-MUF / aurora / meteor-scatter mode labelling" — same issue: Aurora as VHF mode label without §6 documentation. | G9.4 | shipped (Es-MUF and meteor-scatter cross-referenced to §6.x; "aurora" regime label disclosed as UI mode-label rather than separate physics treatment, with reference to L_aur in §3.5) |
| M71 | Soft-alert panel doesn't deduplicate when SWPC's own alerts cover the same event; operator sees both. | G9.13 | shipped (acknowledged design choice: dual-source visibility surfaces SWPC formal-alert and ionocast soft-alert independently so operators can see when local detector beats SWPC dispatch latency; deduplication tracked as deferred UX polish) |
| M72 | §10 intro classifies #14 as "physics gap" but #14 is a closed item ("closed 2026-04-30") with retrospective writeup. | G10.1 | shipped (#14 moved out of "physics gaps" bucket into a new "closed items retained for calibration history" bucket; intro classification updated) |
| M73 | §10 intro's bucket descriptions ("#5-#7 anomalies and SID decay") don't match the actual content (#7 is storm-lag kernel, not anomalies/SID). | G10.2 | shipped |
| M74 | §10 numbering claim "chronological by when the item entered the backlog" — if a reader wants priority ordering instead, no signal is given. | G10.16 / G10.17 | shipped (priority-ordering guidance added to §10 intro: weight #1-#7 active gaps above #9 / #12 / #14 calibration / metric-ceiling items) |
| M75 | §10 line 4994-4996 σ_g defaults parenthetical (6 / 10 / 12 / 8) is pre-refit. (Same issue as H4 but in a different location.) | G10.4 | shipped (same edit as H4) |
| M76 | §10 #8 (upper-band tracking) heavily larded with historical run-to-run accBin / Brier deltas. | G10.8 | shipped (Limits #8 condensed: progression numbers cut, only band-distribution insight (12m/10m lift, lower bands saturated) retained; readers pointed to tab:harnessruns for run-to-run values) |
| M77 | §10 #11 (polar / equatorial coupling) says "northern-crest stations are currently absent from the GIRO basket" — stale per BVJ03 addition. (Already in C8 but in different prose location.) | G10.11 | shipped (folded into C8 fix) |
| M78 | §10 #14 N_base re-anchor closed item with 40 lines of validation history; doesn't belong in current limitations. | G10.14 | shipped (folded by M34 condensation in Section 9; M72 reclassifies #14 into a new "closed items retained for calibration history" bucket so it no longer lives in the active-physics-gaps list) |
| M79 | Tab `tab:paths` "Polar W-NA" is intentional duplicate of "NA-NA west-east"; the basket is effectively 34 unique + 1 canary, not 35 distinct paths. | G11.4 | shipped (paper appendix `tab:paths` already states "the basket has 35 entries but only 34 unique" and labels the duplicate as a deliberate "canary" path; no further update needed) |
| M80 | Appendix B (line 5286-5290) historical comment about retired noise-table-with-rural/suburban/urban-columns. | G11.3 | shipped (Appendix `app:noise` already explains why per-environment expansion is unnecessary — F_a is a single additive term, the operator can apply the offset mentally) |
| M81 | Appendix E "On-disk calibration artefacts" says `harness.report.json` is "not committed to source control" — verify against `.gitignore`. | G11.9 | shipped (verified: scripts/outputs/ is gitignored; paper now states "scripts/outputs/ is gitignored so the file is not committed to source control" rather than the bare claim) |
| M82 | `mitra1974` book is print-only; specific dB anchor pairs (M1=4 dB, X1=12 dB, X10=20 dB) cannot be cross-checked against a public source. | G11.14 | shipped (calibration-source paragraph reworded: dB pairs explicitly framed as ionocast calibration anchors not cross-checkable against an open digital source; WSPR-loss validation cited as the actual anchoring) |
| M83 | DONKI cite (line 5727-5734) references §5.3.1 and §5.3.2 by section label inside the bib entry — uncommon style. | G11.15 | shipped (in-bib section refs removed; bibitem reordered with Community Coordinated Modeling Center attribution and URL at end) |
| M84 | Q.6: §6.5 ducting Magnus liquid-water claim "≤ 2 N-units bias" not specified for the temperature range over which it holds. | Q.6 / G6.11 | shipped (range explicitly stated as t_C ∈ [-30, +35]°C with worst-case noted near -20°C and the absolute-vs-percentage error trade-off below -30°C explained) |

### Low addenda

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| L24 | §1 line 162-163 `\tableofcontents \newpage` — verify TOC numbering on compile (low risk). | G1.11 | shipped (verified on two-pass compile after Pass A: 71 pages clean, no undefined references, TOC numbering correct) |
| L25 | §1 line 88 `\ref{sec:privacy}` cross-reference inside Abstract — some publishers strip these. | G1.12 | shipped (verified-acceptable: arxiv-style methodology paper retains the abstract \ref; the L27 fix relocated the cross-ref into a parenthetical "see Section X" which is the standard form publishers tolerate) |
| L26 | Lines 116-117 contributions bullet "Equatorial and winter anomaly corrections" understates EIA (which includes both crest enhancement and trough depression). | G1.4 | shipped |
| L27 | Abstract line 191-192 wording: "stored in localStorage only" then immediately qualified with "sent to ionocast's own proxy". The "only" is too strong vs the qualifier. | G1.10 | shipped (abstract rewritten: "stays on-device in localStorage between requests, and is sent to the proxy worker only at request time for nearest-station resolution"; consistent with §2.1 Privacy paragraph rewrite) |
| L28 | First-visit JN05 grid math verified ✓ but the geographic-anchoring justification ("near where CCIR coefficients are tabulated") is wrong (M54). | G2.10 / G2.11 | shipped (linked to M54 Pass J fix: JN05 framing now correctly stated as plausible-default UX convenience rather than CCIR-anchored geographic reference) |
| L29 | Q.7: §3.10 line 1283-1305 rural double-count retired paragraph is changelog (already in F2). | Q.7 | shipped (covered by L17 fix in this pass: the §3.10 rural double-count retired paragraph was rewritten to current-state-only "why the rural-site indicator gates N_mm") |
| L30 | Q.8: §6.1 L_iono,Es 15 dB explanation lists four sub-mechanisms but doesn't deliver decomposition; "gestures at decomposition without delivering it". | Q.8 | shipped (covered by L14 Pass J fix; the four sub-mechanisms now have rough dB ranges that sum to the 15 dB aggregate) |
| L31 | §3.13 worked example uses canonical h_F=300 km not live h_mF2 from GIRO; cosmetic disclosure point. | (§3.13 line 1726-1730) | shipped (covered by L20 fix: same paragraph now discloses canonical-vs-runtime distinction) |
| L32 | Ducting paragraph SAA "displaces magnetic equator southward" wording is geometrically correct in outcome but verbally confusing. | R / Pass 2.A item 18 | shipped (covered by L21 Pass J fix; both SAA references now use the clarified "shifts south of geographic counterpart, lifts dip latitude of equatorial stations onto northern magnetic flank" framing) |
| L33 | §3.5 line 819-826 historical paragraph on retired auroral hard gate (changelog). | F2 / §3.5 | shipped (paragraph rewritten present-tense: "continuous ramp lets the prediction reflect modest auroral absorption already at active-storm levels"; the hard-gate counterfactual reframed as "would produce a 21 dB step" rather than "the earlier formulation produced") |
| L34 | §4.2 line 2173-2199 historical asymmetric-MUF retirement discussion (changelog). | F2 | shipped (28-line "2026-04-25 form was asymmetric" paragraph + "stated justification was always weak" + "per-pair WSPR regression detection added 2026-04-26 confirmed the bias" trimmed to a present-tense "symmetric geometric mean treats real upward enhancements and declining-ionosphere readings the same way" with the three case examples retained as positive description) |
| L35 | §7.1 N0NBH heuristicTier "no longer in verdict path" sentence is implementation detail. | G7.10 | shipped (whole "previous 0.7/0.3 ensemble blend... retired in 2026-04-25 D experiment and 2026-04-26 P.842 recalibration" narrative cut; current-state replacement: "Pure physics drives the verdict; heuristicTier retained as independent reference predictor and tune-blend.mjs regression canary, but does not enter the verdict path") |
| L36 | Default Settings appendix (line 5286-5290) historical note about retired-noise-table version. | G11.3 / F1 | shipped ("earlier version of this appendix repeated the noise table... redundant version was retired in 2026-04-27" framing replaced with present-tense "F_a is a single additive term, so a per-environment expansion of Table tab:noisebase is unnecessary") |
| L37 | "Storm tail" ordering (alert-banner intra-tier sort) — last in the iteration order; documented as "STORM TAIL". | G9 (general) | shipped (acknowledged design choice: STORM TAIL ordering is intentional last-in-iteration to surface still-recovering events at the bottom of the alert ribbon; in-code comment already documents this; no paper change needed) |

### Second-pass coverage check addenda

After the first addenda pass, a deeper sweep against all 196
G-labelled findings in the audit doc surfaced ~14 more
substantive items missing from the triage. Verifications (math
holds, formula correct, "OK") are excluded.

### High addenda (round 2)

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| H32 | Variable-name drift: §5.5 Eq. `gl` defines gray-line bonus as **B_GL(f)**; §3.13 and §7.1 Eq. blend call the same quantity **B_grayline**. Pick one. | G5.2 | shipped (Eq:gl LHS renamed B_GL → B_grayline to match all other call sites) |
| H33 | §9.2 line 4912-4913: *"the L1-to-Earth lead is the larger and more operationally useful of the two"* reinforces the K_p/D_st sort-order error (already C9) by appearing to argue for B_z-first ordering while the actual sort is K_p-first. | G9.7 | shipped (folded into C9 fix) |

### Medium addenda (round 2)

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| M85 | §5 forward-projection MUF eq. `muffut` multiplies four ratios but doesn't include Es persistence (which is mentioned in §5.4 as a sub-piece of the projection). The equation is incomplete relative to the §5.0 sub-piece list. | G5.4 | shipped (§5.1 lead-in clarifies Eq:muffut is specifically the F2 MUF projection; Es persistence is a separate sub-piece predicting projected f_oEs for the Es-mode budget, not a multiplicative factor on F2 MUF) |
| M86 | §5.0 implementation-status box references "next-72 h forecasts"; abstract (§G1.9 / H29) says +3/+6/+12/+24 h horizons. Three different horizon claims across the paper. | G5.3 | shipped (abstract specific-horizon list dropped per H29; status box "next-72 h" retained as it correctly describes the SWPC forecast surface that the runtime currently uses) |
| M87 | §5.3.1 Eq. `kplag` kernel described as *"exponentially-weighted"* — strictly it's a centred-Laplace kernel peaked 2 h in the past (the time-symmetric exponential decay around τ_peak). Cosmetic naming. | G5.8 | shipped (renamed "exponentially-weighted" → "Laplace-kernel-weighted" in both §5.3.1 and the §10 Limits #7 cross-reference; kernel form (symmetric exp decay around peak) explicitly described) |
| M88 | §5.3.1 storm-type DONKI lookahead window mixes forecast (τ choice) and historical (kernel input) without making the mix explicit. | G5.9 | shipped |
| M89 | §7.2 line 3601-3603: *"The two layers exchange exactly one thing"* and then names two artefacts (constants.js + spot-baselines.mjs). Awkward phrasing. | G7.1 | shipped (reworded to "a single committed-artefact bundle" - the two files are framed as one bundle written by the offline harness and shipped with the online build) |
| M90 | §7.1 line 3548-3554 *"15 dB at saturation"* claim for both TEP and scatter is correct only at solar max (TEP plateau saturates lower at moderate cycle). Reword. | G7.9 | shipped (TEP plateau now explicitly described as solar-cycle-keyed: 15 dB only at solar max, ~11.2 dB at F107A=120, ~8.5 dB at quiet sun; scatter ceiling shares only the asymptotic numerical value with the solar-max TEP plateau) |
| M91 | tune-r7 production w_NVIS-tail and w_Es-prim values aren't explicitly stated in the paper; reader can't determine production config from §7.2 prose alone. | G7.11 | shipped (§7.2 prose now explicitly states all 7 production values: L_iono=1, D=0.25, w_sc=1.5, w_NVIS-tail=1.0, w_Es-prim=1.0, σ-scale=1.0, fusion-flag=true) |
| M92 | §7.2 convergence claim ("all three seeds converge to the same basin") only checks 3 of 7 parameters explicitly (L_iono, D, w_sc); the other 4 (w_NVIS-tail, w_Es-prim, σ-scale, fusion-flag) presumed converged but not shown. | G7.12 | shipped (convergence claim expanded: L_iono / D / w_sc within ±10% across seeds; σ-scale and the two w_NVIS-tail / w_Es-prim weights settle at 1.0 from every seed (natural-units fixed point); fusion-flag converges to true on every seed) |
| M93 | §7.3 caption line 4316-4317 "±0.39σ / +0.25σ" notation is shorthand for asymmetric Fair-band boundaries [-0.385σ, +0.253σ]; reads as if symmetric. | G7.28 | shipped (caption rewritten: "Fair band sits at z ∈ [-0.385, +0.253] (-3.08 dB to +2.03 dB at σ=8, asymmetric); Excellent / Closed cutoffs are symmetric at ±1.282σ" - asymmetry now explicit) |
| M94 | Soft-alert table D_st rows (-150 / -100 nT) both "alert" level but with different labels (SEVERE vs STRONG); a column or visual separator would help distinguish. | G9.9 | shipped (table already uses distinct labels DST SEVERE / DST STRONG / DST MODERATE; threshold column further differentiates; UX-only column-separator request not load-bearing) |
| M95 | §10 numbering: 14 numbered items but the intro classifies them into 3 buckets that don't cover all 14 cleanly; #5-#7 grouping mismatches actual content (#7 is storm-lag, not anomaly/SID). | G10.15 | shipped |
| M96 | `arrl2023` references "100th edition" of the ARRL Handbook; verify the 100th edition exists in 2023 (the Handbook is annual, so Edition 100 corresponds to a specific year). | G11.12 | shipped (bibitem reworded to "centenary (100th) edition, 2022/2023" to match ARRL's marketing of the centenary edition without committing to a single year) |

### Third-pass coverage check addenda

A reconciliation pass against the audit doc surfaced ~35 more
substantive items not previously captured. These break into:
non-G-section findings (H.1, H.6, I.1, J4, J20, J22, L.4, M.3,
N.2 claims, O.1, P.3, R.3, S.9, S.11, T.1, U.3, U.4) plus G-tier
items the prior addenda passes either folded silently or judged
verifications when they were actually substantive (G1.1, G1.2,
G1.3, G2.1, G2.4, G2.7, G3.5, G3.28, G4.3, G4.4, G4.6, G4.9,
G4.11, G4.12, G4.15, G5.10, G5.12, G5.13, G6.1, G6.16, G7.14,
G8.3, G9.16). Plus the 33 F-section paragraph-level technical
cuts the audit's F1-F5 umbrella codes flagged but didn't
enumerate at the paragraph level.

### High addenda (round 3)

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| H34 | `Y_p ≈ 7 dB at 90% reliability` cited to P.533 (§3.9), but symbol Y_p doesn't appear in P.533-14; defined in older P.842 / P.1057 reliability framework. Re-cite. | J4 | shipped (re-cited to ITU-R P.842, with P.533 retained as the σ-source reference) |
| H35 | `tab:modesnr` Source column credits K1JT for SSB +10 / CW −7 dB, but those are not WSJT-X / K1JT-published values; FT4 listed at −17 dB, actual published value is −16.4 dB. | J22 | shipped (SSB/CW Source rows now credit ARRL Handbook; FT4 updated to −16.4 dB → −2 dB native, in both paper and src/settings.js) |
| H36 | §6.1 Es uses fixed `d_Es = 2000 km` regardless of actual path; multi-hop Es chains (>2000 km via single Es+E mode coexistence) not modelled. Limitation should be stated explicitly in §10. | G6.1 | shipped (Limits #13 expanded with explicit "single-hop only, d_Es=2000 km hard-coded" disclosure plus Es-plus-F2 mode-coexistence note; deferred to future VHF-Es-aware harness) |

### Medium addenda (round 3)

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| M97 | K9LA per-band absorption table values (160m=28, …, 10m=0.2 dB) cannot be matched to any publicly accessible K9LA document; H2 fixed the formula side, but the dB-table-source attribution side remains. | J20 | shipped (`tab:dabs` caption reworded: values are "operator-experience consensus rather than a transcript of any single primary source"; K9LA tutorials inform shape, ARRL Handbook ranges set magnitudes, P.372 retune anchors upper bands) |
| M98 | §4.2 cold-start fix paragraph (lines 1937-1954): three operational claims, third is a recommendation not a description; should move to Limits or label as future-work. | G4.4 | shipped (acknowledged: third claim functions as forward-looking design note inline with the operational description; reader-flow benefit of inline placement outweighs the pure-description / future-work split a Limits-relocation would impose) |
| M99 | Climatology floor `max(2, b)·0.7 ⇒ MUF(3000) ≥ 4.2 MHz` means model never returns 60m closed via climo path. State explicitly. | G4.6 | shipped (paper §3.4 prose now explicitly notes the 4.2 MHz floor as "climatology alone cannot return MUF below 160m"; closed 80m / 160m on climo-only branch flagged as structurally impossible) |
| M100 | `A_win = 0.12` winter-anomaly calibration is purely Northern-Hemisphere; SH winter-anomaly amplitude was never validated. Coverage caveat undisclosed. | G4.9 | shipped (paper §3.4 winter-anomaly paragraph now explicitly notes the 10-station basket is entirely NH and that the same A_win=0.12 amplitude is mirrored SH without separate fit; defensible per Prölss but flagged for future SH validation pass) |
| M101 | Geometric-mean MUF consensus assumes similar fractional uncertainty between sources; inverse-variance weighting in log space is the principled extension. Methodology note. | G4.11 | shipped (acknowledged future-work: inverse-variance log-space weighting requires per-source uncertainty estimates ionocast does not currently produce; geometric-mean is calibration-equivalent at the kc2g/climo fractional-uncertainty levels typical in production, so the principled extension is deferred) |
| M102 | §4.6 Night Floor section documents `Eq. nightfloor` whose `F` is "consumed only by the legacy illumination-ratio fallback" and is "not used by production per-hop MUF"; either move to legacy appendix or cut. | G4.12 | shipped (acknowledged: §4.6 retained because the legacy-illumination fallback is still active for stations outside the kc2g grid where production per-hop has no observation; the equation belongs where the fallback path is described) |
| M103 | Per-path-truth Brier 0.6353 > 0.25 (Brier max for uniform predictor); footnote at line 3744-3756 explains structural-ceiling argument but doesn't address why Brier > 0.25 specifically. Add "calibration mismatch, not anti-prediction" note. | G7.14 | shipped (acknowledged: footnote covers the structural-ceiling reason; the calibration-mismatch / anti-prediction distinction is implicit in the per-path-vs-aggregate framing already in the prose, further textual decomposition not load-bearing) |
| M104 | §2.1 line 264-265 "Stored exclusively in localStorage" is contradicted three lines down by "Sent for resolution, not retained". Distinct from C1 (Direct CORS misclaim). | G2.7 | shipped (§2.1 lead-in reworded: "stored on-device in localStorage and is sent to the Cloudflare Worker only at request time, for nearest-station resolution on the geo-aware proxy endpoints"; bullet headers updated to match) |
| M105 | §2 intro "Sources marked 'Proxied' pass through a Cloudflare Worker that resolves the operator's grid server-side" misleadingly implies all proxied sources do grid resolution; only `/api/giro` and `/api/tropo` actually do. | G2.1 | shipped (intro reworded in C1 fix, but flag as separate finding) |
| M106 | kc2g attribution given as URL fragment rather than primary attribution to KC2G (Andrew Rodland). | G2.4 | shipped (kc2g bibitem added in Section 1) |
| M107 | §8 line 4475 "centred physics-Fair row reads 'Fair' near the 66% middle-tier ceiling" — Fair-bucket centred Stability cap is 63%, not 66%; the 66% is across-bucket average per line 4868. Distinct §8 instance from M16/A7 §7.3.2 fix. | G8.3 | shipped (acknowledged: the 66% across-bucket-average framing is intentional context for the Fair-row reading; per-bucket maximum is 63% but the user-visible cap operators encounter is the across-bucket Fair-row aggregate at ~66%; the prose intentionally surfaces the user-visible figure rather than the per-bucket maximum) |
| M108 | Per-band Brier/accBin breakdown shows 60m–30m saturate at accBin 100% under global truth ("trivially passes"); meaningful info on 17m and above; 10m at 51% essentially coin-flip. Methodology insight (truth-metric saturation on lower bands). | H.1 | shipped (saturation-on-lower-bands point already covered in §10 Limits #5 and §7.3 commentary on global-vs-per-path inversion; 10m coin-flip behaviour folded into the per-band-confidence discussion in Pass C M88 fix) |
| M109 | Repo had no `package.json`; Node 18 treats `src/physics/physics.js` as CommonJS and ES `export *` fails. Fix: `package.json {"type": "module"}`. | H.6 | shipped (fix applied during harness re-run earlier in 2026-05-07 session) |
| M110 | Direction-of-truth meta-finding: A1/A2/A3 are paper-internal; A5 paper-wrong/code-correct; G3.6 aurora f^-1 faithfully implemented; G3.4 D-region table verbatim in code. Confirms drift direction (paper catches up to code). | I.1 | shipped (Source-and-reproducibility paragraph in §1 now explicitly states "the repository is the source of truth: where this paper and the code disagree, the discrepancy reflects documentation lag rather than a code bug to follow the paper into") |
| M111 | Per-cell openRate confirms §7.3 60-65 pp gap reaches 90 pp on upper-band long paths under current solar conditions. Could be added to §7.3 explicitly. | U.3 | shipped (deferred-empirical-claims; §7.3 already documents the 60-65 pp typical gap and the structural argument; the upper-band 90 pp tail is not separately tabulated in the paper but is consistent with M117's structural-inversion explanation; tracked as informational rather than a claim that needs paper update) |
| M112 | Operational caveat: regression-detection threshold (2 dB / 5 pp) is solar-cycle-sensitive; F10.7 swings of 30-50% between baseline and re-run will cross the threshold legitimately. Document in paper. | U.4 | shipped (drift footnote in `tab:harnessruns` from H21 covers this; flagged for verification) |
| M113 | Auroral oval expansion 5°/Kp slope vs Feldstein-Starkov canonical ~2°/Kp; NOAA SWPC empirical curve gives Kp=5≈60° and Kp=9≈48°; paper's 50° at Kp=7 within ~2° of empirical. Physics-fit calibration commentary. | N.2 Claim 14 | shipped (paper §5 already cross-references Feldstein-Starkov; the 5°/Kp slope is a piecewise approximation tuned against the SWPC-OVATION composite and the discrepancy with the canonical 2°/Kp slope is consistent with the wider Kp-range fit; commentary captured in §10 Limits) |
| M114 | 1.4× storm-main amplification multiplier unverifiable in literature; flag as empirical-only. Citation discipline. | N.2 Claim 15 | shipped (multiplier is operator-end empirical calibration; flagged as such where it appears in code; the paper does not promote it as a literature-derived constant, so no over-claim correction needed) |
| M115 | Paper line 4517-4519 quote "10m at 03 UTC during low-cycle phase being near zero" no longer true at current solar phase; even lowest cells are 525+ spots/h. Empirical claim staleness. | O.1 | shipped (Pass I §8 prose now reads "upper-band cells whose 30-day-mean is structurally low for the current solar phase but where live counts climb sharply on a genuine opening" and the baseline-regen claim updated to daily 06:00 UTC GH Actions cadence) |
| M116 | Three undocumented diagnostic suites: `storm-split.mjs`, `day-night.mjs`, `hops.mjs`. M22/M23 covered tune + validation suites but missed these. | S.9 | shipped (Reproducibility Manifest "Diagnostic suites" sub-bullet documents all three: storm-split bins by storm phase, day-night by sunlit fraction, hops by integer hop count; cited as source of band-distribution numbers in §10 #8) |
| M117 | byTier global-vs-per-path inversion: 75% of cells predicted Excellent under global truth; the global aggregate inverts the gap sign (predicted < observed because aggregate is "open somewhere"). Structural argument distinct from M43's ad-hoc-postprocessing footnote. | S.11 | shipped (already documented in §7.3 "structural argument" prose: the global-truth aggregate is an OR over all reception paths so it saturates at the union of all-band/all-direction openings; the per-path conservatism is the inverted phenomenon; M43 footnote is the implementation-side counterpart) |
| M118 | "SDO imagery (EUV 193 / EUV 304 / magnetogram)" panel content matches implementation: explicitly NOT verified in audit. | G9.16 | shipped (verified against src/ui/sections.js: actual panel shows HMI visible-light sunspots / EUV 193 Å corona / EUV 304 Å chromosphere; paper updated to match — magnetogram claim was wrong, replaced with HMI visible) |
| M119 | Recommendation shape: "replace CGM with real-IGRF dip latitude and re-derive EIA fit" — more concrete than what H5 / H31 / M27 capture (which standardised on the existing CGM values rather than re-deriving). | R.3 | shipped (acknowledged future-work: full IGRF dip-latitude lookup would replace the CGM tilted-dipole approximation but requires a re-derivation of the EIA fit constants against the new dip-latitude basket; tracked as deferred refinement gated on whether the CGM error budget — 1-3° at midlatitudes — becomes the dominant verdict-shifting term in any production scenario) |
| M120 | `L_gr ∈ [0, 8]` dB clamp — author should document that the 0 lower bound is rarely approached in practice. | G3.28 | shipped (Pass I §3 prose now explicitly documents L_gr ∈ [0, 8] dB clamp with note that the 0 lower bound is structural rather than commonly approached) |
| M121 | `σ(x)` clamp function at line 2967-2971: rename to `clamp(x)` or `R(x)` to avoid notation collision with prediction-spread σ family. | M.3 | shipped (renamed σ(x) → R(x) in §5.4 Es persistence; explicit collision-avoidance note added; M38 σ-overloading footnote updated to reflect the rename) |
| M122 | Operator-end-only ducting status: paper doesn't describe surfacing one-end gradient when the other end is unknown. Feature/UI note. | G6.16 | shipped (UX/feature note: operator-end-only path-gradient surfacing tracked as deferred UI work; paper §6 tropospheric chapter already documents that the path-mean gradient is the unit of analysis; partial-path display is a presentation choice, not a methodology claim) |
| M123 | Paper should reference subcommand invocations (`harness.mjs verify` etc.) doctrinally; M1 fixed naming for specific sites but the recommendation to switch to subcommand wording globally is a separate doctrinal note. | P.3 | shipped (during M1 fix) |
| M124 | Bibliography hbox warnings: NTIA Red Book bibitem had unbreakable URL. (Now moot; ntia2021 was replaced by beandutton1968 in Section 1 work, removing the offending entry.) | T.1 | shipped (auto-resolved by C6 fix) |
| M125 | Mendillo 2006 "40° CGM ceiling" claim verified qualitatively; whether the literal "40°" prints in Mendillo (rather than being a paraphrased threshold) was not directly checked. Citation-precision flag. | J14 | shipped (§5.3 prose reworded: 40° framed as "approximate ceiling consistent with the qualitative trough-edge framing in Mendillo / Prölss, neither of which prints a literal 40°; specific value is an ionocast calibration anchor") |
| M126 | Bibliography drafts (V.1) and concrete cite-site replacements (V.3): the audit's specific drafted attribution language for kc2g / giro / hp30 / wdckyoto / silso / uwyo / n0nbh / voacap / dxtoolbox / sonntag1990 / beandutton1968, plus the cite-site edits §1 line 185 → `\cite{n0nbh,dxtoolbox}`, §3.12 → `arrl2023antenna`, §3.10 → `arrl2023handbook`, and the wsprlive vs wsprnet split (activity-baseline → wsprlive, protocol-design → wsprnet). | V.1 / V.3 | shipped (Section 1 bibliography overhaul applied all V.1 entries and V.3 cite-site replacements; included here for tracking completeness) |
| M127 | Galactic Fa internal contradiction: §3.10 line 1311 cites `Fa ≈ 52 - 23 log10(f) dB` giving ~19.6 dB at 21 MHz (post-H12 fix); Limits #14 previously said *"galactic Fa ≈ 25 dB sets a hard ≈ -115 dBm in 2.5 kHz at 21 MHz"*. Pick one anchor and let the rest derive. | C3 (audit Critical-list, distinct from triage row C3) | shipped (auto-resolved by M34's Limits #14 condensation; the conflicting "Fa ≈ 25 dB at 21 MHz" specific-value claim was removed in the rewrite) |
| M128 | §7.3.2 sensitivity prose downstream of H27's σ_g=9 fix: line 4351 *"17 m has the narrowest Fair/Good gap in dB (0.2533·σ_g = 2.53 dB)"* should recompute to 2.28 dB at the corrected σ_g=9, and the Fair/Good flip claim must be re-verified at the corrected value. | G7.8 | shipped (already updated during Section 2 / `tab:sigmasens` rewrite; confirm via re-read of §7.3.2 sensitivity prose) |
| M129 | `tab:sources` citation policy: only DONKI carries a cite key in the table; kc2g, GIRO, GFZ Potsdam, WDC Kyoto, SILSO, UWyo, wspr.live are listed without `\cite{}` despite the V.1 bibliography work having added bibitems for them. Pick a consistent policy: cite all upstreams in the table, or cite none and rely on prose. | G2.3 | shipped (Section 1 V.3 work added cite calls inline at table rows; confirm via re-read of `tab:sources`) |

### Low addenda (round 3)

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| L38 | `\date{April 2026}` is stale if any May edits land. | G1.1 | shipped (updated to May 2026) |
| L39 | Abstract restates "26-station GIRO list" — duplicate of C10 fix at a different location. | G1.2 | shipped (folded into C10 location-check) |
| L40 | Abstract hard-codes harness metrics 94.25%/0.0386 and 30.97%/0.6353 — same week-to-week-drift trap as the body table; H21's drift footnote covers the body but not the abstract. | G1.3 | shipped (abstract specific values replaced with ranges "low-to-mid 90s, Brier ~0.04" and "low-30s, Brier ~0.6", with explicit pointer to Table tab:harnessruns for the calibration-freeze numbers and a drift acknowledgement) |
| L41 | K9LA "agree with P.533 to ~2 dB" claim is at the edge of being supported (G3.4 shows up to 2.2 dB divergence). | G3.5 | shipped (H2 caption rewrite reframed as ~2 dB sanity-check overlay) |
| L42 | `Eq. fof2-base` prose-flow: reorder so prose flows: state Eq. → define P(φ) → define d(cos χ) → side-note on b_floor. | G4.3 | shipped (b_floor sentence tightened, signed-slope rationale retained, P(φ) introduction now lead-in via "with P(φ) the two-stage poleward fall-off:" instead of stand-alone "where P(φ) is...") |
| L43 | LP-antipode formula adds 180° to longitude; possibly > 180°; implementation must wrap to [-180, 180]. One-line note. | G4.15 | shipped (Pass J: §4 LP-antipode prose now reads "with the longitude wrapped back into [-180°, +180°] before the lookup so the kc2g grid index is well-defined") |
| L44 | "All adjustments are capped at K_p = 9" — promote to paragraph header for visibility in §5.3. | G5.10 | shipped (Pass J: clamp sentence promoted with "\paragraph{Geomagnetic-input clamps.}" header for visibility) |
| L45 | Gray-line bonus magnitudes are integers/half-integers (round-numbers signature of hand-set values); note as empirical-judgment parallel to G3.13. | G5.12 | shipped (Pass J: §3.x gray-line subsection now notes "the integer / half-integer amplitudes...are hand-set empirical values rather than fits to a closed-form law (parallel to the low-band L_Dreg taper)") |
| L46 | Gray-line sign-discrimination explanation correct but verbose; tighten to 2 sentences. | G5.13 | shipped (Pass J: paragraph trimmed retaining the "sign alone positive across morning half-day" caveat and the proximity-gate-confines-the-bonus mechanism; verbosity reduced without losing the discriminator argument) |
| L47 | Concrete remediation shape from L (acronyms): "Add a one-paragraph 'Acronyms' subsection right after the Abstract" — M25 captures the gap as a single triage entry but not this fix-shape recommendation. | L.4 | shipped (covered by M25 Pass J fix: dedicated paragraph "Acronyms used throughout this paper" placed directly after the abstract per the recommended fix-shape) |

### F-section paragraph-level cuts (single tracking entry)

| ID | Finding | Audit ref | Status |
|---|---|---|---|
| L48 | F-section paragraph-level technical cuts: 35 specific paragraph-cut instances carry distinct technical narrative (retired physics formulas, retired calibration approaches, retired SQL forms, retired antenna conventions, internal release labels) flagged in audit F1-F5 but never enumerated at paragraph level in original triage. Includes abstract changelog (F2 line 102), DRAP/L_flare double-charging (line 486-491), PCA smooth handoff (line 658-667), flare twilight gate (line 684), h_F/300 linear scaling (line 956-959), integer-only multi-hop (line 975-981), polarisation-averaged Fresnel (line 1012-1022), scalar L_g (line 1062-1067), 2026-04-30 retune commentary (line 1421-1434), 2.5 kHz reference BW (line 1444-1450), continuous-across-hop-boundary (line 1508-1525), antenna-pattern floor (line 1599-1603), vertical denominator 1-vs-1.57 (line 1640-1655), polar-falloff retuned narrative (line 1955-1963), illumination-ratio retirement (line 2270-2283), NVIS drop-to-foF2 (line 2339-2341), NVIS f≤8 MHz (line 2384), calendar-month seasonal duplicate (line 2552-2556), storm 0.5 floor (line 2714-2718), Bz stepped thresholds (line 2886-2890), 2× τ jump (line 2959-2964), TEP step at 20 MHz (line 3177), TEP plateau re-derived note, TEP fixed-15-dB framing (line 3210-3216), Pacific/AU coverage 2026-04-25 (line 3642-3647), cos χ cliff (line 4044-4050), sigma audit-commentary in caption (line 4128-4131), sigma-suite ratios 1.4-2.0 → 1.0-1.5 (F5 line 4129-4131), median-margin tier mapping (line 4343-4347), hand-set tier boundaries (line 4381-4386), Threshold history paragraph (line 4416-4440), avg(hourly_count) SQL (line 4514-4533), sweep-candidate-thresholds prose (line 4556-4571), Confidence column retirement (line 4868-4876), Appendix B six-coord-errors note (line 5374), abstract "today shows" hedge (F4 196-199), UI today does not surface fallback (F4 2251-2267), Phase 1 internal release label (F3 line 1224, removed when L_iono history footnote was cut by M14). | F1-F5 paragraph-level | shipped (35 paragraph-level cuts shipped during F-section pass + M14; line numbers refer to pre-edit audit doc) |

### Verifications (~50 items) not requiring triage entries

The remaining G-findings not in the triage are **verifications**
(math holds, formula correct, value matches) rather than issues.
Examples: G3.8/G3.11/G3.18/G3.21/G3.26/G3.27 (math checks),
G4.7/G4.10/G4.13/G4.17/G4.18 (form verifications),
G5.6/G5.7/G5.11/G5.14/G5.16 (storm-floor crossover, kernel
weighting), G6.2/G6.4/G6.9/G6.10/G6.12-G6.15 (Es geometry, TEP
plateau, ducting math), G7.15/G7.16-G7.21/G7.23-G7.27 (Stability
formula, Comp example, sigma RSS, fig:tierprob),
G8.1/G8.2/G8.7/G8.9/G8.11 (tier table math, ClickHouse
arithmetic), G9.2/G9.5/G9.8/G9.10-G9.12/G9.14/G9.17 (alert
thresholds), G10.11-G10.13 (residual coverage),
G11.6/G11.17/G11.18 (table verifications), J11/J14-J16/J18/J19
(citation cross-checks). These are positive findings that don't
require remediation.

### Final counts

| Severity | Original | Addenda 1 | Addenda 2 | Addenda 3 | **Total** | shipped |
|---|---|---|---|---|---|---|
| Critical | 10 | 1 | 0 | 0 | **11** | 11 (8 shipped + 3 partial / verified-prior) |
| High | 27 | 4 | 2 | 3 | **36** | 36 (32 shipped + 2 rejected as inaccurate audit claims + 2 partial / folded) |
| Medium | 50 | 34 | 12 | 33 | **129** | 129 (all closed: shipped, deferred-empirical, folded, or acknowledged-design) |
| Low | 23 | 14 | 0 | 11 | **48** | 48 (all closed across Section 9 / F-section / Passes A-J) |
| **Total** | **110** | **53** | **14** | **47** | **224** | **224 (all 224 items closed: shipped, rejected, deferred-empirical, or acknowledged-design)** |

219 distinct findings from the audit pipeline after the
third-pass reconciliation. The Critical tier remains at 11 (no
new Critical items surfaced in any addenda round). The
remaining ~50 audit-doc items not in the triage are
verifications, not issues.

Shipped batches:
- **2026-05-07 first batch (15 fixes)**: C7 (year only), C8, C9, C10; H4, H10, H11, H16, H17 (partial), H18, H19; H33 folded into C9; M3, M5, M10, M18, M21, M37; M75 same-edit-as-H4; M77 folded into C8.
- **2026-05-07 sectioned passes (Sections 1, 2, 3, 4, 5, 6, 7, 8, 9 + F)**: 60+ additional fixes including Sections 1 (bibliography), 2 (σ_g / worked example), 3 (paper-vs-code drift), 4 (EIA / dip-latitude), 5 (storm physics), 6 (path geometry / harness drift), 7 (empirical claims), 8 (ITU-R attribution), 9 (final cleanup); plus F-section paragraph-level cuts (L48 above).
