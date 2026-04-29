# 機能設計 — personality-analyzer（AIパーソナリティ分析）

## 概要

ユーザーの行動ログ（判断ログ・チャット履歴・委任パターン・活動時間帯）を週次で分析し、
パーソナリティプロファイルを生成する。

プロファイルは2つの目的で使用:
1. **精度向上**: Bedrock呼び出しのsystem promptに注入して回答をパーソナライズ
2. **バイラル設計**: 公開カードとしてTwitterでシェア → 新規ユーザー獲得

---

## データフロー

```
EventBridge Scheduler（毎週月曜 03:00 JST）
  │
  ▼
Lambda: mymom-personality-analyzer
  │
  ├─► DynamoDB: mymom-users Scan（全アクティブユーザー）
  │
  │   ユーザーごとに以下を実行:
  │
  ├─► DynamoDB: mymom-chat-messages Query（過去7日間 by userId-index）
  ├─► DynamoDB: mymom-judgement-logs Query（過去7日間 by userId-index）
  ├─► DynamoDB: mymom-dependency-scores GetItem（現在の依存度スコア）
  │
  ├─► Bedrock Claude InvokeModel（パーソナリティ分析）
  │     入力: 行動データの集計
  │     出力スキーマ:
  │       {
  │         "declineDifficulty": 0-100,
  │         "procrastinationTendency": 0-100,
  │         "perfectionism": 0-100,
  │         "approvalSeeking": 0-100,
  │         "primaryDelegationCategory": "string",
  │         "communicationStyle": "string",
  │         "activeHours": "string",
  │         "momComment": "string"
  │       }
  │
  ├─► DynamoDB: mymom-personality-profiles UpdateItem
  │
  ├─► 初回プロファイル（1週間後）判定:
  │     初回 → publicFlag=false, 公開URLを生成（非公開）
  │           Slack: 「あなたのお母さんが知ってるあなた、見る？」通知
  └─► 依存度スコア80超・14日継続判定:
        該当 → momCommentに離脱防止メッセージを追加
              「最近お母さんに頼りすぎじゃない？たまには自分でやってみて。応援してるよ。」
```

---

## 分析プロンプト

```
System: あなたはユーザーの行動分析AIです。
以下のデータからユーザーのパーソナリティを分析してください。

データ:
- 過去7日間のチャット履歴（{chatCount}件）
- 判断ログ（{judgeCount}件）: {judgeData}
- 依存度スコア: {dependencyScore}
- 最もよく委任するカテゴリ: {topCategories}

ルール:
- スコアは0〜100の整数
- momCommentはお母さんの口調で50文字以内
- primaryDelegationCategoryは「断り代行」「メール整理」「スケジュール管理」から選択

User: パーソナリティを分析してください。
```

---

## パーソナリティカードの表示形式

```
山田くんのMyMomが知っている山田くん

断るのが苦手       ████████░░ 89
先延ばし傾向       ███████░░░ 74
完璧主義           █████░░░░░ 52
承認欲求           ██████░░░░ 62

よく頼むこと: 断り代行
活動時間帯: 夜22時〜25時
お母さんの一言: 「あなたはいつもギリギリまで頑張りすぎ。もう少し早く相談して」
```

---

## カードシェア設計（バイラル）

```
初回カード生成（1週間後）
  ↓
Slack: 「あなたのお母さんが知ってるあなた、見る？」+ [カードを見る] ボタン
  ↓
ユーザーがカードを閲覧
  ↓
[Twitterでシェア] ボタン表示
  ↓ （OGPメタタグ付きのURLをツイート）
フォロワーが「俺も知りたい」→ 紹介コードへの導線
```

**なぜ断り代行でなくカードがバイラルするか**:
- 断り代行 = 「他人に見せたくない行動」
- パーソナリティカード = 「自分が面白い存在であること」を証明するコンテンツ
- 「AIに分析されたら面白いことになった」という文脈でシェアが起きる

---

## ビジネスルール

| ルール | 内容 |
|--------|------|
| BR-01 | 初回プロファイルは1週間の使用後に生成（1ヶ月後は遅すぎる） |
| BR-02 | プロファイルは全てのBedrock呼び出しのsystem promptに注入する |
| BR-03 | プロファイルは週次で更新し続ける |
| BR-04 | 公開カードはオプトイン制（publicFlag デフォルト=false） |
| BR-05 | 判断ログが5件未満の場合は分析を行わない（データ不足） |
| BR-06 | 依存度スコア80超・14日継続でmomCommentに離脱防止メッセージを追加 |
