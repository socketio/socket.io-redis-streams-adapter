import { Server, ServerOptions, Socket as ServerSocket } from "socket.io";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { createClient, createCluster } from "redis";
import {
  createClient as createClientV5,
  createCluster as createClusterV5,
} from "redis-v5";
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

const mode = process.env.REDIS_CLUSTER === "1" ? "cluster" : "standalone";
const lib = process.env.REDIS_LIB || "redis";

console.log(`[INFO] testing in ${mode} mode with ${lib}`);

async function initRedisClient() {
  switch (lib) {
    case "ioredis": {
      if (mode === "cluster") {
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
        return new Redis();
      }
    }
    case "redis-v5": {
      if (mode === "cluster") {
        const redisClient = createClusterV5({
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
      } else {
        const redisClient = createClientV5({
          url: "redis://localhost:6379",
        });
        await redisClient.connect();

        return redisClient;
      }
    }
    case "redis":
    default: {
      if (mode === "cluster") {
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
      } else {
        const port = process.env.VALKEY === "1" ? 6389 : 6379;
        const redisClient = createClient({
          url: `redis://localhost:${port}`,
        });
        await redisClient.connect();

        return redisClient;
      }
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
        adapter: createAdapter(redisClient, {
          blockTimeInMs: 20, // reduce the polling interval to speed up the tests
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
          if (servers.length === nodeCount) {
            // ensure all nodes know each other
            servers[0].emit("ping");
            servers[1].emit("ping");
            servers[2].emit("ping");

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
