import { useQuery } from '@tanstack/react-query';
import type {
  Actor,
  Catalog,
  Project,
  Cycle,
  Milestone,
  Notification,
  SavedView,
} from '@tickets/contracts';
import { api } from '@/shared/api/client';
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<Actor>('/v1/me'),
    retry: false,
    staleTime: 60000,
  });
export const useCatalog = () =>
  useQuery({
    queryKey: ['catalog'],
    queryFn: () => api<Catalog>('/v1/catalog'),
    staleTime: 30000,
    refetchInterval: (query) => (query.state.status === 'success' ? 30000 : false),
    refetchIntervalInBackground: false,
  });
export const useProjects = (enabled = true) =>
  useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/v1/projects'), enabled });
export const useCycles = (enabled = true) =>
  useQuery({ queryKey: ['cycles'], queryFn: () => api<Cycle[]>('/v1/cycles'), enabled });
export const useMilestones = (enabled = true) =>
  useQuery({
    queryKey: ['milestones'],
    queryFn: () => api<Milestone[]>('/v1/milestones'),
    enabled,
  });
export const useNotifications = (enabled = true) =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/v1/notifications'),
    enabled,
  });
export const useViews = (enabled = true) =>
  useQuery({ queryKey: ['views'], queryFn: () => api<SavedView[]>('/v1/views'), enabled });
export function moduleEnabled(catalog: Catalog | undefined, id: string) {
  return catalog?.modules.some((m) => m.id === id && m.enabled) ?? false;
}
export { PersonChip } from './person-chip';
