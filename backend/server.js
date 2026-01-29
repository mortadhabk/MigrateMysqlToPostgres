const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const migrationService = require('./services/migration.service');

// Load .env from containers directory first
const containersEnvPath = path.resolve(__dirname, '../containers/.env');
if (fs.existsSync(containersEnvPath)) {
  console.log(`Loading .env from: ${containersEnvPath}`);
  dotenv.config({ path: containersEnvPath });
} else {
  console.warn(`Container .env not found at: ${containersEnvPath}`);
}

// Then load local .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const LOGS_DIR = process.env.LOGS_DIR || './logs';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 1073741824; // 1GB

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ limit: '1gb', extended: true }));
app.use(express.static('public'));

// Ensure upload and logs directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${Date.now()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.sql') {
    return cb(new Error('Only .sql files are allowed'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// In-memory store for migration sessions
const migrations = new Map();

/**
 * POST /api/upload
 * Upload a MySQL dump file
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const migrationId = uuidv4();
  const migrations_data = {
    id: migrationId,
    fileName: req.file.originalname,
    uploadedFile: req.file.path,
    uploadedAt: new Date(),
    status: 'ready', // ready, running, completed, failed
    progress: 0,
    logPath: path.join(LOGS_DIR, `${migrationId}.log`),
    outputFile: null,
    error: null
  };

  migrations.set(migrationId, migrations_data);

  res.json({
    success: true,
    migrationId,
    fileName: req.file.originalname,
    fileSize: req.file.size
  });
});

/**
 * POST /api/migrate/:migrationId
 * Start migration process
 */
app.post('/api/migrate/:migrationId', (req, res) => {
  const { migrationId } = req.params;
  const migration = migrations.get(migrationId);

  if (!migration) {
    return res.status(404).json({ error: 'Migration not found' });
  }

  if (migration.status === 'running') {
    return res.status(409).json({ error: 'Migration already running' });
  }

  migration.status = 'running';
  migration.progress = 0;
  
  // Store clients for this migration
  if (!migration.clients) {
    migration.clients = [];
  }

  // Start migration in background with callback for real-time logs
  migrationService.startMigration(migration, (logEntry) => {
    // Broadcast log to all connected clients
    if (migration.clients && migration.clients.length > 0) {
      migration.clients.forEach(client => {
        try {
          client.res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
        } catch (err) {
          // Client may have disconnected
        }
      });
    }
  })
    .then(result => {
      migration.status = 'completed';
      migration.progress = 100;
      migration.outputFile = result.outputFile;
      
      // Send final status to all clients
      if (migration.clients && migration.clients.length > 0) {
        const statusData = {
          status: migration.status,
          progress: migration.progress,
          outputFile: migration.outputFile ? path.basename(migration.outputFile) : null
        };
        migration.clients.forEach(client => {
          try {
            client.res.write(`data: ${JSON.stringify({ 
              type: 'status', 
              data: statusData
            })}\n\n`);
          } catch (err) {
            // Client may have disconnected
          }
        });
      }
    })
    .catch(error => {
      migration.status = 'failed';
      migration.error = error.message;
      
      // Send error status to all clients
      if (migration.clients && migration.clients.length > 0) {
        const statusData = {
          status: migration.status,
          progress: migration.progress,
          error: migration.error
        };
        migration.clients.forEach(client => {
          try {
            client.res.write(`data: ${JSON.stringify({ 
              type: 'status', 
              data: statusData
            })}\n\n`);
          } catch (err) {
            // Client may have disconnected
          }
        });
      }
    });

  res.json({
    success: true,
    migrationId,
    message: 'Migration started'
  });
});

/**
 * GET /api/migrate/:migrationId/logs
 * Stream migration logs using Server-Sent Events
 */
app.get('/api/migrate/:migrationId/logs', (req, res) => {
  const { migrationId } = req.params;
  const migration = migrations.get(migrationId);

  if (!migration) {
    return res.status(404).json({ error: 'Migration not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Initialize clients array if needed
  if (!migration.clients) {
    migration.clients = [];
  }

  // Add this client to the list
  const client = { res, id: Date.now() };
  migration.clients.push(client);

  // Send current status
  res.write(`data: ${JSON.stringify({ 
    type: 'status', 
    data: { 
      status: migration.status, 
      progress: migration.progress 
    } 
  })}\n\n`);

  // Read existing logs from file and send them
  if (fs.existsSync(migration.logPath)) {
    const logs = fs.readFileSync(migration.logPath, 'utf8').split('\n').filter(l => l.trim());
    logs.forEach(logLine => {
      try {
        const logEntry = JSON.parse(logLine);
        res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
      } catch {
        res.write(`data: ${JSON.stringify({ 
          type: 'log', 
          level: 'INFO', 
          message: logLine 
        })}\n\n`);
      }
    });
  }

  // Handle client disconnect
  req.on('close', () => {
    migration.clients = migration.clients.filter(c => c.id !== client.id);
    res.end();
  });
});

/**
 * GET /api/migrate/:migrationId/status
 * Get migration status
 */
app.get('/api/migrate/:migrationId/status', (req, res) => {
  const { migrationId } = req.params;
  const migration = migrations.get(migrationId);

  if (!migration) {
    return res.status(404).json({ error: 'Migration not found' });
  }

  res.json({
    id: migration.id,
    status: migration.status,
    progress: migration.progress,
    error: migration.error,
    outputFile: migration.outputFile ? path.basename(migration.outputFile) : null
  });
});

/**
 * GET /api/download/:migrationId
 * Download the generated PostgreSQL dump
 */
app.get('/api/download/:migrationId', (req, res) => {
  const { migrationId } = req.params;
  const migration = migrations.get(migrationId);

  if (!migration) {
    return res.status(404).json({ error: 'Migration not found' });
  }

  if (!migration.outputFile || !fs.existsSync(migration.outputFile)) {
    return res.status(404).json({ error: 'Output file not found' });
  }

  const fileName = `postgres_dump_${migrationId}.sql`;
  res.download(migration.outputFile, fileName);
});

/**
 * GET /api/health
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }
  }

  res.status(500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Migration backend running on http://localhost:${PORT}`);
});
