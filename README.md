# MySQL to PostgreSQL Migration Tool

Application web complète pour migrer des bases de données MySQL vers PostgreSQL avec une interface utilisateur moderne.

## Architecture

### 🏗️ Composants

```
MigrateMysqlToPostgres/
├── frontend/                 # React + Vite + Tailwind (Port 5173)
│   ├── src/
│   │   ├── components/       # UI Components (FileUpload, LogConsole, etc.)
│   │   ├── styles/           # Tailwind CSS
│   │   └── utils/            # API configuration
│   └── package.json
│
├── backend/                  # Express.js API (Port 3001)
│   ├── server.js             # Main server
│   ├── services/
│   │   └── migration.service.js  # Migration logic
│   └── package.json
│
└── containers/               # Docker Infrastructure
    ├── docker-compose.yml    # MySQL + PostgreSQL + pgLoader
    ├── .env                  # Configuration (credentials, ports)
    ├── sql-dump/             # SQL files for import
    ├── migration/            # pgLoader configs
    ├── output/               # Export results
    └── pgAdmin/              # pgAdmin configs
```

### 📡 Stack Technologique

| Composant | Technologie | Port |
|-----------|-----------|------|
| Frontend | React 18 + Vite + Tailwind CSS | 5173 |
| Backend | Node.js + Express | 3001 |
| Source DB | MySQL 8.0 | 3307 |
| Target DB | PostgreSQL 18 | 5433 |
| Migration Tool | pgLoader | - |
| DB Admin | pgAdmin 4 | 5050 |

### 🔄 Flux de Migration

```
1. User Upload SQL File (Frontend)
   ↓
2. Backend Process File (Express)
   ↓
3. Copy to Docker Volume (sql-dump/)
   ↓
4. Start Docker Containers
   ├── MySQL Container (loads SQL automatically)
   ├── PostgreSQL Container
   └── pgLoader Container
   ↓
5. Wait for Databases Ready
   ├── MySQL health check
   └── PostgreSQL health check
   ↓
6. Run pgLoader Migration
   ├── Read from MySQL
   ├── Create tables in PostgreSQL
   ├── Migrate data
   ├── Create indexes
   └── Reset sequences
   ↓
7. Export Result (pg_dump)
   ↓
8. Download & Cleanup
   ├── Stop containers
   └── Remove volumes
```

### 🚀 Démarrage Rapide

#### Prérequis
- Docker & Docker Compose
- Node.js 16+
- npm

#### Installation

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..
cd backend && npm install && cd ..

# Configuration
cd containers
# Edit .env with your credentials
```

#### Lancer le projet

```bash
# Terminal 1: Frontend
cd frontend
npm run dev    # http://localhost:5173

# Terminal 2: Backend
cd backend
npm start      # http://localhost:3001

# Terminal 3: Docker (si needed)
cd containers
docker-compose up
```

### 🔧 Configuration (.env)

```env
# MySQL
MYSQL_USER=dbuser
MYSQL_PASSWORD=dbpass123
DATABASE_NAME=source_db
MYSQL_PORT=3307

# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres123456
POSTGRES_DB=target_db
POSTGRES_PORT=5433

# Application
BACKEND_PORT=3001
FRONTEND_PORT=5173
```

### 📝 API Endpoints

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/health` | GET | Server health check |
| `/api/migrate` | POST | Upload & start migration |
| `/api/logs/:id` | GET | Migration logs stream |
| `/api/download/:filename` | GET | Download result |

### 🔐 Migration Service

**Fichier**: `backend/services/migration.service.js`

**Étapes**:
1. Prépare le fichier SQL
2. Génère config pgLoader (avec encodage des credentials)
3. Démarre les containers Docker
4. Attend que MySQL & PostgreSQL soient prêts
5. Lance pgLoader pour la migration
6. Exporte la dump PostgreSQL
7. Nettoie les containers

**Gestion des caractères spéciaux**: Les mots de passe avec caractères spéciaux (`@`, `:`, `/`, etc.) sont URL-encoded automatiquement.

### 🐳 Docker Compose

**Services**:
- `mysql-source` - MySQL 8.0 (charge SQL automatiquement via volume)
- `postgres-target` - PostgreSQL 18 Alpine
- `pgloader-migration` - pgLoader pour la migration

**Volumes**:
- `sql-dump/` - Fichiers SQL d'import
- `migration/` - Configurations pgLoader
- `output/` - Exports PostgreSQL
- `pgAdmin/` - Configs pgAdmin
- `mysql-data/` - Données MySQL
- `postgres-data/` - Données PostgreSQL

### 🎨 UI Features

- **Modern Design** - Light theme avec Tailwind CSS
- **File Upload** - Drag & drop support
- **Live Logs** - Real-time migration progress
- **Download Result** - Export PostgreSQL dump
- **Error Handling** - Affichage des erreurs détaillées

### 📊 Variables d'Environnement Supportées

```
MYSQL_HOST         (default: mysql-source)
MYSQL_USER         (required)
MYSQL_PASSWORD     (required)
DATABASE_NAME      (required)
POSTGRES_HOST      (default: postgres-target)
POSTGRES_USER      (default: postgres)
POSTGRES_PASSWORD  (required)
POSTGRES_DB        (default: target_db)
```

### 🔍 Dépannage

**Erreur**: "Connection refused"
- Vérifier que les containers Docker sont lancés
- Vérifier les ports dans `.env`

**Erreur**: "Password authentication failed"
- Vérifier les credentials dans `.env`
- S'assurer que les containers ont redémarré après changement de `.env`

**Erreur**: "pgloader failed"
- Vérifier les logs: `docker logs pgloader-migration`
- Vérifier que MySQL a bien chargé le SQL

### 📦 Production Deployment

```bash
# Build images
docker-compose build

# Deploy
docker-compose up -d

# Check status
docker-compose ps
```

---

**Version**: 1.0.0  
**Dernière mise à jour**: 28 Jan 2026
