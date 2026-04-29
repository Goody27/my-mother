variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "environment" {
  type    = string
  default = "hackathon"
}

variable "slack_bot_token_arn" {
  type        = string
  description = "Secrets ManagerにあるSlack Bot TokenのARN"
}

variable "slack_signing_secret_arn" {
  type        = string
  description = "Secrets ManagerにあるSlack Signing SecretのARN"
}

variable "bedrock_agent_id" {
  type        = string
  description = "Bedrock AgentのID（コンソールで作成後に設定）"
  default     = ""
}

variable "bedrock_agent_alias_id" {
  type        = string
  description = "Bedrock AgentのAlias ID"
  default     = "TSTALIASID"
}

variable "bedrock_guardrail_id" {
  type        = string
  description = "Bedrock GuardrailsのID"
  default     = ""
}
