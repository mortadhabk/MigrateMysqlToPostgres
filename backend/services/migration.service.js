const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOCKER_COMPOSE_PATH = process.env.DOCKER_COMPOSE_PATH || '../containers';

/**
 * Logging utility with real-time callback
 */
class Logger {
  constructor(logPath, onLog = null) {
    this.logPath = logPath;
    this.onLog = onLog;
    fs.writeFileSync(logPath, '');
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = { 
      type: 'log',
      timestamp, 
      level, 
      message 
    };
    const logLine = JSON.stringify(logEntry) + '\n';
    
    // Write to file
    fs.appendFileSync(this.logPath, logLine, 'utf8');
    
    // Send real-time callback
    if (this.onLog) {
      this.onLog(logEntry);
    }
    
    // Also log to console
    console.log(`[${level}] ${message}`);
  }

  info(message) { this.log('INFO', message); }
  warn(message) { this.log('WARN', message); }
  error(message) { this.log('ERROR', message); }
}

/**
 * Spawn a child process and capture output
 */
function execProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject({ code, stdout, stderr });
      }
    });

    process.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Extract database name from MySQL dump file
 */
function extractDatabaseName(dumpPath) {
  const content = fs.readFileSync(dumpPath, 'utf8');
  
  // Look for CREATE DATABASE or USE statements
  const createDbMatch = content.match(/CREATE DATABASE(?:\s+IF NOT EXISTS)?\s+`?([^`;\s]+)`?/i);
  if (createDbMatch) {
    return createDbMatch[1];
  }
  
  const useDbMatch = content.match(/USE\s+`?([^`;\s]+)`?/i);
  if (useDbMatch) {
    return useDbMatch[1];
  }
  
  // Fallback to environment variable
  return process.env.DATABASE_NAME || process.env.MYSQL_DATABASE;
}

/**
 * URL encode special characters in database credentials
 */
