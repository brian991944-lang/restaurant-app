'use client';

import { useEffect, useState } from 'react';

/** The viewport width under which the Admin app shows the phone layout (bottom tabs) instead of the sidebar. */
export const PHONE_MAX_WIDTH = 700;

/** True on a phone-sized viewport. False on the server and until measured, so SSR and the first paint agree. */
export function useIsPhone(): boolean {
    const [phone, setPhone] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
        const update = () => setPhone(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    return phone;
}

/** True when running as an installed app (home-screen launch). */
export function isStandalone(): boolean {
    try {
        return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    } catch { return false; }
}
