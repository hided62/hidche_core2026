# 내부 밸런스 실험실

공개 API/화면과 연결하지 않는 Node CLI다. 실제 `processBattleSimJob` →
`resolveWarBattle`의 관찰 callback으로 측정하며 DB/Redis/운영 seed를 사용하지 않는다.
게임 수치나 알고리즘은 바꾸지 않는다. Ref 동일성 test를 대체하지 않는다.

```sh
fnm use 24
node --test tools/balance-lab/*.test.mjs
node tools/balance-lab/run.mjs --suite units --samples 64 --out test-results/balance-lab/units-64
node tools/balance-lab/run.mjs --suite items --samples 32 --out test-results/balance-lab/items-32
node tools/balance-lab/run.mjs --suite traits --samples 64 --out test-results/balance-lab/traits-64
node tools/balance-lab/run.mjs --suite nations --samples 32 --out test-results/balance-lab/nations-32
```

`pnpm` 실행 파일이 PATH에 있어야 한다. 최초 환경에서 필요하면 `corepack enable`.
CLI는 common/logic을 먼저 build하여 오래된 dist를 측정하지 않는다. 출력 경로는
매 실행 새 경로를 지정한다. 기존 manifest가 있으면 중단하여 이전 증거를 보존한다.
`--plan`은 build/catalog/설계만 출력한다. `--match 1100/martial`처럼 key/build/mode/role/budget
부분 문자열로 후속 정밀 실험을 좁힐 수 있다. `--seed`는 실험용 문자열이다.
표본수는 cell별 독립 seed 수이며 공수와 treatment/control은 같은 seed를 사용한다.

## 비교 계약

- 병종군: 기본 5종과 모든 병종의 상대 행렬. 보→궁→기→보의 유리 방향을
  공격/수비 각각 확인한다. 같은 seed의 양 역할은 독립 표본 두 개로 세지 않는다.
- 병종: CHE 33종, 통무/통지/통솔/무지 4개 총합 210 배분, 기본 5종 상대,
  공수 역할과 성벽 단독 전투. 기술 요구량과 지역 제한은 catalog에 보존한다.
- 유니크: 등록된 모든 unique 모듈을 슬롯에 장착하고 같은 슬롯이 빈 대조군과
  짝지어 차이를 낸다. 모든 등록 모듈의 기계적 효과 조사이며 특정 시나리오의
  획득 가능성이나 희소성·경매가격을 뜻하지 않는다.
- 전투특기: 20종을 무특기와 비교한다. 기본 보궁기/귀병/충차에서 각각 관측한다.
- 국가성향: 중립 대조 전투 외에 실제 모듈의 내정 score/cost/success, 세입,
  인구 증가·손실과 전략 delay/globalDelay를 probe한다. 전투에서 차이가 없다고
  성향이 없다고 판정하지 않는다.

`equal-crew`는 7천 명 **상한**이며 원 통솔×100을 넘지 않는다. `equal-gold`는
중립 징병의 병종 기본 금 계수로 비용을 맞추되 같은 통솔 상한을 적용한다.
실제 징병에 필요한 군량·민심·주민·명령 턴, 장비/특기의 징병 할인은 이 정규화에
포함되지 않는다. `unit.rice`는 전투 군량 계수이며 징병 군량 단가로 합산하지 않는다.
원 능력치 총합은 같아도 역할별로 불리한 배분이 존재한다. 배분을 합친 한 줄 순위를
제품 밸런스 결론으로 쓰지 않는다.

야전 주지표 `exchange`는 `상대 병력 손실률 - 자기 병력 손실률`이다. 성벽 피해는
포함하지 않고 공성에서는 `null`이다. 생존·전멸·성벽 피해·군량·부상·phase를 같이
보며 phase 종료를 임의 승리로 바꾸지 않는다. 무피해 승리의 무한 교환비도 만들지 않는다.

`samples.jsonl`은 cell/index/seed, treatment/control/차이를 보존한다. `summary.json`은
cell별 평균, 표준편차, 정규근사 95% 구간과 10/50/90 분위수를 제공한다. 낮은 n,
확률 0/1 근처와 희귀 발동에서는 정규구간이 정확하지 않다. 수천 cell의 구간을
다중검정 보정 없는 확정 유의성으로 쓰지 않는다. 같은 seed여도 효과가 RNG 소비
경로를 바꿀 수 있으며 개별 전투의 RNG tape가 동일하다는 뜻은 아니다.

## 판정 절차

1. 모든 후보를 저표본 탐색하고 결과를 보기 전에 실용 차이 기준을 정한다.
   초기 검토 기준은 야전 손실률 차이 0.10, 동일 역할 공성 피해 +25%다.
   이는 밸런스 허용치 확정이 아니라 추가 조사 후보를 정하는 기준이다.
2. 우위 후보를 별도 seed 256회 이상으로 재검사한다. 상성 역전 여부, 공수/배분/
   병력 비용 조건에서의 일관성, 하위 10% 성과와 불리한 상대를 확인한다.
