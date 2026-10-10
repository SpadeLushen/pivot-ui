import { createInterface } from 'node:readline';
import { writeFileSync, appendFileSync } from 'node:fs';
const marker = process.argv[2];
if (marker) writeFileSync(marker, String(process.pid));
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'pivot-local-fixture', version: '1' } };
  if (request.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Local echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] };
  if (request.method === 'tools/call') {
    if (marker) appendFileSync(`${marker}.calls`, request.params.arguments.text + '\n');
    result = { content: [{ type: 'text', text: request.params.arguments.text }] };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
