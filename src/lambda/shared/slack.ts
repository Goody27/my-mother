import { WebClient } from "@slack/web-api";
import { createHmac, timingSafeEqual } from "crypto";
import { getSlackBotToken } from "./secrets";

let _client: WebClient | null = null;

export async function getSlackClient(): Promise<WebClient> {
  if (!_client) {
    const token = await getSlackBotToken();
    _client = new WebClient(token);
  }
  return _client;
}

export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  // リプレイ攻撃防止: タイムスタンプが5分以上古い場合は拒否
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
