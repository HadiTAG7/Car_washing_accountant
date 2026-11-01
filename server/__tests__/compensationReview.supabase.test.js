import { expect, it } from 'vitest';
import { createStore } from '../db/pgstore/index.js';
import { compensationReview } from '../../functions/src/compensationReview.js';
import { reviewSource, testNow } from '../../functions/test/compensationReviewFixture.js';
const url='postgresql://postgres:isolated-only@127.0.0.1:55731/compensation_review_isolated_20261101';
it.skipIf(process.env.COMPENSATION_REVIEW_PG_TESTS!=='1')('a concurrent admin revocation prevents committing a ticket source update',async()=>{
  const target=new URL(url);
  if(target.hostname!=='127.0.0.1'||target.pathname!=='/compensation_review_isolated_20261101')throw Error('Isolation guard');
  const db=createStore({connectionString:url,role:'ledger_server',max:4});
  const control=createStore({connectionString:url,role:'ledger_server',max:2});
  const actor={uid:'99999999-2222-4222-8222-222222222222',token:{email:'synthetic-agent@example.test'}};
  const original=(await control.collection('users').doc(actor.uid).get()).data();
  if(original?.role!=='admin'||original.email!==actor.token.email)throw Error('Expected isolated seeded actor');
  const id='ssp-ticket-TEST-ROLE-REVOCATION', caseRef=control.collection('quality_objections').doc(id);
  if((await caseRef.get()).exists)throw Error('Use a fresh isolated test database');
  const transact=db.runTransaction.bind(db);let revoked=false;
  db.runTransaction=fn=>transact(tx=>fn({
    get:async ref=>{
      const snapshot=await tx.get(ref);
      if(ref.path==='quality_objections/ssp-ticket-review-queue'&&!revoked){
        revoked=true;await control.collection('users').doc(actor.uid).set({...original,role:'operator'});
      }
      return snapshot;
    },
    set:tx.set.bind(tx),
  }));
  try {
    await expect(compensationReview(db,{op:'source',data:{source:reviewSource('TEST-ROLE-REVOCATION'),requestId:'synthetic-revocation-request',expectedRevision:0}},actor,testNow))
      .rejects.toMatchObject({code:'permission-denied'});
    expect(revoked).toBe(true);
    expect((await caseRef.get()).exists).toBe(false);
  } finally {
    await control.collection('users').doc(actor.uid).set(original);
    await db.close();await control.close();
  }
},30000);
