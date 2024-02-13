import { randomBytes } from "crypto";
import { commandOptions } from "redis";

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
function isRedisV4Client(redisClient: any) {
  return typeof redisClient.sSubscribe === "function";
}

/**
 * @see https://redis.io/commands/xread/
 */
export function XREAD(
  redisClient: any,
  streamName: string,
  offset: string,
  readCount: number
) {
  if (isRedisV4Client(redisClient)) {
    return redisClient.xRead(
      commandOptions({
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
  } else {
    return redisClient
      .xread("BLOCK", 100, "COUNT", readCount, "STREAMS", streamName, offset)
      .then((results) => {
        if (results === null) {
          return null;
        }
        return [
          {
            messages: results[0][1].map((result) => {
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
            }),
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
