import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGatewayShutdownController } from '../src/lifecycle/shutdownController.js';

const controllers: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose();
    vi.restoreAllMocks();
});

describe('gateway shutdown controller', () => {
    it('drains resources once when SIGINT and SIGTERM arrive together', async () => {
        const initialSigint = process.listenerCount('SIGINT');
        const initialSigterm = process.listenerCount('SIGTERM');
        let releaseClose = (): void => {};
        const closeGate = new Promise<void>((resolve) => {
            releaseClose = resolve;
        });
        const close = vi.fn(async () => closeGate);
        const onStopping = vi.fn();
        const controller = installGatewayShutdownController({ close, onStopping });
        controllers.push(controller);

        expect(process.listenerCount('SIGINT')).toBe(initialSigint + 1);
        expect(process.listenerCount('SIGTERM')).toBe(initialSigterm + 1);

        process.emit('SIGINT');
        process.emit('SIGTERM');
        const manualStop = controller.stop('manual');
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        releaseClose();
        await manualStop;
        await controller.stop('later');

        expect(close).toHaveBeenCalledTimes(1);
        expect(onStopping).toHaveBeenCalledTimes(1);
        expect(onStopping).toHaveBeenCalledWith('SIGINT');
        expect(process.listenerCount('SIGINT')).toBe(initialSigint);
        expect(process.listenerCount('SIGTERM')).toBe(initialSigterm);
    });

    it('reports a close failure once and still removes both signal listeners', async () => {
        const initialSigint = process.listenerCount('SIGINT');
        const initialSigterm = process.listenerCount('SIGTERM');
        const failure = new Error('disconnect failed');
        const onError = vi.fn();
        const controller = installGatewayShutdownController({
            close: () => {
                throw failure;
            },
            onError,
        });
        controllers.push(controller);

        process.emit('SIGTERM');
        process.emit('SIGINT');
        await expect(controller.stop('manual')).rejects.toBe(failure);
        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure, 'SIGTERM'));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(process.listenerCount('SIGINT')).toBe(initialSigint);
        expect(process.listenerCount('SIGTERM')).toBe(initialSigterm);
    });

    it('can remove unused handlers without closing resources', () => {
        const close = vi.fn();
        const controller = installGatewayShutdownController({ close });
        controllers.push(controller);

        controller.dispose();
        process.emit('SIGINT');

        expect(close).not.toHaveBeenCalled();
    });
});
