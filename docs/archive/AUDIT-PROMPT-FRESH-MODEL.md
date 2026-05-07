# Fresh-model methodology audit prompt

A prompt for a **fresh agent / model session with no prior context** on
ionocast. Use it to obtain an independent second-opinion audit of
`paper/ionocast-methodology.tex` against the codebase.

The prompt below is self-contained — paste it into a new session
(Claude, GPT, Gemini, or any agent runtime with file-read + bash
tools). Do not include the previous audit, triage, or this paragraph.

---

## Prompt to paste into the fresh session

You are auditing a real-time HF/VHF propagation prediction model called
**ionocast**. The audit target is the methodology paper at
`paper/ionocast-methodology.tex` (~6200 lines, 72 PDF pages) compared
against the codebase under `src/`, `scripts/harness.mjs`, and
`functions/`. The repo is `https://github.com/topklc/ionocast`.

Your job is to find **technical errors**: factual mistakes, internal
contradictions, unsupported claims, broken cross-references, math
errors, citation inaccuracies, and paper-vs-code drift. You are
operating with **no prior context** — assume nothing has been
reviewed before. A previous audit exists at
`docs/METHODOLOGY-AUDIT-2026-05-06.md` and a triage at
`docs/METHODOLOGY-AUDIT-TRIAGE-2026-05-06.md`; **do not read either
file**. The point of this audit is independent priors. If you have
already seen them, flag that and stop.

### Authority and source-of-truth rule

The **repository is the source of truth** for what the model actually
does. When the paper and the code disagree, that is documentation
drift — flag it as an error, with the code as the authoritative
reference. Do not assume the paper is correct because it's the paper.

### Methodology

Work through the following passes systematically. Do not skip ahead
even if a pass feels redundant; the value of this audit is coverage,
not speed.

1. **Compile sanity.** Run `pdflatex -interaction=nonstopmode
   -halt-on-error paper/ionocast-methodology.tex` twice. Record:
   - any `! ` errors (compile failures)
   - any `Reference ... undefined` warnings
   - any `Citation ... undefined` warnings
   - any `\ref{}` to a label that doesn't exist
   - the final page count

2. **End-to-end read.** Read the entire paper. Note any sentence
   where the math, the cited code path, or the surrounding logic
   looks off. Don't try to verify yet — just bookmark for pass 3.

3. **Numerical-claim verification.** For every numerical constant,
   threshold, or table value the paper cites against a code path
   (`src/constants.js`, `src/physics/*.js`, `scripts/harness.mjs`),
   read the code and confirm the value matches. Flag every drift,
   even by 0.5 dB or one decimal. Common drift patterns to watch
   for: per-band σ tables, SNR thresholds, proton flux thresholds,
   storm-lag parameters, antenna gain defaults, MUF / foF2
   constants, calibration weights (L_iono, D, w_sc, etc.).

4. **Cross-reference verification.** For every `\ref{}` and `\cite{}`
   in the paper, verify the target exists and the surrounding prose
   accurately describes it. Sample at least 30 references end-to-end.

5. **Worked-example recomputation.** Find every worked example
   (`\paragraph{Worked Example...}`, numerical tables with row sums,
   "the standardised margin is X / Y = Z" claims). Recompute every
   arithmetic step. Report any discrepancy at all, including rounding
   differences greater than the paper's own claimed precision.

6. **Internal-contradiction sweep.** Look for places where two
   sections of the paper make incompatible claims about the same
   variable, table, or behaviour. Common pattern: a Limits-section
   item that contradicts the body section it summarises.

7. **Citation accuracy.** Where the paper attributes a result to a
   specific reference (Sauer-Wilkinson, Sonntag 1990, ITU-R P.533,
   Mitra 1974, K9LA, etc.), check the bibliography entry resolves
   to a real source and the claim it's attributed to is something
   that source actually says. Flag any citation that looks like
   citation-laundering (a hand-chosen value with a plausible-sounding
   reference attached after the fact).

8. **Paper-vs-code claim spot-check.** Pick 15 specific claims the
   paper makes about ionocast's runtime behaviour ("the model does X
   when Y", "production uses Z"). For each, find and read the actual
   code path. Report any where the paper's behavioural description
   does not match the code.

9. **Math correctness.** For each non-trivial equation, check the
   dimensions / units balance, check that named variables are defined
   somewhere, and that any limit / boundary case the surrounding
   prose claims (e.g. "saturates at +85% at F10.7A ≥ 120") actually
   falls out of the equation as stated.

10. **Coverage gaps.** Look for places where the paper makes a
    measurement or empirical claim with no evidence trail (no
    citation, no code reference, no harness output). Flag these as
    "unsupported empirical claim" — they may be deferred-empirical
    work tracked elsewhere, or they may be informed-estimate values
    quietly elevated to fact.

### Out of scope

Do **not** report on:
- Prose style preferences (sentence length, paragraph breaks, em vs
  en dashes, formality)
- Section ordering or whether the paper "should" cover something it
  doesn't
- Whether the model itself is the right design (you are auditing the
  description, not the model)
- LaTeX formatting issues that don't affect compile or readability
  (underfull / overfull boxes are noise)
- Anything you cannot verify against the code or a checkable source.
  If you have a hunch a value is wrong but cannot prove it, flag it
  as "needs author confirmation" with your specific concern; do not
  promote hunches to findings.

### Severity classification

- **Critical:** the paper is wrong in a way that misrepresents what
  the shipped model does, or contains math / numerical errors a
  reader would propagate. Examples: a stated constant that
  contradicts the code, a worked-example arithmetic error, an
  equation whose claimed limit doesn't hold.

- **High:** the paper is internally inconsistent or makes a load-
  bearing claim without evidence. Examples: two sections quoting
  different values for the same variable; a citation that doesn't
  support what's attributed to it.

- **Medium:** the paper is technically defensible but a reader would
  reasonably question. Examples: an empirical value with no
  evidence trail; a cross-reference that resolves but to the wrong
  target; ambiguous wording around a numerical claim.

- **Low:** minor accuracy / disambiguation improvements. Examples:
  a date off by a year, a station name spelled inconsistently,
  a label resolved correctly but used in a confusing context.

### Output format

Produce a markdown table:

```
| ID | Severity | Finding | Paper line(s) | Evidence | Suggested fix |
|----|----------|---------|---------------|----------|---------------|
| 1  | Critical | ... | line 1234 | `src/constants.js:42` shows X, paper says Y | Update paper to X |
```

Then a short summary section:
- Total findings by severity
- Three highest-priority items (your read, with a sentence each)
- Anything you flagged as "needs author confirmation"
- Any pass you could not complete and why (e.g. compile failed, code
  path unreadable, citation not accessible)

### Calibration

The previous audit pipeline (which you are not reading) found 224
items across 11 Critical, 36 High, 129 Medium, 48 Low. A fresh audit
at the same depth should land in roughly the same order of magnitude.
If you find dramatically fewer (under 50) or dramatically more (over
500), interrogate your own methodology — you are likely either
skimming or chasing style nits. Aim for ~150–250 findings; quality
of evidence matters more than count.

Take as long as you need. Compile, read, verify, report. Do not ask
the author questions during the audit — produce the finding table
and let them respond.
