import { Server, ServerOptions } from "socket.io";
import { Socket as ServerSocket } from "socket.io/dist/socket";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { createServer } from "http";
import { createAdapter, RedisStreamsAdapterOptions } from "../lib";
import { AddressInfo } from "net";

export function times(count: number, fn: () => void) {
  let i = 0;
  return () => {
    i++;
    if (i === count) {
      fn();
    } else if (i > count) {
      throw new Error(`too many calls: ${i} instead of ${count}`);
    }
  };
}

export function sleep(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

export function shouldNotHappen(done) {
  return () => done(new Error("should not happen"));
}

const NODES_COUNT = 3;

interface TestContext {
  servers: Server[];
  serverSockets: ServerSocket[];
  clientSockets: ClientSocket[];
  cleanup: () => void;
  ports: number[];
}

export function setup(
  initRedisClient: () => any,
  serverOptions: Partial<ServerOptions> = {},
  adapterOptions: RedisStreamsAdapterOptions = {}
): Promise<TestContext> {
  const servers = [];
  const serverSockets = [];
  const clientSockets = [];
  const redisClients = [];
  const ports = [];

  return new Promise<TestContext>(async (resolve) => {
    for (let i = 1; i <= NODES_COUNT; i++) {
      const redisClient = await initRedisClient();

      const httpServer = createServer();
      const io = new Server(httpServer, {
        adapter: createAdapter(redisClient, {
          readCount: 1, // return as soon as possible
          ...adapterOptions,
        }),
        ...serverOptions,
      });
      httpServer.listen(() => {
        const port = (httpServer.address() as AddressInfo).port;
        const clientSocket = ioc(`http://localhost:${port}`);

        io.on("connection", async (socket) => {
          clientSockets.push(clientSocket);
          serverSockets.push(socket);
          servers.push(io);
          redisClients.push(redisClient);
          ports.push(port);
        });
      });
    }

    function isReady() {
      return (
        servers.length === NODES_COUNT &&
        clientSockets.length === NODES_COUNT &&
        servers.every((server) => {
          const serverCount = server.of("/").adapter.nodesMap.size;
          return serverCount === NODES_COUNT - 1;
        })
      );
    }

    while (!isReady()) {
      if (servers.length > 0) {
        // notify other servers in the cluster
        servers[0]?.of("/").adapter.init();
      }
      await sleep(100);
    }

    resolve({
      servers,
      serverSockets,
      clientSockets,
      ports,
      cleanup: () => {
        servers.forEach((server) => server.close());
        clientSockets.forEach((socket) => socket.disconnect());
        redisClients.forEach((redisClient) => redisClient.quit());
      },
    });
  });
}
