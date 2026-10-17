import { redirect } from 'next/navigation';

export default function RootPage() {
    // Normally the middleware picks the locale from the browser before this runs; Spanish-first when it does not.
    redirect('/es/dashboard');
}
