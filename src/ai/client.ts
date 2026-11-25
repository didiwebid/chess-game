import type { ChatMessage, PlayerConfig } from '../types/chess';

// -- Dynamic local URL proxy --
// When the base URL points to a local address (localhost, private IPs), the
// browser blocks the request due to CORS. We rewrite the URL to go through
// Vite's /proxy-redirect middleware, which forwards it server-side.

const PROXY_PREFIX = '/proxy-redirect';
const TARGET_HEADER = 'x-proxy-target';

// Matches localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 0.0.0.0
const LOCAL_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0)$/;

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return LOCAL_HOST_RE.test(hostname);
  } catch {
    return false;
  }
}

/**
 * If `baseUrl` is a local address, rewrite it to go through Vite's dynamic
 * proxy so the browser never sees a cross-origin request.
 *
 *   http://localhost:8000/v1/chat/completions
 *   → /proxy-redirect/chat/completions  (header: x-proxy-target: http://localhost:8000/v1)
 */
function maybeRewriteForProxy(baseUrl: string): {
  url: string;
  proxyHeaders: Record<string, string>;
} {
  if (!isLocalUrl(baseUrl)) {
    return { url: baseUrl, proxyHeaders: {} };
  }

  const base = new URL(baseUrl);
  // Preserve the target's pathname (e.g. /v1) so it's prepended to endpoints
  const target = base.origin + base.pathname.replace(/\/+$/, '');
  return {
    url: PROXY_PREFIX,
    proxyHeaders: { [TARGET_HEADER]: target },
  };
}

function buildFetchUrl(baseUrl: string, endpointPath: string): {
  url: string;
  proxyHeaders: Record<string, string>;
} {
  const { url: base, proxyHeaders } = maybeRewriteForProxy(baseUrl);

  if (proxyHeaders[TARGET_HEADER]) {
    // We're using the proxy — append the endpoint path to the proxy prefix
    return {
      url: base + endpointPath,
      proxyHeaders,
    };
  }

  // Normal remote URL — build the full URL the usual way
  const baseStr = baseUrl.trim().replace(/\/+$/, '');
  return {
    url: baseStr + endpointPath,
    proxyHeaders: {},
  };
}

interface ChatDelta {
  content: string;
  reasoning: string;
}

interface ChatResult {
  content: string;
  reasoning: string;
  model?: string;
  finishReason?: string;
}

interface ChatOptions {
  config: PlayerConfig;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (data: ChatDelta) => void;
}

export class AiRequestError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'AiRequestError';
    this.status = status;
    this.retryable = retryable;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (error instanceof Error && error.name === 'AbortError');
}

function chatEndpoint(baseUrl: string): {
  url: string;
  proxyHeaders: Record<string, string>;
} {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) throw new AiRequestError('Add an API base URL first.');
  if (base.endsWith('/chat/completions')) {
    return buildFetchUrl(base.replace(/\/chat\/completions$/, ''), '');
  }
  return buildFetchUrl(base, '/chat/completions');
}

function modelsEndpoint(baseUrl: string): {
  url: string;
  proxyHeaders: Record<string, string>;
} {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) {
    return buildFetchUrl(base.replace(/\/chat\/completions$/, ''), '/models');
  }
  return buildFetchUrl(base, '/models');
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey.trim()
    ? { Authorization: `Bearer ${apiKey.trim()}` }
    : {};
}

function extractErrorMessage(raw: string): string {
  if (!raw) return 'The provider returned an empty error.';
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    // Use raw text below.
  }
  return raw.slice(0, 400);
}

async function readErrorMessage(response: Response): Promise<string> {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    // No body.
  }
  return extractErrorMessage(raw);
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string } | string;
}

interface ChatCompletionMessage {
  content?:
    | string
    | Array<{ type?: string; text?: string }>
    | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
}

interface ChatCompletionPayload {
  choices?: Array<{
    message?: ChatCompletionMessage;
    finish_reason?: string | null;
  }>;
  error?: { message?: string } | string;
  model?: string;
}

function contentFromMessage(message: ChatCompletionMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function parseDelta(raw: string): {
  content: string;
  reasoning: string;
  finishReason?: string;
  done: boolean;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === '[DONE]') {
    return { content: '', reasoning: '', done: true };
  }
  try {
    const payload = JSON.parse(trimmed) as ChatCompletionChunk;
    if (payload.error) {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : payload.error.message || 'The provider returned an error.';
      throw new AiRequestError(message);
    }
    const choice = payload.choices?.[0];
    const delta = choice?.delta;
    return {
      content: typeof delta?.content === 'string' ? delta.content : '',
      reasoning:
        typeof delta?.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta?.reasoning === 'string'
            ? delta.reasoning
            : '',
      finishReason: choice?.finish_reason ?? undefined,
      done: false,
    };
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    // Keep-alive comments or provider-specific metadata can be ignored.
    return null;
  }
}

function createRequestSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
    timedOut: () => timedOut,
  };
}

