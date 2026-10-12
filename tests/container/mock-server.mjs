// Minimal upstream API mock. Records every request as JSON lines and answers
// Anthropic Messages, OpenAI Responses and OpenAI Chat Completions, with or
// without streaming. It never validates credentials; the test asserts on the log.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const [port, logPath] = [Number(process.argv[2] ?? 8787), process.argv[3] ?? '/tmp/mock-requests.jsonl'];
const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const [event, data] of events) res.write(event ? `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` : `data: ${data}\n\n`);
  res.end();
};
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
    const url = new URL(req.url, 'http://mock');
    const auth = req.headers.authorization ? `Bearer ${req.headers.authorization.replace(/^Bearer\s+/i, '')}` : undefined;
    appendFileSync(logPath, JSON.stringify({
      method: req.method, path: url.pathname, model: body.model, stream: !!body.stream,
      authorization: auth, xApiKey: req.headers['x-api-key'], userAgent: req.headers['user-agent']
    }) + '\n');
    const model = body.model ?? 'unknown';
    if (url.pathname.endsWith('/messages')) {
      if (!body.stream) return json(res, { id: 'msg_1', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
      return sse(res, [
        ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
        ['message_stop', { type: 'message_stop' }]
      ]);
    }
    if (url.pathname.endsWith('/responses')) {
      const item = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] };
      const response = { id: 'resp_1', object: 'response', status: 'completed', model, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      if (!body.stream) return json(res, response);
      return sse(res, [
        ['response.created', { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }],
        ['response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
        ['response.output_text.delta', { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'ok' }],
        ['response.output_item.done', { type: 'response.output_item.done', output_index: 0, item }],
        ['response.completed', { type: 'response.completed', response }]
      ]);
    }
    if (url.pathname.endsWith('/chat/completions')) {
      if (!body.stream) return json(res, { id: 'c1', object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      return sse(res, [
        [null, JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] })],
        [null, JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })],
        [null, '[DONE]']
      ]);
    }
    json(res, { data: [] });
  });
}).listen(port, '127.0.0.1', () => console.log(`mock listening on ${port}`));
