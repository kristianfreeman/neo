# Evaluating the performance branches

For Hugh, or an agent working for him. Every check here runs NEO on a
throwaway library in a temp folder, so the writer's own library is never
opened. Apart from `npm run try` and the project's own `test:` scripts, the
window stays off the screen.

## Setup

```
git remote add kristian https://github.com/kristianfreeman/neo.git
git fetch kristian
git switch -c evaluate kristian/evaluate
npm install
```

`evaluate` is `main` (NEO 1.3.9) plus `bench/`, and nothing in NEO depends
on `bench/`. Each fix lives on its own branch, with no bench code in it.

## Checking one change

Merge the branch into `evaluate` locally, then run its checks. The checkers
run `main` and the checkout side by side and compare them.

```
git merge --no-edit kristian/<branch>
npm run restyle-check   # elements restyled when a paragraph is added, main vs this checkout
npm run style-check     # every paragraph's computed style, main vs this checkout, through 13 edits
npm run undo-check      # the page after every step of six break-and-undo flows, main vs this checkout
npm run try             # main and this checkout side by side, with the same 100k-word manuscript, to feel it
git reset --hard kristian/evaluate   # back to the start, for the next branch
```

For timings, take `main`'s numbers first in the same sitting, since absolute
times shift with whatever else the machine is doing:

```
npm run bench -- --json before.json          # on evaluate, before the merge
git merge --no-edit kristian/<branch>
npm run bench -- --compare before.json
```

## The branches

| Branch | What it changes | Run | Expect (M4 Max, NEO 1.3.9) |
|---|---|---|---|
| `perf/enter-restyle` | Four `p + p` selectors in `styles.css` become `p:not(:first-child)` | `npm run restyle-check`, `npm run style-check` | 14,016 → 15 elements restyled, about 8 → 0.7 ms; every computed style the same |
| `perf/paragraph-word-counts` | Each paragraph keeps its word count until it changes | `npm run test:words`, `npm run bench -- --only typing` | 18 tests pass, including 1,000 random edits; a keystroke in a 100k-word chapter about 12 → 4 ms |
| `fix/caret-in-view` | A new chapter, or one Backspaced away, keeps the line where it was; a scene break keeps the caret in sight | `npm run test:caret` | 5 tests pass (all 5 fail on `main`) |
| `perf/scene-break` | Scene breaks no longer call `resetNativeUndo` | `npm run undo-check`, `npm run bench -- --only enter` | every undo flow the same; a scene break in a 100k-word chapter about 70 → 22 ms |
| `perf/style-recalc` | Stacked on `perf/enter-restyle`: the line after `***` is marked `data-after-break` instead of matched by `p.scene-break + p` | `npm run style-check` | every computed style the same |
| `perf/all` | All of the above together | all of the above, and `npm run try` | |

`npm run test:words` and `npm run test:caret` show NEO's window while they
run, as the project's other end-to-end tests do.
