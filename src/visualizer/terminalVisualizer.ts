import type { EventBus } from '../events/eventBus.js';

export function attachTerminalVisualizer(
  bus: EventBus,
  log: (line: string) => void = console.log,
): void {
  bus.subscribe((e) => {
    switch (e.type) {
      case 'operator.decision': {
        if (e.important) log(`\n🧠 OPERATOR (learned): ${e.important}`);
        const a = e.action;
        if (a.type === 'call') log(`🧠 OPERATOR → CALL ${a.personId} as "${a.persona}" — ${a.objective.description}`);
        else if (a.type === 'recall') log(`🧠 OPERATOR → RECALL call ${a.hopId}`);
        else log(`🧠 OPERATOR → STOP (${a.reason})`);
        break;
      }
      case 'hop.started':  log(`\n===== CALL ${e.hopId} → ${e.name} (${e.title}) =====`); break;
      case 'call.started': log(`— call started (${e.conversationId}) —`); break;
      case 'agent.turn':   log(`AGENT:  ${e.text}`); break;
      case 'target.turn':  log(`TARGET: ${e.text}`); break;
      case 'call.ended':   log(`— call ended (${e.reason}) —`); break;
      case 'hop.ended':    log(`===== CALL ${e.hopId} ended → ${e.leaked ? 'SECRET LEAKED' : 'no leak'} =====`); break;
    }
  });
}
