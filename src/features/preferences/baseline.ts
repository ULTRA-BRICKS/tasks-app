import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
    { name: 'tickets-ui', partialize: (s) => ({ view: s.view, theme: s.theme }) },
  ),
);
