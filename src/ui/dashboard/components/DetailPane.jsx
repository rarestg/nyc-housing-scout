import { useEffect } from 'react';
import { EmptyState } from './StateViews.jsx';

export function DetailPane({
  actions = null,
  children,
  emptyMessage,
  emptyTitle,
  id,
  isOpen,
  meta = null,
  onClose,
  title,
}) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      onClose?.();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <aside
      aria-hidden={!isOpen}
      className={`detail-pane ${isOpen ? 'detail-pane-open' : 'detail-pane-closed'}`}
      id={id}
      inert={!isOpen}
    >
      <div className="detail-pane-header">
        <button
          aria-controls={id}
          aria-expanded={isOpen}
          aria-label="Close detail pane"
          className="shell-button shell-button-quiet detail-pane-close"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
        <div className="detail-pane-header-main">
          <h2>{title}</h2>
          {meta ? <div className="detail-pane-meta">{meta}</div> : null}
        </div>
      </div>
      <div className="detail-pane-body">
        {actions ? <div className="detail-pane-actions">{actions}</div> : null}
        {children || <EmptyState message={emptyMessage} title={emptyTitle} />}
      </div>
    </aside>
  );
}
