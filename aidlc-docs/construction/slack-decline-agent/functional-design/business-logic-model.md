# 機能設計 — slack-decline-agent

## ロバストネス図

ICONIXのロバストネス分析。UCを「Boundary / Control / Entity」に分解し、
実装の責務を明確にする。

```mermaid
graph TD
    USER([👤 ユーザー])
    ADMIN([👤 サービス運営担当者])

    subgraph Boundary["🔲 Boundary（外部接点）"]
        B1[EventBridge\nスケジューラ]
        B2[Slack API\nDM受信]
        B3[Slack API\n返信送信]
        B4[3秒カウントダウン\n画面]
        B5[「断っておいたよ」\n通知]
    end

    subgraph Control["⚙️ Control（ロジック）"]
        C1(DMポーリング\nController)
        C2(Bedrock Agent\n分析Controller)
        C3(倫理フィルタ\nController)
        C4(断り文生成\nController)
        C5(カウントダウン\nController)
        C6(自動送信\nController)
        C7(依存度スコア\n更新Controller)
        C8(エスカレーション\nController)
    end

    subgraph Entity["🗄️ Entity（データ）"]
        E1[(依頼情報)]
        E2[(判断ログ)]
        E3[(お母さん\nキャラクター設定)]
        E4[(プラン情報)]
        E5[(依存度スコア)]
        E6[(ユーザー情報)]
    end

    B1 -->|定期トリガー| C1
    C1 -->|DM取得| B2
    B2 -->|受信DM| C1
    C1 -->|依頼登録 状態:検知済み| E1

    E1 -->|依頼内容| C2
    E3 -->|キャラ設定| C2
    E6 -->|ユーザーコンテキスト| C2
    C2 -->|Bedrock InvokeAgent| C3

    C3 -->|倫理OK| C4
    C3 -->|倫理NG| C8
    C8 -->|エスカレーション通知| ADMIN

    E4 -->|プラン区分| C4
    C4 -->|断り文生成完了| C5

    C5 -->|3秒カウントダウン表示| B4
    B4 -->|取り消し操作| C5
    C5 -->|取り消しなし→実行| C6
    C5 -->|取り消し→キャンセル| E1

    C6 -->|Slack返信送信| B3
    C6 -->|状態:実行済み更新| E1
    C6 -->|判断ログ記録| E2
    E2 -->|実行記録| C7
    C7 -->|依存度スコア更新| E5
    C6 -->|やっておいたよ通知| B5
    B5 -->|通知受信| USER

    style Boundary fill:#dbeafe,stroke:#3b82f6
    style Control fill:#fef3c7,stroke:#f59e0b
    style Entity fill:#dcfce7,stroke:#22c55e
```

---

## シーケンス図

