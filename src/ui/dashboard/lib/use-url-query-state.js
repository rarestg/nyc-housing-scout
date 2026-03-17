import { startTransition, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { patchQueryState, readQueryState } from './query-state.js';

export function useUrlQueryState(schema) {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readQueryState(searchParams, schema);

  const updateQueryState = useCallback((patch, options = {}) => {
    const replace = options.replace ?? true;
    const nextSearchParams = patchQueryState(searchParams, patch, schema);

    startTransition(() => {
      setSearchParams(nextSearchParams, { replace });
    });
  }, [schema, searchParams, setSearchParams]);

  return [state, updateQueryState, searchParams];
}
