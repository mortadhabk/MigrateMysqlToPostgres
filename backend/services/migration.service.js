const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DOCKER_COMPOSE_PATH = process.env.DOCKER_COMPOSE_PATH || path.resolve(__dirname, '../../containers');

/**
 * Logging utility with real-time callback
 */
class Logger {
  constructor(logPath, onLog = null) {
    this.logPath = logPath;
    this.onLog = onLog;
    fs.writeFileSync(logPath, '');
  }

  log(level, message, extra = undefined) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      type: 'log',
      timestamp,
      level,
      message,
      ...(extra ? { extra } : {})
    };
    const logLine = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(this.logPath, logLine, 'utf8');
    if (this.onLog) this.onLog(logEntry);
    console.log(`[${level}] ${message}`);
  }

  info(message, extra) { this.log('INFO', message, extra); }
  warn(message, extra) { this.log('WARN', message, extra); }
  error(message, extra) { this.log('ERROR', message, extra); }
}

/**
 * Spawn a child process and capture output
 */
function execProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) resolve({ code, stdout, stderr });
      else reject({ code, stdout, stderr });
    });

    child.on('error', (err) => reject(err));
  });
}

/**
 * Load containers/.env into process.env (real load)
 */
function loadContainerEnv(logger) {
  const containerEnvPath = path.join(DOCKER_COMPOSE_PATH, '.env');

  if (!fs.existsSync(containerEnvPath)) {
    logger.warn(`No .env found at ${containerEnvPath} - using current process.env only`);
    return;
  }

  const result = dotenv.config({
    path: containerEnvPath,
    // override false: do NOT override existing env by default
    override: false,
  });

  if (result.error) {
    throw result.error;
  }

  logger.info(`Loaded environment variables from ${containerEnvPath}`);
}

/**
 * Safely parse int env
 */
function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Extract database name from MySQL dump file
 */
function extractDatabaseName(dumpPath) {
  const content = fs.readFileSync(dumpPath, 'utf8');

  const createDbMatch = content.match(/CREATE DATABASE(?:\s+IF NOT EXISTS)?\s+`?([^`;\s]+)`?/i);
  if (createDbMatch) return createDbMatch[1];

  const useDbMatch = content.match(/USE\s+`?([^`;\s]+)`?/i);
  if (useDbMatch) return useDbMatch[1];

  return process.env.DATABASE_NAME || process.env.MYSQL_DATABASE;
}

/**
 * URL encode special characters in database credentials
 */