```mermaid
sequenceDiagram
    participant EB as EventBridge<br/>Scheduler
    participant Poll as Lambda<br/>dm-poller
    participant Slack as Slack API
    participant DBReq as DynamoDB<br/>mymom-requests
    participant DBUser as DynamoDB<br/>mymom-users<br/>mymom-characters
    participant Analyze as Lambda<br/>analyzer
    participant Agent as Bedrock Agent
    participant Guard as Bedrock<br/>Guardrails
    participant Claude as Claude<br/>3.5 Sonnet
    participant SQS as SQS<br/>DelayQueue
    participant Send as Lambda<br/>sender
    participant DBLog as DynamoDB<br/>mymom-judgement-logs<br/>mymom-dependency-scores
    participant User as ユーザー

    EB->>Poll: スケジュールトリガー（1分毎）
    Poll->>Slack: conversations.history（未読DM取得）
    Slack-->>Poll: DM一覧
    Poll->>DBReq: PutItem（状態:検知済み, requestId=UUID）
    Note over DBReq: DynamoDB Streams が変更を検知

    DBReq->>Analyze: Streams トリガー（INSERT）
    Analyze->>DBReq: GetItem（依頼情報）
    Analyze->>DBUser: GetItem（ユーザー情報 + キャラクター設定）
    Analyze->>DBReq: UpdateItem（状態:分析中）

    Analyze->>Agent: InvokeAgent（依頼内容 + ユーザーコンテキスト注入）
    Note over Agent: Bedrock Agentが<br/>自律的に判断・生成を実行<br/>（トレースログがCloudWatchに残る）
    Agent->>Guard: ApplyGuardrail（倫理審査）

    alt 倫理NG（ハラスメント等）
        Guard-->>Agent: GUARDRAIL_INTERVENED
        Agent-->>Analyze: エラー
        Analyze->>DBReq: UpdateItem（状態:失敗, 倫理フィルタ:ブロック）
        Analyze->>Slack: chat.postMessage（運営担当者へエスカレーション）
    else 倫理OK
        Guard-->>Agent: 通過
        Agent->>Claude: InvokeModel（断り文生成 + キャラクター設定）
        Claude-->>Agent: 断り文
        Agent-->>Analyze: 断り文 + 判断結果
        Analyze->>DBReq: UpdateItem（状態:PENDING, 実行内容=断り文）
    end

    Analyze->>Slack: chat.postMessage（取り消しボタン付き通知 → ユーザー）
    Note over Slack,User: 「断っておこうか？ 3秒後に送ります」
    Slack-->>User: インタラクティブ通知

    Analyze->>SQS: SendMessage（DelaySeconds=3, requestId）
    Note over SQS: 3秒のカウントダウン開始

    alt 3秒以内に取り消し
        User->>Slack: 取り消しボタン押下
        Slack->>Analyze: インタラクションイベント（API Gateway経由）
        Note over Analyze: ReceiptHandleが取得不可のためSQS DeleteMessageは使わない
        Analyze->>DBReq: UpdateItem（状態:CANCELLED）
        Analyze->>Slack: chat.postMessage（「取り消しました」）
    else 3秒経過・取り消しなし
        SQS->>Send: メッセージ受信（自動トリガー）
        Send->>DBReq: GetItem（status確認）
        Note over Send: status == CANCELLED なら即リターン（べき等処理）
        Send->>Slack: chat.postMessage（相手方へ断り文送信）
        Slack-->>Send: 送信完了
        Send->>DBReq: UpdateItem（状態:COMPLETED, 実行日時）
        Send->>DBLog: PutItem（判断ログ）
        Send->>DBLog: UpdateItem（依存度スコア再算出）
        Send->>Slack: chat.postMessage（ユーザーへ「断っておいたよ」）
        Slack-->>User: 完了通知
    end
```

---

## データフロー詳細

```
EventBridge Scheduler（1分間隔）
  │
  ▼
Lambda: dm-poller
  ├─► Slack API conversations.history（未読DM取得）
  └─► DynamoDB mymom-requests PutItem
        状態: 検知済み
        requestId: UUID
        userId, channelId, messageText, receivedAt
          │
          ▼（DynamoDB Streams）
Lambda: analyzer
  ├─► DynamoDB mymom-users GetItem（ユーザー情報・コンテキスト）
  ├─► DynamoDB mymom-characters GetItem（お母さんキャラクター設定）
  ├─► DynamoDB mymom-requests UpdateItem（状態: 分析中）
  │
  └─► Bedrock Agent InvokeAgent
        ├─► Bedrock Guardrails ApplyGuardrail（倫理審査）
        │     倫理NG → SNS Publish → エスカレーション
        │     倫理OK ↓
        └─► Claude 3.5 Sonnet InvokeModel
              システムプロンプト: お母さんキャラクター設定
              ユーザープロンプト: 依頼内容 + ユーザーコンテキスト
              → 断り文生成
  │
  ├─► Slack API chat.postMessage（取り消しボタン付き通知 → ユーザー）
  └─► SQS SendMessage（DelaySeconds=3, 依頼IDをbody）

  ─── 3秒以内に取り消し操作 ────────────────────────────────
  Slack interaction → API Gateway → Lambda: interaction-handler
    ├─► X-Slack-Signature 検証（HMAC-SHA256）不一致→403
    ├─► DynamoDB mymom-requests UpdateItem（状態: CANCELLED）
    │     ※ SQS DeleteMessage は DelaySeconds中にReceiptHandleを
    │       取得できないため、DynamoDB statusフラグで排他制御する
    └─► Slack API chat.postMessage（「取り消しました」確認通知）

  ─── 3秒経過・取り消しなし ──────────────────────────────────
  SQS → Lambda: sender
    ├─► DynamoDB mymom-requests GetItem（status確認）
    │     CANCELLED なら即リターン（べき等処理）
    ├─► Slack API chat.postMessage（相手方に断り文送信）
    ├─► DynamoDB mymom-requests UpdateItem（状態: COMPLETED, 実行日時）
    ├─► DynamoDB mymom-judgement-logs PutItem（判断記録）
    ├─► DynamoDB mymom-dependency-scores UpdateItem（依存度再算出）
    └─► Slack API chat.postMessage（ユーザーへ「断っておいたよ」通知）
```

