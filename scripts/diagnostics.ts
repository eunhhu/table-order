import { client } from "@table/db";

try {
  const [result] = await client`SELECT
    now() AS database_time,
    pg_database_size(current_database()) AS database_bytes,
    (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
    (SELECT count(*) FROM visits WHERE state <> 'closed') AS active_visits,
    (SELECT count(*) FROM orders o JOIN visits v ON v.id = o.visit_id
      WHERE v.state <> 'closed' AND o.acknowledged_at IS NULL AND EXISTS
        (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.quantity > i.cancelled)) AS unacknowledged_orders,
    (SELECT min(o.created_at) FROM orders o JOIN visits v ON v.id = o.visit_id
      WHERE v.state <> 'closed' AND o.acknowledged_at IS NULL AND EXISTS
        (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.quantity > i.cancelled)) AS oldest_unacknowledged,
    (SELECT revision FROM settings WHERE id=1) AS revision`;
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.end();
}
