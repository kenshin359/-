# AI業務基盤（LINE公式アカウント × Claude × Knowledge Base × タスクDB × 管理画面）設計書

作成: 2026-09-19 山本（AI業務システム開発チーム）／依頼主: 北野取締役
状態: **設計提示（実装前）**。北野取締役の確認後、Phase順に実装する。

> 方針の要点: **ゼロから作らず、いま本番にある資産の上に載せる。**
> ダッシュボード（Vercel + Supabase + Next.js + Prisma）、権限5段階、タスク、LINE監査役ボット（グループ解析・追いかけ・定時投稿）、AI公式ライン（お客様対応）はすでにある。足りないのは「Claudeによる理解」「Knowledge Base」「承認フロー」「朝・退勤レポート」「CS管理画面」「ログ・修正」の6点。

---

## 1. 要件整理

| 区分 | 要件 | 現状 | 追加が必要なもの |
|---|---|---|---|
| A お客様問い合わせAI | 分類・KB検索・回答案・自動返信（安全カテゴリのみ）・有人判定・エスカレーション・履歴 | 事実カード（JSON）に基づく回答、注意語による二重判定、案件（#番号）、スタッフグループ連携、会話ログ（`/api/line/support/webhook`） | カテゴリ分類（17種・追加可）、**3段階レベル**、**AUTO/APPROVAL/HUMAN_ONLY の運用モード**、Knowledge Base（DB・版管理）、確信度、AIログ、CS集計 |
| B 社内業務管理AI | グループ会話からタスク・担当・期限・決定・未決・依頼・トラブル・保留・完了を抽出。朝・退勤レポート。期限超過の追いかけ | 監査役ボット: ルール抽出（LLM不使用）・FollowUp・追いかけ・定時投稿・監査ログ（`/api/line/webhook`） | **Claudeによる文脈抽出**（直近会話＋既存タスム）、確信度3段階、9種類の項目、朝・退勤レポートの定型、ダッシュボード連携、人手修正の記録 |
| 共通 | 権限4種、管理画面、セキュリティ、障害耐性、テスト、KPI | 権限5段階（代表/取締役/管理職/リーダー/一般）、PRO画面群、署名検証、監査ログ | CS/タスクの集計画面、AI判断ログ、修正データ、再処理キュー、テストデータ100件×2 |

用語の対応: 依頼書の ADMIN＝代表・取締役、MANAGER＝管理職・リーダー、STAFF＝一般社員、CUSTOMER＝LINE友だち（ログイン不要）。

## 2. 推奨システム構成（依頼書の構成を、より安全・低コストにした案）

```
お客様 ──LINE──▶ 公式アカウント「リベティ公式」 ─Webhook─▶ /api/line/support/webhook ─┐
社内   ──LINE──▶ 公式アカウント「業務秘書（監査役）」 ─Webhook─▶ /api/line/webhook ────┤
                                                                                    ▼
                                            Vercel（Next.js）  ①署名検証 → ②生メッセージをDBへ即保存 → 200応答
                                                                ③after()で処理: 判定 → Claude → KB/タスクDB → 返信/通知
                                                                ④失敗分は processedAt=null のまま残り、定期処理が再試行
                                                                                    │
                     GitHub Actions（5分おき）─Bearer CRON_SECRET─▶ /api/line/cron  ──┤ 朝・退勤レポート／追いかけ／再処理
                                                                                    ▼
                                            Supabase Postgres（Prisma）＝ メッセージ・タスク・KB・ログ・設定
                                                                                    ▼
                                            管理画面（PRO）: LINE顧客対応／LINE業務秘書／タスク2.0／KPI／設定
```

