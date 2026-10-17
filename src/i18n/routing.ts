import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['en', 'es'],
  // Spanish-first: a visitor whose browser says nothing (or says Spanish) gets /es;
  // an English browser is still detected and sent to /en.
  defaultLocale: 'es'
});

export const {Link, redirect, usePathname, useRouter} = createNavigation(routing);
