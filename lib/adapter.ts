import { ClusterAdapterWithHeartbeat, MessageType } from "socket.io-adapter";
import type {
  ClusterAdapterOptions,
  ClusterMessage,
  PrivateSessionId,
  Session,
  ServerId,
  ClusterResponse,
} from "socket.io-adapter";
import { decode, encode } from "@msgpack/msgpack";
import debugModule from "debug";
import { hasBinary, XADD, XREAD } from "./util";

const debug = debugModule("socket.io-redis-streams-adapter");

const RESTORE_SESSION_MAX_XRANGE_CALLS = 100;

export interface RedisStreamsAdapterOptions {
  /**
   * The name of the Redis stream.
   * @default "socket.io"
   */
  streamName?: string;
  /**
   * The maximum size of the stream. Almost exact trimming (~) is used.
   * @default 10_000
   */
  maxLen?: number;
  /**
   * The number of elements to fetch per XREAD call.
   * @default 100
   */
  readCount?: number;
  /**
   * The prefix of the key used to store the Socket.IO session, when the connection state recovery feature is enabled.
   * @default "sio:session:"
   */
  sessionKeyPrefix?: string;
}

interface RawClusterMessage {
  uid: string;
  nsp: string;
  type: string;
  data?: string;
}

/**
 * Returns a function that will create a new adapter instance.
 *
 * @param redisClient - a Redis client that will be used to publish messages
 * @param opts - additional options
 */
export function createAdapter(
  redisClient: any,
  opts?: RedisStreamsAdapterOptions & ClusterAdapterOptions
) {
  const namespaceToAdapters = new Map<string, RedisStreamsAdapter>();
  const options = Object.assign(
    {
      streamName: "socket.io",
      maxLen: 10_000,
      readCount: 100,
      sessionKeyPrefix: "sio:session:",
      heartbeatInterval: 5_000,
      heartbeatTimeout: 10_000,
    },
    opts
  );
  let offset = "$";
  let polling = false;
  let shouldClose = false;

  async function poll() {
    try {
      let response = await XREAD(
        redisClient,
        options.streamName,
        offset,
        options.readCount
      );

      if (response) {
        for (const entry of response[0].messages) {
          debug("reading entry %s", entry.id);
          const message = entry.message;

          if (message.nsp) {
            namespaceToAdapters
              .get(message.nsp)
              ?.onRawMessage(message, entry.id);
          }

          offset = entry.id;
        }
      }
    } catch (e) {
      debug("something went wrong while consuming the stream: %s", e.message);
    }

    if (namespaceToAdapters.size > 0 && !shouldClose) {
      poll();
    } else {
      polling = false;
    }
  }

  return function (nsp) {
    const adapter = new RedisStreamsAdapter(nsp, redisClient, options);
    namespaceToAdapters.set(nsp.name, adapter);

    if (!polling) {
      polling = true;
      shouldClose = false;
      poll();
    }

    const defaultClose = adapter.close;

    adapter.close = () => {
      namespaceToAdapters.delete(nsp.name);

      if (namespaceToAdapters.size === 0) {
        shouldClose = true;
      }

      defaultClose.call(adapter);
    };

    return adapter;
  };
}

class RedisStreamsAdapter extends ClusterAdapterWithHeartbeat {
  readonly #redisClient: any;
  readonly #opts: Required<RedisStreamsAdapterOptions>;

  constructor(
    nsp,
    redisClient,
    opts: Required<RedisStreamsAdapterOptions> & ClusterAdapterOptions
  ) {
    super(nsp, opts);
    this.#redisClient = redisClient;
    this.#opts = opts;

    this.init();
  }

  override doPublish(message: ClusterMessage) {
    debug("publishing %o", message);

    return XADD(
      this.#redisClient,
      this.#opts.streamName,
      RedisStreamsAdapter.encode(message),
      this.#opts.maxLen
    );
  }

  protected doPublishResponse(
    requesterUid: ServerId,
    response: ClusterResponse
  ): Promise<void> {
    // @ts-ignore
    return this.doPublish(response);
  }

