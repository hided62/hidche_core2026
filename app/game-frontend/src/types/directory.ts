import type { trpc } from '../utils/trpc';

export type GeneralDirectory = Awaited<ReturnType<typeof trpc.world.getGeneralDirectory.query>>;
export type GeneralDirectoryGeneral = GeneralDirectory['generals'][number];