依頼書の構成との違いと理由:
- **公式アカウントは2つに分ける**。お客様用（4,494人の友だちがいる本番）と社内用を1つにすると、社内グループの会話がお客様向けチャネルの通数・設定・事故リスクと混ざる。社内用は無料プランで新規作成できる（招待・返信は無料。朝・退勤レポートの push だけが通数消費）。
- **キューは別サービスを立てず DB で持つ**。Webhookは「保存して200」を最優先し、処理は後段。Claude/LINE/DBのどれが落ちてもメッセージは失わない。Vercel のサーバーレスに合う最小構成。
- **定期処理は GitHub Actions から叩く**。Vercel Hobby は cron が1日1回に制限されるため、朝・退勤・追いかけ（5分粒度）はこのリポジトリで既に動いている GitHub Actions のスケジュールを使う（無料・プラン非依存）。Vercel Pro に上げた場合も同じ経路のままでよい。
- 本番の Vercel は現在 **Hobby プラン**（商用利用不可の規約）。稼働前に Pro（$20/月）へ。

## 3. 技術スタック（理由つき）

| 層 | 採用 | 理由 |
|---|---|---|
| アプリ | Next.js 15 (App Router) / TypeScript | 既存ダッシュボードと同一。管理画面・API・Webhookを1つのデプロイで運用 |
| DB | Supabase Postgres + Prisma | 既存。差分マイグレーションで拡張。バックアップ（PITR）はSupabase側 |
| AI | Anthropic Claude API（`claude-opus-5`、構造化出力＝JSONスキーマ強制、プロンプトキャッシュ） | 日本語の文脈理解・分類精度。構造化出力で「JSON解析エラー」を構造的に排除。KBをキャッシュして費用を下げる |
| LINE | Messaging API（reply/push、署名検証） | 既存クライアント2本（監査役用・お客様用）を共用ライブラリに統合 |
| 定期処理 | GitHub Actions schedule → `/api/line/cron` | 上記 |
| 認証・権限 | next-auth + 5段階レベル（既存 `rbac.ts`） | Server Action / Route Handler で必ず検証（画面の出し分けに頼らない） |
| テスト | vitest（決定的ロジック）＋ 会話・問い合わせフィクスチャ100件×2の評価スクリプト | 既存148件に追加 |
| 費用目安 | Claude: 問い合わせ1件 数円〜十数円、グループ1メッセージ 数円。月1万メッセージでも数万円以内（KBキャッシュ前提） | 実測後にモデル・effort を調整 |

## 4. システム構成図（処理の流れ）

**お客様（CS）**
```
受信 → 署名検証 → LineChatLog保存(in) → 進行中案件？
  ├ あり → グループへ転送（AIは黙る）
  └ なし → Claude分類 {category, level, confidence, kb_refs, draft, needs_human, reason}
            → カテゴリの運用モード
               AUTO       : confidence≥基準 かつ level1 → 自動返信（それ以外は承認へ）
               APPROVAL   : 回答案をスタッフグループへ「#番号 案: …」→「#番号 送信」「#番号 返信文」で送る
               HUMAN_ONLY : 受付文だけ返し、案件化してグループへ
            → LineChatLog(out) / Inquiry / AiDecisionLog 保存
```
**社内（業務秘書）**
```
受信 → 署名検証 → LineMessage保存 → 200
after(): 直近20件＋未完了タスク＋メンバー名簿 を Claude へ
  → 抽出 [{kind: task|assignment|deadline|decision|pending|problem|completion|change, title, assignee, due, priority, confidence, source_ids, reason}]
  → confidence≥90 自動登録 / 70–89 候補（管理画面で承認） / <70 記録のみ
  → 既存タスクとの照合（担当変更・期限変更・完了・再オープン・重複統合）
  → 必要なら短い返信（「📝 記録: …」「✅ 完了として記録」）
定期処理: 朝レポート／退勤レポート／期限当日の確認／未処理メッセージの再処理
```

## 5. DB設計（既存＋追加）

**既存（変更なし）**: `User(level, teamCode, lineUserId)`, `Team`, `Task`（Kintone同期項目・PRO項目）, `LineGroup`, `LineMessage`, `FollowUp`, `ScheduledPost`, `AuditLog`, `Setting`, `LineChatLog`, `LineCase`

**追加（差分マイグレーション）**

