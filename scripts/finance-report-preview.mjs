// Synthetic-only UI, with every data/auth/write seam replaced. No live backend.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import config from '../vite.config.js';
const base=await config({mode:'development',command:'serve'});
const fixture=fileURLToPath(new URL('./finance-report-preview/data.jsx',import.meta.url));
const server=await createServer({...base,configFile:false,resolve:{alias:[
  {find:/^\.\.\/(hooks\/useFinanceRead|lib\/financeApi)$/,replacement:fixture},
  {find:/^\.\/TopBar$/,replacement:fixture},...base.resolve.alias]},
  plugins:[...base.plugins,{name:'finance-report-built-css',configureServer(vite){
    vite.middlewares.use('/__built-report-css',async(_req,res)=>{
      const root=fileURLToPath(new URL('../dist/assets/',import.meta.url));
      try{const names=await readdir(root),chosen=['FinanceReportsPage-','FinanceWorkspace-'].map(p=>names.find(n=>n.startsWith(p)&&n.endsWith('.css')));
        if(chosen.some(n=>!n))throw new Error('Build required');res.setHeader('Content-Type','text/css');
        res.end((await Promise.all(chosen.map(n=>readFile(`${root}/${n}`,'utf8')))).join('\n'));
      }catch{res.statusCode=503;res.end('/* build required */');}
    });
  }}],server:{host:'127.0.0.1',port:5251,strictPort:true}});
await server.listen();server.printUrls();