function encodeCredentials(str) {
  if (!str) return '';
  return String(str).replace(/[:'@/?#\[\]]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Prepare database dump file
 */
async function prepareDumpFile(uploadedFile, migrationId, logger) {
  logger.info('Preparing MySQL dump file...');

  const migrationDumpDir = path.join(DOCKER_COMPOSE_PATH, 'sql-dump', migrationId);
  const dumpPath = path.join(migrationDumpDir, 'dump.sql');

  if (!fs.existsSync(migrationDumpDir)) fs.mkdirSync(migrationDumpDir, { recursive: true });

  fs.copyFileSync(uploadedFile, dumpPath);
  logger.info(`Dump file prepared at ${dumpPath}`);

  return dumpPath;
}

/**
 * Create pgloader configuration file from env + dump analysis
 */
async function createPgloaderConfig(migrationId, dumpPath, logger) {
  logger.info('Creating pgloader configuration...');

  const requiredEnvVars = [
    'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_ROOT_PASSWORD','MYSQL_ROOT',
    'POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
    'MYSQL_PORT_INTERNAL', 'POSTGRES_PORT_INTERNAL'
  ];

  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  const mysqlHost = process.env.MYSQL_HOST;
  const mysqlPort = envInt('MYSQL_PORT_INTERNAL', 3306);
  const mysqlUser = process.env.MYSQL_ROOT;
  const mysqlPassword = encodeCredentials(process.env.MYSQL_ROOT_PASSWORD);

  const mysqlDb = extractDatabaseName(dumpPath);
  if (!mysqlDb) throw new Error('Unable to determine MySQL database name from dump or environment variables');
  logger.info(`Detected MySQL database name: ${mysqlDb}`);

  const pgHost = process.env.POSTGRES_HOST;
  const pgPort = envInt('POSTGRES_PORT_INTERNAL', 5432);
  const pgUser = process.env.POSTGRES_USER;
  const pgPassword = encodeCredentials(process.env.POSTGRES_PASSWORD);
  const pgDb = process.env.POSTGRES_DB;

  const config = `LOAD DATABASE
    FROM mysql://${mysqlUser}:${mysqlPassword}@${mysqlHost}:${mysqlPort}/${mysqlDb}
    INTO postgres://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDb}

WITH include drop,
     create tables,
     create indexes,
     reset sequences,
     workers = 8,
     concurrency = 1

EXCLUDING TABLE NAMES MATCHING '_*'
;`;

  const configDir = path.join(DOCKER_COMPOSE_PATH, 'migration');
  const configPath = path.join(configDir, `load-${migrationId}.load`);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(configPath, config, 'utf8');
  logger.info(`Pgloader config created at ${configPath}`);

  return configPath;
}

/**
 * Start Docker containers with project isolation
 */
async function startDockerContainers(migrationId, logger) {
  logger.info('Starting Docker containers...');

  const projectName = `migration-${migrationId}`;
  logger.info(`Using Docker Compose project: ${projectName}`);

  const env = {
    ...process.env,
    MIGRATION_ID: migrationId
  };

  try {
    const result = await execProcess('docker-compose', [
      '-p', projectName,
      'up', '--build', '-d'
    ], {
      cwd: DOCKER_COMPOSE_PATH,
      env
    });

    result.stdout.split('\n').filter(Boolean).forEach(line => logger.info(`Docker: ${line}`));
    logger.info('Docker containers started successfully');
} catch (err) {
  logger.error('Docker startup failed (details below)');
  logger.error(`docker compose stdout:\n${(err.stdout || '').trim() || '(empty)'}`);
  logger.error(`docker compose stderr:\n${(err.stderr || '').trim() || '(empty)'}`);
  logger.error(`docker compose message: ${err.message || '(no message)'}`);

  throw new Error('Docker Compose failed to start');
}
}

/**
 * Simple sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure dump file is mounted correctly in MySQL container
 */
async function verifyDumpMounted(migrationId, logger) {
  const mysqlContainerName = `migration-${migrationId}-mysql-source-1`;

  try {
    const ls = await execProcess('docker', [
      'exec', mysqlContainerName, 'sh', '-lc', 'ls -la /docker-entrypoint-initdb.d'
    ]);
    logger.info('MySQL initdb.d content:', { content: ls.stdout });

    if (!ls.stdout.includes('dump.sql')) {
      logger.warn(
        'dump.sql not visible inside /docker-entrypoint-initdb.d. ' +
        'Your volume mount may be pointing to the wrong folder (MIGRATION_ID mismatch).'
      );
    }
  } catch (e) {
    logger.warn(`Unable to verify initdb.d mount: ${e.message}`);
  }
}

/**
 * Wait for databases to be ready + verify MySQL has loaded user DB/tables
 */
async function waitForDatabases(migrationId, dumpPath, logger, maxAttempts = 120) {
  logger.info('Waiting for databases to be ready...');

  const mysqlContainerName = `migration-${migrationId}-mysql-source-1`;
  const pgContainerName = `migration-${migrationId}-postgres-target-1`;

  const startedAt = Date.now();
  const mysqlDb = extractDatabaseName(dumpPath);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const mysqlHealthResult = await execProcess('docker', [
        'inspect', '--format', '{{.State.Health.Status}}', mysqlContainerName
      ]);
      const pgHealthResult = await execProcess('docker', [
        'inspect', '--format', '{{.State.Health.Status}}', pgContainerName
      ]);

      const mysqlHealth = mysqlHealthResult.stdout.trim();
      const pgHealth = pgHealthResult.stdout.trim();

      if (mysqlHealth === 'healthy' && pgHealth === 'healthy') {
        const readyIn = ((Date.now() - startedAt) / 1000).toFixed(1);
        logger.info(`MySQL/PostgreSQL healthy after ${attempt} checks (${readyIn}s)`);

        await verifyDumpMounted(migrationId, logger);

        // Allow MySQL init scripts to finish
        logger.info('Waiting 10 seconds for MySQL init scripts to complete...');
        await sleep(10000);

        // Verify MySQL contains the expected DB and at least one table
        const mysqlUser =  process.env.MYSQL_ROOT;
        const mysqlPassword = process.env.MYSQL_ROOT_PASSWORD;
          

        const cmd = [
          'exec', mysqlContainerName,
          'mysql', '-u', mysqlUser
        ];
        if (mysqlPassword) cmd.push(`-p${mysqlPassword}`);

        cmd.push('-e', `SHOW DATABASES; USE \`${mysqlDb}\`; SHOW TABLES;`);

        try {
          const check = await execProcess('docker', cmd);
          logger.info(`MySQL verification for DB ${mysqlDb}:`, { output: check.stdout });

          const hasTables = check.stdout.split('\n').some(line =>
            line.trim() && !['Tables_in_' + mysqlDb, ''].includes(line.trim())
          );

          if (!hasTables) {
            logger.warn(
              `Database ${mysqlDb} is present but has no tables. ` +
              `Most common cause: MySQL init scripts didn't run because mysql-data volume already existed.`
            );
          }
        } catch (e) {
          logger.warn(`Could not verify MySQL DB/tables: ${e.stderr || e.message}`);
        }

        return;
      }

      if (attempt <= 3 || attempt % 10 === 0) {
        logger.info(`Waiting... (${attempt}/${maxAttempts}) MySQL: ${mysqlHealth}, PostgreSQL: ${pgHealth}`);
      }

      await sleep(2000);
    } catch (err) {
      if (attempt <= 3 || attempt % 10 === 0) {
        logger.info(`Waiting... (${attempt}/${maxAttempts})`);
      }
      await sleep(2000);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  logger.warn(`Database readiness timeout after ${elapsed}s - proceeding anyway`);
}

/**
 * Run pgloader migration
 */
async function runPgloaderMigration(migrationId, logger) {
  logger.info('Starting pgloader migration...');
  const pgloaderContainerName = `migration-${migrationId}-pgloader-1`;

  try {
    const result = await execProcess(
      'docker',
      [
        'exec',
        pgloaderContainerName,
        'pgloader',
        `/migration/load-${migrationId}.load`
      ],
      { env: process.env }
    );

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = `${stdout}\n${stderr}`;

    // Log stdout/stderr lines
    stdout
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .forEach(line => logger.info(`pgloader: ${line}`));

    stderr
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .forEach(line => logger.warn(`pgloader(stderr): ${line}`));

    /**
     * IMPORTANT:
     * pgloader peut sortir un code 0 même si une erreur s'est produite
     * (ex: "ERROR mysql: Failed to connect ...")
     * Donc on détecte les patterns d'erreur.
     */
    const errorPatterns = [
      /ERROR\s+mysql:/i,
      /Failed to connect/i,
      /MySQL Error\s*\[\d+\]/i,
      /FATAL/i,
      /Unhandled/i,
      /signal\s+\d+/i
    ];

    const hasError = errorPatterns.some((re) => re.test(combined));

    // Optionnel: si tu veux aussi échouer quand rien n'a été migré
    // (utile pour éviter les dumps vides "silencieux")
    const looksLikeNoWork =
      /fetch meta data\s+0\s+0\s+0/i.test(combined) ||
      /table name errors rows bytes total time/i.test(combined) && /fetch meta data\s+0/i.test(combined);

    if (hasError) {
      throw new Error('pgloader reported an error (see logs above).');
    }

    if (looksLikeNoWork) {
      // à toi de décider: warn ou throw. Pour éviter les dumps vides, je recommande throw.
      throw new Error('pgloader finished but migrated 0 tables/rows (source DB empty or access denied).');
    }

    logger.info('pgloader migration completed successfully');
  } catch (err) {
    // err peut être une Error simple ou un objet {stdout, stderr, code}
    logger.error('pgloader failed', {
      message: err.message,
      code: err.code,
      stdout: err.stdout,
      stderr: err.stderr
    });
    throw new Error(`pgloader migration failed: ${err.message || 'unknown error'}`);
  }
}


/**
 * Verify Postgres tables exist after migration (before dumping)
 */
async function verifyPostgresHasTables(migrationId, logger) {
  const pgContainerName = `migration-${migrationId}-postgres-target-1`;
  const pgUser = process.env.POSTGRES_USER || 'postgres';
  const pgDb = process.env.POSTGRES_DB || 'target_db';

  try {
    const res = await execProcess('docker', [
      'exec', pgContainerName,
      'psql', '-U', pgUser, '-d', pgDb, '-c', "\\dt"
    ]);

    logger.info('Postgres \\dt output:', { output: res.stdout });

    if (res.stdout.includes('Did not find any relations')) {
      logger.warn('Postgres has no tables. The migration likely copied nothing (MySQL DB empty or pgloader excluded everything).');
      return false;
    }
    return true;
  } catch (e) {
    logger.warn(`Could not verify Postgres tables: ${e.stderr || e.message}`);
    return false;
  }
}

/**
 * Export PostgreSQL dump (always dump the correct DB)
 */
async function exportPostgresDump(migrationId, logger) {
  logger.info('Exporting PostgreSQL dump...');

  const pgContainerName = `migration-${migrationId}-postgres-target-1`;
  const outputDir = path.join(DOCKER_COMPOSE_PATH, 'output');
  const outputPath = path.join(outputDir, `postgres_dump_${migrationId}.sql`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const pgUser = process.env.POSTGRES_USER || 'postgres';
  const pgDb = process.env.POSTGRES_DB || 'target_db';

  logger.info(`pg_dump will use: user=${pgUser}, db=${pgDb}`);

  try {
    const result = await execProcess('docker', [
      'exec', pgContainerName,
      'pg_dump',
      '-U', pgUser,
      '-d', pgDb,
      '--no-owner',
      '--no-privileges'
    ]);

    fs.writeFileSync(outputPath, result.stdout, 'utf8');
    logger.info(`PostgreSQL dump exported to ${outputPath}`);

    return outputPath;
  } catch (err) {
    logger.error('pg_dump failed', { stderr: err.stderr, stdout: err.stdout });
    throw new Error('PostgreSQL dump export failed');
  }
}

async function getDockerComposeCommand() {
  try {
    await execProcess('docker', ['compose', 'version']);
    return { cmd: 'docker', baseArgs: ['compose'] };
  } catch (_) {}

  try {
    await execProcess('docker-compose', ['version']);
    return { cmd: 'docker-compose', baseArgs: [] };
  } catch (_) {}

  throw new Error('Neither "docker compose" nor "docker-compose" is available.');
}



async function cleanupDockerProject(migrationId, logger) {
  const projectName = `migration-${migrationId}`;

  logger.info('--- Docker cleanup start ---');
  logger.info(`Project name: ${projectName}`);
  logger.info(`Compose working dir: ${DOCKER_COMPOSE_PATH}`);

  try {
    const compose = await getDockerComposeCommand();
    logger.info(`Using compose command: ${compose.cmd} ${compose.baseArgs.join(' ') || '(v1)'}`);

    const args = [...compose.baseArgs, '-p', projectName, 'down', '-v'];
    logger.info(`Running: ${compose.cmd} ${args.join(' ')}`);

    const result = await execProcess(
      compose.cmd,
      args,
      { cwd: DOCKER_COMPOSE_PATH, env: { ...process.env, MIGRATION_ID: migrationId } }
    );

    logger.info(`docker compose down exit code: ${result.code}`);

    const out = (result.stdout || '').trim();
    const err = (result.stderr || '').trim();

    // Sur succès, on loggue stdout/stderr en INFO (pas WARN)
    logger.info(`docker compose down stdout:\n${out || '(empty)'}`);

    logger.info('Docker cleanup completed successfully');
  } catch (err) {
    // Ici c'est un vrai problème de cleanup (ou projet inexistant)
    logger.warn('Docker cleanup failed or skipped');
    logger.warn(`Reason: ${err.message || '(no message)'}`);

    const out = (err.stdout || '').trim();
    const sterr = (err.stderr || '').trim();

    if (out) logger.warn(`stdout:\n${out}`);
    if (sterr) logger.warn(`stderr:\n${sterr}`);

    logger.warn('Proceeding without cleanup (this is usually OK for first run)');
  } finally {
    logger.info('--- Docker cleanup end ---');
  }
}


/**
 * Main migration orchestrator
 */
async function startMigration(migration, onLog = null) {
  const logger = new Logger(migration.logPath, onLog);

  try {
    logger.info(`Starting migration ${migration.id}`);
    logger.info(`File: ${migration.fileName}`);

    // 0) Load containers/.env into Node env
    loadContainerEnv(logger);

    // 1) Prepare dump file
    const dumpPath = await prepareDumpFile(migration.uploadedFile, migration.id, logger);

    // 2) Create pgloader config (extract DB name from dump)
    await createPgloaderConfig(migration.id, dumpPath, logger);

    // 3) Start docker containers (MIGRATION_ID is passed)
    await startDockerContainers(migration.id, logger);

    // 4) Wait for db readiness + verify MySQL has tables
    await waitForDatabases(migration.id, dumpPath, logger);

    // 5) Run pgloader
    await runPgloaderMigration(migration.id, logger);

    // 6) Verify Postgres has tables BEFORE dumping
    await verifyPostgresHasTables(migration.id, logger);

    // 7) Export dump
    const outputFile = await exportPostgresDump(migration.id, logger);


    logger.info('Migration completed successfully');

    // Juste après loadContainerEnv(logger)
    await cleanupDockerProject(migration.id, logger);

    return { success: true, outputFile };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);

    try {
       await cleanupDockerProject(migration.id, logger);
    } catch (cleanupError) {
      logger.error(`Cleanup error: ${cleanupError.message}`);
    }

    throw error;
  }
}

module.exports = { startMigration };
