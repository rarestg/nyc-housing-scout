import { useEffect, useMemo, useState } from "react";

const DASHBOARD_SOURCES_URL = "/api/sources?limit=100";

export const POSTED_WITHIN_OPTIONS = Object.freeze([
  { label: "Any time", value: "" },
  { label: "Last 6 hours", value: "6" },
  { label: "Last 24 hours", value: "24" },
  { label: "Last 72 hours", value: "72" },
  { label: "Last 7 days", value: "168" },
]);

export function useJsonResource(url) {
  const [state, setState] = useState({
    data: null,
    error: null,
    isLoading: Boolean(url),
  });

  useEffect(() => {
    if (!url) {
      setState({
        data: null,
        error: null,
        isLoading: false,
      });
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;

    setState((currentState) => ({
      data: currentState.data,
      error: null,
      isLoading: true,
    }));

    requestJson(url, {
      signal: controller.signal,
    })
      .then((data) => {
        if (cancelled) {
          return;
        }

        setState({
          data,
          error: null,
          isLoading: false,
        });
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") {
          return;
        }

        setState((currentState) => ({
          data: currentState.data,
          error,
          isLoading: false,
        }));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  return state;
}

export function buildApiUrl(path, params) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === "" || value === null || value === undefined) {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export async function requestJson(url, options = {}) {
  const headers = {
    accept: "application/json",
    ...(options.headers || {}),
  };

  if (options.body !== undefined && !("content-type" in lowerCaseHeaders(headers))) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function buildSourceOptions(items = []) {
  return items.map((source) => ({
    label: source.displayName || source.sourceKey,
    value: source.sourceKey,
  }));
}

export function useDashboardSourceOptions() {
  const sourcesState = useJsonResource(DASHBOARD_SOURCES_URL);
  const sourceOptions = useMemo(
    () => buildSourceOptions(sourcesState.data?.items || []),
    [sourcesState.data],
  );

  return {
    sourceOptions,
    sourcesState,
  };
}

export function buildInspectorHref(runId, tab = "") {
  const searchParams = new URLSearchParams();
  searchParams.set("run", runId);

  if (tab && tab !== "summary") {
    searchParams.set("tab", tab);
  }

  return `/inspector#${searchParams.toString()}`;
}

async function parseApiError(response) {
  const payload = await response.json().catch(() => ({}));
  return payload.error || `Request failed with status ${response.status}`;
}

function lowerCaseHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]),
  );
}
