# NFR Requirements — slack-decline-agent

## Performance

| Metric | Target | Notes |
|--------|--------|-------|
| End-to-end latency (DM → decline sent) | ≤ 90 seconds | EventBridge 60s + Bedrock 30s |
| Bedrock Agent response | ≤ 30 seconds | Lambda timeout: 60s |
| Cancellation window | 3 seconds | SQS DelaySeconds=3 |
| Slack API rate limit | Stay within 1 req/sec per channel | Handled by Lambda concurrency |

## Reliability

| Requirement | Implementation |
|-------------|----------------|
| SQS DLQ | maxReceiveCount=3; failed messages → DLQ for inspection |
| Lambda retry | Default 2 retries with exponential backoff |
| DynamoDB idempotency | requestId is UUID; PutItem with condition on new items only |
| Sender idempotency | Check status=PENDING before sending; CANCELLED → return immediately |

## Security

| Requirement | Implementation |
|-------------|----------------|
| Slack Webhook auth | HMAC-SHA256 verify X-Slack-Signature on all incoming webhooks |
| Replay attack prevention | Reject requests with timestamp > 5 minutes skew |
| Secrets | Slack Bot Token + Signing Secret via Secrets Manager |
| IAM | Each Lambda has its own role with minimum permissions |
| Guardrails version | Pinned to published version, never DRAFT |

## Scalability

- MVP: EventBridge 1-min polling (single user)
- Scale trigger: > 50 active users → switch to Slack Events API (WebSocket) for real-time
- DynamoDB on-demand mode: auto-scales with no provisioning

## Observability

| What | Where |
|------|-------|
| Lambda execution logs | CloudWatch Logs |
| Bedrock InvokeAgent traces | CloudWatch Logs (TRACE level) |
| Error alarms | CloudWatch Alarms → SNS |
| Distributed traces | AWS X-Ray (POWERTOOLS_TRACE_ENABLED=true) |

## Cost (per active user/month)

| Component | Cost |
|-----------|------|
| Lambda (150 executions × 4 functions) | ~$0 (free tier) |
| DynamoDB (on-demand) | ~$0 (free tier) |
| Bedrock Agent (150 DMs × 2,500 input tokens) | ~$1.13 |
| Bedrock Guardrails (150 checks) | ~$0.11 |
| SQS (150 messages) | ~$0 (free tier) |
| **Total** | **~$1.24** |
