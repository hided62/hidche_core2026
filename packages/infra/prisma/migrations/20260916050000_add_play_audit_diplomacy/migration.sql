CREATE TABLE "play_audit_diplomacy_event" (
    "id" TEXT PRIMARY KEY,
    "sequence" BIGSERIAL NOT NULL UNIQUE,
    "schema_version" INTEGER NOT NULL DEFAULT 1 CHECK ("schema_version" > 0),
    "server_id" TEXT NOT NULL,
    "nation_a" INTEGER NOT NULL,
    "nation_b" INTEGER NOT NULL,
    "src_nation_id" INTEGER NOT NULL,
    "dest_nation_id" INTEGER NOT NULL,
    "category" TEXT NOT NULL CHECK ("category" IN ('DOCUMENT', 'RELATION')),
    "source" TEXT NOT NULL CHECK ("source" IN ('API', 'ENGINE', 'BASELINE')),
    "event_type" TEXT NOT NULL,
    "document_id" INTEGER,
    "document_hash" TEXT,
    "previous_document_id" INTEGER,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
    "tick" BIGINT,
    "clock_revision" BIGINT,
    "execution_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
    "request_id" TEXT,
    "input_sequence" BIGINT,
    "actor" JSONB,
    "before" JSONB,
    "after" JSONB,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ("nation_a" <= "nation_b")
);
CREATE UNIQUE INDEX "play_audit_diplomacy_event_server_id_execution_id_ordinal_key"
    ON "play_audit_diplomacy_event" ("server_id", "execution_id", "ordinal");
CREATE INDEX "audit_diplomacy_pair_sequence_idx"
    ON "play_audit_diplomacy_event" ("server_id", "nation_a", "nation_b", "sequence");
CREATE INDEX "play_audit_diplomacy_event_server_id_document_id_sequence_idx"
    ON "play_audit_diplomacy_event" ("server_id", "document_id", "sequence");

-- 수정은 새 문서(prev_id)로 만든다. 원문을 한 번만 참조할 수 있도록 기존 작성 내용을 고정한다.
CREATE FUNCTION preserve_diplomacy_document_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id, NEW.src_nation_id, NEW.dest_nation_id, NEW.prev_id, NEW.text_brief, NEW.text_detail, NEW.src_signer, NEW.date)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.src_nation_id, OLD.dest_nation_id, OLD.prev_id, OLD.text_brief, OLD.text_detail, OLD.src_signer, OLD.date)
    THEN
        RAISE EXCEPTION 'Diplomacy document content is immutable; create a replacement document';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_diplomacy_document_content BEFORE UPDATE ON "diplomacy_letter"
    FOR EACH ROW EXECUTE FUNCTION preserve_diplomacy_document_content();
