USE root_legacy;

UPDATE `member` SET `REG_NUM` = 1 WHERE `NO` = 1;
UPDATE `system` SET `NOTICE` = 'incremental notice', `MDF_DATE` = '2020-02-01 00:00:00' WHERE `NO` = 1;
UPDATE `storage` SET `value` = '{"version":2}' WHERE `id` = 1;
INSERT INTO `member_log` (`id`, `member_no`, `date`, `action_type`, `action`)
VALUES (2, 1, '2020-02-01 00:00:00', 'logout', NULL);

USE che_legacy;

UPDATE `ng_games` SET `winner_nation` = 1 WHERE `id` = 1;
UPDATE `storage` SET `value` = '[20,null]' WHERE `id` = 1;

INSERT INTO `hall`
    (`id`, `server_id`, `season`, `scenario`, `general_no`, `type`, `value`, `owner`, `aux`)
VALUES (2, 'che_fixture_002', 2, 2, 11, 'war', 200, 1, '{}');

INSERT INTO `ng_old_generals`
    (`id`, `server_id`, `general_no`, `owner`, `name`, `last_yearmonth`, `turntime`, `data`)
VALUES
    (2, 'che_fixture_002', 11, 1, 'Incremental General', 22112, '2020-02-01 00:00:00.000000',
     '{"leader":81,"power":71,"intel":61,"history":"second<br>"}');

INSERT INTO `ng_old_nations` (`id`, `server_id`, `nation`, `data`, `date`)
VALUES (2, 'che_fixture_002', 2, '{}', '2020-02-01 00:00:00');

INSERT INTO `emperior` (`no`, `server_id`, `name`, `history`, `aux`)
VALUES (2, 'che_fixture_002', 'Incremental Emperor', '[]', '{}');

INSERT INTO `inheritance_result` (`id`, `server_id`, `owner`, `general_id`, `year`, `month`, `value`)
VALUES (2, 'che_fixture_002', 1, 11, 221, 12, '{}');

INSERT INTO `user_record` (`id`, `user_id`, `server_id`, `log_type`, `year`, `month`, `date`, `text`)
VALUES (2, 1, 'che_fixture_002', 'history', 221, 12, '2020-02-01 00:00:00', 'incremental history');

INSERT INTO `ng_history`
    (`no`, `server_id`, `year`, `month`, `map`, `global_history`, `global_action`, `nations`)
VALUES (2, 'che_fixture_002', 221, 12, '{}', '[]', '[]', '[]');
