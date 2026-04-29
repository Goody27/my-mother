# Functional Design — chat-ui

## Business Logic Model

### Flow: User Message → Response + Quick Replies

```
POST /chat
  body: { userId, sessionId, message }
  └─► chat-handler Lambda
        ├─► Verify request auth (Cognito JWT — future; API key for MVP)
        │
        ├─► DynamoDB: GetItem mymom-personality-profiles (inject into system prompt)
        ├─► DynamoDB: GetItem mymom-characters (mom tone/style)
        ├─► DynamoDB: Query mymom-chat-messages (last 10 messages for context)
        │
        ├─► Bedrock: InvokeModel (structured output)
        │     System prompt:
        │       - お母さんキャラクター設定
        │       - パーソナリティプロファイル
        │     User: 直近10件のチャット履歴 + 今回のメッセージ
        │     Response schema:
        │       {
        │         "reply": "string",
        │         "quickreplies": ["string", "string"]  // exactly 2
        │       }
        │
        ├─► DynamoDB: PutItem mymom-chat-messages (user message, TTL=90days)
        ├─► DynamoDB: PutItem mymom-chat-messages (mom reply + quickreplies, TTL=90days)
        │
        └─► Response: { reply, quickreplies }
```

### Bedrock Structured Output Schema

```json
{
  "type": "object",
  "properties": {
    "reply": {
      "type": "string",
      "description": "お母さんの返答"
    },
    "quickreplies": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 2,
      "maxItems": 2,
      "description": "次の会話候補2択"
    }
  },
  "required": ["reply", "quickreplies"]
}
```

### Quick Reply Generation Rules

| Rule | Description |
|------|-------------|
| Always 2 options | Never 1, never 3+ |
| Contextually relevant | Generated from conversation state, not static templates |
| Actionable framing | Each option leads to a meaningful next turn |
| Distinct choices | Options should not overlap in meaning |

### Business Rules

| Rule | Description |
|------|-------------|
| BR-01 | Chat history window: last 10 messages only (context efficiency) |
| BR-02 | Personality profile injected if exists; omitted gracefully if not |
| BR-03 | Messages stored with TTL 90 days (auto-deleted by DynamoDB) |
| BR-04 | Free text always accepted alongside quick reply buttons |
| BR-05 | Session continuity: same sessionId groups messages for context |
