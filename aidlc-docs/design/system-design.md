# MyMom — 全体設計書（v2）

> **更新概要**: 通知チャネルを Slack → Email に変更。Cognito 認証・Web フロントエンドを追加。チャネル抽象化により将来の Slack / LINE 拡張に対応。

---

## プロダクトコンセプト（変更なし）

> **「人をダメにするシステム」**
> MyMom が先回りして意思決定・行動を代行し、失敗の責任を肩代わりするプッシュ型サービス。

```
ユーザーが知る前に → MyMomが検知 → MyMomが判断 → MyMomが実行 → ユーザーに「やっておいたよ」通知
```

---

## アーキテクチャ全体図

```
[Web App (React)]
  │  Cognito 認証 (JWT)
  ├── POST /chat          → chat-handler Lambda
  ├── GET  /cancel?token= → interaction-handler Lambda
  └── WebSocket /ws       → chat-handler Lambda（リアルタイム）

[Amazon EventBridge]
  ├── 1分 cron            → cognito-poller Lambda
  └── 週次 cron           → personality-analyzer Lambda

[cognito-poller]
  Cognito から全ユーザー取得
  → 各ユーザーの処理タスクを確認
  → DynamoDB mymom-requests に INSERT
        ↓ DynamoDB Streams
[analyzer]
  Bedrock Agent で AI 判断
  → SQS DelayQueue (3秒)
        ↓
[sender]
  DynamoDB status 確認 (PENDING?)
  → Notifier (channel = EMAIL) で SES 送信
    ・取り消しリンク付きメール
    ・「断っておいたよ」通知メール

[interaction-handler]
  GET /cancel?token=xxx
  → DynamoDB status = CANCELLED

[sla-handler]
  5分タイムアウト後
  → Notifier (channel = EMAIL) で謝罪メール送信

[personality-analyzer]
  チャット履歴 + 判断ログ → Bedrock → プロファイル更新

[Notification Channel 抽象層]
  ├── email.ts   ← 現在実装（SES）
  ├── slack.ts   ← 将来
  └── line.ts    ← 将来
```

---

## 機能一覧

### FR-01: メール断り代行（MVP・デモコア）

Cognito に登録したユーザーのタスクを MyMom が能動的に監視し、判断・代行する。

| ステップ | 処理 |
|---------|------|
| 1 | EventBridge 1分 cron → cognito-poller が全ユーザーのタスクを確認 |
| 2 | Bedrock Agent がユーザープロファイル・コンテキストを分析 |
| 3 | Bedrock Guardrails が倫理審査（ハラスメント・違法コンテンツをブロック） |
| 4 | 「断るべき」と判断し、角が立たない断り文を生成 |
| 5 | ユーザーの承認なしに SES でメール自動送信（3秒取り消しウィンドウあり） |
| 6 | ユーザーへの通知は「断っておいたよ」メールのみ |

**取り消しウィンドウ**: メール本文中の `https://api.mymom.app/cancel?token=<uuid>` リンクを3秒以内にクリックでキャンセル

### FR-02: 倫理フィルタ（変更なし）

- Bedrock Guardrails をエージェントに直接アタッチ
- ブロック時: SNS 経由でエスカレーション、自動送信しない

### FR-03: チャット UI + スマートクイックリプライ

- Web App (React) からリアルタイムチャット（WebSocket）
- Bedrock が回答本文 + 次の 2 択候補を構造化 JSON で返す
- UI: 回答 + タップ可能な 2 択ボタン（編集可）+ 自由入力欄
- チャット履歴は DynamoDB に保存（TTL: 90日）

```
[AI 回答]
「来週の歓迎会、断っておいたよ。」

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

- MyMom の判断が誤りで失敗が発生した場合、謝罪メールを自動送信
- ユーザーには「対処しておいたよ」通知メール

### FR-08: 自動化レベル設定 + 信頼度プログレッション

#### 自動化レベル（設定画面で変更可）

| レベル | 名前 | チャットでの表示 | 動作 |
|--------|------|----------------|------|
| 1 | 確認モード | 下書きプレビュー + 「送る」ボタン | ユーザーが承認するまで送信しない |
| 2 | プレビューモード（デフォルト） | 下書きプレビュー + カウントダウン | 3秒後に自動送信（取り消し可） |
| 3 | 全自動モード | 「やっといたよ」通知のみ | 送信済み、文面は履歴から確認可 |

**チャット UI イメージ（レベル別）**

```
【レベル1: 確認モード】
MyMom: 来週の歓迎会、こんな感じで断ろうと思うんだけど確認して。
  ┌──────────────────────────────────┐
  │ お疲れ様です。誠に恐れ入りますが…  │
  │                        [編集する] │
  └──────────────────────────────────┘
  [送る]  [やめとく]

