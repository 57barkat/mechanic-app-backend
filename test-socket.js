// test-socket.js
const { io } = require("socket.io-client");

// Connect to server
const socket = io("http://localhost:3000");

// Join request room
socket.emit("join-request-room", 1);

// Listen for updates from server
socket.on("update-location", (data) => {
  console.log("Mechanic location update:", data);
});

socket.on("update-route", (route) => {
  console.log("Route data:", route);
});

// Send mechanic location every 5 seconds
setInterval(() => {
  const lat = 37.774 + Math.random() * 0.001;
  const lng = -122.431 + Math.random() * 0.001;

  socket.emit("mechanic-location", {
    requestId: 1,
    lat,
    lng,
  });
}, 5000);
