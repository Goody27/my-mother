# MyMom — 全体設計書（v3）

> **更新概要**: 通知チャネルを Slack に戻す（Email より実装が容易でデモ映えする）。Web App (React) + Cognito 認証を追加。チャネル抽象化により将来の Email / LINE 拡張に対応。

---

## プロダクトコンセプト

> **「人をダメにするシステム」**
> MyMom が先回りして意思決定・行動を代行し、失敗の責任を肩代わりするプッシュ型サービス。

```
ユーザーが知る前に → MyMomが検知 → MyMomが判断 → MyMomが実行 → ユーザーに「やっておいたよ」通知
```

---

## アーキテクチャ全体図

```
[Slack]                          [Web App (React + Cognito)]
  │ DM着信                         │ チャット / 設定 / プロファイル
  │                                 │ WebSocket / REST
  ▼                                 ▼
[Amazon EventBridge 1分 cron]   [API Gateway]
  ↓                               ├── POST /chat       → chat-handler
[dm-poller]                       ├── WebSocket /ws    → chat-handler
  Slack conversations.history     └── POST /interactions → interaction-handler
  → DynamoDB mymom-requests
        ↓ DynamoDB Streams
[analyzer]
  Bedrock Agent (InvokeAgent)
    → Guardrails (倫理審査)
    → Claude 3.5 Sonnet (断り文生成)
  → SQS DelayQueue (DelaySeconds=3)
        ↓ 3秒後
[sender]
  DynamoDB status 確認 (PENDING?)
  → Notifier (channel = SLACK)
    ・相手方へ断り文送信
    ・ユーザーへ「断っておいたよ」通知（取り消しボタン付き）

[interaction-handler]
  Slack Webhook (X-Slack-Signature 検証)
  取り消しボタン → DynamoDB status = CANCELLED

[sla-handler]
  5分タイムアウト後
  → Notifier (channel = SLACK) で謝罪メッセージ送信

[personality-analyzer]
  EventBridge 週次 cron
  チャット履歴 + 判断ログ → Bedrock → プロファイル更新

[Notification Channel 抽象層]
  ├── slack.ts   ← 現在実装
  ├── email.ts   ← 将来（SES）
  └── line.ts    ← 将来
```

---

## 機能一覧

### FR-01: Slack 断り代行（MVP・デモコア）

| ステップ | 処理 |
|---------|------|
| 1 | EventBridge 1分 cron → dm-poller が Slack DM を取得 |
| 2 | Bedrock Agent がユーザープロファイル・コンテキストを分析 |
| 3 | Bedrock Guardrails が倫理審査（ハラスメント・違法コンテンツをブロック） |
| 4 | 「断るべき」と判断し、角が立たない断り文を生成 |
| 5 | ユーザーの承認なしに Slack で自動返信（3秒取り消しウィンドウあり） |
| 6 | ユーザーへの通知は「断っておいたよ」のみ |

### FR-02: 倫理フィルタ

- Bedrock Guardrails をエージェントに直接アタッチ
- ブロック時: SNS 経由でエスカレーション、自動送信しない

### FR-03: チャット UI + スマートクイックリプライ

- Web App (React) からリアルタイムチャット（WebSocket）
- Bedrock が回答本文 + 次の 2 択候補を構造化 JSON で返す
- UI: 回答 + タップ可能な 2 択ボタン（編集可）+ 自由入力欄
- チャット履歴は DynamoDB に保存（TTL: 90日）
- Slack の断り文プレビューもチャット画面内に表示

```
[AI 回答]
「来週の歓迎会、断っておいたよ。」

  ┌──────────────────────────────────────┐
  │ お疲れ様です。誠に恐れ入りますが…    │
  │ 来週の歓迎会は所用のため欠席させて…  │
  │                          [編集する]  │
  └──────────────────────────────────────┘
  ✅ Slack送信済み（3秒前に取り消せました）

[次に聞きたいこと]
  ┌──────────────────────────────────────┐
  │ A. 断り文の内容を見たい              │ ← 編集可
  └──────────────────────────────────────┘
  ┌──────────────────────────────────────┐
  │ B. 今週他に断るべき予定はある？      │ ← 編集可
  └──────────────────────────────────────┘
  [自由入力]___________________________
```

