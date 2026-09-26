// Display coordinates only. Rooms and valid actions remain server-owned.
export function layoutHomes(players) {
  const cols = Math.max(2, Math.ceil(Math.sqrt(players.length)));
  const rows = Math.max(1, Math.ceil(players.length / cols));
  return new Map(players.map((p, i) => [p.home ?? p.id, {
    x: (i % cols - (cols - 1) / 2) * 6.4,
    z: (Math.floor(i / cols) - (rows - 1) / 2) * 6.4,
  }]));
}
export function residentPoint(player, players, homes) {
  const home = homes.get(player.location ?? player.home) || { x: 0, z: 0 };
  const residents = players.filter(p => (p.location ?? p.home) === (player.location ?? player.home));
  const index = Math.max(0, residents.findIndex(p => p.id === player.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(residents.length)));
  const rows = Math.ceil(residents.length / columns), spacing = Math.min(1.3, 3.6 / Math.max(1, columns - 1));
  return { x: home.x + (index % columns - (columns - 1) / 2) * spacing, z: home.z + .35 + (Math.floor(index / columns) - (rows - 1) / 2) * spacing };
}
export function travelPoint(job, time, homes, fallbackHome) {
  const start = homes.get(job.from ?? fallbackHome) || { x: 0, z: 0 };
  const end = homes.get(job.target) || start;
  const t = Math.max(0, Math.min(1, (time - job.startedAt) / (job.endsAt - job.startedAt)));
  // A visual arc is not a shared outdoor location or a collision path.
  return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t + 3 + Math.sin(Math.PI * t) * 1.2, t };
}
