/**
 * Resolves one delta response and retries once with a full snapshot when the
 * client baseline cannot be reconstructed. The retry intentionally covers all
 * local application failures, including browser DataCloneError variants.
 */
export const resolveWithReadModelSnapshotFallback = async <Response, Result>(options: {
    request: (forceSnapshot: boolean) => Promise<Response>;
    resolve: (response: Response) => Result;
    forceSnapshot?: boolean;
}): Promise<Result> => {
    const forceSnapshot = options.forceSnapshot === true;
    const response = await options.request(forceSnapshot);
    try {
        return options.resolve(response);
    } catch (error) {
        if (forceSnapshot) {
            throw error;
        }
        return options.resolve(await options.request(true));
    }
};
