// Per-account totals of posted lines, summed in the database (Supabase only).
// Loaded on demand so a Firebase build never bundles the Supabase client.
export async function fetchPostedLineSums({ from = null, to = null } = {}) {
  const { getSupabase } = await import('../data/supabase/client.js');
  const { data, error } = await getSupabase().rpc('posted_line_sums', { p_from: from || null, p_to: to || null });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data || [];
}