---

## Bedrock Agent設定

```json
{
  "agentName": "mymom-agent",
  "foundationModel": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "instruction": "あなたはユーザーのお母さんAIです。（キャラクター設定はDynamoDBから動的注入）",
  "guardrailConfiguration": {
    "guardrailId": "mymom-ethics-guardrail",
    "guardrailVersion": "1"
  },
  "actionGroups": [
    {
      "actionGroupName": "getUserContext",
      "description": "DynamoDBからユーザーのスケジュール・コンテキストを取得"
    },
    {
      "actionGroupName": "generateDeclineMessage",
      "description": "キャラクター設定に基づいて断り文を生成"
    },
    {
      "actionGroupName": "logJudgement",
      "description": "判断結果をmymom-judgement-logsに記録"
    }
  ]
}
```

---

## ビジネスルール

| ルール | 説明 |
|--------|------|
| BR-01 | Guardrailsを通過しない限り、どんな文も外部に送信しない |
| BR-02 | status=CANCELLEDはsender Lambdaで必ずチェックし、送信しない |
| BR-03 | 依存度スコアは送信完了のたびに再算出する |
| BR-04 | スコア80超・14日継続で離脱防止通知を送信する |
| BR-05 | プラン月間実行上限を超過した場合は処理しない（無料プラン3回/月） |
| BR-06 | メンタルヘルス関連の判断は人間エスカレーション必須 |

---

## Boundary / Control / Entity 対応表

### Boundary（外部接点）

| Boundary | 役割 | 実装 |
|----------|------|------|
| EventBridgeスケジューラ | 定期ポーリングのトリガー | Amazon EventBridge Scheduler |
| Slack API DM受信 | ユーザーのDMを取得 | Slack Web API `conversations.history` |
| Slack API 返信送信 | 断り文を相手に送信 | Slack Web API `chat.postMessage` |
| 3秒カウントダウン画面 | 取り消しウィンドウUI | Slack Block Kit（インタラクティブ通知） |
| 「断っておいたよ」通知 | 実行完了をユーザーに通知 | Slack DM toユーザー |

### Control（ロジック）

| Control | 役割 | 実装 |
|---------|------|------|
| DMポーリングController | EventBridgeからSlack APIを叩いてDM取得 | Lambda mymom-dm-poller |
| Bedrock Agent分析Controller | ユーザーコンテキスト＋DM内容を渡し判断 | Lambda mymom-analyzer + Bedrock Agent |
| 倫理フィルタController | 生成文の倫理審査 | Bedrock Guardrails |
| 断り文生成Controller | お母さんキャラクターで断り文生成 | Claude 3.5 Sonnet |
| カウントダウンController | 3秒タイマー管理・キャンセル受付 | Lambda + SQS delay + DynamoDB状態フラグ |
| 自動送信Controller | Slack APIで返信送信・ログ記録 | Lambda mymom-sender |
| 依存度スコア更新Controller | 実行回数・委任率から依存度を再算出 | Lambda mymom-sender内 |
| エスカレーションController | 倫理NG時に運営へ通知 | Lambda → SNS |

### Entity（データ）

| Entity | CRUD | DynamoDBテーブル |
|--------|------|-----------------|
| 依頼情報 | C, R, U | `mymom-requests` |
| 判断ログ | C, R | `mymom-judgement-logs` |
| お母さんキャラクター設定 | R | `mymom-characters` |
| プラン情報 | R | `mymom-plans` |
| 依存度スコア | R, U | `mymom-dependency-scores` |
| ユーザー情報 | R | `mymom-users` |
