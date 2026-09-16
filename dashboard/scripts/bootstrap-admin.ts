// 初回デプロイ時の管理者作成（Vercel等、サーバーでコマンドを打てない環境用）。
// 環境変数 INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_NAME / INITIAL_ADMIN_PASSWORD が揃っていて、
// かつユーザーが1人もいないときだけ作成する。作成後は環境変数を消してよい。
import { prisma } from '../src/lib/prisma';
import { createUser, UserInput } from '../src/lib/users';

async function main() {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const name = process.env.INITIAL_ADMIN_NAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !name || !password) {
    console.log('bootstrap-admin: 環境変数未設定のためスキップ');
    return;
  }
  const count = await prisma.user.count();
  if (count > 0) {
    console.log(`bootstrap-admin: 既にユーザーが${count}人いるためスキップ`);
    return;
  }
  const parsed = UserInput.safeParse({ email, name, role: 'admin', password });
  if (!parsed.success) {
    throw new Error('bootstrap-admin: ' + parsed.error.issues.map((i) => i.message).join(' / '));
  }
  const u = await createUser(parsed.data);
  console.log(`bootstrap-admin: 管理者を作成しました ${u.name} <${u.email}>`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
