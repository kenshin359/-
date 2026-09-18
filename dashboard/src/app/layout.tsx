import type { Metadata } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import './globals.css';

// 日本語UI向け。見出し・本文・数値を1書体で通す（Operate画面のため表示用書体は使わない）
const sans = Noto_Sans_JP({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Libetee 経営AIダッシュボード',
    template: '%s | Libetee 経営AIダッシュボード',
  },
  description: '株式会社リベティの売上・利益・広告・在庫・タスクを1画面で判断する業務ダッシュボード',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${sans.variable} antialiased`}>{children}</body>
    </html>
  );
}
