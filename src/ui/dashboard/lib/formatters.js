const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto',
});

const ABSOLUTE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const ROOM_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

export function formatRelativeTime(value, options = {}) {
  const date = toDate(value);
  const now = toDate(options.now || new Date());

  if (!date || !now) {
    return 'Unknown time';
  }

  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absoluteSeconds = Math.abs(seconds);

  if (absoluteSeconds < 45) {
    return seconds >= 0 ? 'in moments' : 'just now';
  }

  if (absoluteSeconds < 3600) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(seconds / 60), 'minute');
  }

  if (absoluteSeconds < 86400) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(seconds / 3600), 'hour');
  }

  if (absoluteSeconds < 604800) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(seconds / 86400), 'day');
  }

  return formatAbsoluteTime(date);
}

export function formatAbsoluteTime(value) {
  const date = toDate(value);

  if (!date) {
    return 'Unknown time';
  }

  return ABSOLUTE_TIME_FORMATTER.format(date);
}

export function formatPrice(amount, options = {}) {
  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return 'Unpriced';
  }

  const period = normalizePeriod(options.period);
  const currencyText = CURRENCY_FORMATTER.format(value);

  if (!period) {
    return currencyText;
  }

  return `${currencyText}/${period}`;
}

export function formatCount(value, singular, plural = defaultPlural(singular)) {
  const count = Number(value);

  if (!Number.isFinite(count)) {
    return `0 ${plural}`;
  }

  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatCompactCount(value) {
  const count = Number(value);

  if (!Number.isFinite(count)) {
    return '0';
  }

  return COMPACT_NUMBER_FORMATTER.format(count);
}

export function formatConfidence(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 'Unknown';
  }

  return `${Math.round(numericValue * 100)}%`;
}

export function formatRoomCount(value, label) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return `No ${label} data`;
  }

  return `${ROOM_NUMBER_FORMATTER.format(numericValue)} ${label}`;
}

export function formatLabel(value) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return 'Unknown';
  }

  return normalized
    .split(/[_-]+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const normalized = String(value || '').trim();

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function normalizePeriod(value) {
  const normalized = String(value || '').trim().toLowerCase();

  switch (normalized) {
    case 'month':
    case 'monthly':
    case 'mo':
      return 'mo';
    case 'week':
    case 'weekly':
    case 'wk':
      return 'wk';
    case 'day':
    case 'daily':
      return 'day';
    case 'year':
    case 'yearly':
      return 'yr';
    default:
      return normalized || '';
  }
}

function defaultPlural(value) {
  if (value.endsWith('y')) {
    return `${value.slice(0, -1)}ies`;
  }

  return `${value}s`;
}
