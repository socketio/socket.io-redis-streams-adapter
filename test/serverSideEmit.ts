import type { Server } from "socket.io";
import { setup, times } from "./util";
import expect = require("expect.js");

describe("serverSideEmit()", function () {
  let servers: Server[], cleanup;

  beforeEach(async () => {
    const testContext = await setup();
    servers = testContext.servers;
    cleanup = testContext.cleanup;
  });

  afterEach(() => cleanup());

  it("sends an event to other server instances", (done) => {
    const partialDone = times(2, done);

    servers[0].serverSideEmit("hello", "world", 1, "2");

    servers[0].on("hello", () => {
      done(new Error("should not happen"));
    });

    servers[1].on("hello", (arg1, arg2, arg3) => {
      expect(arg1).to.eql("world");
      expect(arg2).to.eql(1);
      expect(arg3).to.eql("2");
      partialDone();
    });

    servers[2].of("/").on("hello", () => {
      partialDone();
    });
  });

  it("sends an event and receives a response from the other server instances", (done) => {
    servers[0].serverSideEmit("hello", (err: Error, response: any) => {
      expect(err).to.be(null);
      expect(response).to.be.an(Array);
      expect(response).to.contain(2);
      expect(response).to.contain("3");
      done();
    });

    servers[0].on("hello", () => {
      done(new Error("should not happen"));
    });

    servers[1].on("hello", (cb) => {
      cb(2);
    });

    servers[2].on("hello", (cb) => {
      cb("3");
    });
  });

  it("sends an event but timeout if one server does not respond", function (done) {
    // TODO the serverSideEmit() method currently ignores the timeout() flag
    this.timeout(6000);

    servers[0].serverSideEmit("hello", (err: Error, response: any) => {
      expect(err.message).to.be(
        "timeout reached: only 1 responses received out of 2"
      );
      expect(response).to.be.an(Array);
      expect(response).to.contain(2);
      done();
    });

    servers[0].on("hello", () => {
      done(new Error("should not happen"));
    });

    servers[1].on("hello", (cb) => {
      cb(2);
    });

    servers[2].on("hello", () => {
      // do nothing
    });
  });
});
