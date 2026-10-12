import {verifyReportRoute,inspectDelivery,recordDelivery} from './delivery.mjs';

// The token belongs to the supervised sender environment, never a profile, prompt or receipt.
export function slackSender(input,{token=process.env.ATHANOR_SLACK_BOT_TOKEN,fetcher=fetch}={}){
 const route=verifyReportRoute(input);if(typeof token!=='string'||!token.startsWith('xoxb-'))throw Error('Configure the dedicated Slack bot sender before enabling unattended delivery.');
 async function api(method,body){let response;try{response=await fetcher('https://slack.com/api/'+method,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw Error('Slack response unavailable; inspect the retained delivery intent before another send.');}
  let value;try{value=await response.json();}catch{throw Error('Slack response unreadable; delivery may be unknown.');}if(!response.ok||value.ok!==true)throw Error('Slack rejected '+method+'. Inspect sender configuration; no retry was made.');return value;}
 const verify=async()=>{const auth=await api('auth.test',{});if(auth.team_id!=='T07BPEAE014'||auth.url!=='https://story-company.slack.com/'||!auth.bot_id)throw Error('Sender is not a Story Company bot.');const value=await api('conversations.info',{channel:route.channelId});const c=value.channel;if(c?.id!==route.channelId||c.is_ext_shared||c.is_archived||route.type==='im'&&(c.is_im!==true||c.user!==route.userId)||route.type==='channel'&&(c.is_channel!==true||c.name!==route.name||c.is_member!==true||c.is_private!==false))throw Error('Sender cannot verify the exact permitted Slack destination.');return {workspace:route.workspace,channelId:route.channelId,verified:true};};
 const send=async (directory,{perDestination=false}={})=>{
  const delivery=await inspectDelivery(directory,perDestination?route:null);if(delivery.intent.format!=='athanor-delivery-intent/v2')throw Error('Historical intent is read-only; retain it and review a new delivery.');if(delivery.state!=='DELIVERY_PENDING')throw Error('Inspect the existing delivery receipt; do not resend.');
  if(JSON.stringify(delivery.intent.destination)!==JSON.stringify(route))throw Error('Retained delivery route differs from sender.');
  await verify();
  // An Unknown receipt precedes the write: a process crash cannot make this appear unsent.
  await recordDelivery(directory,{intentId:delivery.intent.id,state:'DELIVERY_UNKNOWN',observation:'Single Slack dispatch authorized; response not yet retained.'},perDestination?route:null);
  const id=delivery.intent.id,client_msg_id=[id.slice(0,8),id.slice(8,12),'4'+id.slice(13,16),'8'+id.slice(17,20),id.slice(20,32)].join('-');
  const result=await api('chat.postMessage',{channel:route.channelId,text:delivery.intent.message,client_msg_id,unfurl_links:false,unfurl_media:false});
  if(result.channel!==route.channelId||!/^\d+\.\d+$/.test(result.ts||''))throw Error('Slack returned a different destination or missing timestamp; reconcile the original intent.');
  const link=await api('chat.getPermalink',{conversation_id:route.channelId,message_ts:result.ts});
  return recordDelivery(directory,{intentId:id,state:'DELIVERY_CONFIRMED',route,messageId:result.ts,messageUrl:link.permalink,observation:'Dedicated sender received and retained the Slack message identity.'},perDestination?route:null);
 };
 return {verify,send};
}
