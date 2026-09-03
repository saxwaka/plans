# LLM Gateway — API Reference

> Tài liệu này viết bằng tiếng Anh vì nó dành cho AI agent và SDK ở các dự án khác đọc.
> Mọi ví dụ JSON ở đây là **response thật** chụp từ gateway đang chạy, không phải gõ tay.
> Bản máy-đọc: [`/openapi.yaml`](/openapi.yaml). Điểm vào cho agent: [`/llms.txt`](/llms.txt).

The gateway is an **OpenAI-compatible and Anthropic-compatible HTTP API** that sits in front of
two Vietnamese LLM marketplaces (Vilao, CKey). You call it exactly like OpenAI or Anthropic; it
picks the seller, falls back on failure, and tells you what it cost in VND.

## 1. Quick start

```bash
export OPENAI_BASE_URL=http://localhost:3000/v1
export OPENAI_API_KEY=gw-...            # issued by the gateway, never a Vilao/CKey key

curl $OPENAI_BASE_URL/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"cheap","messages":[{"role":"user","content":"Say hello in one word."}]}'
```

Any OpenAI or Anthropic SDK works unchanged: set the base URL and the key.

| SDK | Base URL | Key header |
|---|---|---|
| `openai` (any language) | `http://HOST:3000/v1` | `Authorization: Bearer gw-…` |
| `@anthropic-ai/sdk`, Claude Code | `http://HOST:3000` — **root, no `/v1`** | `x-api-key: gw-…` |

## 2. Authentication

Every request needs a gateway key. Keys start with `gw-` and are issued by the operator
(`npm run key:create <name>`). Use one key per integrating app so spend can be attributed.

Accepted forms, checked in this order:

```
Authorization: Bearer gw-...
x-api-key: gw-...
```

Missing or unknown key → `401`:

```json
{"error":{"message":"Invalid API key.","type":"authentication_error","code":"invalid_api_key"}}
```

Never send Vilao or CKey credentials to the gateway. It holds those itself.

## 3. Model names — the one concept you must understand

The `model` field accepts two kinds of value.

**A pool name** (recommended). A pool is an operator-defined name fronting an ordered list of
seller listings, e.g. `cheap`, `opus`, `embed`. The gateway picks a member, retries the next one
on failure, and enforces the pool's budget. Pool names are short and have no `/`.

**A raw listing id** (passthrough). Anything that is not a pool name is forwarded to CKey as-is,
e.g. `dungcsnd113/claude-opus-5`. No fallback, no budget. Use this only when you know the exact
listing. If it does not exist upstream you get the upstream's `404`:

```json
{"error":{"message":"The model is not available.","model":"nobody/nope","request_id":"req_3124fb…","type":"not_found_error"}}
```

**Discover names with `GET /v1/models`.** Pools come first (`owned_by: "gateway"`), then raw
listings. Prefer entries where `gateway.kind == "pool"`.

```json
{
  "object": "list",
  "data": [
    { "id": "cheap", "object": "model", "created": 1788454179, "owned_by": "gateway",
      "gateway": { "kind": "pool", "members": 4, "strategy": "cheapest" } },
    { "id": "embed", "object": "model", "created": 1788454179, "owned_by": "gateway",
      "gateway": { "kind": "pool", "members": 1, "strategy": "failover" } },
    { "id": "deepseek-v4-flash-free", "object": "model", "created": 1788454179, "owned_by": "ckey",
      "gateway": { "kind": "listing", "seller": null, "price_in": 0 } }
  ]
}
```

The `gateway` object is an extension; ignore it if you only need OpenAI-shaped data.

**There is no automatic canonical mapping.** `anthropic/claude-sonnet-5` or `gpt-4o` will 404
unless the operator created a pool with that exact name. When integrating, either ask the
operator which pool names exist or read them from `/v1/models` at startup.

If the request omits `model`, the gateway's configured default listing is used.

## 4. Endpoints

All endpoints are `POST` under `/v1` and take/return the standard OpenAI or Anthropic payloads.
The gateway does not alter your request other than rewriting `model` to the chosen listing's
upstream id. Response bodies are the upstream's, plus the extensions in §6.

