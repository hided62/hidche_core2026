// Gateway/game API는 같은 Redis namespace의 회수 계약을 공유한다.
// 최초 전환 cutoff와 사용자 watermark는 token TTL 설정 변화에도 유효해야 하므로
// TTL로 지우지 않는다. 사용자당 한 값이며 삭제는 모든 기존 token 만료 확인 뒤 운영 작업이다.
export const buildSessionRevocationBaselineKey = (channel: string): string => `${channel}:revocation:v1:baseline`;
export const buildUserSessionRevocationKey = (channel: string, userId: string): string =>
    `${channel}:revocation:v1:user:${userId}`;

export const parseSessionRevocationWatermark = (raw: string | null): Date | null => {
    if (raw === null) return null;
    if (!/^\d{1,16}$/.test(raw)) throw new Error('Invalid session revocation state.');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > 8_640_000_000_000_000)
        throw new Error('Invalid session revocation state.');
    return new Date(value);
};

/** A caller timeout does not prove a command already sent to Redis has settled. */
export class SessionRevocationCommandBudget {
    private pending = 0;
    constructor(private readonly maxPending = 64) {}

    async run<T>(start: () => Promise<T>): Promise<T> {
        if (this.pending >= this.maxPending) throw new Error('Session revocation storage is unavailable.');
        this.pending += 1;
        let command: Promise<T>;
        try {
            command = start();
        } catch {
            this.pending -= 1;
            throw new Error('Session revocation storage is unavailable.');
        }
        void command.then(
            () => {
                this.pending -= 1;
            },
            () => {
                this.pending -= 1;
            }
        );
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                command,
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('Session revocation storage is unavailable.')), 2000);
                    timeout.unref();
                }),
            ]);
        } catch {
            throw new Error('Session revocation storage is unavailable.');
        } finally {
            clearTimeout(timeout);
        }
    }
}
