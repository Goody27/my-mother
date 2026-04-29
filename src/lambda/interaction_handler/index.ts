import { APIGatewayProxyHandler } from "aws-lambda";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { verifySlackSignature } from "../shared/slack";
import { getSlackSigningSecret } from "../shared/secrets";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const REQUESTS_TABLE = process.env.REQUESTS_TABLE!;

export const handler: APIGatewayProxyHandler = async (event) => {
  // Slack 署名検証
  const timestamp = event.headers["x-slack-request-timestamp"] ?? "";
  const signature = event.headers["x-slack-signature"] ?? "";
  const body = event.body ?? "";

  const signingSecret = await getSlackSigningSecret();
  const isValid = verifySlackSignature(signingSecret, body, timestamp, signature);
  if (!isValid) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  // Slack は application/x-www-form-urlencoded で payload を送る
  const params = new URLSearchParams(body);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return { statusCode: 400, body: "Bad Request" };
  }

  const payload = JSON.parse(payloadStr);

  // ボタン操作のみ処理
  if (payload.type !== "block_actions") {
    return { statusCode: 200, body: "" };
  }

  const action = payload.actions?.[0];
  if (!action) {
    return { statusCode: 200, body: "" };
  }

  const { requestId, reply } = JSON.parse(action.value) as {
    requestId: string;
    reply: string;
  };

  // ユーザーが操作した → CANCELLED にしてsenderのべき等処理で止める
  await ddb.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE,
      Key: { requestId },
      UpdateExpression: "SET #s = :s, userReply = :r, repliedAt = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "CANCELLED",
        ":r": reply,
        ":t": new Date().toISOString(),
      },
    })
  );

  // Slack は 200 を返さないとリトライしてくる
  return { statusCode: 200, body: "" };
};
