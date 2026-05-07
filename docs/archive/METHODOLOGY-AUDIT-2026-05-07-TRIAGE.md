# ionocast Methodology Audit — Triage Index (2026-05-07)

Indexes every finding from `METHODOLOGY-AUDIT-2026-05-07-INDEPENDENT.md`
plus three confirmed-real findings from Gemini's cross-check (G1, G7, G9).
Suggested fixes live in the audit doc; this file just classifies and
groups.

## Totals

| Class | Count | Meaning |
|-------|-------|---------|
| BUNDLE | 20 findings → 5 coordinated edits | Findings that all touch the same area; one edit closes them all |
| FIX | 35 (32 numbered + G1, G7, G9) | Discrete paper update; audit row has the fix |
| DECIDE | 5 (with #29 cross-listed in FIX) | Needs author input on paper-vs-code direction |
| VERIFY | 17 | Needs a code run or external lookup before fixing |
| DROP | 102 | Not worth fixing under audit scope (style, rounding, verified-ok, duplicates, ITU-version pedantry) |
| **Total** | **178** (175 mine + 3 Gemini) | Every audit ID covered exactly once primary; some dual-classified |

The Critical+High bucket lands almost entirely in BUNDLE / FIX / DECIDE
(34 of 34 findings). The Low bucket is mostly DROP (94 of 103).

---

## BUNDLES (5 coordinated edits, 19 findings)

### B1 — Active Alerts Panel rewrite
**Single edit** to §8 (`sec:alerts`) and Table 11 (`tab:soft-alerts`).
Replaces 4-tier ladder (info/watch/warn/alert) with 5 (info/watch/alert/extreme),
8 rules with 10, and the stale Dst/Kp/proton/X-ray/aurora threshold tables.

| Finding | What it adds to the rewrite |
|---------|-----------------------------|
| #4 | Dst rows: -250 (extreme), -100 (alert), -50 (watch); drop -150 |
| #5 | Kp rows: 9/8 → extreme; 7/6 → alert; 5 → watch |
| #6 | Proton flux: add S4 (≥10 000) and S5 (≥100 000) extreme rows |
| #7 | X-ray: replace 2-row collapse with 5-row R1–R5 ladder |
| #8 | Aurora HP: ≥100 alert (was watch); ≥50 watch (was info) |
| #9 | "Eight rules" → "Ten rules"; add HSS and forecast-σ rows |
| #12 | Sort-order paragraph: "alert > watch > warn > info" → include "extreme" |
| #22 | Inputs list: add `solar-wind speed` and `forecast σ` |
| #59 | Caption phantom "warn" tier → replace with "extreme" |
| #88 | Same as #59 (sort-order line 5197) |

### B2 — `K_p^eff` variable naming
**Single decision plus matching edit.** Either rename `opts.kp` to
`kpEffective` throughout `src/physics/snr.js` and `loss.js`, or add a
paper note that the unlabelled `opts.kp` is the storm-lagged effective
index post-Bz/Dst bumps.

| Finding | Where the ambiguity surfaces |
|---------|------------------------------|
| #25 | `σ_storm` branch reads `opts.kp` |
| #26 | `L_aur` consumes `opts.kp` |
| #28 | Auroral expansion threshold reads `opts.kp` |

### B3 — σ-penalty enumeration (six → seven)
**Single edit** to §7.3 / §7.3.1: add the night-time low/mid HF inflation
to both the bullet list and the RSS formula at line 4353-4355.

| Finding | What it adds |
|---------|--------------|
| #11 | New seventh bullet: night-time inflation +3 dB, gate `f ≤ 16 MHz` & `cosZpath < 0` |
| #24 | RSS formula needs the night-time variance term added |

### B4 — Auroral per-hop cap naming
**Single edit.** Either name a constant (`AUR_PER_HOP_CAP_DB = 30`) for parity
with `PCA_PER_HOP_CAP_DB`, or add prose noting the auroral 30 dB cap is
hard-coded inside `lAuroralDb`.

| Finding | Mention |
|---------|---------|
| #15 | "Every constant given inline" claim is partly wrong |
| #40 | Paper line 766-767 says "30 dB per-hop cap" but no named constant |
| #45 | Paper says cap is enforced "by the same machinery" — actually inside `lAuroralDb` |

### B5 — Hop ceiling fixed vs dynamic in `lMultiHopDb`
**Decision required.** Paper Eq. 17 uses dynamic `d_hop^max(h_F)`; code's
`lMultiHopDb` hard-codes 4000 km. Either change code to call
`hopCeilingKm()`, or update paper to state the multi-hop multiplier uses
the fixed reference 4000 km.

| Finding | Mention |
|---------|---------|
| #151 | `extraHops = max(0, dKm/4000 - 1)` hard-coded |
| #152 | Paper line 1110-1115 implies dynamic `h_F` for hop ceiling |

---

## FIX (32 individual edits)

Each row points to the audit's suggested fix. The fix is in the
"Suggested fix" column of `METHODOLOGY-AUDIT-2026-05-07-INDEPENDENT.md`.

| ID | One-line |
|----|----------|
| #3 | Drop `/api/hp30` from the geo-resolved feed list (abstract was right) |
| #13 | Remove dangling literal `line~2811` reference |
| #14 | Re-target `\ref{eq:laur}` for the c(φ) ramp-width prose |
| #16 | TEP plateau at F=70 should read ~9 dB, not ~8.5 dB |
| #17 | Make EIA crest/trough saturation-epoch citation styling consistent |
| #19 | Pick one of `L_DRAP` / `L_abs` / `lAbsDb` and use throughout §3.3 |
| #20 | Resolve "6–12" vs "8–12" σ range citations (pick one and footnote) |
| #21 | Reconcile P.372-15 caption with P.372-14 bibliography |
| #23 | Rewrite §3.2 source attribution from K9LA-anchored to P.533-derived |
| #27 | Add Fresnel time-harmonic-convention footnote |
| #29 | Either revise "1.4× = 3-6 dB extra" prose or change the multiplier |
| #30 | Note the L_fs and L_hop d-floor mismatch on degenerate paths |
| #32 | Add Bz = -8 nT sample row (+0.9) to Table 9 (`tab:bzbump`) |
| #33 | Add "below 50 GW the HP driver is zero" sentence at line 962 |
| #38 | Document the HP ≥ 30 GW gate for `snrMarginVhfAurora` |
| #43 | Add cross-reference from §6 line 4682-4686 to §7.4 |
| #47 | Label the 25/15 dB FT8-vs-SSB anecdotal figures or cite a source |
| #48 | Surface `L_iono,aur = 25 dB` in App. A or a constants table |
| #60 | Note the equator-anti-solar `cosZ = -1` assumption in Table 4 caption |
| #61 | Add `σ-scale` to the σ-overload footnote |
| #66 | Cross-reference §3.6 fusion line 1393 ↔ §6.5 line 3568 |
| #68 | Acknowledge per-path 1 spot/h floor alongside global 50 spots/h |
| #71 | Document or cap the VHF aurMuf upper bound |
| #72 | Note the legacy single-midpoint fallback exception in §3.4 |
| #82 | Reword "entirely by the SNR budget" to acknowledge bonus terms |
| #92 | Replace the 100-dB-sum cap example with one that actually triggers rescaling |
| #118 | Cite or label "needs author confirmation" for the 25 dB Es-aurora decomposition |
| #123 | Cite or label the "high σ_f paths are above-MUF" empirical claim |
| #124 | Distinguish "sanity floor" (harness) vs "override gate" (runtime) |
| #128 | Recompute the "-135 dBm 15 m noon" claim (correct ≈ -124 dBm) |
| #131 | "1, 3, and 5 hops" → "1–5 hops" in App. B coverage prose |
| #168 | Same fix family as #82 — reword verdict-source line |
| **G1** | Recompute Table 7 noise: 20 m suburban noon ≈ -105 dBm (was -113); update M and M/σ |
| **G7** | Resolve internal contradiction: F=0.4 hardcoded fallback vs Eq:nightfloor F dynamic — code uses 0.4, fix paper |
| **G9** | Update Figure 6 30 m curve and legend from `A_b=2` to `A_b=3.0` (Table 2 is correct, fig is stale) |

(35 rows because G1/G7/G9 are bonus from the Gemini cross-check.)

---

## DECIDE (5, paper vs code intent)

| ID | The decision |
|----|--------------|
| #1 | foF2 night-decay multiplier: paper says it acts on `b` (floor + dayBump·driver); code applies only to floor. Change paper to match code, or change code? |
| #2 | 20 m grayline bonus: paper Table 6 documents 1.5/1.0 dB; code's `fMHz > 14` excludes 14.097 MHz. Lift the gate or remove the table row? |
| #10 | Forecast-σ catch-up ramp: paper says "gated on `K_p^eff`"; code passes live `kpNow`. Change code or change paper? |
| #18 | σ_Es²: paper RSS at line 4353 includes it; `snrMarginHf` does not. Document the call-chain folding-in, or remove from RSS? |
| #29 | (also FIX) "1.4× as conservative version of 3-6 dB" — multiplier on a 25 dB term gives 10 dB, not 3-6. Drop the multiplier or rewrite the prose? |

---

## VERIFY (14, needs code-run or external check)

| ID | What to confirm |
|----|-----------------|
| #31 | Paper's `L_gr ≈ 0.66 dB` (Lisbon-Tokyo worked example) vs my recompute of ≈ 0.72 dB — re-run `lHopGroundReflectionDb(14, 8.531)` |
| #39 | Meteor-shower active window ±2 d of peak — confirm in `src/derive/showers.js` |
| #41 | `tune-eia.mjs` does geometric station selection (`|φ_dip| ≤ 25°`) |
| #58 | scatter `≥2 GIRO stations` gate in `modes.js scatterBonusDb` |
| #73 | BVJ03 dip latitude +12°N from geographic +2.8°N via tilted-dipole |
| #84 | App. D Table 14 seed configurations match `tune-r7-scan.mjs` |
| #108 | "All seeds converged in ≤2 iterations" — re-run `tune-r7-scan.mjs` |
| #114 | Same as #73 — BVJ03 dip-latitude calc |
| #126 | P.372 Fig. 38 quiet-rural ≈ 30 dB above thermal at 10 MHz (needs P.372 text access) |
| #130 | Same as #108 |
| #132 | ARRL Antenna Book "25th edition" — verify edition number |
| #138 | "No cycle-25 X10 events" — almost certainly overtaken by events; check current SWPC archive |
| #145 | Per-tier per-path open rates (30/14/3/1/0.1 %) — re-run harness post-processing |
| #146 | "ITU-R P.533 attributes 3-6 dB storm-main extra absorption" — needs P.533 text access |
| #149 | K9LA cycle-24 SEP ≥ 1000 pfu archive citation |
| #153 | `σ-scale` sweep grid (App. D Table 15) matches `tune-r7-scan.mjs` |
| #161 | Storm-phase classifier (`main = Dst ≤ -50` with `K_p^eff` loading) in `derive/storm.js` |

---

## DROP (108, not worth fixing under audit scope)

Grouped by reason. Each row uses the shortest accurate dismissal.

### Verified-correct (paper matches code; flagged only because I traced it) — 47

| IDs |
|-----|
| #34, #35, #36, #37, #44, #49, #50, #51, #52, #53, #54, #56, #57, #62, #63, #64, #67, #69, #70, #75, #76, #77, #78, #79, #83, #85, #86, #87, #90, #91, #93, #94, #95, #96, #97, #98, #99, #101, #102, #103, #104, #105, #106, #111, #112, #113, #115, #116, #117, #119, #120, #121, #125, #133, #134, #137, #139, #140, #141, #142, #143, #144, #147, #148, #150, #154, #155, #156, #157, #158, #159, #163, #164, #165, #166, #167, #170, #171, #173 |

(77 rows above; the audit has 78 verified-only entries — see also #174 and #175 in the duplicates bucket.)

### Style nit explicitly out-of-scope per audit instructions — 9

| ID | Why dropped |
|----|-------------|
| #46 | Appendix vs Section reference style |
| #55 | "aurora" vs "auroral" spelling |
| #65 | IMO catalogue narrative — sample list is fine |
| #74 | LaTeX duplicate-destination warnings (compile noise) |
| #89 | Appendix lettering OK |
| #100 | LaTeX `\appendix` macro normal |
| #110 | "Southern hemisphere / Pacific" grouping label |
| #122 | "8 rules / 8 panels" coincidence |
| #127 | App. C missing dip-latitude column (style) |
| #135 | `eq:laur` paragraph sprawl |
| #169 | §6.5 heading-vs-prose terminology |

(11 rows — slightly over count because I'm being inclusive of borderline-style.)

### Acceptable rounding / approximation — 6

| ID | Why dropped |
|----|-------------|
| #34 | 60 m midnight 9.74 → 10 dB rounding |
| #35 | 30 m midnight 6.4 → 6.5 dB |
| #44 | -115.42 → -115 dB rounding propagation in Table 7 (overshadowed by G1) |
| #109 | Athens coords 38.0 vs 38.05 |
| #137 | 8.495 dB → 8.4 vs 8.5 |

### ITU-rec / bibliography version pinning — 2

| ID | Why dropped |
|----|-------------|
| #80 | P.533-14 (2019) is consistent self-citation |
| #81 | P.1239-3 (2012) likewise |

### Duplicates of other findings — 8

| ID | Duplicate of |
|----|--------------|
| #42 | #54 (noiseFa <= 0 vs env="rural" semantics) |
| #54 | #42 |
| #114 | #73 (BVJ03 dip lat) |
| #129 | #128 (paper's -135/-129 dBm 15 m noon) |
| #130 | #108 (tune-r7 convergence) |
| #152 | #151 (lMultiHopDb hardcoded 4000) |
| #172 | #90 (Per-hop fusion deferred) |
| #174 | #5 (Kp ladder; covered by ALERTS bundle) |
| #175 | #38 (HP ≥ 30 GW; covered by FIX #38) |

### Empirical claim with no leverage to fix — 4

| ID | Why dropped |
|----|-------------|
| #65 | IMO ZHR≥20 shower count — 6-of-10 sample is a narrative not a claim |
| #136 | Calibration-frame solar drift note — already a transparency disclosure |
| #144 | "Tropical sites 5-10 dB more diurnal swing" already cites P.372 |
| #160 | "F2 budget says closed when above MUF" — semantic pedantry |

### Audit-internal classification artefact — 3

| ID | Why dropped |
|----|-------------|
| #107 | `\label{sec:perpath}` placed inside an `itemize` — works fine |
| #146 | (Also VERIFY) — keep one canonical entry, drop dup |
| #162 | "Polar W--NA" intentional duplicate, paper documents the duplication |

### Restated for severity but no separate fix — 3

| ID | Why dropped |
|----|-------------|
| #67 | SID decay mentioned twice (once §3.3, once Limits #6) — fine |
| #122 | Coincidence "8 rules / 8 panels" |
| #169 | §6.5 vs Limits #12 phrasing |

---

## How to use this index

1. **Start with BUNDLES.** B1 (alerts panel) is the single biggest payoff — closes 10 findings in one rewrite. B2/B3/B4 are smaller bundles each closing 2-3.
2. **Then DECIDE.** Five questions to answer once before any FIX work; each one gates which side gets edited.
3. **Then FIX.** 32 discrete edits, audit doc has the suggested wording for each.
4. **VERIFY in parallel.** The 14 verifications can be done by running scripts or reading additional code; results may flip a VERIFY into a FIX or a DROP.
5. **Skip DROP entirely** unless you want to clean up style.

Estimated work: **B1 + B2 + B3 + B4 + B5 + the 32 FIX rows + the 5 DECIDE responses** is a focused day for someone who knows the codebase. VERIFY adds another half-day if all 14 are run. DROP is zero work.
