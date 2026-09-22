---
name: epc-platform
description: Working rules for this EPC platform repo — use when adding a discipline module, an extraction pass, an engine check, or anything that claims an accuracy number. Covers the extract/decide/sign split, the eval gate, and how a change is proven here.
---

# Working rules for this repository

These are not style preferences. Each one was paid for: ten engine findings,
three of which only a real project drawing exposed.

## The governing split

**The model extracts raw data. A deterministic engine decides. A human signs.**

A model never determines whether a weld is Field or Shop, what NDT applies,
or how long a cut piece is. It reads what is printed. `lib/engine.js` and the
standards modules decide. An engineer approves, and approval locks the
register against a hash — a correction is a new revision, never an edit.

If a change would have the model decide something, it is the wrong change.

## Proving a change

1. **A test that cannot fail is worse than no test.** After writing one,
   revert the fix and confirm it fails, then restore. Every guard in this
   repo has been checked that way.
2. **Compiling is not working.** `next build` passing has repeatedly meant
   nothing: the PGlite/webpack fault, the pdf.js render fault and the canvas
   fault all compiled cleanly. Drive the real app in a browser.
3. **Measure, do not assume.** Layout, resolution and payload claims get
   measured in the page — the "overlapping" legend was six pixels apart, and
   the tile resolution question was answered by reading JPEG headers off the
   real request.
4. **A check fed bad input must not return a verdict.** Silence beats false
   assurance; see F-10.

## Adding a discipline module

Declare it in `lib/platform/modules.mjs`. Do not invent stages — use
`lib/platform/workflow.mjs`, which every discipline shares so that reporting
can cross them. A module that names its own stages is the "ten tools that
never join" failure.

Two things differ per discipline and nothing else should: the **extraction
schema** and the **engineering rules** its deterministic engine answers to.

`actions` in the registry holds action KEYS; transitions hold action VALUES,
because those go straight to `can()`. `can()` takes a membership object, not
a role string — passing a string denies everything, silently.

## Accuracy claims

Engine accuracy and extraction accuracy are different claims. Never let one
stand in for the other.

- Engine: `npm run eval` — golden cases plus rule cases.
- Extraction: `npm run extraction:report -- <dir>` measures CONSISTENCY
  against the drawing's own printed values. It is a floor on the error rate,
  not a ceiling.
- Field/Shop correctness comes only from a contractor's register, via the
  حقیقت مرجع tab.

An `expect` block is written from the contractor's register, never from this
engine's output — otherwise every future run agrees with today's bugs.

## Before committing

`npm run db:test` · `npm run eval:check` · `npm run build`.
A new engine gap gets its eval case **before** the fix, then
`npm run eval:update`, then a row in `docs/epc-llm/04-engine-findings.md`.
