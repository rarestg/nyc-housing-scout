export function JsonDetails({ summary, value }) {
  if (value === undefined || value === null) {
    return null;
  }

  return (
    <details className="detail-json-panel">
      <summary>{summary}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
