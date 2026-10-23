// Synthetic browser fixture only. Every server transport is replaced.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config.js';
const base = await config({ mode:'development',command:'serve' });
const fixture=fileURLToPath(new URL('./administrative-completion-preview/data.js',import.meta.url));
const server=await createServer({...base,configFile:false,resolve:{alias:[{find:/^(\.\.\/|\.\.\/\.\.\/)(lib\/firebaseClient|hooks\/useSweaterWashDetails)$/,replacement:fixture},...base.resolve.alias]},server:{host:'127.0.0.1',port:5224,strictPort:true}});
await server.listen();server.printUrls();