### FR-04: AI パーソナリティ分析・プロファイル

- 判断ログ・チャット履歴を週次で分析（EventBridge 週次 cron）
- 4 スコアを算出: `断り苦手度` `先延ばし傾向` `完璧主義度` `承認欲求度`
- プロファイルを Bedrock の system prompt に注入 → 回答精度向上
- 公開カード生成（オプトイン制）

### FR-05: 責任 SLA

- MyMom の判断が誤りで失敗が発生した場合、Slack で謝罪メッセージを自動送信
- リカバリアクションを自律実行
- ユーザーには「対処しておいたよ」通知のみ

### FR-06: オンボーディング・認証

1. Web App でメールアドレス登録（Cognito）
2. Slack App インストール（Cognito ユーザーと紐付け）
3. MyMom から 1 通目のウェルカム DM 送信
4. 自動実行モードは登録直後から ON

### FR-08: 自動化レベル設定 + 信頼度プログレッション

#### 自動化レベル（設定画面で変更可）

| レベル | 名前 | チャットでの表示 | 動作 |
|--------|------|----------------|------|
| 1 | 確認モード | 下書きプレビュー + 「送る」ボタン | ユーザーが承認するまで Slack 送信しない |
| 2 | プレビューモード（デフォルト） | 下書きプレビュー + カウントダウン | 3秒後に自動送信（取り消し可） |
| 3 | 全自動モード | 「やっといたよ」通知のみ | 送信済み、文面は履歴から確認可 |

#### 信頼度スコア（0〜100）

| アクション | スコア変化 |
|-----------|----------|
| 自動送信をキャンセルしなかった | +2 |
| 「ナイス判断！」などの肯定フィードバック | +5 |
| 「違う、キャンセル」でキャンセル | -3 |
| 手動で文面を大幅に修正して送信 | -1 |

#### MyMom からのレベルアップ提案

```
スコア 30 到達:
  MyMom: 「最近お母さんの判断、ハズれてないよね。
          プレビューなしで自動送信にしてみる？
          いつでも戻せるから。」
  [全自動にする]  [このままでいい]

スコア 70 到達:
  MyMom: 「もうほとんど取り消してないじゃん。
          全部お母さんに任せていいんじゃない？」
  [全自動にする]  [もう少し様子見る]

スコア 10 以下に低下:
  MyMom: 「最近キャンセル多いね。確認モードに戻した方がいいかも。」
  [確認モードに戻す]  [このままでいい]
```

**スコアと信頼委任段階の対応**

```
スコア  0〜29: 第1段階「便利だな」         ← 確認モード推奨
スコア 30〜69: 第2段階「MyMomが見てるからいい」← プレビューモード
スコア 70〜100: 第3段階「MyMomなしで何をすれば」← 全自動
```

---

## コンポーネント設計

### Lambda 関数（8本）

| 関数名 | トリガー | 責務 | Timeout | Memory |
|--------|---------|------|---------|--------|
| `dm-poller` | EventBridge 1分 | Slack DM 取得 → DynamoDB 登録 | 30s | 256MB |
| `analyzer` | DynamoDB Streams | Bedrock InvokeAgent → 断り文生成 → SQS 送信 | 60s | 512MB |
| `sender` | SQS (Delay 3秒) | status 確認 → Notifier で Slack 送信 → ログ記録 | 30s | 256MB |
| `interaction-handler` | API Gateway POST /interactions | X-Slack-Signature 検証 → 取り消しボタン処理 | 3s | 128MB |
| `sla-handler` | Lambda Invoke (sender から) | 謝罪メッセージ送信・リカバリ実行 | 120s | 512MB |
| `chat-handler` | API Gateway WebSocket / POST /chat | チャット応答 + クイックリプライ生成 | 30s | 512MB |
| `personality-analyzer` | EventBridge 週次 | 行動分析 → パーソナリティスコア更新 | 300s | 512MB |
| `auth-handler` | Cognito Post Confirmation Trigger | 新規登録後にウェルカム DM 送信 | 10s | 128MB |

