import type { Server, Socket as ServerSocket } from "socket.io";
import { setup, sleep } from "./util";
import expect = require("expect.js");

describe("socketsJoin()", () => {
  let servers: Server[], serverSockets: ServerSocket[], cleanup;

  beforeEach(async () => {
    const testContext = await setup();
    servers = testContext.servers;
    serverSockets = testContext.serverSockets;
    cleanup = testContext.cleanup;
  });

  afterEach(() => cleanup());

  it("makes all socket instances join the specified room", async () => {
    servers[0].socketsJoin("room1");

    await sleep(200);

    expect(serverSockets[0].rooms.has("room1")).to.be(true);
    expect(serverSockets[1].rooms.has("room1")).to.be(true);
    expect(serverSockets[2].rooms.has("room1")).to.be(true);
  });

  it("makes the matching socket instances join the specified room", async () => {
    serverSockets[0].join("room1");
    serverSockets[2].join("room1");

    servers[0].in("room1").socketsJoin("room2");

    await sleep(200);

    expect(serverSockets[0].rooms.has("room2")).to.be(true);
    expect(serverSockets[1].rooms.has("room2")).to.be(false);
    expect(serverSockets[2].rooms.has("room2")).to.be(true);
  });

  it("makes the given socket instance join the specified room", async () => {
    servers[0].in(serverSockets[1].id).socketsJoin("room3");

    await sleep(200);

    expect(serverSockets[0].rooms.has("room3")).to.be(false);
    expect(serverSockets[1].rooms.has("room3")).to.be(true);
    expect(serverSockets[2].rooms.has("room3")).to.be(false);
  });
});
