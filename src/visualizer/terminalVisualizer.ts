import type { EventBus } from '../events/eventBus.js';

export function attachTerminalVisualizer(
  bus: EventBus,
  log: (line: string) => void = console.log,
): void {
  bus.subscribe((e) => {
    switch (e.type) {
      case 'hop.started':  log(`\n===== CALL ${e.hopId} → ${e.name} (${e.title}) =====`); break;
      case 'call.started': log(`— call started (${e.conversationId}) —`); break;
      case 'agent.turn':   log(`AGENT:  ${e.text}`); break;
      case 'target.turn':  log(`TARGET: ${e.text}`); break;
      case 'call.ended':   log(`— call ended (${e.reason}) —`); break;
      case 'hop.ended':    log(`===== CALL ${e.hopId} ended → ${e.leaked ? 'SECRET LEAKED' : 'no leak'} =====`); break;
    }
  });
}
