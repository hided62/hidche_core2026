<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BattleSimOptions, GeneralDraft } from '../../utils/battleSimulatorTypes';

interface Props {
    options: BattleSimOptions;
    mode: 'attacker' | 'defender';
    title: string;
    canImportServer: boolean;
}

const props = defineProps<Props>();
const general = defineModel<GeneralDraft>('general', { required: true });

const emit = defineEmits<{
    (event: 'import'): void;
    (event: 'save'): void;
    (event: 'load', payload: { file: File }): void;
    (event: 'copy'): void;
    (event: 'remove'): void;
}>();

const isDefender = computed(() => props.mode === 'defender');

const fileInput = ref<HTMLInputElement | null>(null);

const triggerLoad = () => {
    fileInput.value?.click();
};

const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) {
        return;
    }
    emit('load', { file });
    if (target) {
        target.value = '';
    }
};

const officerLevelOptions = [
    { value: 1, label: '일반' },
    { value: 4, label: '태수' },
    { value: 3, label: '군사' },
    { value: 2, label: '종사' },
    { value: 10, label: '무장 수뇌' },
    { value: 9, label: '지장 수뇌' },
    { value: 11, label: '참모' },
    { value: 12, label: '군주' },
];
</script>

<template>
    <section class="general-card">
        <header class="general-header">
            <div>
                <div class="general-title">{{ title }}</div>
                <div class="general-subtitle">No {{ general.no }}</div>
            </div>
            <div class="general-actions">
                <button
                    class="action"
                    type="button"
                    :disabled="!canImportServer"
                    :title="
                        canImportServer
                            ? '게임 서버의 장수 정보를 불러옵니다.'
                            : '게임 장수를 보유해야 사용할 수 있습니다.'
                    "
                    @click="emit('import')"
                >
                    서버에서 가져오기
                </button>
                <button class="action" type="button" @click="emit('save')">저장</button>
                <input ref="fileInput" type="file" accept=".json" hidden @change="handleFileChange" />
                <button class="action" type="button" @click="triggerLoad">불러오기</button>
                <button v-if="isDefender" class="action ghost" type="button" @click="emit('copy')">복제</button>
                <button v-if="isDefender" class="action danger" type="button" @click="emit('remove')">제거</button>
            </div>
        </header>

        <div class="form-block">
            <div class="form-row">
                <label class="field">
                    <span>이름</span>
                    <input v-model="general.name" type="text" />
                </label>
                <label class="field">
                    <span>직위</span>
                    <select v-model.number="general.officerLevel">
                        <option v-for="option in officerLevelOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                </label>
                <label class="field">
                    <span>Level</span>
                    <input v-model.number="general.expLevel" type="number" min="0" max="300" />
                </label>
            </div>
        </div>

        <div class="form-block">
            <div class="form-row">
                <label class="field">
                    <span>통솔</span>
                    <input v-model.number="general.leadership" type="number" min="1" max="300" />
                </label>
                <label class="field">
                    <span>무력</span>
                    <input v-model.number="general.strength" type="number" min="1" max="300" />
                </label>
                <label class="field">
                    <span>지력</span>
                    <input v-model.number="general.intel" type="number" min="1" max="300" />
                </label>
            </div>
        </div>

        <div class="form-block">
            <div class="form-row">
                <label class="field">
                    <span>명마</span>
                    <select v-model="general.horse">
                        <option :value="null">-</option>
                        <option v-for="item in options.items.horse" :key="item.key" :value="item.key">
                            {{ item.name }}
                        </option>
                    </select>
                </label>
                <label class="field">
                    <span>무기</span>
                    <select v-model="general.weapon">
                        <option :value="null">-</option>
                        <option v-for="item in options.items.weapon" :key="item.key" :value="item.key">
                            {{ item.name }}
                        </option>
                    </select>
                </label>
                <label class="field">
                    <span>서적</span>
                    <select v-model="general.book">
                        <option :value="null">-</option>
                        <option v-for="item in options.items.book" :key="item.key" :value="item.key">
                            {{ item.name }}
                        </option>
                    </select>
                </label>
            </div>
            <div class="form-row">
                <label class="field">
                    <span>부상</span>
                    <input v-model.number="general.injury" type="number" min="0" max="80" />
                </label>
                <label class="field">
                    <span>군량</span>
                    <input v-model.number="general.rice" type="number" min="50" max="40000" step="50" />
                </label>
                <label class="field">
                    <span>도구</span>
                    <select v-model="general.item">
                        <option :value="null">-</option>
                        <option v-for="item in options.items.item" :key="item.key" :value="item.key">
                            {{ item.name }}
                        </option>
                    </select>
                </label>
            </div>
        </div>

        <div class="form-block">
            <div class="form-row">
                <label class="field">
                    <span>병종</span>
                    <select v-model.number="general.crewtype">
                        <option v-for="crew in options.unitSet.crewTypes" :key="crew.id" :value="crew.id">
                            {{ crew.name }}
                        </option>
                    </select>
                </label>
                <label class="field">
                    <span>병사</span>
                    <input v-model.number="general.crew" type="number" min="100" step="100" />
                </label>
                <label class="field">
                    <span>성격</span>
                    <select v-model="general.personal">
                        <option :value="null">-</option>
                        <option v-for="trait in options.personalities" :key="trait.key" :value="trait.key">
                            {{ trait.name }}
                        </option>
                    </select>
                </label>
            </div>
        </div>

        <div class="form-block">
            <div class="form-row">
                <label class="field">
                    <span>훈련</span>
                    <input v-model.number="general.train" type="number" min="40" :max="options.config.maxTrainByWar" />
                </label>
                <label class="field">
                    <span>사기</span>
                    <input v-model.number="general.atmos" type="number" min="40" :max="options.config.maxAtmosByWar" />
                </label>
                <label class="field">
                    <span>전특</span>
                    <select v-model="general.special2">
                        <option :value="null">-</option>
                        <option v-for="trait in options.warTraits" :key="trait.key" :value="trait.key">
                            {{ trait.name }}
                        </option>
                    </select>
                </label>
            </div>
        </div>

        <div class="form-block">
            <div class="form-row">
                <label class="field">
                    <span>보병숙련</span>
                    <select v-model.number="general.dex1">
                        <option v-for="dex in options.dexLevels" :key="dex.value" :value="dex.value">
                            {{ dex.label }} ({{ dex.value.toLocaleString('ko-KR') }})
                        </option>
                    </select>
                </label>
                <label class="field">
                    <span>궁병숙련</span>
                    <select v-model.number="general.dex2">
                        <option v-for="dex in options.dexLevels" :key="dex.value" :value="dex.value">
                            {{ dex.label }} ({{ dex.value.toLocaleString('ko-KR') }})
                        </option>
                    </select>
                </label>
                <label class="field">
                    <span>기병숙련</span>
                    <select v-model.number="general.dex3">
                        <option v-for="dex in options.dexLevels" :key="dex.value" :value="dex.value">
                            {{ dex.label }} ({{ dex.value.toLocaleString('ko-KR') }})
                        </option>
                    </select>
                </label>
            </div>
            <div class="form-row">
                <label class="field">
                    <span>귀병숙련</span>
                    <select v-model.number="general.dex4">
                        <option v-for="dex in options.dexLevels" :key="dex.value" :value="dex.value">
                            {{ dex.label }} ({{ dex.value.toLocaleString('ko-KR') }})
                        </option>
                    </select>
                </label>
                <label class="field">
                    <span>차병숙련</span>
                    <select v-model.number="general.dex5">
                        <option v-for="dex in options.dexLevels" :key="dex.value" :value="dex.value">
                            {{ dex.label }} ({{ dex.value.toLocaleString('ko-KR') }})
                        </option>
                    </select>
                </label>
                <label v-if="isDefender" class="field">
                    <span>수비여부</span>
                    <select v-model.number="general.defenceTrain">
                        <option :value="90">훈사 90</option>
                        <option :value="80">훈사 80</option>
                        <option :value="60">훈사 60</option>
                        <option :value="40">훈사 40</option>
                        <option :value="999">안함</option>
                    </select>
                </label>
            </div>
        </div>

        <div class="form-block">
            <div class="form-row">
                <label class="field">
                    <span>전투 수</span>
                    <input v-model.number="general.warnum" type="number" min="0" />
                </label>
                <label class="field">
                    <span>승리 수</span>
                    <input v-model.number="general.killnum" type="number" min="0" />
                </label>
                <label class="field">
                    <span>사살 수</span>
                    <input v-model.number="general.killcrew" type="number" min="0" />
                </label>
            </div>
        </div>

        <div class="form-block">
            <div class="buff-title">유산 버프</div>
            <div class="form-row buff-row">
                <label class="field">
                    <span>회피 확률</span>
                    <input v-model.number="general.inheritBuff.warAvoidRatio" type="number" min="0" max="5" />
                </label>
                <label class="field">
                    <span>필살 확률</span>
                    <input v-model.number="general.inheritBuff.warCriticalRatio" type="number" min="0" max="5" />
                </label>
                <label class="field">
                    <span>계략 시도</span>
                    <input v-model.number="general.inheritBuff.warMagicTrialProb" type="number" min="0" max="5" />
                </label>
            </div>
            <div class="form-row buff-row">
                <label class="field">
                    <span>상대 회피</span>
                    <input v-model.number="general.inheritBuff.warAvoidRatioOppose" type="number" min="0" max="5" />
                </label>
                <label class="field">
                    <span>상대 필살</span>
                    <input v-model.number="general.inheritBuff.warCriticalRatioOppose" type="number" min="0" max="5" />
                </label>
                <label class="field">
                    <span>상대 계략</span>
                    <input v-model.number="general.inheritBuff.warMagicTrialProbOppose" type="number" min="0" max="5" />
                </label>
            </div>
        </div>
    </section>
