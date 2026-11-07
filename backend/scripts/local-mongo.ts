/**
 * Runs a local MongoDB for development without installing MongoDB, and keeps it running:
 * if it stops for any reason it is restarted, and if another MongoDB already holds the port
 * (a real install or Docker) that one is used until it goes away.
 *
 * Data lives outside the project on purpose. The project sits in a OneDrive folder, and mongod
 * exits with "FileRenameFailed: Access is denied" as soon as anything locks a file it is renaming.
 *
 * mongod is run directly because MongoMemoryServer moves to a random port when restarted,
 * which would leave the API looking for it on the old one.
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { MongoBinary } from 'mongodb-memory-server';

const PORT = Number(process.env.LOCAL_MONGO_PORT ?? 27017);
const LEGACY_DB_PATH = path.resolve(__dirname, '..', '.mongo-data');
const DB_PATH = process.env.LOCAL_MONGO_DBPATH ?? path.join(os.homedir(), '.p2p-workflow', 'mongo-data');
const LOG_PATH = `${DB_PATH}.log`;
const CHECK_INTERVAL_MS = 3000;
const STARTUP_TIMEOUT_MS = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let mongod: ChildProcess | undefined;

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** First run after the move: copies existing data across. The old folder is left untouched. */
function adoptLegacyData() {
  if (fs.existsSync(DB_PATH) || !fs.existsSync(path.join(LEGACY_DB_PATH, 'WiredTiger'))) return;

  const partial = `${DB_PATH}.partial`;
  console.log(`[db] copying existing data from ${LEGACY_DB_PATH} to ${DB_PATH}...`);
  fs.rmSync(partial, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.cpSync(LEGACY_DB_PATH, partial, { recursive: true });
  fs.renameSync(partial, DB_PATH); // only a complete copy ever appears at DB_PATH
}

async function startMongo() {
  adoptLegacyData();
  fs.mkdirSync(DB_PATH, { recursive: true });
  console.log('[db] starting local MongoDB (first run downloads the binary, ~1 min)...');
  const binary = await MongoBinary.getPath();

  const child = spawn(
    binary,
    ['--port', String(PORT), '--bind_ip', '127.0.0.1', '--dbpath', DB_PATH, '--storageEngine', 'wiredTiger', '--logpath', LOG_PATH, '--logappend'],
    { stdio: 'ignore' },
  );
  mongod = child;
  child.once('error', (err) => {
    console.error(`[db] could not run mongod: ${err.message}`);
    mongod = undefined;
  });
  child.once('exit', (code) => {
    console.error(`[db] mongod exited with code ${code}. Details: ${LOG_PATH}`);
    mongod = undefined;
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (mongod === child && Date.now() < deadline) {
    if (await portInUse(PORT)) {
      console.log(`[db] local MongoDB ready on port ${PORT} (data: ${DB_PATH})`);
      return;
    }
    await sleep(250);
  }
}

async function main() {
  let usingExternal = false;

  const stop = () => {
    mongod?.removeAllListeners('exit');
    mongod?.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  for (;;) {
    if (!mongod) {
      if (await portInUse(PORT)) {
        if (!usingExternal) console.log(`[db] MongoDB already running on port ${PORT} - using it`);
        usingExternal = true;
      } else {
        if (usingExternal) console.error(`[db] MongoDB on port ${PORT} stopped - starting a local one`);
        usingExternal = false;
        try {
          await startMongo();
        } catch (err) {
          console.error(`[db] failed to start local MongoDB, will retry: ${(err as Error).message}`);
        }
      }
    }
    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('[db] local MongoDB supervisor failed', err);
  process.exit(1);
});
