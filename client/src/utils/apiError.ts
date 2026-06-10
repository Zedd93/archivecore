interface ApiErrorDetail {
  field?: string;
  message?: string;
}

function formatDetails(details: unknown): string | null {
  if (!Array.isArray(details) || details.length === 0) return null;

  const messages = details
    .map((detail: ApiErrorDetail | unknown) => {
      if (!detail || typeof detail !== 'object') return null;
      const { field, message } = detail as ApiErrorDetail;
      if (!message) return null;
      return field ? `${field}: ${message}` : message;
    })
    .filter(Boolean)
    .slice(0, 3);

  return messages.length > 0 ? messages.join('; ') : null;
}

function messageFromData(data: any): string | null {
  if (!data) return null;
  if (typeof data === 'string') return data;

  const detailsMessage = formatDetails(data.details);
  if (detailsMessage) return detailsMessage;

  if (data.error && data.error !== 'Validation error') return String(data.error);
  if (data.message) return String(data.message);
  if (data.error) return String(data.error);

  return null;
}

export function getApiErrorMessage(error: any, fallback = 'Wystąpił błąd'): string {
  const data = error?.response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return fallback;

  return messageFromData(data) || error?.message || fallback;
}

export async function getApiErrorMessageAsync(error: any, fallback = 'Wystąpił błąd'): Promise<string> {
  const data = error?.response?.data;

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const text = await data.text();
      if (!text) return fallback;
      try {
        return messageFromData(JSON.parse(text)) || fallback;
      } catch {
        return text;
      }
    } catch {
      return fallback;
    }
  }

  return getApiErrorMessage(error, fallback);
}
