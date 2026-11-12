# Hyper-V 저장·복원 이후 게임 복구

Windows 재부팅 때 Linux VM이 저장·복원되면 게스트의 shutdown/resume hook이
실행되지 않을 수 있다. 게임은 종료 이벤트 없이도 기존 lease 만료와 DB snapshot
재적재로 복구한다. Windows 식별자 확인은 이 경로에 추가하는 선택 기능이다.

## 예약턴 임대 복구

- 실행 루프가 종료되면 DB에서 자기 owner의 장수·국가 예약턴 임대를 해제한다.
  In-memory rollback으로 leased set에서 빠진 row도 정리한다. 큐 내용과 revision,
  다른 실행자/API의 임대는 변경하지 않는다.
- 계산 전 임대 획득 충돌은 전체 메모리 savepoint를 복원한 뒤 1초 단위로 재시도한다.
  한 충돌 구간의 상한은 301초다(기본 queue lease 5분 + 여유 1초). 그동안 다음
  loop마다 운영자 pause/stop과 daemon 권위를 확인한다. 성공한 batch에서 상한을
  초기화하며 큐가 바뀌어도 같은 실패 구간의 상한을 연장하지 않는다.
- 저장·finalize 단계의 소유권 상실, 메모리 복원 실패와 다른 게임 오류는 자동
  재시도하지 않는다. 상한을 넘은 획득 충돌도 기존 PAUSED/장애 이력 경로로 간다.
- daemon의 30초 lease와 fencing epoch, 기존 10분 이하 catch-up 및 장시간 복구
  정책은 유지한다. 운영자가 정지한 profile을 자동 START하지 않는다.

## Windows Node.js 에이전트

필요 파일은 `windows-boot-agent.mjs` 하나이며 외부 npm package가 필요 없다.
Node.js 24.22.1 이상을 사용한다. 설정 예시는
`tools/host-recovery/windows-boot-agent.example.json`이다.

Node.js가 Windows 내장 PowerShell의 CIM 조회로 `Win32_OperatingSystem.LastBootUpTime`
UTC ticks를 읽고 hostname과 함께 hash한다. 별도의 PowerShell 스크립트 설치나
Linux에서 Windows 관리자 명령 실행은 필요 없다. Node 에이전트를 재시작해도
같은 Windows boot의 식별자는 같고, Windows를 재부팅하면 달라진다.
실제 Windows에서 CIM 조회가 실패하면 가짜 식별자를 만들지 않고 시작을 거부한다.

1. 파일들을 `C:\ProgramData\Sammo` 같은 고정 경로에 복사한다.
2. 디렉터리를 만든 뒤 Windows 터미널에서 private key를 생성한다. 기존 파일을
   덮어쓰지 않으며 key 내용은 출력하지 않는다.

    ```text
    node C:\ProgramData\Sammo\windows-boot-agent.mjs --create-key C:\ProgramData\Sammo\host-boot.key
    ```

3. 설정 예시를 `C:\ProgramData\Sammo\host-boot.json`으로 복사한다. `keyFile`은
   위 경로, `bindAddress`는 **Linux VM에서 접근할 수 있는 Windows의 사설 주소**로
   설정한다. 예시의 `127.0.0.1`은 안전한 기본값이며 원격 Linux에서 접근할 수 없다.
   `port` 기본값은 17781이다. Windows 방화벽은 해당 사설 listener에 Linux VM
   주소에서 오는 TCP 연결만 허용하도록 설정한다. 기존 공개 Caddy는 변경하지 않는다.
4. key 파일은 실행 계정만 읽도록 NTFS 권한을 제한하고, 같은 내용을 Linux의
   `/run/secrets/host_boot_key` 같은 private file로 비공개 전달한다. Git·메신저·
   CLI 인자에 key 내용을 넣지 않는다. 에이전트는 key를 시작할 때 읽으므로 key
   교체 시 양쪽 프로세스를 함께 재시작한다.
5. 실행한다.

    ```text
    node C:\ProgramData\Sammo\windows-boot-agent.mjs --config C:\ProgramData\Sammo\host-boot.json
    ```

6. Windows 작업 스케줄러에 **시스템 시작 시** task를 등록한다. 프로그램은 Node의
   절대 `node.exe` 경로, 인자는 위 `.mjs --config ...` 부분을 사용한다. 로그인 없이
   실행되고 실패 시 재시작하도록 구성한다. 설정 파일을 사용하므로 터미널 세션의
   임시 환경변수에 의존하지 않는다. 실제 Windows 설치·방화벽 변경·task 등록은
   대상 host에서 별도 적용하고 확인해야 한다.

원한다면 설정 파일 대신 `HOST_BOOT_KEY_FILE`, `HOST_BOOT_BIND_ADDRESS`,
`HOST_BOOT_PORT` 환경변수로도 실행할 수 있다.

## Linux 연결

기존 game runtime/PM2가 상속하는 서버 환경에 아래 두 값을 함께 설정한다.
설정이 없으면 기능을 사용하지 않는다. 설정이 불완전하거나 key 파일이 없거나 잘못돼도
고정 경고와 함께 보조 관측만 비활성화하며 게임 기동은 계속한다.