### 通知チャネル抽象層

```typescript
// src/lambda/shared/notifier/interface.ts
interface Notifier {
  sendDecisionNotice(to: string, body: string, cancelToken: string): Promise<void>;
  sendApologyNotice(to: string, body: string): Promise<void>;
  sendInfoNotice(to: string, body: string): Promise<void>;
}

// 実装
// src/lambda/shared/notifier/slack.ts   ← 現在
// src/lambda/shared/notifier/email.ts   ← 将来（SES）
// src/lambda/shared/notifier/line.ts    ← 将来
```

---

## フロントエンド設計

### 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| フレームワーク | React + TypeScript + Vite | 標準・型安全 |
| 認証 | AWS Amplify (Cognito) | バックエンドと統合容易 |
| ホスティング | S3 + CloudFront | AWS ネイティブ・低コスト |
| スタイリング | Tailwind CSS | 高速 UI 構築 |
| WebSocket | API Gateway WebSocket + AWS SDK | リアルタイムチャット |

### 画面構成

```
/login      ← Cognito 認証
/chat       ← メイン（チャット + Slack 通知履歴 + プレビュー）
/profile    ← パーソナリティカード
/settings   ← 自動化レベル設定・Slack 連携
```

### チャット画面コンポーネント

```
<ChatPage>
  <NotificationBanner />    ← MyMom からのプッシュ通知
  <MessageList>
    <MessageBubble />        ← ユーザー / AI
    <ActionPreview />        ← Slack 送信プレビュー（レベル1・2）
  </MessageList>
  <QuickReplyButtons />      ← 2択サジェスト（編集可）
  <FreeInputBox />           ← 自由入力
</ChatPage>
```

---

## インフラ設計

### AWS サービス構成

| サービス | 用途 |
|---------|------|
| Amazon Cognito | ユーザー認証・Web App ログイン |
| Slack API | DM 読み取り・メッセージ送信 |
| Amazon API Gateway (HTTP) | REST エンドポイント・Slack Webhook 受口 |
| Amazon API Gateway (WebSocket) | チャットリアルタイム通信 |
| Amazon DynamoDB | 全データ永続化 |
| Amazon SQS | 3秒 Delay キュー |
| Amazon EventBridge | cron トリガー |
| Amazon Bedrock | AI 判断・テキスト生成 |
| AWS S3 + CloudFront | Web App ホスティング |
| AWS Secrets Manager | Slack Token 等シークレット管理 |
| AWS SSM Parameter Store | 設定値管理 |

### SSM パラメータ

| キー | 値 |
|-----|-----|
| `/mymom/hackathon/slack_bot_token_arn` | Slack Bot Token の Secrets Manager ARN |
| `/mymom/hackathon/slack_signing_secret_arn` | Slack Signing Secret の Secrets Manager ARN |
| `/mymom/hackathon/bedrock_agent_id` | Bedrock Agent ID |
| `/mymom/hackathon/bedrock_agent_alias_id` | Bedrock Agent Alias ID |
| `/mymom/hackathon/bedrock_guardrail_id` | Bedrock Guardrail ID |

### GitHub Actions Secrets

