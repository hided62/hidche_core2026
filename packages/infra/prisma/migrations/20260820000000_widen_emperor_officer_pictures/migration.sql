-- Ref의 emperior 관직 장수 사진 경로는 VARCHAR(64)다. 사용자 아이콘 URL처럼
-- 32자를 넘는 정상 경로도 통일 archive에 저장할 수 있도록 원래 폭을 복원한다.
ALTER TABLE "emperior" ALTER COLUMN "l12pic" TYPE VARCHAR(64);
ALTER TABLE "emperior" ALTER COLUMN "l11pic" TYPE VARCHAR(64);
ALTER TABLE "emperior" ALTER COLUMN "l10pic" TYPE VARCHAR(64);
ALTER TABLE "emperior" ALTER COLUMN "l9pic" TYPE VARCHAR(64);
ALTER TABLE "emperior" ALTER COLUMN "l8pic" TYPE VARCHAR(64);
ALTER TABLE "emperior" ALTER COLUMN "l7pic" TYPE VARCHAR(64);
ALTER TABLE "emperior" ALTER COLUMN "l6pic" TYPE VARCHAR(64);
ALTER TABLE "emperior" ALTER COLUMN "l5pic" TYPE VARCHAR(64);
