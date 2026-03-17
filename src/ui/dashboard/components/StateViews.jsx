export function LoadingState({ title = 'Loading', message = 'Pulling the latest dashboard rows.' }) {
  return (
    <section className="state-card" aria-live="polite">
      <div className="state-card-mark state-card-mark-loading" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

export function EmptyState({ title = 'Nothing to show', message = 'Try widening the filters.' }) {
  return (
    <section className="state-card">
      <div className="state-card-mark state-card-mark-empty" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

export function ErrorState({ title = 'Could not load this surface', message = 'Check the API contract or try refreshing.' }) {
  return (
    <section className="state-card state-card-error" role="alert">
      <div className="state-card-mark state-card-mark-error" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}
