import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';

function getErrorMessage(error: AxiosError<any>): string {
  return error.response?.data?.error || error.message || 'An error occurred';
}

// ─── Generic list hook with filters and pagination ──────
interface ListResponse<T> {
  success: boolean;
  data: T[];
  meta?: { total: number; page: number; limit: number };
}

export function useList<T = any>(
  key: string,
  endpoint: string,
  params?: Record<string, any>,
  options?: Partial<UseQueryOptions<ListResponse<T>>>
) {
  return useQuery<ListResponse<T>>({
    queryKey: [key, params],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params });
      return data as ListResponse<T>;
    },
    ...options,
  });
}

// ─── Generic get-by-id hook ─────────────────────────────
export function useDetail<T = any>(key: string, endpoint: string, id?: string) {
  return useQuery({
    queryKey: [key, id],
    queryFn: async () => {
      const { data } = await api.get(`${endpoint}/${id}`);
      return data.data as T;
    },
    enabled: !!id,
  });
}

// ─── Generic create mutation ────────────────────────────
export function useCreate<T = any>(
  endpoint: string,
  invalidateKeys: string[],
  successMessage?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: any) => {
      const { data } = await api.post(endpoint, payload);
      return data.data as T;
    },
    onSuccess: () => {
      invalidateKeys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
      if (successMessage) toast.success(successMessage);
    },
    onError: (error: AxiosError<any>) => {
      toast.error(getErrorMessage(error));
    },
  });
}

// ─── Generic update mutation ────────────────────────────
export function useUpdate<T = any>(
  endpoint: string,
  invalidateKeys: string[],
  successMessage?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: any) => {
      const { data } = await api.put(`${endpoint}/${id}`, payload);
      return data.data as T;
    },
    onSuccess: () => {
      invalidateKeys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
      if (successMessage) toast.success(successMessage);
    },
    onError: (error: AxiosError<any>) => {
      toast.error(getErrorMessage(error));
    },
  });
}

// ─── Generic patch mutation ─────────────────────────────
export function usePatch<T = any>(
  invalidateKeys: string[],
  successMessage?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ url, ...payload }: { url: string; [key: string]: any }) => {
      const { data } = await api.patch(url, payload);
      return data.data as T;
    },
    onSuccess: () => {
      invalidateKeys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
      if (successMessage) toast.success(successMessage);
    },
    onError: (error: AxiosError<any>) => {
      toast.error(getErrorMessage(error));
    },
  });
}

// ─── Generic delete mutation ────────────────────────────
export function useDelete(
  endpoint: string,
  invalidateKeys: string[],
  successMessage?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${endpoint}/${id}`);
    },
    onSuccess: () => {
      invalidateKeys.forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
      if (successMessage) toast.success(successMessage);
    },
    onError: (error: AxiosError<any>) => {
      toast.error(getErrorMessage(error));
    },
  });
}

// ─── Search hook ────────────────────────────────────────
export function useSearch(query: string, types?: string[]) {
  return useQuery({
    queryKey: ['search', query, types],
    queryFn: async () => {
      const params: any = { q: query };
      if (types?.length) params.types = types.join(',');
      const { data } = await api.get('/search', { params });
      return data.data as { results: any[]; total: number };
    },
    enabled: query.length >= 2,
  });
}

// ─── Dashboard KPIs ─────────────────────────────────────
export function useDashboardKPIs() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/reports/dashboard');
      return data.data;
    },
  });
}
