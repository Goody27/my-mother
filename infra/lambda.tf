locals {
  lambda_runtime = "nodejs22.x"
  lambda_src     = "${path.module}/../src/lambda/dist"
}

# ── dm-poller ──────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "dm_poller" {
  name              = "/aws/lambda/mymom-dm-poller"
  retention_in_days = 7
}

resource "aws_lambda_function" "dm_poller" {
  function_name = "mymom-dm-poller"
  role          = aws_iam_role.dm_poller.arn
  runtime       = local.lambda_runtime
  handler       = "index.handler"
  filename      = "${local.lambda_src}/dm_poller/index.zip"
  timeout       = 60
  memory_size   = 256

  environment {
    variables = {
      REQUESTS_TABLE      = aws_dynamodb_table.requests.name
      SLACK_BOT_TOKEN_ARN = var.slack_bot_token_arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.dm_poller]
}

# ── analyzer ──────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "analyzer" {
  name              = "/aws/lambda/mymom-analyzer"
  retention_in_days = 7
}

resource "aws_lambda_function" "analyzer" {
  function_name = "mymom-analyzer"
  role          = aws_iam_role.analyzer.arn
  runtime       = local.lambda_runtime
  handler       = "index.handler"
  filename      = "${local.lambda_src}/analyzer/index.zip"
  timeout       = 60
  memory_size   = 256

  environment {
    variables = {
      USERS_TABLE            = aws_dynamodb_table.users.name
      CHARACTERS_TABLE       = aws_dynamodb_table.characters.name
      REQUESTS_TABLE         = aws_dynamodb_table.requests.name
      JUDGEMENT_LOGS_TABLE   = aws_dynamodb_table.judgement_logs.name
      SEND_QUEUE_URL         = aws_sqs_queue.send_queue.url
      ESCALATION_TOPIC_ARN   = aws_sns_topic.escalation.arn
      BEDROCK_AGENT_ID       = var.bedrock_agent_id
      BEDROCK_AGENT_ALIAS_ID = var.bedrock_agent_alias_id
      BEDROCK_GUARDRAIL_ID   = var.bedrock_guardrail_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.analyzer]
}

# DynamoDB Streams → analyzer
resource "aws_lambda_event_source_mapping" "requests_stream" {
  event_source_arn  = aws_dynamodb_table.requests.stream_arn
  function_name     = aws_lambda_function.analyzer.arn
  starting_position = "LATEST"
  batch_size        = 1

  filter_criteria {
    filter {
      # INSERT イベントのみ処理（新規リクエスト）
      pattern = jsonencode({ eventName = ["INSERT"] })
    }
  }
}

# ── sender ────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "sender" {
  name              = "/aws/lambda/mymom-sender"
  retention_in_days = 7
}

resource "aws_lambda_function" "sender" {
  function_name = "mymom-sender"
  role          = aws_iam_role.sender.arn
  runtime       = local.lambda_runtime
  handler       = "index.handler"
  filename      = "${local.lambda_src}/sender/index.zip"
  timeout       = 30
  memory_size   = 256

  environment {
    variables = {
      REQUESTS_TABLE           = aws_dynamodb_table.requests.name
      JUDGEMENT_LOGS_TABLE     = aws_dynamodb_table.judgement_logs.name
      DEPENDENCY_SCORES_TABLE  = aws_dynamodb_table.dependency_scores.name
      SLACK_BOT_TOKEN_ARN      = var.slack_bot_token_arn
      SLA_HANDLER_FUNCTION_ARN = aws_lambda_function.sla_handler.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.sender]
}

# SQS → sender
resource "aws_lambda_event_source_mapping" "send_queue" {
  event_source_arn = aws_sqs_queue.send_queue.arn
  function_name    = aws_lambda_function.sender.arn
  batch_size       = 1
}

# ── interaction-handler ───────────────────────────────────────
resource "aws_cloudwatch_log_group" "interaction_handler" {
  name              = "/aws/lambda/mymom-interaction-handler"
  retention_in_days = 7
}

resource "aws_lambda_function" "interaction_handler" {
  function_name = "mymom-interaction-handler"
  role          = aws_iam_role.interaction_handler.arn
  runtime       = local.lambda_runtime
  handler       = "index.handler"
  filename      = "${local.lambda_src}/interaction_handler/index.zip"
  timeout       = 10
  memory_size   = 128

  environment {
    variables = {
      REQUESTS_TABLE           = aws_dynamodb_table.requests.name
      # shared/secrets.ts が参照する変数名
      SLACK_BOT_TOKEN_SECRET      = var.slack_bot_token_arn
      SLACK_SIGNING_SECRET_SECRET = var.slack_signing_secret_arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.interaction_handler]
}

# ── sla-handler ───────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "sla_handler" {
  name              = "/aws/lambda/mymom-sla-handler"
  retention_in_days = 7
}

resource "aws_lambda_function" "sla_handler" {
  function_name = "mymom-sla-handler"
  role          = aws_iam_role.sla_handler.arn
  runtime       = local.lambda_runtime
  handler       = "index.handler"
  filename      = "${local.lambda_src}/sla_handler/index.zip"
  timeout       = 60
  memory_size   = 256

  environment {
    variables = {
      PLANS_TABLE          = aws_dynamodb_table.plans.name
      REQUESTS_TABLE       = aws_dynamodb_table.requests.name
      JUDGEMENT_LOGS_TABLE = aws_dynamodb_table.judgement_logs.name
      SLA_RECORDS_TABLE    = aws_dynamodb_table.sla_records.name
      SLACK_BOT_TOKEN_ARN  = var.slack_bot_token_arn
      ESCALATION_TOPIC_ARN = aws_sns_topic.escalation.arn
      BEDROCK_MODEL_ID     = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    }
  }

  depends_on = [aws_cloudwatch_log_group.sla_handler]
}
