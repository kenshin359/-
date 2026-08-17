// Meta（Facebook/Instagram）広告 Marketing API から指定日の広告費を取得する。
// 必要な環境変数（無ければ null を返してスキップ）:
//   META_AD_ACCOUNT_ID   … 例: act_6500211260004110
//   META_ACCESS_TOKEN    … 長期アクセストークン（ads_read 権限）
//   META_API_VERSION     … 任意（既定 v21.0）
export async function getDailySpend(date) {
  const act = process.env.META_AD_ACCOUNT_ID;
  const token = process.env.META_ACCESS_TOKEN;
  if (!act || !token) return null;

  const ver = process.env.META_API_VERSION || 'v21.0';
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }));
  const url =
    `https://graph.facebook.com/${ver}/${act}/insights` +
    `?level=account&fields=spend&time_range=${timeRange}&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`Meta ${res.status}: ${JSON.stringify(data)}`);

  const raw = data.data && data.data[0] && data.data[0].spend;
  const spend = raw ? Math.round(parseFloat(raw)) : 0;
  return { ad_meta: spend };
}
