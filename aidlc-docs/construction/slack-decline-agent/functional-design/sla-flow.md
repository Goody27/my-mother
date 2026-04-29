# 機能設計 — 責任SLAフロー

MyMomの自動実行が失敗した場合に発動する謝罪・リカバリフロー。

## ロバストネス図

```mermaid
graph TD
    USER([👤 ユーザー])
    ADMIN([👤 サービス運営担当者])
    COUNTER([👤 相手方])

    subgraph Boundary["🔲 Boundary（外部接点）"]
        B1[Slack API\nエラーレスポンス]
        B3[失敗通知\nSlack DM]
        B4[謝罪文送信\nSlack]
        B5[リカバリ完了\n通知]
        B6[エスカレーション\n通知]
    end

    subgraph Control["⚙️ Control（ロジック）"]
        C1(失敗検知\nController)
        C2(プラン確認\nController)
        C3(失敗原因分析\nController)
        C4(SLA発動\nController)
        C5(謝罪文生成\nController)
        C6(謝罪文送信\nController)
        C7(リカバリ手順決定\nController)
        C8(リカバリ実行\nController)
        C9(SLA解決\nController)
        C10(エスカレーション\nController)
    end

    subgraph Entity["🗄️ Entity（データ）"]
        E1[(依頼情報)]
        E2[(プラン情報)]
        E3[(責任SLAレコード)]
        E4[(判断ログ)]
        E5[(お母さん\nキャラクター設定)]
        E6[(ユーザー情報)]
    end

    B1 -->|送信失敗| C1
    C1 -->|依頼状態:失敗 更新| E1
    C1 -->|プラン照会| C2
    E2 -->|プラン区分| C2
    C2 -->|エスカレーション| C10
    C10 -->|手動対応依頼| B6
    B6 -->|通知| ADMIN
    C2 -->|SLA発動| C3
    E1 -->|失敗依頼内容| C3
    E4 -->|判断ログ| C3
    C3 -->|Bedrock 失敗原因分析| C4
    C4 -->|SLAレコード作成 状態:発動中| E3
    C4 -->|ユーザーへ失敗通知| B3
    B3 -->|通知受信| USER
    E5 -->|キャラクター設定| C5
    E6 -->|ユーザーコンテキスト| C5
    C4 -->|謝罪文生成依頼| C5
    C5 -->|Bedrock 謝罪文生成| C6
    C6 -->|謝罪文送信（相手方）| B4
    B4 -->|送信完了| COUNTER
    C6 -->|謝罪記録更新| E3
    C6 -->|リカバリ手順決定依頼| C7
    C7 -->|Bedrock リカバリ手順決定| C8
    C8 -->|リカバリアクション実行| B4
    C8 -->|リカバリ内容記録| E3
    C8 -->|解決確認| C9
    C9 -->|SLAレコード状態:解決済み| E3
    C9 -->|ユーザーへリカバリ完了通知| B5
    B5 -->|通知受信| USER

    style Boundary fill:#dbeafe,stroke:#3b82f6
    style Control fill:#fef3c7,stroke:#f59e0b
    style Entity fill:#dcfce7,stroke:#22c55e
```

---

## シーケンス図

```mermaid
sequenceDiagram
    participant Send as Lambda<br/>sender
    participant Slack as Slack API
    participant DBReq as DynamoDB<br/>mymom-requests
    participant DBPlan as DynamoDB<br/>mymom-plans
    participant SLA as Lambda<br/>sla-handler
    participant DBSLA as DynamoDB<br/>mymom-sla-records
    participant DBLog as DynamoDB<br/>mymom-judgement-logs
    participant Claude as Bedrock<br/>Claude
    participant SNS as SNS
    participant User as ユーザー
    participant Counter as 相手方
    participant Admin as 運営担当者

    Send->>Slack: chat.postMessage（断り文送信）
    Slack-->>Send: エラーレスポンス

    Send->>DBReq: UpdateItem（状態:失敗）
    Send->>SLA: Invoke（requestId, userId, エラー内容）

    SLA->>DBPlan: GetItem（userId）
    DBPlan-->>SLA: プラン情報

    SLA->>DBLog: GetItem（関連判断ログ）
    opt エスカレーション判定
        SLA->>SNS: Publish（エスカレーション通知）
        SNS->>Slack: chat.postMessage（運営担当者チャンネル）
        Slack-->>Admin: 手動対応依頼通知
    end
    Note over SLA: SLA発動
        SLA->>DBLog: GetItem（関連判断ログ）
        SLA->>Claude: InvokeModel（失敗原因分析）
        Claude-->>SLA: 失敗原因レポート

        SLA->>DBSLA: PutItem（SLAレコード 状態:発動中）
        SLA->>Slack: chat.postMessage（ユーザーへ失敗+SLA発動通知）
        Slack-->>User: 「失敗しました。謝罪・リカバリを実行します」

        SLA->>Claude: InvokeModel（謝罪文生成 + キャラクター設定注入）
        Claude-->>SLA: 謝罪文

        SLA->>Slack: chat.postMessage（相手方へ謝罪文）
        Slack-->>Counter: 謝罪文受信
        SLA->>DBSLA: UpdateItem（謝罪送信日時）

        SLA->>Claude: InvokeModel（リカバリ手順決定）
        Claude-->>SLA: リカバリ手順

        SLA->>Slack: chat.postMessage（リカバリアクション実行）
        Slack-->>Counter: リカバリメッセージ
        SLA->>DBSLA: UpdateItem（リカバリ内容）

        SLA->>DBSLA: UpdateItem（状態:解決済み, 解決日時）
        SLA->>Slack: chat.postMessage（ユーザーへリカバリ完了通知）
        Slack-->>User: 「対処しておいたよ」
```

---

## Bedrock呼び出し一覧

| 呼び出し目的 | API | 内容 |
|------------|-----|------|
| 失敗原因分析 | `InvokeModel` | エラー内容から原因を特定（権限エラー・送信先不存在・ネットワーク障害等） |
| 謝罪文生成 | `InvokeModel` | お母さんキャラクター設定を注入した謝罪文 |
| リカバリ手順決定 | `InvokeModel` | 再送信・代替チャンネル・手動対応案内から最適手順を選択 |

## DynamoDBテーブル: mymom-sla-records

| 属性 | 型 | 説明 |
|------|----|------|
| `slaId` | String（PK） | UUID |
| `requestId` | String（GSI） | 関連依頼ID |
| `userId` | String | ユーザーID |
| `activationReason` | String | 失敗原因（Bedrock分析結果） |
| `apologySentAt` | String | 謝罪文送信日時（ISO8601） |
| `recoveryContent` | String | リカバリ手順・実行内容 |
| `resolvedAt` | String | 解決日時（ISO8601） |
| `status` | String | `未発動` / `発動中` / `解決済み` |
