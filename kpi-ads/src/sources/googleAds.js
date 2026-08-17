// Google 広告 API から指定日の広告費を取得する。
// 必要な環境変数（どれか欠けたら null を返してスキップ）:
//   GOOGLE_ADS_CUSTOMER_ID          … 対象アカウントID（ハイフン無しの数字）
//   GOOGLE_ADS_DEVELOPER_TOKEN      … 開発者トークン
//   GOOGLE_ADS_CLIENT_ID            … OAuth クライアントID
//   GOOGLE_ADS_CLIENT_SECRET        … OAuth クライアントシークレット
//   GOOGLE_ADS_REFRESH_TOKEN        … リフレッシュトークン
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID    … 任意（MCC経由の場合のみ）
//   GOOGLE_ADS_API_VERSION          … 任意（既定 v17）
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function getDailyCost(date) {
  const cid = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const need = [cid, dev, process.env.GOOGLE_ADS_CLIENT_ID, process.env.GOOGLE_ADS_CLIENT_SECRET, process.env.GOOGLE_ADS_REFRESH_TOKEN];
  if (need.some((v) => !v)) return null;

  const ver = process.env.GOOGLE_ADS_API_VERSION || 'v17';
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'developer-token': dev,
    'Content-Type': 'application/json',
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  }

  const query = `SELECT metrics.cost_micros FROM customer WHERE segments.date = '${date}'`;
  const res = await fetch(
    `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }) }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Ads ${res.status}: ${JSON.stringify(data)}`);

  let micros = 0;
  for (const batch of data || []) {
    for (const row of batch.results || []) {
      micros += Number((row.metrics && row.metrics.costMicros) || 0);
    }
  }
  return { ad_google: Math.round(micros / 1e6) };
}
