import { ScheduledHandler } from "aws-lambda";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { WebClient } from "@slack/web-api";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sm = new SecretsManagerClient({});

const REQUESTS_TABLE = process.env.REQUESTS_TABLE!;
const SLACK_BOT_TOKEN_ARN = process.env.SLACK_BOT_TOKEN_ARN!;

let slackClient: WebClient | null = null;

async function getSlackClient(): Promise<WebClient> {
  if (slackClient) return slackClient;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: SLACK_BOT_TOKEN_ARN })
  );
  const { token } = JSON.parse(SecretString!);
  slackClient = new WebClient(token);
  return slackClient;
}

export const handler: ScheduledHandler = async () => {
  const slack = await getSlackClient();

  // Bot自身のユーザーIDを取得
  const authResult = await slack.auth.test();
  const botUserId = authResult.user_id as string;

  // DMチャンネル一覧を取得（im = Direct Message）
  const channels = await slack.conversations.list({
    types: "im",
    limit: 100,
  });

  if (!channels.channels) return;

  const now = Math.floor(Date.now() / 1000);
  // 直近1分間のメッセージを対象
  const oldest = String(now - 70);

  for (const channel of channels.channels) {
    if (!channel.id || !channel.user) continue;
    // bot自身のDMはスキップ
    if (channel.user === botUserId) continue;

    const history = await slack.conversations.history({
      channel: channel.id,
      oldest,
      limit: 10,
    });

    if (!history.messages) continue;

    for (const msg of history.messages) {
      // botからのメッセージはスキップ
      if (msg.bot_id || msg.subtype) continue;
      if (!msg.text || !msg.ts) continue;

      const requestId = randomUUID();

      await ddb.send(
        new PutCommand({
          TableName: REQUESTS_TABLE,
          Item: {
            requestId,
            userId: channel.user,
            channelId: channel.id,
            messageTs: msg.ts,
            rawText: msg.text,
            status: "PENDING",
            createdAt: new Date().toISOString(),
          },
          // 同じSlackメッセージを重複登録しない
          ConditionExpression: "attribute_not_exists(requestId)",
        })
      );
    }
  }
};
