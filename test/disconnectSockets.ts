import type { Server, Socket as ServerSocket } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import { setup, times } from "./util";
import expect = require("expect.js");

describe("disconnectSockets()", function () {
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

  it("makes all socket instances disconnect", (done) => {
    const partialDone = times(3, done);

    clientSockets.forEach((clientSocket) => {
      clientSocket.on("disconnect", (reason) => {
        expect(reason).to.eql("io server disconnect");
        partialDone();
      });
    });

    servers[0].disconnectSockets();
  });
});
