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
  then *Train*. Filter by AS or A2, switch between a list and a grid, start a random mix of the
  pack, or search for any term ("tesla", "flux", "stack") and start there.
- **Train** shows the answer and you type it. (Practice mode, which hides words for you to fill
  in from memory, is switched off for now: `PRACTICE_ENABLED` in `js/game.js`.)
- **Honest speed.** WPM is net: only correct characters you typed count, not ones filled in for
  you, and it is the same while you type and at the end. Gaps over 2 seconds between keys count
  as pauses, shown separately, not typing time. Answers under 40 characters are marked as a rough
  speed; the session speed at the top of the screen adds up every answer and is steadier.
- **Your usual speed** is the median of your last 40 answers of 40+ characters. It is the bar for
  Fluent, so the target fits your own pace.
- **Endless laps.** A session goes round every answer in the chapter, then starts another lap with
  the ones you slipped on first, then the answers with the most of your weak letter pairs and
  words. It never ends until you leave.
- **Weak spots.** Verbatim keeps a running average of how fast and how accurately you type each
  key (Shift counts as its own key), letter pair and word, judged against your own medians. After
  an answer, press *D* to type the words you slipped on or typed slowly, three times each. The
  *Weak spots drill* builds rounds of real words from the subject you last trained around your
  slowest pairs, keys and words, and rebuilds them as you improve.
- **Ratings, not marks.** Each answer gets *Perfect*, *Great*, *Good* or *Keep going*, with XP that
  counts up, a sound that climbs in pitch with your combo, and confetti for the best ones. Clean
  answers roll straight into the next one.
- **Explain questions.** Most physics and computer science chapters also have explain and state
  questions taken from past papers (105 so far, with the exam's own wording and mark-scheme
  points). They're listed in their own group, and each group can be trained on its own, so
  chapter lists stay short.
- **Mark points.** In physics and computer science definitions, the phrases the mark scheme
  gives marks for are underlined, and each one lights up with a +1 as you type it correctly.
  Points you miss are flagged when you finish. Taken from the cited mark schemes; where a
  question allows "1 mark per point, max N", every point is shown. Switch it off in settings.
- **Combo.** Every Great or Perfect in a row adds ×0.1 to your XP multiplier, up to ×3. A rough
  answer breaks it.
- **Bonus drops.** Now and then an answer pays double, or (rarely) five times.
- **Fluency and speed checks.** Answers move from New to Typed, Accurate (98% of keys right,
  nothing left wrong), Fluent (accurate at or above your usual speed) and Automatic (fluent on
  three separate days, each after a gap). Fluent answers come back as a *Speed check* after 1, 3,
  7, 14, 30 and 60 days; a check with slips steps the answer back and asks again the next day.
- **Two bars per chapter.** *Practice* (yellow) fills as you finish answers in the chapter, so
  one full lap fills it, and it drains by a seventh for each day you don't practise that chapter.
  *Fluency* (blue) grows as answers move up from Typed to Automatic.
- **Stats dashboard.** Filter by time range and subject, then see headline numbers against the
  previous period, your usual speed, daily XP against your goal, speed and accuracy trends, a
  keyboard heatmap of the keys that hold you back, your slowest letter pairs and the words you
  trip on, how your answers split across fluency stages and ratings, the most-examined answers
  that aren't automatic yet, and every chapter's practice, fluency and exam frequency. Every chart
  has a table view.
- **Levels, streaks, a daily goal and achievements.**
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
