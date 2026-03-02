# 🎯 Darts 501

A full-stack darts scoring application built for iPad, designed to be hosted on a local network or private server. Supports multiple game modes, a CPU opponent, voice calling, sound effects, player statistics, and AI-powered performance analysis.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Deployment](#deployment)
- [Game Modes](#game-modes)
- [Practice Modes](#practice-modes)
- [API Reference](#api-reference)
- [Running Tests](#running-tests)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Multiple game modes** — 501, 201, Cricket, Shanghai, and a full Practice suite
- **CPU opponent** — single-player mode with an AI-controlled computer player
- **Voice caller** — Web Speech API caller announces scores, checkouts, and game events
- **Sound effects** — synthesised audio via Web Audio API (no external files required)
- **Checkout suggestions** — optimal finishing routes shown in real time
- **Player statistics** — per-player dashboards with averages, hit rates, trends, and session history
- **SVG dartboard heatmap** — colour-coded throw distribution across all segments
- **AI performance analysis** — Claude-powered written analysis of player strengths and weaknesses
- **Restart & Undo** — full undo support and match restart across all game modes
- **Multiplayer** — multiple human players with per-player turn management
- **iOS-optimised** — touch-safe event handling for iPad/iPhone (iOS 12.5.7+), installable as a PWA
- **Subpath deployment** — runs cleanly at a URL subpath (e.g. `/Darts501`) via Apache + mod_wsgi

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3, Flask, PyMySQL |
| **Database** | MySQL 8 |
| **Frontend** | Vanilla JavaScript (ES5-compatible), CSS3 |
| **Web Server** | Apache2 + mod_wsgi |
| **Speech** | Web Speech API (browser-native) |
| **Audio** | Web Audio API (browser-native, synthesised) |
| **AI Analysis** | Anthropic Claude API |

> No frontend build step or JavaScript bundler is required. All JS is served as plain files.

---

## Project Structure

```
Darts501/
├── app/
│   ├── __init__.py              # Flask application factory
│   ├── models/
│   │   └── db.py                # PyMySQL connection management
│   ├── routes/
│   │   ├── views.py             # HTML shell route
│   │   └── api/
│   │       ├── matches.py       # 501/201 match lifecycle + practice sessions
│   │       ├── throws.py        # Individual dart throw recording
│   │       ├── turns.py         # Batch turn submission
│   │       ├── legs.py          # Leg management
│   │       ├── players.py       # Player CRUD
│   │       ├── stats.py         # Player statistics & heatmap
│   │       ├── analysis.py      # AI performance analysis
│   │       ├── cricket.py       # Cricket game mode routes
│   │       └── shanghai.py      # Shanghai game mode routes
│   ├── services/
│   │   └── scoring_engine.py    # Pure Python 501 scoring logic (no Flask dependency)
│   ├── static/
│   │   ├── css/
│   │   │   └── app.css
│   │   └── js/
│   │       ├── app.js           # App entry point & setup screen
│   │       ├── ui.js            # Shared UI builder (modals, setup screen, rules)
│   │       ├── api.js           # All fetch() calls to the backend
│   │       ├── cricket.js       # Cricket game engine
│   │       ├── shanghai.js      # Shanghai game engine
│   │       ├── practice.js      # Practice suite (all modes)
│   │       ├── stats.js         # Statistics & heatmap rendering
│   │       ├── analysis.js      # AI analysis UI
│   │       ├── checkout.js      # Checkout suggestion lookup
│   │       ├── cpu.js           # CPU player logic
│   │       ├── speech.js        # Voice caller
│   │       └── sounds.js        # Synthesised sound effects
│   └── templates/
│       └── index.html           # Single-page shell (Flask/Jinja2)
├── tests/
│   └── test_scoring_engine.py   # Unit tests for the scoring engine
├── config.py                    # Flask configuration (Dev/Production)
├── darts501.wsgi                # mod_wsgi entry point
├── apache2-darts501.conf        # Apache2 VirtualHost snippet
├── requirements.txt
└── .env                         # Environment variables (not committed)
```

---

## Prerequisites

- Python 3.10+
- MySQL 8.0+
- Apache2 with `mod_wsgi` (for production deployment)
- A modern browser with Web Speech API support (Chrome recommended; Safari iOS 15+)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/Darts501.git
cd Darts501
```

### 2. Create a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

---

## Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

`.env` contents:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=darts
ANTHROPIC_API_KEY=your_anthropic_api_key   # Optional — required for AI analysis only
```

Flask will automatically load this file on startup. In production, the `.wsgi` file handles loading `.env` before the app is created (since mod_wsgi daemon processes do not inherit shell environment variables).

---

## Database Setup

### 1. Create the database

```sql
CREATE DATABASE darts CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Run the base schema

```bash
mysql -u root -p darts < schema.sql
```

### 3. Run game-mode migrations

```bash
mysql -u root -p darts < cricket_migration.sql
mysql -u root -p darts < shanghai_migration.sql
mysql -u root -p darts < add_practice_session_type.sql
mysql -u root -p darts < add_shanghai_game_type.sql
```

### Schema overview

| Table | Description |
|---|---|
| `players` | Registered players |
| `matches` | All match records across game types |
| `legs` | Individual legs within a 501/201 match |
| `turns` | Turns within a leg |
| `throws` | Individual dart throws |
| `cricket_marks` | Mark counts per player per number |
| `cricket_scores` | Running points per player |
| `cricket_throws` | Individual dart records for Cricket |
| `shanghai_games` | Shanghai game config & state |
| `shanghai_rounds` | Per-player per-round scores |
| `shanghai_throws` | Individual dart records for Shanghai |

---

## Running the Application

### Development

```bash
export FLASK_ENV=development
python -m flask --app "app:create_app()" run --host=0.0.0.0 --port=5000
```

Then open `http://localhost:5000` in your browser.

### Local network (iPad access)

Run the dev server on `0.0.0.0` as above, then navigate to `http://<your-machine-ip>:5000` on your iPad.

---

## Deployment

The app is designed to be deployed at a URL subpath (e.g. `https://example.com/Darts501`) using Apache2 and mod_wsgi.

### 1. Copy files to the server

```bash
sudo cp -r . /var/www/Darts501
```

### 2. Set up the virtual environment on the server

```bash
cd /var/www/Darts501
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

### 3. Configure Apache

Add the contents of `apache2-darts501.conf` inside your existing `<VirtualHost>` block:

```apacheconf
WSGIDaemonProcess Darts501 \
    processes=1 threads=5 \
    python-home=/var/www/Darts501/venv \
    python-path=/var/www/Darts501

WSGIScriptAlias /Darts501 /var/www/Darts501/darts501.wsgi

<Directory /var/www/Darts501>
    WSGIProcessGroup Darts501
    WSGIApplicationGroup %{GLOBAL}
    Require all granted
</Directory>

Alias /Darts501/static /var/www/Darts501/app/static

<Directory /var/www/Darts501/app/static>
    Require all granted
</Directory>
```

### 4. Reload Apache

```bash
sudo systemctl reload apache2
```

The app will be available at `https://your-domain.com/Darts501/`.

---

## Game Modes

### 501 / 201
Standard legs-based darts. Double-out required. Supports 1–4 human players and an optional CPU opponent. Features batch turn submission, checkout suggestions, full undo, and match restart.

### Cricket
Hit numbers 15–20 and Bull three times to "close" them, then score points by hitting closed numbers your opponent hasn't closed. Supports 2–4 players. Hit detection covers singles, doubles, and trebles.

### Shanghai
Each round targets a specific number (1–7 or 1–20). Players score by hitting the target number in any multiplier. A "Shanghai" (hitting single, double, and treble in the same round) is recorded. Tiebreak via Bull round if scores are level.

---

## Practice Modes

All practice modes are accessible from the main setup screen under **PRACTICE**.

| Mode | Description |
|---|---|
| **Free Throw** | Open practice — records all throws, shows averages and a live heatmap |
| **Single Segment** | Target a specific single, double, or treble and track hit rate |
| **All Trebles** | Tracks treble hit rate across all 20 segments |
| **All Doubles** | Tracks double hit rate across all 20 segments |
| **Checkout Doubles** | Focuses on the key finishing doubles: D20, D16, D10, D8, D4, D2, D1, Bull |
| **Around the Clock** | Hit 1 through 20 in order (any multiplier) — completion time tracked |
| **Bob's 27** | Doubles ladder game — start at 27 pts, hit D1→D20→DBull in sequence; hits add the double's value, misses subtract the segment value |
| **121 Checkouts** | Solo checkout practice — start at 121, check out in 9 or 12 darts with a double finish; target increases on success, drops on failure |

---

## API Reference

All endpoints are prefixed with `/api`.

### Players
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/players` | List all players |
| `POST` | `/api/players` | Create a player |

### Matches (501/201)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/matches` | Start a new match |
| `GET` | `/api/matches/:id` | Get match state |
| `POST` | `/api/matches/:id/restart` | Restart a match |
| `POST` | `/api/matches/:id/cancel` | Cancel a match |
| `POST` | `/api/practice` | Start a practice session |
| `POST` | `/api/practice/:id/end` | End a practice session |

### Throws & Turns
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/throws` | Record a single dart throw |
| `POST` | `/api/turns` | Submit a complete turn (batch) |

### Cricket
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/cricket/matches` | Start a Cricket match |
| `GET` | `/api/cricket/matches/:id` | Get match state |
| `POST` | `/api/cricket/matches/:id/throw` | Record a throw |
| `POST` | `/api/cricket/matches/:id/undo` | Undo last throw |
| `POST` | `/api/cricket/matches/:id/restart` | Restart match |
| `POST` | `/api/cricket/matches/:id/end` | End match |

### Shanghai
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/shanghai/matches` | Start a Shanghai match |
| `GET` | `/api/shanghai/matches/:id` | Get match state |
| `POST` | `/api/shanghai/matches/:id/submit` | Submit a round |
| `POST` | `/api/shanghai/matches/:id/restart` | Restart match |
| `POST` | `/api/shanghai/matches/:id/end` | End match |

### Statistics
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/players/:id/stats` | Full player statistics |
| `GET` | `/api/players/:id/stats/trend` | Score trend over time |
| `GET` | `/api/players/:id/stats/heatmap` | Throw distribution heatmap data |
| `GET` | `/api/players/:id/history` | Session history |
| `GET` | `/api/matches/:id/scorecard` | Match scorecard |

### AI Analysis
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/players/:id/analysis/metrics` | Raw analysis metrics |
| `POST` | `/api/players/:id/analysis/generate` | Generate AI written analysis |

---

## Running Tests

The scoring engine has a standalone unit test suite with no server dependency.

```bash
# From the project root with the virtualenv active
python -m pytest tests/test_scoring_engine.py -v
```

Or run directly:

```bash
python tests/test_scoring_engine.py
```

---

## Contributing

Contributions are welcome. Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature-name`)
3. Commit your changes with clear messages (`git commit -m 'Add: description of change'`)
4. Push to your fork (`git push origin feature/your-feature-name`)
5. Open a Pull Request against `main`

Please ensure any new backend logic includes appropriate unit tests, and that frontend changes are tested on both desktop Chrome and iOS Safari.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
