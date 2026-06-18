# TIET Library Seat Occupancy System (DBMS Project)

A real-time library seat management system built for TIET University where students scan to enter/exit, and seats are automatically allocated and released per floor using Oracle SQL & PL/SQL procedures, database triggers, a Node.js + Express API backend, and a responsive HTML/CSS/JS frontend dashboard.

---

## Project Structure
```text
/library-system
  /backend
    db.js              # Oracle Connection Pool Config (Thin Mode)
    package.json       # Node.js backend packages configuration
    schema.sql         # SQL tables, sequences, triggers, procedures, & seeds
    server.js          # Express API server with CORS and REST routes
    .env               # Local configuration file (Database credentials & Port)
  /frontend
    index.html         # Rich UI Single Page Dashboard
  README.md            # Setup and Installation Manual (this file)
```

---

## Prerequisites
Before setting up the project, make sure you have installed:
1. **Node.js** (v16 or higher recommended) - [Download](https://nodejs.org/)
2. **Oracle Database XE** (11g/18c/21c or 23c Free) - [Download](https://www.oracle.com/database/technologies/appdev/xe.html)
3. A Database client like **Oracle SQL Developer** or **SQL*Plus** to execute the database schema setup.

---

## Step 1: Database Setup (Oracle XE)

1. Open your database management tool (e.g. **Oracle SQL Developer**) or launch `SQL*Plus` from your terminal:
   ```bash
   sqlplus system/your_sys_password@localhost:1521/XE
   ```
2. Open the [schema.sql](backend/schema.sql) file and run it. The script will:
   - Clean up existing database objects (tables, sequences, procedures, triggers) if they already exist.
   - Create tables: `student`, `floor`, `seat`, `allocation`, and `scan_log`.
   - Create sequences: `seat_seq`, `alloc_seq`, and `scan_seq`.
   - Compile PL/SQL stored procedures: `allocate_seat_floor` and `release_seat` (handling business logic constraints and throwing clean custom exceptions like `ORA-20002` if a student is already checked in).
   - Create database trigger `scan_log_trg` that intercepts inserts on `scan_log` and calls the procedures automatically.
   - Seed sample students (`STU101`, `STU102`, `STU103`), 5 library floors (`Ground`, `First`, `Second`, `Third`, `Fourth`), and dynamically generate 200 free seat records per floor using a nested PL/SQL loop (1,000 seats in total).

---

## Step 2: Backend Setup (Node.js)

1. Open a terminal and navigate to the backend folder:
   ```bash
   cd library-system/backend
   ```
2. Install the Node.js dependencies:
   ```bash
   npm install
   ```
   *Note: This installs `express`, `oracledb` (using native JS Thin Mode, which does **not** require installing any Oracle Instant Client), `cors` to resolve cross-origin issues, and `dotenv`.*

3. Configure your database credentials:
   - Rename `.env` (or modify it) to reflect your database login information:
     ```env
     PORT=3000
     DB_USER=system
     DB_PASSWORD=your_oracle_password_here
     DB_CONNECTION_STRING=localhost:1521/XE
     ```
   - *If using Oracle 23c Free, the `DB_CONNECTION_STRING` is typically `localhost:1521/FREE` instead of `XE`.*

4. Launch the Express server:
   ```bash
   npm start
   ```
   You should see a message in the console indicating the connection was successful:
   ```text
   Oracle DB connection pool initialized in Thin Mode.
   TIET Library Seat Occupancy System API running on http://localhost:3000
   ```

---

## Step 3: Frontend Dashboard Launch

1. Locate the [index.html](frontend/index.html) file inside the `frontend` folder.
2. Double-click to open it in your browser (Chrome, Edge, or Safari).
3. The dashboard connects to the local Express server at `http://localhost:3000` and:
   - Displays real-time aggregate statistics (Total, Available, Occupied seats).
   - Renders a visually pleasing 20x10 seat matrix grid for each of the 5 floors. Green indicates a seat is free, while Red indicates it is occupied. Hovering over a seat reveals its seat number.
   - Features a student simulation panel to trigger scans. You can select one of the three seed students (Ayush, Rahul, Tanish) or enter a custom student ID, select a target floor, and trigger an **Entry Scan** or **Exit Scan**.
   - Displays a dark developer console logging database transactional responses or error messages (e.g. if a student tries to enter twice).
   - Polling is configured to automatically refresh floor statistics and seats every **10 seconds** in the background.

---

## Core API Endpoints

- **GET `/api/floors`**: Fetches all floors, their capacities, and occupancy rates.
- **GET `/api/seats/:floor_id`**: Fetches the status (`FREE` / `OCCUPIED`) and seat number of all seats on the selected floor.
- **POST `/api/scan`**: Processes a student card scan.
  - Body format: `{ "student_id": "STU101", "scan_type": "ENTRY", "floor_id": 1 }`
  - Automatically triggers the PL/SQL stored procedures on the DB.
- **GET `/api/log`**: Fetches the latest 20 scan log activities, joined with student names and floor descriptions.
- **POST `/api/reset`**: Resets the entire library state to empty.
- **POST `/api/floors/:floor_id/seats`**: Re-generates seating configurations and updates floor capacity.
  - Body format: `{ "total_seats": 150 }`
