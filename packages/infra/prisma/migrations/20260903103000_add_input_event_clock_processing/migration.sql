ALTER TABLE input_event
    ADD COLUMN accepted_deadline_generation BIGINT,
    ADD COLUMN processing_game_tick BIGINT,
    ADD COLUMN processing_clock_revision BIGINT,
    ADD COLUMN processing_deadline_generation BIGINT;

ALTER TABLE input_event
    ADD CONSTRAINT input_event_accepted_clock_revision_positive
        CHECK (accepted_clock_revision IS NULL OR accepted_clock_revision > 0),
    ADD CONSTRAINT input_event_accepted_deadline_generation_positive
        CHECK (accepted_deadline_generation IS NULL OR accepted_deadline_generation > 0),
    ADD CONSTRAINT input_event_processing_clock_revision_positive
        CHECK (processing_clock_revision IS NULL OR processing_clock_revision > 0),
    ADD CONSTRAINT input_event_processing_deadline_generation_positive
        CHECK (processing_deadline_generation IS NULL OR processing_deadline_generation > 0);
