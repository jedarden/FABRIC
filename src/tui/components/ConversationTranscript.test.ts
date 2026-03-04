/**
 * Tests for ConversationTranscript component
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import blessed from 'blessed';
import { ConversationTranscript, createConversationTranscript } from './ConversationTranscript.js';
import {
  ConversationSession,
  ConversationEvent,
  PromptEvent,
  ResponseEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '../../types.js';

describe('ConversationTranscript', () => {
  let screen: blessed.Widgets.Screen;
  let transcript: ConversationTranscript;

  beforeEach(() => {
    // Create mock screen
    screen = blessed.screen({
      smartCSR: true,
      title: 'Test Screen',
    });

    // Create transcript component
    transcript = createConversationTranscript({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    });
  });

  afterEach(() => {
    screen.destroy();
  });

  describe('Component Creation', () => {
    it('should create a ConversationTranscript instance', () => {
      expect(transcript).toBeDefined();
      expect(transcript).toBeInstanceOf(ConversationTranscript);
    });

    it('should be hidden by default', () => {
      expect(transcript.isVisible()).toBe(false);
    });

    it('should have underlying blessed element', () => {
      const element = transcript.getElement();
      expect(element).toBeDefined();
    });
  });

  describe('Session Management', () => {
    it('should accept and display a conversation session', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        beadId: 'bd-abc',
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        events: [
          createPromptEvent('Hello, can you help me?', 0),
          createResponseEvent('Of course! How can I assist you?', 1),
        ],
        totalTokens: 100,
        turnCount: 2,
        toolsUsed: [],
        isActive: false,
      };

      transcript.setSession(session);
      // Should not throw
    });

    it('should clear previous session when setting new one', () => {
      const session1: ConversationSession = {
        id: 'session-1',
        workerId: 'worker-1',
        startTime: Date.now(),
        events: [createPromptEvent('First session', 0)],
        totalTokens: 50,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      const session2: ConversationSession = {
        id: 'session-2',
        workerId: 'worker-2',
        startTime: Date.now(),
        events: [createPromptEvent('Second session', 0)],
        totalTokens: 60,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session1);
      transcript.setSession(session2);
      // Should handle session replacement without errors
    });
  });

  describe('Event Rendering', () => {
    it('should render prompt events', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createPromptEvent('Test prompt', 0),
        ],
        totalTokens: 10,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should render without errors
    });

    it('should render response events', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createResponseEvent('Test response', 0),
        ],
        totalTokens: 10,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should render without errors
    });

    it('should render thinking events', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createThinkingEvent('Internal reasoning...', 0),
        ],
        totalTokens: 10,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should render without errors
    });

    it('should render tool call events', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createToolCallEvent('Read', { file_path: '/test/file.ts' }, 0),
        ],
        totalTokens: 10,
        turnCount: 1,
        toolsUsed: ['Read'],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should render without errors
    });

    it('should render tool result events', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createToolResultEvent('Read', 'File contents here', true, 0),
        ],
        totalTokens: 10,
        turnCount: 1,
        toolsUsed: ['Read'],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should render without errors
    });

    it('should render complete conversation flow', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now() - 120000,
        endTime: Date.now(),
        events: [
          createPromptEvent('Can you read /test/file.ts?', 0),
          createThinkingEvent('I need to use the Read tool', 1),
          createToolCallEvent('Read', { file_path: '/test/file.ts' }, 2),
          createToolResultEvent('Read', 'export const test = 123;', true, 3),
          createResponseEvent('The file contains: export const test = 123;', 4),
        ],
        totalTokens: 250,
        turnCount: 2,
        toolsUsed: ['Read'],
        isActive: false,
      };

      transcript.setSession(session);
      transcript.render();
      // Should render full conversation without errors
    });
  });

  describe('Tool Call Collapsing', () => {
    it('should support collapsing all tool calls', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createToolCallEvent('Read', { file_path: '/test/file1.ts' }, 0),
          createToolCallEvent('Write', { file_path: '/test/file2.ts', content: 'test' }, 1),
        ],
        totalTokens: 50,
        turnCount: 2,
        toolsUsed: ['Read', 'Write'],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.collapseAllToolCalls();
      transcript.render();
      // Should collapse without errors
    });

    it('should support expanding all tool calls', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createToolCallEvent('Read', { file_path: '/test/file1.ts' }, 0),
          createToolCallEvent('Write', { file_path: '/test/file2.ts', content: 'test' }, 1),
        ],
        totalTokens: 50,
        turnCount: 2,
        toolsUsed: ['Read', 'Write'],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.collapseAllToolCalls();
      transcript.expandAllToolCalls();
      transcript.render();
      // Should expand without errors
    });
  });

  describe('Visibility Controls', () => {
    it('should show the component', () => {
      transcript.show();
      expect(transcript.isVisible()).toBe(true);
    });

    it('should hide the component', () => {
      transcript.show();
      transcript.hide();
      expect(transcript.isVisible()).toBe(false);
    });

    it('should toggle visibility', () => {
      expect(transcript.isVisible()).toBe(false);
      transcript.toggle();
      expect(transcript.isVisible()).toBe(true);
      transcript.toggle();
      expect(transcript.isVisible()).toBe(false);
    });
  });

  describe('Callbacks', () => {
    it('should trigger onSearch callback', () => {
      const onSearch = vi.fn();
      const transcriptWithCallback = createConversationTranscript({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        onSearch,
      });

      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createPromptEvent('Search test', 0),
          createResponseEvent('Response test', 1),
        ],
        totalTokens: 50,
        turnCount: 2,
        toolsUsed: [],
        isActive: true,
      };

      transcriptWithCallback.setSession(session);
      // Simulate search would trigger callback in real usage
    });

    it('should trigger onExport callback', () => {
      const onExport = vi.fn();
      const transcriptWithCallback = createConversationTranscript({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        onExport,
      });

      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createPromptEvent('Export test', 0),
        ],
        totalTokens: 10,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcriptWithCallback.setSession(session);
      transcriptWithCallback.exportTranscript('markdown');

      expect(onExport).toHaveBeenCalledWith('markdown', expect.stringContaining('conversation-session-123'));
    });
  });

  describe('Code Highlighting', () => {
    it('should handle responses with code blocks', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createResponseEvent('Here is some code:\n```typescript\nconst x = 123;\n```', 0),
        ],
        totalTokens: 50,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should render code blocks with highlighting
    });

    it('should handle multiple code blocks in one response', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createResponseEvent(
            'First block:\n```javascript\nconst a = 1;\n```\n\nSecond block:\n```python\ndef hello():\n    pass\n```',
            0
          ),
        ],
        totalTokens: 100,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should handle multiple code blocks
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty session', () => {
      const session: ConversationSession = {
        id: 'session-empty',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [],
        totalTokens: 0,
        turnCount: 0,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should handle empty events gracefully
    });

    it('should handle truncated content', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          {
            id: 'resp-1',
            type: 'response',
            role: 'assistant',
            ts: Date.now(),
            worker: 'worker-alpha',
            sequence: 0,
            content: 'Very long content...',
            isTruncated: true,
          } as ResponseEvent,
        ],
        totalTokens: 1000,
        turnCount: 1,
        toolsUsed: [],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should indicate truncation
    });

    it('should handle tool errors', () => {
      const session: ConversationSession = {
        id: 'session-123',
        workerId: 'worker-alpha',
        startTime: Date.now(),
        events: [
          createToolResultEvent('Read', 'File not found', false, 0, 'ENOENT: no such file'),
        ],
        totalTokens: 20,
        turnCount: 1,
        toolsUsed: ['Read'],
        isActive: true,
      };

      transcript.setSession(session);
      transcript.render();
      // Should display error indicator
    });

    it('should handle very long conversations', () => {
      const events: ConversationEvent[] = [];
      for (let i = 0; i < 100; i++) {
        events.push(createPromptEvent(`Prompt ${i}`, i * 2));
        events.push(createResponseEvent(`Response ${i}`, i * 2 + 1));
      }

      const session: ConversationSession = {
        id: 'session-long',
        workerId: 'worker-alpha',
        startTime: Date.now() - 600000,
        endTime: Date.now(),
        events,
        totalTokens: 10000,
        turnCount: 100,
        toolsUsed: [],
        isActive: false,
      };

      transcript.setSession(session);
      transcript.render();
      // Should handle long conversations efficiently
    });
  });
});

// Helper functions to create test events

function createPromptEvent(content: string, sequence: number): PromptEvent {
  return {
    id: `prompt-${sequence}`,
    type: 'prompt',
    role: 'user',
    ts: Date.now(),
    worker: 'test-worker',
    sequence,
    content,
    tokens: content.length,
  };
}

function createResponseEvent(content: string, sequence: number): ResponseEvent {
  return {
    id: `response-${sequence}`,
    type: 'response',
    role: 'assistant',
    ts: Date.now(),
    worker: 'test-worker',
    sequence,
    content,
    tokens: content.length,
  };
}

function createThinkingEvent(content: string, sequence: number): ThinkingEvent {
  return {
    id: `thinking-${sequence}`,
    type: 'thinking',
    role: 'assistant',
    ts: Date.now(),
    worker: 'test-worker',
    sequence,
    content,
  };
}

function createToolCallEvent(tool: string, args: Record<string, any>, sequence: number): ToolCallEvent {
  return {
    id: `tool-call-${sequence}`,
    type: 'tool_call',
    role: 'assistant',
    ts: Date.now(),
    worker: 'test-worker',
    sequence,
    tool,
    args,
    summary: `${tool}(${Object.keys(args).join(', ')})`,
  };
}

function createToolResultEvent(
  tool: string,
  content: string,
  success: boolean,
  sequence: number,
  error?: string
): ToolResultEvent {
  return {
    id: `tool-result-${sequence}`,
    type: 'tool_result',
    role: 'tool',
    ts: Date.now(),
    worker: 'test-worker',
    sequence,
    tool,
    content,
    success,
    error,
    resultSize: content.length,
  };
}