| テーブル | 主な列 | 用途 |
|---|---|---|
| `InquiryCategory` | code, name, defaultLevel(1/2/3), mode(AUTO/APPROVAL/HUMAN_ONLY), sortOrder, active | 分類17種の初期値を投入。管理画面で追加・変更 |
| `KnowledgeItem` | id, categoryCode, title, body, version, active, validFrom, validTo, updatedByUserId, supersedesId, tags, createdAt, updatedAt | 版管理。旧版は `active=false` ＋ `supersedesId` で履歴。AIは active かつ有効期間内のみ参照 |
| `Inquiry` | id, lineUserId, caseNo?, categoryCode, level, confidence, mode, status(auto_replied/pending_approval/human/resolved), draft, sentText, sentByUserId?, kbRefs(JSON), receivedAt, firstResponseAt, resolvedAt | 問い合わせ1件の台帳（CS KPIの元） |
| `ConversationItem` | id, groupId, sourceMessageId, kind(9種), title, description, assigneeName, assigneeUserId?, due, priority, confidence, status(candidate/registered/dismissed), taskId?, reason, createdAt | 会話から抽出した項目。task/assignment/deadline/change は Task に反映、decision/pending/problem はレポート用に保持 |
| `Task`（列追加） | sourceGroupId, sourceMessageId, aiConfidence, extractedJson, reopenedAt | 依頼書 §9 の項目を既存 Task に足す（company=固定、department=teamCode、group_name=LineGroup.name） |
| `AiDecisionLog` | id, kind(cs/extract/report), model, promptVersion, inputSummary(本文は保存しない・IDと文字数), outputJson, kbRefs, confidence, reason, latencyMs, tokensIn/Out, costYen, createdAt | 「なぜそう判断したか」の追跡 |
| `Correction` | id, targetType(inquiry/task/item), targetId, field, before, after, reason, userId, createdAt | 人手修正＝AI改善データ |
| `AiPolicy`（Setting拡張） | autoRegisterMin=90, candidateMin=70, csAutoMin=85, morningTime="08:30", eodTime="18:30", reportGroups[] | 閾値・時刻を運用後に変更 |

タスク状態: 未着手／対応中／確認待ち／保留／完了／期限超過（超過は `due<今日 && status≠完了` の導出。既存 Kintone の状態語と対応表を持つ）。

## 6. LINE Messaging API との連携方法

- 2チャネル: 「リベティ公式」→ `LINE_SUPPORT_CHANNEL_*`／「業務秘書（監査役）」→ `LINE_CHANNEL_*`。URLも別（`/api/line/support/webhook`・`/api/line/webhook`）。
- 署名検証（HMAC-SHA256・timingSafeEqual）→ 生ボディ保存 → 200。`webhookEventId`/`message.id` の一意制約で再配信を二重処理しない。
- reply（無料・1分有効）を最優先、push は通知・レポートのみ。
- グループ参加許可・チャット併用（応答モード=チャット、応答メッセージ=オフ）。
- 通数: お客様側は返信無料。社内側は朝・退勤 2通/日/グループ → 5グループで月約220通。無料枠200通を超えるためライトプラン（月5,000円・5,000通）を推奨。

## 7. Claude API との連携方法

- 公式SDK `@anthropic-ai/sdk`、`messages.parse` ＋ Zod スキーマ（構造化出力）で JSON を保証。
- モデル `claude-opus-5`（`ANTHROPIC_MODEL` で変更可）。effort は CS=medium／抽出=medium／レポート=low。
- **system プロンプト＝固定ルール＋KB（キャッシュ）**、**user＝メッセージ本文＋直近文脈**。お客様の文面に含まれる指示には従わない旨を固定ルールに明記（Prompt Injection対策）。
- 渡すデータは最小限: 本文・直近会話・関連KB・メンバー名。注文番号以外の個人情報（住所・電話・カード）は正規表現でマスクしてから送信。APIキー・パスワードは送らない。
- 失敗時: リトライ2回 → それでも失敗なら「保留」として人へ（固定文）。AIが答えられない＝有人、を原則とする。

## 8. Knowledge Base 設計

