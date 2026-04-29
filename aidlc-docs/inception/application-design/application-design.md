# Application Design — MyMom

## Architecture Overview

MyMom is a **push-type, event-driven serverless system** on AWS.
The critical design principle: **user action is never required to trigger MyMom**.

```
External Signal
(Slack DM arrives)
       │
       ▼
EventBridge (1-min cron)
       │
       ▼
Lambda Poller → DynamoDB → DynamoDB Streams
                                   │
                                   ▼
                            Lambda Analyzer
                                   │
                                   ▼
                         Bedrock Agent + Guardrails
                                   │
                                   ▼
                    SQS DelayQueue (3-sec window)
                                   │
                                   ▼
                            Lambda Sender
                                   │
                                   ▼
                          Slack API → Requester
                          Slack API → User ("断っておいたよ")
```

## Components

### Lambda Functions (7 total)

| Function | Trigger | Responsibility |
|----------|---------|----------------|
| `dm-poller` | EventBridge 1-min | Poll Slack DMs; write to DynamoDB |
| `analyzer` | DynamoDB Streams | Invoke Bedrock Agent; send to SQS |
| `sender` | SQS (delay=3s) | Check CANCELLED status; send Slack message |
| `interaction-handler` | API Gateway | Handle cancel button; set DynamoDB status=CANCELLED |
| `sla-handler` | Lambda Invoke | Apology + recovery for paid plan failures |
| `chat-handler` | API Gateway POST /chat | Chat response + quickreplies via Bedrock structured output |
| `personality-analyzer` | EventBridge weekly | Analyze behavior; update personality profile |

### Services

| Service | Role |
|---------|------|
| Bedrock Agent (Claude 3.5 Sonnet) | Multi-step autonomous judgment with traceable reasoning |
| Bedrock Guardrails | Ethics filter — blocks harassment, illegal content |
| API Gateway | Webhook receiver + chat endpoint |
| SQS DelayQueue | 3-second cancellation window |
| DynamoDB (9 tables) | All entity persistence |
| EventBridge Scheduler | Push-type triggers (1-min + weekly) |
| Secrets Manager | Token storage |
| CloudWatch | Logs + Bedrock trace visibility |

## Domain Entity Summary

See `domain-entities.md` for full class diagram.

| Entity | Purpose |
|--------|---------|
| UserInfo | Central user record |
| Request | One delegation request (Slack DM etc.) |
| JudgementLog | Full AI reasoning record |
| DependencyScore | Usage frequency × delegation rate |
| PersonalityProfile | Behavioral analysis; injected into Bedrock system prompt |
| ChatMessage | Conversation history + quickreply candidates |
| MomCharacter | Tone/style config per user |
| SLARecord | Failure recovery record (paid plan) |
| PlanInfo | Free/paid plan with SLA flag |

## Key Design Decisions

### SQS Cancellation Pattern
SQS `DeleteMessage` requires `ReceiptHandle` which is unavailable during `DelaySeconds`.
Solution: DynamoDB status flag PENDING → CANCELLED. Sender Lambda checks status at receive time and returns early (idempotent).

### Bedrock Guardrails Version
`guardrailVersion` must be a pinned number (e.g., `"1"`), not `"DRAFT"`.
DRAFT versions apply changes immediately — unsafe for production.

### Push-Type Initialization
Consent screen sets auto-execution to ON. If initialized OFF, users must manually enable — reverting to pull-type and destroying the core experience.

### Personality Card Timing
Card generated after 1 week (not 1 month) to merge AHA moment + viral sharing into a single event.

## Unit Decomposition

| Unit | Files | MVP? |
|------|-------|------|
| `slack-decline-agent` | Lambda: dm-poller, analyzer, sender, interaction-handler | ✅ Yes |
| `chat-ui` | Lambda: chat-handler | No |
| `personality-analyzer` | Lambda: personality-analyzer | No |
