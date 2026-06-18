const oracledb = require('oracledb');
require('dotenv').config();

// Default output format to OBJECT so we get keyed JSON results rather than arrays
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool;
let isMock = false;

// In-Memory Simulation State for Mock Fallback
const students = [
  { student_id: 'STU101', student_name: 'Ayush', course: 'CSE' },
  { student_id: 'STU102', student_name: 'Rahul', course: 'CSE' },
  { student_id: 'STU103', student_name: 'Tanish', course: 'CSE' }
];

let floors = [
  { floor_id: 1, floor_name: 'Ground', total_seats: 200, occupied_seats: 0, priority_order: 1, status: 'OPEN' },
  { floor_id: 2, floor_name: 'First', total_seats: 200, occupied_seats: 0, priority_order: 2, status: 'OPEN' },
  { floor_id: 3, floor_name: 'Second', total_seats: 200, occupied_seats: 0, priority_order: 3, status: 'OPEN' },
  { floor_id: 4, floor_name: 'Third', total_seats: 200, occupied_seats: 0, priority_order: 4, status: 'OPEN' },
  { floor_id: 5, floor_name: 'Fourth', total_seats: 200, occupied_seats: 0, priority_order: 5, status: 'OPEN' }
];

let seats = [];
// Generate 200 FREE seats for each floor by default
for (let fId = 1; fId <= 5; fId++) {
  for (let sNo = 1; sNo <= 200; sNo++) {
    seats.push({ seat_id: (fId - 1) * 200 + sNo, floor_id: fId, seat_no: sNo, status: 'FREE' });
  }
}

let allocations = [];
let scanLogs = [];
let scanSeq = 1;
let allocSeq = 1;

async function initialize() {
  // Check if DB password is still placeholder
  if (process.env.DB_PASSWORD === 'your_oracle_password_here' || !process.env.DB_PASSWORD) {
    console.warn('\n[DB WARNING] "DB_PASSWORD" is set to the placeholder in .env.');
    console.warn('============= FALLING BACK TO IN-MEMORY MOCK MODE =============\n');
    isMock = true;
    return;
  }

  try {
    pool = await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECTION_STRING,
      poolMin: 2,
      poolMax: 10,
      poolIncrement: 1,
      poolTimeout: 60
    });
    console.log('Oracle DB connection pool initialized in Thin Mode.');
    isMock = false;
    return pool;
  } catch (err) {
    console.warn('\n[DB WARNING] Failed to connect to Oracle Database:');
    console.warn(`   ${err.message}`);
    console.warn('============= FALLING BACK TO IN-MEMORY MOCK MODE =============');
    console.warn('Verify Oracle XE service is running and configure credentials in .env.\n');
    isMock = true;
  }
}

/**
 * Simulates the Oracle SQL queries when running in Mock Mode
 */
