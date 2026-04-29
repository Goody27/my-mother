# インフラ設計 — slack-decline-agent

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|----------|
| Lambda ランタイム | TypeScript (Node.js) | Node.js 22.x |
| IaC | Terraform | ~> 5.0 |
| AWSプロバイダー | hashicorp/aws | ~> 5.0 |
| AI推論 | Amazon Bedrock (Claude 3.5 Sonnet) | `anthropic.claude-3-5-sonnet-20241022-v2:0` |
| ビルドツール | esbuild | bundled via `terraform_data` |

---

## AWSサービス一覧

| サービス | 設定 | 目的 |
|---------|------|------|
| EventBridge Scheduler | `rate(1 minute)` | dm-pollerのトリガー |
| Lambda: mymom-dm-poller | Node.js 22.x, Timeout: 30秒, Memory: 256MB | Slack DM取得 |
| Lambda: mymom-analyzer | Node.js 22.x, Timeout: 60秒, Memory: 512MB | Bedrock Agent呼び出し |
| Lambda: mymom-sender | Node.js 22.x, Timeout: 30秒, Memory: 256MB | Slack返信送信 |
| Lambda: mymom-interaction | Node.js 22.x, Timeout: 3秒, Memory: 128MB | 取り消しボタン処理 |
| Lambda: mymom-sla-handler | Node.js 22.x, Timeout: 120秒, Memory: 512MB | 謝罪・リカバリ実行 |
| DynamoDB: mymom-requests | オンデマンド, Streams有効 | 依頼ライフサイクル管理 |
| DynamoDB: mymom-users | オンデマンド | ユーザーコンテキスト |
| DynamoDB: mymom-characters | オンデマンド | お母さん性格設定 |
| DynamoDB: mymom-judgement-logs | オンデマンド | AI判断の監査ログ |
| DynamoDB: mymom-dependency-scores | オンデマンド | 依存度追跡 |
| DynamoDB: mymom-plans | オンデマンド | プラン情報 |
| DynamoDB: mymom-sla-records | オンデマンド | SLA実行記録 |
| SQS: mymom-send-queue | DelaySeconds=3, DLQ付き, maxReceiveCount=3 | 取り消しウィンドウ |
| SQS: mymom-send-dlq | — | 失敗メッセージ保全 |
| Bedrock Agent | Claude 3.5 Sonnet, Guardrails v1アタッチ | 自律判断 |
| Bedrock Guardrails | バージョン"1"（固定） | 倫理フィルタ |
| API Gateway | REST API, POST /slack/interaction | 取り消しボタンWebhook |
| Secrets Manager | mymom/slack-bot-token, mymom/slack-signing-secret | 認証トークン |
| CloudWatch Logs | Lambda関数ごとにロググループ | ログ・Bedrockトレース |
| SNS: mymom-escalation | — | 倫理ブロック通知 |

---

## Terraformディレクトリ構成

```
infra/
├── providers.tf          # AWS provider, backend設定
├── variables.tf          # 変数定義
├── outputs.tf            # 出力値
├── dynamodb.tf           # DynamoDB全テーブル
├── lambda.tf             # Lambda関数 + IAMロール
├── sqs.tf                # SQSキュー + DLQ
├── eventbridge.tf        # EventBridge Scheduler
├── api_gateway.tf        # API Gateway + Lambda統合
├── secrets.tf            # Secrets Manager（値はtfvarsに書かない）
├── bedrock.tf            # Bedrock Agent + Guardrails
├── sns.tf                # SNSエスカレーション
├── cloudwatch.tf         # CloudWatch Logs + Alarms
└── terraform.tfvars.example
```

---

## 主要Terraformリソース

### providers.tf

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "mymom-tfstate"
    key    = "hackathon/terraform.tfstate"
    region = "ap-northeast-1"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "MyMom"
      Environment = var.environment
      Team        = "音部に抱っこ"
    }
  }
}
```

### variables.tf

```hcl
variable "aws_region" {
  default = "ap-northeast-1"
}

variable "environment" {
  default = "hackathon"
}

variable "slack_bot_token_arn" {
  description = "Secrets ManagerにあるSlack Bot TokenのARN"
  type        = string
}

