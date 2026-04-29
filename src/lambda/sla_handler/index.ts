import { Handler } from "aws-lambda";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { WebClient } from "@slack/web-api";
import { randomUUID } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});
const sns = new SNSClient({});
const sm = new SecretsManagerClient({});

const {
  PLANS_TABLE,
  REQUESTS_TABLE,
  JUDGEMENT_LOGS_TABLE,
  SLA_RECORDS_TABLE,
  SLACK_BOT_TOKEN_ARN,
  ESCALATION_TOPIC_ARN,
  BEDROCK_MODEL_ID,
} = process.env;

// SLA待機時間（デフォルト5分）
const SLA_WAIT_MS = 5 * 60 * 1000;

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

async function generateApologyMessage(context: {
  requestText: string;
  decision: string;
  reason: string;
}): Promise<string> {
  const prompt = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `以下の状況でユーザーへの謝罪文を生成してください。
リクエスト: ${context.requestText}
判断: ${context.decision}
理由: ${context.reason}
謝罪文のみを返してください（JSON不要）。`,
      },
    ],
  };

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID!,
      contentType: "application/json",
      accept: "application/json",
      body: Buffer.from(JSON.stringify(prompt)),
    })
  );

  const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  return result.content[0].text as string;
}

interface SlaEvent {
  requestId: string;
  logId: string;
}

export const handler: Handler<SlaEvent> = async (event) => {
  const { requestId, logId } = event;

  // SLA 時間まで待機（Lambda の最大実行時間内）
  await new Promise((resolve) => setTimeout(resolve, SLA_WAIT_MS));

  // 待機後、ユーザーが返答したか確認
  const requestResult = await ddb.send(
    new GetCommand({ TableName: REQUESTS_TABLE!, Key: { requestId } })
  );
  const request = requestResult.Item;
  if (!request) return;

  // ユーザーが返答済みなら SLA 違反なし
  if (request.status === "CANCELLED") return;

  // 判断ログを取得
  const logResult = await ddb.send(
    new GetCommand({ TableName: JUDGEMENT_LOGS_TABLE!, Key: { logId } })
  );
  const log = logResult.Item;
  if (!log) return;

  // ユーザープランを確認（SLA しきい値を取得）
  const planResult = await ddb.send(
    new GetCommand({ TableName: PLANS_TABLE!, Key: { userId: request.userId } })
  );
  const plan = planResult.Item;

  // SLA 違反として謝罪メッセージを送信
  const apologyText = await generateApologyMessage({
    requestText: request.rawText,
    decision: log.decision,
    reason: log.reason,
  });

  const slack = await getSlackClient();
  await slack.chat.postMessage({
    channel: request.channelId,
    text: apologyText,
  });

  // SLA レコードを保存
  const slaId = randomUUID();
  await ddb.send(
    new PutCommand({
      TableName: SLA_RECORDS_TABLE!,
      Item: {
        slaId,
        requestId,
        userId: request.userId,
        planTier: plan?.tier ?? "free",
        breachedAt: new Date().toISOString(),
        apologyText,
      },
    })
  );

  // 上位プランのユーザーは人間オペレーターにエスカレーション
  if (plan?.tier === "premium") {
    await sns.send(
      new PublishCommand({
        TopicArn: ESCALATION_TOPIC_ARN!,
        Subject: "MyMom: SLA 違反（プレミアムユーザー）",
        Message: JSON.stringify({ requestId, userId: request.userId, slaId }),
      })
    );
  }

  await ddb.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE!,
      Key: { requestId },
      UpdateExpression: "SET #s = :s, slaBreachedAt = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "SLA_BREACHED",
        ":t": new Date().toISOString(),
      },
    })
  );
};
