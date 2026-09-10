// Cloudflare Worker relay for outbound Telegram Bot API calls (D26).
//
// api.telegram.org is unreachable from malina; Cloudflare's edge is not. This Worker sits
// between the Pi and Telegram: the Pi authenticates with RELAY_SECRET (a header, checked
// below), the Worker injects the real BOT_TOKEN (a Worker secret, never sent to the Pi or
// visible to it) and forwards the call. Only the methods the app actually uses are
// forwarded — everything else is refused, per D26 ("the Worker should also refuse any
// method it doesn't need").
//
// Routes:
//   POST /api/<method>   -> https://api.telegram.org/bot<TOKEN>/<method>
//   GET  /file/<path>    -> https://api.telegram.org/file/bot<TOKEN>/<path>  (getFile's file_path)
//   GET  /                -> health check, no auth required

const ALLOWED_METHODS = new Set([
  'editMessageMedia',
  'editMessageText',
  'getChat',
  'getFile',
  'pinChatMessage',
  'sendDocument',
  'sendMessage',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('ok');
    }

    if (request.headers.get('x-relay-secret') !== env.RELAY_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      return forwardApiCall(request, env, url.pathname.slice('/api/'.length));
    }

    if (request.method === 'GET' && url.pathname.startsWith('/file/')) {
      return forwardFileDownload(env, url.pathname.slice('/file/'.length));
    }

    return new Response('not found', { status: 404 });
  },
};

async function forwardApiCall(request, env, method) {
  if (!ALLOWED_METHODS.has(method)) {
    return new Response('method not allowed', { status: 403 });
  }

  const upstream = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const headers = new Headers(request.headers);
  headers.delete('x-relay-secret');
  headers.delete('host');

  const response = await fetch(upstream, {
    body: await request.arrayBuffer(),
    headers,
    method: 'POST',
  });

  return passThrough(response);
}

async function forwardFileDownload(env, filePath) {
  if (filePath.length === 0) {
    return new Response('missing file path', { status: 400 });
  }

  const upstream = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
  const response = await fetch(upstream);
  return passThrough(response);
}

function passThrough(response) {
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  return new Response(response.body, { headers, status: response.status });
}