function encodeCredentials(str) {
  if (!str) return '';
  return String(str)
    .replace(/[:'@/?#\[\]]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Prepare database dump file
 */
async function prepareDumpFile(uploadedFile, migrationId, logger) {
  logger.info('Preparing MySQL dump file...');
  
  // Create migration-specific directory
  const migrationDumpDir = path.join(DOCKER_COMPOSE_PATH, 'sql-dump', migrationId);
  const dumpPath = path.join(migrationDumpDir, 'dump.sql');

  if (!fs.existsSync(migrationDumpDir)) {
    fs.mkdirSync(migrationDumpDir, { recursive: true });
  }

  fs.copyFileSync(uploadedFile, dumpPath);
  logger.info(`Dump file prepared at ${dumpPath}`);
  
  return dumpPath;
}

/**
 * Create pgloader configuration file from environment variables and dump analysis
 */
async function createPgloaderConfig(migrationId, dumpPath, logger) {
  logger.info('Creating pgloader configuration...');

  // Get required environment variables (DATABASE_NAME is now optional)
  const requiredEnvVars = [
    'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD',
    'POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'
  ];

  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Use internal Docker ports (pgloader runs inside Docker network)
  const mysqlHost = process.env.MYSQL_HOST;
  const mysqlPort = parseInt(process.env.MYSQL_PORT_INTERNAL); // Internal port inside Docker network
  const mysqlUser = process.env.MYSQL_USER; // Use root to access any database
  const mysqlPassword = encodeCredentials(process.env.MYSQL_PASSWORD );
  const mysqlDb = extractDatabaseName(dumpPath); // Extract from dump instead of env var
  if (!mysqlDb) {
    throw new Error('Unable to determine MySQL database name from dump or environment variables');
  }
  logger.info(`Detected MySQL database name: ${mysqlDb}`);

  const pgHost = process.env.POSTGRES_HOST;
  const pgPort = parseInt(process.env.POSTGRES_PORT_INTERNAL); // Internal port inside Docker network
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

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

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

  // Load environment variables from containers/.env
  const dotenv = require('dotenv');
  const containerEnvPath = path.join(DOCKER_COMPOSE_PATH, '.env');
  if (fs.existsSync(containerEnvPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(containerEnvPath));
    logger.info('Loading environment variables from containers/.env');
  }

  try {
    const result = await execProcess('docker-compose', [
      '-p', projectName,
      'up', '--build', '-d'
    ], {
      cwd: DOCKER_COMPOSE_PATH,
      env: { 
        ...process.env, 
        MIGRATION_ID: migrationId 
      }
    });

    const lines = result.stdout.split('\n').filter(l => l.trim());
    lines.forEach(line => logger.info(`Docker: ${line}`));
    
    logger.info('Docker containers started successfully');
  } catch (err) {
    logger.error(`Docker startup failed: ${err.stderr}`);
    throw new Error('Docker Compose failed to start');
  }
}

/**
 * Wait for databases to be ready
 */
async function waitForDatabases(migrationId, logger, maxAttempts = 60) {
  logger.info('Waiting for databases to be ready...');
  const mysqlContainerName = `migration-${migrationId}-mysql-source-1`;
  const pgContainerName = `migration-${migrationId}-postgres-target-1`;
  const pgloaderContainerName = `migration-${migrationId}-pgloader-1`;
  const mysqlPort = parseInt(process.env.MYSQL_PORT_INTERNAL);
  const pgPort = parseInt(process.env.POSTGRES_PORT_INTERNAL || process.env.POSTGRES_PORT, 10) || 5432;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Check MySQL health status via Docker
      const mysqlHealthResult = await execProcess('docker', [
        'inspect',
        '--format', '{{.State.Health.Status}}',
        mysqlContainerName
      ]);
      const mysqlHealth = mysqlHealthResult.stdout.trim();
      
      // Check PostgreSQL health status via Docker
      const pgHealthResult = await execProcess('docker', [
        'inspect',
        '--format', '{{.State.Health.Status}}',
        pgContainerName
      ]);
      const pgHealth = pgHealthResult.stdout.trim();
      
      if (mysqlHealth === 'healthy' && pgHealth === 'healthy') {
        const readyIn = ((Date.now() - startedAt) / 1000).toFixed(1);
        logger.info(`MySQL is healthy after ${attempt} checks (${readyIn}s)`);
        logger.info(`PostgreSQL is healthy after ${attempt} checks (${readyIn}s)`);
        
        // Additional buffer to ensure dump is fully loaded
        logger.info('Waiting 15 seconds for MySQL dump to complete loading...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Verify MySQL dump was loaded by checking if any databases exist beyond system DBs
        try {
          const mysqlUser = process.env.MYSQL_USER || 'root';
          const mysqlPassword = mysqlUser === 'root'
            ? process.env.MYSQL_ROOT_PASSWORD
            : process.env.MYSQL_PASSWORD;
          const mysqlArgs = [
            'exec', mysqlContainerName,
            'mysql', '-u', mysqlUser
          ];
          if (mysqlPassword) {
            mysqlArgs.push(`-p${mysqlPassword}`);
          }
          mysqlArgs.push('-e', 'SHOW DATABASES;');
          const dbCheckResult = await execProcess('docker', mysqlArgs);
          const databases = dbCheckResult.stdout.split('\n').filter(db => 
            db && !['Database', 'information_schema', 'mysql', 'performance_schema', 'sys'].includes(db.trim())
          );
          logger.info(`MySQL databases loaded: ${databases.join(', ')}`);
          
          if (databases.length === 0) {
            logger.warn('No user databases found in MySQL - dump may not have loaded properly');
          }
        } catch (err) {
          logger.warn(`Could not verify MySQL databases: ${err.message}`);
        }
        
        logger.info(`Databases ready in ${readyIn}s, proceeding to pgloader`);
        return;
      }
      
      if (attempt <= 3 || attempt % 5 === 0) {
        logger.info(`Waiting for databases... (${attempt}/${maxAttempts}) - MySQL: ${mysqlHealth}, PostgreSQL: ${pgHealth}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      if (attempt < maxAttempts) {
        if (attempt <= 3 || attempt % 5 === 0) {
          logger.info(`Waiting for databases... (${attempt}/${maxAttempts})`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
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
    const result = await execProcess('docker', [
      'exec', pgloaderContainerName,
      'pgloader', `/migration/load-${migrationId}.load`
    ]);

    const lines = result.stdout.split('\n').filter(l => l.trim());
    lines.forEach(line => logger.info(`pgloader: ${line}`));

    logger.info('pgloader migration completed successfully');
  } catch (err) {
    logger.error(`pgloader failed: ${err.stderr}`);
    throw new Error('pgloader migration failed');
  }
}

/**
 * Export PostgreSQL dump
 */
async function exportPostgresDump(migrationId, logger) {
  logger.info('Exporting PostgreSQL dump...');
  const pgContainerName = `migration-${migrationId}-postgres-target-1`;

  const outputDir = path.join(DOCKER_COMPOSE_PATH, 'output');
  const outputPath = path.join(outputDir, `postgres_dump_${migrationId}.sql`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const result = await execProcess('docker', [
      'exec', pgContainerName,
      'pg_dump', '-U', process.env.POSTGRES_USER || 'postgres',
      '-d', process.env.POSTGRES_DB || 'awr'
    ]);

    fs.writeFileSync(outputPath, result.stdout, 'utf8');
    logger.info(`PostgreSQL dump exported to ${outputPath}`);

    return outputPath;
  } catch (err) {
    logger.error(`pg_dump failed: ${err.stderr}`);
    throw new Error('PostgreSQL dump export failed');
  }
}

/**
 * Stop and remove Docker containers
 */
async function stopDockerContainers(migrationId, logger) {
  logger.info('Stopping Docker containers...');
  const projectName = `migration-${migrationId}`;
  logger.info(`Stopping Docker Compose project: ${projectName}`);

  try {
    await execProcess('docker-compose', [
      '-p', projectName,
      'down'
    ], {
      cwd: DOCKER_COMPOSE_PATH,
      env: { 
        ...process.env, 
        MIGRATION_ID: migrationId 
      }
    });
    logger.info('Containers stopped successfully');
  } catch (err) {
    logger.warn(`Cleanup warning: ${err.stderr}`);
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

    // Step 1: Prepare dump file
    const dumpPath = await prepareDumpFile(migration.uploadedFile, migration.id, logger);

    // Step 2: Create pgloader config
    const configPath = await createPgloaderConfig(migration.id, dumpPath, logger);

    // Step 3: Start Docker containers (MySQL loads dump automatically from /docker-entrypoint-initdb.d)
    await startDockerContainers(migration.id, logger);

    // Step 4: Wait for databases to be ready
    await waitForDatabases(migration.id, logger);

    // Step 5: Run pgloader migration
    await runPgloaderMigration(migration.id, logger);

    // Step 6: Export PostgreSQL dump
    const outputFile = await exportPostgresDump(migration.id, logger);

    // Step 7: Cleanup
    await stopDockerContainers(migration.id, logger);

    logger.info('Migration completed successfully');
    
    return {
      success: true,
      outputFile: outputFile
    };

  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    
    try {
      await stopDockerContainers(migration.id, logger);
    } catch (cleanupError) {
      logger.error(`Cleanup error: ${cleanupError.message}`);
    }

    throw error;
  }
}

module.exports = {
  startMigration
};
