import type { Server, Socket as ServerSocket } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import { setup, sleep, times } from "./util";
import expect = require("expect.js");

describe("broadcast()", function () {
  let servers: Server[],
    serverSockets: ServerSocket[],
    clientSockets: ClientSocket[],
    cleanup;

  beforeEach(async () => {
    const testContext = await setup();
    servers = testContext.servers;
    serverSockets = testContext.serverSockets;
    clientSockets = testContext.clientSockets;
    cleanup = testContext.cleanup;
  });

  afterEach(() => cleanup());

  it("broadcasts to all clients", (done) => {
    const partialDone = times(3, done);

    clientSockets.forEach((clientSocket, index) => {
      clientSocket.on("test", (arg1, arg2, arg3) => {
        expect(arg1).to.eql(1);
        expect(arg2).to.eql("2");
        expect(Buffer.isBuffer(arg3)).to.be(true);
        partialDone();
      });
    });

    servers[0].emit("test", 1, "2", Buffer.from([3, 4]));
  });

  it("broadcasts to all clients in a namespace", (done) => {
    const partialDone = times(3, done);

    servers.forEach((server) => server.of("/custom"));

    const onConnect = times(3, async () => {
      await sleep(200);

      servers[0].of("/custom").emit("test");
    });

    clientSockets.forEach((clientSocket) => {
      const socket = clientSocket.io.socket("/custom");
      socket.on("connect", onConnect);
      socket.on("test", () => {
        socket.disconnect();
        partialDone();
      });
    });
  });

  it("broadcasts to all clients in a room", (done) => {
    serverSockets[1].join("room1");

    clientSockets[0].on("test", () => {
      done(new Error("should not happen"));
    });

    clientSockets[1].on("test", () => {
      done();
    });

    clientSockets[2].on("test", () => {
      done(new Error("should not happen"));
    });

    servers[0].to("room1").emit("test");
  });

  it("broadcasts to all clients except in room", (done) => {
    const partialDone = times(2, done);
    serverSockets[1].join("room1");

    clientSockets[0].on("test", () => {
      partialDone();
    });

    clientSockets[1].on("test", () => {
      done(new Error("should not happen"));
    });

    clientSockets[2].on("test", () => {
      partialDone();
    });

    servers[0].of("/").except("room1").emit("test");
  });

  it("broadcasts to local clients only", (done) => {
    clientSockets[0].on("test", () => {
      done();
    });

    clientSockets[1].on("test", () => {
      done(new Error("should not happen"));
    });

    clientSockets[2].on("test", () => {
      done(new Error("should not happen"));
    });

    servers[0].local.emit("test");
  });

  it("broadcasts with multiple acknowledgements", (done) => {
    clientSockets[0].on("test", (cb) => {
      cb(1);
    });

    clientSockets[1].on("test", (cb) => {
      cb(2);
    });

    clientSockets[2].on("test", (cb) => {
      cb(3);
    });

    servers[0].timeout(500).emit("test", (err: Error, responses: any[]) => {
      expect(err).to.be(null);
      expect(responses).to.contain(1);
      expect(responses).to.contain(2);
      expect(responses).to.contain(3);

      done();
    });
  });

  it("broadcasts with multiple acknowledgements (binary content)", (done) => {
    clientSockets[0].on("test", (cb) => {
      cb(Buffer.from([1]));
    });

    clientSockets[1].on("test", (cb) => {
      cb(Buffer.from([2]));
    });

    clientSockets[2].on("test", (cb) => {
      cb(Buffer.from([3]));
    });

    servers[0].timeout(500).emit("test", (err: Error, responses: any[]) => {
      expect(err).to.be(null);
      responses.forEach((response) => {
        expect(response instanceof Uint8Array).to.be(true);
      });

      done();
    });
  });

  it("broadcasts with multiple acknowledgements (no client)", (done) => {
    servers[0]
      .to("abc")
      .timeout(500)
      .emit("test", (err: Error, responses: any[]) => {
        expect(err).to.be(null);
        expect(responses).to.eql([]);

        done();
      });
  });

  it("broadcasts with multiple acknowledgements (timeout)", (done) => {
    clientSockets[0].on("test", (cb) => {
      cb(1);
    });

    clientSockets[1].on("test", (cb) => {
      cb(2);
    });

    clientSockets[2].on("test", () => {
      // do nothing
    });

    servers[0].timeout(500).emit("test", (err: Error, responses: any[]) => {
      expect(err).to.be.an(Error);
      expect(responses).to.contain(1);
      expect(responses).to.contain(2);

      done();
    });
  });
});
