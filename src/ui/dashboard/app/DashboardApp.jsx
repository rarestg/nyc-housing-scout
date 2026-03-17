import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.jsx';
import { DebugRoute } from '../routes/debug/DebugRoute.jsx';
import { ListingsRoute } from '../routes/listings/ListingsRoute.jsx';
import { PostsRoute } from '../routes/posts/PostsRoute.jsx';
import { ReviewRoute } from '../routes/review/ReviewRoute.jsx';
import { DashboardShellProvider } from './shell-context.jsx';

export function DashboardApp() {
  return (
    <BrowserRouter>
      <DashboardShellProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route element={<Navigate replace to="/listings" />} index />
            <Route element={<ListingsRoute />} path="/listings" />
            <Route element={<PostsRoute />} path="/posts" />
            <Route element={<ReviewRoute />} path="/review" />
            <Route element={<DebugRoute />} path="/debug" />
            <Route element={<DebugRoute />} path="/debug/runs/:runId" />
            <Route element={<Navigate replace to="/listings" />} path="*" />
          </Route>
        </Routes>
      </DashboardShellProvider>
    </BrowserRouter>
  );
}
