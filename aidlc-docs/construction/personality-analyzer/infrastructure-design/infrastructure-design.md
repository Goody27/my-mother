# Infrastructure Design — personality-analyzer

## AWS Services

| Service | Config | Purpose |
|---------|--------|---------|
| EventBridge Scheduler | `cron(0 18 ? * MON *)` (JST 03:00 Monday) | Weekly trigger |
| Lambda: personality-analyzer | Python 3.12, Timeout: 300s, Memory: 512MB | Analysis execution |
| Bedrock: InvokeModel | Claude 3.5 Sonnet, JSON structured output | Personality scoring |
| DynamoDB: mymom-chat-messages | Query GSI: userId-index + sentAt filter | Weekly chat data |
| DynamoDB: mymom-judgement-logs | Query GSI: userId-index + recordedAt filter | Weekly judgment data |
| DynamoDB: mymom-dependency-scores | GetItem | Current score |
| DynamoDB: mymom-personality-profiles | UpdateItem | Profile storage |
| Secrets Manager | mymom/slack-bot-token | Notification |

## IAM: personality-analyzer-role

```yaml
Policies:
  - DynamoDB:Scan on mymom-users
  - DynamoDB:Query on mymom-chat-messages (userId-index)
  - DynamoDB:Query on mymom-judgement-logs (userId-index)
  - DynamoDB:GetItem on mymom-dependency-scores
  - DynamoDB:UpdateItem, PutItem on mymom-personality-profiles
  - Bedrock:InvokeModel on claude-3-5-sonnet-*
  - SecretsManager:GetSecretValue on mymom/slack-bot-token
  - CloudWatch:PutLogEvents
```

## DynamoDB: mymom-personality-profiles

| Attribute | Type | Notes |
|-----------|------|-------|
| userId | String (PK) | |
| declineDifficulty | Number | 0-100 |
| procrastinationTendency | Number | 0-100 |
| perfectionism | Number | 0-100 |
| approvalSeeking | Number | 0-100 |
| primaryDelegationCategory | String | Top category |
| communicationStyle | String | Analysis result |
| activeHours | String | e.g., "22:00-01:00" |
| analysisBasedOn | Number | # of judgement logs used |
| momComment | String | Character-voice comment |
| lastUpdatedAt | String | ISO 8601 |
| publicFlag | Boolean | Default: false |
| publicUrl | String | Generated on opt-in |

## Personality Card Sharing (Future Enhancement)

```
GET /card/{userId}
  └─► Lambda: card-renderer (future)
        ├─► DynamoDB: GetItem mymom-personality-profiles
        │     publicFlag == false → 404
        └─► Return HTML with OGP meta tags for Twitter Card
```
