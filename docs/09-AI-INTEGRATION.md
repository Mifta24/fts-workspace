# 09 — AI Architecture & Integration

## Purpose
Enable users to brainstorm, plan goals, draft tasks, summarize authorized knowledge, and later execute constrained workflow tools with their consent.

## Components
- **Provider adapter:** normalize request/response and streaming across OpenRouter and optional local LM Studio.
- **Orchestrator:** model selection, prompt templates, structured output, tool policy, retries.
- **Context service:** org, user role, project scope, document ACL, token budget.
- **Tool executor:** server-only, strongly validated and authorized.
- **Usage ledger:** token counts, provider, model, latency, inferred/actual cost, error reason, org/user.
- **Background worker:** ingestion, summarization, long-running workflows.

## MVP: goal decomposition
1. User opens goal and asks for a task plan.
2. Server checks org membership and AI entitlement/budget.
3. System selects limited goal context with minimal private data.
4. Model returns JSON matching Zod plan schema.
5. UI shows editable draft tasks, priorities and dependencies.
6. User approves selected items.
7. Server revalidates tenant and permissions, saves in transaction, audits action.

## Example structured plan
```json
{
  "goalTitle": "Launch AI Workspace",
  "tasks": [
    {"title":"Set up authentication","priority":"HIGH","estimatedDays":2},
    {"title":"Create goal dashboard","priority":"MEDIUM","estimatedDays":3}
  ]
}
```
Estimates are model suggestions, not guaranteed timelines.

## Proposed tools
| Tool | Authorization | Mutation? |
| --- | --- | --- |
| `get_goals` | goal:read | No |
| `search_knowledge` | document:read + ACL | No |
| `generate_tasks` | ai:use | Draft only |
| `create_task` | task:create + confirmation | Yes |
| `update_task` | task:update + confirmation | Yes |
| `summarize_document` | document:read | No |
| `schedule_meeting` | calendar:write + confirmation | Yes |
| `send_message` | message:send + confirmation | Yes |

## Retrieval design
Parse document → safe file scan → chunk with origin/ACL → embed or index → metadata filter by org and ACL → retrieve → cite source in answer. Never retrieve globally and filter only after the model sees content.

## Threat & abuse controls
- Treat docs, messages, web content and tool output as untrusted.
- No secret exposure in prompts, logs, or tool results.
- Narrow Zod schemas, bounded iterations and timeout.
- Confirmation for destructive or external-impact actions.
- Cost/spend budgets, rate limits and abuse monitoring.
- Model suggestions cannot grant permissions or change organization context.

## MCP (later)
Use only allowlisted MCP servers and tools. Define trust boundaries, per-tool permissions, user approval, token handling, auditing and server lifecycle before enabling access. Do not automatically connect arbitrary third-party MCP servers.

## Metrics
Draft acceptance rate, time-to-first-token, tool error rate, hallucination/unsupported-answer review, latency, cost per organization, and approval rejection rate.
