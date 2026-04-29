import { DynamoDBStreamHandler, DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { randomUUID } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrockAgent = new BedrockAgentRuntimeClient({});
const sqs = new SQSClient({});
const sns = new SNSClient({});

const {
  USERS_TABLE,
  CHARACTERS_TABLE,
  REQUESTS_TABLE,
  JUDGEMENT_LOGS_TABLE,
  SEND_QUEUE_URL,
  ESCALATION_TOPIC_ARN,
  BEDROCK_AGENT_ID,
  BEDROCK_AGENT_ALIAS_ID,
  BEDROCK_GUARDRAIL_ID,
} = process.env;

interface AgentResponse {
  decision: "APPROVE" | "DECLINE" | "ESCALATE";
  replyText: string;
  quickReplies: [string, string];
  reason: string;
}

async function invokeBedrockAgent(
  userId: string,
  requestText: string,
  userProfile: Record<string, unknown>,
  character: Record<string, unknown>
): Promise<AgentResponse> {
  const sessionId = randomUUID();
  const prompt = JSON.stringify({ userId, requestText, userProfile, character });

  const command = new InvokeAgentCommand({
    agentId: BEDROCK_AGENT_ID!,
    agentAliasId: BEDROCK_AGENT_ALIAS_ID!,
    sessionId,
    inputText: prompt,
    ...(BEDROCK_GUARDRAIL_ID
      ? {
          guardrailConfiguration: {
            guardrailId: BEDROCK_GUARDRAIL_ID,
            guardrailVersion: "1",
          },
        }
      : {}),
  });

  const response = await bedrockAgent.send(command);

  let fullText = "";
  if (response.completion) {
    for await (const chunk of response.completion) {
      if (chunk.chunk?.bytes) {
        fullText += Buffer.from(chunk.chunk.bytes).toString("utf-8");
      }
    }
  }

  return JSON.parse(fullText) as AgentResponse;
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== "INSERT" || !record.dynamodb?.NewImage) return;

  const item = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>);
  const { requestId, userId, rawText } = item;

  if (!requestId || !userId || !rawText) return;

  // ユーザープロファイルとキャラクター設定を並列取得
  const [userResult, characterResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: USERS_TABLE!, Key: { userId } })),
    ddb.send(new GetCommand({ TableName: CHARACTERS_TABLE!, Key: { userId } })),
  ]);

  const userProfile = userResult.Item ?? {};
  const character = characterResult.Item ?? {};

  // Bedrock Agent で判断
  let agentResponse: AgentResponse;
  try {
    agentResponse = await invokeBedrockAgent(userId, rawText, userProfile, character);
  } catch (err) {
    // Agent 失敗時はエスカレーション
    await sns.send(
      new PublishCommand({
        TopicArn: ESCALATION_TOPIC_ARN!,
        Subject: "MyMom: Bedrock Agent エラー",
        Message: JSON.stringify({ requestId, userId, error: String(err) }),
      })
    );
    await ddb.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE!,
        Key: { requestId },
        UpdateExpression: "SET #s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": "FAILED" },
      })
    );
    return;
  }

  const logId = randomUUID();
  const now = new Date().toISOString();

  // 判断ログを記録
  await ddb.send(
    new PutCommand({
      TableName: JUDGEMENT_LOGS_TABLE!,
      Item: {
        logId,
        requestId,
        userId,
        decision: agentResponse.decision,
        replyText: agentResponse.replyText,
        quickReplies: agentResponse.quickReplies,
        reason: agentResponse.reason,
        createdAt: now,
      },
    })
  );

  if (agentResponse.decision === "ESCALATE") {
    await sns.send(
      new PublishCommand({
        TopicArn: ESCALATION_TOPIC_ARN!,
        Subject: "MyMom: エスカレーション",
        Message: JSON.stringify({ requestId, userId, reason: agentResponse.reason }),
      })
    );
    await ddb.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE!,
        Key: { requestId },
        UpdateExpression: "SET #s = :s, logId = :l",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": "ESCALATED", ":l": logId },
      })
    );
    return;
  }

  // APPROVE / DECLINE → SQS へ送信（3秒 DelaySeconds はキュー設定で適用される）
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: SEND_QUEUE_URL!,
      MessageBody: JSON.stringify({ requestId, logId }),
    })
  );

  await ddb.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE!,
      Key: { requestId },
      UpdateExpression: "SET #s = :s, logId = :l",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "QUEUED", ":l": logId },
    })
  );
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    await processRecord(record);
  }
};
