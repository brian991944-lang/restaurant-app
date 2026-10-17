import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
    // Match only internationalized pathnames. '/admin' is the Admin install's
    // start_url (public/admin-manifest.webmanifest); it gets the same locale
    // redirect as '/'.
    matcher: ['/', '/admin', '/(es|en)/:path*']
};
