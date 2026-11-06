# Verbatim: instructions for AI agents

Verbatim (https://michaelihc.github.io/verbatim/) is a typing trainer for Cambridge International
AS & A Level definitions. Its users' progress lives only in their own browser. If a user asked you
to analyse their Verbatim typing data, give feedback or set exercises, follow this guide.

## 1. Get the data

The data is in the user's browser, not on the server. **Do not fetch the snapshot URL**: a fetch
gets an empty page with no data. **Open it in the user's default browser**, as if they clicked a
link. The page then saves a snapshot file to their Downloads folder, like any other download.

| System | Command |
|---|---|
| Windows | `start "" "https://michaelihc.github.io/verbatim/#/snapshot"` |
| macOS | `open "https://michaelihc.github.io/verbatim/#/snapshot"` |
| Linux | `xdg-open "https://michaelihc.github.io/verbatim/#/snapshot"` |

Add `?full=1` (`…/#/snapshot?full=1`) for the full version: every answer in the history (up to
600), the whole skill model and every daily record. The default is enough for most analysis.

Then wait about five seconds and read the newest `verbatim-snapshot-*.json` in Downloads
(Windows `%USERPROFILE%\Downloads`, macOS and Linux `~/Downloads`). Check its `createdAt` is from
the last minute, so you are not reading an old one.

If no new file appears:

- The default browser may not be the one the user practises in, or the browser may be asking
  where to save the file or whether to allow downloads. Ask the user to check the browser.
- An installed copy of Verbatim may be waiting on its update. Ask the user to open Verbatim and
  click Reload on the update prompt, then try again.
- As a fallback, the user can click **Snapshot** on the Stats page themselves, or attach the file.

If you are a chat without access to the user's computer, ask them to open the link above and
attach the downloaded file.

## 2. What the snapshot holds

`format` is `verbatim-snapshot/1`. Times are ISO 8601. WPM is words (5 characters) per minute.

- `profile`: `usualWpm` (median net WPM of the last 40 answers of 40+ characters; the user's
  normal pace, null until five such answers), totals, active days, typing settings in use.
- `speed`: average net WPM and key accuracy over the last 7 and 30 days, and `weekly` averages.
  Speeds are net: only correct characters the user typed count, over typing time with gaps
  between keys capped at 2 seconds.
- `speedTests`: timed tests (15–120 s) on varied text: `wpm` (net), `rawWpm` (every key pressed),
  `accuracy` (share of keys right), `consistency` (0–100, how steady speed was second to second),
  `text` (`answers`, `terms`, `custom`, `chapter`). These are the fairest measure of general skill.
- `weakSpots`: the keys, letter pairs and words holding the user back, worst first. `ms` is the
  running time for that key or transition, `vsMedian` is that time divided by the user's median
  (1.5 means half again slower), `errorRate` is the running share of first presses that were wrong,
  `samples` is how many presses it is based on. Running values lean on recent typing. `shift`
  is the Shift key; `space` is the space bar; a pair like `e ` ends a word.
- `keyboard`: the same measures for every key with enough presses.
- `trends`: daily records of `[day, ms, errorRate]` for the weak keys and pairs (all keys and the
  150 most-typed pairs in the full version), so you can see whether a weakness is improving.
- `fluency` and `answers`: each answer the user has typed, with its stage (`New`, `Typed`,
  `Accurate`, `Fluent` = accurate at or above usual speed, `Automatic` = fluent on three spaced
  days), times typed, best WPM and accuracy, last rating.
- `keyCourse`: progress in the touch-typing course (letters unlocked, target WPM, per-letter speed).
- `exercises`: exercise sets loaded earlier, with every result. Use these to judge whether your
  last exercises worked.
- `history`: the latest answers (150, or all in the full version). `netSpeed: false` marks old
  entries measured before speeds became net; they read slightly high.

## 3. Analyse

- **Accuracy before speed.** Below about 95% key accuracy, recommend slowing down; speed built on
  errors does not last.
- **Use speed tests for general speed.** Answer WPM is on familiar text the user may know by heart
  and reads high. Compare test results over time, at the same length and text type.
- **Trust samples.** Treat a key or pair as weak only with 30+ samples and `vsMedian` above about
  1.3 or `errorRate` above about 8%. Say when data is thin.
- **Look for patterns,** not single items: one finger or hand (e.g. `r`, `t`, `g`, `b` are all the
  left index finger), Shift and capitals, word endings (pairs ending in a space), double letters.
- **Check trends** before calling something a weakness: it may already be improving.
- **Consistency** below about 70 means speed swings: often hesitation on particular words.
- If `keyCourse` is early or speed is under about 30 WPM, touch typing itself is the priority.

## 4. Give feedback

Keep it short and specific: two or three priorities, each with the evidence (numbers from the
snapshot) and what to do about it, and one measurable goal for the next week (for example "60 s
test at 45 WPM with 96% accuracy"). Point to Verbatim's own tools where they fit:

- Drill one pair, key or word with the subject's key terms: `https://michaelihc.github.io/verbatim/#/drill?src=terms&focus=th`
  (`focus` takes any pair, key, word, `shift` or `space`; `src=words` uses single words).
- Timed test: `#/test?d=60&src=terms` (`d` is 15, 30, 60 or 120; `src` is `answers` or `terms`).
- Touch-typing course: `#/course`. Typing hub: `#/typing`.

## 5. Set exercises

Write an exercise set as JSON:

```json
{
  "format": "verbatim-exercises/1",
  "title": "Week of 10 Nov: th and Shift",
  "from": "Claude",
  "note": "Slow down on th; aim for 97% accuracy before speed.",
  "exercises": [
    { "title": "th warm-up", "kind": "drill", "text": "the thermal threshold that theory ...", "note": "Keep a steady rhythm." },
    { "title": "Capitals", "kind": "drill", "text": "Newton Joule Kelvin Pascal ...", "repeat": 2 },
    { "title": "Benchmark", "kind": "test", "seconds": 60, "text": "..." }
  ]
}
```

- `kind` is `drill` (type the text once) or `test` (timed for `seconds`, 10–300; the text repeats
  if it runs out). `repeat` (1–5) repeats a drill's text. Up to 20 exercises, 2,400 characters each.
  Line breaks become spaces.
- Use real words and phrases from the user's subject (`subjects.lastTrained`; the `answers` list
  shows which terms they know), dense in their weak pairs and keys. Real text transfers better
  than random letters.
- Three to six exercises is plenty: drills on the top weaknesses, then one test to measure.

## 6. Hand the exercises back

Encode the JSON as UTF-8, then base64url (base64 with `-` for `+`, `_` for `/`, no `=` padding),
and open this link in the user's default browser the same way as the snapshot:

`https://michaelihc.github.io/verbatim/#/load?x=<base64url>`

Verbatim shows the user a preview and adds the exercises only if they agree; they appear under
Typing → Your exercises, and the results show up in the next snapshot. Keep the link under about
7,000 characters (Windows command lines are limited); split a long set into two. You can also give
the user the link to click. (`#/load?j=<percent-encoded JSON>` works too, but base64url is safer
in command lines.)

## 7. Privacy

The snapshot holds only typing data and settings. It stays on the user's computer unless they
share it. Opening the snapshot link sends nothing anywhere; the file is made in their browser.
