import { describe, expect, it } from 'vitest';
import {
  isCompletedTask,
  isTimedTask,
  listNameToCategory,
  selectIngestableItems,
  selectFolderLists,
  taskDateKey,
  taskDurationMinutes,
  ticktickSourceId,
  todayInVancouver,
  type TickTickProject,
  type TickTickTask,
} from '@/lib/ticktick';

function task(overrides: Partial<TickTickTask> = {}): TickTickTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Wrapping up Product Planning tasks',
    status: 0,
    startDate: '2026-08-10T22:15:00+0000',
    dueDate: '2026-08-10T22:45:00+0000',
    isAllDay: false,
    ...overrides,
  };
}

describe('listNameToCategory', () => {
  it('strips a leading emoji from a list name', () => {
    expect(listNameToCategory('🤖ELAN')).toBe('ELAN');
  });

  it('strips a different leading emoji to the same category', () => {
    // 📄ELAN and 🤖ELAN are the same work; both must collapse to one category.
    expect(listNameToCategory('📄ELAN')).toBe('ELAN');
  });

  it('strips a multi-codepoint ZWJ emoji', () => {
    expect(listNameToCategory('👨‍💼WSBC')).toBe('WSBC');
  });

  it('keeps multi-word names intact', () => {
    expect(listNameToCategory('📝WSBC General Tasks')).toBe('WSBC General Tasks');
  });

  it('leaves a plain name unchanged', () => {
    expect(listNameToCategory('Other Projects')).toBe('Other Projects');
  });

  it('keeps a leading digit', () => {
    expect(listNameToCategory('👨‍👩‍👧‍👦3 - Friends, Family')).toBe('3 - Friends, Family');
  });

  it('trims surrounding whitespace', () => {
    expect(listNameToCategory('  🧬WSBC Projects  ')).toBe('WSBC Projects');
  });

  it('falls back to the original name when it is only symbols', () => {
    expect(listNameToCategory('🤖')).toBe('🤖');
  });

  it('falls back to the original name when it is empty after trimming', () => {
    expect(listNameToCategory('   ')).toBe('   ');
  });
});

describe('isTimedTask', () => {
  it('accepts a task with both start and due times', () => {
    expect(isTimedTask(task())).toBe(true);
  });

  it('rejects an all-day task', () => {
    expect(isTimedTask(task({ isAllDay: true }))).toBe(false);
  });

  it('rejects a task with no start date', () => {
    expect(isTimedTask(task({ startDate: null }))).toBe(false);
  });

  it('rejects a task with no due date', () => {
    expect(isTimedTask(task({ dueDate: null }))).toBe(false);
  });

  it('rejects a task whose due time is before its start time', () => {
    expect(
      isTimedTask(
        task({
          startDate: '2026-08-10T22:45:00+0000',
          dueDate: '2026-08-10T22:15:00+0000',
        }),
      ),
    ).toBe(false);
  });

  it('rejects a zero-length task', () => {
    expect(
      isTimedTask(
        task({
          startDate: '2026-08-10T22:15:00+0000',
          dueDate: '2026-08-10T22:15:00+0000',
        }),
      ),
    ).toBe(false);
  });
});

describe('taskDurationMinutes', () => {
  it('computes minutes between start and due', () => {
    expect(taskDurationMinutes(task())).toBe(30);
  });

  it('computes a multi-hour duration', () => {
    expect(
      taskDurationMinutes(
        task({
          startDate: '2026-08-10T17:00:00+0000',
          dueDate: '2026-08-10T19:30:00+0000',
        }),
      ),
    ).toBe(150);
  });

  it('returns 0 when dates are missing', () => {
    expect(taskDurationMinutes(task({ startDate: null, dueDate: null }))).toBe(0);
  });
});

