import { directTrpc } from '../utils/trpc';

export type AdminProfileNavigationItem = {
    profileName: string;
    profile: string;
    instanceKey: string;
    displayName?: string;
    currentScenario: string | null;
    meta?: Record<string, unknown>;
};

let cachedProfiles: AdminProfileNavigationItem[] | undefined;
let cachedAt = 0;
let inFlight: Promise<AdminProfileNavigationItem[]> | undefined;

export const loadAdminProfileNavigation = async (): Promise<AdminProfileNavigationItem[]> => {
    if (cachedProfiles && Date.now() - cachedAt < 5_000) return cachedProfiles;
    if (inFlight) return inFlight;
    inFlight = directTrpc.admin.profiles.listNavigation
        .query()
        .then((profiles) => {
            cachedProfiles = profiles as AdminProfileNavigationItem[];
            cachedAt = Date.now();
            return cachedProfiles;
        })
        .finally(() => {
            inFlight = undefined;
        });
    return inFlight;
};