export async function requestChatCompletion({
  config,
  messages,
  signal,
  onDelta,
}: ChatOptions): Promise<ChatResult> {
  const { url: endpoint, proxyHeaders } = chatEndpoint(config.baseUrl);
  if (!config.model.trim()) {
    throw new AiRequestError('Add a model name first.');
  }

  const timeout = createRequestSignal(config.timeoutMs, signal);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: config.stream ? 'text/event-stream' : 'application/json',
        ...authHeaders(config.apiKey),
        ...proxyHeaders,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: config.stream,
      }),
      signal: timeout.signal,
    });
  } catch (error) {
    timeout.cleanup();
    if (signal?.aborted) throw error;
    if (timeout.timedOut()) {
      throw new AiRequestError(
        `The provider did not respond within ${Math.round(config.timeoutMs / 1000)}s.`,
        undefined,
        true,
      );
    }
    throw new AiRequestError(
      error instanceof Error
        ? `Could not reach the AI endpoint: ${error.message}`
        : 'Could not reach the AI endpoint.',
      undefined,
      true,
    );
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    timeout.cleanup();
    throw new AiRequestError(
      `Provider error ${response.status}: ${message}`,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }

  if (!config.stream) {
    try {
      const payload = (await response.json()) as ChatCompletionPayload;
      if (payload.error) {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : payload.error.message || 'The provider returned an error.';
        throw new AiRequestError(message);
      }
      const choice = payload.choices?.[0];
      const message = choice?.message;
      const content = contentFromMessage(message);
      const reasoning =
        message?.reasoning_content || message?.reasoning || '';
      onDelta?.({ content, reasoning });
      return {
        content,
        reasoning,
        model: payload.model,
        finishReason: choice?.finish_reason ?? undefined,
      };
    } catch (error) {
      if (error instanceof AiRequestError) throw error;
      throw new AiRequestError(
        'The provider returned a response that was not valid JSON.',
      );
    } finally {
      timeout.cleanup();
    }
  }

  if (!response.body) {
    timeout.cleanup();
    throw new AiRequestError('The provider sent an empty streaming response.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason: string | undefined;
  let done = false;

  const processEvent = (event: string) => {
    if (done) return;
    const lines = event.split('\n');
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    const parsed = parseDelta(data);
    if (!parsed) return;
    if (parsed.done) {
      done = true;
      return;
    }
    if (parsed.content) content += parsed.content;
    if (parsed.reasoning) reasoning += parsed.reasoning;
    if (parsed.finishReason) finishReason = parsed.finishReason;
    if (parsed.content || parsed.reasoning) {
      onDelta?.({ content, reasoning });
    }
  };

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim() === '') {
          // The common OpenAI event stream has no blank line between data
          // chunks in some compatible implementations; process each line.
        } else if (line.startsWith('data:')) {
          processEvent(line);
        } else if (line.startsWith('event:') || line.startsWith(':')) {
          // Event metadata/keep-alive.
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const remainder = buffer.trim();
    if (remainder && !done) {
      if (remainder.startsWith('data:')) processEvent(remainder);
      else {
        try {
          const payload = JSON.parse(remainder) as ChatCompletionPayload;
          const choice = payload.choices?.[0];
          const message = choice?.message;
          const full = contentFromMessage(message);
          if (full) {
            content = full;
            onDelta?.({ content, reasoning });
          }
        } catch {
          // Ignore a trailing non-JSON fragment.
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.timedOut()) {
      throw new AiRequestError(
        `The provider did not finish responding within ${Math.round(config.timeoutMs / 1000)}s.`,
        undefined,
        true,
      );
    }
    throw new AiRequestError(
      error instanceof Error
        ? `The response stream ended unexpectedly: ${error.message}`
        : 'The response stream ended unexpectedly.',
      undefined,
      true,
    );
  } finally {
    timeout.cleanup();
    reader.releaseLock();
  }

  return { content, reasoning, finishReason };
}

async function pingChat(config: PlayerConfig): Promise<void> {
  const { url: endpoint, proxyHeaders } = chatEndpoint(config.baseUrl);
  const timeout = createRequestSignal(Math.min(config.timeoutMs, 15_000));
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(config.apiKey),
        ...proxyHeaders,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        temperature: 0,
        max_tokens: 1,
        stream: false,
      }),
      signal: timeout.signal,
    });
    if (!response.ok) {
      throw new AiRequestError(
        `Provider error ${response.status}: ${await readErrorMessage(response)}`,
        response.status,
      );
    }
  } catch (error) {
    if (timeout.timedOut()) {
      throw new AiRequestError('The connection test timed out.', undefined, true);
    }
    throw error;
  } finally {
    timeout.cleanup();
  }
}

export async function testAiConnection(
  config: PlayerConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (!config.baseUrl.trim()) throw new AiRequestError('Add an API base URL first.');
  if (!config.model.trim()) throw new AiRequestError('Add a model name first.');

  const { url: endpoint, proxyHeaders } = modelsEndpoint(config.baseUrl);
  const timeout = createRequestSignal(15_000, signal);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders(config.apiKey),
        ...proxyHeaders,
      },
      signal: timeout.signal,
    });

    if (response.ok) {
      return 'Connection established. The endpoint is reachable.';
    }

    if (response.status === 404 || response.status === 405) {
      await pingChat(config);
      return 'Connection established with a minimal chat request.';
    }

    throw new AiRequestError(
      `Provider error ${response.status}: ${await readErrorMessage(response)}`,
      response.status,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.timedOut()) {
      throw new AiRequestError('The connection test timed out.', undefined, true);
    }
    if (
      error instanceof TypeError ||
      (error instanceof Error && /failed to fetch|network/i.test(error.message))
    ) {
      throw new AiRequestError(
        'Could not connect. Check the base URL, CORS policy, and network.',
      );
    }
    throw error;
  } finally {
    timeout.cleanup();
  }
}
