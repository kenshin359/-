# Before / After Difference Check

`diff_check.py` と `lock_verify.py` の出力をここに貼り、人間の目でも確認する。

## 機械チェック
- [ ] `lock_verify.py` = PASS（edit_region 外の変化が tolerance 内）
- [ ] `diff_check.py` の変化 bbox が edit_region に収まっている
- [ ] 変化画素率（全体）が想定範囲内

## 目視チェック
- [ ] 触っていないはずの箇所（背景/人物/文字/ロゴ）が変わっていない
- [ ] 変えた箇所だけが、狙い通り変わっている
- [ ] 継ぎ目・影・色温度に不自然さが無い

「一箇所直したら全体が微妙に変わった」は重大失敗。1つでも該当したらやり直し。
