# Build Instructions — MyMom

## Prerequisites

- AWS CLI v2 configured (`aws configure`)
- AWS SAM CLI (`brew install aws-sam-cli`)
- Python 3.12 (`pyenv install 3.12`)
- Slack workspace with App created

## Local Setup

```bash
# Clone and setup
cd my-mother
pip install -r src/lambda/requirements.txt

# Set local env (never commit this file)
cp .env.example .env.local
# Edit .env.local with your Slack tokens
```

## Deploy

```bash
# Build
sam build

# Deploy (first time)
sam deploy --guided \
  --stack-name mymom-hackathon \
  --region ap-northeast-1 \
  --capabilities CAPABILITY_IAM

# Deploy (subsequent)
sam deploy
```

## Secrets Setup (after first deploy)

```bash
# Store Slack tokens in Secrets Manager
aws secretsmanager create-secret \
  --name mymom/slack-bot-token \
  --secret-string '{"token":"xoxb-..."}' \
  --region ap-northeast-1

aws secretsmanager create-secret \
  --name mymom/slack-signing-secret \
  --secret-string '{"secret":"..."}' \
  --region ap-northeast-1
```

## Slack App Configuration

1. Create app at api.slack.com/apps
2. Enable Bot Token Scopes: `channels:history`, `chat:write`, `im:history`, `im:write`
3. Enable Interactive Components → set Request URL to API Gateway endpoint
4. Install app to workspace
5. Copy Bot Token and Signing Secret to Secrets Manager

## Verify Deployment

```bash
# Check Lambda functions
aws lambda list-functions --region ap-northeast-1 | grep mymom

# Check EventBridge scheduler
aws scheduler list-schedules --region ap-northeast-1

# Check SQS queue
aws sqs list-queues --queue-name-prefix mymom --region ap-northeast-1

# Tail analyzer logs
aws logs tail /aws/lambda/mymom-analyzer --follow --region ap-northeast-1
```

## Test: Manual DM Trigger

```bash
# Invoke dm-poller manually
aws lambda invoke \
  --function-name mymom-dm-poller \
  --region ap-northeast-1 \
  output.json && cat output.json
```

## Unit Tests

```bash
cd src/lambda
pytest tests/ -v
```

## Integration Test (Demo Verification)

1. Send Slack DM to the monitored user account: "今週末出社お願いできますか？"
2. Wait ≤ 60 seconds
3. Verify: requester receives decline message
4. Verify: user receives "断っておいたよ" notification
5. Check CloudWatch Logs for Bedrock InvokeAgent trace
