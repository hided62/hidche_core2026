import { request, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import webPush from 'web-push';
import { parsePushEndpoint, publicPushAgent, PushEndpointPolicyError } from './endpointPolicy.js';

export class PushTransportError extends Error {
    constructor(
        message: string,
        readonly statusCode = 0
    ) {
        super(message);
    }
}
export const MAX_PUSH_RESPONSE_BYTES = 16 * 1024;
type PushRequest = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

/** Keep web-push encryption/VAPID, but bound the entire exchange and discard response content. */
export const sendPushRequest = (
    details: webPush.RequestDetails,
    requestImpl: PushRequest = request,
    timeoutMs = 10_000
): Promise<void> =>
    new Promise((resolve, reject) => {
        const endpoint = parsePushEndpoint(details.endpoint);
        let response: IncomingMessage | undefined;
        let req: ClientRequest | undefined;
        let settled = false;
        const finish = (error?: PushTransportError | PushEndpointPolicyError) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) {
                response?.destroy();
                req?.destroy();
                reject(error);
            } else resolve();
        };
        // Socket inactivity timeouts can be bypassed by a response that drips bytes forever.
        const timer = setTimeout(() => finish(new PushTransportError('Push service request timed out.')), timeoutMs);
        try {
            req = requestImpl(
                {
                    protocol: 'https:',
                    hostname: endpoint.hostname,
                    port: 443,
                    path: `${endpoint.pathname}${endpoint.search}`,
                    method: details.method,
                    headers: details.headers,
                    agent: publicPushAgent,
                },
                (incoming) => {
                    response = incoming;
                    if (settled) {
                        incoming.destroy();
                        return;
                    }
                    if (Number(incoming.headers['content-length'] ?? 0) > MAX_PUSH_RESPONSE_BYTES) {
                        finish(new PushTransportError('Push service response exceeds its size limit.'));
                        return;
                    }
                    let bytes = 0;
                    incoming.on('data', (chunk: Buffer) => {
                        bytes += chunk.length;
                        if (bytes > MAX_PUSH_RESPONSE_BYTES)
                            finish(new PushTransportError('Push service response exceeds its size limit.'));
                    });
                    incoming.on('error', () => finish(new PushTransportError('Push service response failed.')));
                    incoming.on('aborted', () => finish(new PushTransportError('Push service response failed.')));
                    incoming.on('end', () => {
                        const status = incoming.statusCode ?? 0;
                        finish(
                            status >= 200 && status < 300
                                ? undefined
                                : new PushTransportError(`Push service returned HTTP ${status}.`, status)
                        );
                    });
                }
            );
            req.on('error', (error) =>
                finish(
                    error instanceof PushEndpointPolicyError
                        ? error
                        : new PushTransportError('Push service request failed.')
                )
            );
            req.end(details.body ?? undefined);
        } catch {
            finish(new PushTransportError('Push service request failed.'));
        }
    });

export const sendBoundedNotification = async (
    subscription: webPush.PushSubscription,
    payload: string
): Promise<void> => {
    parsePushEndpoint(subscription.endpoint);
    const details = webPush.generateRequestDetails(subscription, payload, { TTL: 60 * 60 });
    await sendPushRequest(details);
};
