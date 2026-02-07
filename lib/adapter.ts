import { ClusterAdapter, MessageType } from "socket.io-adapter";
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
import {
  hasBinary,
  GETDEL,
  SET,
  SUBSCRIBE,
  XADD,
  XRANGE,
  XREAD,
  hashCode,
  duplicateClient,
  SPUBLISH,
  PUBLISH,
  PUBSUB,
  SSUBSCRIBE,
} from "./util";

const debug = debugModule("socket.io-redis-streams-adapter");

const RESTORE_SESSION_MAX_XRANGE_CALLS = 100;

export interface RedisStreamsAdapterOptions {
  /**
   * The name of the Redis stream (or the prefix used when using multiple streams).
   *
   * @see streamCount
   * @default "socket.io"
   */
  streamName?: string;
  /**
   * The number of streams to use to scale horizontally.
   *
   * Each namespace is routed to a specific stream to ensure the ordering of messages.
   *
   * Note: using multiple streams is useless when using a single namespace.
   *
   * @default 1
   */
  streamCount?: number;
  /**
   * The prefix of the Redis PUB/SUB channels used to communicate between the nodes.
   * @default "socket.io"
   */
  channelPrefix?: string;
  /**
   * Whether to use sharded PUB/SUB (added in Redis 7.0) to communicate between the nodes.
   * @default false
   * @see https://redis.io/docs/latest/develop/pubsub/#sharded-pubsub
   */
  useShardedPubSub?: boolean;
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
   * The number of ms before the XREAD call times out.
   * @default 200
   * @see https://redis.io/docs/latest/commands/xread/#blocking-for-data
   */
  blockTimeInMs?: number;
  /**
   * The prefix of the key used to store the Socket.IO session, when the connection state recovery feature is enabled.
   * @default "sio:session:"
   */
  sessionKeyPrefix?: string;
  /**
   * Whether the transmitted data contains only JSON-serializable objects without binary data (Buffer, ArrayBuffer, etc.).
   * When enabled, binary data checks are skipped for better performance.
   * @default false
   */
  onlyPlaintext?: boolean;
}

interface RawClusterMessage {
  uid: string;
  nsp: string;
  type: string;
  data?: string;
}

interface ReadOnlyClient {
  client: any;
  streamName: string;
}

async function createReadOnlyClients(
  redisClient: any,
  opts: RedisStreamsAdapterOptions
): Promise<ReadOnlyClient[]> {
  if (opts.streamCount === 1) {
    const newClient = await duplicateClient(redisClient);
    return [
      {
        client: newClient,
        streamName: opts.streamName,
      },
    ];
  } else {
    const streamNames = [];
    for (let i = 0; i < opts.streamCount; i++) {
      const newClient = await duplicateClient(redisClient);
      streamNames.push({
        client: newClient,
        streamName: opts.streamName + "-" + i,
      });
    }
    return streamNames;
  }
}

function startPolling(
  redisClient: any,
  streamName: string,
  options: RedisStreamsAdapterOptions,
  onMessage: (message: RawClusterMessage, offset: string) => void,
  signal: AbortSignal
) {
  let offset = "$";

  async function poll() {
    try {
      let response = await XREAD(
        redisClient,
        streamName,
        offset,
        options.readCount,
        options.blockTimeInMs
      );

      if (response) {
        for (const entry of response[0].messages) {
          debug("reading entry %s", entry.id);
          const message = entry.message;

          if (message.nsp) {
            onMessage(message, entry.id);
          }

          offset = entry.id;
        }
      }
    } catch (e) {
      debug("something went wrong while consuming the stream: %s", e.message);
    }

    if (signal.aborted) {
      redisClient.disconnect();
    } else {
      poll();
    }
  }

  poll();
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
      streamCount: 1,
      channelPrefix: "socket.io",
      useShardedPubSub: false,
      maxLen: 10_000,
      readCount: 100,
      blockTimeInMs: 5_000,
      sessionKeyPrefix: "sio:session:",
      heartbeatInterval: 5_000,
      heartbeatTimeout: 10_000,
      onlyPlaintext: false,
    },
    opts
  );

  function onMessage(message: RawClusterMessage, offset: string) {
    namespaceToAdapters.get(message.nsp)?.onRawMessage(message, offset);
  }

  let readOnlyClients: ReadOnlyClient[];
  const controller = new AbortController();

  // note: we create one Redis client per stream so they don't block each other. We could also have used one Redis
  // client per master in the cluster (reading from the streams assigned to the given node), but that would have been
  // trickier to implement.
  createReadOnlyClients(redisClient, options).then((clients) => {
    readOnlyClients = clients;

    for (const { client, streamName } of readOnlyClients) {
      startPolling(client, streamName, options, onMessage, controller.signal);
    }
  });

  const subClientPromise = duplicateClient(redisClient);

  controller.signal.addEventListener("abort", () => {
    subClientPromise.then((subClient) => subClient.disconnect());
  });

  return function (nsp) {
    const adapter = new RedisStreamsAdapter(
      nsp,
      redisClient,
      subClientPromise,
      options
    );
    namespaceToAdapters.set(nsp.name, adapter);

    const defaultClose = adapter.close;

    adapter.close = () => {
      namespaceToAdapters.delete(nsp.name);

      if (namespaceToAdapters.size === 0) {
        controller.abort();
      }

      defaultClose.call(adapter);
    };

    return adapter;
  };
}

