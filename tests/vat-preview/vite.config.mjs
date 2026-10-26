import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.js';
export default defineConfig(env => mergeConfig(base(env), {appType:'mpa',plugins:[{name:'isolated-vat-read-preview',enforce:'pre',load(id){
  const path=id.replaceAll('\\','/').split('?')[0];
  const hooks=['useTaxInvoices','useWashes','useLedger','useAccountingSettings','useFinanceRead','useFirestoreQuery'];
  for(const hook of hooks) if(path.endsWith(`/src/hooks/${hook}.js`)) return `export { ${hook} } from '/tests/vat-preview/fixture.js';`;
  if(path.endsWith('/src/hooks/useSweater.js')) return "export { useSweaterSettlements } from '/tests/vat-preview/fixture.js';";
  if(['/useStartupCosts.js','/useAnnualExpenses.js','/useMonthlyExpenses.js','/useVariableExpenses.js'].some(s=>path.endsWith('/src/hooks'+s))){const hook=path.split('/').at(-1).replace('.js','');return `export {useItems as ${hook}} from '/tests/vat-preview/fixture.js';`;}
  if(path.endsWith('/src/contexts/PartnerViewContext.jsx')) return "export {usePartnerView} from '/tests/vat-preview/fixture.js';";
  if(path.endsWith('/src/components/TopBar.jsx')) return "export {default} from '/tests/overview-preview/TopBar.jsx';";
  if(path.endsWith('/src/lib/accounting/firestoreInvoicing.js')) return "export {fetchSellerProfile} from '/tests/vat-preview/fixture.js';";
},transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/components/VatRecoveryPage.jsx'))return code.replace("from '../lib/firebaseClient'","from '/tests/vat-preview/fixture.js'");}}],server:{host:'127.0.0.1',port:5201,strictPort:true}}));