```dotenv
TURN_HOST_BOOT_URL=http://windows-private-address:17781/v1/boot-id
TURN_HOST_BOOT_KEY_FILE=/run/secrets/host_boot_key
```

Docker에서는 private key가 들어 있는 전용 디렉터리를 runtime에 read-only mount하고 두 환경변수를
**runtime container environment**에 전달해야 한다. 호스트의 `.env`에만 추가하면
자동 전달되지 않는다. 기존 Compose와 host overlay를 함께 적용하는 전용 wrapper를
사용한다. 실제 secret 파일의 host 경로와 Windows 사설 주소를 확인하기 전에는
운영 stack 설정을 추측해 바꾸지 않는다.

예를 들어 host overlay의 runtime 설정에는 다음 형태로 연결할 수 있다. host 경로는
placeholder이며 실제 운영 경로로 교체해야 한다.

```yaml
services:
    runtime:
        environment:
      TURN_HOST_BOOT_URL: ${TURN_HOST_BOOT_URL:-}
      TURN_HOST_BOOT_KEY_FILE: /run/sammo-host-recovery/host_boot.key
        volumes:
            - type: bind
        source: /absolute/private/path/host-recovery
        target: /run/sammo-host-recovery
              read_only: true
              bind:
          create_host_path: true
```

위 디렉터리는 보조 기능 전용이므로 없으면 빈 디렉터리를 만들 수 있다. 파일 부재는
관측만 비활성화한다. DB·backup 같은 필수 저장소에는 이 fallback을 적용하지 않는다.
운영에는 이 전용 디렉터리의 `host_boot.key` 파일을 전달한다.

처음 인증에 성공한 식별자를 프로세스의 기준으로 삼고 고정된 성공 로그를 남긴다. 이후 다른 식별자를
확인하면 `TurnDaemonLeaseLostError`로 기존 실행자를 중단하고 DB를 다시 읽는다.
종료 시 owner/epoch가 여전히 자기 것인 경우에만 DB lease와 `clock_ready`를
해제하므로 다른 실행자를 중지시키지 않는다. 재시작은 기존 profile 상태를
보존하며 PAUSED/STOPPED를 임의로 RUNNING으로 바꾸지 않는다.

보통 최대 2초 간격으로 확인한다. 벽시계와 monotonic 경과가 1초 이상 어긋나면
cache를 무시하고 다시 조회한다. 조회 timeout은 1초다. 네트워크·인증·응답 오류는
분당 한 번의 고정 경고만 남기고 기존 DB lease 복구를 유지한다. 처음 인증받기 전
발생한 reboot는 이 신호만으로 확정할 수 없으며 기존 복구 경로가 담당한다.

## 인증 프로토콜과 검증

key 파일은 32바이트 난수를 lowercase hex 64자로 저장한다. 매 요청마다 새 32바이트
challenge를 만들며, key 자체를 네트워크에 보내지 않는다.

- GET `/v1/boot-id`, query string 없음.
- `x-sammo-challenge`: lowercase hex 64자.
- `x-sammo-signature`: `HMAC-SHA256(key, "sammo-host-boot-request-v1\n" + challenge)`.
- JSON: `version=1`, `challenge`, `bootId`(hex 64자), `signature`.
- 응답 signature:
  `HMAC-SHA256(key, "sammo-host-boot-response-v1\n" + challenge + "\n" + bootId)`.

위 `\n`은 실제 LF다. Linux는 challenge와 응답 signature를 검증하고, redirect와
2048바이트 초과 응답을 거부한다. 서명된 옛 응답도 새 challenge에는 유효하지 않다.
시각 정확도나 요청 시각 만료에 의존하지 않는다. 이 프로토콜은 인증과 무결성을
제공하며 암호화는 하지 않는다. 사설 망에서만 사용하며 공개 무인증 재개 API를
만들지 않는다.

```sh
node --test tools/host-recovery/windows-boot-agent.test.mjs
pnpm --filter @sammo-ts/game-engine test hostBootMonitor.test.ts runtimePauseGate.test.ts reservedTurnLeaseRetry.test.ts
```

CI에서는 Windows boot를 모사한 HTTP 응답, 위조·재사용·timeout, 실제 PostgreSQL
lease fencing과 queue cleanup을 검증한다. 실제 Windows CIM·Task Scheduler와
Hyper-V 재부팅 검증을 대체하지 않는다. 배포 후 기존 장애 진단 화면의 lease/
epoch와 public lobby `turnEngineRunning`, 실제 tick/queue revision 진행을 확인한다.

기능을 해제하려면 Linux의 두 환경변수를 함께 제거하고 해당 runtime을 정상
재기동한다. Windows task도 중지할 수 있다. DB migration이나 게임 초기화는 없다.

근거: [Microsoft LastBootUpTime](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-operatingsystem),
[Node.js HMAC와 timingSafeEqual](https://nodejs.org/api/crypto.html),
[게임 시계 복구 계약](../architecture/game-clock-reconciliation.md),
[릴리스 운영](../release-operations.md).
