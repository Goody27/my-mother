@aidlc-rules/aws-aidlc-rules/core-workflow.md

# MyMom — Project Context

## Product
**MyMom（マイマム）** — "人をダメにするシステム"
A push-type AI service where AI acts as the user's "mom", proactively executing decisions before the user is even aware of the need. Users delegate judgment entirely to MyMom.

## Team
チーム名: 音部に抱っこ
Event: AWS Summit Japan 2026 AI-DLC Hackathon

## Tech Stack
- Runtime: TypeScript (Node.js 22.x) — Lambda
- AI: Amazon Bedrock (Claude 3.5 Sonnet) + Bedrock Agents + Bedrock Guardrails
- IaC: Terraform
- Region: ap-northeast-1

## Key Constraints
- All secrets via AWS Secrets Manager — never hardcode
- All resources tagged: Project=MyMom
- IAM least-privilege
- Slack Webhook: always verify X-Slack-Signature (HMAC-SHA256)

## AI-DLC Phase Status
See: aidlc-docs/aidlc-state.md
