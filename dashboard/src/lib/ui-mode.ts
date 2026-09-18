// STANDARD / PRO の表示モード。Cookie に保存（ユーザーごと・端末ごと）。
// STANDARD は現行画面そのまま。PRO は経営・業務管理機能を追加した画面群（/pro 配下）。
import { cookies } from 'next/headers';

export type UiMode = 'standard' | 'pro';
export const UI_MODE_COOKIE = 'libetee_ui_mode';

export async function getUiMode(): Promise<UiMode> {
  const c = await cookies();
  return c.get(UI_MODE_COOKIE)?.value === 'pro' ? 'pro' : 'standard';
}
