import type { TraceEvent, TracePort, TraceSubject } from '@sammo-ts/logic/ports/trace.js';

const parseIds = (value: string | undefined): Set<string> => new Set(value?.split(',') ?? []);

const intersects = (configured: ReadonlySet<string>, requested: readonly number[] | undefined): boolean =>
    requested?.some((id) => configured.has(String(id))) ?? false;

export const createRuntimeTrace = (
    env: NodeJS.ProcessEnv = process.env,
    write: (line: string) => void = (line) => process.stdout.write(line)
): TracePort => {
    const generalIds = parseIds(env.CORE_AI_TRACE_GENERAL_IDS);
    const nationIds = parseIds(env.CORE_AI_TRACE_NATION_IDS);
    const warTechNationIds = parseIds(env.CORE_WAR_TECH_TRACE_NATION_IDS);

    return {
        isEnabled(event: TraceEvent, subject: TraceSubject = {}): boolean {
            switch (event) {
                case 'AI_ACTION_PATCH_TRACE':
                    return intersects(generalIds, subject.generalIds) || intersects(nationIds, subject.nationIds);
                case 'AI_WAR_TRACE':
                    return intersects(generalIds, subject.generalIds);
                case 'AI_WAR_FIXTURE_CORE':
                    return env.CORE_BATTLE_FIXTURE_TRACE === '1';
                case 'WAR_TECH_TRACE':
                    return intersects(warTechNationIds, subject.nationIds);
                default:
                    return false;
            }
        },
        write(event: TraceEvent, payload: unknown): void {
            write(`${event} ${JSON.stringify(payload)}\n`);
        },
    };
};
