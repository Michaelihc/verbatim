# Verbatim

Typing practice for Cambridge International AS & A Level answers that must be word-perfect:
definitions and pseudocode, worded as the official mark schemes accept them.

**Play it:** https://michaelihc.github.io/verbatim/

## What's in it

| Pack | Syllabus |
| --- | --- |
| Physics definitions | 9702 |
| Computer Science definitions | 9618 |
| Computer Science pseudocode | 9618 |

Each answer cites the mark scheme it came from (paper, session and question), plus other wordings
the mark scheme accepts and examiner notes where they matter.

## How it works

- **Three modes.** *Copy* shows the whole answer. *Gaps* hides the key words. *Recall* hides
  every word, so you type from memory (press <kbd>Tab</kbd> or tap *Show next word* for a hint).
  *Smart* mode picks the right one for each answer.
- **Mastery stages.** Each answer moves from New to Copied, Gaps filled, Recalled, Secure and
  Mastered. Recalled answers come back for review after 1, 2, 4, 9 and then 21 days.
- **Marks.** Like an exam, marks go on the finished answer. Three red-pen ticks for a perfect
  answer with no hints and few fixed mistakes, two for a correct answer (98%+), one for 90%+.
  Mistakes you fix along the way only trim a little XP.
- **XP and grades.** XP grows with answer length and mode (recall pays 2.5× copy), scaled by
  accuracy, speed and your run of clean answers. Levels climb a grade ladder from U to A*, then
  through the examiner ranks.
- **Unlocks.** Units follow syllabus order. A unit opens once you've correctly copied 60% of
  the one before it, or switch on *Unlock all units* in settings.
- **Streaks, daily goals and 20 achievements.**
- **Works offline.** A service worker caches the app and every pack on first visit. Packs refresh
  in the background, and new app versions show a reload prompt.
- **Your data stays in your browser** (localStorage). Export and import it from the Progress page.

Code packs auto-indent after <kbd>Enter</kbd> and use `<-` for the assignment arrow so it can be
typed.

## Run locally

No build step. Serve the folder with any static server:

```sh
python -m http.server 8000
# open http://localhost:8000
```

The service worker caches aggressively. While developing, tick *Bypass for network* in your
browser's DevTools (Application → Service workers).

## Add content

Packs are plain JSON files in [`packs/`](packs). Follow [CONTRIBUTING.md](CONTRIBUTING.md) to add
answers or a whole new subject, then run:

```sh
node tools/validate.mjs
```

The same check runs on every pull request.

## Deploy

Pushing to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml). It validates
the packs, stamps the service-worker cache version with the commit hash, and publishes to GitHub
Pages. Stamping the version means every deploy reaches installed copies.

## Licence and sources

The code is released under the [MIT licence](LICENSE). The fonts (Atkinson Hyperlegible,
JetBrains Mono, Caveat) are under the SIL Open Font License.

Answer wording is quoted from Cambridge International mark schemes for non-commercial revision,
with a citation on every item. Those mark schemes are © Cambridge University Press & Assessment.
This project is not affiliated with or endorsed by Cambridge. No mark-scheme documents are
included in the repository.
