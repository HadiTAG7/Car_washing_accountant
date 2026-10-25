// Local navigation fixture: no authentication, backend, or business data.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import config from '../vite.config.js';
const base=await config({mode:'development',command:'serve'});
const fixture=fileURLToPath(new URL('./sidebar-collapse-preview/stub.jsx',import.meta.url));
const server=await createServer({...base,configFile:false,resolve:{alias:[
  {find:/^\.\.\/lib\/firebaseClient$/,replacement:fixture},
  {find:/^\.\/ChangePasswordModal$/,replacement:fixture},...base.resolve.alias]},
  server:{host:'127.0.0.1',port:5252,strictPort:true}});
await server.listen();server.printUrls();