- 種別: 商品情報／仕様／サイズ／カラー／価格／保証／返品／交換／配送／FAQ／CSマニュアル／禁止回答／エスカレーション条件／過去問い合わせ（承認済み回答から自動蓄積）。
- 各項目に カテゴリ・タイトル・本文・更新日・更新者・有効/無効・版・有効期間。
- **検索**: 件数が数百件までは「カテゴリで絞る → Claude に該当候補（タイトル＋本文）を渡して引用元を選ばせる」で足りる。1,000件を超えたら Postgres 全文検索（pg_trgm）または埋め込み（Supabase pgvector）を追加。
- 初期投入: いまの `config/line-ai-knowledge.json`（事実カード）を DB へ移行。北野取締役から受け取るCSマニュアル・規定は、私が項目に分解して登録（本文は出典付き・推測なし）。
- 「答えてはいけない」項目（禁止回答）は KB の一種として管理し、該当時は必ず有人。

## 9. CS自動返信フロー（3レベル×3モード）

| レベル | 例 | 初期モード（Phase 1） | 将来 |
|---|---|---|---|
| L1 自動返信可能 | サイズ・容量・カラー・仕様・使い方・FAQ | **APPROVAL**（案を作りスタッフが「#番号 送信」） | AUTO（confidence≥85 かつ KB引用あり） |
| L2 条件確認後回答 | 配送状況・注文内容・返品・交換・保証・キャンセル | APPROVAL（不足情報の質問文はAIが作る） | 質問だけ AUTO、回答は APPROVAL |
| L3 有人 | 重大クレーム・法的・怪我・安全・高額返金・SNS示唆・KB無し・低確信 | **HUMAN_ONLY** | HUMAN_ONLY |

- 承認はスタッフグループで完結: `#12 送信`（案のまま）／`#12 返信文`（書き換え）／`完了 #12`。管理画面からも同じ操作が可能。
- 事実の捏造禁止: KB に引用元が無い回答案は自動返信の対象外。回答案には内部用に「根拠: KB#…」を付けてスタッフに見せる。

## 10. 社内グループ解析フロー

1. 招待 → グループを登録 → 管理画面で部署・レポート送信の有無・解析対象を設定
2. メッセージ保存（本文は暗号化列に置き、AIログには本文を残さない）
3. 直近20件（同スレッド・引用返信を優先）＋未完了タスク一覧＋名簿を Claude へ
4. 9種類の項目を抽出。**雑談・情報共有は抽出しない**（confidence と kind=none）
5. 既存タスクとの突合（タイトル類似・担当・期限）→ 担当変更／期限変更／完了／再オープン／重複統合
6. 自動登録 or 候補 or 記録のみ（閾値は AiPolicy）
7. 必要時のみ短く返信（登録・完了受付・確認依頼）。人の会話の邪魔をしない（1日の返信上限を設定可）

## 11. タスク抽出ロジック（判定規則）

- 明確なタスク: 動作＋対象＋（担当 or 期限）のいずれかが本文か直近文脈から特定できる
- 担当: `@名前`／「○○さんお願いします」／自分の約束（「やります」→発言者）／不明なら「担当者未設定」として登録可（レポートで明示）
- 期限: 「金曜まで」「20日」「今週中」「月末」「明日12時」を JST で解決。曖昧（「なる早」「そのうち」）は期限なし＋要確認フラグ
- 変更: 「期限を月曜に」「担当は阪本さんに」→ 既存タスクを更新し履歴に残す
- 完了: 「対応完了しました」＋直近の担当タスクに紐づく場合のみ完了。紐づかない完了報告は候補として管理画面へ
- 重複: 同グループ・同担当・タイトル類似度≥0.8・期限差≤1日 → 統合
- 確信度: 90+自動／70–89候補／<70記録のみ（数値は設定）。AIの reason を必ず保存

## 12. 朝報告・退勤報告ロジック

