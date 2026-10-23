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
| `kind` | yes | `definition` (single line) or `code` (multi-line, indentation matters). |
| `units` | yes | Ordered. Each unit unlocks once enough of the previous unit is learned. |
| `item.id` | yes | Unique within the pack and stable: progress is stored against it. Renaming resets progress. |
| `item.term` | yes | Short name shown in lists and in recall mode. |
| `item.prompt` | yes | The question as it would appear on a paper. |
| `item.answer` | yes | The text the learner types. Keep the mark-scheme wording. |
| `item.alt` | no | Other wordings the mark scheme accepts. Shown after the item, not typed. |
| `item.sources` | yes | At least one mark-scheme reference so others can check the wording. |
| `item.notes` | no | Examiner guidance worth knowing (e.g. "must say *per unit*"). |

### Answer text rules

- Plain ASCII where possible. Use `^` only when the mark scheme does (e.g. `m s^-2`); prefer words.
- `code` packs: indent with 4 spaces, no tabs, no trailing spaces, `\n` line breaks. Use the
  Cambridge pseudocode guide conventions (`←` is written as `<-` so it can be typed).
- Keep each answer under ~600 characters; split long algorithms into separate items.

### Sourcing

Use the wording of the official Cambridge mark scheme (the accepted answer, with minimal framing
such as "X is ..." to make a full sentence). Cite the paper, session and question. Do not commit
the mark-scheme PDFs themselves.

Run `node tools/validate.mjs` before opening a pull request.
