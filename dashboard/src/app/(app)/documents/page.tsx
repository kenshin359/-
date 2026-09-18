import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions, canWrite } from '@/lib/auth';
import { listDocuments } from '@/lib/documents';
import DocumentLibrary from './DocumentLibrary';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '資料庫' };

export default async function DocumentsPage() {
  const [session, docs] = await Promise.all([getServerSession(authOptions), listDocuments()]);
  return <DocumentLibrary docs={docs} canEdit={canWrite(session?.user.role)} currentUserId={session?.user.id ?? ''} />;
}
