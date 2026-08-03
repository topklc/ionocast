# scripts/

Every script in this directory, what runs it, and when. A script with
no CI workflow and no entry here is presumed dead - delete it or
document it (that rule exists because the 2026-08-03 audit found
orphans; see `docs/AUDIT-SCRIPTS-2026-08-03.md`).

## CI-wired

| script | purpose | invoked by | cadence |
|---|---|---|---|
| `harness.mjs` | WSPR ground-truth validation harness (fetch, score, baselines; `verify` / `probe` / `snapshot` / `archive` subcommands) | daily.yml (wspr + suites), monthly.yml (giro + heavy), annually.yml (retune) | daily / monthly / annual |
| `tests.mjs` | suite dispatcher (`--list` for the full suite roster; positional suite names are rejected - use `--suite=`) | push.yml (fast), daily.yml (`--suite=all`), monthly.yml (`--suite=all --heavy`), annually.yml (`--suite=tune-r7`) | push + daily 06:00 + monthly 3rd + annual |
| `tests/*.mjs` | individual suites; run only through `tests.mjs` | (via tests.mjs) | - |
| `hepburn-compare.py` | tropo-map external-truth harness (fetch / score / sweep / suite / autotune; pure stdlib python3) | `hepburn` suite in daily.yml; `autotune` in monthly.yml (retune job); manual for calibration sweeps | daily 06:00 + monthly 3rd |
| `imo-calendar-check.mjs` | IMO meteor-shower peak-date drift check (`--apply` auto-PRs <=3-day same-month shifts) | annually.yml (imo job) | Oct 20 |
| `swpc-schema-check.mjs` | fingerprint every consumed SWPC endpoint, diff vs `data/swpc-schema.json` (`--write` refreshes) | monthly.yml (swpc job) | monthly 3rd |

## Manual / operator-run

| script | purpose | how to run |
|---|---|---|
| `calibration-rbn.mjs` | RBN-as-truth verdict calibration paths 1-4b (see `docs/VERDICT-CALIBRATION-2026-05-11.md`) | `node scripts/calibration-rbn.mjs --days=30 --path=all` |
| `qth-verdicts.mjs` | replay the runtime band table for a list of QTH grids against the deployed proxies - for "does EM87 read optimistic vs FN30" style hypothesis checks without clicking through the UI | `node scripts/qth-verdicts.mjs [GRID ...]` (`API=` overrides base URL) |
| `fetch-gim-ensemble.mjs` | build the multi-center IGS GIM ensemble JSON that `/api/gim` prefers over its live single-center walk | user-side cron: `EARTHDATA_TOKEN=… node scripts/fetch-gim-ensemble.mjs --output gim.json`, upload to storage, set the `GIM_STORAGE_URL` Pages env var (falls back to the live walk when unset) |

## Data / outputs

- `data/` - tracked fixtures: `paths.json` (reference path basket),
  `harness.baseline{,.perpath}.json` (frozen regression baselines),
  `swpc-schema.json` (endpoint fingerprints),
  `hepburn-calibration-history.jsonl` (seasonal evidence ledger, one
  verdict per monthly tropo-retune run; auto-committed by CI).
- `data/.cache/` - gitignored fetch caches (`harness.json` etc.).
- `outputs/` - gitignored run reports (`tests.report.json`,
  `harness.report.json`).

## Removed

- `fetch-cosmic-ro.mjs` (removed 2026-08-03): stage-A-only scaffold of
  the COSMIC-2 radio-occultation pipeline that always emitted an empty
  profile list. The implementation notes for the real daily job live in
  `functions/_handlers/cosmicRo.js`.