</template>

<style scoped>
.general-card {
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 5px;
    background: #303030;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
}

.general-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    min-height: 38px;
    padding: 6px 14px;
    background: #444;
}

.general-title {
    font-weight: 600;
    font-size: 14px;
}

.general-subtitle {
    display: none;
}

.general-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
}

.action {
    border: 1px solid transparent;
    border-radius: 4px;
    background: #3498db;
    color: #fff;
    padding: 4px 9px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}

.action:first-child {
    background: #10b981;
}

.action:nth-of-type(3) {
    background: #2c5d8f;
}

.action.ghost {
    background: #f59e0b;
}

.action.danger {
    background: #e74c3c;
    color: #fff;
}

.action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.form-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 14px 0;
}

.form-block:last-child {
    margin-bottom: 12px;
}

.form-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0;
}

.field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    color: #ddd;
    font-size: 12px;
}

.field span {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    border: 1px solid #111;
    background: #444;
    white-space: nowrap;
}

.field input,
.field select {
    min-width: 0;
    border: 1px solid #111;
    background: #ddd;
    color: #303030;
    padding: 6px 10px;
    font-size: 14px;
    line-height: 21px;
    box-shadow: inset 0 2px 0 rgba(0, 0, 0, 0.075);
}

.field input:focus,
.field select:focus {
    border-color: #3f464d;
    outline: 0;
}

.buff-title {
    display: none;
}

.buff-row {
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

@media (max-width: 720px) {
    .general-header {
        align-items: flex-start;
        flex-direction: column;
    }
}
</style>
