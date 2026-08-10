# failure-memory/ — 失敗メモリ（同じ失敗を繰り返さない）

「違う」「本物と違う」と言われたら、言い訳せず原因を突き止めて `log.jsonl` に追記する。
制作開始時（Workflow STEP 1）に必ず読み、過去と同じ失敗を事前に潰す。

## log.jsonl の1行スキーマ（JSON Lines）
```json
{"date":"YYYY-MM-DD","creative":"name","symptom":"何が違ったか",
 "root_cause":"原因","fix":"どう直したか","prevention":"再発防止ルール","agent":"担当"}
```