【レベル2: プレビューモード】
MyMom: 断り文送るね。3秒後に自動送信するよ。
  ┌──────────────────────────────────┐
  │ お疲れ様です。誠に恐れ入りますが…  │
  └──────────────────────────────────┘
  [取り消す]  ██████████░░░░ 3秒

【レベル3: 全自動モード】
MyMom: 来週の歓迎会、断っといたよ。
  [送信済みの文面を見る]
```

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
  MyMom: 「最近キャンセル多いね。確認モードに
          戻した方がいいかも。」
  [確認モードに戻す]  [このままでいい]
```

**スコアと信頼委任段階の対応**

```
スコア  0〜29: 第1段階「便利だな」← 確認モード推奨
スコア 30〜69: 第2段階「MyMomが見てるからいい」← プレビューモード
スコア 70〜100: 第3段階「MyMomなしで何をすればいいか分からない」← 全自動
```

#### 実装ポイント

- 信頼度スコアは `mymom-users` テーブルの `trustScore` フィールドで管理
- レベルアップ提案は sender Lambda が送信完了後にスコアを更新し、閾値超えたら chat WebSocket 経由でプッシュ
- 設定変更は `/settings` 画面 + チャット内の返答ボタン両方から可能

---

### FR-06: オンボーディング・Cognito 認証

1. Web App でメールアドレス登録（Cognito）
2. MyMom からウェルカムメール送信
3. 自動実行モードは登録直後から ON

---

## コンポーネント設計

### Lambda 関数（8本）

| 関数名 | トリガー | 責務 | Timeout | Memory |
|--------|---------|------|---------|--------|
| `cognito-poller` | EventBridge 1分 | Cognito 全ユーザー取得 → タスク確認 → DynamoDB 登録 | 30s | 256MB |
| `analyzer` | DynamoDB Streams | Bedrock InvokeAgent → 断り文生成 → SQS 送信 | 60s | 512MB |
| `sender` | SQS (Delay 3秒) | status 確認 → Notifier でメール送信 → ログ記録 | 30s | 256MB |
| `interaction-handler` | API Gateway GET /cancel | 取り消しトークン検証 → status=CANCELLED | 3s | 128MB |
| `sla-handler` | Lambda Invoke (sender から) | 謝罪メール送信・リカバリ実行 | 120s | 512MB |
| `chat-handler` | API Gateway WebSocket / POST /chat | チャット応答 + クイックリプライ生成 | 30s | 512MB |
| `personality-analyzer` | EventBridge 週次 | 行動分析 → パーソナリティスコア更新 | 300s | 512MB |
| `auth-handler` | Cognito Post Confirmation Trigger | 新規登録後にウェルカムメール送信 | 10s | 128MB |

### 通知チャネル抽象層

```typescript
// src/lambda/shared/notifier/interface.ts
interface Notifier {
  sendDecisionNotice(to: string, body: string, cancelUrl: string): Promise<void>;
  sendApologyNotice(to: string, body: string): Promise<void>;
  sendInfoNotice(to: string, body: string): Promise<void>;
}

// 実装
// src/lambda/shared/notifier/email.ts   ← 現在（SES）
// src/lambda/shared/notifier/slack.ts   ← 将来
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
/login           ← Cognito ホステッド UI またはカスタム
/chat            ← メイン画面（チャット + プッシュ通知履歴）
/profile         ← パーソナリティカード
/settings        ← お母さんモード ON/OFF・通知設定
```

### チャット画面コンポーネント

```
<ChatPage>
  <NotificationBanner />       ← MyMom からのプッシュ通知表示
  <MessageList>
    <MessageBubble />           ← ユーザー / AI
  </MessageList>
  <QuickReplyButtons>           ← 2択サジェスト（編集可）
  <FreeInputBox />              ← 自由入力
</ChatPage>
```

---

## インフラ設計

### AWS サービス構成