  static encode(message: ClusterMessage): RawClusterMessage {
    const rawMessage: RawClusterMessage = {
      uid: message.uid,
      nsp: message.nsp,
      type: message.type.toString(),
    };

    // @ts-ignore
    if (message.data) {
      const mayContainBinary = [
        MessageType.BROADCAST,
        MessageType.FETCH_SOCKETS_RESPONSE,
        MessageType.SERVER_SIDE_EMIT,
        MessageType.SERVER_SIDE_EMIT_RESPONSE,
        MessageType.BROADCAST_ACK,
      ].includes(message.type);

      // @ts-ignore
      if (mayContainBinary && hasBinary(message.data)) {
        // @ts-ignore
        rawMessage.data = Buffer.from(encode(message.data)).toString("base64");
      } else {
        // @ts-ignore
        rawMessage.data = JSON.stringify(message.data);
      }
    }

    return rawMessage;
  }

  public onRawMessage(rawMessage: RawClusterMessage, offset: string) {
    let message;
    try {
      message = RedisStreamsAdapter.decode(rawMessage);
    } catch (e) {
      return debug("invalid format: %s", e.message);
    }

    this.onMessage(message, offset);
  }

  static decode(rawMessage: RawClusterMessage): ClusterMessage {
    const message: ClusterMessage = {
      uid: rawMessage.uid,
      nsp: rawMessage.nsp,
      type: parseInt(rawMessage.type, 10),
    };

    if (rawMessage.data) {
      if (rawMessage.data.startsWith("{")) {
        // @ts-ignore
        message.data = JSON.parse(rawMessage.data);
      } else {
        // @ts-ignore
        message.data = decode(Buffer.from(rawMessage.data, "base64")) as Record<
          string,
          unknown
        >;
      }
    }

    return message;
  }

  override persistSession(session) {
    debug("persisting session %o", session);
    const sessionKey = this.#opts.sessionKeyPrefix + session.pid;
    const encodedSession = Buffer.from(encode(session)).toString("base64");

    this.#redisClient.set(sessionKey, encodedSession, {
      PX: this.nsp.server.opts.connectionStateRecovery.maxDisconnectionDuration,
    });
  }

  override async restoreSession(
    pid: PrivateSessionId,
    offset: string
  ): Promise<Session> {
    debug("restoring session %s from offset %s", pid, offset);

    if (!/^[0-9]+-[0-9]+$/.test(offset)) {
      return Promise.reject("invalid offset");
    }

    const sessionKey = this.#opts.sessionKeyPrefix + pid;

    const results = await Promise.all([
      this.#redisClient
        .multi()
        .get(sessionKey)
        .del(sessionKey) // GETDEL was added in Redis version 6.2
        .exec(),
      this.#redisClient.xRange(this.#opts.streamName, offset, offset),
    ]);

    const rawSession = results[0][0];
    const offsetExists = results[1][0];

    if (!rawSession || !offsetExists) {
      return Promise.reject("session or offset not found");
    }

    const session = decode(Buffer.from(rawSession, "base64")) as Session;

    debug("found session %o", session);

    session.missedPackets = [];

    // FIXME we need to add an arbitrary limit here, because if entries are added faster than what we can consume, then
    // we will loop endlessly. But if we stop before reaching the end of the stream, we might lose messages.
    for (let i = 0; i < RESTORE_SESSION_MAX_XRANGE_CALLS; i++) {
      const entries = await this.#redisClient.xRange(
        this.#opts.streamName,
        RedisStreamsAdapter.nextOffset(offset),
        "+",
        {
          COUNT: this.#opts.readCount,
        }
      );

      if (entries.length === 0) {
        break;
      }

      for (const entry of entries) {
        if (entry.message.nsp === this.nsp.name && entry.message.type === "3") {
          const message = RedisStreamsAdapter.decode(entry.message);

          // @ts-ignore
          if (shouldIncludePacket(session.rooms, message.data.opts)) {
            // @ts-ignore
            session.missedPackets.push(message.data.packet.data);
          }
        }
        offset = entry.id;
      }
    }

    return session;
  }

  /**
   * Exclusive ranges were added in Redis 6.2, so this is necessary for previous versions.
   *
   * @see https://redis.io/commands/xrange/
   *
   * @param offset
   */
  static nextOffset(offset) {
    const [timestamp, sequence] = offset.split("-");
    return timestamp + "-" + (parseInt(sequence) + 1);
  }
}

function shouldIncludePacket(sessionRooms, opts) {
  const included =
    opts.rooms.length === 0 ||
    sessionRooms.some((room) => opts.rooms.indexOf(room) !== -1);
  const notExcluded = sessionRooms.every(
    (room) => opts.except.indexOf(room) === -1
  );
  return included && notExcluded;
}
