# SSM Parameter Store から設定値を読み取る
# 値は bootstrap/setup-ssm.sh で初期登録する
locals {
  ssm_prefix = "/mymom/${var.environment}"
}

data "aws_ssm_parameter" "slack_bot_token_arn" {
  name            = "${local.ssm_prefix}/slack_bot_token_arn"
  with_decryption = true
}

data "aws_ssm_parameter" "slack_signing_secret_arn" {
  name            = "${local.ssm_prefix}/slack_signing_secret_arn"
  with_decryption = true
}

data "aws_ssm_parameter" "bedrock_agent_id" {
  name            = "${local.ssm_prefix}/bedrock_agent_id"
  with_decryption = false
}

data "aws_ssm_parameter" "bedrock_agent_alias_id" {
  name            = "${local.ssm_prefix}/bedrock_agent_alias_id"
  with_decryption = false
}

data "aws_ssm_parameter" "bedrock_guardrail_id" {
  name            = "${local.ssm_prefix}/bedrock_guardrail_id"
  with_decryption = false
}
