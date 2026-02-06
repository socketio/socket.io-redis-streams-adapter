import { testSuite } from "./index";
import { createClient, createCluster } from "redis";
import { Cluster, Redis } from "ioredis";
import { csrTestSuite } from "./connection-state-recovery";

function testSuites(initRedisClient: () => any) {
  testSuite(initRedisClient);
  csrTestSuite(initRedisClient);
}

describe("@socket.io/redis-streams-adapter", () => {
  describe("redis with single Redis node", () => {
    testSuites(async () => {
      const redisClient = createClient();
      await redisClient.connect();
      return redisClient;
    });
  });

  describe("redis with Redis cluster", () => {
    testSuites(async () => {
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
    });
  });

  describe("ioredis with single Redis node", () => {
    testSuites(() => {
      return new Redis();
    });
  });

  describe("ioredis with Redis cluster", () => {
    testSuites(() => {
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
    });
  });

  describe("redis with single Valkey node", () => {
    testSuites(async () => {
      const redisClient = createClient({
        url: "redis://localhost:6389",
      });
      await redisClient.connect();

      return redisClient;
    });
  });
});
