import { create } from 'zustand';
import type { Category, CreateCategoryInput, UpdateCategoryInput } from '@claude-code-webui/shared';
import { api, ApiError } from '@/services/api';

interface CategoryApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

interface CategoryState {
  categories: Category[];
  loading: boolean;
  error: string | null;

  fetchCategories: () => Promise<void>;
  createCategory: (input: CreateCategoryInput) => Promise<Category | null>;
  updateCategory: (id: string, input: UpdateCategoryInput) => Promise<Category | null>;
  deleteCategory: (id: string) => Promise<boolean>;
  reorderCategories: (categoryIds: string[]) => Promise<void>;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message;
  return fallback;
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  loading: false,
  error: null,

  fetchCategories: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.get<CategoryApiResponse<Category[]>>('/api/categories');
      const list = res.data.data ?? [];
      set({ categories: list, loading: false });
    } catch (err) {
      set({ error: errorMessage(err, 'Failed to fetch categories'), loading: false });
    }
  },

  createCategory: async (input) => {
    try {
      const res = await api.post<CategoryApiResponse<Category>>('/api/categories', input);
      const created = res.data.data;
      if (!created) throw new Error('Empty response');
      set({
        categories: [...get().categories, created].sort((a, b) => a.sort_order - b.sort_order),
      });
      return created;
    } catch (err) {
      set({ error: errorMessage(err, 'Failed to create category') });
      return null;
    }
  },

  updateCategory: async (id, input) => {
    try {
      const res = await api.patch<CategoryApiResponse<Category>>(`/api/categories/${id}`, input);
      const updated = res.data.data;
      if (!updated) throw new Error('Empty response');
      set({
        categories: get()
          .categories.map((c) => (c.id === id ? updated : c))
          .sort((a, b) => a.sort_order - b.sort_order),
      });
      return updated;
    } catch (err) {
      set({ error: errorMessage(err, 'Failed to update category') });
      return null;
    }
  },

  deleteCategory: async (id) => {
    try {
      await api.delete(`/api/categories/${id}`);
      set({ categories: get().categories.filter((c) => c.id !== id) });
      return true;
    } catch (err) {
      set({ error: errorMessage(err, 'Failed to delete category') });
      return false;
    }
  },

  reorderCategories: async (categoryIds) => {
    try {
      const res = await api.post<CategoryApiResponse<Category[]>>('/api/categories/reorder', {
        categoryIds,
      });
      set({ categories: res.data.data ?? [] });
    } catch (err) {
      set({ error: errorMessage(err, 'Failed to reorder categories') });
    }
  },
}));
