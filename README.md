# MyMom（マイマム）

> **「人をダメにするシステム」**

A push-type AI service that acts as the user's "Mom" — proactively executing decisions before the user is aware of the need.

Team: **音部に抱っこ**  
Event: AWS Summit Japan 2026 AI-DLC Hackathon

---

## The Thesis

Every other AI:
```
User asks → AI answers
```

MyMom:
```
Signal detected → MyMom acts → User receives "Done" notification
```

The user never asked. MyMom already said no.

---

## AI-DLC Lifecycle Evidence

This project was built using the [AI-DLC methodology](https://github.com/awslabs/aidlc-workflows):

| Phase | What AI did | Evidence |
|-------|------------|---------|
| **Inception** | Generated requirements, user stories, domain model, application design | `aidlc-docs/inception/` |
| **Construction** | Designed functional logic, NFR, infrastructure per unit; generated Lambda code | `aidlc-docs/construction/` + `src/` |
| **Operation** | 10-loop multi-evaluator review (8 AI evaluator types) refined all docs | `review/loop_log.md` |

---

## Architecture

```
EventBridge (1-min) → dm-poller Lambda → DynamoDB
                                               ↓ (Streams)
                                        analyzer Lambda → Bedrock Agent
                                                               ↓ (Guardrails + Claude 3.5 Sonnet)
                                                        SQS DelayQueue (3s)
                                                               ↓
                                                        sender Lambda → Slack
                                                                          ↓
                                                               "断っておいたよ"
```

Full diagram: [aidlc-docs/construction/shared-infrastructure.md](aidlc-docs/construction/shared-infrastructure.md)

---

## AWS Services

- **Amazon Bedrock Agents** — autonomous multi-step judgment with traceable reasoning
- **Bedrock Guardrails** — ethics filter attached directly to Agent
- **Claude 3.5 Sonnet** — decline messages, chat responses, personality analysis
- **Lambda (7 functions)** — event-driven, serverless execution
- **DynamoDB (9 tables)** — all entity persistence
- **SQS DelayQueue** — 3-second cancellation window
- **EventBridge Scheduler** — push-type triggers (1-min + weekly)
- **API Gateway** — Slack webhook + chat endpoint
- **Secrets Manager** — token storage (never hardcoded)
- **CloudWatch + X-Ray** — observability and Bedrock trace visibility

---

## Documentation

```
aidlc-docs/
├── aidlc-state.md                    # Workflow state tracker
├── audit.md                          # Complete AI-DLC audit trail
├── inception/
│   ├── requirements/requirements.md  # Functional + NFR requirements
│   ├── user-stories/stories.md       # User stories with acceptance criteria
│   ├── user-stories/personas.md      # Personas + first 10 users plan
│   └── application-design/           # Domain model + component design
└── construction/
    ├── slack-decline-agent/           # MVP unit (demo core)
    ├── chat-ui/                       # Quick reply chat unit
    ├── personality-analyzer/          # Personality profile unit
    ├── shared-infrastructure.md       # Full AWS architecture
    └── build-and-test/               # Build + deploy instructions
```

---

## Quick Start

```bash
sam build && sam deploy --guided
```

See [aidlc-docs/construction/build-and-test/build-instructions.md](aidlc-docs/construction/build-and-test/build-instructions.md)

---

## Unit Economics

| Item | Value |
|------|-------|
| Paid plan price | ¥980/month |
| COGS per user | ~¥360/month |
| Gross margin | ~63% |
| Break-even | Immediate |

---

*Built with AI-DLC. Architected by お母さん.*
