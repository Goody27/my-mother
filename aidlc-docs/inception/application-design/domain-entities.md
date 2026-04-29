# Domain Entities — MyMom

## Class Diagram

```mermaid
classDiagram
    class UserInfo["UserInfo (ユーザー情報)"] {
        +String userId
        +String email
        +String workplace
        +String location
        +String lifePattern
        +DateTime registeredAt
        +UserStatus status
    }

    class PlanInfo["PlanInfo (プラン情報)"] {
        +String planId
        +String userId
        +PlanType planType
        +Number monthlyExecutions
        +Number monthlyLimit
        +DateTime startAt
        +DateTime endAt
        +PlanStatus status
    }

    class MomCharacter["MomCharacter (お母さんキャラ設定)"] {
        +String characterId
        +String userId
        +PersonalityType personalityType
        +String tone
        +Boolean enabled
    }

    class Request["Request (依頼情報)"] {
        +String requestId
        +String userId
        +String requestType
        +String sourceChannel
        +String content
        +DateTime receivedAt
        +String executedContent
        +DateTime executedAt
        +RequestStatus status
        +JudgeResult judgeResult
        +EthicsResult ethicsResult
    }

    class JudgementLog["JudgementLog (判断ログ)"] {
        +String logId
        +String requestId
        +String userId
        +String judgement
        +JudgeResult result
        +String executionResult
        +Boolean feedbackFlag
        +DateTime recordedAt
    }

    class DependencyScore["DependencyScore (依存度スコア)"] {
        +String scoreId
        +String userId
        +Number score
        +Number usageFrequency
        +Number delegationRate
        +DateTime calculatedAt
        +DependencyStatus status
    }

    class PersonalityProfile["PersonalityProfile (パーソナリティプロファイル)"] {
        +String profileId
        +String userId
        +Number declineDifficulty
        +Number procrastinationTendency
        +Number perfectionism
        +Number approvalSeeking
        +String primaryDelegationCategory
        +String communicationStyle
        +String activeHours
        +Number analysisBasedOn
        +DateTime lastUpdatedAt
        +Boolean publicFlag
        +String publicUrl
    }

    class ChatMessage["ChatMessage (チャットメッセージ)"] {
        +String messageId
        +String userId
        +String sessionId
        +SenderType senderType
        +String content
        +List quickReplyCandidates
        +String selectedQuickReply
        +Boolean quickReplyUsed
        +DateTime sentAt
    }

    class SLARecord["SLARecord (責任SLAレコード)"] {
        +String slaId
        +String requestId
        +String userId
        +String triggerReason
        +DateTime apologySentAt
        +String recoveryContent
        +DateTime resolvedAt
        +SLAStatus status
    }

    %% Enumerations
    class RequestStatus {
        <<enumeration>>
        DETECTED
        ANALYZING
        PENDING
        CANCELLED
        COMPLETED
        FAILED
    }

    class SLAStatus {
        <<enumeration>>
        INACTIVE
        ACTIVE
        RESOLVED
    }

    class DependencyStatus {
        <<enumeration>>
        LOW
        MEDIUM
        HIGH
        CRITICAL
    }

    class JudgeResult {
        <<enumeration>>
        DECLINE
        ACCEPT
        HOLD
        ESCALATE
    }

    %% Relationships
    UserInfo "1" --> "1" PlanInfo : subscribes
    UserInfo "1" --> "1" MomCharacter : configures
    UserInfo "1" --> "*" Request : delegates
    UserInfo "1" --> "1" DependencyScore : measured by
    UserInfo "1" --> "1" PersonalityProfile : analyzed as
    UserInfo "1" --> "*" ChatMessage : exchanges
    Request "1" --> "*" JudgementLog : recorded in
    Request "1" --> "0..1" SLARecord : triggers on failure
    JudgementLog "*" --> "1" DependencyScore : updates
    JudgementLog "*" --> "1" PersonalityProfile : feeds
    ChatMessage "*" --> "1" PersonalityProfile : trains
```

## Entity-to-DynamoDB Table Mapping

| Entity | DynamoDB Table | PK | Notes |
|--------|---------------|-----|-------|
| UserInfo | `mymom-users` | `userId` | |
| PlanInfo | `mymom-plans` | `userId` | |
| MomCharacter | `mymom-characters` | `userId` | |
| Request | `mymom-requests` | `requestId` | GSI: `userId-index` |
| JudgementLog | `mymom-judgement-logs` | `logId` | GSI: `requestId-index` |
| DependencyScore | `mymom-dependency-scores` | `userId` | |
| PersonalityProfile | `mymom-personality-profiles` | `userId` | |
| ChatMessage | `mymom-chat-messages` | `messageId` | TTL: 90 days |
| SLARecord | `mymom-sla-records` | `slaId` | GSI: `requestId-index` |
