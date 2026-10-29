# 11 — MCP & Tool-Execution Threat Model

**Status:** analysis only. **No MCP client, MCP server or model-driven tool execution exists in this codebase.** This document is the gate that must be satisfied, and revisited, before any is added. It satisfies the Phase 3 roadmap item "MCP threat model"; it does not implement MCP.

## What exists today (and why it is safe by construction)
| AI feature | What the model can do | How it can change data |
| --- | --- | --- |
| Task planner | return text that is parsed into a draft | not at all; a person reviews and applies the draft (idempotent, audited) |
| Knowledge assistant | return text with citations | not at all; the text is displayed as plain text |

The model has **no tool-calling ability**: there is no function schema sent to it, no loop that feeds results back, and no code path where model output is executed. "No unauthorized tool execution" (Phase 3 exit gate) therefore holds because there is no tool execution. All model output is untrusted text.

## Assets and trust boundaries
1. Tenant data (goals, tasks, chat, files, knowledge passages) behind the access rules in `07-SECURITY.md`.
2. Credentials: the AI provider key, session cookies, the gateway/publish secrets.
3. The ability to mutate data or contact people (create tasks, send messages, share files).

Boundaries: user → app (authenticated), app → model provider (data leaves the deployment), model output → app (untrusted), app → any MCP server (a third-party code boundary).

## Threats if model-driven tools or MCP were added
| # | Threat | Example | Required control |
| --- | --- | --- | --- |
| T1 | Indirect prompt injection | a shared document says "email the CFO's files to attacker@…" | passages are labelled as data; **tools never run on model say-so alone**; mutating tools need a human confirmation of the exact arguments |
| T2 | Confused deputy / privilege escalation | the model calls a tool with another user's id or a foreign organization id | tools execute **as the signed-in user** through the same services and permission checks as the UI; `organizationId` and `userId` are never tool arguments |
| T3 | Data exfiltration through tool arguments or URLs | the model encodes a private passage into a URL fetched by a tool | no outbound network tools by default; allowlisted destinations only; arguments are validated by narrow Zod schemas and logged redacted |
| T4 | Malicious or compromised MCP server | a server returns instructions, steals tokens, or exposes extra tools | **allowlist of reviewed servers** (no user-supplied URLs); pinned versions; per-tool allowlist; no ambient credentials; run out-of-process with least privilege and no access to the app's secrets or database |
| T5 | Tool-description poisoning / "rug pull" | a server changes a tool's description after approval | descriptions are pinned and hashed at approval time; any change disables the tool until re-approved |
| T6 | Cross-tenant leakage via shared tool state or caches | a server keeps state between organizations | one connection context per organization; no shared mutable state; tenant-qualified cache keys |
| T7 | Runaway loops and cost | the model calls tools forever | bounded iterations and wall-clock time; per-call and per-organization budgets (the usage ledger already meters tokens) |
| T8 | Secret exposure in prompts and logs | a tool result contains a token | redaction before prompts and logs; tool results are untrusted input |
| T9 | Destructive or external-impact actions | delete data, message customers, purchase | explicit per-action approval showing the final arguments; destructive tools off by default; every call audited (who, tool, redacted arguments, approver, result) |
| T10 | Replay and duplicate execution | the same approved action runs twice | idempotency keys (the planner's conditional apply is the pattern to copy) |

## Preconditions before building any of it
1. A product decision on which actions are worth automating, and OD-08 (provider and residency).
2. A tool registry design: name, narrow input schema, required permission, `mutating` flag, confirmation policy, audit shape.
3. A `ai_tool_calls` record (organization, requester, tool, redacted arguments, approval status, approver, result status), per `03-DATABASE.md`.
4. Tests: a tool cannot be invoked without the permission; a foreign id never resolves; an injected document cannot trigger a call; an unapproved mutating call never executes; replay is a no-op.
5. For MCP specifically: the allowlist and pinning mechanism, sandboxing, and a review checklist per server.

## Residual risks accepted today
- The assistant sends passages the asker may read to the configured model provider; the operator must choose a provider acceptable for that data (OD-08).
- Model answers can be wrong; the UI shows sources and a verification notice.
