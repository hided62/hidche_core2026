<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { configuredGameAssetUrl } from '../../utils/imageAssets';
import type { RecruitmentCrewType, RecruitmentInfo } from './types';

const props = defineProps<{
    commandKey: 'che_징병' | 'che_모병';
    info: RecruitmentInfo;
}>();

const emit = defineEmits<{
    (event: 'update:args', args: Record<string, unknown>): void;
    (event: 'update:valid', valid: boolean): void;
    (event: 'submit'): void;
}>();

const selectedCrewTypeId = ref(0);
const amount = ref(1);
const showUnavailable = ref<Record<number, boolean>>({});

const commandName = computed(() => (props.commandKey === 'che_모병' ? '모병' : '징병'));
const goldCoefficient = computed(() => (props.commandKey === 'che_모병' ? 2 : 1));
const crewTypes = computed(() => props.info.groups.flatMap((group) => group.values));
const selectedCrewType = computed(
    () => crewTypes.value.find((crewType) => crewType.id === selectedCrewTypeId.value) ?? crewTypes.value[0] ?? null
);
const valid = computed(
    () => Boolean(selectedCrewType.value?.available) && Number.isFinite(amount.value) && amount.value >= 1
);
const estimatedGold = computed(() =>
    selectedCrewType.value ? Math.ceil(amount.value * selectedCrewType.value.baseCost * goldCoefficient.value) : 0
);

const filledAmount = (crewType: RecruitmentCrewType | null): number => {
    if (crewType?.id === props.info.currentCrewTypeId) {
        return Math.max(1, props.info.fullLeadership - Math.floor(props.info.crew / 100));
    }
    return Math.max(1, props.info.fullLeadership);
};

const initialize = () => {
    showUnavailable.value = Object.fromEntries(props.info.groups.map((group) => [group.armType, false]));
    const current = crewTypes.value.find((crewType) => crewType.id === props.info.currentCrewTypeId);
    selectedCrewTypeId.value =
        (current ?? crewTypes.value.find((crewType) => crewType.available) ?? crewTypes.value[0])?.id ?? 0;
    amount.value = filledAmount(selectedCrewType.value);
};

const selectCrewType = (crewType: RecruitmentCrewType) => {
    selectedCrewTypeId.value = crewType.id;
    amount.value = filledAmount(crewType);
};

const setHalf = () => {
    amount.value = Math.max(1, Math.ceil(props.info.fullLeadership * 0.5));
};

const setFilled = () => {
    amount.value = filledAmount(selectedCrewType.value);
};

const setFull = () => {
    amount.value = Math.max(1, Math.floor(props.info.fullLeadership * 1.2));
};

const updateAmount = (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    amount.value = Number.isFinite(value) ? value : 0;
};

const submit = async (crewType?: RecruitmentCrewType) => {
    if (crewType) selectCrewType(crewType);
    await nextTick();
    if (valid.value) emit('submit');
};

const imageUrl = (crewTypeId: number): string => `${configuredGameAssetUrl()}/crewtype${crewTypeId}.png`;
const availabilityClass = (crewType: RecruitmentCrewType): string =>
    crewType.available ? (crewType.special ? 'special' : 'available') : 'unavailable';
const displayDecimal = (value: number): string => value.toFixed(1);

watch(() => [props.commandKey, props.info] as const, initialize, { immediate: true, deep: true });
watch(
    [selectedCrewTypeId, amount, valid],
    () => {
        emit('update:args', {
            crewType: selectedCrewTypeId.value,
            amount: Math.max(0, Math.trunc(amount.value * 100)),
        });
        emit('update:valid', valid.value);
    },
    { immediate: true }
);
</script>