function simulateQuery(sql, binds) {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  // 1. GET /api/floors
  if (normalizedSql.includes('FROM FLOOR') && normalizedSql.includes('ORDER BY PRIORITY_ORDER')) {
    return { rows: JSON.parse(JSON.stringify(floors)) };
  }

  // 2. GET /api/seats/:floor_id
  if (normalizedSql.includes('FROM SEAT') && normalizedSql.includes('WHERE FLOOR_ID = :FLOOR_ID')) {
    const floorId = parseInt(binds.floor_id, 10);
    const floorSeats = seats.filter(s => s.floor_id === floorId);
    return { rows: JSON.parse(JSON.stringify(floorSeats)) };
  }

  // 3. GET /api/log
  if (normalizedSql.includes('FROM SCAN_LOG S') || normalizedSql.includes('FROM SCAN_LOG')) {
    const logs = scanLogs.slice(-20).reverse().map(log => {
      const student = students.find(st => st.student_id === log.student_id);
      const floor = floors.find(f => f.floor_id === log.floor_id);
      return {
        SCAN_ID: log.scan_id,
        STUDENT_ID: log.student_id,
        SCAN_TYPE: log.scan_type,
        FLOOR_ID: log.floor_id,
        SCAN_TIME: log.scan_time,
        STUDENT_NAME: student ? student.student_name : 'Unknown',
        FLOOR_NAME: floor ? floor.floor_name : 'Unknown'
      };
    });
    return { rows: logs };
  }

  // 4. POST /api/scan (Trigger simulation)
  if (normalizedSql.includes('INSERT INTO SCAN_LOG')) {
    const studentId = binds.student_id.toUpperCase().trim();
    const scanType = binds.scan_type;
    const floorId = binds.floor_id;

    // Validate student exists
    const student = students.find(s => s.student_id === studentId);
    if (!student) {
      throw new Error('ORA-20001: Student STU ID not found.');
    }

    if (scanType === 'ENTRY') {
      const targetFloor = floors.find(f => f.floor_id === floorId);
      if (!targetFloor) {
        throw new Error('ORA-20005: Floor not found.');
      }
      if (targetFloor.status === 'CLOSED') {
        throw new Error('ORA-20005: Floor is currently CLOSED.');
      }

      // Check if student already inside
      const hasActive = allocations.some(a => a.student_id === studentId && a.exit_time === null);
      if (hasActive) {
        throw new Error('ORA-20002: Student already has an active entry.');
      }

      // Find lowest seat_no FREE seat on the floor
      const freeSeat = seats
        .filter(s => s.floor_id === floorId && s.status === 'FREE')
        .sort((a, b) => a.seat_no - b.seat_no)[0];

      if (!freeSeat) {
        throw new Error('ORA-20003: No available seats on this floor.');
      }

      // Allocate seat
      freeSeat.status = 'OCCUPIED';
      allocations.push({
        allocation_id: allocSeq++,
        student_id: studentId,
        seat_id: freeSeat.seat_id,
        entry_time: new Date(),
        exit_time: null
      });

      targetFloor.occupied_seats++;
    } else if (scanType === 'EXIT') {
      // Find active allocation
      const activeAllocIndex = allocations.findIndex(a => a.student_id === studentId && a.exit_time === null);
      if (activeAllocIndex === -1) {
        throw new Error('ORA-20004: No active library entry found.');
      }

      const alloc = allocations[activeAllocIndex];
      alloc.exit_time = new Date();

      // Free seat
      const seat = seats.find(s => s.seat_id === alloc.seat_id);
      if (seat) {
        seat.status = 'FREE';
        const floor = floors.find(f => f.floor_id === seat.floor_id);
        if (floor) {
          floor.occupied_seats--;
        }
      }
    }

    // Insert log
    const timeStr = new Date().toTimeString().split(' ')[0];
    scanLogs.push({
      scan_id: scanSeq++,
      student_id: studentId,
      scan_type: scanType,
      scan_time: timeStr,
      floor_id: floorId
    });

    return { rowsAffected: 1 };
  }

  // 5. POST /api/reset
  if (normalizedSql.includes('DELETE FROM SCAN_LOG') || normalizedSql.includes('RESET')) {
    scanLogs = [];
    allocations = [];
    seats.forEach(s => s.status = 'FREE');
    floors.forEach(f => f.occupied_seats = 0);
    return { success: true };
  }

  // 6. POST /api/floors/:floor_id/seats (Capacity update)
  if (normalizedSql.includes('DECLARE') && normalizedSql.includes('TOTAL_SEATS = V_TOTAL')) {
    const floorId = parseInt(binds.floor_id, 10);
    const totalSeats = parseInt(binds.total_seats, 10);

    const floor = floors.find(f => f.floor_id === floorId);
    if (!floor) {
      throw new Error('Floor not found.');
    }

    floor.total_seats = totalSeats;
    floor.occupied_seats = 0;

    // Delete allocations for this floor
    const floorSeatIds = seats.filter(s => s.floor_id === floorId).map(s => s.seat_id);
    allocations = allocations.filter(a => !floorSeatIds.includes(a.seat_id));

    // Delete old seat records
    seats = seats.filter(s => s.floor_id !== floorId);

    // Create new seat records
    for (let i = 1; i <= totalSeats; i++) {
      seats.push({ seat_id: floorId * 1000 + i, floor_id: floorId, seat_no: i, status: 'FREE' });
    }

    return { success: true };
  }

  console.warn(`Simulated SQL query was not matched: ${sql}`);
  return { rows: [] };
}

/**
 * Execute a SQL query or PL/SQL block
 */
async function execute(sql, binds = {}, options = {}) {
  if (isMock) {
    return simulateQuery(sql, binds);
  }

  let connection;
  try {
    if (!pool) {
      pool = oracledb.getPool();
    }
  } catch (e) {
    await initialize();
  }

  // Double check if initialized fallback to mock mode
  if (isMock) {
    return simulateQuery(sql, binds);
  }

  try {
    connection = await pool.getConnection();
    const opts = {
      autoCommit: true,
      ...options
    };
    const result = await connection.execute(sql, binds, opts);
    return result;
  } catch (err) {
    console.error('Database Query Execution Error:', err.message);
    throw err;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error('Error closing database connection:', closeErr.message);
      }
    }
  }
}

module.exports = {
  initialize,
  execute,
  oracledb,
  getIsMock: () => isMock
};
