/**
 * CommandPalette dismissal contract, tested against the real component
 * (docs/cli.md command palette section).
 *
 * Pins the palette's own key handling — the half of the dismissal story the
 * app-level contract tests cannot see, because they mock this component:
 *
 *   - `Escape` on the palette input closes the palette *without* submitting:
 *     no `onSubmit` call, no recent-commands entry. docs/cli.md: closing the
 *     palette with Escape also fires the global Escape action (blessed
 *     dispatches a key to every matching handler), so the active view steps
 *     back at the same time — that screen-level half is pinned in
 *     `src/tui/viewStateContract.test.ts` and
 *     `src/tui/globalKeySemantics.test.ts`; this file holds the component
 *     half.
 *   - `Enter` submits the highlighted suggestion, dismisses, and records the
 *     command in the recent-commands store, where it leads the next open.
 *   - `show()` resets the query and selection; `hide()`/`toggle()` track the
 *     box visibility `isVisible()` reports.
 *
 * HOME is redirected for the whole file (the palette resolves its
 * recent-commands path from `os.homedir()` at module load), so no user
 * config is touched. Blessed is replaced with stateful fakes covering only
 * the surface the component uses; everything else — scoring, recents
 * ordering, persistence — runs for real.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Redirect HOME before any import runs: RECENT_COMMANDS_FILE is computed at
// module load. The directory is never pre-created — saveRecentCommands
// mkdirs it, and a missing directory simply reads as no recents.
const homeCtl = vi.hoisted(() => {
  const originalHome = process.env.HOME;
  const fakeHome = `${process.env.TMPDIR ?? '/tmp'}/fabric-palette-escape-${process.pid}-${Math
    .random()
    .toString(36)
    .slice(2)}`;
  process.env.HOME = fakeHome;
  return { originalHome, fakeHome };
});

// ESM namespaces can't be spied on, so route os.homedir() through the same
// override the component's module-load-time path resolution sees.
const homedirCtl = vi.hoisted(() => ({ fakeHome: process.env.HOME }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => homedirCtl.fakeHome ?? actual.homedir(),
  };
});

afterAll(() => {
  process.env.HOME = homeCtl.originalHome;
  fs.rmSync(homeCtl.fakeHome, { recursive: true, force: true });
});

// Stateful blessed fakes — exactly the surface CommandPalette touches.
const b = vi.hoisted(() => {
  const state = {
    boxes: [] as Array<Record<string, any>>,
    textboxes: [] as Array<Record<string, any>>,
    lists: [] as Array<Record<string, any>>,
  };

  function makeBox(options: Record<string, any> = {}) {
    const box: Record<string, any> = {
      options,
      hidden: true,
      screen: {
        renders: 0,
        render: () => {
          box.screen.renders += 1;
        },
      },
      show: () => {
        box.hidden = false;
      },
      hide: () => {
        box.hidden = true;
      },
    };
    state.boxes.push(box);
    return box;
  }

  function makeInput(options: Record<string, any> = {}) {
    const input: Record<string, any> = {
      options,
      value: '',
      focused: false,
      eventHandlers: {} as Record<string, Array<(...args: unknown[]) => void>>,
      keyBindings: [] as Array<{ names: string[]; handler: () => void }>,
      getValue: () => input.value,
      setValue: (v: string) => {
        input.value = v;
      },
      focus: () => {
        input.focused = true;
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        (input.eventHandlers[event] ??= []).push(handler);
      },
      key: (names: string[], handler: () => void) => {
        input.keyBindings.push({ names, handler });
      },
    };
    state.textboxes.push(input);
    return input;
  }

  function makeList(options: Record<string, any> = {}) {
    const list: Record<string, any> = {
      options,
      lastItems: [] as string[],
      selectedIndex: -1,
      screen: {
        renders: 0,
        render: () => {
          list.screen.renders += 1;
        },
      },
      setItems: (items: string[]) => {
        list.lastItems = items;
      },
      select: (index: number) => {
        list.selectedIndex = index;
      },
    };
    state.lists.push(list);
    return list;
  }

  return { state, makeBox, makeInput, makeList };
});

vi.mock('blessed', () => ({
  default: {
    box: (options?: Record<string, any>) => b.makeBox(options ?? {}),
    textbox: (options?: Record<string, any>) => b.makeInput(options ?? {}),
    list: (options?: Record<string, any>) => b.makeList(options ?? {}),
  },
}));

// The REAL component — deliberately not mocked here (the app-level files
// mock it, which is exactly why this file exists).
import { CommandPalette } from './CommandPalette.js';

const recentsFile = () => path.join(homeCtl.fakeHome, '.fabric', 'recent-commands.json');

function build(onSubmit?: (command: string) => void) {
  b.state.boxes.length = 0;
  b.state.textboxes.length = 0;
  b.state.lists.length = 0;
  const palette = new CommandPalette({ parent: {} as never, onSubmit });
  return {
    palette,
    box: b.state.boxes[0],
    input: b.state.textboxes[0],
    list: b.state.lists[0],
  };
}

/** Fire a keypress on the palette input the way blessed would. */
function typeKey(
  input: Record<string, any>,
  ch: string | undefined,
  key: { name?: string; ctrl?: boolean }
): void {
  for (const handler of input.eventHandlers.keypress ?? []) handler(ch, key);
}

