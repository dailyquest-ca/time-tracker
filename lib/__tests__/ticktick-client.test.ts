/**
 * The MCP response envelope is the boundary where a shape surprise becomes a
 * runtime crash. These cover the parsing seam so a mismatch produces a message
 * naming the tool and the shape, not "b.filter is not a function".
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  },
}));

const { expectArray, parseToolResult } = await import('@/lib/ticktick-client');

function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

describe('parseToolResult', () => {
  it('unwraps a { result: [...] } envelope', () => {
    const parsed = parseToolResult(textResult('{"result":[{"id":"a"}]}'), 'list_projects');
    expect(parsed).toEqual([{ id: 'a' }]);
  });

  it('accepts a bare array with no envelope', () => {
    const parsed = parseToolResult(textResult('[{"id":"a"}]'), 'list_projects');
    expect(parsed).toEqual([{ id: 'a' }]);
  });

  it('prefers structuredContent when the server provides it', () => {
    const parsed = parseToolResult(
      { structuredContent: { result: [{ id: 'b' }] }, content: [] },
      'list_projects',
    );
    expect(parsed).toEqual([{ id: 'b' }]);
  });

  it('unwraps structuredContent that is already bare', () => {
    const parsed = parseToolResult(
      { structuredContent: [{ id: 'c' }] },
      'list_projects',
    );
    expect(parsed).toEqual([{ id: 'c' }]);
  });

  it('does not mistake an array for an envelope', () => {
    // 'result' in [] is false, but guard against Array being treated as object.
    const parsed = parseToolResult(textResult('[]'), 'list_projects');
    expect(parsed).toEqual([]);
  });

  it('throws naming the tool when the server reports an error', () => {
    expect(() =>
      parseToolResult(
        { isError: true, content: [{ type: 'text', text: 'rate limited' }] },
        'filter_tasks',
      ),
    ).toThrow(/filter_tasks.*rate limited/);
  });

  it('throws naming the tool when the text is not JSON', () => {
    expect(() => parseToolResult(textResult('<html>nope</html>'), 'list_projects')).toThrow(
      /list_projects/,
    );
  });

  it('returns undefined when there is no content at all', () => {
    expect(parseToolResult({ content: [] }, 'list_projects')).toBeUndefined();
  });

  it('ignores non-text content blocks', () => {
    const parsed = parseToolResult(
      { content: [{ type: 'image' }, { type: 'text', text: '{"result":[1]}' }] },
      'list_projects',
    );
    expect(parsed).toEqual([1]);
  });
});

describe('expectArray', () => {
  it('passes an array straight through', () => {
    expect(expectArray([1, 2], 'list_projects')).toEqual([1, 2]);
  });

  it('treats undefined as empty, since an absent payload is not an error', () => {
    expect(expectArray(undefined, 'list_projects')).toEqual([]);
  });

  it('reports the tool and that it got an object, listing its keys', () => {
    expect(() => expectArray({ projects: [] }, 'list_projects')).toThrow(
      /list_projects.*object.*projects/,
    );
  });

  it('reports the tool and the primitive type it got', () => {
    expect(() => expectArray('nope', 'filter_tasks')).toThrow(/filter_tasks.*string/);
  });

  it('reports null distinctly from object', () => {
    expect(() => expectArray(null, 'list_projects')).toThrow(/null/);
  });

  it('does not leak payload values into the message', () => {
    // Task titles are user data; the diagnostic names shapes, not contents.
    let message = '';
    try {
      expectArray({ secretTitle: 'Board meeting notes' }, 'filter_tasks');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('secretTitle');
    expect(message).not.toContain('Board meeting notes');
  });
});
