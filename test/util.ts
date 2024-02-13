import { Server } from "socket.io";
import { Socket as ServerSocket } from "socket.io/dist/socket";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { createClient, createCluster } from "redis";
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
}

if (process.env.REDIS_CLUSTER === "1") {
  console.log("[INFO] testing in cluster mode");
} else {
  console.log("[INFO] testing in standalone mode");
}

async function initRedisClient() {
  if (process.env.REDIS_CLUSTER === "1") {
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
    const redisClient = createClient();

    await redisClient.connect();

    return redisClient;
  }
}

export function setup() {
  const servers = [];
  const serverSockets = [];
  const clientSockets = [];
  const redisClients = [];

  return new Promise<TestContext>(async (resolve) => {
    for (let i = 1; i <= NODES_COUNT; i++) {
      const redisClient = await initRedisClient();

      const httpServer = createServer();
      const io = new Server(httpServer, {
        adapter: createAdapter(redisClient),
      });
      httpServer.listen(() => {
        const port = (httpServer.address() as AddressInfo).port;
        const clientSocket = ioc(`http://localhost:${port}`);

        io.on("connection", async (socket) => {
          clientSockets.push(clientSocket);
          serverSockets.push(socket);
          servers.push(io);
          redisClients.push(redisClient);
          if (servers.length === NODES_COUNT) {
            await sleep(200);

            resolve({
              servers,
              serverSockets,
              clientSockets,
              cleanup: () => {
                servers.forEach((server) => {
                  // @ts-ignore
                  server.httpServer.close();
                  server.of("/").adapter.close();
                });
                clientSockets.forEach((socket) => {
                  socket.disconnect();
                });
                redisClients.forEach((redisClient) => {
                  redisClient.quit();
                });
              },
            });
          }
        });
      });
    }
  });
}
