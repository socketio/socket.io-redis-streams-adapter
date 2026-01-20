import { Redis } from "ioredis";
import { Server } from "socket.io";
import { io as ioc } from "socket.io-client";
import { createAdapter } from "../../dist/index.js";

const redisClient = new Redis();

const io = new Server({
  adapter: createAdapter(redisClient),
});

io.on("connection", (socket) => {
  socket.join("sample room");

  socket.emit("test", "to socket");
  io.emit("test", "to all");
  io.to("sample room").emit("test", "to room");
});

const namespace = io.of("/custom");

namespace.on("connection", (socket) => {
  socket.join("sample room");

  socket.emit("test", "to socket (2)");
  namespace.emit("test", "to all (2)");
  namespace.to("sample room").emit("test", "to room (2)");
});

io.listen(3000);

const socket = ioc("http://localhost:3000");

socket.on("connect", () => {
  console.log("[main] on connect");
});

socket.on("disconnect", (reason) => {
  console.log("[main] on disconnect", reason);
});

socket.on("test", (from) => {
  console.log("[main] on event", from);
});

const customSocket = ioc("http://localhost:3000/custom");

customSocket.on("connect", () => {
  console.log("[custom] on connect");
});

customSocket.on("disconnect", (reason) => {
  console.log("[custom] on disconnect", reason);
});

customSocket.on("test", (from) => {
  console.log("[custom] on event", from);
});
