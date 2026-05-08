/**
 * Tests for conversationParser module
 */

import { describe, it, expect } from 'vitest';
import {
  isConversationSpanEvent,
  buildConversationSessions,
  getWorkerConversationSessions,
  getBeadConversationSession,
  extractConversationEvents,
} from './conversationParser.js';
import { LogEvent } from './types.js';

describe('conversationParser', () => {
  describe('isConversationSpanEvent', () => {
    it('should identify llm.request span events', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'tcb-alpha',
        sequence: 1,
        level: 'info',
        msg: 'llm.request.started',
        span_name: 'llm.request',
      };
      expect(isConversationSpanEvent(event)).toBe(true);
    });

    it('should identify tool.call span events', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'tcb-alpha',
        sequence: 1,
        level: 'info',
        msg: 'tool.call.started',
        span_name: 'tool.call',
        tool: 'Read',
      };
      expect(isConversationSpanEvent(event)).toBe(true);
    });

    it('should identify events with prompt field', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'tcb-alpha',
        sequence: 1,
        level: 'info',
        msg: 'bead.prompt_built',
        prompt: 'Help me write code',
      };
      expect(isConversationSpanEvent(event)).toBe(true);
    });

    it('should identify events with response field', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'tcb-alpha',
        sequence: 1,
        level: 'info',
        msg: 'agent.response',
        response: 'I can help with that',
      };
      expect(isConversationSpanEvent(event)).toBe(true);
    });

    it('should return false for non-conversation events', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'tcb-alpha',
        sequence: 1,
        level: 'info',
        msg: 'worker.state_transition',
      };
      expect(isConversationSpanEvent(event)).toBe(false);
    });

    it('should identify bead.agent_started events', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'tcb-alpha',
        sequence: 1,
        level: 'info',
        msg: 'bead.agent_started',
        bead: 'bd-test',
      };
      expect(isConversationSpanEvent(event)).toBe(true);
    });

    it('should identify bead.agent_completed events', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'tcb-alpha',
        sequence: 1,
        level: 'info',
        msg: 'bead.agent_completed',
        bead: 'bd-test',
      };
      expect(isConversationSpanEvent(event)).toBe(true);
    });
  });

  describe('buildConversationSessions', () => {
    it('should build a session from llm.request events', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now() - 1000,
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.request.started',
          span_name: 'llm.request',
          bead: 'bd-test',
          session: 'session-1',
          prompt: 'Write a function',
        },
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 2,
          level: 'info',
          msg: 'llm.request.finished',
          span_name: 'llm.request',
          bead: 'bd-test',
          session: 'session-1',
          response: 'Here is a function',
          model: 'sonnet',
          tokens: 100,
        },
      ];

      const sessions = buildConversationSessions(events);
      expect(sessions).toHaveLength(1);

      const session = sessions[0];
      expect(session.workerId).toBe('tcb-alpha');
      expect(session.beadId).toBe('bd-test');
      expect(session.events).toHaveLength(2);
      expect(session.events[0].type).toBe('prompt');
      expect(session.events[1].type).toBe('response');
      expect(session.totalTokens).toBe(100);
    });

    it('should build a session with tool calls', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now() - 2000,
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'tool.call.started',
          span_name: 'tool.call',
          bead: 'bd-test',
          tool: 'Read',
          tool_args: { file_path: '/test/file.ts' },
        },
        {
          ts: Date.now() - 1000,
          worker: 'tcb-alpha',
          sequence: 2,
          level: 'info',
          msg: 'tool.call.finished',
          span_name: 'tool.call',
          bead: 'bd-test',
          tool: 'Read',
          result: 'file contents',
        },
      ];

      const sessions = buildConversationSessions(events);
      expect(sessions).toHaveLength(1);

      const session = sessions[0];
      expect(session.events).toHaveLength(2);
      expect(session.events[0].type).toBe('tool_call');
      expect(session.events[1].type).toBe('tool_result');
      expect(session.toolsUsed).toEqual(['Read']);
    });

    it('should handle mixed conversation events', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now() - 4000,
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.request.started',
          bead: 'bd-test',
          prompt: 'Read the file',
        },
        {
          ts: Date.now() - 3000,
          worker: 'tcb-alpha',
          sequence: 2,
          level: 'info',
          msg: 'tool.call.started',
          bead: 'bd-test',
          tool: 'Read',
          args: { file_path: '/test.ts' },
        },
        {
          ts: Date.now() - 2000,
          worker: 'tcb-alpha',
          sequence: 3,
          level: 'info',
          msg: 'tool.call.finished',
          bead: 'bd-test',
          tool: 'Read',
          result: 'content here',
        },
        {
          ts: Date.now() - 1000,
          worker: 'tcb-alpha',
          sequence: 4,
          level: 'info',
          msg: 'llm.request.finished',
          bead: 'bd-test',
          response: 'The file contains: content here',
        },
      ];

      const sessions = buildConversationSessions(events);
      expect(sessions).toHaveLength(1);

      const session = sessions[0];
      expect(session.events).toHaveLength(4);
      expect(session.events[0].type).toBe('prompt');
      expect(session.events[1].type).toBe('tool_call');
      expect(session.events[2].type).toBe('tool_result');
      expect(session.events[3].type).toBe('response');
      expect(session.turnCount).toBe(1);
    });

    it('should separate sessions by worker and bead', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          bead: 'bd-1',
          prompt: 'Task 1',
        },
        {
          ts: Date.now(),
          worker: 'tcb-bravo',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          bead: 'bd-2',
          prompt: 'Task 2',
        },
      ];

      const sessions = buildConversationSessions(events);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].workerId).toBe('tcb-alpha');
      expect(sessions[1].workerId).toBe('tcb-bravo');
    });

    it('should return empty array for events with no conversation data', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'worker.state_transition',
        },
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 2,
          level: 'info',
          msg: 'heartbeat.emitted',
        },
      ];

      const sessions = buildConversationSessions(events);
      expect(sessions).toHaveLength(0);
    });

    it('should extract thinking blocks from assistant events', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.thinking',
          response: 'Let me think about this...',
          thinking: true,
        },
      ];

      const sessions = buildConversationSessions(events);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].events[0].type).toBe('thinking');
    });

    it('should handle tool errors', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'tool.call.finished',
          tool: 'Read',
          result: '',
          error: 'File not found',
        },
      ];

      const sessions = buildConversationSessions(events);
      expect(sessions).toHaveLength(1);

      const session = sessions[0];
      expect(session.events[0].type).toBe('tool_result');
      const toolResult = session.events[0];
      if (toolResult.type === 'tool_result') {
        expect(toolResult.success).toBe(false);
        expect(toolResult.error).toBe('File not found');
      }
    });
  });

  describe('getWorkerConversationSessions', () => {
    it('should filter sessions by worker ID', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          prompt: 'Alpha task',
        },
        {
          ts: Date.now(),
          worker: 'tcb-bravo',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          prompt: 'Bravo task',
        },
      ];

      const alphaSessions = getWorkerConversationSessions(events, 'tcb-alpha');
      expect(alphaSessions).toHaveLength(1);
      expect(alphaSessions[0].workerId).toBe('tcb-alpha');
    });
  });

  describe('getBeadConversationSession', () => {
    it('should get session for a specific bead', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          bead: 'bd-target',
          prompt: 'Do this task',
        },
      ];

      const session = getBeadConversationSession(events, 'bd-target');
      expect(session).not.toBeNull();
      expect(session?.beadId).toBe('bd-target');
    });

    it('should return null for non-existent bead', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          bead: 'bd-actual',
          prompt: 'Task',
        },
      ];

      const session = getBeadConversationSession(events, 'bd-nonexistent');
      expect(session).toBeNull();
    });
  });

  describe('extractConversationEvents', () => {
    it('should extract all conversation events from mixed log', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now() - 3000,
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'worker.state_transition',
        },
        {
          ts: Date.now() - 2000,
          worker: 'tcb-alpha',
          sequence: 2,
          level: 'info',
          msg: 'llm.request',
          prompt: 'Hello',
        },
        {
          ts: Date.now() - 1000,
          worker: 'tcb-alpha',
          sequence: 3,
          level: 'info',
          msg: 'llm.response',
          response: 'Hi there',
        },
        {
          ts: Date.now(),
          worker: 'tcb-alpha',
          sequence: 4,
          level: 'info',
          msg: 'heartbeat.emitted',
        },
      ];

      const convEvents = extractConversationEvents(events);
      expect(convEvents).toHaveLength(2);
      expect(convEvents[0].type).toBe('prompt');
      expect(convEvents[1].type).toBe('response');
    });

    it('should maintain chronological order across sessions', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime - 3000,
          worker: 'tcb-alpha',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          bead: 'bd-1',
          prompt: 'First',
        },
        {
          ts: baseTime - 2000,
          worker: 'tcb-bravo',
          sequence: 1,
          level: 'info',
          msg: 'llm.request',
          bead: 'bd-2',
          prompt: 'Second',
        },
        {
          ts: baseTime - 1000,
          worker: 'tcb-alpha',
          sequence: 2,
          level: 'info',
          msg: 'llm.response',
          bead: 'bd-1',
          response: 'First response',
        },
      ];

      const convEvents = extractConversationEvents(events);
      expect(convEvents).toHaveLength(3);
      expect(convEvents[0].type).toBe('prompt');
      expect((convEvents[0] as any).content).toBe('First');
      expect(convEvents[1].type).toBe('prompt');
      expect((convEvents[1] as any).content).toBe('Second');
      expect(convEvents[2].type).toBe('response');
    });
  });
});
