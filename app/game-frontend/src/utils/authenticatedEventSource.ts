import { EventSource } from 'eventsource';

export type AuthenticatedEventSource = EventSource;

/** Keep the access token out of browser/proxy URLs and ambient cookies. */
export const createAuthenticatedEventSource = (url: string, accessToken: string): EventSource => {
    const destination = new URL(url);
    if (destination.searchParams.has('token') || destination.username || destination.password) {
        throw new Error('Realtime credentials must use the authorization header.');
    }
    return new EventSource(destination, {
        maxBufferSize: 64 * 1024,
        fetch: (input, init) => {
            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${accessToken}`);
            return fetch(input, {
                ...init,
                headers,
                credentials: 'omit',
                redirect: 'error',
                cache: 'no-store',
                referrerPolicy: 'no-referrer',
            });
        },
    });
};
