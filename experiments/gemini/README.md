# Gemini Structured Output Experiment

Local test harness for trying Gemini structured extraction against this repo's observation/post inputs.

## What It Does

- accepts a collected-post or observation-style JSON input
- accepts a JSON schema file for Gemini structured output
- calls `gemini-3-flash-preview` by default through `@google/genai`
- returns a processing-style JSON envelope with:
  - observation provenance including `postUrl`
  - the normalized input post snapshot
  - parsed structured output
  - raw Gemini JSON text and request metadata

This is intentionally separate from `process:jobs` for now. It is a local experiment harness for Pass B work.

## API Key Setup

Do not put a real API key in tracked files.

The CLI now auto-checks these local-only paths when `--env-file` is omitted:

- `data/cache/gemini/gemini.env`
- `data/gemini/gemini.env`

Recommended setup:

```bash
mkdir -p data/cache/gemini
cp experiments/gemini/gemini.env.example data/cache/gemini/gemini.env
```

The CLI reads `GEMINI_API_KEY` first and also accepts `GOOGLE_API_KEY`. Existing exported env vars override values from `--env-file`.

If your key is stored at `data/cache/gemini/gemini.env`, you do not need to pass `--env-file` explicitly.

## Files

- `sample-post.json` - observation-style sample input with `postUrl`
- `listing-extraction.schema.json` - starter structured-output schema aligned with listing extraction
- `gemini.env.example` - template env file without secrets

## Usage

File input:

```bash
npm run gemini:extract -- \
  --input experiments/gemini/sample-post.json \
  --schema experiments/gemini/listing-extraction.schema.json \
  --output data/cache/gemini/sample-response.json
```

Stdin input:

```bash
cat experiments/gemini/sample-post.json | \
  npm run gemini:extract -- \
    --schema experiments/gemini/listing-extraction.schema.json
```

Swap in any other JSON schema file by changing `--schema`.

Live key check:

```bash
npm run gemini:extract -- --check-api-key
```

That runs a tiny request against `gemini-3.1-flash-lite-preview` with `thinkingLevel: "minimal"` and prints:

```text
true
Hi there!
```

On failure it prints `false` plus the error message and exits with code `1`.

## Notes

- The saved output is deterministic JSON emitted by the CLI, not a raw SDK object dump.
- `postUrl` provenance is preserved outside the model output under the top-level `observation` field.
- Gemini structured output still needs caller-side review and domain validation before anything is promoted into canonical listing records.

Official references:

- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/migrate
