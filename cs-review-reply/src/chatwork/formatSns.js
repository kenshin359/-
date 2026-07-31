// SNSチーム向け「好評・SNS企画に使えそうなレビュー」共有（抜粋＋活用メモ付き）。
//   毎日まとめて1通。引用しやすい一言と、なぜSNSに使えそうかのメモを添えます。
// ★お客様情報の扱い：投稿者名は載せません（SNS二次利用の観点でも、名前は不要）。

// entries: [{ productName, rating, date, body, snsReason }]
export function formatSns(entries, dateLabel) {
  if (entries.length === 0) return null;

  const header =
`✨ SNS向け 好評レビュー共有（${dateLabel}）
件数: ${entries.length}件
※ 企画・投稿の素材にどうぞ。引用の際は文言を整えてご利用ください（本文は原文ママ）。`;

  const blocks = entries.map((e) => {
    const product = e.productName || "（ショップ全体へのレビュー）";
    const memo = e.snsReason ? `\n💡 活用メモ: ${e.snsReason}` : "";
    return (
`■ ${product}　★${e.rating ?? "?"}　${e.date || ""}
レビュー(原文): ${e.body || ""}${memo}`
    );
  });

  return [header, ...blocks].join("\n\n──────────\n");
}
