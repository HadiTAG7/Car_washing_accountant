// Synthetic-only preview: all data hooks are replaced, and all mutations reject.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import config from '../vite.config.js';
const base=await config({mode:'development',command:'serve'});
const fixture=fileURLToPath(new URL('./budget-controls-preview/data.jsx',import.meta.url));
const server=await createServer({...base,configFile:false,resolve:{alias:[
 {find:/^(\.\.\/|\.\.\/\.\.\/)(hooks\/(useBudgets|useMonthlyExpenses|useMonthlyExpenseCategories|useAnnualExpenses|useAnnualExpenseCategories|useVariableExpenses|useVariableExpenseCategories|useWashes|useAnnualExpenseEntries)|contexts\/PartnerViewContext|lib\/firebaseClient)$/,replacement:fixture},
 {find:/^\.\/TopBar$/,replacement:fixture},...base.resolve.alias,
]},server:{host:'127.0.0.1',port:5212,strictPort:true}});
await server.listen();server.printUrls();
