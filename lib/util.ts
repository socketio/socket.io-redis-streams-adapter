import { randomBytes } from "crypto";
import {
  type RedisClientType,
  type RedisFunctions,
  type RedisModules,
  type RedisScripts,
} from "redis";
import { type Redis as IORedisClient } from "ioredis";

export type RedisClient = RedisClientType<
  RedisModules,
  RedisFunctions,
  RedisScripts
>;

export function hasBinary(obj: any, toJSON?: boolean): boolean {
  if (!obj || typeof obj !== "object") {
    return false;
  }

  if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
    return true;
  }

  if (Array.isArray(obj)) {
    for (let i = 0, l = obj.length; i < l; i++) {
      if (hasBinary(obj[i])) {
        return true;
      }
    }
    return false;
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
      return true;
    }
  }

  if (obj.toJSON && typeof obj.toJSON === "function" && !toJSON) {
    return hasBinary(obj.toJSON(), true);
  }

  return false;
}

export function randomId() {
  return randomBytes(8).toString("hex");
}

/**
 * Whether the client comes from the `redis` package
 *
 * @param redisClient
 *
 * @see https://github.com/redis/node-redis
 */
function isRedisV4Client(
  redisClient: RedisClient | IORedisClient
): redisClient is RedisClient {
  return (
    "sSubscribe" in redisClient && typeof redisClient.sSubscribe === "function"
  );
}

/**
 * Map the output of the XREAD/XRANGE command with the ioredis package to the format of the redis package
 * @param result
 */
function mapResult(result) {
  const id = result[0];
  const inlineValues = result[1];
  const message = {};
  for (let i = 0; i < inlineValues.length; i += 2) {
    message[inlineValues[i]] = inlineValues[i + 1];
  }
  return {
    id,
    message,
  };
}

/**
 * @see https://redis.io/commands/xread/
 */
export function XREAD(
  redisClient: RedisClient | IORedisClient,
  streamName: string,
  offset: string,
  readCount: number
) {
  if (isRedisV4Client(redisClient)) {
    return redisClient.executeIsolated((isolatedClient) =>
      isolatedClient.xRead(
        [
          {
            key: streamName,
            id: offset,
          },
        ],
        {
          COUNT: readCount,
          BLOCK: 5000,
        }
      )
    );
  } else {
    return redisClient
      .xread("COUNT", readCount, "BLOCK", 100, "STREAMS", streamName, offset)
      .then((results) => {
        if (results === null) {
          return null;
        }
        return [
          {
            messages: results[0][1].map(mapResult),
          },
        ];
      });
  }
}

/**
 * @see https://redis.io/commands/xadd/
 */
export function XADD(
  redisClient: RedisClient | IORedisClient,
  streamName: string,
  payload: any,
  maxLenThreshold: number
) {
  if (isRedisV4Client(redisClient)) {
    return redisClient.xAdd(streamName, "*", payload, {
      TRIM: {
        strategy: "MAXLEN",
        strategyModifier: "~",
        threshold: maxLenThreshold,
      },
    });
  } else {
    const args = [streamName, "MAXLEN", "~", maxLenThreshold, "*"];
    Object.keys(payload).forEach((k) => {
      args.push(k, payload[k]);
    });

    return redisClient.xadd.call(redisClient, args);
  }
}

/**
 * @see https://redis.io/commands/xrange/
 */
export function XRANGE(
  redisClient: RedisClient | IORedisClient,
  streamName: string,
  start: string,
  end: string
) {
  if (isRedisV4Client(redisClient)) {
    return redisClient.xRange(streamName, start, end);
  } else {
    return redisClient.xrange(streamName, start, end).then((res) => {
      return res.map(mapResult);
    });
  }
}

/**
 * @see https://redis.io/commands/set/
 */
export function SET(
  redisClient: RedisClient | IORedisClient,
  key: string,
  value: string,
  expiryInSeconds: number
) {
  if (isRedisV4Client(redisClient)) {
    return redisClient.set(key, value, {
      PX: expiryInSeconds,
    });
  } else {
    return redisClient.set(key, value, "PX", expiryInSeconds);
  }
}

/**
 * @see https://redis.io/commands/getdel/
 */
export function GETDEL(redisClient: RedisClient | IORedisClient, key: string) {
  if (isRedisV4Client(redisClient)) {
    // note: GETDEL was added in Redis version 6.2
    return redisClient.multi().get(key).del(key).exec();
  } else {
    return redisClient
      .multi()
      .get(key)
      .del(key)
      .exec()
      .then((res) => {
        return [res[0][1]];
      });
  }
}
