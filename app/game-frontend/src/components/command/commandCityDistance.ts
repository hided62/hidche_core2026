import type { CommandMapLayout } from './types';

// Ref `v_processing.php`의 ProcessCity는 명령별 `JSCitiesBasedOnDistance(현재 도시, N)` 결과를
// `CitiesBasedOnDistance.vue`로 `N칸 떨어진 도시:` 줄에 보여 준다. 사령턴 도시 명령(천도·수몰 등)은
// 빈 목록을 보내 줄이 없고, 발령·인구이동은 값을 보내지만 화면에 쓰지 않는다.
export const COMMAND_CITY_DISTANCE_RANGE: Readonly<Record<string, number>> = {
    che_이동: 1,
    che_출병: 1,
    che_강행: 3,
    che_첩보: 3,
    che_화계: 3,
    che_탈취: 3,
    che_파괴: 3,
    che_선동: 3,
};

export type CityDistanceGroup = {
    distance: number;
    cityIds: number[];
};

type CityPathSource = Pick<CommandMapLayout['cityList'][number], 'id' | 'path'>;

/**
 * Ref `searchDistance($from, $maxDist, true)`와 같은 BFS 순서로 1칸부터 maxDistance칸까지의 도시를 모은다.
 * 같은 거리 안의 순서는 앞 거리 도시 순서와 각 도시 연결 목록 순서를 따른다. 빈 거리도 Ref처럼 남긴다.
 */
export const citiesBasedOnDistance = (
    startCityId: number,
    cityList: readonly CityPathSource[],
    maxDistance: number
): CityDistanceGroup[] => {
    const paths = new Map(cityList.map((city) => [city.id, city.path]));
    const visited = new Set<number>([startCityId]);
    const groups: CityDistanceGroup[] = [];
    let frontier = [startCityId];
    for (let distance = 1; distance <= maxDistance; distance += 1) {
        const next: number[] = [];
        for (const cityId of frontier) {
            for (const adjacentId of paths.get(cityId) ?? []) {
                if (visited.has(adjacentId)) continue;
                visited.add(adjacentId);
                next.push(adjacentId);
            }
        }
        groups.push({ distance, cityIds: next });
        frontier = next;
    }
    return groups;
};