| Path | Protocol | Streaming | Notes |
|---|---|---|---|
| `/v1/chat/completions` | OpenAI | yes | tool calling and `image_url` verified |
| `/v1/messages` | Anthropic | yes | both platforms serve it natively; no translation |
| `/v1/embeddings` | OpenAI | — | |
| `/v1/completions` | OpenAI (legacy) | yes | |
| `/v1/responses` | OpenAI Responses | yes | |
| `/v1/moderations` | OpenAI | — | CKey listings only |
| `/v1/rerank` | Cohere-style | — | CKey listings only |
| `/v1/models` | OpenAI | — | `GET`; see §3 |

Any other `/v1/*` path returns `404` from the gateway with code `unknown_endpoint`; nothing is
forwarded blind.

### 4.1 `POST /v1/chat/completions`

Request: standard OpenAI. `model` = pool or listing. `stream: true` for SSE.

```json
{"model":"cheap","messages":[{"role":"user","content":"Say hello in one word."}],"max_tokens":8}
```

Response (real):

```json
{
  "id": "chatcmpl-a11e0d42e8ad423ca4a873732a18e857",
  "object": "chat.completion",
  "created": 1788454181,
  "model": "deepseek-v4-flash",
  "choices": [ { "index": 0, "finish_reason": "stop",
                 "message": { "role": "assistant", "content": "Hello!" } } ],
  "usage": {
    "prompt_tokens": 873, "completion_tokens": 3, "total_tokens": 876,
    "prompt_tokens_details": { "cached_tokens": 768 },
    "cost": 5, "cost_currency": "VND", "cost_source": "estimated"
  }
}
```

Note `model` in the response is the **upstream's** name (`deepseek-v4-flash`), not the pool
name you sent (`cheap`). Read `X-Gateway-Pool` / `X-Gateway-Listing` (§6) to see what served.

### 4.2 `POST /v1/messages` (Anthropic)

Request: standard Anthropic Messages. Send `x-api-key: gw-…` and `anthropic-version`; the
version header is forwarded upstream. `stream: true` yields the standard event sequence
(`message_start … message_delta, message_stop`).

Response (real):

```json
{
  "id": "chatcmpl-RQOh0QSXygKylj4om2WLjW7A",
  "type": "message", "role": "assistant", "model": "deepseek-v4-flash",
  "content": [ { "type": "text", "text": "Hi! How can I help you today" } ],
  "stop_reason": "max_tokens",
  "usage": { "input_tokens": 869, "output_tokens": 8,
             "cost": 5, "cost_currency": "VND", "cost_source": "estimated" }
}
```

Errors on this endpoint use the Anthropic envelope: `{"type":"error","error":{"type","message"}}`.

### 4.3 `POST /v1/embeddings`

```json
{"model":"embed","input":"hello"}
```

```json
{
  "object": "list", "model": "text-embedding-3-small",
  "data": [ { "object": "embedding", "index": 0, "embedding": [0.0167, -0.0557, 0.0056, "…"] } ],
  "usage": { "prompt_tokens": 1, "total_tokens": 1, "cost": 3, "cost_currency": "VND", "cost_source": "estimated" }
}
```

Point `embed`-type pools at embedding listings; a chat listing will reject embedding input.

### 4.4 `POST /v1/completions`, `/v1/responses`, `/v1/moderations`, `/v1/rerank`

Standard payloads for each API, passed through. `usage` gains the cost fields where the
upstream returns a `usage` object.

## 5. Streaming

Set `stream: true`. The response is `text/event-stream`, one `data: {json}` line per frame,
terminated by `data: [DONE]` (OpenAI family) or the `message_stop` event (Anthropic).

Real chat stream (abridged):

```
data: {"id":"chatcmpl-RUeb…","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}
data: {"id":"chatcmpl-RUeb…","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"Hi! H"},"finish_reason":"length"}]}
data: {"id":"chatcmpl-RUeb…","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[],"usage":{"prompt_tokens":869,"completion_tokens":4,"total_tokens":873,"cost":5,"cost_currency":"VND","cost_source":"estimated"}}
data: [DONE]
```

