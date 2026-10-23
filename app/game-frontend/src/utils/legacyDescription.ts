/**
 * 카탈로그 설명의 Ref 줄바꿈만 해석한다. 반환값은 반드시 text interpolation으로
 * 렌더링하며 HTML로 삽입하지 않는다. 빈 줄과 공백의 표시 정책은 소비자가 정한다.
 */
export const splitLegacyLineBreaks = (value: string): string[] => value.split(/<br\s*\/?\s*>|\r\n?|\n/giu);
