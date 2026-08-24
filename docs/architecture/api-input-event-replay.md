# API input-event 재실행·복구 계약

## 목적과 범위

game-api mutation은 HTTP `Idempotency-Key`를 profile·인증 actor와 함께 scope한 base ID,
tRPC procedure path, batch index에서 만든 operation key를 `input_event.request_id`로
사용한다. 이 원장은 동일 요청이 네트워크
재시도나 응답 유실 때문에 다시 도착했을 때 업무 mutation을 두 번 실행하지 않고,
이미 성공한 응답을 그대로 재생하기 위한 durable 경계다.

이 계약은 `target = 'API'`인 tRPC mutation에만 적용한다. turn daemon의
`target = 'ENGINE'` 처리와 gameplay 계산·RNG 순서는 바꾸지 않는다.

## 요청 identity와 저장 경계

요청 identity는 다음 네 요소가 모두 같은 경우에만 일치한다.

- scoped request ID
- tRPC procedure path인 `event_type`
- 인증된 서버-side `actor_user_id`
- HTTP JSON decoding 뒤 `getRawInput()`이 돌려준 raw tRPC input의 canonical SHA-256 digest

raw input을 사용하므로 parser가 strip·transform하는 field도 operation identity에는 포함된다.

`payload`에는 원문 대신 다음처럼 고정 크기 identity envelope만 저장한다.

```json
{
    "version": 1,
    "digest": "sha256:<64 hexadecimal characters>"
}
```

object key 순서는 digest에 영향을 주지 않지만 배열 순서와 값은 영향을 준다.
따라서 `board.uploadImage`의 data URL, 토큰, 자유 입력처럼 크거나 민감할 수 있는
필드를 `input_event`에 한 번 더 영구 복제하지 않는다. digest만으로 원래 입력을
복원하거나 사후 감사할 수는 없다. 입력 원문 보존이 필요한 별도 기능은 목적에 맞는
접근 제어와 retention을 가진 저장소를 사용해야 한다.

성공한 업무의 실제 JSON 응답은 canonical JSON으로 `result`에 저장한다. 정확히 같은
재요청은 업무 code를 다시 호출하지 않고 이 값을 200 응답으로 재생한다. 응답 자체에
개인정보나 큰 payload가 들어갈 수 있으므로 `input_event` DB 접근 권한과 retention은
별도로 제한해야 한다. 이 변경은 result retention 정책을 새로 정하지 않는다.

## transaction과 상태 전이

각 요청은 하나의 PostgreSQL transaction에서 해당 row를 `FOR UPDATE`로 잠근다.

```text
없는 row -> PENDING 삽입 -> PROCESSING(attempts + 1)
                           -> SAVEPOINT
                           -> 업무 mutation + read-model journal
                              -> SUCCEEDED + 실제 result -> COMMIT
                              -> 업무 오류: ROLLBACK TO SAVEPOINT
                                 -> FAILED + error -> COMMIT -> 오류 반환
```

`PROCESSING` 표시, 업무 mutation, `SUCCEEDED`와 result 저장은 같은 transaction에
있다. process나 DB connection이 commit 전에 사라지면 모두 rollback되어 새로 만든
row는 없어지거나 기존 PENDING/FAILED 상태로 되돌아간다. 업무 오류는 savepoint까지만
rollback해 업무 write를 남기지 않으면서 FAILED와 증가한 attempts를 durable하게
남긴다.

transaction 결과를 client가 받지 못한 ambiguous failure도 고려한다. 별도 실패
기록기는 row lock 아래 현재 상태를 다시 확인하며, 이미 commit된 SUCCEEDED나 다른
실행의 PROCESSING을 FAILED로 덮지 않는다.

상태별 처리 계약은 다음과 같다.

| 기존 상태               | identity 일치 | 처리                                                         |
| ----------------------- | ------------- | ------------------------------------------------------------ |
| `SUCCEEDED`             | 예            | 저장된 `result`를 200으로 재생, attempts 불변                |
| `SUCCEEDED`             | 아니오        | `CONFLICT`(HTTP 409), 업무 미실행                            |
| `PENDING` 또는 `FAILED` | 예            | row lock 아래 claim하고 attempts를 정확히 1 증가한 뒤 재실행 |
| `PENDING` 또는 `FAILED` | 아니오        | `CONFLICT`, 업무 미실행                                      |
| `PROCESSING`            | 무관          | fail-closed `CONFLICT`, 자동 reclaim 금지                    |

구버전이 `FAILED`, `payload = {}`, `result IS NULL`로 남긴 row는 event type과 actor가
같을 때만 현재 digest를 최초 1회 채택해 retry할 수 있다. 반면 구버전
`PROCESSING + payload = {}`는 identity와 활성 transaction 종료 여부를 증명할 수
없어 age나 lease를 기준으로 자동 reclaim하지 않는다. 구버전 SUCCEEDED placeholder도
원 응답을 복원할 수 없으므로 현재 digest와 일치하는 replay로 간주하지 않는다.

동일 HTTP batch 안에서 같은 procedure path가 여러 번 호출될 수 있다. index 0은 기존
호환 key인 `<base-request-id>:<path>`를 유지하고, 이후 호출은
`<base-request-id>:<path>:batch:<index>`를 사용해 서로 충돌하지 않게 한다.

## rolling deployment 전 확인

새 binary를 투입하기 전에 구 binary로 들어오는 mutation을 drain하고, 각 profile
schema에서 다음 read-only query 결과가 0인지 확인한다.

```sql
SELECT count(*)
FROM input_event
WHERE target = 'API'
  AND status = 'PROCESSING';
```

0이 아니면 새 binary가 해당 row를 자동 복구하도록 두지 않는다. 구 process와 traffic을
먼저 완전히 drain한 뒤, request별 업무 commit 여부를 확인할 수 있는 offline
reconciliation 절차를 별도로 수행한다. 생성 시각이나 processing age만 보고 status를
바꾸거나 요청을 재실행하면 오래 실행 중인 구 transaction과 중복 mutation이 생길 수
있다.

## 검증 위치와 남은 경계

- `app/game-api/test/inputEventBoundary.test.ts`: canonical digest와 원문 비저장
- `app/game-api/test/inputEventBoundary.integration.test.ts`: 실제 PostgreSQL row
  lock, replay, conflict, retry/attempts, legacy row, concurrent race와 commit ambiguity
- `app/game-api/test/securityTransport.integration.test.ts`: 실제 HTTP/tRPC 응답 replay,
  durable payload identity/result와 업무 DB/Redis side effect 불변
- `app/game-api/test/requestId.test.ts`: 동일 path batch index 분리

현재 frontend가 사용자 동작별 stable idempotency key를 발급·재사용하는 계약은 이
범위에 포함되지 않는다. 따라서 client가 재시도 때 새 base request ID를 만들면 server
원장은 두 요청을 같은 operation으로 묶을 수 없다.