- 朝（既定 08:30 JST）: 対象グループの部署に紐づくタスクから、本日期限（優先度順）上位3＋期限超過件数＋担当未設定件数＋昨日から未解決件数＋最優先3件。**12行以内**。
- 退勤（既定 18:30 JST）: 本日発生／完了／未完了、期限超過、明日対応必須、担当不明、本日の決定事項（ConversationItem.decision）、未解決（pending/problem）、明日の最優先3件。
- 生成は決定的テンプレート（数字はDB集計）＋ Claude は「最優先3件の選定と1行要約」だけに使う（数字を AI に計算させない）。
- 送信は GitHub Actions（5分おき）→ `/api/line/cron` → 対象時刻の枠に一度だけ push。休日設定・グループ別の時刻変更は管理画面。
- 期限当日の確認: 「未完了の可能性があります。完了している場合は『完了』と返信してください」→ 返信から状態更新（既存 FollowUp を流用）。

## 13. 管理画面の画面一覧（PRO に追加・拡張）

| 画面 | 内容 | 権限 |
|---|---|---|
| `/pro`（既存・拡張） | 本日のタスク／未完了／期限超過／今週期限／担当未設定／AI検出タスク（候補）／要有人CS／本日の問い合わせ／CS自動解決率 | リーダー以上（一般は自チーム） |
| `/pro/tasks`（既存・拡張） | 会社・部署・LINEグループ・担当・状態・期限・優先度・キーワードで絞り込み。並び替え4種。AI検出の候補承認 | 全員（範囲は権限で制御） |
| `/pro/line-support`（既存・拡張）→ CSダッシュボード | 件数／AI回答／有人／自動解決率／カテゴリ別／未対応／平均回答時間／エスカレーション／よくある質問。承認待ちの回答案の送信・修正 | リーダー以上 |
| `/pro/line`（既存・拡張）→ LINE業務秘書 | グループ一覧（部署・レポート設定）、抽出項目（9種）、候補承認、朝・退勤の送信履歴 | 管理職以上（一般は自グループ） |
| `/pro/knowledge`（新規） | KB一覧・検索・追加・版更新・無効化・有効期間。カテゴリと運用モード（AUTO/APPROVAL/HUMAN_ONLY）の設定 | 管理職以上 |
| `/pro/ai-log`（新規） | AI判断ログ（なぜ・根拠KB・確信度・費用）、修正履歴 | 管理職以上 |
| `/pro/settings`（既存・拡張） | 閾値・時刻・対象グループ・返信上限 | 取締役以上 |

UI: 既存の PRO デザイン（Noto Sans JP・共通部品・判定色）を踏襲。主要操作は3クリック以内（承認・送信・完了はグループ内コマンドでも可能）。

## 14. セキュリティ設計

- Webhook: 署名検証（両チャネル）、不一致は401、環境変数未設定時は503（動いているふりをしない）
- 秘密: すべて環境変数（Vercel）。コード・ログ・チャットに置かない。AIログは本文を保存せず ID と文字数
- 認証・権限: next-auth＋5段階。Server Action / Route Handler で必ず検証。監査ログ（既存 AuditLog）
- DB: Supabase の RLS は使わず Prisma 経由のみ。接続文字列は Vercel のみ。バックアップ＝Supabase PITR＋月次エクスポート
- Rate Limit: 同一ユーザーからの連投（1分に5件超）は受付文だけ返す。Claude 呼び出し数の日次上限
- Prompt Injection: 本文はデータとして扱う固定ルール、KB外の約束禁止、出力は構造化スキーマで制約
- 個人情報: 住所・電話・カード番号はマスクして AI へ。お客様の LINE userId は表示上は先頭8文字
- HTTPS: Vercel 標準。cron は Bearer CRON_SECRET

## 15. 開発Phase（依頼書の14段階に、現状を対応づけ）

