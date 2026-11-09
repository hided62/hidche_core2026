# 플레이 감사 저장량과 운영 정리

2026-11-09 저장 최적화는 Core 전용 감사의 물리 표현과 정리 구현을 바꾼다.
현재 기수 전체 기록·판단 순서·정책 참조·hash·API 응답·권한은 유지한다.
원문 샘플링이나 보존기간 축소를 하지 않는다.

## 물리 표현

- 결정 chunk는 기존 `steps` JSONB 배열 또는 `{encoding:"gzip-json-v1",data:"base64"}`로 저장한다.
  128 step 단위는 그대로이며 gzip level 3을 사용한다. 압축 envelope가 더 크면 원래 배열을 쓴다.
- replay hash는 압축 전 원문으로 계산한다. API는 공용 decoder 뒤 기존 step schema를 검증한다.
  손상·알 수 없는 버전은 조회 오류이며 빈 자료로 바꾸지 않는다.
- 압축 해제는 chunk당 16MiB로 제한한다. 더 큰 원문은 기존 배열로 저장해 잘라내지 않는다.
- 장수 snapshot `data`와 결정 `summary`는 PostgreSQL `STORAGE MAIN`,
  `toast_tuple_target=512`로 작은 반복 JSON도 inline 압축한다. JSON 값은 바뀌지 않는다.
- migration `20261109000000_compact_play_audit_storage`는 기존 테이블을 재작성하지 않는다.
  chunk CHECK는 새 쓰기에 즉시 적용하고 대형 과거 자료 검사는 `NOT VALID`로 미룬다.
  정리 후 `ALTER TABLE ... VALIDATE CONSTRAINT play_audit_decision_chunk_steps_check`를 실행한다.
  기존 자료의 압축 변경은 별도 bounded backfill 또는 검증된 export/restore가 필요하다.

## 정리 처리량과 실행 수명주기

- 이전 기수 결정 부모를 기존 `(server_id,nation_id,tick,id)` 인덱스로 최대 200개 잠근다.
  한 transaction의 chunk+header 삭제 합도 200행 이하이며 큰 결정 하나가 있어도 상한을 지킨다.
- 다음 성공 batch까지 100ms를 기다린다. RESET과 동일 advisory lock, identity 재검사,
  2초 statement/250ms lock 제한, rollback을 유지한다. 현재 기수의 결정과 표본은 삭제하지 않는다.
- API outbox는 전달 후 24시간을 보존한다. 기존 인덱스 순서로 최대 500행씩 정리하고,
  backlog가 있으면 다음 dispatch에서도 이어간다. 한 호출은 최대 10 batch/50ms이며
  미전달 자료는 삭제하지 않는다. 빈 상태에서는 60초 주기로 돌아간다.
- game API/daemon이 중지된 프로필도 host scheduler가 다음 CLI로 정리한다.
  CLI는 접속 URL이나 SQL 원문을 출력하지 않는다. 기본은 dry-run이다.

```sh
# 먼저 common/logic/infra/game-engine을 빌드한다. 접속 정보는 기존 process 환경으로 전달한다.
node tools/play-audit-maintenance.mjs --schemas=che,kwe,pwe,twe,nya,pya,hwe
node tools/play-audit-maintenance.mjs --schemas=che,kwe,pwe,twe,nya,pya,hwe --budget-ms=3000 --apply
```

schema마다 최신 identity를 읽고 각 삭제 transaction에서 다시 확인한다. 예상 identity가 바뀌면
그 schema의 처리를 중단한다. host timer는 다음 실행에서 새 identity를 읽는다.
장수/국가/명령/input_event 같은 gameplay 테이블은 이 CLI의 삭제 대상이 아니다.

## ZFS 운영 경계

호스트는 감사 전용 tablespace와 backup 전용 dataset을 별도로 제공한다.
hot gameplay, WAL, legacy archive를 임의로 이동하지 않는다. DB와 tablespace는 한 cluster이므로
tablespace 파일만 백업하는 것으로 복구를 보장하지 않는다.

1. 전체 DB의 일관된 압축 backup을 ZFS에 만들고 checksum, archive 읽기, 실제 복원을 확인한다.
2. DB 보존 DEPLOY로 writer/reader/migration을 함께 적용한다.
3. profile 상태를 기록하고 공식 STOP으로 쓰기를 중단한다. 원래 STOPPED인 profile은 유지한다.
4. 각 schema에서 현재 serverId의 8개 감사 테이블을 일관되게 export한다.
   월 child는 현재 월 header와 join하고 결정 chunk는 현재 결정 header와 join한다.
5. 격리 DB에서 복원·건수·내용 hash를 검증한다. 이전 기수는 전체 ZFS backup에 남는다.
6. 하나의 transaction에서 감사 테이블만 TRUNCATE하고 ZFS tablespace로 옮긴 뒤
   현재 기수 export를 다시 넣는다. 부모를 먼저 넣고 모든 건수/hash와 identity를 확인한 뒤 commit한다.
   index도 별도로 ZFS로 옮긴다. 실패하면 전체 transaction을 rollback한다.
7. CHECK 검증과 ANALYZE를 수행하고 원래 RUNNING이었던 profile만 공식 START한다.
   현재 기록, 새 기록의 decode/hash, lease/clock, 공개 HTTPS와 루트/ZFS 실제 사용량을 확인한다.

기존 데이터가 적을 때는 bounded DELETE 뒤 별도 재작성으로 공간을 회수할 수도 있다.
수천만 건 backlog에서 export/TRUNCATE/restore는 현재 자료를 보존하며 물리 공간을 즉시
회수하기 위한 계획된 유지보수 절차다. backup 검증이나 profile 정지가 빠진 자동 작업으로 쓰지 않는다.
ZFS dataset이 없을 때 루트 디렉터리에 쓰지 않도록 host mount guard와 재현 가능한 Compose 설정이 필요하다.

## rollback

이전 reader는 압축 envelope를 이해하지 못한다. 구형 버전으로 돌아가기 전 해당 기록을
새 decoder로 원래 JSON 배열로 변환하고 같은 hash/개수를 검증한다. 물리 압축 설정은
이전 애플리케이션과 호환되며 원래 TOAST 설정으로 돌릴 필요가 없다.
현재 기수 복원 중 실패하면 transaction rollback으로 기존 table/data/tablespace를 보존한다.
기수 전체 과거 자료가 필요하면 ZFS의 변경 전 backup을 별도 DB에 복원한다.
운영 DB 전체를 과거 dump로 덮어써 새 gameplay를 잃게 하지 않는다.
