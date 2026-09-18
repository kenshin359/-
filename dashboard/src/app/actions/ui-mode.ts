'use server';

import { cookies } from 'next/headers';
import { UI_MODE_COOKIE, type UiMode } from '@/lib/ui-mode';

export async function setUiModeAction(mode: UiMode): Promise<void> {
  const c = await cookies();
  c.set(UI_MODE_COOKIE, mode === 'pro' ? 'pro' : 'standard', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
}
