import AccountCode from './AccountCode';
import { accountDisplayName, isPartnerCapital } from '../lib/accountDisplay';

export default function AccountLabel({ account }) {
  return <>{!isPartnerCapital(account) && <span className="tabular-nums text-slate-500 dark:text-slate-400 ml-1"><AccountCode code={account.code} /></span>}{accountDisplayName(account)}</>;
}
