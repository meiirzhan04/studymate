# Smart Student Performance Monitoring System

A monorepo starter using React, FastAPI, and SQLite for the current development phase.

## Run locally

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The frontend proxies `/api` to FastAPI on port 8000.

Demo accounts:

- Student: `student@univ.edu` / `student123`
- Teacher: `teacher@univ.edu` / `teacher123`

Demo records are seeded automatically into `backend/data/student_monitoring.db`. Passwords are stored as salted PBKDF2 hashes.

## Test

```bash
cd backend
pytest
```

## Configuration

Copy `.env.example` to `.env` if you want to override `SQLITE_PATH`.

### Database

- Without `DATABASE_URL` the API uses SQLite (`SQLITE_PATH`), which is what local development and the tests use.
- With `DATABASE_URL` (a Postgres URL, e.g. a free Neon database) the same code runs on Postgres; `app/db.py` translates the SQLite-dialect SQL. Production needs this: Render's free instances lose their disk on every deploy and restart.
- `GET /health` reports which backend is active (`"db": "postgres"` or `"sqlite"`).
- Run the suite on Postgres with a throwaway database: `TEST_DATABASE_URL=postgresql://... python -m pytest` (the schema in that database is dropped first, so never point it at production).

## Railway deployment

The root `Dockerfile` builds React and serves it from FastAPI as one service. Attach a Railway Volume at `/data` so the SQLite database survives redeployments. Generate a public domain for port `8000` and set a strong `AUTH_SECRET` variable.
