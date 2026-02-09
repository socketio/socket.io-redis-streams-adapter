# Changelog

| Version                  | Date          |
|--------------------------|---------------|
| [0.3.0](#030-2026-02-09) | February 2026 |
| [0.2.3](#023-2025-11-25) | November 2025 |
| [0.2.2](#022-2024-05-08) | May 2024      |
| [0.2.1](#021-2024-03-11) | March 2024    |
| [0.2.0](#020-2024-02-21) | February 2024 |
| [0.1.0](#010-2023-04-06) | April 2023    |


## [0.3.0](https://github.com/socketio/socket.io-redis-streams-adapter/compare/0.2.3...0.3.0) (2026-02-09)


### Features

#### Add multiplexing support

The `streamCount` option is added to be able to use multiple Redis streams, allowing to split the load between several Redis nodes.

Note: each namespace is routed to a specific stream to ensure the ordering of messages, so this option only improves scalability when using multiple namespaces.

```js
const io = new Server({
  adapter: createAdapter(redisClient, {
    streamCount: 4
  })
});
```

Added in [ee693d0](https://github.com/socketio/socket.io-redis-streams-adapter/commit/ee693d0024c20cc222e093b2cb9d240e24148875).

#### Add option to skip hasBinary() checks

The `onlyPlaintext` option allows skipping the `hasBinary()` checks during payload serialization (those checks are necessary as binary data must be base-64 encoded before being sent in the Redis stream).

```js
const io = new Server({
  adapter: createAdapter(redisClient, {
    onlyPlaintext: true
  })
});
```

Added in [1f7e6fc](https://github.com/socketio/socket.io-redis-streams-adapter/commit/1f7e6fc18f58fd3d236d564f3a676c48384826e3).

#### Make BLOCK timeout configurable ()

The `blockTimeInMs` option allows configuring the BLOCK timeout used when fetching data from the Redis stream:

```js
const io = new Server({
  adapter: createAdapter(redisClient, {
    blockTimeInMs: 2_000
  })
});
```

Added in [e7653c4](https://github.com/socketio/socket.io-redis-streams-adapter/commit/e7653c4f16eb0dd55f055cf75c989da60b1e3280).

#### Use PUB/SUB for fetchSockets() and serverSideEmit() requests

Redis PUB/SUB is now used for transient requests, instead of sending them in the Redis stream.

Two new options:

- `channelPrefix`: the prefix of the Redis PUB/SUB channels (defaults to "socket.io")
- `useShardedPubSub`: whether to use sharded PUB/SUB (added in Redis 7.0) (defaults to false)

Each server will use two PUB/SUB channels:

- one common for receiving requests
- one private for receiving responses

Added in [dacb88d](https://github.com/socketio/socket.io-redis-streams-adapter/commit/dacb88dbd6a8475b34feb213155002caac6dfbc8).



## [0.2.3](https://github.com/socketio/socket.io-redis-streams-adapter/compare/0.2.2...0.2.3) (2025-11-25)


### Bug Fixes

* **CSR:** include the offset in the restored packets ([#40](https://github.com/socketio/socket.io-redis-streams-adapter/issues/40)) ([c260f17](https://github.com/socketio/socket.io-redis-streams-adapter/commit/c260f1790276f7454944524117e1645506eace54))



## [0.2.2](https://github.com/socketio/socket.io-redis-streams-adapter/compare/0.2.1...0.2.2) (2024-05-08)

The `redis` package is no longer required if you use the `ioredis` package to create a Redis client.



## [0.2.1](https://github.com/socketio/socket.io-redis-streams-adapter/compare/0.2.0...0.2.1) (2024-03-11)


### Bug Fixes

* ensure CSR works with a Redis cluster ([d2d635d](https://github.com/socketio/socket.io-redis-streams-adapter/commit/d2d635dbfe506f6af80025a2bfd9b157b5941ab3))
* ensure CSR works with the ioredis package ([78075ec](https://github.com/socketio/socket.io-redis-streams-adapter/commit/78075ec6663f839d80972520d89eca994a09ae8f))



## [0.2.0](https://github.com/socketio/socket.io-redis-streams-adapter/compare/0.1.0...0.2.0) (2024-02-21)


### Features

* add support for the ioredis package ([58faa1d](https://github.com/socketio/socket.io-redis-streams-adapter/commit/58faa1d9c8cf87282b8643ed0c1aa79322b81852))
* allow to modify the Redis key for the session ([1898586](https://github.com/socketio/socket.io-redis-streams-adapter/commit/18985863d8eca842c59fa57e396a72c01123e61d))


## 0.1.0 (2023-04-06)

First release!
