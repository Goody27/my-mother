locals {
  # Streams付き
  streams_tables = {
    "mymom-requests" = {
      hash_key = "requestId"
      gsi = [{
        name       = "userId-index"
        hash_key   = "userId"
      }]
      attributes = [
        { name = "requestId", type = "S" },
        { name = "userId",    type = "S" },
      ]
    }
  }

  # Streamsなし
  simple_tables = {
    "mymom-users"              = { hash_key = "userId",  attributes = [{ name = "userId",  type = "S" }] }
    "mymom-characters"         = { hash_key = "userId",  attributes = [{ name = "userId",  type = "S" }] }
    "mymom-plans"              = { hash_key = "userId",  attributes = [{ name = "userId",  type = "S" }] }
    "mymom-dependency-scores"  = { hash_key = "userId",  attributes = [{ name = "userId",  type = "S" }] }
    "mymom-personality-profiles" = { hash_key = "userId", attributes = [{ name = "userId", type = "S" }] }
  }
}

# mymom-requests（DynamoDB Streams有効）
resource "aws_dynamodb_table" "requests" {
  name         = "mymom-requests"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "requestId"

  attribute {
    name = "requestId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

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
  attribute { name = "userId"; type = "S" }
}

resource "aws_dynamodb_table" "characters" {
  name         = "mymom-characters"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  attribute { name = "userId"; type = "S" }
}

resource "aws_dynamodb_table" "plans" {
  name         = "mymom-plans"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  attribute { name = "userId"; type = "S" }
}

resource "aws_dynamodb_table" "dependency_scores" {
  name         = "mymom-dependency-scores"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  attribute { name = "userId"; type = "S" }
}

resource "aws_dynamodb_table" "judgement_logs" {
  name         = "mymom-judgement-logs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "logId"

  attribute { name = "logId";     type = "S" }
  attribute { name = "requestId"; type = "S" }
  attribute { name = "userId";    type = "S" }

  global_secondary_index {
    name            = "requestId-index"
    hash_key        = "requestId"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "sla_records" {
  name         = "mymom-sla-records"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "slaId"

  attribute { name = "slaId";     type = "S" }
  attribute { name = "requestId"; type = "S" }

  global_secondary_index {
    name            = "requestId-index"
    hash_key        = "requestId"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "chat_messages" {
  name         = "mymom-chat-messages"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute { name = "messageId"; type = "S" }
  attribute { name = "userId";    type = "S" }
  attribute { name = "sessionId"; type = "S" }

  global_secondary_index {
    name            = "userId-sessionId-index"
    hash_key        = "userId"
    range_key       = "sessionId"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "personality_profiles" {
  name         = "mymom-personality-profiles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  attribute { name = "userId"; type = "S" }
}
