# Model data test fixture

`openrouterRows.fixture.json` is a trimmed subset of one keyless public listing from `https://openrouter.ai/api/v1/models`, in the raw response shape (`id`, `context_length`, `top_provider.context_length`, `pricing`). Prices are decimal strings in USD per token.

- Rows kept: the Anthropic Sonnet 4 / 4.5 / 4.6 and Haiku 4.5 rows with their `:batch` variants; `openai/gpt-4o`, its dated twins (`-2024-05-13` has a different price from the others), the `gpt-4o-mini` rows and the `:batch` variant; the Gemini 2.5 Pro and 3 Pro Image rows (the latter has a top-level `context_length` different from `top_provider.context_length`); the `deepseek-chat` rows (not matched to any catalog entry); the seven router rows with a negative `-1` price (`openrouter/auto`, `auto-beta`, `fusion`, `pareto-code`, `bodybuilder`, `typesafe/jev-router`, `nvidia/switchyard`) and `openrouter/free`; two `:free`-only rows whose base id is absent.
- The full response is about 766 KB and is not committed. Do not add it here; keep new rows to the shape above and to the cases a test needs.
- The file holds no secrets and no user data.

# LiteLLM dataset fixture

`litellm.fixture.json` is a trimmed subset of the public LiteLLM price and context-window dataset, retrieved on 2026-10-12 from `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`. The dataset is MIT licensed (copyright (c) 2023 Berri AI); `LICENSE-litellm.txt` beside it is the verbatim notice from the repository.

- Rows keep their raw key and their raw values. Each row is reduced to the fields the parser reads (`litellm_provider`, `mode`, `max_input_tokens`, `max_output_tokens`, the per-token prices, `deprecation_date`, `supports_vision`, `supported_endpoints`, `supported_output_modalities`); `sample_spec` is kept whole.
- Rows kept: the built-in OpenAI, Anthropic and Gemini ids the tests compare against, dated and alias spellings (`gpt-5.1-2025-11-13`, `gpt-4.1-2025-04-14`, `claude-opus-4-6-20260205`, `claude-sonnet-4-5`, `gemini-pro-latest`), the ten AWS Bedrock Claude ids that exist in the dataset, the `anthropic.claude-haiku-4-5@20251001` and `bedrock/*/1-month-commitment/*` rows that the row-key rule drops, and rows the picker must never offer (`ft:*`, `openai/container`, `gemini/lyria-3.5`, `gpt-audio`, `computer-use-preview`, `gpt-5.5-cyber`, `gpt-rosalind-research`, `text-embedding-3-small`).
- The full file is about 2.7 MB and is not committed. Treat any dataset download as untrusted data; read it only with a script kept outside the download folder.