describe('taskDateKey', () => {
  it('buckets by Vancouver day, not UTC', () => {
    // 2026-08-10T22:15Z is 15:15 on Aug 10 in Vancouver — same day here.
    expect(taskDateKey(task())).toBe('2026-08-10');
  });

  it('assigns a late-evening Vancouver task to the local day, not the UTC day', () => {
    // 2026-08-11T04:30Z is 21:30 on Aug 10 in Vancouver. UTC would say Aug 11.
    expect(
      taskDateKey(
        task({
          startDate: '2026-08-11T04:30:00+0000',
          dueDate: '2026-08-11T05:00:00+0000',
        }),
      ),
    ).toBe('2026-08-10');
  });

  it('handles a task early in the UTC day that is the previous Vancouver day', () => {
    // 2026-01-01T03:00Z is 19:00 on Dec 31 in Vancouver (PST, UTC-8).
    expect(
      taskDateKey(
        task({
          startDate: '2026-01-01T03:00:00+0000',
          dueDate: '2026-01-01T04:00:00+0000',
        }),
      ),
    ).toBe('2025-12-31');
  });

  it('returns null when the task has no start date', () => {
    expect(taskDateKey(task({ startDate: null }))).toBeNull();
  });
});

describe('isCompletedTask', () => {
  it('treats status 0 as not completed', () => {
    expect(isCompletedTask(task({ status: 0 }))).toBe(false);
  });

  it('treats v1 status 1 as completed', () => {
    expect(isCompletedTask(task({ status: 1 }))).toBe(true);
  });

  it('treats v2 status 2 as completed', () => {
    expect(isCompletedTask(task({ status: 2 }))).toBe(true);
  });
});

describe('ticktickSourceId', () => {
  it('uses the task id, which is unique across TickTick', () => {
    expect(ticktickSourceId(task({ id: '6a7a708de42bdd11f74ff0f1' }))).toBe(
      '6a7a708de42bdd11f74ff0f1',
    );
  });

  it('is stable when the task moves between lists', () => {
    const before = ticktickSourceId(task({ id: 'abc', projectId: 'list-a' }));
    const after = ticktickSourceId(task({ id: 'abc', projectId: 'list-b' }));
    expect(before).toBe(after);
  });
});

describe('todayInVancouver', () => {
  it('returns the Vancouver day for a UTC instant that is still the previous day locally', () => {
    expect(todayInVancouver(new Date('2026-08-11T04:30:00Z'))).toBe('2026-08-10');
  });

  it('returns the Vancouver day once UTC and local agree', () => {
    expect(todayInVancouver(new Date('2026-08-11T18:00:00Z'))).toBe('2026-08-11');
  });
});