<template>
    <section class="recruitment-command-form" data-testid="recruitment-command-form">
        <div class="recruitment-intro legacy-bg0">
            병사를 모집합니다.
            <template v-if="props.commandKey === 'che_징병'"> 훈련과 사기치는 낮지만 가격이 저렴합니다. </template>
            <template v-else>훈련과 사기치는 높지만 자금이 많이 듭니다.</template>
            <br />가능한 수보다 많게 입력하면 가능한 최대 병사를 모집합니다.<br />
            이미 병사가 있는 경우 추가 {{ commandName }}되며, 병종이 다르면 기존 병사는 소집해제됩니다.<br />
            현재 {{ commandName }} 가능한 기본 병종은 <span class="legend available">녹색</span>, 특수 병종은
            <span class="legend special">초록색</span>, 불가능한 병종은
            <span class="legend unavailable">빨간색</span>으로 표시됩니다.
        </div>

        <div class="recruitment-list-front">
            <p v-if="props.commandKey === 'che_모병'" class="mercenary-notice">모병은 가격 2배의 자금이 소요됩니다.</p>
            <div class="recruitment-status legacy-bg2">
                <span>현재 기술력 : {{ props.info.techLevel }}등급</span>
                <span
                    >현재 통솔 :
                    <strong :class="{ injured: props.info.leadership < props.info.fullLeadership }">
                        {{ props.info.leadership }}
                    </strong></span
                >
                <span>최대 통솔 : {{ props.info.fullLeadership }}</span>
                <span>현재 병종 : {{ props.info.currentCrewTypeName }}</span>
                <span>현재 병사 : {{ props.info.crew.toLocaleString() }}</span>
                <span>현재 자금 : {{ props.info.gold.toLocaleString() }}</span>
            </div>

            <div v-if="selectedCrewType" class="mobile-selected-panel legacy-bg0">
                <div
                    class="crew-image"
                    :style="{ backgroundImage: `url(${JSON.stringify(imageUrl(selectedCrewType.id))})` }"
                />
                <button
                    type="button"
                    class="crew-name"
                    :class="availabilityClass(selectedCrewType)"
                    :title="selectedCrewType.available ? '현재 선택 가능' : '현재 선택 불가'"
                >
                    {{ selectedCrewType.name }}<small>{{ selectedCrewType.available ? '가능' : '불가' }}</small>
                </button>
                <div class="amount-panel">
                    <div class="quick-buttons">
                        <button type="button" @click="setHalf">절반</button>
                        <button type="button" @click="setFilled">채우기</button>
                        <button type="button" @click="setFull">가득</button>
                    </div>
                    <label>
                        <span>병력</span>
                        <input :value="amount" type="number" min="1" step="1" @input="updateAmount" />
                        <span>00명</span><output>{{ estimatedGold.toLocaleString() }}금</output>
                    </label>
                </div>
                <button type="button" class="submit-recruit" :disabled="!valid" @click="submit()">
                    {{ commandName }}
                </button>
            </div>

            <div class="crew-grid crew-header legacy-bg1" aria-hidden="true">
                <span class="crew-image">사진</span><span class="crew-name">병종</span><span class="attack">공격</span
                ><span class="defence">방어</span><span class="speed">기동</span><span class="avoid">회피</span
                ><span class="cost">가격</span><span class="rice">군량</span><span class="amount-panel">병사 수</span
                ><span class="crew-action">행동</span><span class="crew-info">특징</span>
            </div>
        </div>

        <div class="crew-list">
            <section v-for="group in props.info.groups" :key="group.armType" class="crew-group">
                <header>
                    <strong>{{ group.armName }} 계열</strong>
                    <button
                        type="button"
                        :class="{ active: showUnavailable[group.armType] }"
                        @click="showUnavailable[group.armType] = !showUnavailable[group.armType]"
                    >
                        {{
                            showUnavailable[group.armType]
                                ? '선택 할 수 있는 병종만 보기'
                                : '선택 할 수 없는 병종도 보기'
                        }}
                    </button>
                </header>
                <div
                    v-for="crewType in group.values.filter(
                        (entry) => showUnavailable[group.armType] || entry.available
                    )"
                    :key="crewType.id"
                    class="crew-grid crew-row"
                    :class="{ selected: crewType.id === selectedCrewTypeId }"
                    role="button"
                    tabindex="0"
                    :aria-label="`${crewType.name} ${crewType.available ? '선택 가능' : '선택 불가'}`"
                    @click="selectCrewType(crewType)"
                    @keydown.enter="selectCrewType(crewType)"
                >
                    <span
                        class="crew-image"
                        :style="{ backgroundImage: `url(${JSON.stringify(imageUrl(crewType.id))})` }"
                    />
                    <span class="crew-name" :class="availabilityClass(crewType)"
                        >{{ crewType.name }}<small>{{ crewType.available ? '가능' : '불가' }}</small></span
                    >
                    <span class="attack"><small>공격</small>{{ crewType.attack }}</span>
                    <span class="defence"><small>방어</small>{{ crewType.defence }}</span>
                    <span class="speed"><small>기동</small>{{ crewType.speed }}</span>
                    <span class="avoid"><small>회피</small>{{ crewType.avoid }}</span>
                    <span class="cost"><small>가격</small>{{ displayDecimal(crewType.baseCost) }}</span>
                    <span class="rice"><small>군량</small>{{ displayDecimal(crewType.baseRice) }}</span>
                    <span class="amount-panel" @click.stop>
                        <span class="quick-buttons">
                            <button
                                type="button"
                                @click="
                                    selectCrewType(crewType);
                                    setHalf();
                                "
                            >
                                절반
                            </button>
                            <button
                                type="button"
                                @click="
                                    selectCrewType(crewType);
                                    setFilled();
                                "
                            >
                                채우기
                            </button>
                            <button
                                type="button"
                                @click="
                                    selectCrewType(crewType);
                                    setFull();
                                "
                            >
                                가득
                            </button>
                        </span>
                        <label>
                            <span>병력</span>
                            <input
                                :value="crewType.id === selectedCrewTypeId ? amount : filledAmount(crewType)"
                                type="number"
                                min="1"
                                step="1"
                                @focus="selectCrewType(crewType)"
                                @input="
                                    selectCrewType(crewType);
                                    updateAmount($event);
                                "
                            />
                            <span>00명</span>
                        </label>
                    </span>
                    <span class="crew-action" @click.stop>
                        <button type="button" :disabled="!crewType.available" @click="submit(crewType)">
                            {{ commandName }}
                        </button>
                    </span>
                    <span class="crew-info"
                        ><span v-for="line in crewType.info" :key="line">{{ line }}</span></span
                    >
                </div>
            </section>
        </div>
    </section>
