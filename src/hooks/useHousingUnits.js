import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, insertRow, updateRow } from '../lib/firestoreCrud';
import { mapHousingUnit, toHousingUnitInsert, toHousingUnitUpdate } from '../lib/mappers';
import { housingUnitDocId } from '../lib/housingStats';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * ميتا السكنات — السعة والملاحظات فقط.
 *
 * The unit list itself lives on the startup item and the residents live on
 * the bikers; this collection holds only what neither can say. `upsert`
 * rather than add/update pairs because the caller thinks in UNIT NAMES, not
 * document ids — and the deterministic id (housingUnitDocId) makes «هل توجد
 * وثيقة لهذا السكن؟» a lookup, never a race: two admins saving the same
 * unit's capacity at once land on the same document by construction.
 */
export function useHousingUnits() {
  const { data, loading, error, refetch } = useFirestoreQuery(
    () => fetchRows('housing_units'),
    { enabled: isFirebaseConfigured, map: mapHousingUnit, fallback: [] },
  );

  // Memoised so the callback below doesn't get a fresh dependency identity
  // every render while `data` is still null.
  const metaRows = useMemo(() => data ?? [], [data]);

  const upsertUnitMeta = useCallback(async (name, patch) => {
    if (!isFirebaseConfigured) return null;
    const id = housingUnitDocId(name);
    if (!id) throw new Error('اسم السكن فارغ.');
    const exists = metaRows.some((m) => m.id === id);
    if (exists) await updateRow('housing_units', id, toHousingUnitUpdate({ ...patch, name }));
    else await insertRow('housing_units', toHousingUnitInsert({ id, ...patch, name }));
    await refetch();
    return id;
  }, [metaRows, refetch]);

  return { metaRows, loading, error, upsertUnitMeta, refetch };
}
