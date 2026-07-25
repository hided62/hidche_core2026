import { enablePatches } from 'immer';
import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import type { City, General, Nation, GeneralId, NationId, CityId } from '../src/domain/entities.js';
import type { WorldSnapshot } from '../src/world/types.js';
import {
    type GeneralActionResolution,
    resolveGeneralAction,
    type GeneralActionResolver,
} from '../src/actions/engine.js';
import type { TurnSchedule } from '../src/turn/calendar.js';
import { type DiplomacyEntry, applyDiplomacyPatch, buildDefaultDiplomacy } from '../src/diplomacy/index.js';
import type { ScenarioDiplomacy } from '../src/scenario/types.js';

enablePatches();

export class InMemoryWorld {
    public snapshot: WorldSnapshot;

    constructor(initialSnapshot: WorldSnapshot) {
        this.snapshot = initialSnapshot;
    }

    getGeneral(id: GeneralId): General | undefined {
        return this.snapshot.generals.find((g) => g.id === id);
    }

    getCity(id: CityId): City | undefined {
        return this.snapshot.cities.find((c) => c.id === id);
    }

    getNation(id: NationId): Nation | undefined {
        return this.snapshot.nations.find((n) => n.id === id);
    }

    getAllGenerals(): General[] {
        return this.snapshot.generals;
    }

    getAllCities(): City[] {
        return this.snapshot.cities;
    }

    getAllNations(): Nation[] {
        return this.snapshot.nations;
    }

    async applyResolution(resolution: GeneralActionResolution): Promise<void> {
        // Apply patches to the snapshot
        if (resolution.patches) {
            if (resolution.patches.generals) {
                this.snapshot.generals = this.snapshot.generals.map((g) => {
                    const patchItem = resolution.patches!.generals.find((p) => p.id === g.id);
                    if (patchItem) {
                        return { ...g, ...patchItem.patch } as General;
                    }
                    return g;
                });
            }
            if (resolution.patches.cities) {
                this.snapshot.cities = this.snapshot.cities.map((c) => {
                    const patchItem = resolution.patches!.cities.find((p) => p.id === c.id);
                    if (patchItem) {
                        return { ...c, ...patchItem.patch } as City;
                    }
                    return c;
                });
            }
            if (resolution.patches.nations) {
                this.snapshot.nations = this.snapshot.nations.map((n) => {
                    const patchItem = resolution.patches!.nations.find((p) => p.id === n.id);
                    if (patchItem) {
                        return { ...n, ...patchItem.patch } as Nation;
                    }
                    return n;
                });
            }
        }

        // Single entity updates from resolution main fields
        this.updateGeneral(resolution.general);
        if (resolution.city) {
            this.updateCity(resolution.city);
        }
        if (resolution.nation) {
            this.updateNation(resolution.nation);
        }

        if (resolution.created) {
            if (resolution.created.generals) {
                this.snapshot.generals.push(...resolution.created.generals);
            }
            if (resolution.created.nations) {
                this.snapshot.nations.push(...resolution.created.nations);
            }
        }

        if (resolution.effects) {
            for (const effect of resolution.effects) {
                if (effect.type === 'diplomacy:patch') {
                    const srcId = effect.srcNationId;
                    const destId = effect.destNationId;
                    const existing = this.getDiplomacy(srcId, destId);

                    // Convert ScenarioDiplomacy to DiplomacyEntry for applying patch
                    const entry: DiplomacyEntry = existing
                        ? {
                              fromNationId: existing.fromNationId,
                              toNationId: existing.toNationId,
                              state: existing.state,
                              term: existing.durationMonths,
                              dead: 0,
                              meta: {},
                          }
                        : buildDefaultDiplomacy(srcId, destId);

                    const patched = applyDiplomacyPatch(entry, effect.patch);
                    this.updateDiplomacy(patched);
                }
            }
        }
    }

    private updateGeneral(updated: General) {
        const idx = this.snapshot.generals.findIndex((g) => g.id === updated.id);
        if (idx >= 0) {
            this.snapshot.generals[idx] = updated;
        } else {
            this.snapshot.generals.push(updated);
        }
    }

