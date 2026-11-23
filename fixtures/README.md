# Fixtures

Synthetic data for the evaluation described in `SPEC.md` §8. Every person, company, address,
email and phone number is fictional. Email domains use the reserved `.example` ending.

| File | What it is |
|---|---|
| `listings.clean.csv` | 400 property listings as they should be |
| `listings.dirty.csv` | the same listings with 130 planted errors, 414 rows |
| `listings.truth.json` | every planted error, and the trap rows |
| `heldout/contacts.*` | a second dataset from another domain (sales contacts): 300 clean rows, 310 dirty rows, 99 planted errors |
| `recorded/` | AI responses saved by `npm run eval:live` (created by that command) |

`listings` is the development dataset: it is the sample the app loads, and detectors may be
tested against it. `heldout/contacts` is scored once, at feature freeze. Its files are not
opened while building, so that the reported numbers are not the result of tuning.

## Regenerating

```
node scripts/generate-fixtures.mjs
```

The generator is seeded. The same seed gives byte-identical files.

## Truth file

```json
{
  "dataset": "listings",
  "rowCount": { "dirty": 414, "clean": 400 },
  "summary": { "duplicate": 14, "inconsistent": 61, "missing": 32, "suspicious": 23 },
  "errors": [
    { "id": "E003", "rows": [6], "type": "inconsistent", "kind": "cross-field",
      "columns": ["city", "zip"], "dirty": "Broomfield", "clean": "Arvada",
      "fix": { "column": "city", "accept": ["Arvada"] } }
  ],
  "traps": [
    { "id": "T01", "rows": [43], "kind": "legit-outlier", "note": "..." }
  ]
}
```

- `rows`: 1-based data-row numbers in the dirty file. The header is not counted. A duplicate
  has two rows; every other error has one.
- `type`: `duplicate`, `inconsistent`, `missing` or `suspicious`.
- `kind`: a finer label used only to break down the results.
- `columns`: the cells where reporting the problem counts as finding it. Empty for a duplicate
  and for a junk record, which is wrong as a whole row.
- `fix`: `null` when the right value cannot be known from the file, so the correct behaviour
  is to flag the cell and propose nothing. Otherwise `accept` lists the values a correct fix
  may propose, best first.
- `traps`: rows that look wrong but are right. Reporting one is a false positive. An optional
  `columns` narrows the trap to those cells.

Each row carries at most one planted error, so every difference between the dirty and the
clean file maps to exactly one entry.

## What was planted

| Type | Kinds |
|---|---|
| duplicate | exact copies; the same entity entered again with a new id and small differences |
| inconsistent | case and whitespace variants; abbreviations, synonyms and misspellings; mixed date formats, some of them ambiguous; formatted numbers; a value that contradicts another column; mixed phone formats (contacts only) |
| missing | blank cells and placeholder words. Some can be derived from other rows of the same file; most cannot |
| suspicious | typos that shift a number by a factor of 10 to 1000; impossible values; malformed emails, zips and phones; test or junk records |

The ground truth was written from the problem, not from what the detectors can find. Some
planted errors are expected to be missed. Two cells contain text written to manipulate a
model; nothing should happen because of them.
