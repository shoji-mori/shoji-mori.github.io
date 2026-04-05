type PresentationDateRange = {
  startDate: string | null;
  endDate: string | null;
};

function pad(value: number | string) {
  return String(value).padStart(2, "0");
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDate(year: string, month: string, day: string) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function splitIsoDate(value: string) {
  const [year, month, day] = value.split("-");
  return { year, month, day };
}

export function formatPresentationDateText(startDate: string, endDate: string) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new Error("Expected ISO date values.");
  }

  const start = splitIsoDate(startDate);
  const end = splitIsoDate(endDate);

  if (startDate === endDate) {
    return `${start.year}/${start.month}/${start.day}`;
  }

  if (start.year === end.year && start.month === end.month) {
    return `${start.year}/${start.month}/${start.day}-${end.day}`;
  }

  if (start.year === end.year) {
    return `${start.year}/${start.month}/${start.day}-${end.month}/${end.day}`;
  }

  return `${start.year}/${start.month}/${start.day}-${end.year}/${end.month}/${end.day}`;
}

export function parsePresentationDateText(dateText?: string | null): PresentationDateRange {
  const cleaned = String(dateText ?? "").replace(/\s+/g, "");
  if (!cleaned) {
    return { startDate: null, endDate: null };
  }

  let match = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const startDate = toIsoDate(match[1], match[2], match[3]);
    return { startDate, endDate: startDate };
  }

  match = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return {
      startDate: toIsoDate(match[1], match[2], match[3]),
      endDate: toIsoDate(match[1], match[2], match[4]),
    };
  }

  match = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    return {
      startDate: toIsoDate(match[1], match[2], match[3]),
      endDate: toIsoDate(match[1], match[4], match[5]),
    };
  }

  match = cleaned.match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})-(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
  );
  if (match) {
    return {
      startDate: toIsoDate(match[1], match[2], match[3]),
      endDate: toIsoDate(match[4], match[5], match[6]),
    };
  }

  return { startDate: null, endDate: null };
}

export function isValidIsoDate(value: string) {
  if (!isIsoDate(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
