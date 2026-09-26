/** SQL shared by production Durable Objects and local SQLite tests. */
export class LeaderboardStore {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS players (name TEXT PRIMARY KEY, games INTEGER NOT NULL, wins INTEGER NOT NULL, kills INTEGER NOT NULL, wears INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS ranking ON players(wins DESC, games ASC, name ASC)');
  }
  record(result) {
    if (!result || typeof result.id !== 'string' || !result.id || !Array.isArray(result.players) || result.players.length > 64 ||
        result.players.some(p => typeof p.name !== 'string' || !p.name.trim() || p.name.length > 24 || typeof p.won !== 'boolean')) throw Error('Invalid match result');
    if (result.players.some(p => ['kills', 'wears'].some(key => !Number.isSafeInteger(p[key] ?? 0) || (p[key] ?? 0) < 0))) throw Error('Invalid match counters');
    this.storage.transactionSync(() => {
      if ([...this.sql.exec('SELECT id FROM results WHERE id = ?', result.id)].length) return;
      this.sql.exec('INSERT INTO results (id) VALUES (?)', result.id);
      for (const p of result.players) this.sql.exec(
        'INSERT INTO players (name, games, wins, kills, wears) VALUES (?, 1, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET games = games + 1, wins = wins + excluded.wins, kills = kills + excluded.kills, wears = wears + excluded.wears',
        p.name.trim(), Number(p.won), p.kills ?? 0, p.wears ?? 0);
    });
  }
  read(name = '') {
    const rows = [...this.sql.exec('SELECT name, games, wins, kills, wears FROM players ORDER BY wins DESC, games ASC, name ASC LIMIT 50')];
    const format = row => ({ ...row, winRate: row.games ? row.wins / row.games : 0 });
    const mine = name ? [...this.sql.exec('SELECT name, games, wins, kills, wears FROM players WHERE name = ?', name.trim())][0] : null;
    return { rows: rows.map((row, i) => ({ ...format(row), rank: i + 1 })), player: mine ? format(mine) : null };
  }
}
