# Infrastructure Design — chat-ui

## AWS Services

| Service | Config | Purpose |
|---------|--------|---------|
| API Gateway | REST API, POST /chat | Chat endpoint |
| Lambda: chat-handler | Python 3.12, Timeout: 30s, Memory: 512MB | Chat response generation |
| Bedrock: InvokeModel | Claude 3.5 Sonnet, JSON structured output | Reply + quickreplies |
| DynamoDB: mymom-chat-messages | On-demand, TTL attribute: expiresAt | Chat history |
| DynamoDB: mymom-personality-profiles | On-demand | System prompt injection |
| DynamoDB: mymom-characters | On-demand | Mom tone config |
| Secrets Manager | mymom/api-key (MVP auth) | Endpoint protection |

## IAM: chat-handler-role

```yaml
Policies:
  - DynamoDB:GetItem on mymom-personality-profiles, mymom-characters
  - DynamoDB:Query on mymom-chat-messages (userId-index)
  - DynamoDB:PutItem on mymom-chat-messages
  - Bedrock:InvokeModel on claude-3-5-sonnet-*
  - SecretsManager:GetSecretValue on mymom/api-key
  - CloudWatch:PutLogEvents
```

## API Contract

```
POST /chat
Authorization: x-api-key: {apiKey}
Content-Type: application/json

Request:
{
  "userId": "string",
  "sessionId": "string",
  "message": "string"
}

Response 200:
{
  "reply": "string",
  "quickreplies": ["string", "string"]
}

Response 400: { "error": "missing required fields" }
Response 401: { "error": "unauthorized" }
Response 500: { "error": "internal error" }
```

## DynamoDB: mymom-chat-messages

| Attribute | Type | Notes |
|-----------|------|-------|
| messageId | String (PK) | UUID |
| userId | String | GSI PK |
| sessionId | String | GSI SK |
| senderType | String | "USER" or "MOM" |
| content | String | Message text |
| quickReplyCandidates | List | 2 strings (MOM messages only) |
| selectedQuickReply | String | Populated when user taps button |
| quickReplyUsed | Boolean | Analytics |
| sentAt | String | ISO 8601 |
| expiresAt | Number | Unix timestamp, TTL=90 days |
