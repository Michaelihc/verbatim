# Verbatim

Typing practice for Cambridge International AS & A Level answers that must be word-perfect:
definitions, physics equations and pseudocode, worded as the official mark schemes accept them.

**Play it:** https://michaelihc.github.io/verbatim/

## What's in it

| Pack | Syllabus |
| --- | --- |
| Physics definitions | 9702 |
| Physics equations (word equations, with the symbol form) | 9702 |
| Computer Science definitions | 9618 |
| Computer Science pseudocode | 9618 |

Each definition cites the mark scheme it came from (paper, session and question), plus other
wordings the mark scheme accepts and examiner notes where they matter. Each equation cites its
syllabus topic and is tagged when it's printed on the data and formulae list.

## How it works

- **Jump straight in.** The home page is the chapter list: pick a subject, a pack and a chapter,
  then *Train* or *Practice*. Or search for any term ("tesla", "flux", "stack") and start there.
- **Train** shows the answer and you type it. **Practice** hides words (some, most, or all of
  them) and you fill them in. The two are separate: you can train for as long as you like, and
  switch modes at any time from the top of the screen.
- **Endless laps.** A session goes round every answer in the chapter, then starts another lap with
  the ones you slipped on first. It never ends until you leave.
- **Ratings, not marks.** Each answer gets *Perfect*, *Great*, *Good* or *Keep going*, with XP that
  counts up, a sound that climbs in pitch with your combo, and confetti for the best ones. Clean
  answers roll straight into the next one.
- **Explain questions.** Most physics chapters also have explain and state questions taken from
  past papers (50 so far, with the exam's own wording and mark-scheme points). They're listed in
  their own group, and each group can be trained on its own, so chapter lists stay short.
- **Mark points.** In physics and computer science definitions, the phrases the mark scheme
  gives marks for are underlined, and each one lights up with a +1 as you type it correctly.
  Points you miss are flagged when you finish. Taken from the cited mark schemes; where a
  question allows "1 mark per point, max N", every point is shown. Switch it off in settings.
- **Combo.** Every Great or Perfect in a row adds ×0.1 to your XP multiplier, up to ×3. A rough
  answer breaks it.
- **Bonus drops.** Now and then an answer pays double, or (rarely) five times.
- **Mastery and reviews.** Answers move from New to Trained, Gaps, Recalled, Secure and Mastered.
  Answers recalled from memory come back for spaced review after 4, 9 and then 21 days.
- **Two bars per chapter.** *Practice* (yellow) fills as you finish answers in the chapter, so
  one full lap fills it, and it drains by a seventh for each day you don't practise that chapter.
  *Mastery* (blue) grows as answers move up from Trained to Mastered and doesn't fade.
- **Levels, streaks, a daily goal and 25 achievements.**
- **Works offline.** A service worker caches the app and every pack on first visit. Packs refresh
  in the background, and new app versions show a reload prompt.
- **Your data stays in your browser** (localStorage). Export and import it from the Stats page.

### Why it's built this way

The reward loop borrows from research on what keeps people engaged, pointed at revision:
immediate, graded feedback on every answer; a combo that makes the next answer feel worth more
(and stings a little to lose); occasional unpredictable bonus rewards, which hold interest far
longer than fixed ones; no forced stopping point between answers; and progress bars towards near
goals (the lap, the daily goal, the next level), which make people speed up as they get close.

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
JetBrains Mono, Anybody) are under the SIL Open Font License.

Definition wording is quoted from Cambridge International mark schemes for non-commercial
revision, with a citation on every item. Equations follow the 9702 syllabus and data and
formulae list. Those mark schemes are © Cambridge University Press & Assessment.
This project is not affiliated with or endorsed by Cambridge. No mark-scheme documents are
included in the repository.
