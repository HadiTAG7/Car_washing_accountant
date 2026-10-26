import {SCHEMA} from '../../src/lib/data/schema/registry.js';
/** Loopback disposable-test cleanup only; append-only server permissions stay
 * intact. Every deletion names one fixture path, never truncates a table. */
export async function deleteOperationsFixture(pool,path){
  if((await pool.query('select current_database() db')).rows[0].db!=='sweater_report_snapshot_test_20261026')throw Error('cleanup isolation guard');
  const parts=path.split('/'),collection=parts.length===4?`${parts[0]}/*/${parts[2]}`:parts[0];
  const spec=SCHEMA.find(s=>s.collection===collection);if(!spec||!/^[a-z_]+$/.test(spec.table))throw Error('fixture table guard');
  const allowed=id=>id==='11111111-1111-4111-8111-333333333333'||id==='2048-10'||id.startsWith('ops_snapshot_20261027')||id==='ops-2048-10-27-4-morning_review-pg-ops-snapshot-2048-10-01-2048-10-26';
  if(!allowed(parts[1])||(parts.length===4&&!allowed(parts[3])&&parts[3]!=='000001'))throw Error('fixture path guard');
  await pool.query(`delete from public."${spec.table}" where id=$1${parts.length===4?' and parent_ref=$2':''}`,parts.length===4?[parts[3],parts[1]]:[parts[1]]);
}
