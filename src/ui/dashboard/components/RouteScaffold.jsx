export function RouteScaffold({ children, footer = null }) {
  return (
    <section className="route-scaffold">
      <div className="route-surface">
        {children}
      </div>
      {footer ? <p className="route-footer">{footer}</p> : null}
    </section>
  );
}