3. 3등급끼리 직접 교전, 동급 내 Pareto 지배, 지역/획득 제약, 특기×유니크
   상호작용, 소모·연속 교전, 초중후반 기술/훈련/숙련 변화로 검증한다.
4. 게시판·과거 로그는 가설과 상황 분포의 근거로 쓴다. 버전·스탯·장비·턴 앞뒤
   상태가 없는 로그만으로 원인 효과나 메타 점유율을 계산하지 않는다.
5. 국가성향은 수입·내정 턴·전략 빈도·군사 역할을 다목적으로 비교한다.
   나라 크기/유저 활성도/외교의 효과를 성향 효과로 오인하지 않는다.

## 증거와 현재 제한

manifest는 Git HEAD/dirty 상태, common/logic source·병종 resource·실험 도구 SHA-256,
Node, 설계 버전, seed, cell/전투 수와 완료 여부를 기록한다. 실행 도중 source 변경이
있으면 완료하지 않는다. `completed: false`인 디렉터리는 완성 결과가 아니다.
raw sample/빌드 산출물은 Git에 넣지 않고 상위 보고서에 경로·해시와 집계를 남긴다.

v2의 전투 탐색에 v3의 실제 모집·조건부 발동·비전투 효과와 v3.1의 잔존 병력 대조를
추가했다. 최초 비교 연구의 범위는 아래 suite와 관측에 한정한다. 획득 pool의 희소성,
다년 경제 스노우볼, 실제 시즌 메타 비중과 최적 전략은 이 도구만으로 확정하지 않는다.

## 추가 비교와 해석 출력

```sh
node tools/balance-lab/run.mjs --suite families --samples 256 --out test-results/balance-lab/families-256
node tools/balance-lab/run.mjs --suite tiers --samples 128 --out test-results/balance-lab/tiers-128
node tools/balance-lab/run.mjs --suite interactions --samples 256 --out test-results/balance-lab/interactions-256
node tools/balance-lab/analyze.mjs test-results/balance-lab/families-256
```

`families`는 보궁기에 통무, 귀병에 통지, 차병에 통솔 배분을 적용하고 서로 다른
배분의 상대와 싸운다. 원 통솔×100까지 병력을 채우는 `capacity` 조건도 포함한다.
`tiers`는 요구 기술 3000인 모든 병종의 직접 대진을 같은 방식으로 계산한다.
따라서 단순히 약한 기본병을 잘 잡는 후보만 고르는 문제를 보완한다.

`interactions`는 공성/반계/격노/집중/환술/척사/위압/징병의 10개 특기·아이템
조합에서 `둘 다 - 특기만 - 아이템만 + 둘 다 없음`을 같은 seed로 측정한다.
이는 선택한 지표에서의 통계적 상호작용이지 trigger 중첩 버그의 판정은 아니다.
준비 완료와 병력 절반·훈사70 상태, 야전/수비장수 3명/공성을 분리한다.

공성에는 성방·성벽 1000과 5000의 두 조건을 둔다. 5000은 상한에 가려지는
효과를 보기 위한 내구도 스트레스 조건이며 현재 운영 도시의 대표값이라는
의미가 아니다. `wallDamage`는 도시 전투 HP 피해이며 HP는 성방×10이다.
원 `city.wall` 필드 감소량과 같은 단위가 아니다. 성벽을 모두 제거해 피해량이
같더라도 사상자·phase·군량 차이를 함께 확인해야 한다.

`screen.md`와 `screen.json`은 조건별 행렬과 후보를 정리한다. cell 평균들의
최솟값/최댓값은 확률 분포의 분위수나 신뢰구간이 아니다. 원 표본의 분위수와
구간은 `summary.json`에 따로 있다. 손실률 평균만으로 전쟁 승리나 국가 생존을
예측하지 않는다. 도구 수정 후에는 새 출력 경로에 재실행한다.

## v3 조건부 효과·모집·운영 가치

```sh
node tools/balance-lab/run.mjs --suite conditional --samples 128 --seed balance-confirm-v3 --out test-results/balance-lab/conditional-v3
node tools/balance-lab/run.mjs --suite premium --samples 256 --seed balance-confirm-v3 --out test-results/balance-lab/premium-v3
node tools/balance-lab/run.mjs --suite sensitivity --samples 256 --seed balance-confirm-v3 --out test-results/balance-lab/sensitivity-v3
node tools/balance-lab/run.mjs --suite recruit --samples 128 --seed balance-confirm-v3 --out test-results/balance-lab/recruit-v3
```

- `conditional`: 모든 특기20/유니크100을 근위병·천귀병에 추가 대조하고, 척사와
  오악진형도는 기본/지역/도시 병종 대진의 factorial 효과도 확인한다. 척사는 NPC
  여부가 아니라 상대 병종의 지역/도시 조건으로 발동한다.
