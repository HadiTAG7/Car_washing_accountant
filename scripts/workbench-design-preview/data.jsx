/* eslint-disable react-refresh/only-export-components -- isolated fixture seam */
import { useFinanceRead as baseRead } from '../finance-preview/fixtures';
export { auth, db, isFirebaseConfigured, callFinanceApi } from '../finance-preview/fixtures';
export const useAuth = () => ({ session: { user: { email: 'local-preview@example.test' } } });
export const useFinanceRead = (...args) => {
  const result = baseRead(...args);
  if (args[1]?.action !== 'browse') return result;
  return { ...result, data: { ...result.data, items: result.data.items.map((item, index) => ({ ...item,
    workflowStage: ['incomplete', 'ready', 'approved', 'posted_unproven', 'complete'][index % 5], approvalReady: index % 5 === 1 })) } };
};
export default function Omitted() { return null; }
