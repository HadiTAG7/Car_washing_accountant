import { AGENT_IDS, AgentCommandCenterError } from '../functions/src/agentCommandCenter.js';

const deny = () => { throw new AgentCommandCenterError('هوية المرسل أو صلاحياته غير صالحة.', { code: 'permission-denied', httpStatus: 403 }); };
const unavailable = () => { throw new AgentCommandCenterError('إعداد هوية المرسل غير متاح.', { code: 'unavailable', httpStatus: 503 }); };

// This registry is server-only. Configuring it disables the shared-secret path.
export function resolveAgentCommandSender(senderId, env = process.env) {
  const config = env.AGENT_COMMAND_CENTER_SENDERS;
  if (!config) {
    if (senderId) deny();
    return { secret: env.AGENT_COMMAND_CENTER_WEBHOOK_SECRET };
  }
  let registry;
  try { registry = JSON.parse(config); } catch { unavailable(); }
  if (!registry || Array.isArray(registry) || typeof registry !== 'object') unavailable();
  const secrets = new Set();
  for (const [id, entry] of Object.entries(registry)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || typeof entry?.secret !== 'string' || entry.secret.length < 32
      || !Array.isArray(entry.agentIds) || !entry.agentIds.length || entry.agentIds.some((agent) => !AGENT_IDS.includes(agent))
      || !Array.isArray(entry.sourceIds) || entry.sourceIds.some((source) => !/^[a-zA-Z0-9_-]{1,80}$/.test(source))
      || secrets.has(entry.secret)) unavailable();
    secrets.add(entry.secret);
  }
  if (typeof senderId !== 'string' || !Object.hasOwn(registry, senderId)) deny();
  return { ...registry[senderId], senderId };
}

export function authorizeAgentCommandSender(sender, event) {
  if (!sender.senderId) return; // Existing v1 senders work until scoped mode is explicitly configured.
  if (!event.agentId || !sender.agentIds.includes(event.agentId)) deny();
  if (event.sourceIds.some((id) => !sender.sourceIds.includes(id))) deny();
  if (event.source && !sender.sourceIds.includes(event.source.id)) deny();
}
