/**
 * Revalidate the public digital menu and the admin editor after any write.
 *
 * This lives in lib rather than in an action file because both
 * app/actions/menuAdmin.ts and app/actions/clover.ts need it, and both are
 * marked 'use server' — a plain synchronous function cannot be exported from
 * those modules (everything they export must be a callable server action).
 */
import { revalidatePath } from 'next/cache';

export function revalidateMenuPaths() {
    revalidatePath('/menu');
    revalidatePath('/[locale]/menu', 'page');
}
