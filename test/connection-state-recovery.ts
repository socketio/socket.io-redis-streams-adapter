import { Server } from "socket.io";
import { io as ioc } from "socket.io-client";
import { setup } from "./util";
import expect = require("expect.js");
import { RedisStreamsAdapterOptions } from "../lib";

export function csrTestSuite(
  initRedisClient: () => any,
  adapterOptions: RedisStreamsAdapterOptions = {}
) {
  describe("connection state recovery", () => {
    let servers: Server[];
    let ports: number[];
    let cleanup: () => void;

    beforeEach(async () => {
      const testContext = await setup(
        initRedisClient,
        {
          connectionStateRecovery: {
            maxDisconnectionDuration: 5000,
          },
        },
        adapterOptions
      );
      servers = testContext.servers;
      cleanup = testContext.cleanup;
      ports = testContext.ports;
    });

    afterEach(() => {
      cleanup();
    });

    it("should restore the session", (done) => {
      const socket = ioc(`http://localhost:${ports[0]}`, {
        reconnectionDelay: 20,
      });

      let initialId: string;

      socket.once("connect", () => {
        expect(socket.recovered).to.eql(false);
        initialId = socket.id;

        servers[0].emit("init");
      });

      socket.on("init", () => {
        // under the hood, the client saves the offset of this packet, so now we force the reconnection
        socket.io.engine.close();

        socket.on("connect", () => {
          expect(socket.recovered).to.eql(true);
          expect(socket.id).to.eql(initialId);

          socket.disconnect();
          done();
        });
      });
    });

    it("should restore any missed packets", (done) => {
      const socket = ioc(`http://localhost:${ports[0]}`, {
        reconnectionDelay: 20,
      });

      servers[0].once("connection", (socket) => {
        socket.join("room1");

        socket.on("disconnect", () => {
          // let's send some packets while the client is disconnected
          socket.emit("myEvent", 1);
          servers[0].emit("myEvent", 2);
          servers[0].to("room1").emit("myEvent", 3);

          // those packets should not be received by the client upon reconnection (room mismatch)
          servers[0].to("room2").emit("myEvent", 4);
          servers[0].except("room1").emit("myEvent", 5);
          servers[0].of("/foo").emit("myEvent", 6);
        });
      });

      socket.once("connect", () => {
        servers[1].emit("init");
      });

      socket.on("init", () => {
        // under the hood, the client saves the offset of this packet, so now we force the reconnection
        socket.io.engine.close();

        socket.on("connect", () => {
          // @ts-expect-error _lastOffset is private
          offsets.add(socket._lastOffset);

          expect(socket.recovered).to.eql(true);

          setTimeout(() => {
            expect(events).to.eql([1, 2, 3]);
            expect(offsets.size).to.eql(4);

            socket.disconnect();
            done();
          }, 50);
        });
      });

      const events: number[] = [];
      const offsets = new Set<string>();

      socket.on("myEvent", (val) => {
        events.push(val);
        // note: the offset is updated after the callback execution
        // @ts-expect-error _lastOffset is private
        offsets.add(socket._lastOffset);
      });
    });

    it("should fail to restore an unknown session (invalid session ID)", (done) => {
      const socket = ioc(`http://localhost:${ports[0]}`, {
        reconnectionDelay: 20,
      });

      socket.once("connect", () => {
        // @ts-ignore
        socket._pid = "abc";
        // @ts-ignore
        socket._lastOffset = "507f191e810c19729de860ea";
        // force reconnection
        socket.io.engine.close();

        socket.on("connect", () => {
          expect(socket.recovered).to.eql(false);

          socket.disconnect();
          done();
        });
      });
    });

    it("should fail to restore an unknown session (invalid offset)", (done) => {
      const socket = ioc(`http://localhost:${ports[0]}`, {
        reconnectionDelay: 20,
        upgrade: false,
      });

      socket.once("connect", () => {
        // @ts-ignore
        socket._lastOffset = "abc";
        socket.io.engine.close();

        socket.on("connect", () => {
          expect(socket.recovered).to.eql(false);

          socket.disconnect();
          done();
        });
      });
    });
  });
}
