const network = document.getElementById("statusbar-network");
const dot = document.getElementById("statusbar-network-dot");
const clock = document.getElementById("statusbar-clock");
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});
function updateNetwork() {
  network.textContent = navigator.onLine ? "Network: online" : "Network: offline";
  dot.classList.toggle("offline", !navigator.onLine);
}
function tick() {
  const date = new Date();
  clock.dateTime = date.toISOString();
  clock.textContent = `${formatter.format(date)} UTC+8`;
}
document.getElementById("statusbar-connection").textContent = location.protocol === "https:"
  ? "Connection: HTTPS"
  : "Connection: local HTTP";
globalThis.addEventListener("online", updateNetwork);
globalThis.addEventListener("offline", updateNetwork);
updateNetwork();
tick();
setInterval(tick, 1000);
