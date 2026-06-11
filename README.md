# VishShield

## Backends & configuration

The operator (the thinking agent) and the call mechanism are each selectable by env var.

**Operator brain** — `VISH_OPERATOR_BACKEND`:
- `ai` (default) — Vercel AI SDK. Provider via `VISH_OPERATOR_PROVIDER` (`google` default / `anthropic` / `openai`), model via `VISH_AI_OPERATOR_MODEL` (default `gemini-2.5-flash`). Provider API key from the provider's standard env var (e.g. `GOOGLE_GENERATIVE_AI_API_KEY`).
- `claude` — the `claude -p` subprocess operator (model via the existing `VISH_OPERATOR_MODEL`, default `sonnet`).

**Call mechanism** — `VISH_CALL_BACKEND`:
- `simulated` (default) — Claude/mock role-players talk turn-by-turn (no real calls).
- `dial` — places REAL outbound voice calls via [getdial.ai](https://getdial.ai). Requires `DIAL_API_KEY` and `DIAL_FROM_NUMBER_ID`. **Dry-run is ON by default**: it logs the call it would place and does NOT dial until you set `VISH_DIAL_DRY_RUN=false`. Optional: `DIAL_BASE_URL`, `DIAL_POLL_MS` (3000), `DIAL_TIMEOUT_MS` (300000), `DIAL_LANGUAGE` (a BCP-47 tag like `en-US`; when unset, Dial detects the language from the destination number). The Dial request/response schema is unverified against a live account — capture one real call and confirm before enabling live mode. Use only for authorized, consented engagements.
