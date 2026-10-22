import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { Agent } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';

export class PushEndpointPolicyError extends Error {
    constructor() {
        // URL, DNS 응답과 구독 capability는 API 오류나 로그에 포함하지 않는다.
        super('Push endpoint must use HTTPS on port 443 and a public destination.');
        this.name = 'PushEndpointPolicyError';
    }
}

export type PushAddressResolver = (hostname: string) => Promise<LookupAddress[]>;
const resolveAddresses: PushAddressResolver = (hostname) => lookup(hostname, { all: true });

export const isPublicPushAddress = (address: string): boolean => {
    try {
        // 사설, loopback, link-local, multicast, 문서용·전환·예약 주소를 모두 거부한다.
        return ipaddr.process(address).range() === 'unicast';
    } catch {
        return false;
    }
};

export const parsePushEndpoint = (endpoint: string): URL => {
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new PushEndpointPolicyError();
    }
    const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    if (
        url.protocol !== 'https:' ||
        (url.port !== '' && url.port !== '443') ||
        url.username ||
        url.password ||
        url.hash ||
        !hostname ||
        isIP(hostname) !== 0
    ) {
        // IP literal은 Node가 custom lookup을 건너뛰므로 구독으로 받지 않는다.
        throw new PushEndpointPolicyError();
    }
    return url;
};

export const resolvePublicPushAddresses = async (
    hostname: string,
    resolver: PushAddressResolver = resolveAddresses
): Promise<LookupAddress[]> => {
    let timer: NodeJS.Timeout | undefined;
    try {
        const addresses = await Promise.race([
            resolver(hostname),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Push endpoint resolution failed.')), 5_000);
            }),
        ]);
        if (
            addresses.length === 0 ||
            addresses.some(({ address, family }) => !isPublicPushAddress(address) || isIP(address) !== family)
        ) {
            throw new PushEndpointPolicyError();
        }
        return addresses;
    } catch (error) {
        if (error instanceof PushEndpointPolicyError) throw error;
        // 일시 DNS 장애는 전송 재시도 대상으로 남기고 구독을 영구 비활성화하지 않는다.
        // eslint-disable-next-line preserve-caught-error -- DNS 오류의 hostname 등 비공개 목적지는 cause에도 복제하지 않는다.
        throw new Error('Push endpoint resolution failed.');
    } finally {
        clearTimeout(timer);
    }
};

export const validatePushEndpoint = async (endpoint: string): Promise<void> => {
    const url = parsePushEndpoint(endpoint);
    await resolvePublicPushAddresses(url.hostname);
};

export const createPublicPushLookup =
    (resolver: PushAddressResolver = resolveAddresses): LookupFunction =>
    (hostname, options, callback) => {
        // 저장 시 검사만으로는 DNS rebinding을 막지 못한다. socket이 실제 연결할
        // DNS 응답을 검사하고 바로 그 주소만 반환하여 재조회 경로를 없앤다.
        void resolvePublicPushAddresses(hostname, resolver).then(
            (addresses) => {
                const requestedFamily = typeof options.family === 'number' ? options.family : 0;
                const matching = requestedFamily
                    ? addresses.filter(({ family }) => family === requestedFamily)
                    : addresses;
                if (matching.length === 0) {
                    callback(new PushEndpointPolicyError(), []);
                } else if (options.all) {
                    callback(null, matching);
                } else {
                    callback(null, matching[0].address, matching[0].family);
                }
            },
            (error: Error) => callback(error, [])
        );
    };

// web-push는 https.request를 직접 호출하고 redirect를 따라가지 않는다.
export const publicPushAgent = new Agent({ lookup: createPublicPushLookup(), maxSockets: 10 });
