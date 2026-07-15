import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clampSidebarWidth,
  createDefaultWorkspaceLayoutState,
  SIDEBAR_WIDTH_DEFAULT,
  type FlyoffApi,
  type WorkspaceLayoutState,
} from '../../../shared/contracts';

const SAVE_DELAY_MS = 200;

function getApi(): Partial<FlyoffApi> {
  return window.flyoff as Partial<FlyoffApi>;
}

export interface WorkspaceLayoutControls {
  collapsed: boolean;
  sidebarWidth: number;
  railViewId: string;
  ready: boolean;
  toggleCollapsed: () => void;
  setSidebarWidth: (width: number) => void;
  resetSidebarWidth: () => void;
  setRailViewId: (railViewId: string) => void;
}

export function useWorkspaceLayout(): WorkspaceLayoutControls {
  const [layout, setLayout] = useState<WorkspaceLayoutState>(
    createDefaultWorkspaceLayoutState,
  );
  const [ready, setReady] = useState(false);
  const layoutRef = useRef(layout);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    void getApi()
      .getUiState?.()
      .then((state) => {
        if (active && state) {
          layoutRef.current = state;
          setLayout(state);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    },
    [],
  );

  const apply = useCallback((change: Partial<WorkspaceLayoutState>) => {
    const next = { ...layoutRef.current, ...change };
    layoutRef.current = next;
    setLayout(next);

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void getApi()
        .saveUiState?.(next)
        .catch(() => undefined);
    }, SAVE_DELAY_MS);
  }, []);

  const toggleCollapsed = useCallback(() => {
    apply({ sidebarCollapsed: !layoutRef.current.sidebarCollapsed });
  }, [apply]);

  const setSidebarWidth = useCallback(
    (width: number) => {
      const clamped = clampSidebarWidth(width);
      if (clamped !== layoutRef.current.sidebarWidth) {
        apply({ sidebarWidth: clamped });
      }
    },
    [apply],
  );

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  }, [setSidebarWidth]);

  const setRailViewId = useCallback(
    (railViewId: string) => {
      if (railViewId !== layoutRef.current.railViewId) {
        apply({ railViewId });
      }
    },
    [apply],
  );

  return {
    collapsed: layout.sidebarCollapsed,
    sidebarWidth: layout.sidebarWidth,
    railViewId: layout.railViewId,
    ready,
    toggleCollapsed,
    setSidebarWidth,
    resetSidebarWidth,
    setRailViewId,
  };
}
