import { redirect } from 'next/navigation';

export default async function Index({ params }: { params: { locale: string } }) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard`);
}