</template>

<style scoped>
.recruitment-command-form {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    color: #fff;
    background: #1d1d1d;
    font: 14px/1.25 var(--sammo-font-sans);
}
.recruitment-intro {
    padding: 6px;
}
.legend,
.crew-name {
    color: #fff;
}
.available {
    background: green !important;
}
.special {
    background: limegreen !important;
}
.unavailable {
    background: #c90000 !important;
}
.mercenary-notice {
    margin: 0;
    padding: 4px;
    text-align: center;
}
.recruitment-status {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    text-align: center;
}
.recruitment-status > span {
    padding: 4px 2px;
}
.injured {
    color: red;
}
.crew-grid {
    display: grid;
    grid-template-columns: 64px 90px repeat(6, minmax(42px, 1fr)) 210px 72px 250px;
    align-items: stretch;
    text-align: center;
}
.crew-header {
    min-height: 30px;
    align-items: center;
}
.crew-header > span,
.crew-row > span {
    min-width: 0;
    display: grid;
    place-items: center;
}
.crew-group > header {
    min-height: 38px;
    display: grid;
    grid-template-columns: 1fr 205px;
    align-items: center;
    border-bottom: 1px solid #777;
}
.crew-group > header strong {
    padding: 0 12px;
    font-size: 1.3em;
}
.crew-group > header button {
    min-height: 34px;
    border: 0;
    background: #444;
    color: #fff;
}
.crew-group > header button.active {
    background: #d89a00;
    color: #111;
}
.crew-row {
    width: 100%;
    min-height: 64px;
    border: 0;
    border-bottom: 1px solid #777;
    padding: 0;
    background: #242424;
    color: #fff;
    font: inherit;
    cursor: pointer;
}
.crew-row:hover,
.crew-row:focus-visible,
.crew-row.selected {
    outline: 2px solid #5bc0de;
    outline-offset: -2px;
}
.crew-image {
    min-height: 64px;
    background: #222 no-repeat center;
    background-size: 64px;
    outline: 1px solid gray;
}
.crew-name {
    height: 100%;
    border: 0;
    font: inherit;
}
.crew-name small {
    display: block;
    font-size: 0.72em;
}
.crew-row small {
    display: none;
}
.amount-panel {
    align-content: center;
    padding: 2px 5px;
}
.quick-buttons {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
}
.quick-buttons button,
.crew-action button,
.submit-recruit {
    min-height: 28px;
    border: 1px solid #777;
    background: #444;
    color: #fff;
}
.amount-panel label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
}
.amount-panel input {
    min-width: 0;
    height: 28px;
    box-sizing: border-box;
    text-align: right;
}
.crew-action button,
.submit-recruit {
    width: 100%;
    height: 100%;
    background: #375a7f;
}
.crew-action button:disabled,
.submit-recruit:disabled {
    opacity: 0.45;
}
.crew-info {
    padding: 4px 8px;
    text-align: left;
}
.crew-info > span {
    display: block;
}
.mobile-selected-panel {
    display: none;
}

