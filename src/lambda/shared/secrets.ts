import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

const cache = new Map<string, string>();

export async function getSecret(secretArn: string): Promise<string> {
  if (cache.has(secretArn)) return cache.get(secretArn)!;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const value = res.SecretString ?? "";
  cache.set(secretArn, value);
  return value;
}

export async function getSlackBotToken(): Promise<string> {
  const raw = await getSecret(process.env.SLACK_BOT_TOKEN_SECRET!);
  return JSON.parse(raw).token as string;
}

export async function getSlackSigningSecret(): Promise<string> {
  const raw = await getSecret(process.env.SLACK_SIGNING_SECRET_SECRET!);
  return JSON.parse(raw).secret as string;
}
