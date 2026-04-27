import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DockablePanel = 'files' | 'tasks' | 'config' | 'tools';

interface PanelDockState {
  pinned: Record<DockablePanel, boolean>;
  togglePin: (panel: DockablePanel) => void;
  setPinned: (panel: DockablePanel, pinned: boolean) => void;
  unpinAll: () => void;
}

export const usePanelDockStore = create<PanelDockState>()(
  persist(
    (set) => ({
      pinned: { files: false, tasks: false, config: false, tools: false },
      togglePin: (panel) =>
        set((state) => ({
          pinned: { ...state.pinned, [panel]: !state.pinned[panel] },
        })),
      setPinned: (panel, pinned) =>
        set((state) => ({
          pinned: { ...state.pinned, [panel]: pinned },
        })),
      unpinAll: () =>
        set({ pinned: { files: false, tasks: false, config: false, tools: false } }),
    }),
    {
      name: 'claude-webui-panel-dock',
    }
  )
);