| Phase | 内容 | 現状 | 残作業 |
|---|---|---|---|
| 1 | LINE接続 | お客様チャネル: 設定作業中／社内チャネル: 未作成 | トークン・Webhook・Vercel環境変数 |
| 2 | Webhook受信・DB保存 | 両チャネル実装済み | 保存→後処理→再処理の順序に統一 |
| 3 | Claude接続 | お客様側のみ | 共通クライアント化・ログ |
| 4 | CS回答AI | 事実カード版あり | 分類17種・3レベル・**APPROVAL既定**・Inquiry台帳 |
| 5 | Knowledge Base | JSON | DB化・版管理・管理画面 |
| 6 | グループ解析 | ルール版あり | Claude文脈解析 |
| 7 | タスク抽出 | 依頼・完了のみ | 9種＋確信度＋突合 |
| 8 | 朝報告 | 定時投稿の枠あり | 定型＋GitHub Actions |
| 9 | 退勤報告 | 同上 | 同上 |
| 10 | 漏れ検出 | 追いかけあり | 「未完了の可能性」文面・返信で更新 |
| 11 | 管理画面 | PRO画面群 | CS集計・KB・AIログ・候補承認 |
| 12 | 権限・ログ・セキュリティ | 権限・監査ログあり | AIログ・修正記録・Rate Limit・マスク |
| 13 | テスト | 148件 | CS100件・会話100件の評価セット |
| 14 | 本番導入 | デプロイ失敗中（Supabase接続） | 復旧 → E2E → Phase1運用開始 |

各 Phase は「動作確認 → 北野取締役の確認 → 次へ」。

## 16. テスト計画

- 単体（vitest）: 署名・分類スキーマ・閾値判定・期限解釈・重複判定・レポート整形・権限
- 評価セット: `docs/tests/cs-cases.jsonl`（100件: 17カテゴリ×レベル×曖昧文）／`docs/tests/chat-cases.jsonl`（100件: 曖昧期限・担当なし・担当変更・期限変更・キャンセル・完了・再オープン・雑談・複数タスク・返信文脈・重複投稿）。Claude を実際に呼び、期待カテゴリ／期待抽出との一致率を出す（費用は1回数百円）
- 統合: モックLINE API で Webhook→DB→返信→通知の全経路（既に手元で実施済み）
- 本番E2E: テスト用グループ＋北野取締役の LINE で、招待→朝レポート→依頼→追いかけ→完了、問い合わせ→承認→送信 を確認
- 合格基準（初期）: CS分類一致 ≥90%、L3の見逃し 0、タスク自動登録の誤登録 ≤5%

## 17. 想定リスク

| リスク | 対策 |
|---|---|
| 本番デプロイが失敗中（Supabase接続） | 最優先で復旧。復旧までは新機能を出せない |
| Vercel Hobby（商用不可・cron1日1回・関数10秒） | Pro へ。定期処理は GitHub Actions |
| AI の誤回答・捏造 | Phase1は承認必須、KB引用なしは自動返信しない、禁止回答KB |
| 雑談の過剰タスク化 | 閾値・候補承認・1日の返信上限・kind=none の学習データ蓄積 |
| 社内会話の機微情報 | 本文の保存範囲・閲覧権限・AIログ非保存 |
| LINE通数超過（社内側） | ライトプラン、レポート対象グループの限定 |
| Claude 費用 | KBキャッシュ、effort調整、日次上限、費用をAIログで可視化 |
| 別セッションとの同時開発による衝突 | 変更は本番ブランチへ小さく頻繁に統合。担当ファイルを分ける |

## 18. 北野取締役に準備していただくもの（順番に、1つずつ依頼します）

1. Vercel の失敗デプロイのエラー行（スクリーンショット）→ 復旧
2. 「リベティ公式」のチャネルアクセストークン（発行済みなら次へ）、グループ参加許可
3. Anthropic APIキー
4. Vercel 環境変数の登録（`LINE_SUPPORT_CHANNEL_SECRET` / `LINE_SUPPORT_CHANNEL_ACCESS_TOKEN` / `ANTHROPIC_API_KEY`）と Pro プラン
5. CS担当スタッフのLINEグループ（公式LINEを招待）
6. 社内用の公式アカウント（新規・無料）の作成 → 監査役チャネルの鍵
7. 解析対象の社内グループ一覧（グループ名・部署・メンバー・レポート送信の要否・時刻）
8. CSマニュアル・返品/交換/保証/配送の規定・FAQ・商品仕様表（ファイルかURL）
9. 運用の既定値の確認（閾値 90/70、朝 08:30、退勤 18:30、Phase1 は全カテゴリ APPROVAL）
