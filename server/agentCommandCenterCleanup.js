export const AGENT_COMMAND_CLEANUP_BATCH_SIZE = 400;

export async function deleteExpiredIngestionMarkers(db, now = new Date()) {
  const snapshot = await db.collection('agent_command_ingestion')
    .where('expiresAt', '<=', now)
    .orderBy('expiresAt', 'asc')
    .limit(AGENT_COMMAND_CLEANUP_BATCH_SIZE)
    .get();

  if (snapshot.empty) return { deleted: 0, hasMore: false };

  const batch = db.batch();
  for (const document of snapshot.docs) batch.delete(document.ref);
  await batch.commit();

  return {
    deleted: snapshot.size,
    hasMore: snapshot.size === AGENT_COMMAND_CLEANUP_BATCH_SIZE,
  };
}
