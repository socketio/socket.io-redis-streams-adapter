import type { Server, Socket as ServerSocket } from "socket.io";
import { setup, sleep } from "./util";
import expect = require("expect.js");

describe("socketsLeave()", () => {
  let servers: Server[], serverSockets: ServerSocket[], cleanup;

  beforeEach(async () => {
    const testContext = await setup();
    servers = testContext.servers;
    serverSockets = testContext.serverSockets;
    cleanup = testContext.cleanup;
  });

  afterEach(() => cleanup());

  it("makes all socket instances leave the specified room", async () => {
    serverSockets[0].join("room1");
    serverSockets[2].join("room1");

    servers[0].socketsLeave("room1");

    await sleep(300);

    expect(serverSockets[0].rooms.has("room1")).to.be(false);
    expect(serverSockets[1].rooms.has("room1")).to.be(false);
    expect(serverSockets[2].rooms.has("room1")).to.be(false);
  });

  it("makes the matching socket instances leave the specified room", async () => {
    serverSockets[0].join(["room1", "room2"]);
    serverSockets[1].join(["room1", "room2"]);
    serverSockets[2].join(["room2"]);

    servers[0].in("room1").socketsLeave("room2");

    await sleep(300);

    expect(serverSockets[0].rooms.has("room2")).to.be(false);
    expect(serverSockets[1].rooms.has("room2")).to.be(false);
    expect(serverSockets[2].rooms.has("room2")).to.be(true);
  });

  it("makes the given socket instance leave the specified room", async () => {
    serverSockets[0].join("room3");
    serverSockets[1].join("room3");
    serverSockets[2].join("room3");

    servers[0].in(serverSockets[1].id).socketsLeave("room3");

    await sleep(300);

    expect(serverSockets[0].rooms.has("room3")).to.be(true);
    expect(serverSockets[1].rooms.has("room3")).to.be(false);
    expect(serverSockets[2].rooms.has("room3")).to.be(true);
  });
});