| サービス | 用途 |
|---------|------|
| Amazon Cognito | ユーザー認証・メールアドレス管理 |
| Amazon SES | メール送受信（送信元: SSM で管理） |
| Amazon API Gateway (HTTP) | REST エンドポイント |
| Amazon API Gateway (WebSocket) | チャットリアルタイム通信 |
| Amazon DynamoDB | 全データ永続化 |
| Amazon SQS | 3秒 Delay キュー |
| Amazon EventBridge | cron トリガー |
| Amazon Bedrock | AI 判断・テキスト生成 |
| AWS S3 + CloudFront | Web App ホスティング |
| AWS Secrets Manager | シークレット管理 |
| AWS SSM Parameter Store | 設定値管理 |

### SSM パラメータ

| キー | 値 |
|-----|-----|
| `/mymom/hackathon/sender_email` | SES 送信元メールアドレス |
| `/mymom/hackathon/bedrock_agent_id` | Bedrock Agent ID |
| `/mymom/hackathon/bedrock_agent_alias_id` | Bedrock Agent Alias ID |
| `/mymom/hackathon/bedrock_guardrail_id` | Bedrock Guardrail ID |

### DynamoDB テーブル

| テーブル名 | 用途 | PK / SK |
|-----------|------|---------|
| `mymom-users` | ユーザー情報・設定 | `userId` |
| `mymom-requests` | 断り代行リクエスト | `requestId` |
| `mymom-chat-messages` | チャット履歴（TTL: 90日） | `userId` / `timestamp` |
| `mymom-personality-profiles` | パーソナリティプロファイル | `userId` |
| `mymom-judgement-logs` | 判断ログ | `requestId` |
| `mymom-dependency-scores` | 依存度スコア | `userId` |
| `mymom-sla-records` | 責任 SLA レコード | `requestId` |
| `mymom-ws-connections` | WebSocket 接続管理 | `connectionId` |

---

## データフロー（プッシュ型・メール版）

```
[EventBridge 1分]
  → cognito-poller
      Cognito ListUsers → 全ユーザー取得
      各ユーザーの処理タスクを確認
      DynamoDB mymom-requests に PUT (status=PENDING)
  → DynamoDB Streams → analyzer
      Bedrock Agent (InvokeAgent)
        → Guardrails (倫理審査)
        → Claude 3.5 Sonnet (断り文生成)
      SQS SendMessage (DelaySeconds=3)
      取り消しトークン生成 → DynamoDB 保存
  → SQS (3秒後) → sender
      DynamoDB GetItem (status == PENDING?)
      CANCELLED → return（べき等処理）
      PENDING →
        Notifier.sendDecisionNotice(
          to: Cognito email,
          body: "断り文...",
          cancelUrl: "https://api.mymom.app/cancel?token=xxx"
        )
        DynamoDB UpdateItem (status=COMPLETED)
        Notifier.sendInfoNotice("断っておいたよ")
        EventBridge → sla-handler (5分後)

[GET /cancel?token=xxx]
  → interaction-handler
      DynamoDB UpdateItem (status=CANCELLED)
      → sender は CANCELLED を検知してスキップ
```

---

## 将来拡張（チャネル追加）

```
ユーザー設定で通知チャネルを選択:

mymom-users.notificationChannel = "email" | "slack" | "line"

sender / sla-handler:
  const notifier = NotifierFactory.create(user.notificationChannel);
  await notifier.sendDecisionNotice(...);
```

Slack / LINE を追加する際の変更範囲:
- `src/lambda/shared/notifier/slack.ts`（新規）または `line.ts`（新規）のみ
- sender / sla-handler のコアロジックは変更不要

---

## 実装ユニット（推奨着手順）

| # | ユニット | 内容 | 優先度 |
|---|---------|------|--------|
| 1 | `infra-base` | Cognito・SES・S3・CloudFront の Terraform | 高 |
| 2 | `email-decline-agent` | dm_poller → cognito-poller 置き換え・Notifier Email 実装 | 高（デモコア） |
| 3 | `web-frontend` | React チャット画面・Cognito 認証 | 高 |
| 4 | `chat-feature` | chat-handler WebSocket・クイックリプライ | 中 |
| 5 | `personality-analyzer` | 週次分析・プロファイルカード | 低 |

---

## 非機能要件

| 要件 | 目標 |
|------|------|
| チャット応答 | ≤ 5秒 (p99) |
| プッシュ通知遅延 | ≤ 90秒（1分 cron + Bedrock 30秒） |
| 取り消しウィンドウ | 3秒（SQS DelaySeconds=3） |
| 可用性 SLO | 99.9% |
| MVP コスト | < $1/月 |
| データ保持 | 90日（ユーザー設定で 30〜180日） |
