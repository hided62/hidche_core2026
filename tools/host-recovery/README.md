# Windows host boot identity agent

`windows-boot-agent.mjs`는 외부 npm package 없이 실행하는 Node.js 에이전트다.
Windows OS의 부팅 시각 기반 식별자를 인증된 Linux 게임 데몬에 제공한다.

설치, key 생성, 자동 시작과 선택 기능 장애 시 동작은
[Hyper-V 복구 운영 안내](../../docs/developer/host-boot-recovery.md)를 따른다.
설정 예시는 `windows-boot-agent.example.json`이며 실제 key와 설정은 Git에 넣지 않는다.

```sh
node --test tools/host-recovery/windows-boot-agent.test.mjs
```
