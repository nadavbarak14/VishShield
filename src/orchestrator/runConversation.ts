import type { Agent } from '../agent/agent.js';
import type { CallEngine } from '../callEngine/callEngine.js';
import type { EventBus } from '../events/eventBus.js';
import { TARGET_HANGUP_TOKEN } from '../target/target.js';
import type { AgentSession, Conversation, Turn } from '../types.js';

const MAX_TURNS = 20;

export async function runConversation(
  conversationId: string,
  campaignId: string,
  session: AgentSession,
  agent: Agent,
  call: CallEngine,
  bus: EventBus,
): Promise<Conversation> {
  const transcript: Turn[] = [];
  bus.emit({ type: 'call.started', conversationId });

  let endedReason: Conversation['endedReason'] = 'max_turns';
  for (let i = 0; i < MAX_TURNS; i++) {
    const { text, end } = await agent.nextUtterance(session, transcript);
    if (text) {
      transcript.push({ speaker: 'agent', text });
      bus.emit({ type: 'agent.turn', conversationId, text });
    }
    if (end) { endedReason = 'agent_ended'; break; }

    const rawReply = await call.say(text);
    const hungUp = rawReply.includes(TARGET_HANGUP_TOKEN);
    const reply = rawReply.replace(TARGET_HANGUP_TOKEN, '').trim();
    if (reply) {
      transcript.push({ speaker: 'target', text: reply });
      bus.emit({ type: 'target.turn', conversationId, text: reply });
    }
    if (hungUp) { endedReason = 'target_hung_up'; break; }
  }

  bus.emit({ type: 'call.ended', conversationId, reason: endedReason });
  return { id: conversationId, campaignId, session, transcript, endedReason };
}
