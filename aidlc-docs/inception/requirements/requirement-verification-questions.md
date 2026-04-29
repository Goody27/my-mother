# 要件確認質問 — MyMom

## Q1: MVPのメインプラットフォームは？
A) Slackのみ
B) Gmailのみ
C) Slack + Gmail両方
D) ネイティブモバイルアプリ

[Answer]: A — Slackのみ。1機能で完全にコンセプトを証明できる。Gmailはハッカソン後に追加。

## Q2: 取り消しウィンドウの時間は？
A) 1秒
B) 3秒
C) 10秒
D) ユーザー設定で変更可能

[Answer]: B — 3秒。自動に感じるほど短く、重大なミスを取り消せるほど長い。

## Q3: オンボーディング同意後の自動実行の初期値は？
A) OFF（ユーザーが手動でONにする）
B) ON（プッシュ型をすぐ開始）
C) 毎回ユーザーに確認

[Answer]: B — ON。初期値OFFにするとプル型UXに逆戻りし、Push型体験が永遠に始まらない。同意画面で明示確認することで倫理リスクを排除。

## Q4: テキスト生成モデルは？
A) Claude 3 Haiku（高速・安価）
B) Claude 3.5 Sonnet（バランス型）
C) Claude 3 Opus（最高品質）

[Answer]: B — Claude 3.5 Sonnet（`anthropic.claude-3-5-sonnet-20241022-v2:0`）。日本語品質・文脈理解・構造化出力対応。

## Q5: IaCツールは？
A) AWS CDK（TypeScript）
B) AWS SAM（YAML）
C) Terraform

[Answer]: B — AWS SAM。Lambda中心のサーバーレス構成に最速。ハッカソンタイムラインに最適。

## Q6: セキュリティ拡張を有効化しますか？
A) はい — セキュリティベースラインルールを適用
B) いいえ

[Answer]: A — はい。Slack署名検証・Secrets Managerは必須要件。

## Q7: プロパティベーステストの拡張を有効化しますか？
A) はい
B) いいえ — 標準のユニットテストのみ

[Answer]: B — いいえ。ハッカソンスコープ内では標準pytestで十分。

## Q8: パーソナリティカード初回生成タイミングは？
A) 1ヶ月後
B) 2週間後
C) 1週間後
D) 即時（初回使用後）

[Answer]: C — 1週間後。Ahaモーメントと口コミ起点を一体化させる。早すぎるとデータ不足で不正確なカードになる。
