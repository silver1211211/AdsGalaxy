-- Speeds post/date lookups used by channel statistics aggregation.
-- Idempotent: create the ordered composite index only when no equivalent index exists.

SET @channel_post_stats_index_exists = (
  SELECT COUNT(*)
  FROM (
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'channel_post_daily_stats'
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'post_id,stat_date'
  ) equivalent_indexes
);

SET @channel_post_stats_index_ddl = IF(
  @channel_post_stats_index_exists = 0,
  'CREATE INDEX idx_channel_post_daily_stats_post_date ON channel_post_daily_stats (post_id, stat_date)',
  'SELECT 1'
);
PREPARE channel_post_stats_index_stmt FROM @channel_post_stats_index_ddl;
EXECUTE channel_post_stats_index_stmt;
DEALLOCATE PREPARE channel_post_stats_index_stmt;
