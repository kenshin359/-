// ============================================================
//  [ヘルパー] LINE の userId / groupId を確認する簡易サーバ
// ------------------------------------------------------------
//  LINE Developers の Webhook URL に、このサーバの公開URLを一時的に
//  設定し、Bot にメッセージを送る / グループに招待すると、
//  source.userId / source.groupId がコンソールに表示されます。
//
//  実行:  node scripts/lineWebhookPeek.js   （既定ポート 3000）
//  公開:  ngrok http 3000  などでインターネットに公開して Webhook URL に設定。
//  ※ 確認が終わったら停止し、Webhook 設定も元に戻してください。
// ============================================================
import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      for (const ev of body.events || []) {
        const s = ev.source || {};
        console.log('── LINE イベント受信 ──');
        console.log('  type    :', s.type);
        if (s.userId) console.log('  userId  :', s.userId, '  → LINE_TARGET_USER_ID');
        if (s.groupId) console.log('  groupId :', s.groupId, '  → LINE_TARGET_GROUP_ID');
        if (s.roomId) console.log('  roomId  :', s.roomId);
      }
    } catch (e) {
      console.error('パース失敗:', e.message);
    }
    res.writeHead(200);
    res.end('ok');
  });
});

server.listen(PORT, () => {
  console.log(`LINE Webhook 確認サーバを起動: http://localhost:${PORT}`);
  console.log('ngrok 等で公開し、LINE Developers の Webhook URL に設定してください。');
});
