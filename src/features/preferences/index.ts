import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
type Preferences = {
  view: 'list' | 'board';
  theme: 'dark' | 'light';
  sidebarOpen: boolean;
  setView: (view: 'list' | 'board') => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setSidebarOpen: (open: boolean) => void;
};
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      view: 'list',
      theme: 'dark',
      sidebarOpen: false,
      setView: (view) => set({ view }),
      setTheme: (theme) => set({ theme }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: 'tickets-ui',
      partialize: (s) => ({ view: s.view, theme: s.theme }),
      storage: createJSONStorage(() => ({
        getItem: (key) => {
          try {
            return localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            /* Preferences remain in memory; navigation must not throw. */
          }
        },
        removeItem: (key) => {
          try {
            localStorage.removeItem(key);
          } catch {}
        },
      })),
    },
  ),
);
