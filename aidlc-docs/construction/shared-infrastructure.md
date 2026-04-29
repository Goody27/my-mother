# Shared Infrastructure — MyMom

## Architecture Diagram

```mermaid
graph TB
    subgraph External["External Systems"]
        Slack["Slack (DM / Interactive)"]
    end

    subgraph Triggers["Triggers"]
        EB1["EventBridge\nrate(1 minute)"]
        EB2["EventBridge\ncron weekly"]
    end

    subgraph Compute["Lambda Functions"]
        LPoll["dm-poller"]
        LAnalyze["analyzer"]
        LSend["sender"]
        LInteract["interaction-handler"]
        LSLA["sla-handler"]
        LChat["chat-handler"]
        LPersonality["personality-analyzer"]
    end

    subgraph AI["Amazon Bedrock"]
        Agent["Bedrock Agent\n(InvokeAgent)"]
        Guardrails["Guardrails\n(ethics filter)"]
        Claude["Claude 3.5 Sonnet\n(InvokeModel)"]
    end

    subgraph Queue["Messaging"]
        SQS["SQS\nDelaySeconds=3\nDLQ attached"]
        SNS["SNS\nescalation"]
    end

    subgraph DB["DynamoDB (9 tables)"]
        DBReq["mymom-requests"]
        DBUser["mymom-users"]
        DBChar["mymom-characters"]
        DBLog["mymom-judgement-logs"]
        DBScore["mymom-dependency-scores"]
        DBSLA["mymom-sla-records"]
        DBPlan["mymom-plans"]
        DBChat["mymom-chat-messages"]
        DBProfile["mymom-personality-profiles"]
        Streams["DynamoDB Streams"]
    end

    subgraph Security["Security & Ops"]
        SM["Secrets Manager"]
        CW["CloudWatch Logs"]
        XRay["X-Ray"]
        APIGW["API Gateway"]
    end

    EB1 --> LPoll --> Slack
    LPoll --> DBReq --> Streams --> LAnalyze
    LAnalyze --> Agent --> Guardrails --> Claude
    Guardrails -->|blocked| SNS
    LAnalyze --> SQS --> LSend --> Slack
    Slack --> APIGW --> LInteract --> DBReq
    APIGW --> LChat --> Claude
    LChat --> DBChat
    EB2 --> LPersonality --> Claude
    LPersonality --> DBProfile
```

## All DynamoDB Tables

| Table | PK | SK | GSI | Streams |
|-------|----|----|-----|---------|
| mymom-requests | requestId | — | userId-index | ✅ (triggers analyzer) |
| mymom-users | userId | — | — | — |
| mymom-characters | userId | — | — | — |
| mymom-judgement-logs | logId | — | requestId-index, userId-index | — |
| mymom-dependency-scores | userId | — | — | — |
| mymom-sla-records | slaId | — | requestId-index | — |
| mymom-plans | userId | — | — | — |
| mymom-chat-messages | messageId | — | userId-sessionId-index | — |
| mymom-personality-profiles | userId | — | — | — |

All tables: on-demand billing mode, region ap-northeast-1.

## Secrets Manager Keys

| Secret Name | Contents |
|-------------|---------|
| mymom/slack-bot-token | Slack Bot OAuth Token |
| mymom/slack-signing-secret | Slack Signing Secret (webhook verification) |

## Resource Tags (applied to all resources)

```yaml
Tags:
  Project: MyMom
  Environment: hackathon
  Team: 音部に抱っこ
```

## Region

All resources: `ap-northeast-1` (Tokyo)
- Bedrock Claude 3.5 Sonnet available in this region
- Optimal latency for Japanese Slack users
