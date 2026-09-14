// Explicit desktop maintenance; preserves settings, sessions and database schema.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const database = 'C:/Users/USER/AppData/Roaming/brandconnect-automation/data/blogautomcp.db';
const tables = ['Log', 'Post', 'TopicDraftImage', 'TopicDraft', 'TopicCampaign', 'TopicPostTask', 'BrandLink'];
const db = new DatabaseSync(database);
const counts = () => Object.fromEntries([...tables, 'Setting', 'Session'].map(t => [t, db.prepare(`SELECT COUNT(*) AS count FROM "${t}"`).get().count]));
const before = counts();
if (process.argv[2] === 'apply') {
  const backupRoot = path.resolve(process.argv[3] || '');
  const allowedRoot = path.resolve('C:/Users/USER/Documents/blogautomcp-reset-backups');
  if (!backupRoot.startsWith(allowedRoot + path.sep) || !fs.existsSync(backupRoot)) throw new Error('Expected existing backup directory');
  const backup = path.join(backupRoot, 'blogautomcp.before-reset.db');
  if (fs.existsSync(backup)) throw new Error('Refusing backup overwrite');
  db.prepare('VACUUM INTO ?').run(backup);
  const preserved = ['Setting', 'Session'].map(t => JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()));
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
  try {
    for (const t of tables) db.exec(`DELETE FROM "${t}";`);
    for (const [i,t] of ['Setting', 'Session'].entries()) {
      if (preserved[i] !== JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())) throw new Error('Preserved records changed');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed');
    db.exec('COMMIT;');
  } catch (error) { db.exec('ROLLBACK;'); throw error; }
  const report = { before, after: counts(), backup, integrity: db.prepare('PRAGMA integrity_check').get() };
  fs.writeFileSync(path.join(backupRoot, 'database-reset-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} else console.log(JSON.stringify({ database, counts: before }));
db.close();
