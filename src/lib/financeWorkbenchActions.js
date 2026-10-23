// One explicit owner-confirmed operation; never posts, retries, or edits sources.
// Re-read every selected version, then use the SAME single-document approve API.
export async function approveFinanceSelection({ items, reason, confirmed, call, onProgress = () => {} }) {
  if (!confirmed || reason.trim().length < 3 || !items.length) throw new Error('يلزم تأكيد المجموعة وكتابة سبب الاعتماد.');
  if (items.some(item => !item.approvalReady || item.workflowStage !== 'ready')) throw new Error('المجموعة تحتوي مستندًا غير جاهز للاعتماد.');
  const unique = new Set(items.map(item => `${item.kind}:${item.sourceId}`));
  if (unique.size !== items.length) throw new Error('المجموعة تحتوي مستندًا مكررًا.');
  const result = { verified: [], skipped: [], uncertain: [], unattempted: [] };
  for (let index = 0; index < items.length; index++) {
    const item = items[index], request = { kind: item.kind, sourceId: item.sourceId };
    let approvalStarted = false;
    try {
      const fresh = await call('finance-workbench', { action: 'read', ...request });
      if (fresh.sourceHash !== item.sourceHash || fresh.postingPreview?.postingHash !== item.postingHash
        || !fresh.approvalReady || fresh.approved || fresh.protectedSource || fresh.closed || fresh.issues?.length) {
        result.skipped.push({ ...request, title: item.title, reason: 'تغير المستند أو لم يعد جاهزًا؛ لم يُعتمد.' });
        onProgress(result); continue;
      }
      approvalStarted = true;
      await call('finance-workbench', { action: 'approve', ...request, sourceHash: fresh.sourceHash,
        postingHash: fresh.postingPreview.postingHash, reason: reason.trim(), confirm: true });
      const after = await call('finance-workbench', { action: 'read', ...request });
      if (!after.approved || after.sourceHash !== fresh.sourceHash || after.protectedSource
        || after.postingPreview?.postingHash !== fresh.postingPreview.postingHash) throw new Error('تعذر التحقق من حفظ الاعتماد.');
      result.verified.push({ ...request, title: item.title });
    } catch (error) {
      if (!approvalStarted) result.skipped.push({ ...request, title: item.title, reason: 'تعذرت القراءة؛ لم يُرسل اعتماد.' });
      else {
        result.uncertain.push({ ...request, title: item.title, reason: error.message });
        result.unattempted.push(...items.slice(index + 1).map(next => ({ kind: next.kind, sourceId: next.sourceId, title: next.title })));
        onProgress(result); return result; // No retry after an ambiguous write or verification.
      }
    }
    onProgress(result);
  }
  return result;
}
