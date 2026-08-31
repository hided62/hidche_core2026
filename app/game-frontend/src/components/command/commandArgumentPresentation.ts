import type { CommandInputField } from './types';

export type CommandArgumentMapTarget = 'city' | 'nation';

export type CommandArgumentPresentation = {
    lines: string[];
    mapTarget?: CommandArgumentMapTarget;
};

const cityTarget = (lines: string[]): CommandArgumentPresentation => ({ lines, mapTarget: 'city' });
const nationTarget = (lines: string[]): CommandArgumentPresentation => ({ lines, mapTarget: 'nation' });

// Ref hwe/ts/processing의 명령별 안내를 예약 명령 옵션창에 맞게 옮긴다.
// 징병/모병은 별도 이관 범위이므로 이 표에 넣지 않는다.
const PRESENTATIONS: Record<string, CommandArgumentPresentation> = {
    che_강행: cityTarget(['선택한 도시로 강행합니다.', '최대 3칸 안의 도시만 선택할 수 있습니다.']),
    che_이동: cityTarget(['선택한 도시로 이동합니다.', '인접한 도시로만 이동할 수 있습니다.']),
    che_출병: cityTarget([
        '선택한 도시를 향해 침공합니다.',
        '침공 경로에 적군 도시가 있으면 그 도시에서 전투를 벌입니다.',
    ]),
    che_첩보: cityTarget(['선택한 도시에 첩보를 실행합니다.', '인접 도시에서는 더 많은 정보를 얻습니다.']),
    che_화계: cityTarget(['선택한 도시에 화계를 실행합니다.']),
    che_탈취: cityTarget(['선택한 도시에 탈취를 실행합니다.']),
    che_파괴: cityTarget(['선택한 도시에 파괴를 실행합니다.']),
    che_선동: cityTarget(['선택한 도시에 선동을 실행합니다.']),
    che_수몰: cityTarget(['선택한 도시에 수몰을 발동합니다.', '전쟁 중인 상대국 도시만 대상이 됩니다.']),
    che_백성동원: cityTarget(['선택한 도시에 백성을 동원해 성벽을 쌓습니다.', '아국 도시만 대상이 됩니다.']),
    che_천도: cityTarget([
        '선택한 도시로 수도를 옮깁니다.',
        '현재 수도에서 연결된 도시만 가능하며 1 + 2 × 거리만큼의 턴이 필요합니다.',
    ]),
    che_허보: cityTarget(['선택한 도시에 허보를 발동합니다.', '선포 또는 전쟁 중인 상대국 도시만 대상이 됩니다.']),
    che_초토화: cityTarget([
        '선택한 도시를 초토화해 공백지로 만듭니다.',
        '인구와 내정 상태에 따라 국고를 확보하고, 수뇌 명성과 모든 장수의 배신 수치에 영향을 줍니다.',
    ]),
    cr_인구이동: cityTarget(['현재 도시의 인구를 선택한 인접 도시로 이동합니다.']),
    che_발령: cityTarget(['선택한 도시로 아국 장수를 발령합니다.', '아국 도시만 대상이 됩니다.']),
    che_선전포고: nationTarget([
        '선택한 국가에 선전포고합니다.',
        '고립되지 않은 아국 도시와 인접한 국가에만 가능하며 초반 제한의 영향을 받습니다.',
    ]),
    che_급습: nationTarget(['선택한 국가에 급습을 발동합니다.', '선포 또는 전쟁 중인 상대국만 대상이 됩니다.']),
    che_불가침파기제의: nationTarget(['불가침 중인 국가에 조약 파기를 제의합니다.']),
    che_이호경식: nationTarget(['선택한 국가에 이호경식을 발동합니다.', '선포 또는 전쟁 중인 상대국만 대상이 됩니다.']),
    che_종전제의: nationTarget(['전쟁 중인 국가에 종전을 제의합니다.']),
    che_불가침제의: nationTarget([
        '선택한 국가에 불가침을 제의합니다.',
        '불가침 기한 다음 달부터 다시 선전포고할 수 있습니다.',
    ]),
    che_피장파장: nationTarget([
        '선택한 국가가 지정한 전략을 일정 턴 동안 사용하지 못하게 합니다.',
        '아국에도 지정 전략의 재사용 제한이 생깁니다.',
    ]),
    che_물자원조: nationTarget(['타국에 금과 쌀을 원조합니다.', '국가 작위에 따라 보낼 수 있는 금액이 제한됩니다.']),

    che_증여: { lines: ['자신의 금이나 쌀을 선택한 장수에게 증여합니다.'] },
    che_헌납: { lines: ['자신의 금이나 쌀을 국가 재산으로 헌납합니다.'] },
    che_군량매매: { lines: ['자신의 군량을 사거나 팝니다.'] },
    che_몰수: { lines: ['선택한 장수의 금이나 쌀을 몰수해 국가 재산으로 귀속합니다.'] },
    che_포상: { lines: ['국고에서 선택한 장수에게 금이나 쌀을 지급합니다.'] },
    che_부대탈퇴지시: { lines: ['선택한 장수에게 부대 탈퇴를 지시합니다.', '현재 부대원인 장수만 대상이 됩니다.'] },
    che_등용: { lines: ['재야 또는 타국 장수에게 등용 서신을 보냅니다.', '서신은 개인 메시지로 전달됩니다.'] },
    che_선양: { lines: ['군주의 자리를 선택한 아국 장수에게 물려줍니다.'] },
    che_임관: {
        lines: [
            '선택한 국가에 임관하고 군주의 위치로 이동합니다.',
            '이미 임관하거나 등용되었던 국가는 선택할 수 없습니다.',
        ],
    },
    che_장수대상임관: {
        lines: ['선택한 장수를 따라 그 장수의 국가에 임관하고 군주의 위치로 이동합니다.'],
    },
    che_숙련전환: {
        lines: ['선택한 병과 숙련을 40% 줄이고, 줄어든 숙련의 90%를 다른 병과 숙련으로 전환합니다.'],
    },
    che_장비매매: { lines: ['장비를 구입하거나 매각합니다.', '가격과 요구 치안, 장비 효과를 확인한 뒤 선택하세요.'] },
    che_건국: {
        lines: ['현재 중·소도시에서 나라를 세웁니다.', '국가 성향별 장단점을 확인한 뒤 국명과 색상을 정하세요.'],
    },
    che_무작위건국: {
        lines: ['무작위 공백 중·소도시에서 나라를 세웁니다.', '국가 성향별 장단점을 확인한 뒤 국명과 색상을 정하세요.'],
    },
    cr_건국: { lines: ['현재 도시에서 규모 제한 없이 나라를 세웁니다.', '국가 성향별 장단점을 확인하세요.'] },
    che_국기변경: { lines: ['국기의 색상을 변경합니다.', '이 명령은 한 번만 실행할 수 있습니다.'] },
    che_국호변경: { lines: ['국가 이름을 변경합니다.', '황제가 된 뒤 한 번만 실행할 수 있습니다.'] },
    che_등용수락: { lines: ['도착한 등용 제의에 응할 행동을 선택합니다.'] },
    che_NPC능동: { lines: ['NPC 장수의 능동 행동 방식을 선택합니다.'] },
};

export const commandArgumentPresentation = (commandKey: string): CommandArgumentPresentation =>
    PRESENTATIONS[commandKey] ?? { lines: [] };

/**
 * 대상 지도는 명령명 목록이 아니라 API가 내린 실제 인자 계약을 우선한다.
 */
export const resolveCommandArgumentMapTarget = (
    commandKey: string,
    fields: readonly CommandInputField[]
): CommandArgumentMapTarget | undefined => {
    const selectableTargets = fields.filter((field) => field.kind === 'select');
    if (selectableTargets.some((field) => field.optionSource === 'cities')) return 'city';
    if (selectableTargets.some((field) => field.optionSource === 'nations')) return 'nation';
    return commandArgumentPresentation(commandKey).mapTarget;
};

export const presentedCommandKeys = (): string[] => Object.keys(PRESENTATIONS);