describe('CommandPalette dismissal (docs/cli.md command palette section)', () => {
  let palette: CommandPalette;
  let onSubmit: ReturnType<typeof vi.fn<(command: string) => void>>;
  let box: Record<string, any>;
  let input: Record<string, any>;
  let list: Record<string, any>;

  beforeEach(() => {
    fs.rmSync(recentsFile(), { force: true });

    onSubmit = vi.fn();
    ({ palette, box, input, list } = build((command: string) => onSubmit(command)));
  });

  it('starts hidden', () => {
    expect(palette.isVisible()).toBe(false);
    expect(box.hidden).toBe(true);
  });

  it('show() reveals the palette and resets the query and selection', () => {
    input.setValue('stale query');
    palette.show();
    expect(palette.isVisible()).toBe(true);
    expect(box.hidden).toBe(false);
    expect(input.getValue()).toBe('');
    expect(list.selectedIndex).toBe(0);
    expect(input.focused).toBe(true);
  });

  it('hide() conceals the palette', () => {
    palette.show();
    palette.hide();
    expect(palette.isVisible()).toBe(false);
    expect(box.hidden).toBe(true);
  });

  it('toggle() shows a hidden palette and hides a visible one', () => {
    palette.toggle();
    expect(palette.isVisible()).toBe(true);
    palette.toggle();
    expect(palette.isVisible()).toBe(false);
  });

  it('Escape on the input dismisses the palette without submitting', () => {
    palette.show();
    typeKey(input, undefined, { name: 'escape' });

    expect(palette.isVisible()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fs.existsSync(recentsFile())).toBe(false);
  });

  it('registers an element-level escape binding that dismisses as well', () => {
    const escapeBinding = input.keyBindings.find((kb: { names: string[] }) =>
      kb.names.includes('escape')
    );
    expect(escapeBinding).toBeDefined();

    palette.show();
    escapeBinding?.handler();
    expect(palette.isVisible()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('typing filters the suggestion list and Escape still dismisses without submitting', () => {
    palette.show();
    const unfiltered = list.lastItems.length;
    expect(unfiltered).toBeGreaterThan(0);

    // The fake input does not self-insert; seed the value, then let the
    // keypress trigger the filter pass.
    input.setValue('heatmap');
    typeKey(input, 'h', { name: 'h' });
    expect(list.lastItems.length).toBeGreaterThan(0);
    expect(list.lastItems.length).toBeLessThan(unfiltered);

    typeKey(input, undefined, { name: 'escape' });
    expect(palette.isVisible()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fs.existsSync(recentsFile())).toBe(false);
  });

  it('Enter submits the highlighted suggestion and dismisses', () => {
    palette.show();
    typeKey(input, undefined, { name: 'enter' });

    // Empty query, no recent commands: the first default suggestion is
    // "Show file heatmap".
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('heatmap');
    expect(palette.isVisible()).toBe(false);

    // The executed command is recorded for the next open.
    expect(JSON.parse(fs.readFileSync(recentsFile(), 'utf-8'))).toEqual(['heatmap']);
  });

  it('a submitted command leads the next open (recent-commands ordering)', () => {
    palette.show();
    typeKey(input, undefined, { name: 'enter' }); // submits "heatmap"

    const { palette: second, list: secondList } = build();
    second.show();
    // filterSuggestions with no query puts recent commands first, so the
    // heatmap entry that was just executed is no longer buried mid-list.
    expect(secondList.lastItems[0]).toContain('Show file heatmap');
    expect(secondList.selectedIndex).toBe(0);
  });

  it('the input submit event hands the value to onSubmit and dismisses', () => {
    palette.show();
    for (const handler of input.eventHandlers.submit ?? []) handler('clear');

    expect(onSubmit).toHaveBeenCalledWith('clear');
    expect(palette.isVisible()).toBe(false);
  });
});
