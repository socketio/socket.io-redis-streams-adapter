import { Server, ServerOptions } from "socket.io";
import { Socket as ServerSocket } from "socket.io/dist/socket";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { createClient, createCluster } from "redis";
import { Redis, Cluster } from "ioredis";
import { createServer } from "http";
import { createAdapter } from "../lib";
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

const NODES_COUNT = 3;

interface TestContext {
  servers: Server[];
  serverSockets: ServerSocket[];
  clientSockets: ClientSocket[];
  cleanup: () => void;
  ports: number[];
}

const mode = process.env.REDIS_CLUSTER === "1" ? "cluster" : "standalone";
const lib = process.env.REDIS_LIB || "redis";

console.log(`[INFO] testing in ${mode} mode with ${lib}`);

async function initRedisClient() {
  if (process.env.REDIS_CLUSTER === "1") {
    if (process.env.REDIS_LIB === "ioredis") {
      return new Cluster([
        {
          host: "localhost",
          port: 7000,
        },
        {
          host: "localhost",
          port: 7001,
        },
        {
          host: "localhost",
          port: 7002,
        },
        {
          host: "localhost",
          port: 7003,
        },
        {
          host: "localhost",
          port: 7004,
        },
        {
          host: "localhost",
          port: 7005,
        },
      ]);
    } else {
      const redisClient = createCluster({
        rootNodes: [
          {
            url: "redis://localhost:7000",
          },
          {
            url: "redis://localhost:7001",
          },
          {
            url: "redis://localhost:7002",
          },
          {
            url: "redis://localhost:7003",
          },
          {
            url: "redis://localhost:7004",
          },
          {
            url: "redis://localhost:7005",
          },
        ],
      });

      await redisClient.connect();

      return redisClient;
    }
  } else {
    if (process.env.REDIS_LIB === "ioredis") {
      return new Redis();
    } else {
      const redisClient = createClient();
      await redisClient.connect();

      return redisClient;
    }
  }
}

type SetupOptions = {
  nodeCount?: number;
  serverOptions?: Partial<ServerOptions>;
};
export function setup({
  nodeCount = NODES_COUNT,
  serverOptions = {},
}: SetupOptions = {}) {
  const servers = [];
  const serverSockets = [];
  const clientSockets = [];
  const redisClients = [];
  const ports = [];

  return new Promise<TestContext>(async (resolve) => {
    for (let i = 1; i <= nodeCount; i++) {
      const redisClient = await initRedisClient();

      const httpServer = createServer();
      const io = new Server(httpServer, {
        adapter: createAdapter(redisClient),
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
          if (servers.length === nodeCount) {
            await sleep(200);

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
          }
        });
      });
    }
  });
}
