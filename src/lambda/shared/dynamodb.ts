import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
export const ddb = DynamoDBDocumentClient.from(client);

export const Tables = {
  REQUESTS: process.env.REQUESTS_TABLE ?? "mymom-requests",
  USERS: process.env.USERS_TABLE ?? "mymom-users",
  CHARACTERS: process.env.CHARACTERS_TABLE ?? "mymom-characters",
  JUDGEMENT_LOGS: process.env.JUDGEMENT_LOGS_TABLE ?? "mymom-judgement-logs",
  DEPENDENCY_SCORES: process.env.DEPENDENCY_SCORES_TABLE ?? "mymom-dependency-scores",
  PLANS: process.env.PLANS_TABLE ?? "mymom-plans",
  SLA_RECORDS: process.env.SLA_RECORDS_TABLE ?? "mymom-sla-records",
  CHAT_MESSAGES: process.env.CHAT_MESSAGES_TABLE ?? "mymom-chat-messages",
  PERSONALITY_PROFILES: process.env.PERSONALITY_PROFILES_TABLE ?? "mymom-personality-profiles",
} as const;

export { GetCommand, PutCommand, UpdateCommand, QueryCommand };
