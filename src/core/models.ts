import { PublicError } from './errors';
import { baseUrlIssues, type ModelList, type ModelListRequest } from './types';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Request = Required<Pick<ModelListRequest, 'baseUrl' | 'protocol' | 'claudeAuth'>> & Pick<ModelListRequest, 'app' | 'apiKey'>;
const RESPONSE_LIMIT = 4 * 1024 * 1024;

// OpenAI- and Anthropic-style APIs both list models under /v1/models (or /models after a version segment). Vendors
// that expose Claude Code under a compatibility path such as /anthropic usually list models only on their root.
export function modelListUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const versioned = /\/v\d+$/.test(base);
  const urls = [versioned ? `${base}/models` : `${base}/v1/models`];
  const root = base.replace(/\/(api\/anthropic|apps\/anthropic|anthropic|claudecode|claude)$/i, '');
  if (root !== base) urls.push(`${root}/v1/models`);
  if (!versioned) urls.push(`${base}/models`);
  return [...new Set(urls)];
}
// Sends the key the way the target CLI would: Claude Code uses one of the two headers, Pi sends both for Anthropic.
function headers(request: Request, key: string): Record<string, string> {
  const anthropic = request.protocol === 'anthropic-messages';
  const bearer = !anthropic || request.app === 'pi' || request.claudeAuth === 'bearer';
  const apiKey = anthropic && (request.app === 'pi' || request.claudeAuth === 'api-key');
  return { accept: 'application/json', ...(bearer ? { authorization: `Bearer ${key}` } : {}), ...(apiKey ? { 'x-api-key': key } : {}), ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}) };
}
async function readLimited(response: Response): Promise<string | null> {
  if (Number(response.headers.get('content-length') ?? 0) > RESPONSE_LIMIT || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RESPONSE_LIMIT) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
// `data: [{id}]` (OpenAI, Anthropic), `models: [{id|name} | string]` (some gateways), or a bare array.
export function modelIds(body: unknown): string[] {
  const object = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const list = Array.isArray(body) ? body : Array.isArray(object.data) ? object.data : Array.isArray(object.models) ? object.models : [];
  const ids = list.map(item => typeof item === 'string' ? item : item && typeof item === 'object' ? (item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name : undefined)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0 && id.length <= 200 && !/\s/.test(id.trim()))
    .map(id => id.trim());
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 5000);
}
// Messages are static apart from the HTTP status; response bodies are never echoed because they may quote the key.
export async function fetchModelList(request: Request, fetchImpl: Fetch = fetch): Promise<ModelList> {
  const issue = baseUrlIssues(request.baseUrl)[0];
  if (issue) throw new PublicError(issue);
  const key = request.apiKey?.trim();
  if (!key) throw new PublicError('需要 API Key 才能获取模型列表');
  let failure = '无法获取模型列表';
  for (const url of modelListUrls(request.baseUrl)) {
    let response: Response;
    // Redirects are not followed: a custom key header would otherwise travel to wherever the redirect points.
    try { response = await fetchImpl(url, { headers: headers(request, key), redirect: 'manual', signal: AbortSignal.timeout(10_000) }); }
    catch { failure = '无法连接该地址，或请求超时'; continue; }
    if (response.status >= 300 && response.status < 400) { failure = `获取模型列表失败：HTTP ${response.status}（不跟随重定向）`; continue; }
    if (!response.ok) {
      failure = `获取模型列表失败：HTTP ${response.status}`;
      if (response.status === 401 || response.status === 403) break;
      continue;
    }
    const text = await readLimited(response).catch(() => null);
    let models: string[] = [];
    try { models = text === null ? [] : modelIds(JSON.parse(text)); } catch { /* not JSON */ }
    if (models.length) return { models, url };
    failure = '响应中没有可用的模型列表';
  }
  throw new PublicError(failure);
}
