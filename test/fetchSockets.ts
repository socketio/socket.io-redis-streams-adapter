import type { Server, Socket as ServerSocket } from "socket.io";
import { setup } from "./util";
import expect = require("expect.js");

describe("fetchSockets()", function () {
  let servers: Server[], serverSockets: ServerSocket[], cleanup;

  beforeEach(async () => {
    const testContext = await setup();
    servers = testContext.servers;
    serverSockets = testContext.serverSockets;
    cleanup = testContext.cleanup;
  });

  afterEach(() => cleanup());

  it("returns all socket instances", async () => {
    const sockets = await servers[0].fetchSockets();

    expect(sockets).to.be.an(Array);
    expect(sockets).to.have.length(3);
  });

  it("returns a single socket instance", async () => {
    serverSockets[1].data = "test" as any;

    const [remoteSocket] = await servers[0]
      .in(serverSockets[1].id)
      .fetchSockets();

    expect(remoteSocket.handshake).to.eql(serverSockets[1].handshake);
    expect(remoteSocket.data).to.eql("test");
    expect(remoteSocket.rooms.size).to.eql(1);
  });

  it("returns only local socket instances", async () => {
    const sockets = await servers[0].local.fetchSockets();

    expect(sockets).to.have.length(1);
  });
});
