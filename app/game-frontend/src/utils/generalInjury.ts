export type GeneralInjuryPresentation = { text: string; color: string };

export const generalInjuryPresentation = (injury: number): GeneralInjuryPresentation => {
    if (injury > 60) return { text: '위독', color: '#ff0000' };
    if (injury > 40) return { text: '심각', color: '#ff00ff' };
    if (injury > 20) return { text: '중상', color: '#ffa500' };
    if (injury > 0) return { text: '경상', color: '#ffff00' };
    return { text: '건강', color: '#ffffff' };
};
