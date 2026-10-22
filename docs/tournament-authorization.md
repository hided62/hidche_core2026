# 토너먼트의 사용자·장수 권한과 운영 전환

참가와 베팅의 actor는 인증된 사용자이며 장수 ID는 actor의 현재 소유 자원입니다.
API 조회와 ENGINE 실행 사이에 소유권이 바뀔 수 있으므로
`tournamentAdjustGeneral`은 `userId`와 `generalId`를 함께 전달하고 durable
`InputEvent.actorUserId` 및 실행 시점 world의 소유자를 다시 검사합니다. 다른
소유자의 금·통계는 차감과 보상 모두 변경하지 않습니다.

참가비는 현재 개발비, 베팅은 최소 10금·사용자별 합계 1000금·차감 후 500금
이상을 유지합니다. 금과 `betgold`는 한 ENGINE event에서 갱신합니다. 베팅은
기존처럼 SUSPENDED의 동결된 게임 시각에도 허용하고 참가 명령은 허용하지
않습니다. RECONCILING에서는 베팅 금융 명령을 새로 claim하지 않습니다.

Redis 베팅 row의 `userId`는 서버가 인증 session에서 기록합니다. 사용자별
한도와 개인 합계는 장수 교체 후에도 이 ID로 검사합니다. `generalId`·`targetId`가
같아도 사용자가 다르면 row를 합치지 않습니다. NPC row는 `userId: null`, 구형
row는 field 생략으로 구분합니다. 당첨금·취소 환급의 장수 ID 기준 자산 정산은
Ref의 기존 계약을 유지합니다. 당시 사용자의 개인 표시와 장수의 자산 귀속은
동일한 개념이 아닙니다.

NPC worker는 deterministic 계획을 먼저 저장하고 `tournamentSeedNpcBets`의
durable 결과를 기다립니다. ENGINE은 유저가 소유하게 된 NPC를 건너뛰고 남은
NPC의 금·통계를 함께 처리합니다. worker는 실제 처리된 ID만 베팅 projection에
기록한 뒤 stage 6을 공개합니다. 응답이 불확실하면 같은 request ID와 계획으로
재시도하며 NPC를 새로 선택하지 않습니다. 계획/RNG 생성 순서는 유지합니다.

## 구형 설치에서 전환

API·ENGINE·tournament worker를 같은 변경 세대로 전환해야 합니다. 새 API만
배포하면 구형 ENGINE은 새 명령을 처리할 수 없고, 구형 API만 남기면 새 ENGINE은
actor 없는 구형 토너먼트 `adjustGeneralResources/Meta` 명령을 거부합니다.
종료된 베팅과 정상 완료된 큐를 확인한 뒤 전환하는 것을 기본으로 합니다.

현재 owner로 구형 row의 당시 사용자를 추정하지 않습니다. 사용자 ID가 없는 row는
전체 풀·기존 정산에 유지하지만 개인 합계에 표시하지 않으며, 해당 베팅에 신규
베팅을 허용하지 않습니다. 활성 베팅을 유지해야 한다면 관리자가 당시 사용자
정보를 확인한 row만 `setBettingEntries`로 복원하고 NPC에는 null을 지정합니다.
근거가 없는 row를 현재 owner로 자동 backfill하거나 큐/베팅을 임의 삭제하지 않습니다.

이전 버전의 NPC 비용/통계 두 명령이 일부만 실행된 상태라면 동일 계획의 새
atomic 명령을 바로 재실행하지 않습니다. 기존 InputEvent 결과와 자원·통계를
대조하여 완료 여부를 먼저 복구해야 합니다. 이 변경은 자동 saga migration을
제공하지 않습니다.

ENGINE transaction과 Redis projection은 별도 저장소입니다. projection 쓰기 실패
뒤 compensation을 시도하지만 그 사이 소유자가 바뀌면 다른 owner의 자원을
수정하지 않도록 거부합니다. 전체 PostgreSQL/Redis crash recovery와 자동
reconciliation을 보장하지 않으며 기존 saga의 한계는 유지됩니다.
