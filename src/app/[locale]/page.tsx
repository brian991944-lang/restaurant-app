import { redirect } from '@/i18n/routing';

export default function HomePage({ params: { locale } }: { params: { locale: string } }) {
  redirect({ href: '/dashboard', locale });
  return null;
}
