import { SQSHandler, SQSRecord } from "aws-lambda";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { WebClient } from "@slack/web-api";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});
const sm = new SecretsManagerClient({});

const {
  REQUESTS_TABLE,
  JUDGEMENT_LOGS_TABLE,
  DEPENDENCY_SCORES_TABLE,
  SLACK_BOT_TOKEN_ARN,
  SLA_HANDLER_FUNCTION_ARN,
} = process.env;

let slackClient: WebClient | null = null;

async function getSlackClient(): Promise<WebClient> {
  if (slackClient) return slackClient;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: SLACK_BOT_TOKEN_ARN! })
  );
  const { token } = JSON.parse(SecretString!);
  slackClient = new WebClient(token);
  return slackClient;
}

async function processRecord(record: SQSRecord): Promise<void> {
  const { requestId, logId } = JSON.parse(record.body) as {
    requestId: string;
    logId: string;
  };

  // CANCELLED チェック（ユーザーが操作済みの場合はスキップ）
  const requestResult = await ddb.send(
    new GetCommand({ TableName: REQUESTS_TABLE!, Key: { requestId } })
  );
  const request = requestResult.Item;
  if (!request) return;
  if (request.status === "CANCELLED") return;

  // 判断ログを取得
  const logResult = await ddb.send(
    new GetCommand({ TableName: JUDGEMENT_LOGS_TABLE!, Key: { logId } })
  );
  const log = logResult.Item;
  if (!log) return;

  const slack = await getSlackClient();

  // Slack メッセージ送信（Block Kit でクイックリプライボタン付き）
  await slack.chat.postMessage({
    channel: request.channelId,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: log.replyText },
      },
      {
        type: "actions",
        block_id: `actions_${requestId}`,
        elements: log.quickReplies.map((label: string, i: number) => ({
          type: "button",
          text: { type: "plain_text", text: label },
          action_id: `quick_reply_${i}`,
          value: JSON.stringify({ requestId, reply: label }),
        })),
      },
    ],
  });

  // 依存スコアをインクリメント（使うほど依存させる設計）
  await ddb.send(
    new UpdateCommand({
      TableName: DEPENDENCY_SCORES_TABLE!,
      Key: { userId: request.userId },
      UpdateExpression:
        "SET score = if_not_exists(score, :zero) + :one, lastUpdated = :now",
      ExpressionAttributeValues: {
        ":zero": 0,
        ":one": 1,
        ":now": new Date().toISOString(),
      },
    })
  );

  // ステータス更新
  await ddb.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE!,
      Key: { requestId },
      UpdateExpression: "SET #s = :s, sentAt = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "SENT",
        ":t": new Date().toISOString(),
      },
    })
  );

  // SLAタイマー起動（非同期、返答を待たない）
  await lambda.send(
    new InvokeCommand({
      FunctionName: SLA_HANDLER_FUNCTION_ARN!,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ requestId, logId })),
    })
  );
}

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    await processRecord(record);
  }
};
