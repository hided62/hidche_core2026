export const mergeViteEnv = (
    fileEnv: Record<string, string>,
    runtimeEnv: NodeJS.ProcessEnv
): Record<string, string | undefined> => ({
    ...fileEnv,
    ...runtimeEnv,
});
