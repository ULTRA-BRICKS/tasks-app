import { create } from 'zustand';
import { bindingError, readBindings, type Bindings } from './keys';
import { defaultBindings } from './commands';
type Settings = {
  scope: string;
  bindings: Bindings;
  enabled: boolean;
  error: string;
  initialize: (scope: string) => void;
  change: (id: string, value: string[]) => string | null;
  reset: () => void;
  toggle: () => void;
};
export const useShortcutSettings = create<Settings>()((set, get) => ({
  scope: '',
  bindings: defaultBindings(),
  enabled: true,
  error: '',
  initialize: (scope) => {
    if (get().scope === scope) return;
    try {
      set({
        scope,
        bindings: readBindings(localStorage.getItem('tasks-shortcuts:' + scope)),
        enabled: localStorage.getItem('tasks-shortcuts-off:' + scope) !== 'true',
        error: '',
      });
    } catch {
      set({
        scope,
        bindings: defaultBindings(),
        enabled: true,
        error: 'Shortcut settings cannot be saved in this browser.',
      });
    }
  },
  change: (id, value) => {
    const state = get(),
      problem = bindingError(id, value, state.bindings);
    if (problem) return problem;
    const bindings = { ...state.bindings, [id]: value };
    try {
      localStorage.setItem('tasks-shortcuts:' + state.scope, JSON.stringify(bindings));
      set({ bindings, error: '' });
      return null;
    } catch {
      return 'Could not save this shortcut. Existing shortcuts are unchanged.';
    }
  },
  reset: () => {
    try {
      localStorage.removeItem('tasks-shortcuts:' + get().scope);
      set({ bindings: defaultBindings(), error: '' });
    } catch {
      set({ error: 'Could not reset shortcut settings.' });
    }
  },
  toggle: () => {
    try {
      const enabled = !get().enabled;
      localStorage.setItem('tasks-shortcuts-off:' + get().scope, String(!enabled));
      set({ enabled, error: '' });
    } catch {
      set({ error: 'Could not save the shortcut preference.' });
    }
  },
}));
