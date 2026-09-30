export interface ToolResponse {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export function okResponse(value: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function errorResponse(error: unknown): ToolResponse {
  return { content: [{ type: 'text', text: (error as Error).message }], isError: true };
}
