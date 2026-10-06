# bench

To check the performance branches one by one, see [EVALUATING.md](EVALUATING.md).

Tools for measuring how NEO feels to type in. Nothing in NEO depends on this
folder: deleting it and the `bench` and `try` scripts in `package.json`
removes it. Both run NEO on a throwaway library in a temp folder; your own
library is never opened.

## Feel it: `npm run try`

Two windows side by side, each with the same 100,000-word manuscript open in
one chapter, the caret in the middle:

- **Before** (orange panel): this checkout with `app.js` from `main`.
- **After** (green panel): this checkout as it is.

The panel in each window's corner shows, for the last 60 keys:

- **NEO's work per keystroke**: from the first `input` listener to the last.
  This is what a change to NEO's code moves.
- **Key to screen**: from `keydown` to just after the next frame. This is closer
  to what a writer feels, and includes the browser's own layout and paint.
- **Frames over 50 ms**: frames long enough to see as a stutter.

The first line under the title says whether that window's code has the
paragraph counts, so you can see which code each window is running.

Both run on your machine as it is. `--base <ref>` compares against a commit
other than `main`. ⌥⌘R clears a panel's numbers.

## Numbers: `npm run bench`

Every scenario, printed as a table, measured on your machine as it is.
`--only typing` runs some of them, `--json out.json` keeps the numbers, and
`--compare out.json` shows before, now and the change.
