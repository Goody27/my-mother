# Infrastructure Design — slack-decline-agent

## AWS Services

| Service | Config | Purpose |
|---------|--------|---------|
| EventBridge Scheduler | `rate(1 minute)` | Trigger dm-poller |
| Lambda: dm-poller | Runtime: Python 3.12, Timeout: 30s, Memory: 256MB | Poll Slack DMs |
| Lambda: analyzer | Runtime: Python 3.12, Timeout: 60s, Memory: 512MB | Bedrock Agent invocation |
| Lambda: sender | Runtime: Python 3.12, Timeout: 30s, Memory: 256MB | Send Slack reply |
| Lambda: interaction-handler | Runtime: Python 3.12, Timeout: 3s, Memory: 128MB | Cancel button handler |
| DynamoDB: mymom-requests | On-demand, Streams enabled | Request lifecycle |
| DynamoDB: mymom-users | On-demand | User context |
| DynamoDB: mymom-characters | On-demand | Mom personality config |
| DynamoDB: mymom-judgement-logs | On-demand | AI decision audit trail |
| DynamoDB: mymom-dependency-scores | On-demand | Dependency tracking |
| SQS: mymom-send-queue | DelaySeconds=3, DLQ=mymom-send-dlq, maxReceiveCount=3 | Cancellation window |
| Bedrock Agent | Claude 3.5 Sonnet, Guardrails attached | Autonomous judgment |
| Bedrock Guardrails | Version "1" (pinned) | Ethics filter |
| API Gateway | REST API, POST /slack/interaction | Cancel button webhook |
| Secrets Manager | mymom/slack-bot-token, mymom/slack-signing-secret | Auth tokens |
| CloudWatch | Log groups per Lambda, Bedrock trace logs | Observability |
| SNS: mymom-escalation | Email subscription | Ethics block alerts |
| X-Ray | Enabled on all Lambdas | Distributed tracing |

## IAM Roles (Minimum Privilege)

### dm-poller-role
```yaml
Policies:
  - DynamoDB:PutItem on mymom-requests
  - SecretsManager:GetSecretValue on mymom/slack-*
  - CloudWatch:PutLogEvents
```

### analyzer-role
```yaml
Policies:
  - DynamoDB:GetItem on mymom-users, mymom-characters
  - DynamoDB:UpdateItem on mymom-requests
  - DynamoDB:PutItem on mymom-judgement-logs
  - Bedrock:InvokeAgent on mymom-agent
  - SQS:SendMessage on mymom-send-queue
  - SNS:Publish on mymom-escalation
  - CloudWatch:PutLogEvents
```

### sender-role
```yaml
Policies:
  - DynamoDB:GetItem, UpdateItem on mymom-requests
  - DynamoDB:PutItem on mymom-judgement-logs
  - DynamoDB:UpdateItem on mymom-dependency-scores
  - SecretsManager:GetSecretValue on mymom/slack-bot-token
  - Lambda:InvokeFunction on mymom-sla-handler
  - CloudWatch:PutLogEvents
```

### interaction-handler-role
```yaml
Policies:
  - DynamoDB:UpdateItem on mymom-requests
  - SecretsManager:GetSecretValue on mymom/slack-signing-secret, mymom/slack-bot-token
  - CloudWatch:PutLogEvents
```

## Network

```
Internet
  └─► API Gateway (edge) — HTTPS only
        └─► Lambda interaction-handler (no VPC, public subnet)
              └─► DynamoDB (VPC endpoint recommended for prod)
              └─► Secrets Manager (VPC endpoint recommended for prod)
```

MVP: Lambda outside VPC (simpler, lower latency).
Production: VPC + PrivateLink endpoints for DynamoDB, Secrets Manager, Bedrock.

## SAM Template Structure

```yaml
# template.yaml (root)
Resources:
  DmPollerFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/lambda/dm_poller/
      Handler: handler.lambda_handler
      Runtime: python3.12
      Timeout: 30
      MemorySize: 256
      Events:
        Schedule:
          Type: ScheduleV2
          Properties:
            ScheduleExpression: rate(1 minute)

  AnalyzerFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/lambda/analyzer/
      Timeout: 60
      MemorySize: 512
      Events:
        DynamoDBStream:
          Type: DynamoDB
          Properties:
            Stream: !GetAtt RequestsTable.StreamArn
            StartingPosition: TRIM_HORIZON

  SenderFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/lambda/sender/
      Timeout: 30
      Events:
        SQSEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt SendQueue.Arn

  InteractionHandlerFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/lambda/interaction_handler/
      Timeout: 3
      Events:
        SlackCallback:
          Type: Api
          Properties:
            Path: /slack/interaction
            Method: POST
```

## Resource Tags

All resources: `Project=MyMom`, `Environment=hackathon`, `Team=音部に抱っこ`
