# MyMom（マイマム）

> **「人をダメにするシステム」**
> 使えば使うほど思考しなくなる、信頼委任設計。

AIが「お母さん」として先回りして意思決定・行動を代行し、失敗の責任を肩代わりするプッシュ型サービス。

**チーム**: 音部に抱っこ
**イベント**: AWS Summit Japan 2026 AI-DLC Hackathon

---

## テーゼ

既存のAIはすべてプル型:
```
ユーザーが指示する → AIが応答する
```

MyMomはプッシュ型:
```
MyMomが検知する → MyMomが判断する → MyMomが実行する → ユーザーは「断っておいたよ」通知を受け取るだけ
```

ユーザーは何も頼んでいない。MyMomはもう断っていた。

---

## Push型の本質的優位性

| 観点 | Zapier + Claude API | iOS Shortcuts | **MyMom** |
|------|---------------------|--------------|-----------|
| 設定コスト | 30分〜（ワークフロー設計） | 15分〜（トリガー設定） | **ゼロ。入れた瞬間に動く** |
| 判断主体 | ユーザーがルールを書く | ユーザーがトリガーを設計 | **AIが文脈を読んで判断** |
| 失敗の責任 | ユーザーの設計ミス | ユーザーの設定ミス | **MyMomが謝罪・リカバリを自律実行** |
| 差別化の一言 | Zapierは断り方を自動化した | Shortcutsは断り文を送った | **MyMomはもう断った。あなたは何もしていない** |

---

## AI-DLCライフサイクル

このプロダクトは [AI-DLCメソドロジー](https://github.com/awslabs/aidlc-workflows) に従って開発:

| フェーズ | AIが行ったこと | エビデンス |
|---------|-------------|---------|
| **Inception（構想）** | 要件定義・ユーザーストーリー・ドメインモデル・アプリ設計を生成 | `aidlc-docs/inception/` |
| **Construction（実装）** | ユニットごとの機能設計・NFR・インフラ設計・Lambdaコード生成 | `aidlc-docs/construction/` + `src/` |
| **Operation（改善）** | 8タイプのAI評価者による10ループのマルチ評価者レビュー | `review/loop_log.md` |

---

## アーキテクチャ

```
EventBridge（1分）→ dm-poller Lambda → DynamoDB
                                           ↓（Streams）
                                    analyzer Lambda → Bedrock Agent
                                                           ↓（Guardrails + Claude 3.5 Sonnet）
                                                    SQS DelayQueue（3秒）
                                                           ↓
                                                    sender Lambda → Slack
                                                                       ↓
                                                          「断っておいたよ」通知
```

完全なアーキテクチャ図: [aidlc-docs/construction/shared-infrastructure.md](aidlc-docs/construction/shared-infrastructure.md)

---

## 使用AWSサービス

- **Amazon Bedrock Agents** — トレース可能な推論による自律的マルチステップ判断
- **Bedrock Guardrails** — エージェントに直接アタッチした倫理フィルタ
- **Claude 3.5 Sonnet** — 断り文・チャット応答・パーソナリティ分析
- **Lambda（7関数）** — イベント駆動・サーバーレス実行
- **DynamoDB（9テーブル）** — 全エンティティの永続化
- **SQS DelayQueue** — 3秒の取り消しウィンドウ実装
- **EventBridge Scheduler** — Push型トリガー（1分間隔 + 週次）
- **API Gateway** — Slack Webhook + チャットエンドポイント
- **Secrets Manager** — トークン管理（ハードコード禁止）
- **CloudWatch + X-Ray** — 可観測性とBedrockトレース可視化

---

## ドキュメント構成

```
aidlc-docs/
├── aidlc-state.md                          # ワークフロー進捗トラッカー
├── audit.md                                # AI-DLC監査ログ
├── inception/
│   ├── requirements/requirements.md        # 機能・非機能要件（競合比較・市場規模含む）
│   ├── requirements/requirement-verification-questions.md
│   ├── user-stories/stories.md             # ユーザーストーリー（受け入れ基準付き）
│   ├── user-stories/personas.md            # ペルソナ + 最初の10人獲得計画
│   └── application-design/
│       ├── application-design.md           # アーキテクチャ全体・コンポーネント設計
│       └── domain-entities.md             # ドメインモデル（クラス図付き）
└── construction/
    ├── slack-decline-agent/                # MVPユニット（デモコア）
    │   ├── functional-design/
    │   │   ├── business-logic-model.md    # ロバストネス図 + シーケンス図 + データフロー
    │   │   └── sla-flow.md               # 責任SLAフロー（有料プランのみ）
    │   ├── nfr-requirements/nfr-requirements.md
    │   └── infrastructure-design/infrastructure-design.md  # SAMテンプレート + IAMロール
    ├── chat-ui/                           # チャット + クイックリプライユニット
    │   ├── functional-design/business-logic-model.md
    │   └── infrastructure-design/infrastructure-design.md
    ├── personality-analyzer/              # パーソナリティ分析ユニット
    │   ├── functional-design/business-logic-model.md
    │   └── infrastructure-design/infrastructure-design.md
    ├── shared-infrastructure.md           # AWSアーキテクチャ全体図
    └── build-and-test/build-instructions.md
```

---

## クイックスタート

```bash
sam build && sam deploy --guided
```

詳細: [aidlc-docs/construction/build-and-test/build-instructions.md](aidlc-docs/construction/build-and-test/build-instructions.md)

---


*お母さんが設計しました。*