Things an integrator must handle:

- **Usage arrives in a frame with `"choices": []`.** Do not drop frames with empty `choices`.
- **Usage is always included** — you do not need `stream_options.include_usage`. Sending it
  is harmless.
- **Frame order is not guaranteed** to put the usage frame last before `[DONE]`; treat the
  stream as done only on `[DONE]` / `message_stop`.
- The gateway holds the **first chunk** briefly before committing (see §7). Expect
  time-to-first-token of a few seconds; measured medians are 2–6 s, occasionally 40 s.
- If your client disconnects, the gateway cancels the upstream call.

## 6. Gateway extensions

### 6.1 Cost in `usage`

Every response with a `usage` object — non-stream, and the usage frame of a stream — gains:

| Field | Type | Meaning |
|---|---|---|
| `usage.cost` | number | VND for this call |
| `usage.cost_currency` | `"VND"` | always VND |
| `usage.cost_source` | `"upstream"` \| `"estimated"` \| `"floor"` | how `cost` was obtained |

- `upstream` — the seller reported it (CKey does, via `usage.x_ckey.cost`). Authoritative.
- `estimated` — computed by the gateway from the listing's published prices as
  `max(min_charge, per_request + tokens/1e6 × price)`. This formula was verified against real
  invoices. Used for Vilao, which reports `cost: 0` inline. Accurate to the VND in practice.
- `floor` — no token counts were available (Vilao sometimes streams Anthropic usage as
  zeros), so only the minimum charge is known. Treat as a lower bound.

The gateway reconciles `estimated`/`floor` figures with the platform's billing API a few
seconds later; the operator's dashboard shows final numbers. If you need exact billing, read it
there rather than from the response.

CKey responses additionally carry `usage.x_ckey: { cost, request_id }` unchanged. Quote
`request_id` when disputing a charge with that seller.

### 6.2 Response headers

| Header | Example | Meaning |
|---|---|---|
| `X-Gateway-Pool` | `cheap` | pool that routed the request; absent on passthrough |
| `X-Gateway-Listing` | `vilao:c06bc6a1-…:deepseek-v4-flash` | listing that actually served |
| `X-Gateway-Attempts` | `2` | how many members were tried; `>1` means a fallback happened |

These are exposed to browsers via `Access-Control-Expose-Headers`. Log `X-Gateway-Listing` if
you need to correlate quality issues to a seller.

### 6.3 CORS

`/v1/*` answers preflight and sends `Access-Control-Allow-Origin` (default `*`). Browser apps
can call the gateway directly — but then the gateway key ships to every visitor. Prefer calling
from your backend.

## 7. Routing behaviour you should know

**Fallback.** For a pool, the gateway tries members in the pool's order (or by score). If a
member fails with a *retryable* status, the next one is tried, up to the pool's `max_attempts`
(default 3). You see one response; `X-Gateway-Attempts` tells you what happened.

Retryable: `402 403 404 408 409 429` and any `5xx`. **`404` is retried** because in a
marketplace it means *this seller* no longer lists the model, not that the model is gone.
Not retryable: `400 401 413 422` — the request itself is wrong and every seller rejects it the
same way.

**Streaming and fallback.** Once the first byte reaches you, the request is committed to that
member. The gateway holds the first chunk to keep fallback possible for handshake failures
(dead connection, in-band error frame, empty body, TTFB stall). A failure *after* streaming
begins is returned as-is and cannot be retried.

**Budgets.** A pool may carry a daily/monthly VND cap. Exceeding it → `402`:

```json
{"error":{"message":"Trần ngày 3₫ đã dùng hết (4₫).","type":"insufficient_quota","code":"budget_exhausted"}}
```

Back off and alert; do not retry in a loop.

**Timeouts.** Total: 300 s. Time to first byte: 60 s. Both configurable per pool by the
operator. Set your client timeout ≥ 120 s; observed upstream latency reaches 40 s on
ordinary requests.

**Prompt inflation.** Upstreams inject their own system prompt. A 15-token request has been
billed as 914 `prompt_tokens` (891 cached). Do not estimate cost from your own prompt length;
read `usage`.

