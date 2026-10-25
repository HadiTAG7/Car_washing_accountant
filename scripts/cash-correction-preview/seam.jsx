import {useState,useEffect} from 'react';
export async function callFinanceApi(_endpoint,request){const response=await fetch('/__cash-correction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
  const result=await response.json();if(!response.ok)throw new Error(result.error);return result.result;}
export function useFinanceRead(endpoint,request){
  const [state,setState]=useState({loading:true,data:null,error:null}),[version,setVersion]=useState(0),key=JSON.stringify(request);
  useEffect(()=>{let current=true;callFinanceApi(endpoint,JSON.parse(key)).then(data=>{if(current)setState({loading:false,data,error:null});}).catch(e=>{if(current)setState({loading:false,data:null,error:e.message});});return()=>{current=false;};},[endpoint,key,version]);
  return {...state,allowed:true,refresh:()=>setVersion(v=>v+1)};
}