describe('selectIngestableItems', () => {
  const elan = (tasks: TickTickTask[]) => [
    { id: '6a7a6ff28f08f1b21296dc98', name: '🤖ELAN', tasks },
  ];

  it('selects a timed task dated today', () => {
    const items = selectIngestableItems(elan([task()]), '2026-08-10');
    expect(items).toHaveLength(1);
    expect(items[0].task.id).toBe('task-1');
  });

  it('derives the category from the list name, not the task title', () => {
    // "Wrapping up Product Planning tasks" has no acronym; grouping must come
    // from the list so it lands under ELAN rather than General tasks/meetings.
    const items = selectIngestableItems(elan([task()]), '2026-08-10');
    expect(items[0].categoryName).toBe('ELAN');
  });

  it('carries the list id and raw name through for display', () => {
    const items = selectIngestableItems(elan([task()]), '2026-08-10');
    expect(items[0].listId).toBe('6a7a6ff28f08f1b21296dc98');
    expect(items[0].listName).toBe('🤖ELAN');
  });

  it('computes the date key and duration', () => {
    const items = selectIngestableItems(elan([task()]), '2026-08-10');
    expect(items[0].dateKey).toBe('2026-08-10');
    expect(items[0].durationMinutes).toBe(30);
  });

  it('keeps a future-dated task', () => {
    const future = task({
      id: 'later',
      startDate: '2026-08-20T17:00:00+0000',
      dueDate: '2026-08-20T18:00:00+0000',
    });
    const items = selectIngestableItems(elan([future]), '2026-08-10');
    expect(items).toHaveLength(1);
  });

  it('drops a task dated before today', () => {
    const past = task({
      id: 'older',
      startDate: '2026-08-09T17:00:00+0000',
      dueDate: '2026-08-09T18:00:00+0000',
    });
    expect(selectIngestableItems(elan([past]), '2026-08-10')).toHaveLength(0);
  });

  it('drops all-day tasks', () => {
    expect(
      selectIngestableItems(elan([task({ isAllDay: true })]), '2026-08-10'),
    ).toHaveLength(0);
  });

  it('drops undated tasks', () => {
    expect(
      selectIngestableItems(
        elan([task({ startDate: null, dueDate: null })]),
        '2026-08-10',
      ),
    ).toHaveLength(0);
  });

  it('keeps completed tasks so finished work is not lost', () => {
    const done = task({ status: 2, completedTime: '2026-08-10T22:50:00+0000' });
    const items = selectIngestableItems(elan([done]), '2026-08-10');
    expect(items).toHaveLength(1);
    expect(items[0].completed).toBe(true);
  });

  it('flags undone tasks as not completed', () => {
    const items = selectIngestableItems(elan([task()]), '2026-08-10');
    expect(items[0].completed).toBe(false);
  });

  it('collapses two lists that differ only by emoji onto one category', () => {
    const lists = [
      { id: 'a', name: '🤖ELAN', tasks: [task({ id: 'one' })] },
      { id: 'b', name: '📄ELAN', tasks: [task({ id: 'two' })] },
    ];
    const items = selectIngestableItems(lists, '2026-08-10');
    expect(items.map((i) => i.categoryName)).toEqual(['ELAN', 'ELAN']);
  });

  it('handles multiple lists and preserves per-list grouping', () => {
    const lists = [
      { id: 'a', name: '🤖ELAN', tasks: [task({ id: 'one' })] },
      { id: 'b', name: '💳PIS Enhance', tasks: [task({ id: 'two' })] },
    ];
    const items = selectIngestableItems(lists, '2026-08-10');
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.categoryName)).toEqual(['ELAN', 'PIS Enhance']);
  });

  it('returns an empty array for a list with no tasks', () => {
    expect(selectIngestableItems([{ id: 'a', name: '🤖ELAN', tasks: [] }], '2026-08-10')).toEqual(
      [],
    );
  });

  it('de-duplicates a task that appears in two lists, keeping the first', () => {
    const lists = [
      { id: 'a', name: '🤖ELAN', tasks: [task({ id: 'dup' })] },
      { id: 'b', name: '💳PIS Enhance', tasks: [task({ id: 'dup' })] },
    ];
    const items = selectIngestableItems(lists, '2026-08-10');
    expect(items).toHaveLength(1);
    expect(items[0].categoryName).toBe('ELAN');
  });
});

describe('selectFolderLists', () => {
  const WSBC = '6a7a7032e42bdd11f74ff016';
  const PERSONAL = '689428adebbd1c0000000876';

  function project(overrides: Partial<TickTickProject> = {}): TickTickProject {
    return {
      id: '6a7a6ff28f08f1b21296dc98',
      name: '🤖ELAN',
      groupId: WSBC,
      closed: null,
      kind: 'TASK',
      ...overrides,
    };
  }

  it('selects a list in the target folder', () => {
    expect(selectFolderLists([project()], WSBC)).toHaveLength(1);
  });

  it('excludes lists in a different folder', () => {
    expect(
      selectFolderLists([project({ groupId: PERSONAL })], WSBC),
    ).toHaveLength(0);
  });

  it('excludes top-level lists with no folder', () => {
    expect(selectFolderLists([project({ groupId: null })], WSBC)).toHaveLength(0);
  });

  it('excludes NOTE lists, which hold no trackable time', () => {
    expect(selectFolderLists([project({ kind: 'NOTE' })], WSBC)).toHaveLength(0);
  });

  it('includes a list whose kind is absent, defaulting to a task list', () => {
    expect(selectFolderLists([project({ kind: undefined })], WSBC)).toHaveLength(1);
  });

  it('excludes archived (closed) lists', () => {
    expect(selectFolderLists([project({ closed: true })], WSBC)).toHaveLength(0);
  });

  it('picks up a newly added list without any code change', () => {
    const lists = [
      project(),
      project({ id: 'new-list', name: '💳PIS Enhance' }),
    ];
    expect(selectFolderLists(lists, WSBC).map((l) => l.name)).toEqual([
      '🤖ELAN',
      '💳PIS Enhance',
    ]);
  });

  it('returns an empty array when the folder has no lists', () => {
    expect(selectFolderLists([project({ groupId: PERSONAL })], WSBC)).toEqual([]);
  });
});
