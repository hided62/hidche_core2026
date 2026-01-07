import { type MapDefinition, type MapCityDefinition } from '../../src/world/types.js';

export const MINIMAL_MAP_CITIES: MapCityDefinition[] = [
    {
        id: 1,
        name: '소성A',
        level: 1, // 소성
        region: 1, // 지역A
        position: { x: 50, y: 10 },
        connections: [2, 3, 5, 6, 8], // B, C, E, F, H
        max: { population: 20000, agriculture: 2000, commerce: 2000, security: 2000, defence: 500, wall: 500 },
        initial: { population: 5000, agriculture: 100, commerce: 100, security: 100, defence: 100, wall: 100 },
    },
    {
        id: 2,
        name: '중성B',
        level: 2, // 중성
        region: 2, // 지역B
        position: { x: 20, y: 30 },
        connections: [1, 4, 5, 6, 9], // A, D, E, F, I
        max: { population: 30000, agriculture: 3000, commerce: 3000, security: 3000, defence: 600, wall: 600 },
        initial: { population: 8000, agriculture: 200, commerce: 200, security: 200, defence: 200, wall: 200 },
    },
    {
        id: 3,
        name: '중성C',
        level: 2, // 중성
        region: 3, // 지역C
        position: { x: 80, y: 30 },
        connections: [1, 4, 5, 7, 8], // A, D, E, G, H
        max: { population: 30000, agriculture: 3000, commerce: 3000, security: 3000, defence: 600, wall: 600 },
        initial: { population: 8000, agriculture: 200, commerce: 200, security: 200, defence: 200, wall: 200 },
    },
    {
        id: 4,
        name: '소성D',
        level: 1, // 소성
        region: 4, // 지역D
        position: { x: 50, y: 50 },
        connections: [2, 3, 5, 7, 9], // B, C, E, G, I
        max: { population: 20000, agriculture: 2000, commerce: 2000, security: 2000, defence: 500, wall: 500 },
        initial: { population: 5000, agriculture: 100, commerce: 100, security: 100, defence: 100, wall: 100 },
    },
    {
        id: 5,
        name: '특성E',
        level: 4, // 특성
        region: 5, // 지역E
        position: { x: 50, y: 30 },
        connections: [1, 2, 3, 4], // A, B, C, D
        max: { population: 50000, agriculture: 5000, commerce: 5000, security: 5000, defence: 1000, wall: 1000 },
        initial: { population: 15000, agriculture: 500, commerce: 500, security: 500, defence: 300, wall: 300 },
    },
    {
        id: 6,
        name: '이성F',
        level: 3, // 이성
        region: 1, // 지역A
        position: { x: 30, y: 10 },
        connections: [1, 2], // A, B
        max: { population: 40000, agriculture: 4000, commerce: 4000, security: 4000, defence: 800, wall: 800 },
        initial: { population: 10000, agriculture: 300, commerce: 300, security: 300, defence: 250, wall: 250 },
    },
    {
        id: 7,
        name: '진G',
        level: 5, // 진 (Map defaults might interpret this differently, using Level 1-4 standard usually)
        region: 4, // 지역D
        position: { x: 70, y: 50 },
        connections: [3, 4], // C, D
        max: { population: 20000, agriculture: 2000, commerce: 2000, security: 2000, defence: 1000, wall: 1000 },
        initial: { population: 4000, agriculture: 100, commerce: 100, security: 100, defence: 500, wall: 500 },
    },
    {
        id: 8,
        name: '수H',
        level: 6, // 수
        region: 3, // 지역C
        position: { x: 90, y: 20 },
        connections: [1, 3], // A, C
        max: { population: 20000, agriculture: 2000, commerce: 2000, security: 2000, defence: 1000, wall: 1000 },
        initial: { population: 4000, agriculture: 100, commerce: 100, security: 100, defence: 500, wall: 500 },
    },
    {
        id: 9,
        name: '관I',
        level: 7, // 관
        region: 2, // 지역B
        position: { x: 10, y: 40 },
        connections: [2, 4], // B, D
        max: { population: 20000, agriculture: 2000, commerce: 2000, security: 2000, defence: 1000, wall: 1000 },
        initial: { population: 4000, agriculture: 100, commerce: 100, security: 100, defence: 500, wall: 500 },
    },
];

export const MINIMAL_MAP: MapDefinition = {
    id: 'minimal_map',
    name: '최소형맵',
    cities: MINIMAL_MAP_CITIES,
    defaults: {
        trust: 50,
        trade: 100,
        supplyState: 1,
        frontState: 0,
    },
};