@media (max-width: 939px) {
    .recruitment-command-form {
        width: 100%;
        max-width: 100%;
        overflow-x: clip;
    }
    .recruitment-list-front {
        position: sticky;
        z-index: 5;
        top: 44px;
        background: #1d1d1d;
    }
    .recruitment-status {
        grid-template-columns: repeat(3, 1fr);
    }
    .mobile-selected-panel {
        display: grid;
        grid-template-columns: 64px minmax(58px, 76px) minmax(0, 1fr) minmax(64px, 90px);
        min-height: 64px;
        align-items: stretch;
    }
    .mobile-selected-panel .crew-name {
        display: grid;
        place-items: center;
    }
    .mobile-selected-panel .amount-panel label {
        grid-template-columns: auto minmax(0, 1fr) auto 85px;
    }
    .mobile-selected-panel output {
        box-sizing: border-box;
        min-width: 0;
        padding: 4px;
        background: #ddd;
        color: #303030;
        text-align: right;
    }
    .crew-grid {
        grid-template-areas:
            'image name attack defence speed info'
            'image name avoid cost rice info';
        grid-template-columns: 64px minmax(58px, 76px) repeat(3, minmax(26px, 30px)) minmax(0, 1fr);
        grid-template-rows: 32px 32px;
    }
    .crew-grid .crew-image {
        grid-area: image;
    }
    .crew-grid .crew-name {
        grid-area: name;
    }
    .crew-grid .attack {
        grid-area: attack;
    }
    .crew-grid .defence {
        grid-area: defence;
    }
    .crew-grid .speed {
        grid-area: speed;
    }
    .crew-grid .avoid {
        grid-area: avoid;
    }
    .crew-grid .cost {
        grid-area: cost;
    }
    .crew-grid .rice {
        grid-area: rice;
    }
    .crew-grid .crew-info {
        grid-area: info;
    }
    .crew-grid .amount-panel,
    .crew-grid .crew-action {
        display: none;
    }
    .crew-row small {
        display: block;
        font-size: 0.62em;
        line-height: 1;
    }
    .crew-row .crew-name small {
        font-size: 0.72em;
    }
    .crew-header .attack,
    .crew-header .defence,
    .crew-header .speed,
    .crew-header .avoid,
    .crew-header .cost,
    .crew-header .rice {
        font-size: 0.78em;
    }
    .crew-group > header {
        grid-template-columns: 7fr 5fr;
    }
    .crew-group > header button {
        font-size: 0.82em;
    }
    .crew-info {
        overflow: hidden;
        overflow-wrap: anywhere;
        font-size: 0.9em;
    }
}

@media (max-width: 440px) {
    .mobile-selected-panel {
        grid-template-columns: 64px minmax(58px, 76px) minmax(0, 1fr) 72px;
        min-height: 86px;
    }
    .mobile-selected-panel .amount-panel label {
        grid-template-columns: auto minmax(34px, 1fr) auto;
    }
    .mobile-selected-panel output {
        grid-column: 1 / -1;
        min-height: 22px;
        padding: 2px 4px;
    }
    .mobile-selected-panel .quick-buttons button,
    .mobile-selected-panel .submit-recruit {
        min-height: 32px;
    }
}
</style>
