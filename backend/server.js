const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./db');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend requests
app.use(cors());
app.use(express.json());

// Initialize Database connection pool and start server
async function startServer() {
  try {
    await db.initialize();
    app.listen(PORT, () => {
      const mode = db.getIsMock && db.getIsMock() ? 'OFFLINE MOCK MODE (In-Memory Simulation)' : 'REAL ORACLE XE MODE';
      console.log(`TIET Library Seat Occupancy System API running on http://localhost:${PORT}`);
      console.log(`System Mode: ${mode}`);
    });
  } catch (err) {
    console.error('Failed to start server: database pool initialization failed.', err);
    process.exit(1);
  }
}

// REST Endpoints

// 1. GET /api/floors -> Return all floors
app.get('/api/floors', async (req, res) => {
  try {
    const result = await db.execute(
      `SELECT floor_id, floor_name, total_seats, occupied_seats, priority_order, status 
       FROM floor 
       ORDER BY priority_order ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch floors data from database.', details: err.message });
  }
});

// 2. GET /api/seats/:floor_id -> Return all seats for a floor
app.get('/api/seats/:floor_id', async (req, res) => {
  const floorId = parseInt(req.params.floor_id, 10);
  if (isNaN(floorId)) {
    return res.status(400).json({ error: 'Invalid floor ID' });
  }

  try {
    const result = await db.execute(
      `SELECT seat_id, floor_id, seat_no, status 
       FROM seat 
       WHERE floor_id = :floor_id 
       ORDER BY seat_no ASC`,
      { floor_id: floorId }
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch seats data.', details: err.message });
  }
});

// 3. POST /api/scan -> Insert scan log (triggers allocation / release)
app.post('/api/scan', async (req, res) => {
  const { student_id, scan_type, floor_id } = req.body;

  if (!student_id || !scan_type) {
    return res.status(400).json({ error: 'Missing student_id or scan_type in request body.' });
  }

  if (scan_type !== 'ENTRY' && scan_type !== 'EXIT') {
    return res.status(400).json({ error: "scan_type must be either 'ENTRY' or 'EXIT'." });
  }

  if (scan_type === 'ENTRY' && !floor_id) {
    return res.status(400).json({ error: 'floor_id is required for ENTRY scans.' });
  }

  try {
    // Insert into scan_log. This triggers PL/SQL logic:
    // scan_log_trg calls allocate_seat_floor (for ENTRY) or release_seat (for EXIT)
    await db.execute(
      `INSERT INTO scan_log (scan_id, student_id, scan_type, scan_time, floor_id)
       VALUES (scan_seq.NEXTVAL, :student_id, :scan_type, SYSTIMESTAMP, :floor_id)`,
      {
        student_id: student_id.toUpperCase().trim(),
        scan_type: scan_type,
        floor_id: scan_type === 'ENTRY' ? parseInt(floor_id, 10) : null
      }
    );

    res.json({
      success: true,
      message: `Scan successfully logged. Student ${student_id} processed for ${scan_type}.`
    });
  } catch (err) {
    console.error('Scan Error:', err.message);
    
    // Parse Oracle Custom Errors (e.g. ORA-20001 to ORA-20005)
    let errorMessage = err.message;
    const dbErrMatch = errorMessage.match(/ORA-(\d+):\s*(.*)/);
    if (dbErrMatch) {
      // Clean up the error message by taking only the first line of details
      errorMessage = dbErrMatch[2].split('\n')[0].trim();
    }
    
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
});

// 4. GET /api/log -> Return last 20 scan logs joined with student and floor info
app.get('/api/log', async (req, res) => {
  try {
    const result = await db.execute(
      `SELECT * FROM (
        SELECT s.scan_id, 
               s.student_id, 
               s.scan_type, 
               s.floor_id, 
               TO_CHAR(s.scan_time, 'HH24:MI:SS') AS scan_time,
               st.student_name, 
               f.floor_name
        FROM scan_log s
        JOIN student st ON s.student_id = st.student_id
        LEFT JOIN floor f ON s.floor_id = f.floor_id
        ORDER BY s.scan_time DESC
      ) WHERE ROWNUM <= 20`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scan logs.', details: err.message });
  }
});

// 5. POST /api/reset -> Reset allocations, scans, restore seats to FREE and occupancies to 0
app.post('/api/reset', async (req, res) => {
  try {
    await db.execute(`
      DECLARE
      BEGIN
        -- Clear dynamic transactional tables
        DELETE FROM scan_log;
        DELETE FROM allocation;
        
        -- Reset status fields
        UPDATE seat SET status = 'FREE';
        UPDATE floor SET occupied_seats = 0;
      END;
    `);
    res.json({ success: true, message: 'Library seating system successfully reset.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset the library seating system.', details: err.message });
  }
});

// 6. POST /api/floors/:floor_id/seats -> Update total seats on a floor (and regenerate seats)
app.post('/api/floors/:floor_id/seats', async (req, res) => {
  const floorId = parseInt(req.params.floor_id, 10);
  const totalSeats = parseInt(req.body.total_seats, 10);

  if (isNaN(floorId) || isNaN(totalSeats) || totalSeats <= 0 || totalSeats > 500) {
    return res.status(400).json({ error: 'Please provide a valid total_seats count (1 - 500).' });
  }

  try {
    // Run an anonymous PL/SQL block to execute this updates atomically.
    await db.execute(`
      DECLARE
        v_floor_id NUMBER := :floor_id;
        v_total NUMBER := :total_seats;
      BEGIN
        -- 1. Update total_seats and reset occupied seats for that floor
        UPDATE floor 
        SET total_seats = v_total, occupied_seats = 0 
        WHERE floor_id = v_floor_id;
        
        -- 2. Clear any active allocations on this floor
        DELETE FROM allocation 
        WHERE seat_id IN (SELECT seat_id FROM seat WHERE floor_id = v_floor_id);
        
        -- 3. Delete old seat records
        DELETE FROM seat WHERE floor_id = v_floor_id;
        
        -- 4. Create new seat records
        FOR i IN 1..v_total LOOP
          INSERT INTO seat (seat_id, floor_id, seat_no, status)
          VALUES (seat_seq.NEXTVAL, v_floor_id, i, 'FREE');
        END LOOP;
      END;
    `, {
      floor_id: floorId,
      total_seats: totalSeats
    });

    res.json({ 
      success: true, 
      message: `Updated total seats for floor ${floorId} to ${totalSeats}. Seating configuration regenerated.` 
    });
  } catch (err) {
    console.error('Update Seating Count Error:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update floor seating capacity.', 
      details: err.message 
    });
  }
});

// Boot the server
startServer();
