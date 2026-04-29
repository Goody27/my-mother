# インフラ設計 — slack-decline-agent

## AWSサービス一覧

| サービス | 設定 | 目的 |
|---------|------|------|
| EventBridge Scheduler | `rate(1 minute)` | dm-pollerのトリガー |
| Lambda: mymom-dm-poller | Python 3.12, Timeout: 30秒, Memory: 256MB | Slack DM取得 |
| Lambda: mymom-analyzer | Python 3.12, Timeout: 60秒, Memory: 512MB | Bedrock Agent呼び出し |
| Lambda: mymom-sender | Python 3.12, Timeout: 30秒, Memory: 256MB | Slack返信送信 |
| Lambda: mymom-interaction | Python 3.12, Timeout: 3秒, Memory: 128MB | 取り消しボタン処理 |
| Lambda: mymom-sla-handler | Python 3.12, Timeout: 120秒, Memory: 512MB | 謝罪・リカバリ実行 |
| DynamoDB: mymom-requests | オンデマンド, Streams有効 | 依頼ライフサイクル管理 |
| DynamoDB: mymom-users | オンデマンド | ユーザーコンテキスト |
| DynamoDB: mymom-characters | オンデマンド | お母さん性格設定 |
| DynamoDB: mymom-judgement-logs | オンデマンド | AI判断の監査ログ |
| DynamoDB: mymom-dependency-scores | オンデマンド | 依存度追跡 |
| DynamoDB: mymom-plans | オンデマンド | プラン情報 |
| DynamoDB: mymom-sla-records | オンデマンド | SLA実行記録 |
| SQS: mymom-send-queue | DelaySeconds=3, DLQ=mymom-send-dlq, maxReceiveCount=3 | 取り消しウィンドウ |
| Bedrock Agent | Claude 3.5 Sonnet, Guardrails v1アタッチ | 自律判断 |
| Bedrock Guardrails | バージョン"1"（固定） | 倫理フィルタ |
| API Gateway | REST API, POST /slack/interaction | 取り消しボタンWebhook |
| Secrets Manager | mymom/slack-bot-token, mymom/slack-signing-secret | 認証トークン |
| CloudWatch Logs | Lambda関数ごとにロググループ | ログ・Bedrockトレース |
| SNS: mymom-escalation | Email/Slack subscription | 倫理ブロック通知 |
| X-Ray | 全Lambda関数で有効化 | 分散トレーシング |

---

## IAMロール（最小権限）

### mymom-dm-poller-role

```yaml
Policies:
  - DynamoDB:PutItem on mymom-requests
  - SecretsManager:GetSecretValue on mymom/slack-bot-token
  - CloudWatch:PutLogEvents
  - xray:PutTraceSegments
```

### mymom-analyzer-role

```yaml
Policies:
  - DynamoDB:GetItem on mymom-users, mymom-characters
  - DynamoDB:GetItem, UpdateItem on mymom-requests
  - Bedrock:InvokeAgent on mymom-agent
  - Bedrock:ApplyGuardrail on mymom-ethics-guardrail
  - SQS:SendMessage on mymom-send-queue
  - SNS:Publish on mymom-escalation
  - CloudWatch:PutLogEvents
  - xray:PutTraceSegments
```

### mymom-sender-role

```yaml
Policies:
  - DynamoDB:GetItem, UpdateItem on mymom-requests
  - DynamoDB:PutItem on mymom-judgement-logs
  - DynamoDB:UpdateItem on mymom-dependency-scores
  - SecretsManager:GetSecretValue on mymom/slack-bot-token
  - Lambda:InvokeFunction on mymom-sla-handler
  - CloudWatch:PutLogEvents
  - xray:PutTraceSegments
```

### mymom-interaction-role

```yaml
Policies:
  - DynamoDB:UpdateItem on mymom-requests
  - SecretsManager:GetSecretValue on mymom/slack-signing-secret, mymom/slack-bot-token
  - CloudWatch:PutLogEvents
```

### mymom-sla-handler-role

```yaml
Policies:
  - DynamoDB:GetItem on mymom-plans, mymom-requests
  - DynamoDB:GetItem, UpdateItem on mymom-judgement-logs
  - DynamoDB:PutItem, UpdateItem on mymom-sla-records
  - Bedrock:InvokeModel on claude-3-5-sonnet-*
  - SecretsManager:GetSecretValue on mymom/slack-bot-token
  - SNS:Publish on mymom-escalation
  - CloudWatch:PutLogEvents
```

---

## セキュリティ: Slack Webhook署名検証

```
検証対象ヘッダー: X-Slack-Signature, X-Slack-Request-Timestamp

署名計算:
  base_string = "v0:" + X-Slack-Request-Timestamp + ":" + raw_request_body
  signature   = "v0=" + HMAC-SHA256(signing_secret, base_string)

検証:
  受信した X-Slack-Signature と計算した signature をtiming-safe比較
  不一致 → 即座に403を返す
  タイムスタンプが現在時刻から±5分以上ずれ → 403（リプレイアタック防止）
```

| 受信Lambda | 検証タイミング |
|-----------|-------------|
| `mymom-interaction` | Lambda handler冒頭（3秒タイムアウト内） |

---

## SAMテンプレート構造

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Runtime: python3.12
    Environment:
      Variables:
        POWERTOOLS_TRACE_ENABLED: "true"
        LOG_LEVEL: INFO

Resources:
  DmPollerFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: mymom-dm-poller
      CodeUri: src/lambda/dm_poller/
      Handler: handler.lambda_handler
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
      FunctionName: mymom-analyzer
      CodeUri: src/lambda/analyzer/
      Handler: handler.lambda_handler
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
      FunctionName: mymom-sender
      CodeUri: src/lambda/sender/
      Handler: handler.lambda_handler
      Timeout: 30
      MemorySize: 256
      Events:
        SQSEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt SendQueue.Arn

  InteractionHandlerFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: mymom-interaction
      CodeUri: src/lambda/interaction_handler/
      Handler: handler.lambda_handler
      Timeout: 3
      MemorySize: 128
      Events:
        SlackCallback:
          Type: Api
          Properties:
            Path: /slack/interaction
            Method: POST

  SendQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: mymom-send-queue
      DelaySeconds: 3
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt SendDLQ.Arn
        maxReceiveCount: 3

  SendDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: mymom-send-dlq

  RequestsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: mymom-requests
      BillingMode: PAY_PER_REQUEST
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES
      AttributeDefinitions:
        - AttributeName: requestId
          AttributeType: S
        - AttributeName: userId
          AttributeType: S
      KeySchema:
        - AttributeName: requestId
          KeyType: HASH
      GlobalSecondaryIndexes:
        - IndexName: userId-index
          KeySchema:
            - AttributeName: userId
              KeyType: HASH
          Projection:
            ProjectionType: ALL
```

---

## ネットワーク構成

```
インターネット
    ↓
API Gateway（エッジロケーション）
    ↓ HTTPS
Lambda（VPCなし・パブリックサブネット）
    ↓
DynamoDB / Bedrock / SQS（VPCエンドポイント推奨・本番化時）
```

MVPフェーズではLambdaをVPC外に配置（シンプル化・レイテンシ最適化）。
本番化時にVPC + PrivateLinkでエンドポイントをプライベート化する。

---

## リソースタグ

全リソースに以下のタグを付与:

```yaml
Tags:
  Project: MyMom
  Environment: hackathon
  Team: 音部に抱っこ
```

リージョン: `ap-northeast-1`（東京）
