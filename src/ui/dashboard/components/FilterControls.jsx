export function FilterBar({ children }) {
  return (
    <div aria-label="Filters" className="filter-bar" role="group">
      {children}
    </div>
  );
}

export function FilterField({ children, grow = false, label }) {
  return (
    <label className={`filter-field ${grow ? 'filter-field-grow' : ''}`}>
      <span className="filter-field-label">{label}</span>
      {children}
    </label>
  );
}

export function FilterInput(props) {
  return <input {...props} className={`dashboard-control ${props.className || ''}`.trim()} />;
}

export function FilterSelect(props) {
  return <select {...props} className={`dashboard-control ${props.className || ''}`.trim()} />;
}

export function FilterToggle({ checked, label, onChange }) {
  return (
    <label className="filter-toggle">
      <input
        checked={checked}
        className="filter-toggle-input"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="filter-toggle-label">{label}</span>
    </label>
  );
}
