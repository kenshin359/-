// Shopify Admin API から指定日の売上・注文数を取得する。
// 必要な環境変数（無ければ null を返してスキップ）:
//   SHOPIFY_SHOP          … 例: o2gym.myshopify.com
//   SHOPIFY_ADMIN_TOKEN   … Admin API アクセストークン（read_orders 権限）
//   SHOPIFY_API_VERSION   … 任意（既定 2024-10）
const TZ = '+09:00'; // 日本時間で日を区切る

export async function getDailySales(date) {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) return null; // 未設定ならスキップ

  const ver = process.env.SHOPIFY_API_VERSION || '2024-10';
  const min = encodeURIComponent(`${date}T00:00:00${TZ}`);
  const max = encodeURIComponent(`${date}T23:59:59${TZ}`);
  let url = `https://${shop}/admin/api/${ver}/orders.json?status=any&created_at_min=${min}&created_at_max=${max}&fields=total_price,created_at&limit=250`;

  let sales = 0;
  let orders = 0;
  // Link ヘッダーでページ送り
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const o of data.orders || []) {
      sales += parseFloat(o.total_price || '0');
      orders += 1;
    }
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return { sales_shopify: Math.round(sales), _shopify_orders: orders };
}
