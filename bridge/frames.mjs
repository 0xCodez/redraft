// Chrome native messaging framing: a 4-byte little-endian length, then UTF-8 JSON.
export function encode(message) {
  const body = Buffer.from(JSON.stringify(message));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

export class FrameReader {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
  }
  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + size) return;
      const body = this.buffer.subarray(4, 4 + size);
      this.buffer = this.buffer.subarray(4 + size);
      this.onMessage(JSON.parse(body.toString('utf8')));
    }
  }
}

// One line of `claude -p --output-format stream-json` becomes zero or more bridge events.
export function readClaudeLine(line) {
  let event;
  try { event = JSON.parse(line); } catch { return []; }
  if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
    return [{ type: 'text', text: event.event.delta.text }];
  }
  if (event.type === 'result') {
    if (event.is_error) return [{ type: 'error', message: String(event.result || 'Claude Code reported an error.') }];
    return [{ type: 'usage', usage: event.usage || {} }];
  }
  return [];
}