- `premium`: 탐색 상위5종을 독립 seed로 재검사한다. 말은 일반 +6 흑색마,
  도구는 빈 슬롯/매번 소비하는 청주를 각각 대조군으로 둔다. 청주 가격1000은
  매 전투 반복 비용이고, 흑색마의 상점가격은 21000/치안6000 요구다. 전투당
  소모품 대조를 영구 아이템의 구매가격으로 오인하지 않는다.
- `sensitivity`: 183/200/220년, 기술1000/3000/6000, 숙련0/10000/50000,
  훈사80/100/110, 초기 대비 능력치0.8/1/1.4배의 조합에서 기본5종을 재비교한다.
  각각은 묶음 stress condition이다. 어느 한 변수의 인과효과를 분리한 실험은 아니다.
- `recruit`: 실제 `che_징병.CommandResolver`로 금1500/5000, 쌀5000,
  모집 가능 인구20000 내에서 가능한 병력·통솔 상한·훈련·사기·지출을 계산한다.
  quote만 재사용하고 DB나 실제 명령 mutation은 실행하지 않는다. 기본 병종/충차의
  기술 조건은 충족한다. 도시 이동·모병 명령·복합 성향/관직/유산은 이 fixture 범위 밖이다.
  충원 직후와 훈사100까지 훈련한 상태를 나누고 후자의 추가 훈련 턴을 공짜라고
  평가하지 않는다. 그 두 상태는 서로 다른 조건이다.

모든 v3 실행에 아래 비전투 관측도 저장한다.

- `economic-profiles.json`: 모든 unique/전투특기의 실제 일반 action pipeline에서
  능력치·명성·공헌·숙련, 내정 비용/성과/성공, 계략 방어, 전략 지연을 probe한다.
  기본값과 변화값을 같이 저장하며 병종별 모집 할인은 `recruit`로 따로 측정한다.
- `lifecycle-profiles.json`: 실제 판매 event와 턴 전 치료 trigger를 512 seed로
  실행한다. 도기의 연차별 개인/국가 보상, 의술 아이템/특기의 자신·아군·적군
  치료를 분리한다. 새로운 미지원 event가 등록되면 오류로 중단한다.
- `nation-plans.json`: 실제 국가 hook 계수에 12턴 상한과 600/1200/2400 자원을
  적용한 고정 업무 계획 모델이다. 개발/수성/회복의 자원 병목과 턴 병목을 분리한다.
  월간 국가 경제나 NPC·외교·국가 생존을 모사한 출력이 아니다.
- `strategy-plans.json`: 실제 의병모집 resolver의 국가별/장수수별 쿨다운을
  평만지장도 유무로 비교한다. 240 cooldown 단위 안에서 같은 전략을 반복하는
  자원 무제한 상한이며 의병 수·실제 달력·다른 전략 교차 사용을 포함하지 않는다.

v3 화면용 Markdown/JSON 집계는 병종·대조군·예산·준비 상태를 다른 그룹으로 유지한다.
초기 v2 화면 집계와 그룹 수가 달라질 수 있지만 원 cell/seed 자료는 보존된다.
조건을 확인하지 못한 효과는 0점이나 밸런스 통과로 자동 변환하지 않는다.

## v3.1 잔존 병력 대조

```sh
node tools/balance-lab/run.mjs --suite attrition --samples 256 --seed balance-attrition-v3.1 --out test-results/balance-lab/attrition-v3.1
node tools/balance-lab/analyze.mjs test-results/balance-lab/attrition-v3.1
```

옥란/흑색마와 상편/빈슬롯을 실제 모집 상한까지 채운 뒤, 평가 대상의 잔존 병력만
100%/50%/25%로 줄이고 상대는 만충원을 유지한다. 상대 보병·궁병·기병·천귀병,
공수 양 역할과 대상 기본4종/충차를 구분한다.
금100000·쌀5000·인구20000으로 이 대상의 모집 상한을 충족한다. 전체 모집 대금은
이미 지불한 상태이고 `recruit_crew`는 모집 인원, `recruit_remainingBeforeBattle`은
전투 직전 인원이다. 훈사100을 유지하며 이전 손실을 만든 전투·부상·군량 소모는
재현하지 않는 상태 통제 실험이다. 따라서 실제 연전 전체 효율로 부르지 않는다.

## v3.2 상대 특기 대응

```sh
node tools/balance-lab/run.mjs --suite counter --samples 256 --seed balance-counter-v3.2 --out test-results/balance-lab/counter-v3.2
node tools/balance-lab/analyze.mjs test-results/balance-lab/counter-v3.2
```

박혁론/빈슬롯을 상대 무특기·반계·격노로 분리한다. 기본4종/충차로 보병·기병·
귀병·천귀병과 양 공수에서 싸운다. 상대 특기만 양 대조군에 똑같이 적용하며,
상대가 억제할 능력이 없을 때 효과0이라는 음성 대조도 포함한다.
