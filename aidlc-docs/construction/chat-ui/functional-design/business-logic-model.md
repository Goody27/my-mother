# 機能設計 — chat-ui（チャットUI + クイックリプライ）

## ロバストネス図

```mermaid
graph TD
    USER([👤 ユーザー])

    subgraph Boundary["🔲 Boundary（外部接点）"]
        B1[チャット画面\n（Slack / WebUI）]
        B2[API Gateway\nPOST /chat]
        B3[クイックリプライ\nボタン表示]
    end

    subgraph Control["⚙️ Control（ロジック）"]
        C1(メッセージ受信\nController)
        C2(履歴取得\nController)
        C3(プロファイル注入\nController)
        C4(Bedrock\n構造化出力Controller)
        C5(レスポンス\n返却Controller)
    end

    subgraph Entity["🗄️ Entity（データ）"]
        E1[(チャットメッセージ\n履歴)]
        E2[(パーソナリティ\nプロファイル)]
        E3[(お母さん\nキャラクター設定)]
    end

    USER -->|メッセージ入力| B1
    B1 -->|POST /chat| B2
    B2 -->|受信| C1
    C1 -->|直近10件取得| C2
    C2 -->|クエリ| E1
    E1 -->|履歴| C2
    C2 -->|プロファイル取得| C3
    C3 -->|GetItem| E2
    C3 -->|GetItem| E3
    E2 -->|断り苦手度・先延ばし傾向等| C4
    E3 -->|お母さんの口調| C4
    C4 -->|Bedrock InvokeModel\n（構造化出力）| C5
    C5 -->|reply + quickreplies 保存| E1
    C5 -->|レスポンス返却| B3
    B3 -->|ボタン表示| USER

    style Boundary fill:#dbeafe,stroke:#3b82f6
    style Control fill:#fef3c7,stroke:#f59e0b
    style Entity fill:#dcfce7,stroke:#22c55e
```

---

## シーケンス図

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant APIGW as API Gateway
    participant Chat as Lambda<br/>chat-handler
    participant DBChat as DynamoDB<br/>mymom-chat-messages
    participant DBProfile as DynamoDB<br/>mymom-personality-profiles
    participant DBChar as DynamoDB<br/>mymom-characters
    participant Claude as Bedrock<br/>Claude 3.5 Sonnet

    User->>APIGW: POST /chat { userId, sessionId, message }
    APIGW->>Chat: Invoke

    Chat->>DBProfile: GetItem(userId)
    DBProfile-->>Chat: パーソナリティプロファイル（なければ省略）

    Chat->>DBChar: GetItem(userId)
    DBChar-->>Chat: お母さんキャラクター設定（口調・性格）

    Chat->>DBChat: Query(userId, sessionId, limit=10, sort=desc)
    DBChat-->>Chat: 直近10件のチャット履歴

    Chat->>Claude: InvokeModel（構造化出力）
    Note over Chat,Claude: System: お母さんキャラ設定 + パーソナリティプロファイル注入<br/>User: 履歴10件 + 今回のメッセージ<br/>Output schema: {reply, quickreplies:[str, str]}

    Claude-->>Chat: { "reply": "...", "quickreplies": ["...", "..."] }

    Chat->>DBChat: PutItem（ユーザーメッセージ保存, TTL=90日）
    Chat->>DBChat: PutItem（お母さん返答 + quickreplies保存, TTL=90日）

    Chat-->>APIGW: 200 { reply, quickreplies }
    APIGW-->>User: レスポンス + 2択ボタン表示
```

---

## Bedrock構造化出力スキーマ

```json
{
  "type": "object",
  "properties": {
    "reply": {
      "type": "string",
      "description": "お母さんの返答本文"
    },
    "quickreplies": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 2,
      "maxItems": 2,
      "description": "次の会話候補（必ず2択）"
    }
  },
  "required": ["reply", "quickreplies"]
}
```

---

## クイックリプライ生成ルール

| ルール | 内容 |
|--------|------|
| 常に2択 | 1択・3択以上は禁止 |
| 文脈依存 | Bedrockが会話の流れを読んで動的に生成（固定テンプレート禁止） |
| 行動可能な選択肢 | 選ぶと次の意味ある会話が始まる内容に限定 |
| 選択肢の差別化 | 2択の意味が重複しない |

---

## DynamoDBテーブル: mymom-chat-messages

| 属性 | 型 | 説明 |
|------|----|------|
| `messageId` | String（PK） | UUID |
| `userId` | String | GSI PK |
| `sessionId` | String | GSI SK |
| `senderType` | String | `USER` or `MOM` |
| `content` | String | メッセージ本文 |
| `quickReplyCandidates` | List | 2択文字列（MOMメッセージのみ） |
| `selectedQuickReply` | String | ユーザーがボタンを選択した場合に記録 |
| `quickReplyUsed` | Boolean | 分析用フラグ |
| `sentAt` | String | ISO 8601 |
| `expiresAt` | Number | Unixタイムスタンプ（TTL=90日） |

---

## ビジネスルール

| ルール | 内容 |
|--------|------|
| BR-01 | コンテキストウィンドウは直近10件のみ（トークン効率） |
| BR-02 | パーソナリティプロファイルは存在すれば注入、なければ省略（初期ユーザー対応） |
| BR-03 | チャットメッセージは90日のTTLで自動削除 |
| BR-04 | 自由入力は常に受け付ける（ボタンとの併用） |
| BR-05 | sessionIdでセッション単位の文脈を管理する |
