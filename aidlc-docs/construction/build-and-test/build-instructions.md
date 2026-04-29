# ビルド・デプロイ手順 — MyMom

## 前提条件

- AWS CLI v2（`aws configure`設定済み）
- Terraform >= 1.5（`brew install terraform`）
- Node.js 22.x（`nodenv install 22` or `nvm install 22`）
- Slack AppのBot Token・Signing Secret取得済み

---

## ディレクトリ構成

```
my-mother/
├── infra/                     # Terraformファイル
│   ├── providers.tf
│   ├── variables.tf
│   ├── dynamodb.tf
│   ├── lambda.tf
│   ├── sqs.tf
│   ├── eventbridge.tf
│   ├── api_gateway.tf
│   ├── secrets.tf
│   ├── bedrock.tf
│   ├── cloudwatch.tf
│   └── terraform.tfvars.example
└── src/lambda/                # TypeScript Lambda
    ├── package.json
    ├── tsconfig.json
    ├── dm_poller/
    │   └── index.ts
    ├── analyzer/
    │   └── index.ts
    ├── sender/
    │   └── index.ts
    ├── interaction_handler/
    │   └── index.ts
    └── shared/
        ├── dynamodb.ts
        ├── slack.ts
        └── bedrock.ts
```

---

## 1. Lambdaのビルド

```bash
cd src/lambda

# 依存関係インストール
npm install

# TypeScriptをビルド（esbuildでバンドル）
npm run build

# ビルド成果物: src/lambda/dist/ 以下に関数ごとのindex.jsが生成される
```

---

## 2. Secrets Managerにトークンを登録

```bash
# Slack Bot Token
aws secretsmanager create-secret \
  --name mymom/slack-bot-token \
  --secret-string '{"token":"xoxb-..."}' \
  --region ap-northeast-1

# Slack Signing Secret
aws secretsmanager create-secret \
  --name mymom/slack-signing-secret \
  --secret-string '{"secret":"..."}' \
  --region ap-northeast-1
```

---

## 3. Terraform stateバケットを作成（初回のみ）

```bash
aws s3 mb s3://mymom-tfstate --region ap-northeast-1
aws s3api put-bucket-versioning \
  --bucket mymom-tfstate \
  --versioning-configuration Status=Enabled
```

---

## 4. Terraformでデプロイ

```bash
cd infra

# terraform.tfvarsを作成（シークレットの値は書かない）
cp terraform.tfvars.example terraform.tfvars

# 初期化
terraform init

# 確認
terraform plan

# デプロイ
terraform apply
```

---

## 5. Slack Appの設定

1. [api.slack.com/apps](https://api.slack.com/apps) でAppを作成
2. Bot Token Scopes: `channels:history` `chat:write` `im:history` `im:write`
3. Interactive Components → Request URL に API GatewayエンドポイントのURLを設定
   - URLは `terraform output api_gateway_url` で確認
4. ワークスペースにインストール

---

## 6. デプロイ確認

```bash
# Lambda関数の確認
aws lambda list-functions --region ap-northeast-1 | grep mymom

# EventBridgeスケジューラの確認
aws scheduler list-schedules --region ap-northeast-1

# SQSキューの確認
aws sqs list-queues --queue-name-prefix mymom --region ap-northeast-1

# dm-pollerのログを確認
aws logs tail /aws/lambda/mymom-dm-poller --follow --region ap-northeast-1
```

---

## 7. エンドツーエンドテスト（デモ確認）

```bash
# dm-pollerを手動実行
aws lambda invoke \
  --function-name mymom-dm-poller \
  --region ap-northeast-1 \
  output.json && cat output.json
```

その後:
1. 監視対象ユーザーのSlackに別アカウントからDM送信:「今週末の出社、お願いできますか？」
2. 60秒以内に相手方へ断り文が自動送信されることを確認
3. ユーザーへ「断っておいたよ」通知が届くことを確認
4. CloudWatch Logsで Bedrock InvokeAgentのトレースを確認

---

## 8. ユニットテスト

```bash
cd src/lambda
npm test
```

---

## 更新時のデプロイフロー

```bash
# コード変更後
cd src/lambda && npm run build
cd infra && terraform apply
```
