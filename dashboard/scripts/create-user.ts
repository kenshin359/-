// 初期ユーザー登録CLI（サーバー初回セットアップ用。画面が使えない状態でも登録できる）
// 使い方: npx tsx scripts/create-user.ts --email 相手のメール --name "氏名" --role admin --password "10文字以上"
import { prisma } from '../src/lib/prisma';
import { createUser, UserInput } from '../src/lib/users';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const parsed = UserInput.safeParse({
    email: arg('email'),
    name: arg('name'),
    role: arg('role') ?? 'viewer',
    password: arg('password'),
  });
  if (!parsed.success) {
    console.error('入力エラー:', parsed.error.issues.map((i) => i.message).join(' / '));
    console.error('使い方: npx tsx scripts/create-user.ts --email A --name "B" --role admin|editor|viewer --password "C"');
    process.exit(1);
  }
  const u = await createUser(parsed.data);
  console.log(`登録しました: ${u.name} <${u.email}> ${u.role}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
