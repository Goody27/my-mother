resource "aws_sqs_queue" "send_dlq" {
  name                      = "mymom-send-dlq"
  message_retention_seconds = 1209600 # 14日
}

resource "aws_sqs_queue" "send_queue" {
  name          = "mymom-send-queue"
  delay_seconds = 3

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.send_dlq.arn
    maxReceiveCount     = 3
  })
}
