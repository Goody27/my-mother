variable "github_repo" {
  type        = string
  description = "GitHub リポジトリ (owner/repo 形式)"
  default     = "Goody27/my-mother"
}

# GitHub Actions OIDC プロバイダー（アカウントに1つだけ作成）
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub Actions の thumbprint（固定値）
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_deploy" {
  name = "mymom-github-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # main ブランチとPRからのみ assume 可能
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          # Terraform state backend
          "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::mymom-tfstate",
          "arn:aws:s3:::mymom-tfstate/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          # Lambda デプロイ
          "lambda:CreateFunction", "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration", "lambda:GetFunction",
          "lambda:AddPermission", "lambda:RemovePermission",
          "lambda:CreateEventSourceMapping", "lambda:UpdateEventSourceMapping",
          "lambda:DeleteEventSourceMapping", "lambda:GetEventSourceMapping",
          # DynamoDB
          "dynamodb:CreateTable", "dynamodb:DescribeTable",
          "dynamodb:UpdateTable", "dynamodb:DeleteTable",
          "dynamodb:DescribeStream",
          # SQS
          "sqs:CreateQueue", "sqs:GetQueueAttributes",
          "sqs:SetQueueAttributes", "sqs:DeleteQueue",
          # SNS
          "sns:CreateTopic", "sns:GetTopicAttributes",
          "sns:SetTopicAttributes", "sns:DeleteTopic",
          # IAM（Terraform が管理するロールのみ）
          "iam:CreateRole", "iam:GetRole", "iam:UpdateRole",
          "iam:DeleteRole", "iam:PutRolePolicy", "iam:GetRolePolicy",
          "iam:DeleteRolePolicy", "iam:PassRole",
          "iam:CreateOpenIDConnectProvider", "iam:GetOpenIDConnectProvider",
          "iam:DeleteOpenIDConnectProvider",
          # API Gateway
          "apigateway:*",
          # EventBridge Scheduler
          "scheduler:CreateSchedule", "scheduler:GetSchedule",
          "scheduler:UpdateSchedule", "scheduler:DeleteSchedule",
          # CloudWatch Logs
          "logs:CreateLogGroup", "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy", "logs:DeleteLogGroup"
        ]
        Resource = "*"
      }
    ]
  })
}

output "github_deploy_role_arn" {
  description = "GitHub Actions Secrets の AWS_DEPLOY_ROLE_ARN に設定する値"
  value       = aws_iam_role.github_deploy.arn
}
