# Adding content

All practice content lives in `packs/`. The app has no build step: add a JSON file, register it in
`packs/index.json`, and it shows up on the next load.

## 1. Register the pack

`packs/index.json`:

```json
{
  "packs": [
    { "id": "9702-definitions", "file": "9702-definitions.json" }
  ]
}
```

## 2. Write the pack

```json
{
  "id": "9702-definitions",
  "title": "Physics definitions",
  "subject": "Physics",
  "syllabus": "Cambridge International AS & A Level Physics (9702)",
  "kind": "definition",
  "description": "One-line summary shown on the pack card.",
  "units": [
    {
      "id": "kinematics",
      "title": "Kinematics",
      "items": [
        {
          "id": "acceleration",
          "term": "Acceleration",
          "prompt": "Define acceleration.",
          "answer": "Acceleration is the rate of change of velocity.",
          "alt": ["change in velocity per unit time"],
          "sources": [
            { "paper": "9702/22", "session": "May/June 2023", "question": "1(a)" }
          ]
        }
      ]
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `kind` | yes | `definition` or `equation` (single line), or `code` (multi-line, indentation matters). |
| `units` | yes | Ordered as in the syllabus. Each unit is a chapter on the home page. |
| `item.id` | yes | Unique within the pack and stable: progress is stored against it. Renaming resets progress. |
| `item.term` | yes | Short name shown in lists and in recall mode. |
| `item.prompt` | yes | The question as it would appear on a paper. |
| `item.answer` | yes | The text the learner types. Keep the mark-scheme wording. |
| `item.alt` | no | Other wordings the mark scheme accepts. Shown after the item, not typed. |
| `item.sources` | yes | At least one mark-scheme reference so others can check the wording. |
| `item.notes` | no | Examiner guidance worth knowing (e.g. "must say *per unit*"). |
| `item.type` | no | `explain` for an explain or state question; leave it out for a definition. A chapter lists the two groups separately. |
| `item.marks` | no | The phrases that earn marks, from the mark scheme. A list of marks; each mark is a list of one or more phrases from the answer that together earn it, e.g. `[["work done per unit mass"], ["bringing a small test mass from infinity"]]`. They light up as the learner types them. |
| `item.formula` | `equation` packs | The symbol form, shown next to the word equation. Display only, so Unicode is fine (`Eₖ = ½mv²`); `_rms` renders as a subscript. |
| `item.given` | no | `true` if the equation is printed on the data and formulae list. |

### Answer text rules

- `equation` answers are word equations: `x` for multiply, `/` for divide, and words for powers
  (`speed squared`).
- Plain ASCII where possible. Use `^` only when the mark scheme does (e.g. `m s^-2`); prefer words.
- `code` packs: indent with 4 spaces, no tabs, no trailing spaces, `\n` line breaks. Use the
  Cambridge pseudocode guide conventions (`←` is written as `<-` so it can be typed).
- Keep each answer under ~600 characters; split long algorithms into separate items.

### Sourcing

Equations can cite the syllabus instead of a paper:
`{ "paper": "9702 syllabus", "session": "2025-2027", "section": "Topic 20" }`.

For definitions, use the wording of the official Cambridge mark scheme (the accepted answer, with minimal framing
such as "X is ..." to make a full sentence). Cite the paper, session and question. Do not commit
the mark-scheme PDFs themselves.

Run `node tools/validate.mjs` before opening a pull request.
