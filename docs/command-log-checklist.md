# Command Log Checklist

Mode: action
Strict: off
Keep date: off
Exclude guards: on
Exclude target: on
Ignore file: tools/compare-command-logs.ignore.json

- [ ] General/che_건국
PHP only: 다음 턴부터 건국할 수 있습니다. | <D>${}</>${} 건국하였습니다.
TS only: ${}이 ${}에 국가를 건설하였습니다.
- [ ] General/che_기술연구
PHP only: ${}${} <span class='ev_failed'>실패</span>하여 <C>${}</> 상승했습니다. | ${}${} <S>성공</>하여 <C>${}</> 상승했습니다. | ${}${} 하여 <C>${}</> 상승했습니다.
TS only: 기술 연구로 기술이 ${} 상승했습니다.
- [ ] General/che_단련
PHP only: 단련이 <span class='ev_failed'>지지부진</span>하여 ${} 숙련도가 <C>${}</> 향상되었습니다. | 단련이 <S>일취월장</>하여 ${} 숙련도가 <C>${}</> 향상되었습니다. | ${} 숙련도가 <C>${}</> 향상되었습니다.
TS only: ${}
- [ ] General/che_등용
PHP only: <Y>${}</>에게 등용 권유 서신을 보내지 못했습니다. ${}
- [ ] General/che_상업투자
PHP only: ${}${} <span class='ev_failed'>실패</span>하여 <C>${}</> 상승했습니다. | ${}${} <S>성공</>하여 <C>${}</> 상승했습니다. | ${}${} 하여 <C>${}</> 상승했습니다.
TS only: ${}
- [ ] General/che_선동
PHP only: <G>${}</>에 ${}${} 성공했습니다.
TS only: <G>${}</>에 선동${} 성공했습니다. | 치안이 ${}, 민심이 ${} 만큼 감소했습니다.
- [ ] General/che_소집해제
PHP only: 병사들을 <R>소집해제</>하였습니다.
TS only: 병사들을 소집해제하여 인구가 ${} 증가했습니다.
- [ ] General/che_숙련전환
PHP only: {${}->srcArmTypeName} 숙련 ${}${} {${}->destArmTypeName} 숙련 ${}${} 전환했습니다.
TS only: ${} 숙련 ${}${} ${} 숙련 ${}${} 전환했습니다.
- [ ] General/che_인재탐색
PHP only: <Y>${}</>${}는 <C>인재</>를 ${}하였습니다!
TS only: 인재 <Y>${}</>${} 발견했습니다.
- [ ] General/che_임관
PHP only: <D>${}</>에 임관했습니다.
TS only: 임관을 신청했습니다. (국가 ${})
- [ ] General/che_전투특기초기화
PHP only: 새로운 ${}를 가질 준비가 되었습니다.
TS only: 새로운 전투 특기를 가질 준비가 되었습니다.
- [ ] General/che_정착장려
PHP only: ${}${} <span class='ev_failed'>실패</span>하여 주민이 <C>${}</>명 증가했습니다. | ${}${} <S>성공</>하여 주민이 <C>${}</>명 증가했습니다. | ${}${} 하여 주민이 <C>${}</>명 증가했습니다.
TS only: 인구가 ${} 증가했습니다.
- [ ] General/che_주민선정
PHP only: ${}${} <span class='ev_failed'>실패</span>하여 <C>${}</> 상승했습니다. | ${}${} <S>성공</>하여 <C>${}</> 상승했습니다. | ${}${} 하여 <C>${}</> 상승했습니다.
TS only: 민심이 ${} 상승했습니다.
- [ ] General/che_징병
PHP only: ${} <C>${}</>명을 추가{${}->getName()}했습니다. | ${} <C>${}</>명을 {${}->getName()}했습니다.
TS only: ${}
- [ ] General/che_첩보
PHP only: <G>${}</>의 정보를 많이 얻었습니다. | 【<G>${}</>】주민:${}, 민심:${}, 장수:${}, 병력:${} | 【<M>첩보</>】농업:${}, 상업:${}, 치안:${}, 수비:${}, 성벽:${} | 【<S>병종</>】 ${} | 【<span class='ev_notice'>{${}->destNation['name']}</span>】아국대비기술:${} | <G>${}</>의 정보를 어느 정도 얻었습니다. | <G>${}</>의 소문만 들을 수 있었습니다.
TS only: <G>${}</>의 정보를 ${} 얻었습니다. | 주민:${}, 민심:${}, ...
- [ ] General/che_출병
TS only: 경로에 도달할 방법이 없습니다. | <G>${}</>${} 가는 도중 <G>${}</>을 거치기로 합니다.
- [ ] General/che_탈취
PHP only: <G>${}</>에 ${}${} 성공했습니다.
TS only: <G>${}</>에 탈취${} 성공했습니다. | 금 ${}, 쌀 ${} 을 획득했습니다.
- [ ] General/che_파괴
PHP only: <G>${}</>에 ${}${} 성공했습니다.
TS only: <G>${}</>에 파괴${} 성공했습니다. | 수비가 ${}, 성벽이 ${} 만큼 감소했습니다.
- [ ] General/che_하야
PHP only: <D>${}</>에서 하야했습니다.
TS only: 하야하여 재야로 돌아갑니다.
- [ ] General/che_화계
PHP only: <G>${}</>에 ${}${} 성공했습니다. | <G>${}</>에 ${}${} 실패했습니다.
TS only: <G>${}</>에 화계 실패했습니다. | <G>${}</>에 화계 성공했습니다.
- [ ] Nation/che_국호변경
PHP only: 이미 같은 국호를 가진 곳이 있습니다. ${} 실패 | 국호를 <D>${}</>${} 변경합니다.
TS only: 국호를 <D>${}</>로 변경하였습니다.
- [ ] Nation/che_급습
PHP only: ${} 발동!
TS only: 급습 발동!
- [ ] Nation/che_몰수
PHP only: <Y>{${}->getName()}</>에게서 ${} <C>${}</>${} 몰수했습니다.
TS only: ${}에게서 몰수할 ${}이 없습니다. | <Y>${}</>에게서 ${} <C>${}</>${} 몰수했습니다.
- [ ] Nation/che_발령
PHP only: <Y>${}</>에 의해 <G>${}</>${} 발령됐습니다.
- [ ] Nation/che_부대탈퇴지시
PHP only: <Y>${}</>에게 부대 탈퇴를 지시 받았습니다.
- [ ] Nation/che_불가침제의
PHP only: <D>${}</>${} 불가침 제의 서신을 보냈습니다.
TS only: 불가침 제의을 준비했습니다. (국가 ${})
- [ ] Nation/che_불가침파기제의
PHP only: <D>${}</>${} 불가침 파기 제의 서신을 보냈습니다.
TS only: 불가침 파기 제의을 준비했습니다. (국가 ${})
- [ ] Nation/che_의병모집
PHP only: ${} 발동!
TS only: 의병모집 발동!
- [ ] Nation/che_이호경식
PHP only: ${} 발동!
TS only: 이호경식 발동!
- [ ] Nation/che_포상
PHP only: <Y>{${}->getName()}</>에게 ${} <C>${}</>${} 수여했습니다.
TS only: <Y>${}</>에게 ${} ${}${} 수여했습니다.
- [ ] Nation/che_피장파장
PHP only: <G>{${}->getName()}</> 전략의 ${} 발동!
TS only: <G>${}</> 전략의 피장파장 발동!
- [ ] Nation/cr_인구이동
TS only: 이동할 인구가 부족합니다.
