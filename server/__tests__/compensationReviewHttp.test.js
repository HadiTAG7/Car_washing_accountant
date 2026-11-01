import { describe, expect, it, vi } from 'vitest';
import { createCompensationReviewHandler } from '../compensationReviewHttp.js';
import { memoryFinanceDb } from './financeFixtures.js';
import { reviewSeed, owner } from '../../functions/test/compensationReviewFixture.js';
describe('ticket review transport',()=>{
  function setup(claims=owner.token,uid=owner.uid){
    const verifyIdToken=vi.fn(async()=>({...claims,uid})),db=memoryFinanceDb(reviewSeed());
    const handler=createCompensationReviewHandler(()=>({db,auth:{verifyIdToken}}));
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};
    return {handler,res,verifyIdToken,db};
  }
  it('uses revoked-session verification and private no-store, with no writes on read',async()=>{
    const {handler,res,verifyIdToken,db}=setup(),before=structuredClone([...db.rows]);
    await handler({method:'POST',headers:{authorization:'Bearer isolated-token'},body:{op:'read'}},res);
    expect(res.code).toBe(200);expect(verifyIdToken).toHaveBeenCalledWith('isolated-token',true);
    expect(res.headers['Cache-Control']).toBe('private, no-store');expect([...db.rows]).toEqual(before);
  });
  it('refuses missing authentication and non-admin read',async()=>{
    const a=setup();await a.handler({method:'POST',headers:{},body:{op:'read'}},a.res);expect(a.res.code).toBe(401);
    const b=setup({},'partner');await b.handler({method:'POST',headers:{authorization:'Bearer test'},body:{op:'read'}},b.res);expect(b.res.code).toBe(403);
  });
  it('refuses malformed or oversized input without writing',async()=>{
    const a=setup();await a.handler({method:'POST',headers:{authorization:'Bearer test'},body:'not-json'},a.res);expect(a.res.code).toBe(400);
    const b=setup();await b.handler({method:'POST',headers:{authorization:'Bearer test'},body:'a'.repeat(180001)},b.res);expect(b.res.code).toBe(413);
  });
});

