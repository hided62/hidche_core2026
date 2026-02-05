# Command Log Checklist

Mode: action
Strict: off
Keep date: off
Exclude guards: on
Exclude target: on
Ignore file: tools/compare-command-logs.ignore.json

- [ ] General/che_건국
PHP only: <D>${}</>${} 건국하였습니다.
TS only: <D>${}</>을 건국하였습니다.
- [ ] General/che_정착장려
PHP only: ${}${} <span class='ev_failed'>실패</span>하여 주민이 <C>${}</>명 증가했습니다. | ${}${} <S>성공</>하여 주민이 <C>${}</>명 증가했습니다.
- [ ] General/che_징병
PHP only: ${} <C>${}</>명을 추가${}했습니다. | ${} <C>${}</>명을 ${}했습니다.
TS only: ${} 추가징병했습니다. | ${} 징병했습니다.
- [ ] General/che_첩보
PHP only: <G>${}</>의 정보를 많이 얻었습니다. | 【<G>${}</>】주민:${}, 민심:${}, 장수:${}, 병력:${} | 【<M>첩보</>】농업:${}, 상업:${}, 치안:${}, 수비:${}, 성벽:${} | 【<S>병종</>】 ${} | 【<span class='ev_notice'>${}</span>】아국대비기술:${} | <G>${}</>의 정보를 어느 정도 얻었습니다. | <G>${}</>의 소문만 들을 수 있었습니다.
TS only: <G>${}</>의 정보를 ${} 얻었습니다. | 주민:${}, 민심:${}, ...
