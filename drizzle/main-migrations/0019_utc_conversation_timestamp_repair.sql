DROP PROCEDURE IF EXISTS `megadesk_repair_conversation_timestamps_0019`;--> statement-breakpoint
CREATE PROCEDURE `megadesk_repair_conversation_timestamps_0019`()
BEGIN
  DECLARE candidate_rows BIGINT DEFAULT 0;
  DECLARE distinct_messages BIGINT DEFAULT 0;
  DECLARE updated_rows BIGINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT COUNT(*), COUNT(DISTINCT m.message_id)
    INTO candidate_rows, distinct_messages
  FROM megadesk_domain_conversations_messages AS m
  JOIN megadesk_domain_conversations AS c
    ON BINARY c.conversation_id = BINARY m.conversation_id
  JOIN JSON_TABLE(
    c.messages_json,
    '$[*]' COLUMNS (
      message_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.id',
      legacy_timestamp VARCHAR(64) PATH '$.timestamp'
    )
  ) AS legacy
    ON BINARY legacy.message_id = BINARY m.message_id
  WHERE m.client_id IS NOT NULL
    AND m.provider IS NOT NULL
    AND m.integration_id IS NOT NULL
    AND m.direction IS NOT NULL
    AND m.message_type IS NOT NULL
    AND legacy.legacy_timestamp REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    AND TIMESTAMPDIFF(
      MICROSECOND,
      m.timestamp,
      CASE
        WHEN legacy.legacy_timestamp REGEXP '[.][0-9]{1,6}Z$'
          THEN STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s.%f')
        ELSE STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s')
      END
    ) >= 10799000000
    AND TIMESTAMPDIFF(
      MICROSECOND,
      m.timestamp,
      CASE
        WHEN legacy.legacy_timestamp REGEXP '[.][0-9]{1,6}Z$'
          THEN STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s.%f')
        ELSE STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s')
      END
    ) < 10801000000;

  IF candidate_rows = 0 THEN
    COMMIT;
  ELSEIF candidate_rows <> 101 OR distinct_messages <> 101 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CONVERSATION_TIMESTAMP_REPAIR_PRECONDITION_FAILED';
  ELSE
    UPDATE megadesk_domain_conversations_messages AS m
    JOIN megadesk_domain_conversations AS c
      ON BINARY c.conversation_id = BINARY m.conversation_id
    JOIN JSON_TABLE(
      c.messages_json,
      '$[*]' COLUMNS (
        message_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.id',
        legacy_timestamp VARCHAR(64) PATH '$.timestamp'
      )
    ) AS legacy
      ON BINARY legacy.message_id = BINARY m.message_id
    SET m.timestamp = DATE_ADD(m.timestamp, INTERVAL 3 HOUR),
        m.updated_at = m.updated_at
    WHERE m.client_id IS NOT NULL
      AND m.provider IS NOT NULL
      AND m.integration_id IS NOT NULL
      AND m.direction IS NOT NULL
      AND m.message_type IS NOT NULL
      AND legacy.legacy_timestamp REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
      AND TIMESTAMPDIFF(
        MICROSECOND,
        m.timestamp,
        CASE
          WHEN legacy.legacy_timestamp REGEXP '[.][0-9]{1,6}Z$'
            THEN STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s.%f')
          ELSE STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s')
        END
      ) >= 10799000000
      AND TIMESTAMPDIFF(
        MICROSECOND,
        m.timestamp,
        CASE
          WHEN legacy.legacy_timestamp REGEXP '[.][0-9]{1,6}Z$'
            THEN STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s.%f')
          ELSE STR_TO_DATE(TRIM(TRAILING 'Z' FROM legacy.legacy_timestamp), '%Y-%m-%dT%H:%i:%s')
        END
      ) < 10801000000;

    SET updated_rows = ROW_COUNT();
    IF updated_rows <> 101 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CONVERSATION_TIMESTAMP_REPAIR_ROWCOUNT_FAILED';
    END IF;
    COMMIT;
  END IF;
END;--> statement-breakpoint
CALL `megadesk_repair_conversation_timestamps_0019`();--> statement-breakpoint
DROP PROCEDURE IF EXISTS `megadesk_repair_conversation_timestamps_0019`;
