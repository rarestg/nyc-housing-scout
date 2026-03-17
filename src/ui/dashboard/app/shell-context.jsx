import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

const DEFAULT_SHELL_STATE = {
  description: 'Newest cross-group housing activity, evidence, and review context.',
  detailActions: null,
  detailContent: null,
  detailEmptyMessage: 'Select a row to inspect the supporting detail and provenance.',
  detailEmptyTitle: 'Nothing selected',
  detailMeta: null,
  detailTitle: 'Detail',
  eyebrow: 'Cross-group dashboard',
  title: 'Listings',
  toolbar: null,
};

const DashboardShellContext = createContext(null);

export function DashboardShellProvider({ children }) {
  const [shellState, setShellStateState] = useState(DEFAULT_SHELL_STATE);

  const setShellState = useCallback((nextState = {}) => {
    setShellStateState({
      ...DEFAULT_SHELL_STATE,
      ...nextState,
    });
  }, []);

  const contextValue = useMemo(() => ({
    setShellState,
    shellState,
  }), [setShellState, shellState]);

  return (
    <DashboardShellContext.Provider value={contextValue}>
      {children}
    </DashboardShellContext.Provider>
  );
}

export function useDashboardShell() {
  const contextValue = useContext(DashboardShellContext);

  if (!contextValue) {
    throw new Error('useDashboardShell must be used inside DashboardShellProvider.');
  }

  return contextValue;
}

export function useDashboardShellSlots(nextState) {
  const { setShellState } = useDashboardShell();

  useLayoutEffect(() => {
    setShellState(nextState);

    return () => {
      setShellState();
    };
  }, [nextState, setShellState]);
}
