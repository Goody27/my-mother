# Functional Design — personality-analyzer

## Business Logic Model

### Flow: Weekly Analysis → Personality Profile Update

```
EventBridge Scheduler (weekly cron: every Monday 03:00 JST)
  └─► personality-analyzer Lambda
        ├─► DynamoDB: Scan mymom-users (active users)
        │
        │   For each user:
        ├─► DynamoDB: Query mymom-chat-messages (last 7 days)
        ├─► DynamoDB: Query mymom-judgement-logs (last 7 days)
        ├─► DynamoDB: GetItem mymom-dependency-scores
        │
        ├─► Bedrock: InvokeModel (personality analysis)
        │     Input: aggregated behavior data
        │     Output schema:
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
        ├─► DynamoDB: UpdateItem mymom-personality-profiles
        └─► Slack: chat.postMessage (user ← "お母さんから分析結果が届いたよ")

### First Card (1-week trigger, not 1-month)
        ├─► Check: is this user's first profile update?
        │     YES → generate public card URL
        │           DynamoDB: UpdateItem publicFlag=false (opt-in pending)
        │           Slack: "あなたのお母さんが知ってるあなた、見る？" + View Card button
        └─► User clicks View Card → publicUrl revealed
              User clicks Share → Twitter Card metadata served
```

### Analysis Prompt

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

### Personality Card Format

```
{userName}のMyMomが知っている{userName}

断るのが苦手       ████████░░ {declineDifficulty}
先延ばし傾向       ███████░░░ {procrastinationTendency}
完璧主義           █████░░░░░ {perfectionism}
承認欲求           ██████░░░░ {approvalSeeking}

よく頼むこと: {primaryDelegationCategory}
活動時間帯: {activeHours}
お母さんの一言: 「{momComment}」
```

### Business Rules

| Rule | Description |
|------|-------------|
| BR-01 | First profile generated after 7 days of activity (not 30) |
| BR-02 | Profile updated weekly; inject into all subsequent Bedrock calls |
| BR-03 | Public card is opt-in; publicFlag defaults to false |
| BR-04 | Minimum 5 judgment logs required for meaningful analysis |
| BR-05 | Dependency score breaker: if score > 80 for 14 days, add recovery message to card |
