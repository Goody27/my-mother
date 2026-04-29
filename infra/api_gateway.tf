resource "aws_api_gateway_rest_api" "mymom" {
  name = "mymom-api"
}

# /slack
resource "aws_api_gateway_resource" "slack" {
  rest_api_id = aws_api_gateway_rest_api.mymom.id
  parent_id   = aws_api_gateway_rest_api.mymom.root_resource_id
  path_part   = "slack"
}

# /slack/interactions
resource "aws_api_gateway_resource" "interactions" {
  rest_api_id = aws_api_gateway_rest_api.mymom.id
  parent_id   = aws_api_gateway_resource.slack.id
  path_part   = "interactions"
}

resource "aws_api_gateway_method" "interactions_post" {
  rest_api_id   = aws_api_gateway_rest_api.mymom.id
  resource_id   = aws_api_gateway_resource.interactions.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "interactions" {
  rest_api_id             = aws_api_gateway_rest_api.mymom.id
  resource_id             = aws_api_gateway_resource.interactions.id
  http_method             = aws_api_gateway_method.interactions_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.interaction_handler.invoke_arn
}

resource "aws_lambda_permission" "api_gw_interaction" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.interaction_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.mymom.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "mymom" {
  rest_api_id = aws_api_gateway_rest_api.mymom.id

  depends_on = [aws_api_gateway_integration.interactions]
}

resource "aws_api_gateway_stage" "hackathon" {
  rest_api_id   = aws_api_gateway_rest_api.mymom.id
  deployment_id = aws_api_gateway_deployment.mymom.id
  stage_name    = var.environment
}
