import { useStorage } from '@vueuse/core';
import { effectScope, type Ref } from 'vue';

import type { CommandInputField } from '../components/command/types';

// Ref TopBackBar의 `검색 켜짐/꺼짐`은 처리 화면 상단에 있고 목록 선택기가 그 값을 받는다.
// Core도 상단 바와 인자 폼이 같은 ref를 공유하도록 모듈 단위로 한 번만 만든다.
// 처음 호출한 component가 unmount되어도 저장 watch가 멈추지 않게 분리된 scope에 둔다.
let searchEnabled: Ref<boolean> | undefined;

export const useCommandTargetSearchEnabled = (): Ref<boolean> => {
    searchEnabled ??= effectScope(true).run(() => useStorage('sam.core.commandTargetSearch', false));
    if (!searchEnabled) throw new Error('command target search state was not created');
    return searchEnabled;
};

export const isCommandTargetSearchField = (field: CommandInputField): boolean =>
    field.kind === 'select' && ['generals', 'cities', 'nations'].includes(field.optionSource ?? '');
