// @vitest-environment jsdom
import { act,cleanup,renderHook,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const scope=vi.hoisted(()=>({role:'admin',uid:'test-admin',isPartnerView:false}));
const client=vi.hoisted(()=>({currentUser:{uid:'test-admin',getIdToken:async()=>'synthetic'}}));
vi.mock('../useAuth',()=>({useAuth:()=>({session:{user:{id:scope.uid}}})}));
vi.mock('../../contexts/PartnerViewContext',()=>({usePartnerView:()=>scope}));
vi.mock('../../lib/firebaseClient',()=>({auth:client}));
import { useExecutiveReportQuery,requestExecutiveReport } from '../useExecutiveReports';
beforeEach(()=>{Object.assign(scope,{role:'admin',uid:'test-admin',isPartnerView:false});client.currentUser={uid:'test-admin',getIdToken:async()=>'synthetic'};vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const result=value=>({ok:true,json:async()=>({result:value})});
it.each([{role:'partner'},{role:'accountant'},{isPartnerView:true}])('does not fetch outside the real admin view (%o)',async value=>{
  Object.assign(scope,value);const {result}=renderHook(()=>useExecutiveReportQuery({action:'list'}));
  expect(result.current.allowed).toBe(false);expect(fetch).not.toHaveBeenCalled();
});
it('ignores a stale archive response and immediately hides data on identity or role change',async()=>{
  const pending=[];fetch.mockImplementation((_u,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal})));
  const {result:hook,rerender}=renderHook(({before})=>useExecutiveReportQuery({action:'list',...(before?{before}:{})}),{initialProps:{before:null}});
  await waitFor(()=>expect(pending.length).toBe(1));rerender({before:'2026-10-01'});
  await waitFor(()=>expect(pending.length).toBe(2));expect(pending[0].signal.aborted).toBe(true);
  await act(async()=>pending[1].resolve(result({items:[],nextBefore:null,marker:'new'})));
  await waitFor(()=>expect(hook.current.data?.marker).toBe('new'));
  await act(async()=>pending[0].resolve(result({items:[],nextBefore:null,marker:'old'})));
  expect(hook.current.data.marker).toBe('new');scope.isPartnerView=true;rerender({before:'2026-10-01'});
  expect(hook.current.data).toBeNull();expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not poll on object rerenders; explicit refresh is required',async()=>{
  fetch.mockResolvedValue(result({items:[],nextBefore:null}));
  const {result:hook,rerender}=renderHook(({revision})=>useExecutiveReportQuery({action:'list'},revision),{initialProps:{revision:0}});
  await waitFor(()=>expect(hook.current.data).toBeTruthy());rerender({revision:0});expect(fetch).toHaveBeenCalledTimes(1);
  rerender({revision:1});await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
});
it('never sends a request if the user changes while obtaining a token',async()=>{
  let resolve;client.currentUser={uid:'test-admin',getIdToken:()=>new Promise(r=>{resolve=r;})};
  const pending=requestExecutiveReport({action:'list'});client.currentUser={uid:'other'};resolve('synthetic');
  await expect(pending).rejects.toThrow('تغيرت الجلسة');expect(fetch).not.toHaveBeenCalled();
});
it('does not request another user when session metadata is behind the auth client',async()=>{
  client.currentUser={uid:'other-admin',getIdToken:async()=>'synthetic'};
  await expect(requestExecutiveReport({action:'list'},undefined,'test-admin')).rejects.toThrow('تغيرت الجلسة');expect(fetch).not.toHaveBeenCalled();
});
it.each([
  [{action:'list'},{items:[{reportId:'ceo-digest-2026-10-18'}],nextBefore:null}],
  [{action:'read',reportId:'ceo-digest-2026-10-18'},{report:null,history:[{revision:'bad'}]}],
  [{action:'save',report:{reportId:'ceo-digest-2026-10-18',revision:1}},{reportId:'ceo-digest-2026-10-17',revision:1,duplicate:false}],
])('rejects malformed successful responses rather than claiming acceptance',async(input,value)=>{
  fetch.mockResolvedValue(result(value));await expect(requestExecutiveReport(input)).rejects.toThrow();
});
