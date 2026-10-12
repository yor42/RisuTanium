# Model data test fixture

`openrouterRows.fixture.json` is a trimmed subset of one keyless public listing from `https://openrouter.ai/api/v1/models`, in the raw response shape (`id`, `context_length`, `top_provider.context_length`, `pricing`). Prices are decimal strings in USD per token.

- Rows kept: the Anthropic Sonnet 4 / 4.5 / 4.6 and Haiku 4.5 rows with their `:batch` variants; `openai/gpt-4o`, its dated twins (`-2024-05-13` has a different price from the others), the `gpt-4o-mini` rows and the `:batch` variant; the Gemini 2.5 Pro and 3 Pro Image rows (the latter has a top-level `context_length` different from `top_provider.context_length`); the `deepseek-chat` rows (not matched to any catalog entry); the seven router rows with a negative `-1` price (`openrouter/auto`, `auto-beta`, `fusion`, `pareto-code`, `bodybuilder`, `typesafe/jev-router`, `nvidia/switchyard`) and `openrouter/free`; two `:free`-only rows whose base id is absent.
- The full response is about 766 KB and is not committed. Do not add it here; keep new rows to the shape above and to the cases a test needs.
- The file holds no secrets and no user data.