**Model in response ≠ model requested.** `model` in the body is the upstream's bare name. Sellers
strip their prefix (`dungcsnd113/claude-opus-5` → `claude-opus-5`). This is normal. A pool name
never appears in `model`.

## 8. Errors

All gateway-originated errors are JSON. Shape depends on the endpoint's protocol.

OpenAI-protocol endpoints:

```json
{"error":{"message":"…","type":"…","code":"…"}}
```

Anthropic endpoint:

```json
{"type":"error","error":{"type":"…","message":"…"}}
```

Upstream errors are forwarded with their original body and status; their shape varies by
platform (CKey includes `request_id`, Vilao includes `code`).

| Status | `code` | Cause | What to do |
|---|---|---|---|
| 400 | `invalid_json` | body is not JSON | fix request |
| 400 | *(upstream)* | malformed payload, e.g. `messages` not an array | fix request |
| 401 | `invalid_api_key` | missing/unknown gateway key | fix credentials |
| 402 | `budget_exhausted` | pool cap reached | back off, alert operator |
| 404 | `unknown_endpoint` | path not served | check §4 |
| 404 | *(upstream)* `not_found_error` | passthrough listing does not exist | use a pool |
| 409 | `empty_pool` | pool has no active members | alert operator |
| 409 | `no_member_within_budget` | every member exceeds the pool's per-request price cap | alert operator |
| 499 | — | you disconnected | — |
| 502 | `all_members_failed` | every member failed; message lists each failure | retry later |
| 502 | `upstream_unreachable` | network failure to upstream | retry later |

Real examples:

```json
{"error":{"message":"Pool \"empty-pool\" has no active members.","type":"invalid_request_error","code":"empty_pool"}}
{"error":{"code":"BAD_REQUEST","message":"messages must be an array","type":"invalid_request_error"}}
```

## 9. Not supported

- Per-request routing overrides (`models: [...]`, `provider: {...}` as in OpenRouter). Routing
  is configured per pool by the operator.
- Rate limiting per key. Any key may send at any rate; upstream limits still apply
  (Vilao: 120 req/min per token).
- Image generation, video, audio, TTS, transcription.
- TLS. Run behind your own reverse proxy if the gateway leaves localhost.
- Multi-tenant auth. Keys identify apps, nothing more.

## 10. SDK snippets

**Node / TypeScript (`openai`)**

```ts
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://localhost:3000/v1", apiKey: process.env.GW_KEY });
const r = await client.chat.completions.create({ model: "cheap", messages: [{ role: "user", content: "hi" }] });
console.log(r.choices[0].message.content, (r.usage as any).cost, "VND");
```

**Python (`openai`)**

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/v1", api_key=os.environ["GW_KEY"])
r = client.chat.completions.create(model="cheap", messages=[{"role": "user", "content": "hi"}])
print(r.choices[0].message.content, r.usage.model_dump().get("cost"), "VND")
```

**Anthropic (`@anthropic-ai/sdk`)**

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ baseURL: "http://localhost:3000", apiKey: process.env.GW_KEY });
const m = await client.messages.create({ model: "cheap", max_tokens: 64, messages: [{ role: "user", content: "hi" }] });
```

**Claude Code**

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY=gw-...
```

**Tool calling** works with the standard `tools` array; verified response:
`{"name":"get_weather","arguments":"{\"city\": \"Hanoi\"}"}`.

**Vision** works with `image_url` content parts (data URLs verified).

## 11. Checklist for an integrating agent

1. `GET /v1/models` at startup; pick a pool (`gateway.kind == "pool"`). Fail loudly if none.
2. Send `model: <pool name>`. Never hard-code a seller-prefixed listing id.
3. Set client timeout ≥ 120 s. Treat `402` and `409` as operator-action-needed, not retryable.
4. Read cost from `usage.cost`; log `X-Gateway-Listing` and `X-Gateway-Attempts`.
5. In streams, never drop frames with empty `choices`; end on `[DONE]` / `message_stop`.
6. Keep the gateway key server-side.
