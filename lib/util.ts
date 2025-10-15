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

/**
 * Whether the client comes from version 5.x of the `redis` package
 *
 * @param redisClient
 *
 * @see https://github.com/redis/node-redis/blob/master/docs/v5.md
 */
function isRedisV5Client(redisClient: any) {
  return typeof redisClient.createPool === "function";
}

/**
 * Whether the client comes from version 4.x of the `redis` package
 *
 * @param redisClient
 *
 * @see https://github.com/redis/node-redis/blob/master/docs/v4-to-v5.md
 */
function isRedisV4Client(redisClient: any) {
  return typeof redisClient.sSubscribe === "function";
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

const POOL = Symbol("redis_v5_pool");

/**
 * @see https://redis.io/commands/xread/
 */
export function XREAD(
  redisClient: any,
  streamName: string,
  offset: string,
  readCount: number
) {
  if (isRedisV5Client(redisClient)) {
    if (!redisClient[POOL]) {
      redisClient[POOL] = redisClient.createPool();
    }

    return redisClient[POOL].xRead(
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
    );
  } else if (isRedisV4Client(redisClient)) {
    return import("redis").then((redisPackage) => {
      return redisClient.xRead(
        redisPackage.commandOptions({
          isolated: true,
        }),
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
      );
    });
  } else {
    return redisClient
      .xread("BLOCK", 100, "COUNT", readCount, "STREAMS", streamName, offset)
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
  redisClient: any,
  streamName: string,
  payload: any,
  maxLenThreshold: number
) {
  if (isRedisV4Client(redisClient) || isRedisV5Client(redisClient)) {
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
  redisClient: any,
  streamName: string,
  start: string,
  end: string
) {
  if (isRedisV4Client(redisClient) || isRedisV5Client(redisClient)) {
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
  redisClient: any,
  key: string,
  value: string,
  expiryInSeconds: number
) {
  if (isRedisV4Client(redisClient) || isRedisV5Client(redisClient)) {
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
export function GETDEL(redisClient: any, key: string) {
  if (isRedisV4Client(redisClient) || isRedisV5Client(redisClient)) {
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