| シークレット名 | 値 |
|---|---|
| `SLACK_BOT_TOKEN_ARN` | Slack Bot Token ARN |
| `SLACK_SIGNING_SECRET_ARN` | Slack Signing Secret ARN |
| `BEDROCK_AGENT_ID` | Bedrock Agent ID |
| `BEDROCK_AGENT_ALIAS_ID` | Alias ID |
| `BEDROCK_GUARDRAIL_ID` | Guardrail ID |
| `AWS_DEPLOY_ROLE_ARN` | Terraform apply 後に取得 |

### DynamoDB テーブル

| テーブル名 | 用途 | PK / SK |
|-----------|------|---------|
| `mymom-users` | ユーザー情報・設定・trustScore | `userId` |
| `mymom-requests` | 断り代行リクエスト | `requestId` |
| `mymom-chat-messages` | チャット履歴（TTL: 90日） | `userId` / `timestamp` |
| `mymom-personality-profiles` | パーソナリティプロファイル | `userId` |
| `mymom-judgement-logs` | 判断ログ | `requestId` |
| `mymom-dependency-scores` | 依存度スコア | `userId` |
| `mymom-sla-records` | 責任 SLA レコード | `requestId` |
| `mymom-ws-connections` | WebSocket 接続管理 | `connectionId` |

---

## データフロー（プッシュ型・Slack版）

```
[EventBridge 1分]
  → dm-poller
      slack.conversations.history → 未処理 DM 取得
      DynamoDB mymom-requests に PUT (status=PENDING)
  → DynamoDB Streams → analyzer
      Bedrock Agent (InvokeAgent)
        → Guardrails (倫理審査)
        → Claude 3.5 Sonnet (断り文生成)
      SQS SendMessage (DelaySeconds=3)
      Web App に WebSocket でプレビュー通知（レベル1・2の場合）
  → SQS (3秒後) → sender
      DynamoDB GetItem (status == PENDING?)
      CANCELLED → return（べき等処理）
      PENDING →
        Notifier.sendDecisionNotice(slackUserId, 断り文, cancelToken)
        DynamoDB UpdateItem (status=COMPLETED)
        Notifier.sendInfoNotice(slackUserId, "断っておいたよ")
        trustScore 更新 → 閾値超えなら WebSocket でレベルアップ提案
        EventBridge → sla-handler (5分後)

[POST /interactions (Slack Webhook)]
  → interaction-handler
      X-Slack-Signature 検証
      取り消しボタン → DynamoDB UpdateItem (status=CANCELLED)
```

---

## 将来拡張（チャネル追加）

```
mymom-users.notificationChannel = "slack" | "email" | "line"

sender / sla-handler:
  const notifier = NotifierFactory.create(user.notificationChannel);
  await notifier.sendDecisionNotice(...);
```

Email / LINE 追加時の変更範囲:
- `src/lambda/shared/notifier/email.ts` または `line.ts` のみ追加
- sender / sla-handler のコアロジックは変更不要

---

## 実装ユニット（推奨着手順）

| # | ユニット | 内容 | 優先度 |
|---|---------|------|--------|
| 1 | `slack-decline-agent` | 既存コードをベースに Notifier 抽象層を導入 | 高（デモコア・ほぼ完成） |
| 2 | `infra-web` | Cognito・S3・CloudFront・WebSocket API の Terraform | 高 |
| 3 | `web-frontend` | React チャット画面・Cognito 認証・プレビュー表示 | 高 |
| 4 | `chat-feature` | chat-handler WebSocket・クイックリプライ | 中 |
| 5 | `personality-analyzer` | 週次分析・プロファイルカード | 低 |

---

## 非機能要件

| 要件 | 目標 |
|------|------|
| DM検知〜Slack返信（E2E） | ≤ 90秒（1分 cron + Bedrock 30秒） |
| チャット応答 | ≤ 5秒 (p99) |
| 取り消しウィンドウ | 3秒（SQS DelaySeconds=3） |
| 可用性 SLO | 99.9% |
| MVP コスト | < $1/月 |
| データ保持 | 90日（ユーザー設定で 30〜180日） |
