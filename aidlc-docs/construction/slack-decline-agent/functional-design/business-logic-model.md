# Functional Design — slack-decline-agent

## Business Logic Model

### Flow: Slack DM → Auto Decline

```
EventBridge (rate: 1 minute)
  └─► dm-poller Lambda
        ├─► Slack API: conversations.list (DM channels)
        ├─► Slack API: conversations.history (unread messages)
        └─► DynamoDB: PutItem mymom-requests
              status: DETECTED
              requestId: UUID
              userId, channelId, messageText, receivedAt

DynamoDB Streams (on INSERT to mymom-requests)
  └─► analyzer Lambda
        ├─► DynamoDB: GetItem mymom-users (user context)
        ├─► DynamoDB: GetItem mymom-characters (mom personality)
        ├─► DynamoDB: UpdateItem mymom-requests → status: ANALYZING
        │
        ├─► Bedrock Agent: InvokeAgent
        │     ├─► Action: getUserContext → DynamoDB schedule/context
        │     ├─► Guardrails: ApplyGuardrail (ethics check)
        │     │     FAIL → SNS escalation → STOP
        │     │     PASS ↓
        │     ├─► Action: generateDeclineMessage (Claude 3.5 Sonnet)
        │     └─► Action: logJudgement → mymom-judgement-logs
        │
        ├─► DynamoDB: UpdateItem mymom-requests → status: PENDING
        ├─► Slack API: chat.postMessage (user ← cancel button notification)
        └─► SQS: SendMessage (DelaySeconds=3, requestId)

SQS Consumer (3 seconds later)
  └─► sender Lambda
        ├─► DynamoDB: GetItem mymom-requests
        │     status == CANCELLED → return (idempotent)
        │     status == PENDING ↓
        ├─► Slack API: chat.postMessage (requester ← decline message)
        ├─► DynamoDB: UpdateItem mymom-requests → status: COMPLETED
        ├─► DynamoDB: PutItem mymom-judgement-logs
        ├─► DynamoDB: UpdateItem mymom-dependency-scores (recalculate)
        └─► Slack API: chat.postMessage (user ← "断っておいたよ")

API Gateway (Slack interactive callback)
  └─► interaction-handler Lambda
        ├─► Verify X-Slack-Signature (HMAC-SHA256) — 403 if invalid
        ├─► DynamoDB: UpdateItem mymom-requests → status: CANCELLED
        └─► Slack API: chat.postMessage ("取り消しました")
```

### Business Rules

| Rule | Description |
|------|-------------|
| BR-01 | Only process DMs from channels not in user's whitelist |
| BR-02 | Guardrails must pass before any message leaves the system |
| BR-03 | CANCELLED status is terminal — Sender Lambda must check before sending |
| BR-04 | Dependency score recalculated after every completed execution |
| BR-05 | Score > 80 for 14+ days → trigger 離脱防止 notification |
| BR-06 | Monthly execution count checked against plan limit before processing |

### Bedrock Agent Action Groups

```json
{
  "agentName": "mymom-agent",
  "foundationModel": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "guardrailConfiguration": {
    "guardrailId": "mymom-ethics-guardrail",
    "guardrailVersion": "1"
  },
  "actionGroups": [
    {
      "name": "getUserContext",
      "description": "Retrieve user schedule and context from DynamoDB"
    },
    {
      "name": "generateDeclineMessage",
      "description": "Generate polite decline message in mom character style"
    },
    {
      "name": "logJudgement",
      "description": "Record AI judgment result to mymom-judgement-logs"
    }
  ]
}
```

### Decline Message Generation Prompt

```
System: あなたはユーザーの「お母さん」AIです。
性格設定: {momCharacter.tone}
ユーザーの状況: {userContext}
パーソナリティプロファイル: {personalityProfile}

以下の依頼に対して、角が立たず、相手への配慮を示した断り文を生成してください。
ユーザーの名前は使わない。「お気持ちはとても嬉しいのですが」などの表現を使う。

依頼内容: {request.content}

User: 断り文を生成してください。
```
