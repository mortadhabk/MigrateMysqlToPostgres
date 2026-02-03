export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

export async function readErrorMessage(response) {
  const contentType = response.headers?.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return (
        data?.error ||
        data?.message ||
        JSON.stringify(data)
      );
    }

    const text = await response.text();
    return text || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