function computeStreamName(
  namespaceName: string,
  opts: RedisStreamsAdapterOptions
) {
  if (opts.streamCount === 1) {
    return opts.streamName;
  } else {
    const i = hashCode(namespaceName) % opts.streamCount;
    return opts.streamName + "-" + i;
  }
}

function isEphemeral(message: ClusterMessage) {
  const isBroadcastWithAck =
    message.type === MessageType.BROADCAST &&
    message.data.requestId !== undefined;

  return (
    isBroadcastWithAck ||
    [MessageType.SERVER_SIDE_EMIT, MessageType.FETCH_SOCKETS].includes(
      message.type
    )
  );
}

class RedisStreamsAdapter extends ClusterAdapter {
  readonly #redisClient: any;
  readonly #opts: Required<RedisStreamsAdapterOptions>;
  readonly #streamName: string;
  readonly #publicChannel: string;

  constructor(
    nsp: any,
    redisClient: any,
    subClientPromise: Promise<any>,
    opts: Required<RedisStreamsAdapterOptions> & ClusterAdapterOptions
  ) {
    super(nsp);
    this.#redisClient = redisClient;
    this.#opts = opts;
    // each namespace is routed to a specific stream to ensure the ordering of messages
    this.#streamName = computeStreamName(nsp.name, opts);

    this.#publicChannel = `${opts.channelPrefix}#${nsp.name}#`;
    const privateChannel = `${opts.channelPrefix}#${nsp.name}#${this.uid}#`;

    subClientPromise.then((subClient) => {
      (this.#opts.useShardedPubSub ? SSUBSCRIBE : SUBSCRIBE)(
        subClient,
        [this.#publicChannel, privateChannel],
        (payload: Buffer) => {
          try {
            const message = decode(payload) as ClusterMessage;
            this.onMessage(message);
          } catch (e) {
            return debug("invalid format: %s", e.message);
          }
        }
      );
    });
  }

  override doPublish(message: ClusterMessage) {
    debug("publishing %o", message);

    if (isEphemeral(message)) {
      // ephemeral messages are sent with Redis PUB/SUB
      const payload = Buffer.from(encode(message));
      (this.#opts.useShardedPubSub ? SPUBLISH : PUBLISH)(
        this.#redisClient,
        this.#publicChannel,
        payload
      );
      return Promise.resolve("");
    }

    return XADD(
      this.#redisClient,
      this.#streamName,
      this.encode(message),
      this.#opts.maxLen
    );
  }

  protected doPublishResponse(
    requesterUid: ServerId,
    response: ClusterResponse
  ): Promise<void> {
    const responseChannel = `${this.#opts.channelPrefix}#${
      this.nsp.name
    }#${requesterUid}#`;
    const payload = Buffer.from(encode(response));
    return (this.#opts.useShardedPubSub ? SPUBLISH : PUBLISH)(
      this.#redisClient,
      responseChannel,
      payload
    ).then();
  }

  private encode(message: ClusterMessage): RawClusterMessage {
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

      if (
        !this.#opts.onlyPlaintext &&
        mayContainBinary &&
        // @ts-ignore
        hasBinary(message.data)
      ) {
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

  override serverCount(): Promise<number> {
    return PUBSUB(
      this.#redisClient,
      this.#opts.useShardedPubSub ? "SHARDNUMSUB" : "NUMSUB",
      this.#publicChannel
    );
  }

  override persistSession(session) {
    debug("persisting session %o", session);
    const sessionKey = this.#opts.sessionKeyPrefix + session.pid;
    const encodedSession = Buffer.from(encode(session)).toString("base64");

    SET(
      this.#redisClient,
      sessionKey,
      encodedSession,
      this.nsp.server.opts.connectionStateRecovery.maxDisconnectionDuration
    );
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
      GETDEL(this.#redisClient, sessionKey),
      XRANGE(this.#redisClient, this.#streamName, offset, offset),
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
      const entries = await XRANGE(
        this.#redisClient,
        this.#streamName,
        RedisStreamsAdapter.nextOffset(offset),
        "+"
      );

      if (entries.length === 0) {
        break;
      }

      for (const entry of entries) {
        if (entry.message.nsp === this.nsp.name && entry.message.type === "3") {
          const message = RedisStreamsAdapter.decode(entry.message) as {
            data: any;
          };
          const { packet, opts } = message.data;

          if (shouldIncludePacket(session.rooms, opts)) {
            packet.data.push(entry.id);
            session.missedPackets.push(packet.data);
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
