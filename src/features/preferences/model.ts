import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { workspaceCommands } from '@/shared/lib/command-catalog';
import { devicePlatform as platform, type KeyBindingOverrides } from '@/shared/lib/commands';
import { migratePreferences, sanitizeKeyBindings } from './key-bindings';
const views = ['list', 'board'] as const,
  themes = ['dark', 'light'] as const,
  densities = ['auto', 'compact', 'comfortable'] as const;
type Preferences = {
  view: (typeof views)[number];
  theme: (typeof themes)[number];
  density: (typeof densities)[number];
  setDensity: (density: (typeof densities)[number]) => void;
  sidebarOpen: boolean;
  setView: (view: (typeof views)[number]) => void;
  setTheme: (theme: (typeof themes)[number]) => void;
  setSidebarOpen: (open: boolean) => void;
  /** Shortcut overrides for this device only; see docs/KEYBOARD-COMMANDS.md. */
  keyBindings: KeyBindingOverrides;
  /** No change when the keys are invalid, reserved or taken by another command. */
  setKeyBinding: (commandId: string, keys: readonly string[]) => void;
  resetKeyBinding: (commandId: string) => void;
  resetKeyBindings: () => void;
};
const storedChoice = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      view: 'list',
      theme: 'dark',
      density: 'auto',
      setDensity: (density) => set({ density }),
      sidebarOpen: false,
      setView: (view) => set({ view }),
      setTheme: (theme) => set({ theme }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      keyBindings: {},
      setKeyBinding: (commandId, keys) =>
        set((s) => {
          const wanted = { ...s.keyBindings, [commandId]: keys },
            kept = sanitizeKeyBindings(wanted, workspaceCommands, platform);
          // Sanitising alone would let catalog order evict an existing override instead.
          return Object.keys(kept).length === Object.keys(wanted).length
            ? { keyBindings: kept }
            : s;
        }),
      resetKeyBinding: (commandId) =>
        set((s) => ({
          keyBindings: Object.fromEntries(
            Object.entries(s.keyBindings).filter(([id]) => id !== commandId),
          ),
        })),
      resetKeyBindings: () => set({ keyBindings: {} }),
    }),
    {
      name: 'tickets-ui',
      // The global rather than zustand's default `window.localStorage`, so Bun tests can supply one.
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: migratePreferences,
      // Storage is untrusted: only known fields with valid values replace the defaults.
      merge: (persisted, current) => {
        const state: Record<string, unknown> =
          typeof persisted === 'object' && persisted !== null ? { ...persisted } : {};
        return {
          ...current,
          view: storedChoice(views, state.view, current.view),
          theme: storedChoice(themes, state.theme, current.theme),
          density: storedChoice(densities, state.density, current.density),
          keyBindings: sanitizeKeyBindings(state.keyBindings, workspaceCommands, platform),
        };
      },
      partialize: (s) => ({
        view: s.view,
        theme: s.theme,
        density: s.density,
        keyBindings: s.keyBindings,
      }),
    },
  ),
);