variable "slack_signing_secret_arn" {
  description = "Secrets ManagerにあるSlack Signing SecretのARN"
  type        = string
}
```

### dynamodb.tf（抜粋）

```hcl
resource "aws_dynamodb_table" "requests" {
  name         = "mymom-requests"
  billing_mode = "PAY_PER_REQUEST"

  attribute {
    name = "requestId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  hash_key = "requestId"

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"
}

resource "aws_dynamodb_table" "users" {
  name         = "mymom-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  attribute {
    name = "userId"
    type = "S"
  }
}

# 同様に: mymom-characters, mymom-judgement-logs,
#          mymom-dependency-scores, mymom-plans, mymom-sla-records
```

### sqs.tf

```hcl
resource "aws_sqs_queue" "send_dlq" {
  name = "mymom-send-dlq"
}

resource "aws_sqs_queue" "send_queue" {
  name           = "mymom-send-queue"
  delay_seconds  = 3

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.send_dlq.arn
    maxReceiveCount     = 3
  })
}
```

### lambda.tf（抜粋）

```hcl
# Lambda関数のzipはesbuildでバンドル
data "archive_file" "dm_poller" {
  type        = "zip"
  source_dir  = "${path.module}/../src/lambda/dm_poller/dist"
  output_path = "${path.module}/.lambda_zips/dm_poller.zip"
}

resource "aws_lambda_function" "dm_poller" {
  function_name    = "mymom-dm-poller"
  filename         = data.archive_file.dm_poller.output_path
  source_code_hash = data.archive_file.dm_poller.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 256
  role             = aws_iam_role.dm_poller.arn

  environment {
    variables = {
      REQUESTS_TABLE          = aws_dynamodb_table.requests.name
      SLACK_BOT_TOKEN_SECRET  = var.slack_bot_token_arn
      POWERTOOLS_LOG_LEVEL    = "INFO"
    }
  }
}

resource "aws_iam_role" "dm_poller" {
  name = "mymom-dm-poller-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "dm_poller" {
  name = "mymom-dm-poller-policy"
  role = aws_iam_role.dm_poller.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = [aws_dynamodb_table.requests.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.slack_bot_token_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["arn:aws:logs:*:*:*"]
      }
    ]
  })
}
```

---

## IAMロール（関数ごと・最小権限）

### mymom-analyzer-role

```hcl
Statement = [
  { Action = ["dynamodb:GetItem"],    Resource = [users_arn, characters_arn] },
  { Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = [requests_arn] },
  { Action = ["bedrock:InvokeAgent"], Resource = [bedrock_agent_arn] },
  { Action = ["bedrock:ApplyGuardrail"], Resource = [guardrail_arn] },
  { Action = ["sqs:SendMessage"],     Resource = [send_queue_arn] },
  { Action = ["sns:Publish"],         Resource = [escalation_sns_arn] },
  { Action = logs_actions,            Resource = ["arn:aws:logs:*:*:*"] },
]
```

### mymom-sender-role

```hcl
Statement = [
  { Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = [requests_arn] },
  { Action = ["dynamodb:PutItem"],    Resource = [judgement_logs_arn] },
  { Action = ["dynamodb:UpdateItem"], Resource = [dependency_scores_arn] },
  { Action = ["secretsmanager:GetSecretValue"], Resource = [slack_token_arn] },
  { Action = ["lambda:InvokeFunction"], Resource = [sla_handler_arn] },
  { Action = logs_actions,            Resource = ["arn:aws:logs:*:*:*"] },
]
```

### mymom-interaction-role

```hcl
Statement = [
  { Action = ["dynamodb:UpdateItem"],  Resource = [requests_arn] },
  { Action = ["secretsmanager:GetSecretValue"], Resource = [signing_secret_arn, slack_token_arn] },
  { Action = logs_actions,             Resource = ["arn:aws:logs:*:*:*"] },
]
```

---

## セキュリティ: Slack Webhook署名検証

```typescript
// interaction_handler/index.ts — handler冒頭で必ず検証
import { createHmac, timingSafeEqual } from "crypto";

function verifySlackSignature(
  signingSecret: string,
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) return false; // リプレイ攻撃防止

  const baseString = `v0:${timestamp}:${body}`;
  const expected = "v0=" + createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
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

---

## デプロイ手順

```bash
# 初回: Terraform stateバケットを手動作成
aws s3 mb s3://mymom-tfstate --region ap-northeast-1

# Lambdaをビルド
cd src/lambda && npm run build

# インフラをデプロイ
cd infra
terraform init
terraform plan
terraform apply
```
