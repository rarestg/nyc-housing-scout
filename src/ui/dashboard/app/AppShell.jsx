import { useCallback } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { DetailPane } from '../components/DetailPane.jsx';
import { useDashboardShell } from './shell-context.jsx';

const NAV_ITEMS = [
  {
    label: 'Listings',
    to: '/listings',
  },
  {
    label: 'Posts',
    to: '/posts',
  },
  {
    label: 'Review',
    to: '/review',
  },
  {
    label: 'Debug',
    to: '/debug',
  },
];

export function AppShell() {
  const { shellState } = useDashboardShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailOpen = searchParams.get('detail') !== 'closed';

  const closeDetail = useCallback(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('detail', 'closed');

    setSearchParams(nextSearchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <div
      className={[
        'dashboard-shell',
        detailOpen ? 'dashboard-shell-detail-open' : 'dashboard-shell-detail-closed',
      ].filter(Boolean).join(' ')}
    >
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-row">
          <div className="dashboard-topbar-brand">
            <span className="dashboard-topbar-title">Housing Scout</span>
            <span className="dashboard-topbar-copy">Cross-group operator view</span>
          </div>
          <nav aria-label="Primary" className="dashboard-nav-links">
            {NAV_ITEMS.map((item) => (
              <NavLink
                className={({ isActive }) => `dashboard-nav-link ${isActive ? 'is-active' : ''}`}
                key={item.to}
                to={item.to}
              >
                <span className="dashboard-nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <a className="shell-button shell-button-quiet dashboard-topbar-action" href="/inspector">
            Inspector
          </a>
        </div>
      </header>

      <div className="dashboard-workspace">
        <div className="dashboard-main-column">
          <header className="dashboard-header">
            <div className="dashboard-header-main">
              <div className="dashboard-header-title-row">
                {shellState.eyebrow ? <p className="dashboard-kicker">{shellState.eyebrow}</p> : null}
                <h2>{shellState.title}</h2>
              </div>
              {shellState.description ? (
                <p className="dashboard-description">{shellState.description}</p>
              ) : null}
            </div>
          </header>

          {shellState.toolbar ? (
            <section className="dashboard-toolbar" aria-label="Route filters">
              {shellState.toolbar}
            </section>
          ) : null}

          <main className="dashboard-outlet">
            <Outlet />
          </main>
        </div>

        <DetailPane
          actions={shellState.detailActions}
          emptyMessage={shellState.detailEmptyMessage}
          emptyTitle={shellState.detailEmptyTitle}
          id="dashboard-detail-pane"
          isOpen={detailOpen}
          meta={shellState.detailMeta}
          onClose={closeDetail}
          title={shellState.detailTitle}
        >
          {shellState.detailContent}
        </DetailPane>
      </div>
    </div>
  );
}
