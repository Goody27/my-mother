output "slack_interactions_url" {
  description = "Slack Interactivity & Shortcuts の Request URL に設定するエンドポイント"
  value       = "${aws_api_gateway_stage.hackathon.invoke_url}/slack/interactions"
}

output "dm_poller_function_name" {
  value = aws_lambda_function.dm_poller.function_name
}

output "analyzer_function_name" {
  value = aws_lambda_function.analyzer.function_name
}

output "sender_function_name" {
  value = aws_lambda_function.sender.function_name
}