    private updateCity(updated: City) {
        const idx = this.snapshot.cities.findIndex((c) => c.id === updated.id);
        if (idx >= 0) {
            this.snapshot.cities[idx] = updated;
        }
    }

    private updateNation(updated: Nation) {
        const idx = this.snapshot.nations.findIndex((n) => n.id === updated.id);
        if (idx >= 0) {
            this.snapshot.nations[idx] = updated;
        }
    }

    getDiplomacy(srcId: number, destId: number): ScenarioDiplomacy | undefined {
        return this.snapshot.diplomacy.find((d) => d.fromNationId === srcId && d.toNationId === destId);
    }

    updateDiplomacy(entry: DiplomacyEntry) {
        const scenarioEntry: ScenarioDiplomacy = {
            fromNationId: entry.fromNationId,
            toNationId: entry.toNationId,
            state: entry.state,
            durationMonths: entry.term,
        };

        const idx = this.snapshot.diplomacy.findIndex(
            (d) => d.fromNationId === entry.fromNationId && d.toNationId === entry.toNationId
        );
        if (idx >= 0) {
            this.snapshot.diplomacy[idx] = scenarioEntry;
        } else {
            this.snapshot.diplomacy.push(scenarioEntry);
        }
    }
}

export interface TestCommand {
    generalId: GeneralId;
    commandKey: string;
    resolver: GeneralActionResolver;
    args: unknown;
    context?: Record<string, unknown>;
}

export class TestGameRunner {
    world: InMemoryWorld;
    currentDate: Date;
    private readonly seedBase: string;

    constructor(world: InMemoryWorld, startYear: number, startMonth: number, seedBase = 'test-game-runner') {
        this.world = world;
        this.currentDate = new Date(startYear, startMonth - 1);
        this.seedBase = seedBase;
    }

    nextGeneralId = 1;
    nextNationId = 1;

    async runTurn(commands: TestCommand[]) {
        const schedule: TurnSchedule = {
            entries: [{ startMinute: 0, tickMinutes: 60 }],
        };

        for (const [commandIndex, cmd] of commands.entries()) {
            const general = this.world.getGeneral(cmd.generalId);
            if (!general) {
                throw new Error(`General ${cmd.generalId} does not exist`);
            }

            const city = this.world.getCity(general.cityId);
            if (!city) throw new Error(`General ${general.id} is in non-existent city ${general.cityId}`);

            const nation = general.nationId ? this.world.getNation(general.nationId) : null;
            const rng = new RandUtil(
                LiteHashDRBG.build(
                    [
                        this.seedBase,
                        this.currentDate.toISOString(),
                        String(commandIndex),
                        String(general.id),
                        cmd.commandKey,
                    ].join('|')
                )
            );

            const inputContext = {
                general,
                city,
                nation: nation || null,
                rng,

                year: this.currentDate.getFullYear(),
                month: this.currentDate.getMonth() + 1,
                season: Math.floor(this.currentDate.getMonth() / 3),
                map: this.world.snapshot.map,
                unitSet: this.world.snapshot.unitSet,
                cities: this.world.snapshot.cities,
                nations: this.world.snapshot.nations,
                createGeneralId: () => {
                    if (this.nextGeneralId === 1) {
                        const ids = this.world.getAllGenerals().map((g) => g.id);
                        this.nextGeneralId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
                    }
                    return this.nextGeneralId++;
                },
                createNationId: () => {
                    if (this.nextNationId === 1) {
                        const ids = this.world.getAllNations().map((n) => n.id);
                        this.nextNationId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
                    }
                    return this.nextNationId++;
                },
                ...cmd.context,
            };

            const scheduleContext = {
                now: this.currentDate,
                schedule,
            };

            const resolution = resolveGeneralAction(cmd.resolver, inputContext as any, scheduleContext, cmd.args);

            await this.world.applyResolution(resolution);
        }

        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    }
}
