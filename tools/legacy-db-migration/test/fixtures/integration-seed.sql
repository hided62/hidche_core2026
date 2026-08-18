USE root_legacy;

INSERT INTO `system` (`NO`, `REG`, `LOGIN`, `NOTICE`, `CRT_DATE`, `MDF_DATE`)
VALUES (1, 'Y', 'Y', 'initial notice', '2020-01-01 00:00:00', '2020-01-01 00:00:00');

INSERT INTO `member`
    (`NO`, `oauth_id`, `ID`, `EMAIL`, `oauth_type`, `oauth_info`, `token_valid_until`, `PW`, `salt`,
     `third_use`, `NAME`, `PICTURE`, `IMGSVR`, `acl`, `penalty`, `GRADE`, `REG_NUM`, `REG_DATE`,
     `BLOCK_NUM`, `BLOCK_DATE`, `delete_after`)
VALUES
    (1, NULL, 'fixture-user', 'fixture@example.test', 'NONE', '{}', NULL,
     REPEAT('a', 128), 'fixture-salt-001', 0, 'Fixture User', 'default.jpg', 0, '{}', '{}', 1, 0,
     '2020-01-01 00:00:00', 0, NULL, NULL);

INSERT INTO `member_log` (`id`, `member_no`, `date`, `action_type`, `action`)
VALUES (1, 1, '2020-01-01 00:00:00', 'login', NULL);

INSERT INTO `storage` (`id`, `namespace`, `key`, `value`)
VALUES (1, 'fixture', 'mutable', '{"version":1}');

USE che_legacy;

INSERT INTO `ng_games`
    (`id`, `server_id`, `date`, `winner_nation`, `map`, `season`, `scenario`, `scenario_name`, `env`)
VALUES
    (1, 'che_fixture_001', '2020-01-01 00:00:00', NULL, 'che', 1, 2, 'fixture',
     '{"opentime":"2020-01-01 00:00:00"}');

INSERT INTO `hall`
    (`id`, `server_id`, `season`, `scenario`, `general_no`, `type`, `value`, `owner`, `aux`)
VALUES (1, 'che_fixture_001', 1, 2, 10, 'war', 100, 1, '{}');

INSERT INTO `ng_old_generals`
    (`id`, `server_id`, `general_no`, `owner`, `name`, `last_yearmonth`, `turntime`, `data`)
VALUES
    (1, 'che_fixture_001', 10, 1, 'Fixture General', 22012, '2020-01-01 00:00:00.000000',
     '{"leader":80,"power":70,"intel":60,"history":"first<br>"}');

INSERT INTO `ng_old_nations` (`id`, `server_id`, `nation`, `data`, `date`)
VALUES (1, 'che_fixture_001', 1, '{}', '2020-01-01 00:00:00');

INSERT INTO `emperior` (`no`, `server_id`, `name`, `history`, `aux`)
VALUES (1, 'che_fixture_001', 'Fixture Emperor', '[]', '{}');

INSERT INTO `inheritance_result` (`id`, `server_id`, `owner`, `general_id`, `year`, `month`, `value`)
VALUES (1, 'che_fixture_001', 1, 10, 220, 12, '{}');

INSERT INTO `user_record` (`id`, `user_id`, `server_id`, `log_type`, `year`, `month`, `date`, `text`)
VALUES (1, 1, 'che_fixture_001', 'history', 220, 12, '2020-01-01 00:00:00', 'fixture history');

INSERT INTO `storage` (`id`, `namespace`, `key`, `value`)
VALUES (1, 'inheritance_1', 'point', '[10,null]');

INSERT INTO `ng_history`
    (`no`, `server_id`, `year`, `month`, `map`, `global_history`, `global_action`, `nations`)
VALUES (1, 'che_fixture_001', 220, 12, '{}', '[]', '[]', '[]');
