import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const KEEP_ALIVE_MS = 20_000;

export interface EventsHub {
  addClient: (reply: FastifyReply) => () => void;
  closeAll: () => void;
  emit: () => void;
}

declare module 'fastify' {
  interface FastifyInstance {
    events: EventsHub;
  }
}

export function createEventsHub(): EventsHub {
  const clients = new Set<FastifyReply>();

  return {
    addClient(reply: FastifyReply): () => void {
      clients.add(reply);
      return () => {
        clients.delete(reply);
      };
    },
    closeAll(): void {
      for (const reply of clients) {
        reply.raw.end();
      }
      clients.clear();
    },
    // D15: an opaque "something changed, refetch" ping — no payload, so a catalog change
    // looks identical to a list change. Any missed ping is healed by the next.
    emit(): void {
      for (const reply of clients) {
        reply.raw.write('event: changed\ndata: \n\n');
      }
    },
  };
}

// No slice work is async yet — the outer plugin function stays `async` only because
// FastifyPluginAsyncZod's type requires a Promise<void> return.
// eslint-disable-next-line @typescript-eslint/require-await -- see comment above
export const eventsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/events', (request, reply): void => {
    reply.hijack();
    request.raw.socket.setNoDelay(true);
    // §5.2/§7 landmine 7: proxy buffering would hold the stream behind nginx.
    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });

    const removeClient = app.events.addClient(reply);
    const keepAlive = setInterval(() => {
      reply.raw.write(':\n\n');
    }, KEEP_ALIVE_MS);
    keepAlive.unref(); // must not hold the process open (landmine 8)

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      removeClient();
    });
  });
};
