import { APIGatewayProxyHandler } from "aws-lambda";

// chat-handler は Unit 2（チャットUI）で実装予定
export const handler: APIGatewayProxyHandler = async () => {
  return { statusCode: 501, body: "Not Implemented" };
};
