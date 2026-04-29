# ドメインエンティティ — MyMom

## クラス図

```mermaid
classDiagram
    class ユーザー情報 {
        +String ユーザーID
        +String メールアドレス
        +String 職場
        +String 居住地
        +String 生活パターン
        +DateTime 登録日時
        +UserStatus 状態
    }

    class プラン情報 {
        +String プランID
        +String ユーザーID
        +PlanType プラン区分
        +Number 月間実行回数
        +Number 月間実行上限
        +DateTime 開始日時
        +DateTime 終了日時
        +PlanStatus 状態
    }

    class お母さんキャラクター設定 {
        +String 設定ID
        +String ユーザーID
        +PersonalityType 性格区分
        +String 口調
        +Boolean 有効フラグ
    }

    class 依頼情報 {
        +String 依頼ID
        +String ユーザーID
        +String 依頼種別
        +String 依頼元チャネル
        +String 依頼内容
        +DateTime 受信日時
        +String 実行内容
        +DateTime 実行日時
        +RequestStatus 状態
        +JudgeResult 判断結果
        +EthicsResult 倫理フィルタ結果
    }

    class 判断ログ {
        +String ログID
        +String 依頼ID
        +String ユーザーID
        +String 判断内容
        +JudgeResult 判断結果
        +String 実行結果
        +Boolean フィードバックフラグ
        +DateTime 記録日時
    }

    class 依存度スコア {
        +String スコアID
        +String ユーザーID
        +Number スコア値
        +Number 使用頻度
        +Number 委任率
        +DateTime 算出日時
        +DependencyStatus 状態
    }

    class 責任SLAレコード {
        +String SLA_ID
        +String 依頼ID
        +String ユーザーID
        +String 発動理由
        +DateTime 謝罪送信日時
        +String リカバリ内容
        +DateTime 解決日時
        +SLAStatus 状態
    }

    class パーソナリティプロファイル {
        +String プロファイルID
        +String ユーザーID
        +Number 断り苦手度
        +Number 先延ばし傾向
        +Number 完璧主義度
        +Number 承認欲求度
        +String 主要委任カテゴリ
        +String コミュニケーションスタイル
        +String 活動時間帯
        +Number 分析ベースとなった依頼数
        +String お母さんのコメント
        +DateTime 最終更新日時
        +Boolean 公開フラグ
        +String 公開URL
    }

    class チャットメッセージ {
        +String メッセージID
        +String ユーザーID
        +String セッションID
        +SenderType 送信者種別
        +String メッセージ本文
        +List クイックリプライ候補
        +String 選択されたクイックリプライ
        +Boolean クイックリプライ使用フラグ
        +DateTime 送信日時
        +Number TTL
    }

    class RequestStatus {
        <<enumeration>>
        検知済み
        分析中
        PENDING
        CANCELLED
        COMPLETED
        失敗
    }

    class SLAStatus {
        <<enumeration>>
        未発動
        発動中
        解決済み
    }

    class DependencyStatus {
        <<enumeration>>
        低
        中
        高
        超高依存
    }

    class JudgeResult {
        <<enumeration>>
        断る
        受諾
        保留
        エスカレーション
    }

    class EthicsResult {
        <<enumeration>>
        通過
        警告
        ブロック
    }

    ユーザー情報 "1" --> "1" プラン情報 : 契約
    ユーザー情報 "1" --> "1" お母さんキャラクター設定 : 設定
    ユーザー情報 "1" --> "*" 依頼情報 : 委任
    ユーザー情報 "1" --> "1" 依存度スコア : 計測
    ユーザー情報 "1" --> "1" パーソナリティプロファイル : 分析
    ユーザー情報 "1" --> "*" チャットメッセージ : 送受信
    依頼情報 "1" --> "*" 判断ログ : 記録
    依頼情報 "1" --> "0..1" 責任SLAレコード : 失敗時発動
    プラン情報 "1" --> "0..1" 責任SLAレコード : SLA適用条件
    判断ログ "*" --> "1" 依存度スコア : 更新トリガー
    判断ログ "*" --> "1" パーソナリティプロファイル : 学習素材
    チャットメッセージ "*" --> "1" パーソナリティプロファイル : 学習素材
```

---

## エンティティの役割

| エンティティ | 役割 |
|------------|------|
| **ユーザー情報** | 中心エンティティ。プロフィール・状態・全関連情報のハブ |
| **依頼情報** | Slack/メール/カレンダーから来る1件の代行依頼。状態遷移の主役 |
| **判断ログ** | Bedrockが下した判断の全記録。誤判断フィードバック・依存度計算に使う |
| **依存度スコア** | 使用頻度×委任率から算出。80超で離脱防止モード発動 |
| **責任SLAレコード** | 有料プランのみ。MyMomが失敗したときの謝罪・リカバリの記録 |
| **お母さんキャラクター設定** | Bedrockへ渡すトーン指示。プランと連動して変化 |
| **パーソナリティプロファイル** | 質問パターン・委任傾向・時間帯を蓄積分析した性格モデル。Bedrockのsystem promptに注入して回答精度を向上。公開カードとして共有可能 |
| **チャットメッセージ** | ユーザーとMyMomの会話履歴。Bedrockが生成した2択クイックリプライ候補を含む |

---

## エンティティ → DynamoDBテーブルマッピング

| エンティティ | DynamoDBテーブル | PK | GSI | 備考 |
|------------|---------------|----|----|------|
| ユーザー情報 | `mymom-users` | `userId` | — | |
| プラン情報 | `mymom-plans` | `userId` | — | |
| お母さんキャラクター設定 | `mymom-characters` | `userId` | — | |
| 依頼情報 | `mymom-requests` | `requestId` | `userId-index` | Streams有効 |
| 判断ログ | `mymom-judgement-logs` | `logId` | `requestId-index`, `userId-index` | |
| 依存度スコア | `mymom-dependency-scores` | `userId` | — | |
| パーソナリティプロファイル | `mymom-personality-profiles` | `userId` | — | |
| チャットメッセージ | `mymom-chat-messages` | `messageId` | `userId-sessionId-index` | TTL=90日 |
| 責任SLAレコード | `mymom-sla-records` | `slaId` | `requestId-index` | |
