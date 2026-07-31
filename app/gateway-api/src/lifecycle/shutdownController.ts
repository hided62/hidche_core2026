export type GatewayShutdownReason = 'SIGINT' | 'SIGTERM' | string;

export type GatewayShutdownController = {
    stop(reason: GatewayShutdownReason): Promise<void>;
    dispose(): void;
};

type GatewayShutdownOptions = {
    close(reason: GatewayShutdownReason): void | Promise<void>;
    onStopping?: (reason: GatewayShutdownReason) => void;
    onError?: (error: unknown, reason: GatewayShutdownReason) => void;
};

/** Installs one idempotent owner for process signals and resource shutdown. */
export const installGatewayShutdownController = (options: GatewayShutdownOptions): GatewayShutdownController => {
    let stopPromise: Promise<void> | undefined;
    let stopReason: GatewayShutdownReason | undefined;
    let failureReported = false;
    let disposed = false;

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        process.off('SIGINT', handleSigint);
        process.off('SIGTERM', handleSigterm);
    };

    const stop = (reason: GatewayShutdownReason): Promise<void> => {
        if (stopPromise) return stopPromise;
        stopReason = reason;
        options.onStopping?.(reason);
        stopPromise = Promise.resolve()
            .then(() => options.close(reason))
            .finally(dispose);
        return stopPromise;
    };

    const requestStop = (reason: GatewayShutdownReason): void => {
        void stop(reason).catch((error: unknown) => {
            if (failureReported) return;
            failureReported = true;
            options.onError?.(error, stopReason ?? reason);
        });
    };
    function handleSigint(): void {
        requestStop('SIGINT');
    }
    function handleSigterm(): void {
        requestStop('SIGTERM');
    }

    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigterm);

    return { stop, dispose };
};
