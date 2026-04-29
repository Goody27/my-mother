# Requirement Verification Questions — MyMom

## Q1: Primary target platform for MVP?
A) Slack only
B) Gmail only
C) Both Slack and Gmail
D) Native mobile app

[Answer]: A — Slack only. One working feature proves the entire concept. Gmail can be added post-hackathon.

## Q2: Cancellation window duration?
A) 1 second
B) 3 seconds
C) 10 seconds
D) User-configurable

[Answer]: B — 3 seconds. Short enough to feel automatic, long enough to cancel a critical mistake.

## Q3: Auto-execution default state after onboarding consent?
A) OFF (user must manually enable)
B) ON (push-type starts immediately)
C) Prompt user each time

[Answer]: B — ON. Pull-type UX kills the push-type experience. Explicit consent screen covers the ethical requirement.

## Q4: Bedrock model for text generation?
A) Claude 3 Haiku (fast, cheap)
B) Claude 3.5 Sonnet (balanced)
C) Claude 3 Opus (quality-first)

[Answer]: B — Claude 3.5 Sonnet (`anthropic.claude-3-5-sonnet-20241022-v2:0`). Japanese language quality + structured output support.

## Q5: IaC tool?
A) AWS CDK (TypeScript)
B) AWS SAM (YAML)
C) Terraform

[Answer]: B — AWS SAM. Fastest for Lambda-centric serverless. Hackathon timeline optimization.

## Q6: Enable security extension?
A) Yes — enforce security baseline rules
B) No — skip security rules

[Answer]: A — Yes. Slack signature verification + Secrets Manager are non-negotiable.

## Q7: Enable property-based testing extension?
A) Yes
B) No — standard unit tests only

[Answer]: B — No. Hackathon scope; standard pytest sufficient.
