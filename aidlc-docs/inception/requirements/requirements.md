# Requirements — MyMom（マイマム）

## Intent Analysis

| Field | Value |
|-------|-------|
| User Request | Build a push-type AI service that proactively handles the user's social obligations |
| Request Type | New Project |
| Scope | System-wide |
| Complexity | Complex |
| Origin | Engineer's pain point: "wording failures" in relationships; abstracted to full-delegation AI |

## Product Vision

> **「人をダメにするシステム」**
> A system that makes people dependent — AI acts as "Mom", proactively executing decisions so users never have to judge or take responsibility.

The core differentiator from all existing AI:

| Model | Who acts first |
|-------|---------------|
| ChatGPT (Pull) | User asks → AI answers |
| Zapier (Pull) | User designs workflow → automation runs |
| iOS Shortcuts | User sets trigger → shortcut fires |
| **MyMom (Push)** | **AI detects situation → AI acts → User receives "done" notification** |

## Functional Requirements

### FR-01: Slack Decline Agent (MVP)
- Monitor user's Slack DMs via EventBridge 1-minute polling
- Analyze each DM using Bedrock Agent (multi-step: context retrieval → ethics check → reply generation)
- Generate decline message in "mom" character style
- Provide 3-second cancellation window (SQS DelayQueue)
- Send reply to sender without user action
- Notify user: "断っておいたよ"

### FR-02: Ethics Filter
- All AI-generated content must pass Bedrock Guardrails before sending
- Block: harassment, illegal requests, privacy violations
- On block: escalate to operator via SNS; never auto-send

### FR-03: Chat UI with Smart Quick Replies
- Accept user messages via REST API
- Return Bedrock-generated response + exactly 2 quick-reply button candidates (JSON structured output)
- Store chat history in DynamoDB (TTL: 90 days)
- Support free-text input alongside quick replies

### FR-04: AI Personality Analysis
- Analyze judgment logs + chat history weekly (EventBridge weekly cron)
- Compute 4 personality scores: 断り苦手度, 先延ばし傾向, 完璧主義度, 承認欲求度
- Inject personality profile into Bedrock system prompt for personalized responses
- Generate shareable personality card (public URL, opt-in)

### FR-05: Responsibility SLA (Paid Plan)
- On MyMom-caused failure: auto-generate apology message → send to affected party
- Auto-execute recovery actions
- Notify user only after resolution

### FR-06: Onboarding & Consent
- Display explicit consent screen: "MyMomがあなたの代わりに行動します"
- Show 3-second cancellation window in consent
- Auto-execution starts ON after consent (push-type core)
- Setting to disable: 設定 > お母さんモード

### FR-07: Dependency Breaker
- Compute dependency score from usage frequency + delegation rate
- Score > 80 for 14+ consecutive days: send mom-voice notification to encourage self-action

## Non-Functional Requirements

### NFR-01: Latency
- EventBridge cycle: ≤ 60 seconds (1-minute cron)
- Bedrock Agent response: ≤ 30 seconds
- Chat API response: ≤ 5 seconds (p99)

### NFR-02: Availability
- Target: 99.9% uptime
- DLQ (maxReceiveCount=3) for all Lambda → SQS flows
- Lambda retry with exponential backoff

### NFR-03: Security
- All secrets in AWS Secrets Manager (never hardcoded)
- Slack Webhook: verify X-Slack-Signature (HMAC-SHA256) on every request
- Bedrock Guardrails: guardrailVersion pinned (never DRAFT)
- IAM least-privilege per Lambda function

### NFR-04: Cost
- MVP target: < $1/month for hackathon period
- Per active user/month (production): ≈ $2.41 COGS → ¥620 gross margin at ¥980/month (63%)

### NFR-05: Privacy
- Judgment log retention: 90 days (user-configurable 30–180 days)
- Data deleted 30 days after account cancellation
- Third-party message content: used for AI judgment only; never stored beyond minimum logs
- Personality card sharing: opt-in only

### NFR-06: Ethics
- Mental health decisions always escalate to human (never auto-execute)
- Third-party disclosure: optional AI footer on sent messages
- Dependency breaker at score 80+14 days

## Success Criteria

| Criterion | Target |
|-----------|--------|
| Demo: live Slack decline within 60 seconds | ✅ Must |
| CloudWatch Logs show Bedrock trace | ✅ Must |
| GitHub commits show AI-DLC lifecycle | ✅ Must |
| Unit economics proven ≥ 50% margin | ✅ Must |
| Personality card shareable | ✅ Should |
